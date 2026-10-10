import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { Editor } from '../src/core/editor'
function action(editor:Editor,action:unknown){return editor.apply({...editor.identity(),action})}
function pixels(editor:Editor,mask=false){const state=editor.state(),layer=state.manifest.layers[0],file=(mask?layer.maskFile:layer.imageFile)!;const asset=state.assets.find(a=>a.file===file)!;return PNG.sync.read(editor.asset(state.sessionId,file,asset.hash))}
test('pixel versions survive undo, redo and dirty hashing, selection is session-only',async()=>{
  const e=new Editor();e.create(8,8);action(e,{type:'layer.add_blank',name:'Test'});const id=e.state().manifest.layers[0].id
  action(e,{type:'layer.fill',layerId:id,color:[1,0,0,1],target:'image'});assert.deepEqual([...pixels(e).data.subarray(0,4)],[255,0,0,255])
  const directory=await mkdtemp(join(tmpdir(),'pixel-history-'))
  try{
    await e.saveAs(join(directory,'test.comp'));assert.equal(e.state().modified,false)
    action(e,{type:'selection.set',selection:{shapes:[{kind:'rectangle',bounds:[0,0,4,8],operation:'replace',feather:0}],inverted:false}});assert.equal(e.state().modified,false)
    action(e,{type:'layer.fill',layerId:id,color:[0,0,1,1],target:'image'});assert.equal(e.state().modified,true)
    const png=pixels(e);assert.deepEqual([...png.data.subarray(0,4)],[0,0,255,255]);assert.deepEqual([...png.data.subarray(20,24)],[255,0,0,255])
    e.history({...e.identity(),direction:'undo'});assert.equal(e.state().modified,false);assert.deepEqual([...pixels(e).data.subarray(0,4)],[255,0,0,255])
    e.history({...e.identity(),direction:'redo'});assert.deepEqual([...pixels(e).data.subarray(0,4)],[0,0,255,255])
    const reopened=new Editor();await reopened.open(join(directory,'test.comp'));assert.equal(reopened.state().selection,null);assert.deepEqual([...pixels(reopened).data.subarray(0,4)],[255,0,0,255])
  }finally{await rm(directory,{recursive:true,force:true})}
})
test('mask PNG is native grayscale, survives save/open and duplication; invalid batch rolls back bytes',async()=>{
 const e=new Editor();e.create(8,8);action(e,{type:'layer.add_blank',name:'Test'});const id=e.state().manifest.layers[0].id
 action(e,{type:'layer.mask',layerId:id,operation:'reveal'});action(e,{type:'layer.paint',layerId:id,points:[[4,4]],color:[0,0,0,1],size:4,hardness:1,opacity:1,erase:false,target:'mask'})
 assert.equal(pixels(e,true).data[(4*8+4)*4],0);assert.equal(pixels(e,true).data[0],255)
 const before=e.state();assert.throws(()=>e.applyBatch({...e.identity(),actions:[{type:'layer.fill',layerId:id,color:[0,0,0,1],target:'mask'},{type:'layer.set_parent',layerId:id,parentId:id}]}));assert.deepEqual(e.state(),before)
 const directory=await mkdtemp(join(tmpdir(),'mask-history-'));try{
 await e.saveAs(join(directory,'test.comp'));const file=e.state().manifest.layers[0].maskFile!;const bytes=await readFile(join(directory,'test.comp','images',file));assert.equal(bytes[24],8);assert.equal(bytes[25],0)
 const reopened=new Editor();await reopened.open(join(directory,'test.comp'));assert.equal(pixels(reopened,true).data[(4*8+4)*4],0)
 action(reopened,{type:'layer.duplicate',layerId:id});assert.equal(reopened.state().manifest.layers.length,2);assert.notEqual(reopened.state().manifest.layers[0].maskFile,reopened.state().manifest.layers[1].maskFile)
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('clipping rejects missing sources and cycles atomically, deleting source releases clips',()=>{
 const e=new Editor();e.create(8,8);action(e,{type:'layer.add_blank',name:'A'});action(e,{type:'layer.add_blank',name:'B'});const [a,b]=e.state().manifest.layers
 action(e,{type:'layer.set_clipping',layerId:b.id,sourceId:a.id});const before=e.state();assert.throws(()=>action(e,{type:'layer.set_clipping',layerId:a.id,sourceId:b.id}));assert.deepEqual(e.state(),before)
 action(e,{type:'layer.delete',layerId:a.id});assert.equal(e.state().manifest.layers[0].maskSourceID,undefined)
})
test('canvas resizing preserves raster bytes, image resizing versions pixels and can undo',()=>{
 const e=new Editor();e.create(4,2);action(e,{type:'layer.add_blank',name:'A'});const id=e.state().manifest.layers[0].id;action(e,{type:'layer.fill',layerId:id,color:[1,0,0,1],target:'image'});const old=e.state().assets[0].hash
 action(e,{type:'document.canvas_size',width:8,height:4,anchor:'center'});assert.equal(e.state().assets[0].hash,old);assert.deepEqual(e.state().manifest.layers[0].transform.origin,[2,1])
 action(e,{type:'document.image_size',width:16,height:8,resolution:300,resample:true});assert.equal(pixels(e).width,8);assert.equal(e.state().manifest.resolution,300)
 e.history({...e.identity(),direction:'undo'});assert.equal(e.state().assets[0].hash,old);assert.equal(e.state().manifest.width,8)
})
