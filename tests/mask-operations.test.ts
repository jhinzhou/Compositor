import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset} from '../src/core/project-io'
import {blankPNG,encodeRaster,documentPoint,selectionCoverage} from '../src/core/raster-edit'
import {applyMaskOperation} from '../src/core/mask-operations'
import {blurMaskPixels,maskBackground} from '../src/shared/mask-pixels'
import {maskDisplayState} from '../src/renderer/mask-display'
import type {EditAction,Transform,Layer} from '../src/shared/contracts'
const placement:Transform={origin:[20,30],size:[20,10],rotation:31,flipX:true,flipY:false,sampling:'High quality'}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function setup():{editor:Editor;id:string}{const editor=new Editor();editor.importPNG(encodeRaster(blankPNG(10,5,255)),'image');const id=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});apply(editor,{type:'layer.paint',layerId:id,target:'mask',points:[[5,2.5]],color:[0,0,0,1],size:2,hardness:1,opacity:1,erase:false});return {editor,id}}
test('independent uniform and group masks accept native placement without modifying image/mask assets; undo and redo restore metadata',()=>{
 const {editor,id}=setup(),before=editor.snapshot(),transaction=apply(editor,{type:'layer.mask_set_placement',layerId:id,transform:placement}),after=editor.snapshot()
 assert.deepEqual(after.manifest.layers[0].maskPlacement,placement);assert.equal(after.manifest.layers[0].maskLinked,false);assert.deepEqual(after.assets,before.assets);assert.deepEqual(after.manifest.layers[0].transform,before.manifest.layers[0].transform)
 editor.history({...editor.identity(),direction:'undo',transactionId:transaction.transactionId});assert.deepEqual(editor.snapshot().manifest,before.manifest);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().manifest,after.manifest)
 const added=apply(editor,{type:'group.add',name:'folder'}),groupId=editor.state().manifest.activeLayerID!;assert.ok(added.undoable);apply(editor,{type:'layer.mask',layerId:groupId,operation:'hide'});apply(editor,{type:'layer.mask_set_placement',layerId:groupId,transform:placement});assert.deepEqual(editor.state().manifest.layers.find(layer=>layer.id===groupId)!.maskPlacement,placement)
})
test('load mask selects darker-than-50% pixels with independent rotated/flipped placement and add/subtract coverage',()=>{
 const {editor,id}=setup(),stage=editor.snapshot(),layer=stage.manifest.layers[0],mask=blankPNG(4,1);for(let i=0;i<4;i++)mask.data.set([[0,0,0,255],[127,127,127,255],[128,128,128,255],[255,255,255,255]][i],i*4)
 stage.assets.set(layer.maskFile!,makeAsset(layer.maskFile!,encodeRaster(mask,true)));layer.maskPlacement=placement
 const pixels:import('../src/core/pixel-actions').PixelStage={...stage,selection:null};applyMaskOperation(pixels,{type:'selection.from_mask',layerId:id,coverage:'hidden',operation:'replace'});assert.deepEqual(pixels.selection!.shapes[0].raster!.runs,[[0,0,2,255]])
 for(let i=0;i<4;i++){const p=documentPoint({transform:placement} as Layer,i+.5,.5,4,1);assert.equal(selectionCoverage(pixels.selection,...p),i<2?1:0)}
 applyMaskOperation(pixels,{type:'selection.from_mask',layerId:id,coverage:'hidden',operation:'subtract'});for(let i=0;i<4;i++){const p=documentPoint({transform:placement} as Layer,i+.5,.5,4,1);assert.equal(selectionCoverage(pixels.selection,...p),0)}
 pixels.selection={inverted:true,shapes:[{kind:'rectangle',bounds:[0,0,2,2],operation:'replace',feather:0}]};applyMaskOperation(pixels,{type:'selection.from_mask',layerId:id,coverage:'hidden',operation:'add'});assert.equal(selectionCoverage(pixels.selection,.5,.5),0);assert.equal(selectionCoverage(pixels.selection,5,3),1)
})
test('gray feather preview and applied PNG have identical fixed grid, dominant white boundary and actual intermediate tones',async()=>{
 const {editor,id}=setup();apply(editor,{type:'layer.mask_set_placement',layerId:id,transform:placement});const before=editor.snapshot(),layer=before.manifest.layers[0],source=PNG.sync.read(before.assets.get(layer.maskFile!)!.bytes),preview=blurMaskPixels({width:source.width,height:source.height,data:new Uint8ClampedArray(source.data)},1),transaction=apply(editor,{type:'layer.mask_filter',layerId:id,filter:'feather',radius:1}),after=editor.snapshot(),stored=after.assets.get(layer.maskFile!)!,actual=PNG.sync.read(stored.bytes)
 assert.equal(stored.bytes[25],0,'PNG color type is genuine 8-bit gray');assert.deepEqual(new Uint8ClampedArray(actual.data),preview.data);assert.equal(actual.width,source.width);assert.equal(actual.height,source.height);assert.deepEqual(after.manifest.layers[0].maskPlacement,placement);assert.notEqual(stored.hash,before.assets.get(layer.maskFile!)!.hash);assert.ok(actual.data.some((value,index)=>index%4===0&&value>0&&value<255));assert.equal(maskBackground({width:source.width,height:source.height,data:new Uint8ClampedArray(source.data)}),255)
 editor.history({...editor.identity(),direction:'undo',transactionId:transaction.transactionId});assert.deepEqual(editor.snapshot().assets.get(layer.maskFile!),before.assets.get(layer.maskFile!));editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().assets.get(layer.maskFile!),stored)
 const dir=await mkdtemp(join(tmpdir(),'compositor-mask-'));try{const path=join(dir,'gray.comp');await editor.saveAs(path);const disk=await readFile(join(path,'images',layer.maskFile!));assert.deepEqual(disk,stored.bytes);const opened=new Editor();await opened.open(path);assert.deepEqual(opened.state().manifest.layers[0].maskPlacement,placement);assert.deepEqual(opened.snapshot().assets.get(layer.maskFile!)!.bytes,stored.bytes)}finally{await rm(dir,{recursive:true,force:true})}
 const uniform={width:1,height:1,data:new Uint8ClampedArray([255,255,255,255])};assert.deepEqual(blurMaskPixels(uniform,250),uniform);assert.throws(()=>blurMaskPixels(uniform,251));assert.throws(()=>blurMaskPixels({...uniform,width:30001},1))
})
test('mask alone and preview are transient display documents with unmasked gray image and preserved saved state',()=>{
 const {editor,id}=setup(),state=editor.state(),before=structuredClone(state),preview={url:'data:image/png;base64,preview',width:10,height:5},display=maskDisplayState(state,id,preview,placement,true,'data:image/png;base64,background')
 assert.deepEqual(state,before);assert.equal(display.manifest.layers.length,2);assert.equal(display.manifest.layers[1].imageFile,preview.url);assert.equal(display.manifest.layers[1].maskFile,undefined);assert.deepEqual(display.manifest.layers[1].transform,placement)
 const composite=maskDisplayState(state,id,preview,placement,false,'unused');assert.equal(composite.manifest.layers[0].maskFile,preview.url);assert.equal(composite.manifest.layers[0].imageFile,state.manifest.layers[0].imageFile);assert.deepEqual(composite.manifest.layers[0].maskPlacement,placement)
})
