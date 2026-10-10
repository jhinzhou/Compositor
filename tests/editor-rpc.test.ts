import assert from 'node:assert/strict'
import test from 'node:test'
import { EditorRpc } from '../src/main/editor-rpc'

test('utility exit resolves all outstanding saves and future calls immediately', async () => {
  const messages: { id: string; method: string }[] = []
  const rpc = new EditorRpc(message => messages.push(message))
  const state = rpc.request('state'), save = rpc.request('save')
  rpc.stop()
  for (const result of await Promise.all([state, save, rpc.request('save')])) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'ENGINE_UNAVAILABLE')
  }
  assert.equal(messages.length, 2)
})

test('destroyed utility post does not throw or leave the save waiting for timeout', async () => {
  const rpc = new EditorRpc(() => { throw new Error('Object has been destroyed') })
  const result = await rpc.request('save')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'ENGINE_UNAVAILABLE')
  const next = await rpc.request('state')
  assert.equal(next.ok, false)
})

test('normal replies clear their deadlines and late replies cannot satisfy another request', async () => {
  const messages: { id: string; method: string }[] = []
  const rpc = new EditorRpc(message => messages.push(message))
  const first = rpc.request<number>('state')
  rpc.receive(messages[0].id, { ok: true, value: 7 })
  assert.deepEqual(await first, { ok: true, value: 7 })
  const expired = rpc.request('state', undefined, 5)
  const result = await expired
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'TIMEOUT')
  const last = rpc.request<number>('state')
  rpc.receive(messages[1].id, { ok: true, value: 99 })
  rpc.receive(messages[2].id, { ok: true, value: 8 })
  assert.deepEqual(await last, { ok: true, value: 8 })
  rpc.stop()
})
