import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {DocumentManager} from '../src/core/document-manager'
import {RecoveryStore} from '../src/core/recovery-store'
import {loadProject} from '../src/core/project-io'
import {EditorError,type EditAction} from '../src/shared/contracts'
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function sandbox(run:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'deep-editor-'));try{await run(root)}finally{await rm(root,{recursive:true,force:true})}}
async function fixture(root:string){
 const path=join(root,`${randomUUID()}.comp`),id=randomUUID().toUpperCase(),eightID=randomUUID().toUpperCase(),file=`${id}.png`,eightFile=`${eightID}.png`,maskFile=`${id}.mask.png`
 const samples=new Uint16Array([10001,20002,30003,65535,60006,50005,40004,32768,50005,30003,10001,1,60006,20002,10001,0]),bytes=PNG.sync.write({width:4,height:1,data:samples} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true}),mask=PNG.sync.write({width:4,height:1,data:Buffer.from([255,255,255,255,128,128,128,255,64,64,64,255,0,0,0,255])} as PNG,{colorType:0,inputColorType:6,inputHasAlpha:true}),eight=PNG.sync.write({width:4,height:1,data:Buffer.from([1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255])} as PNG)
 const transform={origin:[0,0],size:[4,1],rotation:0,flipX:false,flipY:false,sampling:'High quality'},manifest={format:'com.compositor.project',version:12,colorSpace:'sRGB',documentID:randomUUID(),width:4,height:1,resolution:72,activeLayerID:id,layers:[{id,name:'Native PNG16',imageFile:file,maskFile,maskLinked:true,maskEnabled:true,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform},{id:eightID,name:'PNG8',imageFile:eightFile,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform}]}
 await mkdir(join(path,'images'),{recursive:true});await writeFile(join(path,'manifest.json'),JSON.stringify(manifest));for(const [name,data] of [[file,bytes],[maskFile,mask],[eightFile,eight]] as const)await writeFile(join(path,'images',name),data)
 return {path,id,eightID,file,eightFile,maskFile,bytes,mask,eight,samples}
}
function mutate(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function history(editor:Editor,direction:'undo'|'redo'){return editor.history({...editor.identity(),direction,transactionId:direction==='undo'?editor.state().undoTransactionId:editor.state().redoTransactionId})}

test('A1 Editor exposes depth metadata without pixel payloads and checks separate display hash and session/source identity',async()=>sandbox(async root=>{
 const source=await fixture(root),editor=new Editor(),state=await editor.open(source.path),info=state.assets.find(asset=>asset.file===source.file)!,internal=editor.snapshot().assets.get(source.file)!
 assert.equal(state.manifest.version,12);assert.equal(state.modified,false);assert.equal(info.bitDepth,16);assert.equal(info.hash,hash(source.bytes));assert.equal(info.displayHash,hash(internal.displayBytes!));assert.equal(info.pixelFormat,'rgba16-premultiplied-srgb')
 for(const asset of state.assets){assert.equal('deep' in asset,false);assert.equal('bytes' in asset,false);assert.equal('displayBytes' in asset,false)}
 assert.equal(JSON.stringify(state).includes('"deep":'),false);assert.deepEqual(editor.asset(state.sessionId,source.file,info.hash),source.bytes)
 const display=editor.asset(state.sessionId,source.file,info.hash,'display',info.displayHash);assert.equal(display[24],8);assert.deepEqual(display,internal.displayBytes)
 assert.throws(()=>editor.asset(state.sessionId,source.file,info.hash,'display','stale'),code('ASSET_NOT_FOUND'));assert.throws(()=>editor.asset(state.sessionId,source.file,'stale','display',info.displayHash),code('ASSET_NOT_FOUND'));assert.throws(()=>editor.asset(randomUUID(),source.file,info.hash),code('SESSION_EXPIRED'))
}))

test('A1 metadata batch undo/redo restores original deep buffers, display and low-alpha encoded samples in one transaction',async()=>sandbox(async root=>{
 const source=await fixture(root),editor=new Editor();await editor.open(source.path);const initial=editor.snapshot(),asset=initial.assets.get(source.file)!,before=editor.state()
 const result=editor.applyBatch({...editor.identity(),label:'Deep metadata',actions:[{type:'layer.rename',layerId:source.id,name:'Renamed'},{type:'layer.set_opacity',layerId:source.id,opacity:.4},{type:'layer.set_transform',layerId:source.id,transform:{...initial.manifest.layers[0].transform,origin:[12,-3]}}]})
 assert.equal(result.revision,before.revision+1);assert.equal(editor.state().manifest.version,12);assert.equal(editor.snapshot().assets.get(source.file)!.deep,asset.deep)
 history(editor,'undo');assert.deepEqual(editor.snapshot().manifest,initial.manifest);assert.equal(editor.state().modified,false);assert.equal(editor.snapshot().assets.get(source.file)!.deep,asset.deep);assert.deepEqual(editor.snapshot().assets.get(source.file)!.bytes,source.bytes)
 history(editor,'redo');assert.equal(editor.state().manifest.layers[0].name,'Renamed');assert.equal(editor.state().manifest.layers[0].opacity,.4);assert.deepEqual(editor.state().manifest.layers[0].transform.origin,[12,-3]);assert.equal(editor.snapshot().assets.get(source.file)!.displayBytes,asset.displayBytes)
}))

test('A1 duplicate/delete retain immutable deep/source/display versions; undo restores depth and assets after last deep layer deletion',async()=>sandbox(async root=>{
 const source=await fixture(root),editor=new Editor();await editor.open(source.path);const original=editor.snapshot().assets.get(source.file)!
 mutate(editor,{type:'layer.duplicate',layerId:source.id});const copied=editor.state().manifest.layers.find(layer=>layer.id!==source.id&&layer.imageFile&&editor.snapshot().assets.get(layer.imageFile)?.bitDepth===16)!,duplicate=editor.snapshot().assets.get(copied.imageFile!)!
 assert.notEqual(copied.imageFile,source.file);assert.equal(duplicate.bytes,original.bytes);assert.equal(duplicate.deep,original.deep);assert.equal(duplicate.displayBytes,original.displayBytes);assert.equal(duplicate.hash,original.hash)
 mutate(editor,{type:'layer.delete',layerId:source.id});mutate(editor,{type:'layer.delete',layerId:copied.id});assert.equal(editor.state().manifest.version,11);assert.equal(editor.state().assets.some(asset=>asset.bitDepth===16),false)
 assert.deepEqual(editor.asset(editor.state().sessionId,source.file,original.hash),source.bytes);assert.ok(editor.retainedAssets().some(asset=>asset.deep===original.deep))
 history(editor,'undo');assert.equal(editor.state().manifest.version,12);assert.equal(editor.snapshot().assets.get(copied.imageFile!)!.deep,original.deep);history(editor,'undo');assert.equal(editor.snapshot().assets.get(source.file)!.deep,original.deep);history(editor,'undo');assert.equal(editor.state().manifest.layers.length,2);assert.deepEqual(editor.snapshot().assets.get(source.file)!.bytes,source.bytes)
}))

test('A1 mixed batch pixel edit refusal is atomic for preceding metadata and ordinary PNG8 edits',async()=>sandbox(async root=>{
 const source=await fixture(root),editor=new Editor();await editor.open(source.path);const state=editor.state(),snapshot=editor.snapshot(),retained=editor.retainedAssets()
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'layer.rename',layerId:source.id,name:'Must rollback'},{type:'layer.fill',layerId:source.eightID,color:[1,0,0,1]},{type:'layer.retouch',layerId:source.id,kind:'clone',sourceMode:'this-layer',sourceAnchor:[0,0],points:[[2,2]],size:2,hardness:1,opacity:1,protectAlpha:true}]}),code('UNSUPPORTED_FEATURE'))
 assert.deepEqual(editor.state(),state);assert.deepEqual(editor.snapshot(),snapshot);assert.deepEqual(editor.retainedAssets(),retained);assert.equal(editor.state().canUndo,false);assert.deepEqual(editor.snapshot().assets.get(source.eightFile)!.bytes,source.eight)
}))

