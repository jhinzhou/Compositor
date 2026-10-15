import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import type {EditAction} from '../src/shared/contracts'
import type {VectorPath} from '../src/shared/vector-path'
function fixture(){const editor=new Editor();editor.create(64,48);const png=new PNG({width:32,height:24});for(let i=0;i<32*24;i++)png.data.set([100+i%100,70,130,255],i*4);editor.importPNG(PNG.sync.write(png),'Source');editor.apply({...editor.identity(),action:{type:'document.canvas_size',width:64,height:48,anchor:'top-left'}});return {editor,id:editor.state().manifest.activeLayerID!}}
const path=():VectorPath=>({fillRule:'nonzero',subpaths:[{id:'curve',closed:true,knots:[{id:'a',point:[4,4],outHandle:[8,3]},{id:'b',point:[20,4],inHandle:[16,3]},{id:'c',point:[20,16]},{id:'d',point:[4,16]}]}]})
const apply=(editor:Editor,action:EditAction)=>editor.apply({...editor.identity(),action})
test('real Editor batch resolves Frame clientRef, commits exactly once and preserves source through Undo/Redo',()=>{
 const {editor,id}=fixture(),before=editor.snapshot(),revision=editor.state().revision,request={...editor.identity(),actions:[{type:'frame.create',name:'ClientRef frame',kind:'ellipse',bounds:[12,10,20,16],clientRef:'clip'},{type:'frame.place',layerId:{ref:'clip'},sourceId:id,fit:'cover'},{type:'layer.set_visibility',layerId:id,visible:false}],label:'Place frame batch'}
 const result=editor.applyBatch(request);assert.equal(result.revision,revision+1);assert.ok(result.createdIds?.clip);const after=editor.snapshot(),frame=after.manifest.layers.find(layer=>layer.id===result.createdIds!.clip)!
 assert.ok(frame.frame);assert.equal(after.manifest.layers.find(layer=>layer.id===id)!.isVisible,false);assert.equal(after.assets.get(frame.imageFile!)!.hash,before.assets.get(before.manifest.layers[0].imageFile!)!.hash)
 assert.deepEqual(editor.applyBatch(request),result,'Idempotent replay must not duplicate frame')
 editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.deepEqual(editor.snapshot().assets,before.assets)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().manifest,after.manifest);assert.deepEqual(editor.snapshot().assets,after.assets)
})
test('Editor geometry operations synchronize frame/path/vector-mask metadata and clip guards refuse atomically',()=>{
 const {editor,id}=fixture();apply(editor,{type:'frame.create',name:'Clip',kind:'rectangle',bounds:[12,10,20,16]});const frameId=editor.state().manifest.activeLayerID!;apply(editor,{type:'frame.place',layerId:frameId,sourceId:id,fit:'cover'});apply(editor,{type:'document.path_set',name:'Curve',path:path()});const pathId=editor.state().manifest.vectorPaths![0].id;apply(editor,{type:'layer.path_mask',layerId:id,pathId})
 const before=editor.snapshot(),originalFrame=before.manifest.layers.find(layer=>layer.id===frameId)!.frame!.bounds
 apply(editor,{type:'document.flip',axis:'horizontal'});let m=editor.state().manifest;assert.deepEqual(m.layers.find(layer=>layer.id===frameId)!.frame!.bounds,[64-originalFrame[0]-originalFrame[2],originalFrame[1],originalFrame[2],originalFrame[3]]);assert.deepEqual(m.vectorPaths![0].path.subpaths[0].knots[0].outHandle,[56,3]);assert.deepEqual(m.layers.find(layer=>layer.id===id)!.vectorMask!.path,m.vectorPaths![0].path)
 apply(editor,{type:'document.flip',axis:'horizontal'});const reversed=editor.state().manifest;assert.deepEqual(reversed.vectorPaths,before.manifest.vectorPaths);for(const layer of reversed.layers){const old=before.manifest.layers.find(item=>item.id===layer.id)!;assert.deepEqual(layer.frame,old.frame);assert.deepEqual(layer.vectorMask,old.vectorMask);for(let i=0;i<2;i++)assert.ok(Math.abs(layer.transform.origin[i]-old.transform.origin[i])<1e-10)}
 apply(editor,{type:'document.rotate',clockwise:true});m=editor.state().manifest;assert.deepEqual(m.layers.find(layer=>layer.id===frameId)!.frame!.bounds,[22,12,16,20]);assert.deepEqual(m.vectorPaths![0].path.subpaths[0].knots[0].point,[44,4])
 const stable=editor.snapshot(),rev=editor.state().revision
 for(const action of [{type:'layer.mask',layerId:frameId,operation:'remove'},{type:'layer.mask_filter',layerId:frameId,filter:'gaussianBlur',radius:2},{type:'layer.mask_properties',layerId:id,density:.5,feather:2},{type:'document.straighten',angle:10},{type:'document.perspective_crop',corners:[[0,0],[48,0],[48,64],[0,64]],width:48,height:64,sampling:'Nearest'}] as EditAction[]){assert.throws(()=>apply(editor,action));assert.equal(editor.state().revision,rev);assert.deepEqual(editor.snapshot(),stable)}
})
test('Editor path CRUD and selection/fill preserve layer source versions, and invalid batch cannot leave a half-created clip',()=>{
 const {editor,id}=fixture(),initial=editor.snapshot(),revision=editor.state().revision
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'frame.create',name:'Bad clip',kind:'rectangle',bounds:[1,1,10,10],clientRef:'newFrame'},{type:'frame.place',layerId:{ref:'newFrame'},sourceId:'00000000-0000-4000-8000-000000000000',fit:'cover'}]}));assert.equal(editor.state().revision,revision);assert.deepEqual(editor.snapshot(),initial)
 apply(editor,{type:'document.path_set',name:'Curve',path:path()});const pathId=editor.state().manifest.vectorPaths![0].id;apply(editor,{type:'selection.from_path',pathId,operation:'replace',antialiased:true});const selection=editor.state().selection;apply(editor,{type:'layer.path_fill',layerId:id,pathId,color:[1,0,0,1]});assert.deepEqual(editor.state().selection,selection);assert.notEqual(editor.snapshot().assets.get(initial.manifest.layers[0].imageFile!)!.hash,initial.assets.get(initial.manifest.layers[0].imageFile!)!.hash)
 apply(editor,{type:'document.path_delete',pathId});assert.deepEqual(editor.state().manifest.vectorPaths,[])
})
