import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {applyPixelAction,applySelectionRaster,type PixelStage} from '../src/core/pixel-actions'
import {magneticSelectionPath} from '../src/core/magnetic-selection'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {actionSchema,type EditAction} from '../src/shared/contracts'
function fixture(){
 const e=new Editor(),png=new PNG({width:32,height:20})
 for(let y=0;y<20;y++)for(let x=0;x<32;x++)png.data.set(x<16?[210,30,50,255]:[20,40,210,255],(y*32+x)*4)
 e.importPNG(PNG.sync.write(png),'image selection');return {e,png,id:e.state().manifest.activeLayerID!}
}
function quick(layerId:string,more:Record<string,unknown>={}):Extract<EditAction,{type:'selection.quick'}>{return actionSchema.parse({type:'selection.quick',layerId,points:[[5.5,10.5]],size:3,tolerance:20,edgeSensitivity:.8,antialiased:false,...more}) as Extract<EditAction,{type:'selection.quick'}>}
test('Quick Selection command supports replace/add/subtract/intersect and feather without changing image assets',()=>{
 const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},before=structuredClone(stage.assets)
 applyPixelAction(stage,quick(id));assert.equal(selectionCoverage(stage.selection,10.5,4.5),1);assert.equal(selectionCoverage(stage.selection,25.5,4.5),0)
 applyPixelAction(stage,quick(id,{points:[[25.5,10.5]],operation:'add'}));assert.equal(selectionCoverage(stage.selection,25.5,4.5),1)
 applyPixelAction(stage,quick(id,{points:[[25.5,10.5]],operation:'subtract'}));assert.equal(selectionCoverage(stage.selection,25.5,4.5),0)
 applyPixelAction(stage,quick(id,{points:[[25.5,10.5]],operation:'intersect'}));assert.equal(selectionCoverage(stage.selection,10.5,4.5),0)
 applyPixelAction(stage,quick(id,{feather:2}));assert.ok(selectionCoverage(stage.selection,16.5,10.5)>0&&selectionCoverage(stage.selection,16.5,10.5)<.5)
 assert.deepEqual(structuredClone(stage.assets),before)
})
test('Quick Selection source geometry uses document sampling, translation and horizontal flip',()=>{
 const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},layer=stage.manifest.layers.find(l=>l.id===id)!
 stage.manifest.width=60;stage.manifest.height=40;layer.transform={...layer.transform,origin:[10,10],flipX:true}
 applyPixelAction(stage,quick(id,{points:[[35.5,20.5]]}));assert.equal(selectionCoverage(stage.selection,38.5,15.5),1);assert.equal(selectionCoverage(stage.selection,12.5,15.5),0);assert.equal(selectionCoverage(stage.selection,1.5,1.5),0)
})
test('Quick Selection on RGB16/HDR samples proxies and preserves exact source bytes and full precision arrays',()=>{
 for(const depth of ['16','HDR']){
  const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},layer=stage.manifest.layers.find(l=>l.id===id)!,file=depth==='16'?'deep.png':'deep.exr',values=depth==='16'?new Uint16Array(32*20*4):new Float32Array(32*20*4)
  for(let y=0;y<20;y++)for(let x=0;x<32;x++)values.set(depth==='16'?(x<16?[54001,7703,12803,65535]:[5101,10203,54001,65535]):(x<16?[.8,.03,.05,1]:[.02,.04,.8,1]),(y*32+x)*4)
  const asset=depth==='16'?makeDeepAsset(file,32,20,values as Uint16Array):makeHDRAsset(file,32,20,values as Float32Array);stage.assets.set(file,asset);layer.imageFile=file
  const before=Buffer.from(asset.bytes),data=values.slice();applyPixelAction(stage,quick(id));assert.equal(selectionCoverage(stage.selection,8.5,10.5),1);assert.equal(selectionCoverage(stage.selection,25.5,10.5),0);assert.deepEqual(asset.bytes,before);assert.deepEqual(values,data)
 }
})
test('Prepared All Layers Quick Selection requires a matching sample and failure preserves stage selection and assets',()=>{
 const {e,id,png}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},before=structuredClone(stage)
 assert.throws(()=>applyPixelAction(stage,quick(id,{sampleAllLayers:true})),/revision-matched/);assert.deepEqual(structuredClone(stage),before)
 assert.throws(()=>applySelectionRaster(stage,quick(id,{sampleAllLayers:true}),{width:1,height:1,data:new Uint8Array(4)}),/dimensions/);assert.deepEqual(structuredClone(stage),before)
 applySelectionRaster(stage,quick(id,{sampleAllLayers:true}),png);assert.equal(selectionCoverage(stage.selection,5.5,10.5),1);assert.deepEqual(structuredClone(stage.assets),before.assets)
})
test('Quick Selection resource and out-of-image failures are atomic before stage mutation',()=>{
 const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},before=structuredClone(stage)
 assert.throws(()=>applyPixelAction(stage,quick(id,{points:[[32,2]]})),/inside|supported/);assert.deepEqual(structuredClone(stage),before)
 stage.manifest.width=5000;stage.manifest.height=5000;const tooLarge=structuredClone(stage);assert.throws(()=>applyPixelAction(stage,quick(id)),/16 MP/);assert.deepEqual(structuredClone(stage),tooLarge)
})
test('Magnetic readonly wrapper follows transformed document edges and leaves complete state unchanged',()=>{
 const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},layer=stage.manifest.layers.find(l=>l.id===id)!;stage.manifest.width=60;stage.manifest.height=40;layer.transform={...layer.transform,origin:[10,10],flipX:true};const before=structuredClone(stage)
 const path=magneticSelectionPath(stage,{layerId:id,points:[[23.5,16.5],[23.5,24.5]],width:10})
 assert.ok(path.length>=8);assert.ok(path.every(([x])=>x>=25.5&&x<=26.5));assert.deepEqual(structuredClone(stage),before)
 assert.throws(()=>magneticSelectionPath(stage,{layerId:id,points:[[23.5,13.5]],sampleAllLayers:true}),/revision-matched/);assert.deepEqual(structuredClone(stage),before)
})
test('Magnetic prepared composite is document-sized and uses that sample rather than the selected asset',()=>{
 const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:e.state().selection??null},data=new Uint8Array(32*20*4);for(let y=0;y<20;y++)for(let x=0;x<32;x++)data.set(x<22?[20,30,40,255]:[230,240,250,255],(y*32+x)*4)
 const path=magneticSelectionPath(stage,{layerId:id,points:[[20.5,3.5],[20.5,17.5]],width:8,sampleAllLayers:true},{width:32,height:20,data});assert.ok(path.every(([x])=>x>=21.5&&x<=22.5))
 assert.throws(()=>magneticSelectionPath(stage,{layerId:id,points:[[2,2]],sampleAllLayers:true},{width:1,height:1,data:new Uint8Array(4)}),/document-sized/)
})
test('Quick Selection uses real Editor revision/idempotency/history and failed sampling retains the complete session',()=>{
 const {e,id}=fixture(),before=e.snapshot(),request={...e.identity(),action:quick(id)},result=e.apply(request)
 assert.equal(result.status,'applied');assert.deepEqual(e.apply(request),result);assert.equal(selectionCoverage(e.state().selection,8.5,10.5),1);assert.deepEqual(e.snapshot().assets,before.assets)
 e.history({...e.identity(),direction:'undo',transactionId:result.transactionId});assert.equal(e.state().selection,null);assert.deepEqual(e.snapshot().assets,before.assets)
 e.history({...e.identity(),direction:'redo'});assert.equal(selectionCoverage(e.state().selection,8.5,10.5),1)
 const state=e.state(),snapshot=e.snapshot();assert.throws(()=>e.apply({...e.identity(),action:quick(id,{points:[[50,10]]})}),/inside|supported/);assert.deepEqual(e.state(),state);assert.deepEqual(e.snapshot(),snapshot)
})
test('A group cannot be sampled as an empty current layer by image selection',()=>{
 const {e,id}=fixture(),stage:PixelStage={...e.snapshot(),selection:null};stage.manifest.layers.find(layer=>layer.id===id)!.isGroup=true;const before=structuredClone(stage)
 assert.throws(()=>applyPixelAction(stage,quick(id)),/raster layer/);assert.deepEqual(structuredClone(stage),before)
 assert.throws(()=>magneticSelectionPath(stage,{layerId:id,points:[[5.5,10.5]]}),/raster layer/);assert.deepEqual(structuredClone(stage),before)
})