test('A1 Save, Save Copy, external conflict and reopen preserve true source PNG16 and mask bytes',async()=>sandbox(async root=>{
 const source=await fixture(root),editor=new Editor({journalDirectory:join(root,'journals')});await editor.open(source.path)
 mutate(editor,{type:'layer.rename',layerId:source.id,name:'Unsaved deep'});const copy=join(root,'copy.comp');await editor.saveCopy(copy);assert.equal(editor.state().projectPath,source.path);assert.equal(editor.state().modified,true);assert.equal((await loadProject(source.path)).manifest.layers[0].name,'Native PNG16')
 await editor.save();assert.equal(editor.state().modified,false);for(const path of [source.path,copy]){const loaded=await loadProject(path);assert.equal(loaded.manifest.version,12);assert.equal(loaded.manifest.layers[0].name,'Unsaved deep');assert.deepEqual(loaded.assets.get(source.file)!.bytes,source.bytes);assert.deepEqual(loaded.assets.get(source.maskFile)!.bytes,source.mask);assert.equal(loaded.assets.get(source.file)!.hash,hash(source.bytes))}
 const reopened=new Editor();await reopened.open(copy);assert.deepEqual(reopened.snapshot(),editor.snapshot())
 const manifest=JSON.parse(await readFile(join(source.path,'manifest.json'),'utf8'));manifest.layers[0].name='External writer';await writeFile(join(source.path,'manifest.json'),JSON.stringify(manifest));mutate(editor,{type:'layer.rename',layerId:source.id,name:'Local writer'});await assert.rejects(editor.save(),code('SAVE_CONFLICT'));assert.equal(editor.state().modified,true);assert.deepEqual(await readFile(join(source.path,'images',source.file)),source.bytes)
}))

