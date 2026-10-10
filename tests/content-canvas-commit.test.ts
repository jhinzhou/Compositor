import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import * as Vue from 'vue'
import * as raster from '../src/renderer/content-raster'

// Execute the real SFC setup with rasterization isolated; no default Electron profile or user canvas.
function overlay(commitEdit?: (edit: unknown) => Promise<boolean>, render = async () => ({ bytes: new Uint8Array([1]), width: 200, height: 80 })) {
  const filename = resolve('src/renderer/ContentCanvasOverlay.vue')
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = transformSync(compileScript(descriptor, { id: 'commit-test' }).content, { loader: 'ts', format: 'cjs' }).code
  const localRequire = createRequire(filename)
  const module = { exports: {} as any }
  const require = (specifier: string) => specifier === 'vue' ? { ...Vue, onBeforeUnmount: () => {} }
    : specifier === './content-raster' ? { ...raster, renderTextPNG: render, renderShapePNG: render } : localRequire(specifier)
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require)
  const emitted: { event: string; value: unknown }[] = []
  let exposed: any
  const props = { zoom: 1, foreground: '#000000', commitEdit, textShortcutOverrides:{} as Record<string,string>, shortcutPlatform:'mac' }
  const setup = module.exports.default.setup(props, { expose: (value: unknown) => { exposed = value }, emit: (event: string, value: unknown) => { emitted.push({ event, value }) } })
  const previousWindow = globalThis.window
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } })
  const layer = { id: 'existing-text', name: 'User text', text: { ...raster.defaultTextStyle(), content: '保留我的修改', boxSize: [200, 80] }, transform: { origin: [10, 20], size: [200, 80], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } }
  exposed.start({ pointerId: 1, preventDefault() {} }, 'text', () => [10, 20], { sessionId: 'session', documentId: 'document', expectedRevision: 1, idempotencyKey: 'edit' }, layer)
  const restore = () => { exposed.cancel(); Object.assign(globalThis, { window: previousWindow }) }
  return { api: exposed, setup, emitted, restore, props }
}

test('failed content mutation preserves canvas draft and can be retried', async () => {
  let succeed = false
  const instance = overlay(async () => succeed)
  try {
    assert.equal(await instance.api.commit(), false)
    assert.equal(instance.setup.text.value.content, '保留我的修改')
    assert.ok(instance.setup.box.value)
    assert.equal(instance.setup.editing.value, true)
    assert.equal(instance.emitted.filter(entry => entry.event === 'close').length, 1) // Initial start clears the prior draft.
    succeed = true
    assert.equal(await instance.api.commit(), true)
    assert.equal(instance.setup.box.value, undefined)
    assert.equal(instance.emitted.filter(entry => entry.event === 'update').length, 0)
    assert.equal(instance.emitted.filter(entry => entry.event === 'close').length, 2)
  } finally { instance.restore() }
})

test('pending mutation keeps draft visible and rejects duplicate submissions', async () => {
  let accept!: (value: boolean) => void
  let calls = 0
  const instance = overlay(async () => { calls++; return await new Promise<boolean>(resolve => { accept = resolve }) })
  try {
    const pending = instance.api.commit()
    await Vue.nextTick()
    assert.equal(instance.setup.busy.value, true)
    assert.ok(instance.setup.box.value)
    assert.equal(await instance.api.commit(), false)
    assert.equal(calls, 1)
    accept(true)
    assert.equal(await pending, true)
    assert.equal(instance.setup.busy.value, false)
  } finally { instance.restore() }
})

test('rasterization or parent exceptions retain draft and report error', async () => {
  for (const create of [() => overlay(async () => { throw new Error('Mutation failed') }), () => overlay(async () => true, async () => { throw new Error('Raster failed') })]) {
    const instance = create()
    try {
      assert.equal(await instance.api.commit(), false)
      assert.ok(instance.setup.box.value)
      assert.equal(instance.setup.busy.value, false)
      assert.equal(instance.emitted.filter(entry => entry.event === 'error').length, 1)
    } finally { instance.restore() }
  }
})

test('legacy event-based consumers retain content update behavior', async () => {
  const instance = overlay()
  try {
    assert.equal(await instance.api.commit(), true)
    assert.equal(instance.emitted.filter(entry => entry.event === 'update').length, 1)
    assert.equal(instance.setup.box.value, undefined)
    assert.equal(await instance.api.commit(), true)
  } finally { instance.restore() }
})

