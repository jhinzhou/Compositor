import test from 'node:test'
import assert from 'node:assert/strict'
import { RenderQueue } from '../src/main/render-queue'

test('two short previews serialize rather than rejecting the second request', async () => {
  const queue = new RenderQueue(100)
  const first = await queue.acquire('a')
  let acquired = false
  const second = queue.acquire('a').then(release => { acquired = true; return release })
  await Promise.resolve(); assert.equal(acquired, false)
  first(); const release = await second; assert.equal(acquired, true); release()
  await queue.waitIdle('a')
})
test('an idle wait follows all queued snapshots for its document without blocking another document', async () => {
  const queue = new RenderQueue(100), first = await queue.acquire('a'), second = queue.acquire('a')
  let idle = false
  const waiting = queue.waitIdle('a').then(() => {idle = true})
  await queue.waitIdle('b'); assert.equal(idle, false)
  first(); const release = await second; await Promise.resolve(); assert.equal(idle, false)
  release(); await waiting; assert.equal(idle, true)
})
test('long rendering bounds queue and document waits and removes timed-out tickets', async () => {
  const queue = new RenderQueue(10), first = await queue.acquire('a')
  await Promise.all([
    assert.rejects(queue.acquire('b'), error => (error as {code?: string}).code === 'DOCUMENT_BUSY'),
    assert.rejects(queue.waitIdle('a'), error => (error as {code?: string}).code === 'DOCUMENT_BUSY')
  ])
  first()
  const release = await queue.acquire('b'); release(); await queue.waitIdle('b')
})
test('releasing a render twice cannot release the following active render', async () => {
  const queue = new RenderQueue(100), first = await queue.acquire('a'), next = queue.acquire('b')
  first(); const second = await next; first()
  let idle = false; const waiting = queue.waitIdle('b').then(() => {idle = true})
  await Promise.resolve(); assert.equal(idle, false)
  second(); await waiting; assert.equal(idle, true)
})
