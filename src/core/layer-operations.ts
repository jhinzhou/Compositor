import { EditorError, LIMITS, transformSchema, type BatchMutation, type Layer, type Manifest, type Transform } from '../shared/contracts'
import { descendants, hierarchyOrder } from './manifest'

export interface Bounds { x: number; y: number; width: number; height: number }
export type SharedTransform =
  | { kind: 'translate'; dx: number; dy: number }
  | { kind: 'rotate'; degrees: number; pivot?: [number, number] }
  | { kind: 'scale'; factor: number; pivot?: [number, number] }
  | { kind: 'flip'; axis: 'horizontal' | 'vertical'; pivot?: [number, number] }

export function selectedRoots(manifest: Manifest, ids: readonly string[]): Layer[] {
  const selected = new Set(ids)
  for (const id of selected) if (!manifest.layers.some(layer => layer.id === id)) throw new EditorError('LAYER_NOT_FOUND', 'A selected layer no longer exists.')
  const nested = new Set<string>()
  for (const id of selected) for (const child of descendants(manifest, id)) if (child !== id) nested.add(child)
  return hierarchyOrder(manifest).filter(layer => selected.has(layer.id) && !nested.has(layer.id))
}

export function selectedTree(manifest: Manifest, ids: readonly string[]): Layer[] {
  const included = new Set<string>()
  for (const root of selectedRoots(manifest, ids)) for (const id of descendants(manifest, root.id)) included.add(id)
  return hierarchyOrder(manifest).filter(layer => included.has(layer.id))
}

export function transformBounds(transform: Transform): Bounds {
  const [w, h] = transform.size, [x, y] = transform.origin, radians = transform.rotation * Math.PI / 180
  const width = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians))
  const height = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians))
  return { x: x + (w - width) / 2, y: y + (h - height) / 2, width, height }
}

export function selectionBounds(manifest: Manifest, ids: readonly string[]): Bounds | undefined {
  const selected = selectedTree(manifest, ids), pictured = selected.filter(layer => !layer.isGroup)
  const bounds = (pictured.length ? pictured : selected).map(layer => transformBounds(layer.transform))
  if (!bounds.length) return undefined
  const x = Math.min(...bounds.map(rect => rect.x)), y = Math.min(...bounds.map(rect => rect.y))
  return { x, y, width: Math.max(...bounds.map(rect => rect.x + rect.width)) - x, height: Math.max(...bounds.map(rect => rect.y + rect.height)) - y }
}

export function transformAround(source: Transform, operation: SharedTransform, pivot: [number, number]): Transform {
  const transform = structuredClone(source), [w, h] = source.size
  let cx = source.origin[0] + w / 2, cy = source.origin[1] + h / 2
  const [px, py] = 'pivot' in operation && operation.pivot ? operation.pivot : pivot
  switch (operation.kind) {
    case 'translate': cx += operation.dx; cy += operation.dy; break
    case 'rotate': {
      const angle = operation.degrees * Math.PI / 180, x = cx - px, y = cy - py
      cx = px + x * Math.cos(angle) - y * Math.sin(angle); cy = py + x * Math.sin(angle) + y * Math.cos(angle)
      transform.rotation += operation.degrees; break
    }
    case 'scale':
      if (!Number.isFinite(operation.factor) || operation.factor <= 0) throw new EditorError('INVALID_ARGUMENT', 'Scale must be a positive finite number.')
      cx = px + (cx - px) * operation.factor; cy = py + (cy - py) * operation.factor
      transform.size = [w * operation.factor, h * operation.factor]; break
    case 'flip':
      transform.rotation = -transform.rotation
      if (operation.axis === 'horizontal') { cx = 2 * px - cx; transform.flipX = !source.flipX }
      else { cy = 2 * py - cy; transform.flipY = !source.flipY }
      break
  }
  transform.origin = [cx - transform.size[0] / 2, cy - transform.size[1] / 2]
  return transformSchema.parse(transform)
}

export function sharedTransformActions(manifest: Manifest, ids: readonly string[], operation: SharedTransform): {type:'layer.set_transform';layerId:string;transform:Transform}[] {
  const bounds = selectionBounds(manifest, ids)
  if (!bounds) return []
  const pivot: [number, number] = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]
  const layers = selectedTree(manifest, ids).filter(layer => !layer.isGroup||!!layer.maskFile)
  if (layers.length > 100) throw new EditorError('RESOURCE_LIMIT', 'This selection exceeds the batch transform limit.')
  return layers.map(layer => ({ type: 'layer.set_transform', layerId: layer.id, transform: transformAround(layer.transform, operation, pivot) }))
}

