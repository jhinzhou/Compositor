import {textStyleSchema,shapeStyleSchema} from '../shared/content-style'
import {validateLayerEffects} from '../shared/layer-effects'
import {nativeAdjustmentToSpec} from '../shared/image-filters'
import { BLEND_MODES, EditorError, LIMITS, manifestSchema, type Layer, type Manifest } from '../shared/contracts'

export function hierarchyOrder(manifest: Manifest): Layer[] {
  const result: Layer[] = [],children=new Map<string|undefined,Layer[]>()
  for(const layer of manifest.layers){const siblings=children.get(layer.parentID)??[];siblings.push(layer);children.set(layer.parentID,siblings)}
  const visit = (parentID?: string): void => { for(const layer of children.get(parentID)??[]){result.push(layer);if(layer.isGroup)visit(layer.id)} }
  visit()
  return result
}

export function validateManifest(input: unknown): { manifest: Manifest; warnings: string[] } {
  const manifest = manifestSchema.parse(input)
  if (manifest.width * manifest.height > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'The canvas exceeds the 200 megapixel working surface limit.')
  const canonical=new Map<string,string>();for(const layer of manifest.layers){const key=layer.id.toUpperCase();if(canonical.has(key))throw new EditorError('INVALID_PROJECT','Layer IDs must be unique UUIDs.');canonical.set(key,layer.id)}
  const reference=(id:string|undefined)=>id?(canonical.get(id.toUpperCase())??id):undefined
  for(const layer of manifest.layers){if(layer.parentID)layer.parentID=reference(layer.parentID);if(layer.maskSourceID)layer.maskSourceID=reference(layer.maskSourceID)}
  if(manifest.activeLayerID)manifest.activeLayerID=reference(manifest.activeLayerID)??null
  const ids = new Set<string>(),byId=new Map(manifest.layers.map(layer=>[layer.id,layer]))
  const unsupported: string[] = []
  const warnings: string[] = []
  for (const layer of manifest.layers) {
    if (ids.has(layer.id)) throw new EditorError('INVALID_PROJECT', 'Layer IDs must be unique.')
    ids.add(layer.id)
    if (layer.imageFile && layer.imageFile !== `${layer.id.toUpperCase()}.png`) throw new EditorError('INVALID_PROJECT', `Invalid image filename for ${layer.name}.`)
    if (layer.maskFile && layer.maskFile !== `${layer.id.toUpperCase()}.mask.png`) throw new EditorError('INVALID_PROJECT', 'Invalid mask filename.')
    if (!layer.maskFile && (layer.maskPlacement || layer.maskLinked !== undefined || layer.maskEnabled !== undefined)) throw new EditorError('INVALID_PROJECT', 'Mask metadata requires a mask asset.')
    if (layer.maskFile && manifest.version < (layer.isGroup ? 6 : 4)) throw new EditorError('INVALID_PROJECT', 'Mask metadata is newer than the declared format version.')
    if (layer.maskSourceID && manifest.version < 5) throw new EditorError('INVALID_PROJECT', 'Clipping masks require version 5.')
    if (layer.isGroup && layer.imageFile) throw new EditorError('INVALID_PROJECT', 'Groups cannot contain an image asset.')
    if (!BLEND_MODES.includes(layer.blendMode as typeof BLEND_MODES[number])) unsupported.push(`${layer.name}: blend mode ${layer.blendMode}`)
    if (layer.isGroup && layer.blendMode !== 'Normal') throw new EditorError('INVALID_PROJECT', 'Groups must use pass-through Normal blending.')
    if(layer.effects){if(layer.isGroup||layer.adjustment)throw new EditorError('INVALID_PROJECT','Folders and adjustment layers cannot carry raster effects.');validateLayerEffects(layer.effects)}
    if(layer.adjustment){if(layer.isGroup||layer.imageFile||layer.text||layer.shape||manifest.version<7)throw new EditorError('INVALID_PROJECT','Adjustment layers cannot contain raster, text or shape content and require version 7.');try{nativeAdjustmentToSpec(layer.adjustment)}catch(error){throw new EditorError('UNSUPPORTED_FEATURE',error instanceof Error?error.message:'Unsupported adjustment settings.')}}
    if ((layer.text || layer.shape) && !layer.imageFile) throw new EditorError('INVALID_PROJECT', 'Editable text and shapes require a PNG fallback.')

    if(layer.text&&!textStyleSchema.safeParse(layer.text).success)warnings.push(`${layer.name}: text metadata is not editable; its original PNG fallback is preserved.`)
    if(layer.shape&&!shapeStyleSchema.safeParse(layer.shape).success)warnings.push(`${layer.name}: shape metadata is not editable; its original PNG fallback is preserved.`)
    if (manifest.version < 2 && (layer.isGroup || layer.parentID)) throw new EditorError('INVALID_PROJECT', 'Groups require format version 2 or later.')
    if (manifest.version < 3 && (layer.opacity !== 1 || layer.blendMode !== 'Normal')) throw new EditorError('INVALID_PROJECT', 'Layer appearance requires format version 3 or later.')
    if (manifest.version < 8 && layer.isGroup && layer.opacity !== 1) throw new EditorError('INVALID_PROJECT', 'Group opacity requires format version 8 or later.')
  }
  for (const layer of manifest.layers) {
    if (layer.maskSourceID) {
      const chain = new Set([layer.id]); let source: string | undefined = layer.maskSourceID
      if (layer.isGroup) throw new EditorError('INVALID_PROJECT', 'A folder cannot be a clipping endpoint.')
      while (source) {
        if (chain.has(source) || chain.size > 256) throw new EditorError('INVALID_PROJECT', 'Clipping references contain a cycle or exceed 256 links.')
        chain.add(source); const target = byId.get(source)
        if (!target || target.isGroup) throw new EditorError('INVALID_PROJECT', 'Clipping references must identify a raster layer.')
        source = target.maskSourceID
      }
    }
    const seen = new Set([layer.id])
    let parent = layer.parentID
    while (parent) {
      if (seen.has(parent) || seen.size > 64) throw new EditorError('INVALID_PROJECT', 'The group hierarchy contains a cycle or exceeds 64 levels.')
      seen.add(parent)
      const group = byId.get(parent)
      if (!group?.isGroup) throw new EditorError('INVALID_PROJECT', 'A parent reference must identify an existing group.')
      parent = group.parentID
    }
  }
  if (manifest.guides && manifest.version < 8) throw new EditorError('INVALID_PROJECT', 'Guides require format version 8.')
  if (manifest.activeLayerID && !ids.has(manifest.activeLayerID)) throw new EditorError('INVALID_PROJECT', 'The active layer is missing.')
  if (unsupported.length) throw new EditorError('UNSUPPORTED_FEATURE', 'This project uses features that this initial build cannot render. The current document has been kept.', unsupported)
  return { manifest, warnings }
}

export function descendants(manifest: Manifest, id: string): Set<string> {
  const result=new Set([id]),children=new Map<string, string[]>()
  for(const layer of manifest.layers)if(layer.parentID){const ids=children.get(layer.parentID)??[];ids.push(layer.id);children.set(layer.parentID,ids)}
  const queue=[id];for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])??[])if(!result.has(child)){result.add(child);queue.push(child)}
  return result
}
