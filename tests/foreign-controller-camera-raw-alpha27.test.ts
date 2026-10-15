import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {ForeignController,type ForeignImportState} from '../src/main/foreign-controller'
import {DocumentManager} from '../src/core/document-manager'
import type {EditorState} from '../src/shared/contracts'
const rawBytes=readFile(new URL('./fixtures/foreign-import/sample.dng',import.meta.url))
async function status(controller:ForeignController,value:ForeignImportState['status']){const deadline=Date.now()+15000;while(controller.snapshot().status!==value){if(Date.now()>deadline)throw Error(`Expected ${value}: ${JSON.stringify(controller.snapshot())}`);await new Promise(resolve=>setTimeout(resolve,10))}}
function document(){const manager=new DocumentManager(),png=new PNG({width:8,height:6});png.data.fill(255);manager.pasteNewCanvas(PNG.sync.write(png),'Preserved original');return manager}
function controllerFor(manager:DocumentManager){let writes=0;const controller=new ForeignController(()=>{},async(sessionId,bytes,name,warnings,newCanvas)=>{writes++;if(newCanvas)return manager.pasteNewCanvas(Buffer.from(bytes),name);manager.importPNG(sessionId,Buffer.from(bytes),name,warnings);return manager.state(sessionId)});return {controller,writes:()=>writes}}
async function importRaw(controller:ForeignController,sessionId:string,openCameraRaw:boolean,newCanvas=false){const pending=controller.start(await rawBytes,'sample.dng',sessionId,'raw',{newCanvas});await status(controller,'awaiting');const id=controller.snapshot().id!;assert.match(id,/^[0-9a-f-]{36}$/i);controller.confirm({},{openCameraRaw});return {state:await pending as EditorState,id}}