test('A1 recovery checkpoint and DocumentManager restore preserve source, deep arrays and mask without an accidental v11 downgrade',async()=>sandbox(async root=>{
 const source=await fixture(root),editor=new Editor();await editor.open(source.path);mutate(editor,{type:'layer.rename',layerId:source.id,name:'Recovery deep'});const store=new RecoveryStore(join(root,'recovery'));await store.checkpoint(editor);await store.checkpoint(editor)
 const fresh=new RecoveryStore(join(root,'recovery')),entries=await fresh.list();assert.equal(entries.length,1);const checkpoint=await fresh.get(entries[0].id),loaded=await loadProject(checkpoint.path)
 assert.equal(loaded.manifest.version,12);assert.deepEqual(loaded.assets.get(source.file)!.bytes,source.bytes);assert.deepEqual(loaded.assets.get(source.file)!.deep,editor.snapshot().assets.get(source.file)!.deep)
 const manager=new DocumentManager(),restored=await manager.restore(checkpoint.path,checkpoint.entry.title),recovered=manager.get(restored.sessionId)
 assert.equal(restored.modified,true);assert.equal(restored.projectPath,undefined);assert.equal(restored.manifest.version,12);assert.deepEqual(recovered.snapshot().assets.get(source.file)!.bytes,source.bytes);assert.deepEqual(recovered.snapshot().assets.get(source.maskFile)!.bytes,source.mask)
 await recovered.saveAs(join(root,'recovered.comp'));assert.equal((await loadProject(recovered.state().projectPath!)).manifest.version,12)
}))

test('A1 cross-document layer copy keeps high-depth source and undoable target history without changing original document',async()=>sandbox(async root=>{
 const source=await fixture(root),manager=new DocumentManager(),opened=await manager.open(source.path),sourceEditor=manager.get(opened.sessionId),before=sourceEditor.state(),original=sourceEditor.snapshot().assets.get(source.file)!,target=manager.newDocument(),targetEditor=manager.get(target.sessionId)
 manager.transferLayers({source:{sessionId:opened.sessionId,documentId:opened.manifest.documentID,expectedRevision:opened.revision},request:targetEditor.identity(),layerIds:[source.id],point:[20,10]})
 const copied=targetEditor.state().manifest.layers[0],asset=targetEditor.snapshot().assets.get(copied.imageFile!)!;assert.equal(targetEditor.state().manifest.version,12);assert.equal(asset.deep,original.deep);assert.equal(asset.bytes,original.bytes);assert.equal(asset.displayBytes,original.displayBytes);assert.deepEqual(sourceEditor.state(),before)
 history(targetEditor,'undo');assert.equal(targetEditor.state().manifest.layers.length,0);assert.equal(targetEditor.state().manifest.version,11);history(targetEditor,'redo');assert.equal(targetEditor.state().manifest.version,12);assert.deepEqual(targetEditor.snapshot().assets.get(copied.imageFile!)!.bytes,source.bytes)
}))

