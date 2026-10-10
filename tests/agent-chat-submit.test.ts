import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { nextTick } from 'vue'

type Callbacks = { configureModel?: (config: unknown) => Promise<boolean>; sendMessage?: (text: string) => Promise<boolean> }
function chat(callbacks: Callbacks = {}) {
  const filename = 'src/renderer/AgentChat.vue'
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = transformSync(compileScript(descriptor, { id: 'agent-submit' }).content, { loader: 'ts', format: 'cjs' }).code
  const module = { exports: {} as any }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, createRequire(import.meta.url))
  const emitted: { event: string; value: unknown }[] = []
  const setup = module.exports.default.setup({ conversation: [], config: undefined, configured: true, status: 'idle', tools: [], streamingText: '', ...callbacks }, { expose() {}, emit: (event: string, value: unknown) => emitted.push({ event, value }) })
  setup.endpoint.value = 'https://model.test/v1'
  setup.model.value = 'test-model'
  setup.apiKey.value = 'mock-secret'
  setup.showSettings.value = true
  return { setup, emitted }
}

test('configuration failures preserve settings and key for retry without exposing a thrown key', async () => {
  for (const configureModel of [async () => false, async () => { throw new Error('mock-secret must never render') }]) {
    const { setup, emitted } = chat({ configureModel })
    assert.equal(await setup.configure(), false)
    assert.equal(setup.showSettings.value, true)
    assert.equal(setup.apiKey.value, 'mock-secret')
    assert.equal(setup.model.value, 'test-model')
    assert.ok(setup.settingsError.value)
    assert.ok(!setup.settingsError.value.includes('mock-secret'))
    assert.equal(setup.settingsBusy.value, false)
    assert.deepEqual(emitted, [])
  }
})

test('pending configuration prevents duplicate submits and clears key only after success', async () => {
  let accept!: (value: boolean) => void, calls = 0
  const { setup } = chat({ configureModel: async () => { calls++; return await new Promise<boolean>(resolve => { accept = resolve }) } })
  setup.clearKey.value = true
  const pending = setup.configure()
  assert.equal(setup.settingsBusy.value, true)
  assert.equal(setup.apiKey.value, 'mock-secret')
  assert.equal(await setup.configure(), false)
  setup.cancelSettings()
  assert.equal(setup.showSettings.value, true)
  assert.equal(calls, 1)
  accept(true)
  assert.equal(await pending, true)
  assert.equal(setup.apiKey.value, '')
  assert.equal(setup.clearKey.value, false)
  assert.equal(setup.showSettings.value, false)
  assert.equal(setup.settingsBusy.value, false)
})

test('send failures preserve the complete draft and support retry', async () => {
  let succeed = false
  const { setup } = chat({ sendMessage: async () => succeed })
  setup.input.value = '  请帮我调亮这张图\n保留图层  '
  assert.equal(await setup.send(), false)
  assert.equal(setup.input.value, '  请帮我调亮这张图\n保留图层  ')
  assert.ok(setup.sendError.value)
  succeed = true
  assert.equal(await setup.send(), true)
  assert.equal(setup.input.value, '')
  assert.equal(setup.sendError.value, '')
  await nextTick()
})

test('pending send blocks repeats and rejected send retains text without reflecting exception secrets', async () => {
  let reject!: (error: Error) => void, calls = 0
  const { setup } = chat({ sendMessage: async () => { calls++; return await new Promise<boolean>((_, failure) => { reject = failure }) } })
  setup.input.value = 'User draft'
  const pending = setup.send()
  assert.equal(setup.sending.value, true)
  assert.equal(await setup.send(), false)
  assert.equal(calls, 1)
  reject(new Error('mock-secret server error'))
  assert.equal(await pending, false)
  assert.equal(setup.input.value, 'User draft')
  assert.equal(setup.sending.value, false)
  assert.ok(!setup.sendError.value.includes('mock-secret'))
})

test('legacy event-based consumers keep successful configure and send behavior', async () => {
  const { setup, emitted } = chat()
  assert.equal(await setup.configure(), true)
  setup.input.value = 'Legacy message'
  assert.equal(await setup.send(), true)
  assert.deepEqual(emitted.map(entry => entry.event), ['configure', 'send'])
  assert.equal(setup.input.value, '')
  await nextTick()
})
