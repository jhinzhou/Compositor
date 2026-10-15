import test from 'node:test'
import assert from 'node:assert/strict'
import {readPsd,writePsdBuffer} from 'ag-psd'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {blankPNG,encodeRaster,selectionCoverage} from '../src/core/raster-edit'
import {makeAsset} from '../src/core/project-io'
import {applyMaskOperation} from '../src/core/mask-operations'
import {decodePhotoshop,encodePhotoshop} from '../src/core/photoshop-io'
import {blurMaskPixels} from '../src/shared/mask-pixels'
import {selectionOutline} from '../src/shared/selection-outline'
import {maskDisplayState} from '../src/renderer/mask-display'
import type {EditAction,Transform} from '../src/shared/contracts'
import type {PixelStage} from '../src/core/pixel-actions'
function setup(mask:PNG,defaultColor?:number){const editor=new Editor();editor.importPNG(encodeRaster(blankPNG(17,11,255)),'Mask boundary');const layerId=editor.state().manifest.activeLayerID!;editor.apply({...editor.identity(),action:{type:'layer.mask',layerId,operation:'hide'}});const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.maskFile!;snapshot.assets.set(file,makeAsset(file,encodeRaster(mask,true)));layer.maskPlacement={origin:[6,4],size:[mask.width,mask.height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'};if(defaultColor!==undefined)layer.photoshopMaskDefault=defaultColor;editor.restore(snapshot.manifest,snapshot.assets,'Finite imported mask');return {editor,layerId,file}}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
const selected=(editor:Editor,x:number,y:number)=>Math.round(selectionCoverage(editor.state().selection,x+.5,y+.5)*255)
test('visible finite masks load explicit white and gray outside coverage without default properties',()=>{
 for(const defaultColor of [255,128]){const {editor,layerId,file}=setup(blankPNG(3,3,0),defaultColor),before=editor.snapshot().assets.get(file);apply(editor,{type:'selection.from_mask',layerId,coverage:'visible',operation:'replace'});assert.equal(selected(editor,0,0),defaultColor);assert.equal(selected(editor,16,10),defaultColor);assert.equal(selected(editor,7,5),0);assert.equal(editor.snapshot().assets.get(file),before);apply(editor,{type:'selection.from_mask',layerId,coverage:'hidden',operation:'replace'});assert.equal(selected(editor,0,0),0);assert.equal(selected(editor,7,5),255)}
})
test('visible mask uses inferred dominant white plane while preserving a finite dark hole',()=>{
 const mask=blankPNG(3,3,255);mask.data.set([0,0,0,255],16);const {editor,layerId}=setup(mask);apply(editor,{type:'selection.from_mask',layerId,coverage:'visible',operation:'replace'});assert.equal(selected(editor,0,0),255);assert.equal(selected(editor,6,4),255);assert.equal(selected(editor,7,5),0)
})
test('uniform gray masks load as full canvas sparse coverage on a 100 megapixel document',()=>{
 const {editor,layerId}=setup(blankPNG(1,1,128)),snapshot=editor.snapshot();snapshot.manifest.width=snapshot.manifest.height=10000;const stage:PixelStage={...snapshot,selection:null};applyMaskOperation(stage,{type:'selection.from_mask',layerId,coverage:'visible',operation:'replace'});assert.equal(stage.selection!.shapes[0].raster!.width,10000);assert.equal(stage.selection!.shapes[0].raster!.runs.length,10000);assert.ok(selectionOutline(stage.selection,10000,10000).includes('10000'));for(const [x,y]of [[0,0],[5000,5000],[9999,9999]])assert.equal(Math.round(selectionCoverage(stage.selection,x+.5,y+.5)*255),128)
})
test('outside mask loading composes operations and restores selection only through Undo/Redo',()=>{
 const {editor,layerId}=setup(blankPNG(3,3,0),255);apply(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',bounds:[0,0,17,11],operation:'replace',feather:0}]}});const before=editor.snapshot(),selection=structuredClone(editor.state().selection),change=apply(editor,{type:'selection.from_mask',layerId,coverage:'visible',operation:'subtract'});assert.equal(selected(editor,0,0),0);assert.equal(selected(editor,7,5),255);assert.deepEqual(editor.snapshot().assets,before.assets);editor.history({...editor.identity(),direction:'undo',transactionId:change.transactionId});assert.deepEqual(editor.state().selection,selection);editor.history({...editor.identity(),direction:'redo'});assert.equal(selected(editor,7,5),255)
})
test('gray mask alone uses the explicit PSD outside color even with unchanged density and feather',()=>{
 const {editor,layerId}=setup(blankPNG(3,3,255),0),state=editor.state(),before=structuredClone(state),display=maskDisplayState(state,layerId,undefined,undefined,true,'incorrect-white-guess');const gray=display.manifest.layers[1];assert.equal(gray.maskFile,state.manifest.layers[0].maskFile);assert.equal(gray.photoshopMaskDefault,0);assert.equal(gray.maskEnabled,true);assert.ok(gray.imageFile!.startsWith('data:image/png;base64,'));assert.deepEqual(state,before)
})
test('destructive mask blur uses the explicit outside color and remains undoable without changing placement',()=>{
 const {editor,layerId,file}=setup(blankPNG(3,3,255),0),before=editor.snapshot(),source=PNG.sync.read(before.assets.get(file)!.bytes),expected=blurMaskPixels({width:3,height:3,data:new Uint8ClampedArray(source.data)},1,1,0),inferred=blurMaskPixels({width:3,height:3,data:new Uint8ClampedArray(source.data)},1);assert.equal(inferred.data[0],255);assert.ok(expected.data[0]<255);const result=apply(editor,{type:'layer.mask_filter',layerId,filter:'gaussianBlur',radius:1}),after=editor.snapshot(),stored=PNG.sync.read(after.assets.get(file)!.bytes);assert.deepEqual(new Uint8ClampedArray(stored.data),expected.data);assert.deepEqual(after.manifest.layers[0].maskPlacement,before.manifest.layers[0].maskPlacement);editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})
test('editing imported mask properties back to displayed values does not resurrect unsupported source parameters',()=>{
 const data=blankPNG(4,4,255).data,decoded=decodePhotoshop(writePsdBuffer({width:16,height:16,children:[{name:'Wide mask',imageData:{width:4,height:4,data:new Uint8ClampedArray(data)},mask:{left:0,top:0,right:4,bottom:4,defaultColor:255,imageData:{width:4,height:4,data:new Uint8ClampedArray(data)},userMaskFeather:500,userMaskDensity:1}}]},{noBackground:true})),editor=new Editor();editor.restore(decoded.manifest,decoded.assets,'Original feather500');const layerId=editor.state().manifest.layers[0].id,before=editor.snapshot();assert.equal(editor.state().manifest.layers[0].maskFeather,250);const result=apply(editor,{type:'layer.mask_properties',layerId,density:1,feather:250});assert.equal((editor.state().manifest.layers[0].photoshop as Record<string,unknown>).maskParameters,undefined);let snapshot=editor.snapshot(),exported=readPsd(encodePhotoshop(snapshot.manifest,snapshot.assets),{useImageData:true,skipCompositeImageData:true,skipThumbnail:true});assert.equal(exported.children![0].mask!.userMaskFeather,250);assert.deepEqual(snapshot.assets,before.assets);editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});snapshot=editor.snapshot();exported=readPsd(encodePhotoshop(snapshot.manifest,snapshot.assets),{useImageData:true,skipCompositeImageData:true,skipThumbnail:true});assert.equal(exported.children![0].mask!.userMaskFeather,500)
})
test('mask blur scratch budget rejects before allocating expanded working buffers',()=>{
 const fakeData={length:4000*4000*4} as Uint8ClampedArray;assert.throws(()=>blurMaskPixels({width:4000,height:4000,data:fakeData},1),/memory budget/)
})