test('A1 failed deep project open preserves current session, dirty metadata, high-depth assets and undo history',async()=>sandbox(async root=>{
 const source=await fixture(root),invalid=await fixture(root),editor=new Editor();await editor.open(source.path);mutate(editor,{type:'layer.rename',layerId:source.id,name:'Keep current edits'});const state=editor.state(),snapshot=editor.snapshot(),retained=editor.retainedAssets()
 const damaged=Buffer.from(invalid.bytes);damaged[damaged.length-1]^=1;await writeFile(join(invalid.path,'images',invalid.file),damaged);await assert.rejects(editor.open(invalid.path),code('INVALID_PROJECT'))
 assert.deepEqual(editor.state(),state);assert.deepEqual(editor.snapshot(),snapshot);assert.deepEqual(editor.retainedAssets(),retained);history(editor,'undo');assert.equal(editor.state().manifest.layers[0].name,'Native PNG16');assert.deepEqual(editor.snapshot().assets.get(source.file)!.bytes,source.bytes)
}))

test('A1 DocumentManager failed second deep open leaves workspace and selected document unchanged',async()=>sandbox(async root=>{
 const source=await fixture(root),invalid=await fixture(root),manager=new DocumentManager(),opened=await manager.open(source.path),state=manager.state(),workspace=manager.workspace()
 const damaged=Buffer.from(invalid.bytes);damaged.writeUInt32BE(4096,16);damaged.writeUInt32BE(4096,20);await writeFile(join(invalid.path,'images',invalid.file),damaged);await assert.rejects(manager.open(invalid.path),code('RESOURCE_LIMIT'))
 assert.deepEqual(manager.state(),state);assert.deepEqual(manager.workspace(),workspace);assert.deepEqual(manager.get(opened.sessionId).snapshot().assets.get(source.file)!.bytes,source.bytes)
}))

test('A1 contentRaster cannot evade precision gate by changing a lowercase layer ID to a differently cased PNG filename',async()=>sandbox(async root=>{
 const source=await fixture(root),manifest=JSON.parse(await readFile(join(source.path,'manifest.json'),'utf8')),lowerId=source.id.toLowerCase()
 // Native IDs may retain lowercase spelling, while the project image filename is canonical uppercase.
 manifest.layers[0].id=lowerId;manifest.activeLayerID=lowerId;await writeFile(join(source.path,'manifest.json'),JSON.stringify(manifest))
 const editor=new Editor();await editor.open(source.path);const state=editor.state(),snapshot=editor.snapshot(),original=snapshot.assets.get(source.file)!,retained=editor.retainedAssets()
 assert.notEqual(source.file,`${lowerId}.png`)
 assert.throws(()=>editor.contentRaster(editor.identity(),source.eight,{layerId:lowerId,name:'Replacement PNG8'}),code('UNSUPPORTED_FEATURE'))
 assert.deepEqual(editor.state(),state);assert.deepEqual(editor.snapshot().manifest,snapshot.manifest);assert.deepEqual(editor.retainedAssets(),retained);assert.equal(editor.state().canUndo,false)
 const unchanged=editor.snapshot().assets.get(source.file)!;assert.equal(unchanged,original);assert.equal(unchanged.bytes,original.bytes);assert.equal(unchanged.deep,original.deep);assert.equal(unchanged.displayBytes,original.displayBytes);assert.equal(editor.snapshot().assets.has(`${lowerId}.png`),false)
}))
