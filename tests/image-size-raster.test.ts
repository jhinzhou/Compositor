import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {EditorError} from '../src/shared/contracts'
import {bakeImageSizeRaster,imageSizePlacement} from '../src/core/image-size-raster'
import {blankPNG,encodeRaster,sourcePoint} from '../src/core/raster-edit'
import {prepareLayerSampleSource} from '../src/core/document-sampler'
import {defaultTextStyle,defaultShapeStyle} from '../src/renderer/content-raster'
import {followingTransform} from '../src/shared/mask-placement'
const edit=(editor:Editor,action:unknown)=>editor.apply({...editor.identity(),action})
const fixture=JSON.parse(await readFile('fixtures/parity/native-image-size.json','utf8'))
const source=()=>{const png=blankPNG(fixture.width,fixture.height);png.data=Buffer.from(fixture.rgba);return png}
test('native Nearest Image Size matches all 32 affine bounds and stable pixels; private CG edge/half-open phase differences stay confined to their boundary',()=>{
 const mask=blankPNG(fixture.width,fixture.height);for(let i=0;i<fixture.gray.length;i++)mask.data.set([fixture.gray[i],fixture.gray[i],fixture.gray[i],255],i*4)
 let checked=0,imageDifferences=0,maskDifferences=0
 for(const row of fixture.rows){const transform={origin:[5,8] as [number,number],size:[8,6] as [number,number],rotation:row.rotation,flipX:row.flipX,flipY:row.flipY,sampling:'Nearest' as const},placement=imageSizePlacement(transform,row.sx,row.sy,'Nearest'),actual=bakeImageSizeRaster(source(),transform,row.sx,row.sy,'Nearest'),coverage=bakeImageSizeRaster(mask,transform,row.sx,row.sy,'Nearest',true),label=`${row.rotation}/${row.flipX}/${row.flipY}/${row.sx}/${row.sy}`
  assert.deepEqual(placement.bounds,row.bounds,label)
  for(let pixel=0;pixel<actual.png.width*actual.png.height;pixel++){
   const x=pixel%actual.png.width,y=Math.floor(pixel/actual.png.width),[u,v]=sourcePoint({transform},(placement.bounds[0]+x+.5)/row.sx,(placement.bounds[1]+y+.5)/row.sy,fixture.width,fixture.height)
   // A transformed pixel center exactly on a source pixel boundary has a
   // platform-dependent half-open choice. Gray CG clip coverage also differs
   // from CG image coverage for a few centers outside the source rectangle.
   const phaseBoundary=row.rotation!==0&&(Math.abs(u-Math.round(u))<1e-8||Math.abs(v-Math.round(v))<1e-8),outside=u<0||v<0||u>=fixture.width||v>=fixture.height
   for(let channel=0;channel<4;channel++){const at=pixel*4+channel,a=actual.png.data[at],premul=channel===3?a:Math.round(a*actual.png.data[pixel*4+3]/255);if(premul!==row.premultiplied[at]){imageDifferences++;assert.ok(phaseBoundary,`non-boundary image mismatch ${label}/${pixel}/${channel}`)}else checked++}
   if(coverage.png.data[pixel*4]!==row.mask[pixel]){maskDifferences++;assert.ok(phaseBoundary||outside,`interior mask mismatch ${label}/${pixel}`)}else checked++
  }
  assert.equal(actual.transform.rotation,0);assert.equal(actual.transform.flipX,false);assert.equal(actual.transform.flipY,false)
 }
 assert.ok(checked>10000);assert.ok(imageDifferences<=36);assert.ok(maskDifferences<=52)
})
test('real Image Size commits baked rotated image/mask in one transaction, resets transform, scales effects, rasterizes content and Undo/Redo restores bytes',()=>{
 for(const style of ['text','shape'] as const){const editor=new Editor();editor.create(16,16);editor.contentRaster(editor.identity(),encodeRaster(source()),{name:'rotated',...(style==='text'?{text:{...defaultTextStyle(),content:'Rotated'}}:{shape:defaultShapeStyle()}),origin:[5,8]});const id=editor.state().manifest.activeLayerID!,transform={...editor.state().manifest.layers[0].transform,rotation:37,flipX:true,sampling:'Nearest'};edit(editor,{type:'layer.set_transform',layerId:id,transform});edit(editor,{type:'layer.effects',layerId:id,effects:{stroke:{size:4,inside:false,red:1,green:0,blue:0,opacity:1}}});edit(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',bounds:[6,8,4,4],operation:'replace',feather:0}]}});edit(editor,{type:'layer.mask',layerId:id,operation:'reveal'});edit(editor,{type:'layer.mask',layerId:id,operation:'disable'});const before=editor.snapshot(),result=edit(editor,{type:'document.image_size',width:32,height:8,resolution:150,resample:true,sampling:'Nearest'}),after=editor.snapshot(),layer=after.manifest.layers[0],expected=bakeImageSizeRaster(source(),before.manifest.layers[0].transform,2,.5,'Nearest');assert.deepEqual(layer.transform,expected.transform);assert.equal(layer.text,undefined);assert.equal(layer.shape,undefined);assert.equal((layer.effects as {stroke?:{size:number}}|undefined)?.stroke?.size,4);assert.equal(layer.maskEnabled,false);assert.deepEqual(PNG.sync.read(after.assets.get(layer.imageFile!)!.bytes).data,expected.png.data);assert.equal(after.assets.get(layer.maskFile!)!.width,expected.png.width);assert.equal(after.assets.get(layer.maskFile!)!.height,expected.png.height);const expectedMask=bakeImageSizeRaster(PNG.sync.read(before.assets.get(before.manifest.layers[0].maskFile!)!.bytes),before.manifest.layers[0].transform,2,.5,'Nearest',true);assert.deepEqual(PNG.sync.read(after.assets.get(layer.maskFile!)!.bytes).data,expectedMask.png.data);assert.equal(after.assets.get(layer.maskFile!)!.bytes[25],0);editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)}
})
test('Image Size also bakes group bounds and applies native placement decomposition to a rotated independent mask without resampling its pixels',()=>{
 const editor=new Editor();editor.create(16,16);editor.importPNG(encodeRaster(source()),'source');edit(editor,{type:'document.canvas_size',width:16,height:16,anchor:'top-left'});const id=editor.state().manifest.activeLayerID!;edit(editor,{type:'layer.set_transform',layerId:id,transform:{origin:[5,8],size:[8,6],rotation:37,flipX:true,flipY:true,sampling:'Nearest'}});edit(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',bounds:[6,8,4,4],operation:'replace',feather:0}]}});edit(editor,{type:'layer.mask',layerId:id,operation:'reveal'});edit(editor,{type:'layer.mask',layerId:id,operation:'unlink'});const p={origin:[3,2] as [number,number],size:[7,5] as [number,number],rotation:28,flipX:true,flipY:false,sampling:'Smooth' as const};edit(editor,{type:'layer.mask_set_placement',layerId:id,transform:p});edit(editor,{type:'group.add',name:'group'});const group=editor.state().manifest.layers.at(-1)!;const before=editor.snapshot(),old=before.manifest.layers[0];edit(editor,{type:'document.image_size',width:32,height:8,resolution:72,resample:true,sampling:'Nearest'});const after=editor.snapshot(),layer=after.manifest.layers[0],identity={origin:[0,0] as [number,number],size:[1,1] as [number,number],rotation:0,flipX:false,flipY:false,sampling:p.sampling};assert.deepEqual(after.assets.get(layer.maskFile!),before.assets.get(old.maskFile!));assert.deepEqual(layer.maskPlacement,followingTransform(p,identity,{...identity,size:[2,.5]}));assert.deepEqual(after.manifest.layers.at(-1)!.transform,imageSizePlacement(group.transform,2,.5,'Nearest').transform);assert.equal(layer.maskLinked,false)
})
test('Smooth baking retains intermediate alpha at transformed edges and rejects out-of-budget target surfaces atomically',()=>{
 const transform={origin:[5,8] as [number,number],size:[8,6] as [number,number],rotation:37,flipX:false,flipY:false,sampling:'Smooth' as const},opaque=blankPNG(8,6,255),result=bakeImageSizeRaster(opaque,transform,2,.5,'Smooth');assert.ok(Array.from(result.png.data).some((v,i)=>i%4===3&&v>0&&v<255));assert.throws(()=>bakeImageSizeRaster(opaque,transform,10000,10000),/pixel budget/)
 const editor=new Editor();editor.importPNG(encodeRaster(opaque),'large transform');const id=editor.state().manifest.activeLayerID!;edit(editor,{type:'layer.set_transform',layerId:id,transform:{...transform,size:[300000,300000]}});const before=editor.snapshot();assert.throws(()=>edit(editor,{type:'document.image_size',width:16,height:12,resolution:72,resample:true}),/pixel budget/);assert.deepEqual(editor.snapshot(),before)
})

test('High quality Image Size sharply reduces a rotated nonuniform checkerboard rather than aliasing it; odd-size reductions keep source pixel phase',()=>{
 const checker=blankPNG(64,48);for(let y=0;y<48;y++)for(let x=0;x<64;x++){const value=(x+y)%2?255:0;checker.data.set([value,value,value,255],(y*64+x)*4)}
 const transform={origin:[5,8] as [number,number],size:[64,48] as [number,number],rotation:37,flipX:true,flipY:false,sampling:'High quality' as const},result=bakeImageSizeRaster(checker,transform,.125,.25,'High quality').png
 const interior=Array.from({length:result.width*result.height},(_,i)=>i).filter(i=>result.data[i*4+3]>=250).map(i=>result.data[i*4]);assert.ok(interior.length>10);assert.ok(Math.max(...interior)-Math.min(...interior)<30);assert.ok(interior.reduce((a,b)=>a+b,0)/interior.length>100);assert.ok(interior.reduce((a,b)=>a+b,0)/interior.length<150)
 const odd=blankPNG(9,7,255),prepared=prepareLayerSampleSource(odd,.2,'High quality');assert.equal(prepared.level,2);assert.equal(prepared.scale,4);assert.equal(prepared.source.width,3);assert.equal(prepared.source.height,2);assert.equal(prepareLayerSampleSource(odd,.2,'Nearest').level,0)
})

test('upright High quality Image Size uses native pixel-copy interpolation when horizontal final factor is one even when vertical size changes',()=>{
 const image=blankPNG(2,2);image.data.set([0,0,0,255,255,0,0,255,0,255,0,255,0,0,255,255]);const transform={origin:[0,0] as [number,number],size:[2,2] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},result=bakeImageSizeRaster(image,transform,1,2,'High quality').png;assert.equal(result.width,2);assert.equal(result.height,4);for(let y=0;y<4;y++)assert.deepEqual(result.data.subarray(y*8,y*8+8),image.data.subarray(Math.floor(y/2)*8,Math.floor(y/2)*8+8))
})

test('Image Size preflights five distinct 200MP targets before any PNG decode or allocation, preserving the complete editor state',()=>{
 const editor=new Editor();editor.create(1,1)
 for(let i=0;i<5;i++){const source=blankPNG(1,1);source.data.set([i*40,20,30,255]);editor.importPNG(encodeRaster(source),`tiny ${i}`);const id=editor.state().manifest.activeLayerID!;edit(editor,{type:'layer.set_transform',layerId:id,transform:{origin:[0,0],size:[10000,10000],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}})}
 const before=editor.snapshot(),state=editor.state(),retained=editor.retainedAssets(),read=PNG.sync.read;let decodes=0
 try{PNG.sync.read=()=>{decodes++;throw new Error('Target preflight must precede source decoding')};assert.throws(()=>edit(editor,{type:'document.image_size',width:2,height:1,resolution:72,resample:true,sampling:'Nearest'}),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT'&&error.message.includes('document pixel budget'))}
 finally{PNG.sync.read=read}
 assert.equal(decodes,0);assert.deepEqual(editor.snapshot(),before);assert.deepEqual(editor.state(),state);assert.deepEqual(editor.retainedAssets(),retained)
})
