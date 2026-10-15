import test from 'node:test'
import assert from 'node:assert/strict'
import { PointerFinish } from '../src/renderer/pointer-finish'
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve } }
test('a delayed ready and lease release retain one gesture owner through all cleanup', async () => {
  const finish = new PointerFinish(), ready = deferred(), released = deferred(), events: string[] = []
  const first = finish.run(async () => { events.push('snapshot'); await ready.promise; events.push('commit'); await released.promise; events.push('cleanup') })
  assert.equal(finish.active, true)
  const duplicate = finish.run(async () => { events.push('wrong owner') })
  assert.equal(duplicate, first)
  let switched = false; const switchTool = finish.wait().then(() => { switched = true })
  await Promise.resolve(); assert.deepEqual(events, ['snapshot']); assert.equal(switched, false)
  ready.resolve(); await Promise.resolve(); assert.deepEqual(events, ['snapshot', 'commit']); assert.equal(finish.active, true)
  released.resolve(); await first; await switchTool
  assert.deepEqual(events, ['snapshot', 'commit', 'cleanup']); assert.equal(switched, true); assert.equal(finish.active, false)
})
test('Escape during delayed readiness cancels the existing completion instead of committing or resurrecting a crop', async () => {
  const finish = new PointerFinish(), ready = deferred(); let commits = 0, cleanups = 0
  const pending = finish.run(async canceled => { await ready.promise; if (!canceled()) commits++; cleanups++ })
  assert.equal(finish.run(async () => { throw Error('duplicate') }, true), pending)
  ready.resolve(); await pending; assert.equal(commits, 0); assert.equal(cleanups, 1)
})
test('failure releases the completion guard and allows the next gesture', async () => {
  const finish = new PointerFinish()
  await assert.rejects(finish.run(async () => { throw Error('failed interaction') }), /failed interaction/)
  assert.equal(finish.active, false); let count = 0
  await finish.run(async () => { count++ }); assert.equal(count, 1)
})
