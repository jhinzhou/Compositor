import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {readPsd,writePsdBuffer} from 'ag-psd'
import {Editor} from '../src/core/editor'
import {blankPNG,encodeRaster,selectionCoverage} from '../src/core/raster-edit'
import {makeAsset} from '../src/core/project-io'
import {decodePhotoshop,encodePhotoshop} from '../src/core/photoshop-io'
import {actionSchema,layerSchema,type EditAction} from '../src/shared/contracts'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask,maskPropertiesKey} from '../src/shared/mask-properties'
import {sourcePoint} from '../src/shared/selection-coverage'
import {maskDisplayState} from '../src/renderer/mask-display'
const apply=(editor:Editor,action:EditAction)=>editor.apply({...editor.identity(),action})
function setup(){const editor=new Editor();editor.importPNG(encodeRaster(blankPNG(9,9,255)),'Masked');const layerId=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.mask',layerId,operation:'hide'});return {editor,layerId}}
function gray(width:number,height:number,values:number[]){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++)data.set([values[i]??0,values[i]??0,values[i]??0,255],i*4);return {width,height,data}}

test('density blends white once, preserves fractional gray and outside background, and defaults preserve source pixels',()=>{
 const source=gray(4,1,[0,64,128,255]),before=source.data.slice(),unchanged=effectiveMaskPixels(source,{})
 assert.equal(unchanged.image,source);assert.equal(unchanged.inset,0)
 const half=effectiveMaskPixels(source,{maskDensity:.5,photoshopMaskDefault:0})
 assert.deepEqual([...half.image.data].filter((_,i)=>i%4===0),[128,160,192,255]);assert.equal(half.background,128)
 const zero=effectiveMaskPixels(source,{maskDensity:0});assert.ok(zero.image.data.every(value=>value===255));assert.equal(zero.background,255);assert.deepEqual(source.data,before)
 assert.notEqual(maskPropertiesKey('source',{}),maskPropertiesKey('source',{maskDensity:.5}))
})
test('feather has a padded soft fringe and density is applied after feather without touching raw mask',()=>{
 const values=new Array(81).fill(0);values[40]=255;const source=gray(9,9,values),before=source.data.slice(),soft=effectiveMaskPixels(source,{maskFeather:1}),half=effectiveMaskPixels(source,{maskFeather:1,maskDensity:.5})
 assert.equal(soft.inset,5);assert.equal(soft.image.width,19)
 const center=((4+soft.inset)*soft.image.width+4+soft.inset)*4;assert.ok(soft.image.data[center]>0&&soft.image.data[center]<255);assert.ok(soft.image.data[center-4]>0)
 for(let i=0;i<soft.image.data.length;i+=4)assert.equal(half.image.data[i],Math.round(255+(soft.image.data[i]-255)*.5))
 assert.deepEqual(source.data,before);assert.equal(half.background,128)
 const uniform=effectiveMaskPixels(gray(1,1,[0]),{maskDensity:.5,maskFeather:250});assert.equal(uniform.inset,0);assert.equal(uniform.image.data[0],128)
})
test('padded mask placement preserves source points under independent rotation, flip and scaling',()=>{
 const source=gray(9,7,new Array(63).fill(255)),effective=effectiveMaskPixels(source,{maskFeather:2}),placement={origin:[20,30] as [number,number],size:[18,21] as [number,number],rotation:35,flipX:true,flipY:false,sampling:'Nearest' as const},expanded=effectiveMaskTransform(placement,source,effective.inset)
 for(const point of [[20,30],[29,40.5],[41,58]]){const a=sourcePoint({transform:placement},point[0],point[1],9,7),b=sourcePoint({transform:expanded},point[0],point[1],effective.image.width,effective.image.height);assert.ok(Math.abs(a[0]+effective.inset-b[0])<1e-9);assert.ok(Math.abs(a[1]+effective.inset-b[1])<1e-9)}
 assert.equal(sampleEffectiveMask(effective,expanded,-1000,-1000),255)
})
test('mask properties are undoable metadata; mask hash/bytes survive save and reopen',async()=>{
 const {editor,layerId}=setup(),before=editor.snapshot(),file=before.manifest.layers[0].maskFile!,result=apply(editor,{type:'layer.mask_properties',layerId,density:.35,feather:2.5}),after=editor.snapshot()
 assert.deepEqual(after.assets.get(file),before.assets.get(file));assert.equal(after.manifest.layers[0].maskDensity,.35);assert.equal(after.manifest.layers[0].maskFeather,2.5)
 assert.equal(apply(editor,{type:'layer.mask_properties',layerId,density:.35,feather:2.5}).status,'no_change')
 editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
 const directory=await mkdtemp(join(tmpdir(),'mask-properties-'));try{const path=join(directory,'properties.comp');await editor.saveAs(path);const opened=new Editor();await opened.open(path);assert.equal(opened.state().manifest.layers[0].maskDensity,.35);assert.equal(opened.state().manifest.layers[0].maskFeather,2.5);assert.deepEqual(opened.snapshot().assets.get(file),before.assets.get(file))}finally{await rm(directory,{recursive:true,force:true})}
})
test('visible mask selection uses effective feather/density including the area outside a placed mask',()=>{
 const {editor,layerId}=setup(),state=editor.snapshot(),layer=state.manifest.layers[0],file=layer.maskFile!,values=new Array(25).fill(0);values[12]=255;const raw=gray(5,5,values),png=new PNG({width:5,height:5});png.data.set(raw.data);state.assets.set(file,makeAsset(file,encodeRaster(png,true)));layer.maskPlacement={origin:[2,2],size:[5,5],rotation:0,flipX:false,flipY:false,sampling:'Nearest'};editor.restore(state.manifest,state.assets,'Independent mask')
 apply(editor,{type:'layer.mask_properties',layerId,density:.5,feather:1});apply(editor,{type:'selection.from_mask',layerId,operation:'replace',coverage:'visible'})
 const selected=editor.state().selection!,effective=effectiveMaskPixels(raw,{maskDensity:.5,maskFeather:1}),placement=effectiveMaskTransform(layer.maskPlacement,raw,effective.inset)
 for(let y=0;y<9;y++)for(let x=0;x<9;x++)assert.equal(Math.round(selectionCoverage(selected,x+.5,y+.5)*255),sampleEffectiveMask(effective,placement,x+.5,y+.5))
 assert.ok(selectionCoverage(selected,.5,.5)>0);assert.deepEqual(editor.snapshot().assets.get(file)!.bytes,state.assets.get(file)!.bytes)
})
test('uniform group masks retain metadata properties and removal resets new masks to defaults',()=>{
 const {editor}=setup();apply(editor,{type:'group.add',name:'Group'});const layerId=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.mask',layerId,operation:'hide'});const before=editor.snapshot();apply(editor,{type:'layer.mask_properties',layerId,density:.25,feather:3});apply(editor,{type:'selection.from_mask',layerId,operation:'replace',coverage:'visible'});assert.equal(Math.round(selectionCoverage(editor.state().selection,.5,.5)*255),191);assert.deepEqual(editor.snapshot().assets,before.assets)
 apply(editor,{type:'selection.set',selection:null});apply(editor,{type:'layer.mask',layerId,operation:'remove'});apply(editor,{type:'layer.mask',layerId,operation:'reveal'});const layer=editor.state().manifest.layers.find(item=>item.id===layerId)!;assert.equal(layer.maskDensity,undefined);assert.equal(layer.maskFeather,undefined)
})
test('mask property composite and gray previews are transient and use the same effective-mask renderer',()=>{
 const {editor,layerId}=setup(),state=editor.state(),before=structuredClone(state),properties={density:.5,feather:1},composite=maskDisplayState(state,layerId,undefined,undefined,false,'unused',properties),grayState=maskDisplayState(state,layerId,undefined,undefined,true,'unused',properties)
 assert.deepEqual(state,before);assert.equal(composite.manifest.layers[0].maskDensity,.5);assert.equal(composite.manifest.layers[0].maskFeather,1)
 assert.equal(grayState.manifest.layers[1].maskFile,state.manifest.layers[0].maskFile);assert.equal(grayState.manifest.layers[1].maskDensity,.5);assert.ok(grayState.manifest.layers[1].imageFile!.startsWith('data:image/png;base64,'));assert.equal(grayState.manifest.layers[1].maskEnabled,true)
})
test('PSD imports density/feather into native properties and scales source feather on uniform export',()=>{
 const data=new Uint8ClampedArray(4*4*4).fill(255),input=writePsdBuffer({width:16,height:16,children:[{name:'PSD mask',imageData:{width:4,height:4,data},mask:{left:0,top:0,right:4,bottom:4,defaultColor:255,imageData:{width:4,height:4,data},userMaskDensity:.5,userMaskFeather:2}}]},{noBackground:true}),decoded=decodePhotoshop(input),editor=new Editor();editor.restore(decoded.manifest,decoded.assets,'PSD')
 const layer=editor.state().manifest.layers[0],file=layer.maskFile!,before=editor.snapshot().assets.get(file)!;assert.ok(Math.abs(layer.maskDensity!-.5)<1/255);assert.equal(layer.maskFeather,2)
 apply(editor,{type:'layer.set_transform',layerId:layer.id,transform:{...layer.transform,size:[8,8]}})
 const snapshot=editor.snapshot(),exported=readPsd(encodePhotoshop(snapshot.manifest,snapshot.assets),{useImageData:true,skipCompositeImageData:true,skipThumbnail:true}),mask=exported.children![0].mask!
 assert.equal(mask.userMaskFeather,4);assert.ok(Math.abs(mask.userMaskDensity!-.5)<1/255);assert.deepEqual(snapshot.assets.get(file),before)
})
test('nonuniform PSD mask export bakes unrepresentable feather while retaining original project PNG',()=>{
 const {editor,layerId}=setup();apply(editor,{type:'layer.mask_properties',layerId,density:.5,feather:1});const current=editor.state().manifest.layers[0];apply(editor,{type:'layer.paint',layerId,target:'mask',points:[[4.5,4.5]],color:[1,1,1,1],size:3,hardness:1,opacity:1,erase:false});apply(editor,{type:'layer.set_transform',layerId,transform:{...current.transform,size:[18,9]}})
 const before=editor.snapshot(),warnings:string[]=[],exported=readPsd(encodePhotoshop(before.manifest,before.assets,{onWarning:message=>warnings.push(message)}),{useImageData:true,skipCompositeImageData:true,skipThumbnail:true}),mask=exported.children![0].mask!
 assert.equal(mask.userMaskDensity,undefined);assert.equal(mask.userMaskFeather,undefined);assert.equal(mask.defaultColor,128);assert.ok(warnings.some(message=>message.includes('nonuniform mask scaling')));assert.deepEqual(editor.snapshot(),before);assert.ok(mask.imageData!.data.some((value,i)=>i%4===0&&value>128&&value<255))
})
test('invalid mask parameters are rejected at both manifest and action boundaries',()=>{
 const {editor,layerId}=setup(),layer=editor.state().manifest.layers[0]
 for(const parameters of [{density:-1,feather:0},{density:1.1,feather:0},{density:1,feather:251},{density:1,feather:NaN}])assert.equal(actionSchema.safeParse({type:'layer.mask_properties',layerId,...parameters}).success,false)
 assert.equal(layerSchema.safeParse({...layer,maskDensity:2}).success,false);assert.equal(layerSchema.safeParse({...layer,maskFeather:-1}).success,false)
})
