import test from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { Editor } from '../src/core/editor'
import { filterMargin,filterRaster,carryFilterMask } from '../src/core/filter-edit'
import { blankPNG,documentPoint,sourcePoint } from '../src/core/raster-edit'
import { imageFilterSchema } from '../src/shared/image-filters'
import { EditorError,type EditAction,type Layer } from '../src/shared/contracts'
const placement:Layer['transform']={origin:[20,30],size:[16,12],rotation:31,flipX:true,flipY:true,sampling:'High quality'}
function red(width=8,height=6):PNG{const png=blankPNG(width,height);for(let at=0;at<png.data.length;at+=4)png.data.set([255,0,0,255],at);return png}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
test('native blur margins grow transparent room then trim while keeping rotated/flipped source pixels in document coordinates',()=>{
 const source=red(),before=Buffer.from(source.data)
 for(const filter of [{kind:'gaussianBlur',radius:2},{kind:'motionBlur',distance:12,angle:45},{kind:'bloom',radius:2,amount:40}] as const){const result=filterRaster(source,placement,null,filter);assert.ok(result.grew);assert.ok(result.png.width>source.width);assert.ok(result.png.height>source.height);assert.ok(result.png.data.some((alpha,index)=>index%4===3&&alpha>0&&alpha<255));assert.equal(result.transform.size[0]/result.png.width,placement.size[0]/source.width);assert.equal(result.transform.size[1]/result.png.height,placement.size[1]/source.height)
  const doc=documentPoint({transform:placement} as Layer,2.5,3.5,source.width,source.height),pixel=sourcePoint({transform:result.transform},...doc,result.png.width,result.png.height),restored=documentPoint({transform:result.transform} as Layer,...pixel,result.png.width,result.png.height);assert.ok(Math.abs(restored[0]-doc[0])<1e-9);assert.ok(Math.abs(restored[1]-doc[1])<1e-9)
 }
 assert.deepEqual(source.data,before);assert.equal(filterMargin(imageFilterSchema.parse({kind:'motionBlur',distance:12})),8)
 const ordinary=filterRaster(source,placement,null,{kind:'invert'});assert.equal(ordinary.grew,false);assert.deepEqual(ordinary.transform,placement);assert.equal(ordinary.png.width,8)
 const zeroGlow=filterRaster(source,placement,null,{kind:'bloom',amount:0});assert.deepEqual(zeroGlow.transform,placement);assert.deepEqual(zeroGlow.png.data,source.data)
})
test('selection stays in document coordinates and linked mask carries old values and its dominant edge tone',()=>{
 const source=red(),transform={...placement,rotation:0,flipX:false,flipY:false,origin:[0,0] as [number,number],size:[8,6] as [number,number]},selection={shapes:[{kind:'rectangle' as const,bounds:[4,0,20,6] as [number,number,number,number],operation:'replace' as const,feather:0}],inverted:false}
 const result=filterRaster(source,transform,selection,{kind:'gaussianBlur',radius:2}),old=documentPoint({transform} as Layer,.5,.5,8,6),[x,y]=sourcePoint({transform:result.transform},...old,result.png.width,result.png.height),at=(Math.floor(y)*result.png.width+Math.floor(x))*4;assert.equal(result.png.data[at+3],255);assert.equal(result.png.data[at],255)
 const mask=blankPNG(8,6,255);mask.data.set([0,0,0,255],(3*8+4)*4);const carried=carryFilterMask(mask,transform,result);assert.equal(carried.width,result.png.width);assert.equal(carried.data[0],255);const blackDoc=documentPoint({transform} as Layer,4.5,3.5,8,6),black=sourcePoint({transform:result.transform},...blackDoc,result.png.width,result.png.height);assert.equal(carried.data[(Math.floor(black[1])*carried.width+Math.floor(black[0]))*4],0)
 const solid=blankPNG(1,1,0);assert.equal(carryFilterMask(solid,transform,result),solid)
 assert.throws(()=>filterRaster(red(2,1),transform,null,{kind:'gaussianBlur',radius:1_000_000}))
 const fake=Object.assign(blankPNG(1,1),{width:30000,height:6});assert.throws(()=>filterRaster(fake,transform,null,{kind:'gaussianBlur',radius:1}),e=>e instanceof EditorError&&e.code==='RESOURCE_LIMIT')
})
test('committed grown filter stores image and linked mask as one genuine editor transaction; undo/redo restores immutable assets and transforms',()=>{
 const editor=new Editor();editor.create(64,64);editor.importPNG(PNG.sync.write(red()),'red');const id=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.set_transform',layerId:id,transform:placement});apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});const point=documentPoint({transform:placement} as Layer,4.5,3.5,8,6);apply(editor,{type:'layer.paint',layerId:id,target:'mask',points:[point],size:2,hardness:1,opacity:1,color:[0,0,0,1],erase:false})
 const before=editor.snapshot(),old=before.manifest.layers[0],preview=filterRaster(PNG.sync.read(before.assets.get(old.imageFile!)!.bytes),old.transform,null,{kind:'gaussianBlur',radius:2}),transaction=apply(editor,{type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind:'gaussianBlur',radius:2})}),after=editor.snapshot(),layer=after.manifest.layers[0]
 assert.deepEqual(layer.transform,preview.transform);assert.deepEqual(PNG.sync.read(after.assets.get(layer.imageFile!)!.bytes).data,preview.png.data);assert.equal(after.assets.get(layer.maskFile!)!.width,preview.png.width);assert.notEqual(after.assets.get(layer.imageFile!)!.hash,before.assets.get(old.imageFile!)!.hash);assert.notEqual(after.assets.get(layer.maskFile!)!.hash,before.assets.get(old.maskFile!)!.hash)
 editor.history({...editor.identity(),direction:'undo',transactionId:transaction.transactionId});const undone=editor.snapshot();assert.deepEqual(undone.manifest,before.manifest);assert.deepEqual(undone.assets.get(old.imageFile!),before.assets.get(old.imageFile!));assert.deepEqual(undone.assets.get(old.maskFile!),before.assets.get(old.maskFile!))
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().manifest,after.manifest);assert.deepEqual(editor.snapshot().assets.get(layer.imageFile!),after.assets.get(layer.imageFile!))
})
test('unlinked mask keeps its original raster and placement after a grown filter',()=>{
 const editor=new Editor();editor.importPNG(PNG.sync.write(red()),'red');const id=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});apply(editor,{type:'layer.paint',layerId:id,target:'mask',points:[[4,3]],size:2,hardness:1,opacity:1,color:[0,0,0,1],erase:false});apply(editor,{type:'layer.mask',layerId:id,operation:'unlink'});const before=editor.snapshot(),old=before.manifest.layers[0];apply(editor,{type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind:'bloom',radius:2,amount:40})});const after=editor.snapshot(),layer=after.manifest.layers[0];assert.deepEqual(layer.maskPlacement,old.maskPlacement);assert.deepEqual(after.assets.get(layer.maskFile!),before.assets.get(old.maskFile!));assert.notDeepEqual(layer.transform,old.transform)
})
