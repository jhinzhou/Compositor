import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Editor } from '../src/core/editor'
import type { Layer, Manifest } from '../src/shared/contracts'
import { altDragActions, altDragPastePlan, captureLayerClipboard, duplicateSelectionActions, mergeSelectionPlan, pasteLayerClipboard, selectedRoots, sharedTransformActions, transformAround, transformBounds } from '../src/core/layer-operations'

function layer(name: string, x = 0, y = 0, width = 10, height = 10, parentID?: string, isGroup = false): Layer {
  const id = randomUUID().toUpperCase()
  return { id, name, parentID, isGroup, isVisible: true, opacity: 1, blendMode: 'Normal', transform: { origin: [x, y], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } }
}
function manifest(layers: Layer[]): Manifest {
  return { format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: randomUUID(), width: 200, height: 100, resolution: 72, layers }
}
function close(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`) }

test('root selection deduplicates descendants and errors on stale IDs', () => {
  const group = layer('Group', 0, 0, 10, 10, undefined, true), nested = layer('Nested', 0, 0, 10, 10, group.id, true), child = layer('Child', 0, 0, 10, 10, nested.id)
  assert.deepEqual(selectedRoots(manifest([group, nested, child]), [child.id, nested.id, group.id]).map(item => item.id), [group.id])
  assert.throws(() => selectedRoots(manifest([child]), ['missing']), /no longer exists/)
})

test('shared rotation, scaling and reflection preserve relative geometry and rotated bounds', () => {
  const a = layer('A', 0, 0), b = layer('B', 20, 0), doc = manifest([a, b])
  const rotated = sharedTransformActions(doc, [a.id, b.id], { kind: 'rotate', degrees: 90 })
  for (const action of rotated) { assert.equal(action.type, 'layer.set_transform'); if (action.type !== 'layer.set_transform') continue; close(action.transform.origin[0], 10); close(action.transform.rotation, 90) }
  if (rotated[0].type === 'layer.set_transform' && rotated[1].type === 'layer.set_transform') { close(rotated[0].transform.origin[1], -10); close(rotated[1].transform.origin[1], 10) }
  const scaled = sharedTransformActions(doc, [a.id, b.id], { kind: 'scale', factor: 2 })
  if (scaled[0].type === 'layer.set_transform') assert.deepEqual(scaled[0].transform.size, [20, 20])
  const source = { ...a.transform, rotation: 30, flipY: true }, reflected = transformAround(source, { kind: 'flip', axis: 'horizontal' }, [15, 5])
  assert.equal(reflected.rotation, -30); assert.equal(reflected.flipX, true); assert.equal(reflected.flipY, true); assert.deepEqual(reflected.origin, [20, 0])
  const restored = transformAround(reflected, { kind: 'flip', axis: 'horizontal' }, [15, 5])
  assert.deepEqual(restored, source)
  const bounds = transformBounds({ ...a.transform, size: [20, 10], rotation: 90 }); close(bounds.width, 10); close(bounds.height, 20)
  assert.throws(() => sharedTransformActions(doc, [a.id], { kind: 'scale', factor: 0 }), /positive finite/)
})

test('folder transforms affect leaf descendants exactly once', () => {
  const group = layer('Folder', 0, 0, 100, 100, undefined, true), a = layer('A', 0, 0, 10, 10, group.id), b = layer('B', 20, 0, 10, 10, group.id)
  const actions = sharedTransformActions(manifest([group, a, b]), [group.id, a.id], { kind: 'translate', dx: 3, dy: -4 })
  assert.equal(actions.length, 2)
  assert.deepEqual(actions.map(action => action.type === 'layer.set_transform' ? action.transform.origin : []), [[3, -4], [23, -4]])
})

test('common transforms include masked folders so their linked mask moves with the selected tree',()=>{
 const group=layer('Masked folder',0,0,100,100,undefined,true),a=layer('A',0,0,10,10,group.id),b=layer('B',20,0,10,10,group.id)
 group.maskFile=`${group.id}.mask.png`;const actions=sharedTransformActions(manifest([group,a,b]),[group.id,a.id],{kind:'translate',dx:3,dy:-4})
 assert.deepEqual(actions.map(action=>action.layerId),[group.id,a.id,b.id]);assert.deepEqual(actions.map(action=>action.transform.origin),[[3,-4],[3,-4],[23,-4]])
})

test('clipboard remaps whole folders and raster references without mutating the source', () => {
  const group = layer('Folder', 0, 0, 100, 100, undefined, true), a = layer('A', 10, 20, 10, 10, group.id), b = layer('B', 20, 30, 10, 10, group.id)
  a.imageFile = `${a.id}.png`; b.maskSourceID = a.id
  const doc = manifest([group, a, b]), original = structuredClone(doc), clipboard = captureLayerClipboard(doc, [group.id, a.id], 'source')
  const pasted = pasteLayerClipboard(clipboard, manifest([]))
  assert.equal(pasted.layers.length, 3); assert.equal(pasted.roots.length, 1)
  assert.equal(pasted.layers[1].parentID, pasted.layers[0].id); assert.equal(pasted.layers[2].maskSourceID, pasted.layers[1].id)
  assert.equal(pasted.assetCopies[0].sourceFile, a.imageFile); assert.equal(pasted.layers[1].imageFile, pasted.assetCopies[0].destinationFile)
  assert.deepEqual(pasted.layers[0].transform.origin, [50, 0])
  assert.deepEqual(doc, original)
  const same = pasteLayerClipboard(clipboard, doc, { center: false }); assert.deepEqual(same.layers[1].transform.origin, a.transform.origin)
  assert.throws(() => pasteLayerClipboard(clipboard, manifest([]), { newId: () => a.id }), /unique/)
})

test('cross-document multi-copy centers the union while preserving relative offsets', () => {
  const a = layer('A', 10, 5), b = layer('B', 40, 15), source = manifest([a, b]), destination = manifest([])
  const pasted = pasteLayerClipboard(captureLayerClipboard(source, [b.id, a.id]), destination)
  assert.deepEqual(pasted.layers.map(item => item.transform.origin), [[80, 40], [110, 50]])
  const point = pasteLayerClipboard(captureLayerClipboard(source, [a.id, b.id]), destination, { point: [20, 20] })
  assert.deepEqual(point.layers.map(item => item.transform.origin), [[0, 10], [30, 20]])
  b.maskSourceID = randomUUID(); assert.equal(pasteLayerClipboard(captureLayerClipboard(manifest([b]), [b.id]),destination).layers[0].maskSourceID,undefined)
})

test('multi-duplicate stacks copies together above the topmost original as one undo step', async () => {
  const editor = new Editor(); await editor.open(`${process.cwd()}/fixtures/demo.comp`)
  const before = editor.state().manifest, roots = before.layers.filter(item => !item.parentID).slice(0, 2)
  const result = editor.applyBatch({ ...editor.identity(), actions: duplicateSelectionActions(before, roots.map(item => item.id)), label: 'Duplicate selected layers' })
  const after = editor.state().manifest, copied = roots.map((_, index) => result.createdIds![`copy${index}`])
  const topIndex = after.layers.findIndex(item => item.id === roots[1].id)
  assert.deepEqual(after.layers.slice(topIndex + 1, topIndex + 3).map(item => item.id), copied)
  editor.history({ ...editor.identity(), direction: 'undo' }); assert.deepEqual(editor.state().manifest.layers, before.layers)
})

test('Alt drag builds duplicate and translated-reference actions; merge follows native selected/down placement', () => {
  const a = layer('A'), b = layer('B', 20), c = layer('C', 40), doc = manifest([a, b, c])
  const actions = altDragActions(doc, [a.id], [12, -2])
  assert.equal(actions.length, 2)
  assert.deepEqual(actions[1].type === 'layer.set_transform' && actions[1].transform.origin, [12, -2])
  const plan = mergeSelectionPlan(doc, [b.id], 'down')
  assert.deepEqual(plan.roots, [a.id, b.id]); assert.equal(plan.insertionBeforeId, c.id)
  const separated = mergeSelectionPlan(doc, [a.id, c.id]); assert.deepEqual(separated.roots, [a.id, c.id]); assert.equal(separated.anchorId, c.id)
  assert.throws(() => mergeSelectionPlan(doc, [a.id], 'down'), /requires a pixel layer/)
})

test('Alt drag of a folder moves its complete copied tree and remaps masks', () => {
  const group = layer('Folder', 0, 0, 100, 100, undefined, true), child = layer('Child', 10, 20, 10, 10, group.id)
  child.maskFile = `${child.id}.mask.png`; child.maskPlacement = { ...child.transform, origin: [3, 4] }
  const plan = altDragPastePlan(manifest([group, child]), [group.id, child.id], [12, 8])
  assert.equal(plan.layers[0].name, 'Folder copy'); assert.equal(plan.layers[1].name, 'Child')
  assert.deepEqual(plan.layers[1].transform.origin, [22, 28]); assert.equal(plan.layers[1].parentID, plan.layers[0].id)
  assert.equal(plan.layers[1].maskFile, `${plan.layers[1].id}.mask.png`)
  assert.deepEqual((plan.layers[1].maskPlacement as { origin: number[] }).origin, [15, 12])
})

test('merge detaches external groups and clipping sources; group merge rejects an empty folder', () => {
  const group = layer('Folder', 0, 0, 100, 100, undefined, true), child = layer('Child', 10, 20, 10, 10, group.id), external = layer('External')
  child.maskSourceID = external.id
  const plan = mergeSelectionPlan(manifest([group, child, external]), [child.id, external.id])
  assert.equal(plan.renderLayers.find(item => item.id === child.id)?.parentID, undefined)
  const grouped = mergeSelectionPlan(manifest([group, child, external]), [group.id], 'group')
  assert.equal(grouped.renderLayers.find(item => item.id === child.id)?.maskSourceID, undefined)
  assert.throws(() => mergeSelectionPlan(manifest([group]), [group.id], 'group'), /empty folder/)
})
