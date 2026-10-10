import type { BatchMutation, Manifest } from '../shared/contracts'
import { hierarchyOrder } from './manifest'

// Match the native folder insertion rule: place the wrapper at the highest
// selected branch in the nearest shared parent, keeping its children ordered.
export function folderActions(manifest: Manifest, selectedIds: string[]): BatchMutation['actions'] {
  const byId = new Map(manifest.layers.map(layer => [layer.id, layer])), selected = new Set(selectedIds)
  const ancestors = (id: string): (string | null)[] => {
    const result: (string | null)[] = []
    let parent = byId.get(id)?.parentID
    while (parent) { result.push(parent); parent = byId.get(parent)?.parentID }
    return [...result, null]
  }
  const roots = hierarchyOrder(manifest).filter(layer => selected.has(layer.id) && !ancestors(layer.id).some(id => id && selected.has(id)))
  const names = new Set(manifest.layers.map(layer => layer.name))
  let number = 1
  while (names.has(`Folder ${number}`)) number++
  const actions: BatchMutation['actions'] = [{ type: 'group.add', name: `Folder ${number}`, clientRef: 'folder' }]
  if (!roots.length) return actions
  const groupSelection = selected.size > 1
  const parent = groupSelection
    ? ancestors(roots[0].id).find(candidate => roots.every(layer => ancestors(layer.id).includes(candidate))) ?? null
    : roots[0].isGroup ? roots[0].id : roots[0].parentID ?? null
  const branches = roots.map(layer => {
    let id = layer.id
    while (byId.get(id)?.parentID && byId.get(id)!.parentID !== parent) id = byId.get(id)!.parentID!
    return id
  })
  const siblings = manifest.layers.filter(layer => (layer.parentID ?? null) === parent)
  const highest = Math.max(...branches.map(id => siblings.findIndex(layer => layer.id === id)))
  actions.push({ type: 'layer.move', layerIds: [{ ref: 'folder' }], parentId: parent, beforeLayerId: siblings[highest + 1]?.id ?? null })
  if (groupSelection) actions.push({ type: 'layer.move', layerIds: roots.map(layer => layer.id), parentId: { ref: 'folder' }, beforeLayerId: null })
  return actions
}
