import test from 'node:test'
import assert from 'node:assert/strict'
import {LatestDraw} from '../src/renderer/latest-draw'

type Snapshot = {sessionId: string; revision: number; draft?: string}
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no})
  return {promise, resolve, reject}
}

test('a closed document failure stays silent and the pending latest document still renders', async () => {
  let current: Snapshot = {sessionId: 'closed', revision: 8}
  const late = deferred(), drawn: string[] = [], thumbnails: string[] = [], errors: string[] = []
  const queue = new LatestDraw(() => current, async (snapshot, isCurrent) => {
    drawn.push(snapshot.sessionId)
    if (snapshot.sessionId === 'closed') await late.promise
    if (isCurrent()) thumbnails.push(snapshot.sessionId)
  }, cause => errors.push((cause as Error).message))
  const pending = queue.request()
  current = {sessionId: 'latest', revision: 0}; await queue.request()
  assert.equal(queue.active, true)
  late.reject(new Error('SESSION_EXPIRED: document was closed')); await pending
  assert.deepEqual(errors, []); assert.deepEqual(drawn, ['closed', 'latest']); assert.deepEqual(thumbnails, ['latest']); assert.equal(queue.active, false)
})

test('a late viewport success for an old revision skips its thumbnail and draws the latest revision', async () => {
  let current: Snapshot = {sessionId: 'same', revision: 1}
  const late = deferred(), thumbnails: number[] = [], draws: number[] = []
  const queue = new LatestDraw(() => current, async (snapshot, isCurrent) => {
    draws.push(snapshot.revision)
    if (snapshot.revision === 1) await late.promise
    if (isCurrent()) thumbnails.push(snapshot.revision)
  }, () => assert.fail('No rendering failure was injected'))
  const pending = queue.request(); current = {sessionId: 'same', revision: 2}; await queue.request()
  current = {sessionId: 'same', revision: 3}; await queue.request()
  late.resolve(); await pending
  assert.deepEqual(draws, [1, 3]); assert.deepEqual(thumbnails, [3])
})

test('a thumbnail already in flight cannot publish after switching documents', async () => {
  let current: Snapshot = {sessionId: 'first', revision: 1}
  const thumbnail = deferred(), requested: string[] = [], published: string[] = []
  const queue = new LatestDraw(() => current, async (snapshot, isCurrent) => {
    await Promise.resolve()
    if (!isCurrent()) return
    requested.push(snapshot.sessionId)
    if (snapshot.sessionId === 'first') await thumbnail.promise
    if (isCurrent()) published.push(snapshot.sessionId)
  }, () => assert.fail('No rendering failure was injected'))
  const pending = queue.request(); await Promise.resolve()
  assert.deepEqual(requested, ['first'])
  current = {sessionId: 'second', revision: 2}; await queue.request(); thumbnail.resolve(); await pending
  assert.deepEqual(requested, ['first', 'second']); assert.deepEqual(published, ['second'])
})

test('the active document failure remains visible and a later redraw recovers', async () => {
  let current: Snapshot = {sessionId: 'active', revision: 4}
  const errors: string[] = [], drawn: number[] = []
  const queue = new LatestDraw(() => current, async (snapshot, isCurrent) => {
    if (snapshot.revision === 4) throw new Error('SESSION_EXPIRED: active render failed')
    if (isCurrent()) drawn.push(snapshot.revision)
  }, cause => errors.push((cause as Error).message))
  await queue.request(); assert.deepEqual(errors, ['SESSION_EXPIRED: active render failed']); assert.equal(queue.active, false)
  current = {sessionId: 'active', revision: 5}; await queue.request()
  assert.deepEqual(drawn, [5]); assert.equal(errors.length, 1)
})

test('a new view epoch invalidates a render even when session and revision are unchanged', async () => {
  const current: Snapshot = {sessionId: 'same', revision: 5}
  const late = deferred(); let calls = 0, thumbnails = 0
  const queue = new LatestDraw(() => current, async (_snapshot, isCurrent) => {
    calls++
    if (calls === 1) await late.promise
    if (isCurrent()) thumbnails++
  }, () => assert.fail('No rendering failure was injected'))
  const pending = queue.request(); await queue.request(); late.resolve(); await pending
  assert.equal(calls, 2); assert.equal(thumbnails, 1)
})

test('captured identity and view object detect changes before the next redraw request', async () => {
  let current: Snapshot | undefined = {sessionId: 'same', revision: 5}
  const late = deferred(), errors: string[] = []
  const queue = new LatestDraw(() => current, async () => late.promise, cause => errors.push(String(cause)))
  const pending = queue.request(); current.revision = 6
  late.reject(new Error('obsolete revision')); await pending; assert.deepEqual(errors, [])
  current = undefined; await queue.request(); assert.equal(queue.active, false)
})
