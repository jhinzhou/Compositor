/** Real Editor transactions and the production worker RPC dispatcher. The worker
 * uses only a Node parentPort transport adapter; its editor/pixel code is bundled
 * unchanged from source. This does not claim an Electron main/UI runtime gate. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Worker} from 'node:worker_threads'
import {build,transformSync} from 'esbuild'
import ts from 'typescript'
import {z} from 'zod'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from '../src/core/project-io'
import {prepareColorErase,type ColorEraseAction} from '../src/core/color-erase-edit'
import {actionSchema,mutationSchema,EditorError,type EditAction,type EditorState} from '../src/shared/contracts'
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
function raster(width:number,height:number,pixel:(x:number,y:number)=>number[]){const png=new PNG({width,height});for(let y=0;y<height;y++)for(let x=0;x<width;x++)png.data.set(pixel(x,y),(y*width+x)*4);return png}
function setup(source?:Asset){const editor=new Editor();editor.create(4,2);editor.importImageAsset(source??makeAsset('source.png',PNG.sync.write(raster(4,2,x=>x===2?[0,0,0,255]:[255,255,255,255]))),'Target');return {editor,layerId:editor.state().manifest.layers[0].id}}
function asset(editor:Editor,id:string){return editor.snapshot().assets.get(editor.state().manifest.layers.find(layer=>layer.id===id)!.imageFile!)!}
function erase(layerId:string,kind:'magic'|'background'='magic',extra:Record<string,unknown>={}):ColorEraseAction{return actionSchema.parse(kind==='magic'?{type:'layer.magic_erase',layerId,point:[.5,.5],tolerance:0,antialiased:false,...extra}:{type:'layer.background_erase',layerId,points:[[.5,.5]],size:10,hardness:1,tolerance:0,sampling:'once',limits:'discontiguous',...extra}) as ColorEraseAction}
const apply=(editor:Editor,action:EditAction)=>editor.apply({...editor.identity(),action})
const stage=(editor:Editor)=>({...editor.snapshot(),selection:editor.state().selection??null})
function unchanged(editor:Editor,before:EditorState,original:Asset,id:string){assert.deepEqual(editor.state(),before);assert.equal(asset(editor,id),original)}

test('RGB16 Background and Magic Eraser retain low bits in one transaction, undo/redo and saved/reopened source PNG16',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'color-erase16-integration-'))
 try{for(const kind of ['magic','background'] as const){const pixels=new Uint16Array(4*2*4);for(let p=0;p<8;p++)pixels.set([1002,2006,3014,65534],p*4)
  const {editor,layerId}=setup(makeDeepAsset('deep.png',4,2,pixels)),original=asset(editor,layerId),before=editor.state(),request={...editor.identity(),action:erase(layerId,kind,{opacity:.5})},result=editor.apply(request),edited=asset(editor,layerId)
  assert.equal(result.status,'applied');assert.equal(result.revision,before.revision+1);assert.equal(result.undoable,true);assert.equal(edited.bitDepth,16);assert.equal(edited.bytes[24],16)
  assert.deepEqual([...edited.deep!.slice(0,4)],[501,1003,1507,32767]);assert.ok(edited.deep![0]%257!==0);assert.notEqual(edited.deep!.buffer,original.deep!.buffer);assert.deepEqual(original.deep,pixels)
  assert.deepEqual(editor.apply(request),result);assert.equal(editor.state().revision,result.revision)
  editor.history({...editor.identity(),direction:'undo'});assert.equal(asset(editor,layerId),original);assert.deepEqual(asset(editor,layerId).bytes,original.bytes)
  editor.history({...editor.identity(),direction:'redo'});assert.equal(asset(editor,layerId),edited)
  const path=join(directory,`${kind}.comp`);await editor.saveAs(path);const reopened=new Editor();await reopened.open(path)
  assert.equal(reopened.state().manifest.version,12);assert.deepEqual(asset(reopened,layerId).bytes,edited.bytes);assert.deepEqual(asset(reopened,layerId).deep,edited.deep)
  assert.deepEqual(await readFile(join(path,'images',edited.file)),edited.bytes)
 }}finally{await rm(directory,{recursive:true,force:true})}
})

test('HDR eraser image/merged operations are explicitly refused without source, selection, revision or history changes',()=>{
 const pixels=new Float32Array(4*2*4);for(let p=0;p<8;p++)pixels.set([-.125,1.1875,.001953125,.5],p*4)
 const {editor,layerId}=setup(makeHDRAsset('hdr.exr',4,2,pixels)),before=editor.state(),original=asset(editor,layerId),merged={width:4,height:2,data:new Uint8Array(32).fill(255)}
 for(const kind of ['magic','background'] as const){assert.throws(()=>editor.inspectPrepared({...editor.identity(),action:erase(layerId,kind)}),code('UNSUPPORTED_FEATURE'));assert.throws(()=>apply(editor,erase(layerId,kind)),code('UNSUPPORTED_FEATURE'));assert.throws(()=>prepareColorErase(stage(editor),erase(layerId,kind)),code('UNSUPPORTED_FEATURE'));unchanged(editor,before,original,layerId)}
 assert.throws(()=>editor.applyColorEraseRaster({...editor.identity(),action:erase(layerId,'magic',{sampleAllLayers:true})},merged),code('UNSUPPORTED_FEATURE'));unchanged(editor,before,original,layerId);assert.deepEqual(original.hdr,pixels)
})

test('locked raster and editable text/shape erasers reject atomically; explicit rasterize enables one undoable edit',()=>{
 for(const kind of ['text','shape','locked'] as const){const {editor,layerId}=setup(),snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0]
  if(kind==='text')layer.text={content:'editable',fontName:'Arial',fontSize:12,red:0,green:0,blue:0,alignment:'Left',tracking:0,leading:0}
  if(kind==='shape')layer.shape={kind:'Rectangle',red:1,green:0,blue:0,cornerRadius:0}
  if(kind==='locked')layer.locked=true
  editor.importDocument(snapshot.manifest,snapshot.assets,'Protected source');const before=editor.state(),original=asset(editor,layerId),expected=kind==='locked'?'INVALID_ARGUMENT':'RASTERIZATION_REQUIRED'
  for(const tool of ['magic','background'] as const){const action=erase(layerId,tool),request={...editor.identity(),action};assert.throws(()=>editor.inspectPrepared(request),code(expected));assert.throws(()=>editor.apply(request),code(expected));assert.throws(()=>prepareColorErase(stage(editor),action),code(expected));unchanged(editor,before,original,layerId)}
  if(kind!=='locked'){apply(editor,{type:'layer.rasterize',layerId});const rasterized=editor.state();apply(editor,erase(layerId));assert.equal(PNG.sync.read(asset(editor,layerId).bytes).data[3],0);editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().manifest,rasterized.manifest);assert.equal(asset(editor,layerId),original);editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().manifest,before.manifest)}
 }
})

test('selection constrains document-space erasing to requested layer; sibling and mask bytes, transform and editable mask properties survive',()=>{
 const {editor,layerId}=setup();editor.importPNG(PNG.sync.write(raster(4,2,()=>[40,80,120,255])),'Decoy');const decoyId=editor.state().manifest.layers[1].id,snapshot=editor.snapshot(),target=snapshot.manifest.layers[0],mask=makeAsset(`${layerId}.mask.png`,PNG.sync.write(raster(4,2,()=>[255,255,255,255]),{colorType:0}));target.maskFile=mask.file;target.maskDensity=.5;target.maskFeather=2;snapshot.assets.set(mask.file,mask);editor.importDocument(snapshot.manifest,snapshot.assets,'Selected target')
 apply(editor,{type:'selection.set',selection:{inverted:false,antialiased:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,1,2],feather:0}]}})
 const original=asset(editor,layerId),decoy=asset(editor,decoyId),before=editor.state(),result=apply(editor,erase(layerId,'magic',{contiguous:false})),bytes=PNG.sync.read(asset(editor,layerId).bytes).data
 assert.equal(result.status,'applied');for(let y=0;y<2;y++)for(let x=0;x<4;x++)assert.equal(bytes[(y*4+x)*4+3],x===0?0:255)
 assert.equal(asset(editor,decoyId),decoy);assert.equal(editor.snapshot().assets.get(mask.file),mask);assert.deepEqual(editor.state().selection,before.selection);assert.deepEqual(editor.state().manifest.layers[0].transform,target.transform);assert.equal(editor.state().manifest.layers[0].maskFeather,2)
 editor.history({...editor.identity(),direction:'undo'});assert.equal(asset(editor,layerId),original);assert.deepEqual(editor.state().selection,before.selection)
})

test('zero-opacity and transparent seed consume neither revision nor undo, including prepared merged sampling',()=>{
 const {editor,layerId}=setup(makeAsset('transparent.png',PNG.sync.write(raster(4,2,x=>x===0?[200,100,50,0]:[255,255,255,255])))),before=editor.state(),original=asset(editor,layerId)
 for(const action of [erase(layerId),erase(layerId,'background',{opacity:0}),erase(layerId,'magic',{point:[1.5,.5],opacity:0})]){const result=apply(editor,action);assert.equal(result.status,'no_change');assert.equal(result.undoable,false);unchanged(editor,before,original,layerId)}
 const request={...editor.identity(),action:erase(layerId,'magic',{opacity:0,sampleAllLayers:true})};assert.equal(editor.applyColorEraseRaster(request,{width:4,height:2,data:new Uint8Array(32).fill(255)}).status,'no_change');unchanged(editor,before,original,layerId)
})

test('prepared merged Magic samples bind revision/idempotency and task cancel while editing only selected transformed source',()=>{
 const {editor,layerId}=setup(makeAsset('red.png',PNG.sync.write(raster(4,2,()=>[255,0,0,255]))));apply(editor,{type:'layer.set_transform',layerId,transform:{...editor.state().manifest.layers[0].transform,flipX:true}})
 const merged=raster(4,2,x=>x<2?[0,0,255,255]:[0,255,0,255]),image={width:4,height:2,data:new Uint8Array(merged.data)},sampleBefore=image.data.slice(),original=asset(editor,layerId),request={...editor.identity(),action:erase(layerId,'magic',{sampleAllLayers:true})}
 assert.equal(editor.inspectPrepared(request),undefined);assert.throws(()=>editor.apply(request),code('INVALID_ARGUMENT'));assert.equal(asset(editor,layerId),original)
 const result=editor.applyColorEraseRaster(request,image);assert.equal(result.status,'applied');const output=PNG.sync.read(asset(editor,layerId).bytes).data;assert.deepEqual([...output.filter((_v,i)=>i%4===3)],[255,255,0,0,255,255,0,0]);assert.deepEqual(image.data,sampleBefore)
 assert.deepEqual(editor.applyColorEraseRaster(request,image),result);assert.deepEqual(editor.inspectPrepared(request),result);assert.throws(()=>editor.applyColorEraseRaster({...request,action:{...request.action,opacity:.5}},image),code('IDEMPOTENCY_CONFLICT'))
 const stale={...editor.identity(),action:erase(layerId,'magic',{sampleAllLayers:true})};assert.equal(editor.inspectPrepared(stale),undefined);apply(editor,{type:'layer.rename',layerId,name:'Changed after sampling'});const before=editor.state(),current=asset(editor,layerId)
 assert.throws(()=>editor.applyColorEraseRaster(stale,image),code('REVISION_CONFLICT'));unchanged(editor,before,current,layerId)
 const task=editor.beginTask({...editor.identity(),label:'Merged erase'}),cancelRequest={...editor.identity(),taskId:task.taskId,action:erase(layerId,'magic',{sampleAllLayers:true})};assert.equal(editor.inspectPrepared(cancelRequest,'agent'),undefined);editor.cancelTask({sessionId:editor.identity().sessionId,documentId:editor.identity().documentId,idempotencyKey:randomUUID(),taskId:task.taskId});const canceled=editor.state()
 assert.throws(()=>editor.applyColorEraseRaster(cancelRequest,image,'agent'),code('TASK_STOPPED'));unchanged(editor,canceled,current,layerId);assert.equal(editor.tasks.get(task.taskId).transactions.length,0)
})

test('adapter validation, preflight source budget, work exhaustion and mid-operation cancel never publish partial assets',()=>{
 const {editor,layerId}=setup(),before=editor.state(),original=asset(editor,layerId),action=erase(layerId,'magic',{sampleAllLayers:true}),request={...editor.identity(),action}
 for(const image of [{width:3,height:2,data:new Uint8Array(24)},{width:4,height:2,data:new Uint8Array(31)}]){assert.throws(()=>editor.applyColorEraseRaster(request,image),code('INVALID_ARGUMENT'));unchanged(editor,before,original,layerId)}
 for(const action of [erase(layerId),erase(layerId,'background')]){assert.throws(()=>prepareColorErase(stage(editor),action,undefined,{maximumWork:2}),code('RESOURCE_LIMIT'));const controller=new AbortController();controller.abort();assert.throws(()=>prepareColorErase(stage(editor),action,undefined,{signal:controller.signal}),code('CANCELED'));let reads=0;assert.throws(()=>prepareColorErase(stage(editor),action,undefined,{signal:{get aborted(){return ++reads>22}} as AbortSignal}),code('CANCELED'));assert.ok(reads>22);unchanged(editor,before,original,layerId)}
 const large=stage(editor),file=large.manifest.layers[0].imageFile!;large.assets.set(file,{...original,width:5000,height:4000});assert.throws(()=>prepareColorErase(large,erase(layerId)),code('RESOURCE_LIMIT'));assert.equal(large.assets.get(file)!.bytes,original.bytes);unchanged(editor,before,original,layerId)
 for(const invalid of [{type:'layer.background_erase',layerId,points:[[.5,.5]],size:4,sampleAllLayers:true},{type:'layer.background_erase',layerId,points:[[.5,.5]],size:4,limits:'find-edges'},{type:'layer.magic_erase',layerId,point:[.5,.5],target:'mask'}])assert.equal(mutationSchema.safeParse({...editor.identity(),action:invalid}).success,false)
})

test('production worker RPC previews stay read-only and merged commits reject stale revisions then undo exact source bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'color-erase-worker-integration-'));let worker:Worker|undefined
 try{const outfile=join(directory,'editor-worker.cjs');await build({entryPoints:['src/main/editor.worker.ts'],outfile,bundle:true,platform:'node',target:'node22',format:'cjs',logLevel:'silent',banner:{js:"const transport = require('node:worker_threads').parentPort; process.parentPort = { on: (event, callback) => transport.on(event, data => callback({data})), postMessage: value => transport.postMessage(value) };"}})
  worker=new Worker(outfile);let sequence=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();worker.on('message',message=>{const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);if(message.result.ok)p.resolve(message.result.value);else p.reject(new EditorError(message.result.error.code,message.result.error.message))});worker.on('error',error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error)}pending.clear()})
  const rpc=(method:string,params:unknown={})=>new Promise<any>((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Worker ${method} timed out`))},15000);pending.set(id,{resolve,reject,timer});worker!.postMessage({id,method,params})})
  const {editor,layerId}=setup(),source=asset(editor,layerId),path=join(directory,'worker-source.comp');await editor.saveAs(path);const opened:EditorState=await rpc('open',{path}),identity=()=>({sessionId:opened.sessionId,documentId:opened.manifest.documentID,expectedRevision:opened.revision,idempotencyKey:randomUUID()}),action=erase(layerId),request={...identity(),action}
  const preview=await rpc('strokePreview',{request,requestId:7});assert.equal(preview.requestId,7);assert.equal(PNG.sync.read(Buffer.from(preview.url.split(',')[1],'base64')).data[3],0);assert.deepEqual(await rpc('state',{sessionId:opened.sessionId}),opened)
  const image={width:4,height:2,data:new Uint8Array(raster(4,2,()=>[50,50,50,255]).data)},merged={...identity(),action:erase(layerId,'magic',{sampleAllLayers:true})};assert.equal(await rpc('inspectPrepared',{request:merged}),null)
  const result=await rpc('commitColorEraseRaster',{request:merged,image});assert.equal(result.status,'applied');assert.deepEqual(await rpc('commitColorEraseRaster',{request:merged,image}),result)
  const edited:EditorState=await rpc('state',{sessionId:opened.sessionId});assert.equal(edited.revision,opened.revision+1);assert.equal(edited.canUndo,true);await assert.rejects(rpc('commitColorEraseRaster',{request:{...merged,idempotencyKey:randomUUID()},image}),code('REVISION_CONFLICT'));assert.deepEqual(await rpc('state',{sessionId:opened.sessionId}),edited)
  await rpc('history',{request:{...identity(),expectedRevision:edited.revision,direction:'undo'}});const restored:EditorState=await rpc('state',{sessionId:opened.sessionId});assert.deepEqual(restored.manifest,opened.manifest);assert.equal(restored.canUndo,false);const info=restored.assets[0],bytes=await rpc('asset',{sessionId:opened.sessionId,file:info.file,hash:info.hash});assert.deepEqual(Buffer.from(bytes),source.bytes)
 }finally{if(worker)await worker.terminate();await rm(directory,{recursive:true,force:true})}
})

/** Production main functions are executed with an actual Editor as the worker
 * backend. Only the desktop renderer boundary is replaced with an allocation
 * sentinel: this proves pre-render ordering, not actual Electron rendering. */
