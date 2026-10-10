import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Editor } from '../src/core/editor'
import { EditorError } from '../src/shared/contracts'
import { layerSourcePoint } from '../src/renderer/hit-test'
import { folderActions } from '../src/core/grouping'
const code = (expected: string) => (error: unknown) => error instanceof EditorError && error.code === expected
async function loaded() { const editor = new Editor(); await editor.open(resolve('fixtures/demo.comp')); return editor }

test('batch creation references commit once and undo/redo restore the complete batch', async () => {
  const editor = await loaded(), original = editor.state().manifest, id = original.layers[0].id
  const request = { ...editor.identity(), actions: [
    { type: 'group.add', name: 'Decorations', clientRef: 'group' },
    { type: 'layer.duplicate', layerId: id, clientRef: 'copy' },
    { type: 'layer.set_parent', layerId: { ref: 'copy' }, parentId: { ref: 'group' } },
    { type: 'layer.set_opacity', layerId: { ref: 'copy' }, opacity: .35 }
  ] }
  const result = editor.applyBatch(request, 'agent')
  assert.equal(result.revision, 1)
  assert.equal(editor.state().manifest.layers.length, 7)
  const copy = editor.state().manifest.layers.find(layer => layer.id === result.createdIds?.copy)!
  assert.equal(copy.parentID, result.createdIds?.group); assert.equal(copy.opacity, .35)
  assert.deepEqual(editor.applyBatch(request, 'agent'), result)
  assert.equal(editor.state().revision, 1)
  editor.history({ ...editor.identity(), direction: 'undo', transactionId: result.transactionId })
  assert.deepEqual(editor.state().manifest, original)
  editor.history({ ...editor.identity(), direction: 'redo' })
  assert.equal(editor.state().manifest.layers.length, 7)
})

test('failed later batch action leaves no partial manifest, history or assets', async () => {
  const editor = await loaded(), original = editor.state(), retained = editor.retainedAssets()
  assert.throws(() => editor.applyBatch({ ...editor.identity(), actions: [
    { type: 'layer.duplicate', layerId: original.manifest.layers[0].id, clientRef: 'copy' },
    { type: 'layer.rename', layerId: randomUUID(), name: 'Missing layer' }
  ] }), code('LAYER_NOT_FOUND'))
  assert.deepEqual(editor.state(), original); assert.deepEqual(editor.retainedAssets(), retained)
  assert.throws(() => editor.applyBatch({ ...editor.identity(), actions: [
    { type: 'layer.rename', layerId: { ref: 'forward' }, name: 'Never created' }
  ] }), code('INVALID_ARGUMENT'))
})

test('multi-layer moves preserve order and reject cycles without changes', async () => {
  const editor = await loaded(), ids = editor.state().manifest.layers.map(layer => layer.id)
  editor.applyBatch({ ...editor.identity(), actions: [{ type: 'group.add', name: 'Group', clientRef: 'group' }, { type: 'layer.move', layerIds: [ids[1], ids[2]], parentId: { ref: 'group' }, beforeLayerId: null }] })
  const state = editor.state(), group = state.manifest.layers.find(layer => layer.isGroup)!
  assert.deepEqual(state.manifest.layers.filter(layer => layer.parentID === group.id).map(layer => layer.id), [ids[1], ids[2]])
  assert.throws(() => editor.apply({ ...editor.identity(), action: { type: 'layer.move', layerIds: [group.id], parentId: group.id, beforeLayerId: null } }), code('INVALID_PROJECT'))
  assert.deepEqual(editor.state(), state)
  editor.apply({ ...editor.identity(), action: { type: 'layer.move', layerIds: [group.id, ids[1]], parentId: null, beforeLayerId: ids[0] } })
  assert.equal(editor.state().manifest.layers[0].id, group.id)
  assert.equal(editor.state().manifest.layers.find(layer => layer.id === ids[1])?.parentID, group.id)
})

test('grouping inserts at the highest selected branch; one selected layer creates an empty adjacent folder', async () => {
  const editor = await loaded(), original = editor.state().manifest
  const selected = [original.layers[1].id, original.layers[3].id]
  editor.applyBatch({ ...editor.identity(), actions: folderActions(original, selected) })
  const manifest = editor.state().manifest, folder = manifest.layers.find(layer => layer.isGroup)!
  assert.deepEqual(manifest.layers.filter(layer => layer.parentID === folder.id).map(layer => layer.id), selected)
  assert.ok(manifest.layers.indexOf(folder) < manifest.layers.findIndex(layer => layer.id === original.layers[4].id))
  editor.history({ ...editor.identity(), direction: 'undo' })
  editor.applyBatch({ ...editor.identity(), actions: folderActions(editor.state().manifest, [original.layers[1].id]) })
  assert.equal(editor.state().manifest.layers[1].parentID, undefined)
  assert.equal(editor.state().manifest.layers[2].isGroup, true)
})