test('Chinese composition preserves the editable DOM and candidate keys until composition ends', async () => {
  const instance = overlay(async () => true)
  const previousDocument = globalThis.document
  let replacements = 0, prevented = 0
  const root = { innerText: '中文输入中', focus() {}, replaceChildren() { replacements++ }, contains() { return false } }
  Object.assign(globalThis, { document: { createElement: () => ({ style: {}, textContent: '' }) } })
  Object.assign(globalThis.window, { getSelection: () => null })
  try {
    instance.setup.element.value = root
    instance.setup.composing.value = true
    instance.setup.textInput({ currentTarget: root })
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(instance.setup.text.value.content, '中文输入中')
    assert.equal(replacements, 0)
    instance.setup.key({ key: 'Escape', isComposing: true, preventDefault() { prevented++ } })
    instance.setup.key({ key: 'Enter', metaKey: true, isComposing: false, preventDefault() { prevented++ } })
    assert.equal(prevented, 0)
    assert.ok(instance.setup.box.value)
    root.innerText = '中文输入完成'
    instance.setup.compositionEnd({ currentTarget: root })
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(instance.setup.text.value.content, '中文输入完成')
    assert.ok(replacements > 0)
  } finally {
    instance.setup.element.value = undefined
    Object.assign(globalThis, { document: previousDocument })
    instance.restore()
  }
})

test('latest text preview replaces earlier delayed drafts and cancel invalidates pending raster work', async () => {
  const renders: ((value: any) => void)[] = []
  const instance = overlay(async () => true, async () => new Promise(resolve => renders.push(resolve)))
  try {
    instance.api.updateDraft({ text: { ...instance.setup.text.value, content: 'latest' } })
    renders[1]({ bytes: new Uint8Array([2]), width: 200, height: 80 })
    await Vue.nextTick(); await Vue.nextTick()
    renders[0]({ bytes: new Uint8Array([1]), width: 200, height: 80 })
    await Vue.nextTick(); await Vue.nextTick()
    const previews = instance.emitted.filter(entry => entry.event === 'preview' && entry.value)
    assert.equal(previews.length, 1)
    assert.equal((previews[0].value as any).raster.bytes[0], 2)
    assert.equal((previews[0].value as any).layerId, 'existing-text')
    instance.api.updateDraft({ text: { ...instance.setup.text.value, content: 'cancel me' } })
    instance.api.cancel()
    renders[2]({ bytes: new Uint8Array([3]), width: 200, height: 80 })
    await Vue.nextTick(); await Vue.nextTick()
    assert.equal(instance.emitted.filter(entry => entry.event === 'preview' && entry.value).length, 1)
  } finally { instance.restore() }
})

test('existing text can be emptied and explicit transformed geometry survives commit', async () => {
  let submitted: any
  const instance = overlay(async edit => { submitted = edit; return true })
  try {
    instance.setup.text.value.content = ''
    instance.setup.layer.value.transform.flipX = true
    instance.setup.layer.value.transform.flipY = true
    instance.setup.rotation.value = 90
    assert.equal(await instance.api.commit(), true)
    assert.deepEqual(submitted.transform, { origin: [10,20], size: [200,80], rotation:90, flipX:true, flipY:true, sampling:'High quality' })
  } finally { instance.restore() }
})

test('native Option-arrow spacing changes draft without committing and respects IME composition', () => {
  const instance = overlay(async () => true)
  try {
    instance.api.nudgeText('trackingUp', true)
    assert.equal(instance.setup.text.value.tracking, 10)
    instance.api.nudgeText('leadingDown', true)
    assert.equal(instance.setup.text.value.leading, 76.39999999999999)
    instance.setup.composing.value = true
    instance.api.nudgeText('trackingDown')
    assert.equal(instance.setup.text.value.tracking, 10)
    assert.equal(instance.emitted.filter(entry => entry.event === 'update').length, 0)
  } finally { instance.restore() }
})

test('text shortcut remapping disables the original chord and shares cancel with the workspace registry',()=>{
 const instance=overlay(async()=>true);let prevented=0
 const event=(key:string,altKey=false,ctrlKey=false)=>({key,altKey,ctrlKey,metaKey:false,shiftKey:false,isComposing:false,preventDefault(){prevented++},stopPropagation(){}})
 try{instance.props.textShortcutOverrides['text:trackingUp']='Ctrl+u';instance.setup.key(event('ArrowRight',true));assert.equal(instance.setup.text.value.tracking,0);instance.setup.key(event('u',false,true));assert.equal(instance.setup.text.value.tracking,1);instance.props.textShortcutOverrides['cancel-draft']='Ctrl+q';instance.setup.key(event('Escape'));assert.ok(instance.setup.box.value);instance.setup.key(event('q',false,true));assert.equal(instance.setup.box.value,undefined);assert.equal(prevented,2)}finally{instance.restore()}
})
