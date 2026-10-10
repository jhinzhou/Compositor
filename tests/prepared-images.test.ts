import test from 'node:test'
import assert from 'node:assert/strict'
import {Editor} from '../src/core/editor'
import {PNG} from 'pngjs'
import {clipCanvasPixels} from '../src/core/pixel-clipboard'
import {EditorError} from '../src/shared/contracts'
function fixture(){const editor=new Editor();editor.create(4,4);const png=new PNG({width:4,height:4});png.data.fill(255);editor.importPNG(PNG.sync.write(png),'Subject');return editor}
test('prepared image edits reject stale results, retry exactly and preserve mask assets through undo',()=>{
 const editor=fixture(),id=editor.state().manifest.layers[0].id,request={...editor.identity(),action:{type:'selection.subject' as const,layerId:id,removeBackground:true}},coverage={width:4,height:4,coverage:new Uint8Array(16).fill(128)}
 assert.equal(editor.inspectPrepared(request),undefined);const result=editor.commitPrepared(request,{coverage});assert.deepEqual(editor.commitPrepared(request,{coverage}),result);assert.deepEqual(editor.inspectPrepared(request),result)
 const layer=editor.state().manifest.layers[0],mask=PNG.sync.read(editor.snapshot().assets.get(layer.maskFile!)!.bytes);assert.equal(mask.data[0],128)
 editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().manifest.layers[0].maskFile,undefined)
 const stale={...editor.identity(),action:{type:'selection.subject' as const,layerId:id,removeBackground:false}};editor.apply({...editor.identity(),action:{type:'layer.rename',layerId:id,name:'User changed'}});assert.throws(()=>editor.commitPrepared(stale,{coverage}),(error:unknown)=>error instanceof EditorError&&error.code==='REVISION_CONFLICT');assert.equal(editor.state().selection,null)
})
test('a canceled agent task cannot publish a completed image result',()=>{
 const editor=fixture(),id=editor.state().manifest.layers[0].id,task=editor.beginTask({...editor.identity(),label:'Subject task'}),request={...editor.identity(),taskId:task.taskId,action:{type:'selection.subject' as const,layerId:id,removeBackground:false}}
 assert.equal(editor.inspectPrepared(request,'agent'),undefined);editor.cancelTask({sessionId:editor.identity().sessionId,documentId:editor.identity().documentId,idempotencyKey:editor.identity().idempotencyKey,taskId:task.taskId});assert.throws(()=>editor.commitPrepared(request,{coverage:{width:4,height:4,coverage:new Uint8Array(16).fill(255)}},'agent'));assert.equal(editor.state().selection,null)
})
test('pixel clipboard retains selection origin and soft alpha; cut and paste each undo atomically',()=>{
 const editor=fixture(),id=editor.state().manifest.layers[0].id;editor.apply({...editor.identity(),action:{type:'selection.set',selection:{shapes:[{kind:'rectangle',operation:'replace',bounds:[1,1,2,2],feather:0}],inverted:false}}})
 const copied=clipCanvasPixels(editor.snapshot().assets.values().next().value!.bytes,editor.state().selection??null);assert.deepEqual(copied.origin,[1,1]);assert.equal(PNG.sync.read(copied.bytes).width,2)
 editor.apply({...editor.identity(),action:{type:'layer.clear_selected',layerId:id,target:'image'}});assert.equal(PNG.sync.read(editor.snapshot().assets.values().next().value!.bytes).data[(1*4+1)*4+3],0)
 const before=editor.state().manifest.layers.length;editor.pastePixels(editor.identity(),copied.bytes,copied.origin);assert.equal(editor.state().manifest.layers.length,before+1);assert.deepEqual(editor.state().manifest.layers.at(-1)!.transform.origin,[1,1]);editor.history({...editor.identity(),direction:'undo'});editor.history({...editor.identity(),direction:'undo'});assert.equal(PNG.sync.read(editor.snapshot().assets.values().next().value!.bytes).data[(1*4+1)*4+3],255)
})