function panelOrder(manifest: Manifest): Layer[] {
  const result: Layer[] = []
  const visit = (parentID?: string): void => {
    for (const layer of manifest.layers.filter(layer => layer.parentID === parentID).reverse()) {
      result.push(layer); if (layer.isGroup) visit(layer.id)
    }
  }
  visit(); return result
}

// Native multi-duplicate stacks all copied roots above the topmost original,
// even when the original roots belong to different folders.
export function duplicateSelectionActions(manifest: Manifest, ids: readonly string[]): BatchMutation['actions'] {
  const roots = selectedRoots(manifest, ids)
  if (!roots.length) return []
  if (roots.length + (roots.length > 1 ? 1 : 0) > 100) throw new EditorError('RESOURCE_LIMIT', 'This selection exceeds the duplicate batch limit.')
  const actions: BatchMutation['actions'] = roots.map((layer, index) => ({ type: 'layer.duplicate', layerId: layer.id, clientRef: `copy${index}` }))
  if (roots.length > 1) {
    const included = new Set(roots.map(layer => layer.id)), top = panelOrder(manifest).find(layer => included.has(layer.id))!
    const siblings = manifest.layers.filter(layer => layer.parentID === top.parentID), index = siblings.findIndex(layer => layer.id === top.id)
    const copiedInPanel = panelOrder(manifest).filter(layer => included.has(layer.id)).reverse().map(layer => ({ ref: `copy${roots.findIndex(root => root.id === layer.id)}` }))
    actions.push({ type: 'layer.move', layerIds: copiedInPanel, parentId: top.parentID ?? null, beforeLayerId: siblings[index + 1]?.id ?? null })
  }
  return actions
}

export interface LayerClipboard {
  version: 1
  sourceDocumentId: string
  sourceSessionId?: string
  canvasSize: [number, number]
  roots: string[]
  layers: Layer[]
  files: string[]
}
export interface AssetCopy { sourceFile: string; destinationFile: string }
export interface PastePlan { layers: Layer[]; roots: string[]; activeLayerId: string; assetCopies: AssetCopy[]; idMap: Record<string, string> }

export function captureLayerClipboard(manifest: Manifest, ids: readonly string[], sourceSessionId?: string): LayerClipboard {
  const roots = selectedRoots(manifest, ids), layers = structuredClone(selectedTree(manifest, ids))
  if (!roots.length) throw new EditorError('INVALID_ARGUMENT', 'Select at least one layer to copy.')
  const included = new Set(layers.map(layer => layer.id))
  const files = [...new Set(layers.flatMap(layer => [layer.imageFile, layer.maskFile].filter((file): file is string => !!file)))]
  return { version: 1, sourceDocumentId: manifest.documentID, sourceSessionId, canvasSize: [manifest.width, manifest.height], roots: roots.map(layer => layer.id), layers, files }
}

