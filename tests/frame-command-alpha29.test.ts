import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {effectiveMaskPixels,sampleEffectiveMask} from '../src/shared/mask-properties'

function fixture(){
 const png=new PNG({width:24,height:16})
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)png.data.set([x*9,y*13,(x+y)*5,255],(y*png.width+x)*4)
 const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Independent frame command input')
 return {editor,sourceId:editor.snapshot().manifest.layers[0].id}
}

test('actual Editor batch resolves frame.create clientRef, places source and hides donor in one retry-safe history transaction',()=>{
 const {editor,sourceId}=fixture(),before=editor.snapshot(),revision=editor.state().revision
 // Even a frame constructed earlier in the batch must not escape a later
 // failed placement; the command boundary owns the entire staged transaction.
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[
  {type:'frame.create',name:'Rejected frame',kind:'rectangle',bounds:[3,2,12,10],clientRef:'rejected-frame'},
  {type:'frame.place',layerId:{ref:'rejected-frame'},sourceId:'00000000-0000-4000-8000-000000000000',fit:'cover'}
 ]}),/image layer/)
 assert.deepEqual(editor.snapshot(),before);assert.equal(editor.state().revision,revision)
 const request={...editor.identity(),label:'Place source inside independent frame',actions:[
  {type:'frame.create',name:'Frame',kind:'rectangle',bounds:[3,2,12,10],clientRef:'new-frame'},
  {type:'frame.place',layerId:{ref:'new-frame'},sourceId,fit:'cover'},
  {type:'layer.set_visibility',layerId:sourceId,visible:false}
 ]},result=editor.applyBatch(request),after=editor.snapshot(),frameId=result.createdIds?.['new-frame']
 assert.equal(result.status,'applied');assert.equal(result.previousRevision,revision);assert.equal(result.revision,revision+1);assert.ok(frameId)
 const frame=after.manifest.layers.find(layer=>layer.id===frameId)!,donor=after.manifest.layers.find(layer=>layer.id===sourceId)!
 assert.deepEqual(frame.frame,{kind:'rectangle',bounds:[3,2,12,10]});assert.equal(after.manifest.activeLayerID,frameId)
 assert.equal(donor.isVisible,false);assert.equal(after.manifest.layers.length,before.manifest.layers.length+1)
 assert.deepEqual(after.assets.get(frame.imageFile!)!.bytes,before.assets.get(before.manifest.layers[0].imageFile!)!.bytes)
 assert.equal(frame.maskLinked,false);assert.deepEqual(editor.applyBatch(request),result);assert.deepEqual(editor.snapshot(),after)
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})

test('document.rotate then frame.set_bounds produces the same canonical ellipse clip as a fresh frame and preserves content',()=>{
 const {editor,sourceId}=fixture(),created=editor.applyBatch({...editor.identity(),actions:[
  {type:'frame.create',name:'Ellipse frame',kind:'ellipse',bounds:[4,3,10,6],clientRef:'ellipse'},
  {type:'frame.place',layerId:{ref:'ellipse'},sourceId,fit:'cover'}
 ]}),frameId=created.createdIds!.ellipse
 editor.apply({...editor.identity(),action:{type:'document.rotate',clockwise:true}})
 const rotated=editor.snapshot(),rotatedFrame=rotated.manifest.layers.find(layer=>layer.id===frameId)!
 assert.deepEqual(rotatedFrame.frame!.bounds,[7,4,6,10]);assert.equal(rotatedFrame.maskPlacement!.rotation,90)
 const contentTransform=structuredClone(rotatedFrame.transform),content=rotated.assets.get(rotatedFrame.imageFile!)!
 const bounds=[2,3,8,12] as const
 editor.apply({...editor.identity(),action:{type:'frame.set_bounds',layerId:frameId,bounds:[...bounds]}})
 const after=editor.snapshot(),frame=after.manifest.layers.find(layer=>layer.id===frameId)!,placement={origin:[2,3],size:[8,12],rotation:0,flipX:false,flipY:false,sampling:'Smooth'}
 assert.deepEqual(frame.frame,{kind:'ellipse',bounds:[...bounds]});assert.deepEqual(frame.maskPlacement,placement)
 assert.deepEqual(frame.transform,contentTransform);assert.deepEqual(after.assets.get(frame.imageFile!)!,content)
 const control=new Editor();control.create(16,24)
 control.apply({...control.identity(),action:{type:'frame.create',name:'Canonical control',kind:'ellipse',bounds:[...bounds]}})
 const fresh=control.snapshot(),freshFrame=fresh.manifest.layers[0]
 assert.deepEqual(frame.maskPlacement,freshFrame.maskPlacement)
 const clip=PNG.sync.read(after.assets.get(frame.maskFile!)!.bytes),freshClip=PNG.sync.read(fresh.assets.get(freshFrame.maskFile!)!.bytes)
 assert.deepEqual(clip.data,freshClip.data);assert.equal(clip.width,8);assert.equal(clip.height,12)
 const effective=effectiveMaskPixels({...clip,data:new Uint8ClampedArray(clip.data)},frame)
 assert.equal(sampleEffectiveMask(effective,frame.maskPlacement!,6,9),255)
 assert.equal(sampleEffectiveMask(effective,frame.maskPlacement!,2.5,3.5),0)
 assert.equal(sampleEffectiveMask(effective,frame.maskPlacement!,11,9),0)
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),rotated)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})
