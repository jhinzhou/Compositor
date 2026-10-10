import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {DocumentManager} from '../src/core/document-manager'
import {validateManifest,hierarchyOrder} from '../src/core/manifest'
import {loadProject,saveProject} from '../src/core/project-io'
import {documentPixelBudget} from '../src/shared/limits'
import type {Manifest,Layer} from '../src/shared/contracts'
const identity=(state:ReturnType<DocumentManager['state']>)=>({sessionId:state.sessionId,documentId:state.manifest.documentID,expectedRevision:state.revision,idempotencyKey:randomUUID()})
function png(color:number){const image=new PNG({width:4,height:4});for(let i=0;i<image.data.length;i+=4)image.data.set([color,0,0,255],i);return PNG.sync.write(image)}

test('cross-document drag deduplicates folder descendants, centers copies, changes only destination and supports one undo',async()=>{
 const manager=new DocumentManager(),initial=await manager.open('fixtures/demo.comp');manager.get().applyBatch({...identity(initial),actions:[{type:'group.add',name:'Transfer',clientRef:'folder'},{type:'layer.set_parent',layerId:initial.manifest.layers[0].id,parentId:{ref:'folder'}},{type:'layer.set_parent',layerId:initial.manifest.layers[1].id,parentId:{ref:'folder'}}]});const source=manager.state(),root=source.manifest.layers.find(layer=>layer.isGroup)!,child=source.manifest.layers.find(layer=>layer.parentID===root.id)!,target=manager.newDocument(),before=manager.state(source.sessionId)
 const input={source:{sessionId:source.sessionId,documentId:source.manifest.documentID,expectedRevision:source.revision},request:identity(target),layerIds:[root.id,child.id],point:[300,200] as [number,number]}
 const result=manager.transferLayers(input) as {createdIds:Record<string,string>},after=manager.state();assert.equal(after.sessionId,target.sessionId);assert.equal(after.revision,1);assert.equal(after.manifest.layers.length,3);assert.equal(after.manifest.layers.find(layer=>layer.id===result.createdIds[root.id])!.transform.origin[0]+root.transform.size[0]/2,300);assert.equal(after.manifest.layers.find(layer=>layer.id===result.createdIds[child.id])!.parentID,result.createdIds[root.id]);assert.deepEqual(manager.state(source.sessionId).manifest,before.manifest);assert.equal(manager.state(source.sessionId).revision,before.revision)
 manager.get().history({...identity(after),direction:'undo'});assert.equal(manager.state().manifest.layers.length,0)
 assert.throws(()=>manager.transferLayers({...input,source:{...input.source,expectedRevision:source.revision+1},request:identity(manager.state())}),/source document changed/);assert.equal(manager.state().manifest.layers.length,0)
})

test('physical RAM budget includes distinct asset versions across documents and failed imports preserve both documents',()=>{
 assert.equal(documentPixelBudget(16*1024**3),800_000_000);assert.equal(documentPixelBudget(1*1024**3),200_000_000)
 const manager=new DocumentManager({pixelBudget:32});let a=manager.state();manager.importPNG(a.sessionId,png(10),'A');a=manager.state();const b=manager.newDocument();manager.importPNG(b.sessionId,png(20),'B');const snapshot=manager.state()
 assert.equal(snapshot.workspace!.retainedPixels,32);assert.throws(()=>manager.importPNG(b.sessionId,png(30),'C'),/workspace raster budget/);assert.deepEqual(manager.state(),snapshot)
 manager.close(a.sessionId);manager.importPNG(b.sessionId,png(30),'C');assert.equal(manager.state().manifest.layers.length,2)
})

test('10000-layer native-compatible compact project opens at the side limit; oversized or duplicate case UUID input is rejected',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'compositor-capacity-'))
 try{
 const groupId=randomUUID().toUpperCase(),layers:Layer[]=Array.from({length:10000},(_,i)=>({id:i===0?groupId:randomUUID().toUpperCase(),name:`L${i}`,isGroup:true,isVisible:true,opacity:1,blendMode:'Normal',...(i===1?{parentID:groupId.toLowerCase()}:{}),transform:{origin:[0,0],size:[1,1],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}))
 const manifest:Manifest={format:'com.compositor.project',version:11,colorSpace:'sRGB',documentID:randomUUID(),width:30000,height:1,resolution:72,layers,activeLayerID:groupId.toLowerCase()}
 const path=join(directory,'many.comp');await mkdir(join(path,'images'),{recursive:true});const compact=JSON.stringify(manifest);assert.ok(Buffer.byteLength(compact)<4*1024**2);await writeFile(join(path,'manifest.json'),compact)
 const loaded=await loadProject(path);assert.equal(loaded.manifest.layers.length,10000);assert.equal(loaded.manifest.activeLayerID,groupId);assert.equal(loaded.manifest.layers[1].parentID,groupId);assert.equal(hierarchyOrder(loaded.manifest).length,10000)
 assert.throws(()=>validateManifest({...manifest,layers:[...layers,{...layers[0],id:randomUUID()}]}));assert.throws(()=>validateManifest({...manifest,width:30000,height:6667}),/200 megapixel/);assert.throws(()=>validateManifest({...manifest,layers:[layers[0],{...layers[0],id:groupId.toLowerCase()}]}),/unique UUID/)
 const saved=join(directory,'save.comp');await saveProject(saved,loaded.manifest,new Map());assert.equal((await loadProject(saved)).manifest.layers.length,10000)
 }finally{await rm(directory,{recursive:true,force:true})}
})