export function pasteLayerClipboard(clipboard: LayerClipboard, destination: Manifest, options: { newId?: () => string; point?: [number, number]; center?: boolean; parentId?: string | null } = {}): PastePlan {
  if (clipboard.version !== 1 || !clipboard.roots.length || !clipboard.layers.length) throw new EditorError('INVALID_ARGUMENT', 'The layer clipboard is empty or unsupported.')
  if (destination.layers.length + clipboard.layers.length > LIMITS.maxLayers) throw new EditorError('RESOURCE_LIMIT', 'Pasting these layers would exceed the layer limit.')
  if (options.parentId && !destination.layers.some(layer => layer.id === options.parentId && layer.isGroup)) throw new EditorError('INVALID_ARGUMENT', 'The paste destination must be an existing folder.')
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID().toUpperCase())
  const idMap: Record<string, string> = {}
  const occupied = new Set(destination.layers.map(layer => layer.id))
  for (const layer of clipboard.layers) {
    const id = newId()
    if (occupied.has(id) || idMap[layer.id]) throw new EditorError('INVALID_ARGUMENT', 'Paste IDs must be unique.')
    occupied.add(id); idMap[layer.id] = id
  }
  if (clipboard.roots.some(id => !idMap[id])) throw new EditorError('INVALID_ARGUMENT', 'A clipboard root is missing.')
  const pictured = clipboard.layers.filter(layer => !layer.isGroup)
  const rectangles = pictured.map(layer => ({ x: layer.transform.origin[0], y: layer.transform.origin[1], width: layer.transform.size[0], height: layer.transform.size[1] }))
  const primary = clipboard.layers.find(layer => layer.id === clipboard.roots[0])!
  const anchor: [number, number] = clipboard.roots.length === 1 || !rectangles.length
    ? [primary.transform.origin[0] + primary.transform.size[0] / 2, primary.transform.origin[1] + primary.transform.size[1] / 2]
    : [ (Math.min(...rectangles.map(rect => rect.x)) + Math.max(...rectangles.map(rect => rect.x + rect.width))) / 2,
        (Math.min(...rectangles.map(rect => rect.y)) + Math.max(...rectangles.map(rect => rect.y + rect.height))) / 2 ]
  const center = options.center ?? clipboard.sourceDocumentId !== destination.documentID
  const point = options.point ?? [destination.width / 2, destination.height / 2]
  const dx = center || options.point ? point[0] - anchor[0] : 0, dy = center || options.point ? point[1] - anchor[1] : 0
  const assetCopies: AssetCopy[] = []
  const layers = clipboard.layers.map(source => {
    const layer = structuredClone(source); layer.id = idMap[source.id]
    layer.parentID = source.parentID && idMap[source.parentID] ? idMap[source.parentID] : options.parentId ?? undefined
    layer.transform.origin = [source.transform.origin[0] + dx, source.transform.origin[1] + dy]
    if (source.maskSourceID) layer.maskSourceID = idMap[source.maskSourceID]??(clipboard.sourceDocumentId===destination.documentID&&destination.layers.some(layer=>layer.id===source.maskSourceID)?source.maskSourceID:undefined)
    if (source.imageFile) { layer.imageFile = `${layer.id.toUpperCase()}.${source.imageFile.toLowerCase().endsWith('.exr')?'exr':'png'}`; assetCopies.push({ sourceFile: source.imageFile, destinationFile: layer.imageFile }) }
    if (source.maskFile) { layer.maskFile = `${layer.id.toUpperCase()}.mask.png`; assetCopies.push({ sourceFile: source.maskFile, destinationFile: layer.maskFile }) }
    const placement = layer.maskPlacement as { origin?: [number, number] } | undefined
    if (placement?.origin) placement.origin = [placement.origin[0] + dx, placement.origin[1] + dy]
    return layer
  })
  return { layers, roots: clipboard.roots.map(id => idMap[id]), activeLayerId: idMap[clipboard.roots[0]], assetCopies, idMap }
}

export function altDragActions(manifest: Manifest, ids: readonly string[], delta: [number, number]): BatchMutation['actions'] {
  const roots = selectedRoots(manifest, ids)
  // Group duplicate only exposes its root through clientRef. The editor should use
  // pasteLayerClipboard + shared transforms for folders, keeping one transaction.
  if (roots.some(layer => layer.isGroup)) throw new EditorError('UNSUPPORTED_FEATURE', 'Use a clipboard paste transaction to duplicate and move a folder.')
  const actions = duplicateSelectionActions(manifest, ids)
  roots.forEach((layer, index) => actions.push({ type: 'layer.set_transform', layerId: { ref: `copy${index}` }, transform: transformAround(layer.transform, { kind: 'translate', dx: delta[0], dy: delta[1] }, [0, 0]) }))
  if (actions.length > 100) throw new EditorError('RESOURCE_LIMIT', 'This drag selection exceeds the batch limit.')
  return actions
}

export function altDragPastePlan(manifest: Manifest, ids: readonly string[], delta: [number, number], newId?: () => string): PastePlan {
  const clipboard = captureLayerClipboard(manifest, ids)
  const plan = pasteLayerClipboard(clipboard, manifest, { center: false, newId })
  const roots = new Set(plan.roots)
  const originalsByCopy = new Map(Object.entries(plan.idMap).map(([sourceId, copyId]) => [copyId, manifest.layers.find(layer => layer.id === sourceId)!]))
  for (const layer of plan.layers) {
    layer.transform.origin[0] += delta[0]; layer.transform.origin[1] += delta[1]
    if (roots.has(layer.id)) { layer.name += ' copy'; layer.parentID = originalsByCopy.get(layer.id)?.parentID }
    const placement = layer.maskPlacement as { origin?: [number, number] } | undefined
    if (placement?.origin) { placement.origin[0] += delta[0]; placement.origin[1] += delta[1] }
  }
  return plan
}

