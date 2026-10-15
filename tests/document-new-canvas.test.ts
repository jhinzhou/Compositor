import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {DocumentManager} from '../src/core/document-manager'
import {EditorError} from '../src/shared/contracts'
import {LIMITS} from '../src/shared/limits'
const png=(width=20,height=10)=>PNG.sync.write({width,height,data:Buffer.alloc(width*height*4,255)} as PNG)
const request=(manager:DocumentManager,ids:string[])=>{const state=manager.state();return {source:{sessionId:state.sessionId,documentId:state.manifest.documentID,expectedRevision:state.revision},layerIds:ids}}

test('new canvas from image reuses welcome, has exact size and retains undoable source',()=>{
 const manager=new DocumentManager(),bytes=png(),created=manager.pasteNewCanvas(bytes)
 assert.equal(created.title,'Untitled');assert.equal(created.workspace?.documents.length,1);assert.equal(created.manifest.width,20);assert.equal(created.manifest.height,10)
 const editor=manager.get(),file=created.manifest.layers[0].imageFile!;assert.deepEqual(editor.asset(created.sessionId,file,created.assets[0].hash),bytes)
 const hash=created.assets[0].hash;editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().manifest.layers.length,0);editor.history({...editor.identity(),direction:'redo'});assert.equal(editor.state().assets[0].hash,hash)
})
test('rotated layer is fitted by transformed bounds without changing source',()=>{
 const manager=new DocumentManager(),created=manager.pasteNewCanvas(png()),source=manager.get(),id=created.manifest.layers[0].id
 source.apply({...source.identity(),action:{type:'layer.set_transform',layerId:id,transform:{...created.manifest.layers[0].transform,origin:[100,80],rotation:90}}})
 const before=manager.state(),result=manager.transferLayersToNew(request(manager,[id]))
 assert.equal(result.manifest.width,10);assert.equal(result.manifest.height,20);assert.equal(result.manifest.layers[0].transform.rotation,90)
 assert.deepEqual(result.manifest.layers[0].transform.origin,[-5,5]);assert.deepEqual(manager.state(before.sessionId).manifest,before.manifest);assert.equal(manager.state(before.sessionId).revision,before.revision)
 assert.equal(result.assets[0].hash,before.assets[0].hash);assert.equal(result.workspace?.documents.length,2)
})
test('a cached clipboard can create a new document after its original was edited',()=>{
 const manager=new DocumentManager(),created=manager.pasteNewCanvas(png()),source=manager.get(),snapshot=source.snapshot(),id=created.manifest.layers[0].id
 const layer=structuredClone(created.manifest.layers[0]);source.apply({...source.identity(),action:{type:'layer.set_opacity',layerId:id,opacity:.4}})
 const result=manager.pasteClipboardToNew({version:1,sourceDocumentId:created.manifest.documentID,sourceSessionId:created.sessionId,canvasSize:[20,10],roots:[id],layers:[layer],files:[layer.imageFile!]},snapshot.assets)
 assert.equal(result.manifest.layers[0].opacity,1);assert.equal(manager.state(created.sessionId).manifest.layers[0].opacity,.4);assert.equal(result.assets[0].hash,created.assets[0].hash)
})
test('stale and oversized fitted copies fail without attaching a tab or editing source',()=>{
 const manager=new DocumentManager(),created=manager.pasteNewCanvas(png()),source=manager.get(),id=created.manifest.layers[0].id,stale=request(manager,[id])
 source.apply({...source.identity(),action:{type:'layer.set_opacity',layerId:id,opacity:.7}})
 const before=manager.state();assert.throws(()=>manager.transferLayersToNew(stale),error=>error instanceof EditorError&&error.code==='REVISION_CONFLICT');assert.deepEqual(manager.state(),before)
 const snapshot=source.snapshot(),layer=structuredClone(snapshot.manifest.layers[0]);layer.transform.size=[LIMITS.maxSide,10];layer.transform.rotation=45
 const metadata={version:1 as const,sourceDocumentId:created.manifest.documentID,canvasSize:[20,10] as [number,number],roots:[id],layers:[layer],files:[layer.imageFile!]}
 // A diagonal square exceeds maxSide after rotation.
 layer.transform.size=[LIMITS.maxSide,LIMITS.maxSide]
 assert.throws(()=>manager.pasteClipboardToNew(metadata,snapshot.assets),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.deepEqual(manager.state(),before)
})
test('new image attachment rolls back when the workspace budget is exhausted',()=>{
 const manager=new DocumentManager({pixelBudget:201});manager.pasteNewCanvas(png());const before=manager.state()
 assert.throws(()=>manager.pasteNewCanvas(png(2,2)),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.deepEqual(manager.state(),before)
})
test('new PNG16 canvas keeps low-bit samples and source bytes through Undo/Redo',()=>{
 const manager=new DocumentManager(),samples=new Uint16Array([10001,20002,30003,65535,60006,50005,40004,32768]),bytes=PNG.sync.write({width:2,height:1,data:samples} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true}),created=manager.pasteNewCanvas(bytes),editor=manager.get(),asset=created.assets[0]
 assert.equal(asset.bitDepth,16);assert.deepEqual(editor.asset(created.sessionId,asset.file,asset.hash),bytes)
 editor.history({...editor.identity(),direction:'undo'});editor.history({...editor.identity(),direction:'redo'});assert.equal(editor.state().assets[0].hash,asset.hash);assert.deepEqual(editor.asset(created.sessionId,asset.file,asset.hash),bytes)
})
test('group fit ignores blank children and translates independent mask with raster children',()=>{
 const manager=new DocumentManager(),created=manager.pasteNewCanvas(png()),editor=manager.get(),id=created.manifest.layers[0].id
 editor.apply({...editor.identity(),action:{type:'group.add',name:'Folder'}});const groupId=editor.state().manifest.activeLayerID!
 editor.apply({...editor.identity(),action:{type:'layer.set_parent',layerId:id,parentId:groupId}})
 editor.apply({...editor.identity(),action:{type:'layer.set_transform',layerId:id,transform:{...created.manifest.layers[0].transform,origin:[100,80]}}})
 editor.apply({...editor.identity(),action:{type:'layer.mask',layerId:id,operation:'reveal'}})
 const placement={...created.manifest.layers[0].transform,origin:[105,85] as [number,number]}
 editor.apply({...editor.identity(),action:{type:'layer.mask_set_placement',layerId:id,transform:placement}})
 editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:'Empty'}});const blankId=editor.state().manifest.activeLayerID!
 editor.apply({...editor.identity(),action:{type:'layer.set_parent',layerId:blankId,parentId:groupId}})
 const before=manager.state(),result=manager.transferLayersToNew(request(manager,[groupId])),raster=result.manifest.layers.find(layer=>layer.id===result.createdIds[id])!
 assert.equal(result.manifest.width,20);assert.equal(result.manifest.height,10);assert.deepEqual(raster.transform.origin,[0,0]);assert.deepEqual(raster.maskPlacement?.origin,[5,5]);assert.equal(raster.parentID,result.createdIds[groupId]);assert.deepEqual(manager.state(before.sessionId).manifest,before.manifest)
})
