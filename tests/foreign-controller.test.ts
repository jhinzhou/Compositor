import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ForeignController } from '../src/main/foreign-controller'
import {DocumentManager} from '../src/core/document-manager'
import { PNG } from 'pngjs'
const bytes = () => readFile(new URL('./fixtures/foreign-import/sample.dng', import.meta.url))
async function status(controller: ForeignController, value: string): Promise<void> { const start = Date.now(); while (controller.snapshot().status !== value) { if (Date.now() - start > 10000) throw new Error(`Waiting for ${value}: ${JSON.stringify(controller.snapshot())}`); await new Promise(resolve => setTimeout(resolve, 10)) } }
test('RAW development preview is read-only and confirmation imports encoded RGBA PNG once', async () => {
  const calls: unknown[][] = [], controller = new ForeignController(() => {}, async (...args) => { calls.push(args); return 'imported' }), pending = controller.start(await bytes(), 'example.dng', 'session', 'raw')
  await status(controller, 'awaiting'); assert.equal(controller.snapshot().metadata?.width, 1920); assert.equal(calls.length, 0)
  controller.preview({ exposureEV: -1 }); await status(controller, 'awaiting'); assert.match(controller.snapshot().preview!, /^data:image\/png;base64,/); assert.equal(calls.length, 0)
  controller.confirm({ exposureEV: -1 }); assert.equal(await pending, 'imported'); assert.equal(calls.length, 1); const png = PNG.sync.read(Buffer.from(calls[0]![1] as Uint8Array)); assert.equal(png.width, 1920); assert.equal(png.height, 818); assert.equal(controller.snapshot().status, 'idle');assert.match((calls[0]![3] as string[]).join(' '),/RGBA8.*precision/)
})
test('cancel metadata/decode ends the original job without a document write', async () => { let writes = 0; const controller = new ForeignController(() => {}, async () => { writes++ }); const pending = controller.start(await bytes(), 'example.dng', 'session', 'raw'); controller.cancel(); assert.equal(await pending, null); assert.equal(writes, 0); assert.equal(controller.snapshot().status, 'idle'); assert.throws(() => controller.confirm({}), /No RAW/) })
test('SVG results are bound to current job ID and reject executable conversion errors', async () => { let writes = 0; const controller = new ForeignController(() => {}, async () => { writes++ }); const pending = controller.start(Buffer.from('<svg/>'), 'input.svg', 'session', 'svg'); const rejected = assert.rejects(pending, /Executable/); await assert.rejects(controller.svgComplete({ id: 'other-id', png: new Uint8Array(10) }), /expired/); await controller.svgComplete({ id: controller.snapshot().id!, error: 'Executable SVG content' }); await rejected; assert.equal(writes, 0) })
test('SVG success forwards raster pixels without referring to RAW decoder metadata',async()=>{const calls:unknown[][]=[],controller=new ForeignController(()=>{},async(...args)=>{calls.push(args);return 'svg-imported'}),pending=controller.start(Buffer.from('<svg/>'),'input.svg','session','svg'),png=PNG.sync.write(new PNG({width:2,height:1}));await controller.svgComplete({id:controller.snapshot().id!,png});assert.equal(await pending,'svg-imported');assert.equal(calls.length,1);assert.equal(calls[0]![3],undefined);assert.deepEqual(calls[0]![1],png);assert.match(controller.snapshot().warnings!.join(' '),/SVG was rasterized/)})
test('new-canvas SVG import forwards destination intent only after successful conversion',async()=>{
 const calls:unknown[][]=[],controller=new ForeignController(()=>{},async(...args)=>{calls.push(args);return {createdSession:'new-session'}}),pending=controller.start(Buffer.from('<svg/>'),'new.svg','original-session','svg',{newCanvas:true}),id=controller.snapshot().id!,png=PNG.sync.write(new PNG({width:2,height:1}))
 assert.equal(calls.length,0);await controller.svgComplete({id,png});assert.deepEqual(await pending,{createdSession:'new-session'});assert.equal(calls.length,1);assert.equal(calls[0][0],'original-session');assert.equal(calls[0][2],'new');assert.equal(calls[0][4],true);assert.equal(controller.snapshot().status,'idle')
})
test('canceling new-canvas conversion never writes or creates its destination',async()=>{
 let writes=0;const controller=new ForeignController(()=>{},async()=>{writes++}),pending=controller.start(Buffer.from('<svg/>'),'cancel.svg','original-session','svg',{newCanvas:true}),id=controller.snapshot().id!
 controller.cancel();assert.equal(await pending,null);await assert.rejects(controller.svgComplete({id,png:PNG.sync.write(new PNG({width:2,height:1}))}),/expired/);assert.equal(writes,0);assert.equal(controller.snapshot().status,'idle')
})
test('ordinary foreign conversion keeps its existing-document destination flag',async()=>{
 const calls:unknown[][]=[],controller=new ForeignController(()=>{},async(...args)=>{calls.push(args);return 'existing'}),pending=controller.start(Buffer.from('<svg/>'),'existing.svg','existing-session','svg')
 await controller.svgComplete({id:controller.snapshot().id!,png:PNG.sync.write(new PNG({width:1,height:1}))});assert.equal(await pending,'existing');assert.equal(calls[0][0],'existing-session');assert.equal(calls[0][4],false)
})

test('foreign new-canvas completion attaches a sized document and cancel preserves original workspace',async()=>{
 const manager=new DocumentManager(),original=manager.pasteNewCanvas(PNG.sync.write(new PNG({width:8,height:6}))),before=manager.state(),controller=new ForeignController(()=>{},async(sessionId,bytes,name,_warnings,newCanvas)=>newCanvas?manager.pasteNewCanvas(Buffer.from(bytes),name):manager.importPNG(sessionId,Buffer.from(bytes),name))
 const pending=controller.start(Buffer.from('<svg/>'),'new.svg',original.sessionId,'svg',{newCanvas:true});await controller.svgComplete({id:controller.snapshot().id!,png:PNG.sync.write(new PNG({width:2,height:1}))});await pending
 const created=manager.state();assert.equal(created.manifest.width,2);assert.equal(created.manifest.height,1);assert.notEqual(created.sessionId,original.sessionId);assert.deepEqual(manager.state(original.sessionId).manifest,before.manifest);assert.equal(manager.state(original.sessionId).revision,before.revision)
 const stable=manager.state(),cancel=controller.start(Buffer.from('<svg/>'),'cancel.svg',original.sessionId,'svg',{newCanvas:true});controller.cancel();assert.equal(await cancel,null);assert.deepEqual(manager.state(),stable)
})