test('grouping nested selections uses hierarchy order and their nearest common folder', async () => {
  const editor = await loaded(), ids = editor.state().manifest.layers.map(layer => layer.id)
  const made = editor.applyBatch({ ...editor.identity(), actions: [
    { type: 'group.add', name: 'Outer', clientRef: 'outer' },
    { type: 'group.add', name: 'Lower branch', clientRef: 'lower' },
    { type: 'group.add', name: 'Higher branch', clientRef: 'higher' },
    { type: 'layer.move', layerIds: [{ ref: 'lower' }, { ref: 'higher' }], parentId: { ref: 'outer' }, beforeLayerId: null },
    { type: 'layer.set_parent', layerId: ids[3], parentId: { ref: 'lower' } },
    { type: 'layer.set_parent', layerId: ids[1], parentId: { ref: 'higher' } }
  ] })
  const before = editor.state().manifest
  const grouped = editor.applyBatch({ ...editor.identity(), actions: folderActions(before, [ids[1], ids[3]]) })
  const folderId = grouped.createdIds!.folder, manifest = editor.state().manifest
  assert.equal(manifest.layers.find(layer => layer.id === folderId)?.parentID, made.createdIds!.outer)
  assert.deepEqual(manifest.layers.filter(layer => layer.parentID === folderId).map(layer => layer.id), [ids[3], ids[1]])
  editor.history({ ...editor.identity(), direction: 'undo' })
  assert.deepEqual(editor.state().manifest, before)
})

test('pixel hit coordinates invert rotation, scale and flip with strict image bounds', async () => {
  const editor = await loaded(), layer = editor.state().manifest.layers[0]
  layer.transform = { origin: [10, 20], size: [200, 100], rotation: 0, flipX: false, flipY: false, sampling: 'Nearest' }
  assert.deepEqual(layerSourcePoint(layer, 60, 45, 100, 50), [25, 12])
  layer.transform.flipX = true
  assert.deepEqual(layerSourcePoint(layer, 60, 45, 100, 50), [75, 12])
  layer.transform.rotation = 90
  assert.deepEqual(layerSourcePoint(layer, 110, 120, 100, 50), [25, 25])
  assert.equal(layerSourcePoint(layer, -200, 20, 100, 50), undefined)
})

test('Agent tasks reject writes after cancellation and roll back contiguous task history', async () => {
  const editor = await loaded(), original = editor.state().manifest
  const begin = { ...editor.identity(), label: 'Adjust Sun' }, task = editor.beginTask(begin)
  assert.equal(editor.beginTask(begin).taskId, task.taskId)
  const id = original.layers[1].id
  editor.apply({ ...editor.identity(), taskId: task.taskId, action: { type: 'layer.set_opacity', layerId: id, opacity: .4 } }, 'agent')
  editor.applyBatch({ ...editor.identity(), taskId: task.taskId, actions: [{ type: 'layer.rename', layerId: id, name: 'Agent Sun' }] }, 'agent')
  assert.equal(editor.tasks.get(task.taskId).transactions.length, 2)
  const cancel = { sessionId: task.sessionId, documentId: task.documentId, taskId: task.taskId, idempotencyKey: randomUUID() }
  editor.cancelTask(cancel)
  assert.throws(() => editor.apply({ ...editor.identity(), taskId: task.taskId, action: { type: 'layer.rename', layerId: id, name: 'Too late' } }, 'agent'), code('TASK_STOPPED'))
  const undo = editor.undoTask({ ...editor.identity(), taskId: task.taskId })
  assert.equal(undo.revision, 3)
  assert.deepEqual(editor.state().manifest, original)
  editor.history({ ...editor.identity(), direction: 'redo' })
  assert.equal(editor.state().manifest.layers[1].opacity, .4)
  editor.history({ ...editor.identity(), direction: 'redo' })
  assert.equal(editor.state().manifest.layers[1].name, 'Agent Sun')
})

test('task rollback never crosses later manual edits; invalid task IDs cannot half-commit', async () => {
  const editor = await loaded(), id = editor.state().manifest.layers[1].id
  const task = editor.beginTask({ ...editor.identity(), label: 'Agent change' })
  editor.apply({ ...editor.identity(), taskId: task.taskId, action: { type: 'layer.set_opacity', layerId: id, opacity: .2 } }, 'agent')
  editor.apply({ ...editor.identity(), action: { type: 'layer.rename', layerId: id, name: 'Human name' } })
  const before = editor.state()
  assert.throws(() => editor.undoTask({ ...editor.identity(), taskId: task.taskId }), code('UNDO_CONFLICT'))
  assert.deepEqual(editor.state(), before)
  assert.throws(() => editor.apply({ ...editor.identity(), taskId: randomUUID(), action: { type: 'layer.rename', layerId: id, name: 'Invalid task' } }), code('TASK_NOT_FOUND'))
  assert.deepEqual(editor.state(), before)
})
