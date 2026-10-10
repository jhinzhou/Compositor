import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ForeignController } from '../src/main/foreign-controller'
import { PNG } from 'pngjs'
const bytes = () => readFile(new URL('./fixtures/foreign-import/sample.dng', import.meta.url))
async function status(controller: ForeignController, value: string): Promise<void> { const start = Date.now(); while (controller.snapshot().status !== value) { if (Date.now() - start > 10000) throw new Error(`Waiting for ${value}: ${JSON.stringify(controller.snapshot())}`); await new Promise(resolve => setTimeout(resolve, 10)) } }
test('RAW development preview is read-only and confirmation imports encoded RGBA PNG once', async () => {
  const calls: unknown[][] = [], controller = new ForeignController(() => {}, async (...args) => { calls.push(args); return 'imported' }), pending = controller.start(await bytes(), 'example.dng', 'session', 'raw')
  await status(controller, 'awaiting'); assert.equal(controller.snapshot().metadata?.width, 1920); assert.equal(calls.length, 0)
  controller.preview({ exposureEV: -1 }); await status(controller, 'awaiting'); assert.match(controller.snapshot().preview!, /^data:image\/png;base64,/); assert.equal(calls.length, 0)
  controller.confirm({ exposureEV: -1 }); assert.equal(await pending, 'imported'); assert.equal(calls.length, 1); const png = PNG.sync.read(Buffer.from(calls[0]![1] as Uint8Array)); assert.equal(png.width, 1920); assert.equal(png.height, 818); assert.equal(controller.snapshot().status, 'idle')
})
test('cancel metadata/decode ends the original job without a document write', async () => { let writes = 0; const controller = new ForeignController(() => {}, async () => { writes++ }); const pending = controller.start(await bytes(), 'example.dng', 'session', 'raw'); controller.cancel(); assert.equal(await pending, null); assert.equal(writes, 0); assert.equal(controller.snapshot().status, 'idle'); assert.throws(() => controller.confirm({}), /No RAW/) })
test('SVG results are bound to current job ID and reject executable conversion errors', async () => { let writes = 0; const controller = new ForeignController(() => {}, async () => { writes++ }); const pending = controller.start(Buffer.from('<svg/>'), 'input.svg', 'session', 'svg'); const rejected = assert.rejects(pending, /Executable/); await assert.rejects(controller.svgComplete({ id: 'other-id', png: new Uint8Array(10) }), /expired/); await controller.svgComplete({ id: controller.snapshot().id!, error: 'Executable SVG content' }); await rejected; assert.equal(writes, 0) })