export type MergeKind = 'selected'|'down'|'group'|'visible'|'stamp-visible'|'stamp-selected'
export interface MergePlan { roots: string[]; includedIds: string[]; parentId: string | null; insertionBeforeId: string | null; anchorId: string; name: string; renderLayers: Layer[]; stamp?:boolean }
export function mergeSelectionPlan(manifest: Manifest, ids: readonly string[], kind: MergeKind = 'selected'): MergePlan {
  if(kind==='visible'||kind==='stamp-visible'){
    const visible=(layer:Layer):boolean=>{
      const seen=new Set<string>();let current:Layer|undefined=layer
      while(current){if(!current.isVisible||seen.has(current.id))return false;seen.add(current.id);current=current.parentID?manifest.layers.find(item=>item.id===current!.parentID):undefined}return true
    }
    const leaves=manifest.layers.filter(layer=>!layer.isGroup&&visible(layer)),stamp=kind==='stamp-visible'
    if(!leaves.length)throw new EditorError('INVALID_ARGUMENT','There are no visible layers to merge.')
    const included=new Set(leaves.map(layer=>layer.id))
    for(const layer of manifest.layers)if(layer.isGroup&&visible(layer)&&[...descendants(manifest,layer.id)].every(id=>id===layer.id||visible(manifest.layers.find(item=>item.id===id)!)))included.add(layer.id)
    return {roots:leaves.map(layer=>layer.id),includedIds:[...included],parentId:null,insertionBeforeId:null,anchorId:leaves.at(-1)!.id,name:stamp?'Stamped Visible':'Merged Visible',renderLayers:structuredClone(manifest.layers),stamp}
  }
  let roots = selectedRoots(manifest, ids)
  if (kind === 'group') {
    if (roots.length !== 1 || !roots[0].isGroup) throw new EditorError('INVALID_ARGUMENT', 'Merge Group requires exactly one folder.')
  } else if (kind === 'down') {
    if (roots.length !== 1) throw new EditorError('INVALID_ARGUMENT', 'Merge Down requires exactly one selected layer.')
    const siblings = manifest.layers.filter(layer => layer.parentID === roots[0].parentID), index = siblings.findIndex(layer => layer.id === roots[0].id)
    if (index < 1 || siblings[index - 1].isGroup || roots[0].isGroup) throw new EditorError('INVALID_ARGUMENT', 'Merge Down requires a pixel layer beneath the selected pixel layer.')
    roots = [siblings[index - 1], roots[0]]
  }
  if (!roots.length || kind !== 'group' && kind !== 'stamp-selected' && roots.length < 2) throw new EditorError('INVALID_ARGUMENT', 'Select at least two layers to merge.')
  const rootIds = roots.map(layer => layer.id), includedIds = selectedTree(manifest, rootIds).map(layer => layer.id)
  const included = new Set(includedIds), selected = new Set(rootIds)
  const renderLayers = manifest.layers.filter(layer => included.has(layer.id)).map(source => {
    const layer = structuredClone(source)
    if (layer.parentID && !included.has(layer.parentID)) delete layer.parentID
    if (layer.maskSourceID && !included.has(layer.maskSourceID)) delete layer.maskSourceID
    return layer
  })
  if (!renderLayers.some(layer => !layer.isGroup)) throw new EditorError('INVALID_ARGUMENT', 'An empty folder has no layers to merge.')
  const top = [...manifest.layers].reverse().find(layer => selected.has(layer.id))!, anchor = manifest.layers.findIndex(layer => layer.id === top.id)
  const next = manifest.layers.slice(anchor + 1).find(layer => !included.has(layer.id))
  return { roots: rootIds, includedIds, parentId: top.parentID ?? null, insertionBeforeId: next?.id ?? null, anchorId: top.id, name: kind === 'down' ? roots[0].name : top.name, renderLayers,stamp:kind==='stamp-selected' }
}
