import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/core/editor'
import { actionSchema } from '../src/shared/contracts'
const selection = { inverted: true, shapes: [{ kind: 'rectangle', operation: 'replace', feather: 1.2, bounds: [2, 3, 6, 4] }] }
function edit(editor: Editor, action: unknown) { return editor.apply({ ...editor.identity(), action }) }
function prepare() { const editor = new Editor(); editor.create(16, 12); edit(editor, { type: 'selection.set', selection }); return editor }
test('Reselect preserves fractional and inverted coverage, source assets, and one history transaction', () => {
  const editor = prepare(), before = editor.state()
  edit(editor, { type: 'selection.set', selection: null })
  assert.equal(editor.state().canReselect, true)
  const request = { ...editor.identity(), action: { type: 'selection.reselect' } }, result = editor.apply(request)
  assert.deepEqual(editor.apply(request), result)
  assert.deepEqual(editor.state().selection, before.selection)
  assert.deepEqual(editor.state().assets, before.assets)
  assert.equal(editor.state().canReselect, false)
  editor.history({ ...editor.identity(), direction: 'undo' })
  assert.equal(editor.state().selection, null)
  assert.equal(editor.state().canReselect, true)
  editor.history({ ...editor.identity(), direction: 'redo' })
  assert.deepEqual(editor.state().selection, before.selection)
})
test('Reselect is atomic when unavailable and does not leak into a new document', () => {
  const editor = prepare(), before = editor.state()
  assert.throws(() => edit(editor, { type: 'selection.reselect' }), /Deselect/)
  assert.deepEqual(editor.state(), before)
  edit(editor, { type: 'selection.set', selection: null }); editor.create(16, 12)
  assert.equal(editor.state().canReselect, false)
  assert.throws(() => edit(editor, { type: 'selection.reselect' }), /Deselect/)
})
test('atomic batches support deselect then reselect without rewriting pixels', () => {
  const editor = prepare(), before = editor.state()
  const result = editor.applyBatch({ ...editor.identity(), actions: [{ type: 'selection.set', selection: null }, { type: 'selection.reselect' }] })
  assert.equal(result.status, 'no_change')
  assert.deepEqual(editor.state(), before)
  assert.doesNotThrow(() => actionSchema.parse({ type: 'selection.reselect' }))
})
test('canvas geometry changes invalidate cached selection coordinates', () => {
  const editor = prepare(); edit(editor, { type: 'selection.set', selection: null })
  edit(editor, { type: 'document.rotate', clockwise: true })
  assert.equal(editor.state().canReselect, false)
  assert.throws(() => edit(editor, { type: 'selection.reselect' }), /Deselect/)
})
test('Reveal All and Reveal Selection choose distinct mask sources without breaking legacy callers', () => {
  for (const useSelection of [false, true, undefined]) {
    const editor = prepare(); edit(editor, { type: 'layer.add_blank', name: 'Layer' })
    const layerId = editor.state().manifest.layers[0].id
    edit(editor, { type: 'layer.mask', layerId, operation: 'reveal', ...(useSelection === undefined ? {} : { useSelection }) })
    const snapshot = editor.snapshot(), asset = snapshot.assets.get(snapshot.manifest.layers[0].maskFile!)!
    assert.equal(asset.width, useSelection === false ? 1 : 16)
    if (useSelection === false) assert.equal(asset.bytes.length > 0, true)
    else assert.equal(editor.state().canReselect, true)
  }
})

test('undo and redo of same-size canvas flips invalidate later cached coordinates',()=>{
 const editor=prepare();edit(editor,{type:'document.flip',axis:'horizontal'});
 edit(editor,{type:'selection.set',selection});
 edit(editor,{type:'selection.set',selection:null});assert.equal(editor.state().canReselect,true);
 editor.history({...editor.identity(),direction:'undo'});
 editor.history({...editor.identity(),direction:'undo'});
 editor.history({...editor.identity(),direction:'undo'});
 assert.equal(editor.state().canReselect,false);
 editor.history({...editor.identity(),direction:'redo'});
 assert.equal(editor.state().canReselect,false);
})