test('Real DNG existing-document import binds completion to the committed RAW layer and preserves original layer',async()=>{
 const manager=document(),before=manager.state(),{controller,writes}=controllerFor(manager),{state,id}=await importRaw(controller,before.sessionId,true),target=controller.snapshot().cameraRawTarget
 assert.ok(target);assert.equal(writes(),1);assert.equal(target.id,id);assert.equal(target.sessionId,before.sessionId);assert.equal(target.revision,state.revision);assert.equal(target.layerId,state.manifest.activeLayerID);assert.notEqual(target.layerId,before.manifest.activeLayerID)
 assert.equal(state.manifest.layers.length,before.manifest.layers.length+1);assert.deepEqual(state.manifest.layers[0],before.manifest.layers[0]);const layer=state.manifest.layers.find(v=>v.id===target.layerId)!;assert.equal(layer.name,'sample');assert.ok(layer.imageFile);const asset=state.assets.find(v=>v.file===layer.imageFile)!;assert.equal(asset.width,1920);assert.equal(asset.height,818)
 assert.deepEqual(controller.takeCameraRawTarget(id),target);assert.equal(controller.takeCameraRawTarget(id),undefined);assert.equal(controller.snapshot().cameraRawTarget,undefined)
})
test('Real DNG new-canvas import binds to the newly sized session and preserves original document exactly',async()=>{
 const manager=document(),before=manager.state(),{controller,writes}=controllerFor(manager),{state,id}=await importRaw(controller,before.sessionId,true,true),target=controller.snapshot().cameraRawTarget
 assert.ok(target);assert.equal(writes(),1);assert.notEqual(state.sessionId,before.sessionId);assert.equal(target.sessionId,state.sessionId);assert.equal(target.layerId,state.manifest.activeLayerID);assert.equal(target.revision,state.revision);assert.equal(state.manifest.width,1920);assert.equal(state.manifest.height,818);assert.equal(state.manifest.layers.length,1)
 const original=manager.state(before.sessionId);assert.equal(original.revision,before.revision);assert.deepEqual(original.manifest,before.manifest);assert.deepEqual(original.assets,before.assets);assert.equal(manager.workspace().documents.length,2);assert.equal(controller.takeCameraRawTarget(id)?.sessionId,state.sessionId)
})
test('Real DNG preview and ordinary confirmation produce no Camera Raw completion or document preview mutation',async()=>{
 const manager=document(),before=manager.state(),{controller,writes}=controllerFor(manager),pending=controller.start(await rawBytes,'sample.dng',before.sessionId,'raw');await status(controller,'awaiting')
 controller.preview({exposureEV:-1});await status(controller,'awaiting');assert.match(controller.snapshot().preview??'',/^data:image\/png;base64,/);assert.equal(controller.snapshot().cameraRawTarget,undefined);assert.equal(writes(),0);assert.deepEqual(manager.state(),before)
 controller.confirm({exposureEV:-1});const state=await pending as EditorState;assert.equal(state.manifest.layers.length,2);assert.equal(writes(),1);assert.equal(controller.snapshot().cameraRawTarget,undefined)
})
test('Real consecutive imports preserve FIFO completions across ordinary jobs and consume matching UUID only once',async()=>{
 const manager=document(),session=manager.state().sessionId,{controller,writes}=controllerFor(manager),first=await importRaw(controller,session,true),firstTarget=controller.snapshot().cameraRawTarget!
 const ordinary=await importRaw(controller,session,false);assert.deepEqual(controller.snapshot().cameraRawTarget,firstTarget);assert.notEqual(ordinary.id,first.id)
 const second=await importRaw(controller,session,true);assert.deepEqual(controller.snapshot().cameraRawTarget,firstTarget);assert.equal(writes(),3)
 for(const invalid of [undefined,null,17,{},randomUUID(),second.id]){assert.equal(controller.takeCameraRawTarget(invalid),undefined);assert.deepEqual(controller.snapshot().cameraRawTarget,firstTarget)}
 const copy=controller.snapshot();copy.cameraRawTarget!.layerId='mutated-copy';assert.deepEqual(controller.snapshot().cameraRawTarget,firstTarget)
 assert.deepEqual(controller.takeCameraRawTarget(first.id),firstTarget);const secondTarget=controller.snapshot().cameraRawTarget!;assert.equal(secondTarget.id,second.id);assert.equal(secondTarget.layerId,second.state.manifest.activeLayerID);assert.equal(controller.takeCameraRawTarget(first.id),undefined);assert.deepEqual(controller.takeCameraRawTarget(second.id),secondTarget);assert.equal(controller.snapshot().cameraRawTarget,undefined)
})
test('Early cancellation during real metadata or decode creates no document write and retains earlier completion',async()=>{
 const manager=document(),session=manager.state().sessionId,{controller,writes}=controllerFor(manager),first=await importRaw(controller,session,true),target=controller.snapshot().cameraRawTarget!,before=manager.state(),count=writes()
 const metadata=controller.start(await rawBytes,'cancel-metadata.dng',session,'raw');controller.cancel();assert.equal(await metadata,null);assert.deepEqual(controller.snapshot().cameraRawTarget,target)
 const decode=controller.start(await rawBytes,'cancel-decode.dng',session,'raw');await status(controller,'awaiting');controller.confirm({},{openCameraRaw:true});assert.equal(controller.snapshot().status,'decoding');controller.cancel();assert.equal(await decode,null);assert.equal(writes(),count);assert.deepEqual(manager.state(),before);assert.deepEqual(controller.snapshot().cameraRawTarget,target);assert.equal(controller.takeCameraRawTarget(first.id)?.id,first.id)
})
test('Commit-stage cancellation cannot report success or lose a later real DNG document commit/completion',async()=>{
 const manager=document(),session=manager.state().sessionId;let entered!:()=>void,release!:()=>void;const entry=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r),controller=new ForeignController(()=>{},async(id,bytes,name,warnings)=>{entered();await gate;manager.importPNG(id,Buffer.from(bytes),name,warnings);return manager.state(id)})
 const pending=controller.start(await rawBytes,'commit.dng',session,'raw');let resolved=false;void pending.then(()=>resolved=true);await status(controller,'awaiting');const id=controller.snapshot().id!;controller.confirm({},{openCameraRaw:true});await entry;assert.equal(controller.snapshot().status,'committing')
 assert.equal(controller.cancel().status,'committing');await Promise.resolve();assert.equal(resolved,false);assert.equal(manager.state(session).manifest.layers.length,1);assert.throws(()=>controller.start(new Uint8Array(),'overlap.dng',session,'raw'),/current image import/)
 release();const imported=await pending as EditorState;assert.equal(resolved,true);assert.equal(imported.manifest.layers.length,2);const target=controller.snapshot().cameraRawTarget!;assert.equal(target.id,id);assert.equal(target.sessionId,session);assert.equal(target.layerId,imported.manifest.activeLayerID);assert.equal(controller.snapshot().status,'idle');assert.equal(controller.takeCameraRawTarget(id)?.layerId,target.layerId)
})
test('Failed commit retains prior completion, rejects its real job once and produces no invented target',async()=>{
 const manager=document(),session=manager.state().sessionId;let rejectImport=false;const controller=new ForeignController(()=>{},async(id,bytes,name,warnings)=>{if(rejectImport)throw Error('Controlled import commit failure');manager.importPNG(id,Buffer.from(bytes),name,warnings);return manager.state(id)})
 await importRaw(controller,session,true);const target=controller.snapshot().cameraRawTarget!,before=manager.state();rejectImport=true;const pending=controller.start(await rawBytes,'failed.dng',session,'raw'),rejection=assert.rejects(pending,/Controlled import commit failure/);await status(controller,'awaiting');controller.confirm({},{openCameraRaw:true});await rejection
 assert.equal(controller.snapshot().status,'error');assert.deepEqual(controller.snapshot().cameraRawTarget,target);assert.deepEqual(manager.state(),before);controller.cancel();assert.equal(controller.snapshot().status,'idle');assert.deepEqual(controller.snapshot().cameraRawTarget,target)
})