function actualMainFunction(name:string,deps:Record<string,unknown>){
 const text=readFileSync(new URL('../src/main/index.ts',import.meta.url),'utf8'),source=ts.createSourceFile('main.ts',text,ts.ScriptTarget.Latest,true),fn=source.statements.find(v=>ts.isFunctionDeclaration(v)&&v.name?.text===name)
 assert.ok(fn,`Missing production main function ${name}`);const code=transformSync(fn.getText(source),{loader:'ts',format:'cjs'}).code
 return new Function(...Object.keys(deps),`${code};return ${name}`)(...Object.values(deps))
}
test('actual main apply and strokePreview refuse oversized/stale/HDR merged reads before the renderer boundary',async()=>{
 for(const scenario of ['oversized','stale','HDR','limit-boundary'] as const){
  const hdr=new Float32Array(32);for(let i=0;i<32;i+=4)hdr.set([-.125,1.1875,.001953125,.5],i)
  const {editor,layerId}=setup(scenario==='HDR'?makeHDRAsset('hdr.exr',4,2,hdr):undefined)
  if(scenario==='oversized'||scenario==='limit-boundary'){const snapshot=editor.snapshot();snapshot.manifest.width=scenario==='oversized'?4001:4000;snapshot.manifest.height=4000;editor.importDocument(snapshot.manifest,snapshot.assets,'Large document small source')}
  const original=asset(editor,layerId),before=editor.state(),action=erase(layerId,'magic',{sampleAllLayers:true}),request={...editor.identity(),expectedRevision:scenario==='stale'?before.revision+1:before.revision,action},calls:string[]=[],sentinel=new Error('Desktop render allocation boundary reached')
  const required=async(method:string,params:{request?:unknown;source?:'user'|'agent'})=>{calls.push(method);if(method==='inspectPrepared')return editor.inspectPrepared(params.request,params.source)??null;if(method==='state')return editor.state();throw new Error(`Unexpected worker mutation ${method}`)}
  const guard=actualMainFunction('assertMergedEraseRead',{required,EditorError}),dispatch=actualMainFunction('dispatch',{required,EditorError,mutationSchema,z,closing:false,closingDocuments:new Set(),assertMergedEraseRead:guard,renderPreview:async()=>{calls.push('renderPreview');throw sentinel}})
  for(const method of ['apply','strokePreview']){calls.length=0;const expected=scenario==='oversized'?'RESOURCE_LIMIT':scenario==='stale'?'REVISION_CONFLICT':scenario==='HDR'?'UNSUPPORTED_FEATURE':undefined
   await assert.rejects(dispatch(method,method==='apply'?request:{request,requestId:1},'user'),expected?code(expected):(error:unknown)=>error===sentinel)
   assert.equal(calls.includes('renderPreview'),scenario==='limit-boundary',`${scenario}/${method} render boundary`);assert.ok(!calls.includes('commitColorEraseRaster'));unchanged(editor,before,original,layerId)
  }
 }
})
