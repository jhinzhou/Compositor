import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type { EditResult,EditorState, EditAction } from '../src/shared/contracts'
const [command, server, connection] = process.argv.slice(2)
const version = (JSON.parse(await readFile('package.json', 'utf8')) as { version: string }).version
if (!command || !server || !connection) throw new Error('Usage: tsx scripts/smoke-packaged-mcp-alpha29.ts <app executable> <packaged server.cjs> <automation.json>')
const legacyChecks=['Packaged Electron launches its MCP stdio bundle inside app.asar', 'Twelve tools, protocol v2, live document and real PNG preview are available', 'Packaged task.begin and task.finish execute against the desktop authority', 'Packaged MCP paints and saves/loads gray selection coverage without changing source assets', 'Packaged MCP applies non-destructive mask Density/Feather without rewriting mask PNG', 'Packaged MCP refines edge selection through the real isolated worker and Undo restores coverage without source asset changes']
const newChecks:string[]=[]
let legacyComplete=false
const client = new Client({ name: 'packaged-mcp-check', version: '0.1.0' })
const env = Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
const transport = new StdioClientTransport({ command, args: [server, '--connection', connection], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' })
transport.stderr?.on('data', data => process.stderr.write(data))
try {
  await client.connect(transport)
  assert.equal((await client.listTools()).tools.length, 12)
  const capabilities = await client.callTool({ name: 'app.get_capabilities', arguments: {} })
  assert.notEqual(capabilities.isError, true, JSON.stringify(capabilities))
  assert.equal((capabilities.structuredContent as { version: string; protocolVersion: number }).version, version)
  assert.equal((capabilities.structuredContent as { protocolVersion: number }).protocolVersion, 2)
  const response = await client.callTool({ name: 'document.get_state', arguments: {} })
  assert.notEqual(response.isError, true, JSON.stringify(response))
  const state = response.structuredContent as EditorState
  const result = await client.callTool({ name: 'document.preview', arguments: { sessionId: state.sessionId, expectedRevision: state.revision, maxDimension: 512 } })
  assert.notEqual(result.isError, true, JSON.stringify(result))
  const image = (result.content as { type: string; data?: string }[]).find(item => item.type === 'image')!
  const png = PNG.sync.read(Buffer.from(image.data!, 'base64'))
  assert.ok(png.width > 0 && png.height > 0)
  const began = await client.callTool({ name: 'task.begin', arguments: { sessionId: state.sessionId, documentId: state.manifest.documentID, expectedRevision: state.revision, idempotencyKey: randomUUID(), label: 'Packaged task lifecycle' } })
  assert.notEqual(began.isError, true, JSON.stringify(began))
  const taskId = (began.structuredContent as { taskId: string }).taskId
  const finished = await client.callTool({ name: 'task.finish', arguments: { sessionId: state.sessionId, documentId: state.manifest.documentID, taskId, idempotencyKey: randomUUID(), state: 'completed' } })
  assert.equal((finished.structuredContent as { state: string }).state, 'completed')
  const liveState = async (): Promise<EditorState> => {
    const value = await client.callTool({ name: 'document.get_state', arguments: {} })
    assert.notEqual(value.isError, true, JSON.stringify(value))
    return value.structuredContent as EditorState
  }
  const apply = async (action: EditAction): Promise<EditorState> => {
    const before = await liveState()
    const value = await client.callTool({ name: 'document.apply', arguments: {
      sessionId: before.sessionId, documentId: before.manifest.documentID,
      expectedRevision: before.revision, idempotencyKey: randomUUID(), action
    } })
    assert.notEqual(value.isError, true, JSON.stringify(value))
    return liveState()
  }
  const blank = await apply({ type: 'layer.add_blank', name: 'Packaged MCP alpha9' })
  const layerId = blank.manifest.layers.find(layer => layer.name === 'Packaged MCP alpha9')!.id
  const sourceAssets = blank.assets
  const painted = await apply({ type: 'selection.paint', points: [[16,16]], size: 8, hardness: 1, opacity: 1, value: .5, initial: 'empty' })
  assert.deepEqual(painted.assets, sourceAssets, 'Selection painting must not rewrite image assets')
  assert.ok(painted.selection?.shapes.some(shape => shape.raster?.runs.some(run => run[3] === 128)), 'MCP paint retains gray coverage')
  const saved = await apply({ type: 'selection.save_named', name: 'Packaged gray', overwrite: false })
  const channel = saved.manifest.namedSelections!.find(item => item.name === 'Packaged gray')!
  assert.ok(channel.runs.some(run => run[3] === 128))
  await apply({ type: 'selection.fill', value: 0, opacity: 1 })
  const loaded = await apply({ type: 'selection.load_named', name: 'Packaged gray', operation: 'replace' })
  assert.ok(loaded.selection?.shapes.some(shape => shape.raster?.runs.some(run => run[3] === 128)))
  assert.deepEqual(loaded.assets, sourceAssets)
  const masked = await apply({ type: 'layer.mask', layerId, operation: 'reveal' })
  const maskAssets = masked.assets
  const properties = await apply({ type: 'layer.mask_properties', layerId, density: .4, feather: 2 })
  const layer = properties.manifest.layers.find(item => item.id === layerId)!
  assert.equal(layer.maskDensity, .4)
  assert.equal(layer.maskFeather, 2)
  assert.deepEqual(properties.assets, maskAssets, 'Mask properties must preserve the source mask PNG')
  await apply({type:'selection.set',selection:null})
  await apply({type:'layer.fill',layerId,color:[.2,.4,.7,1],target:'image'})
  await apply({type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,24,32],feather:0}]}})
  const edgeBefore=await liveState()
  const refined=await apply({type:'selection.refine_edges',layerId,output:'selection',boundaryRadius:2,sampleRadius:4,guidedRadius:1,region:[0,0,40,40],strokes:[]})
  assert.equal(refined.revision,edgeBefore.revision+1)
  assert.deepEqual(refined.assets,edgeBefore.assets,'Edge selection output preserves source images and mask assets')
  const undo=await client.callTool({name:'history.undo',arguments:{sessionId:refined.sessionId,documentId:refined.manifest.documentID,expectedRevision:refined.revision,idempotencyKey:randomUUID(),transactionId:refined.undoTransactionId}})
  assert.notEqual(undo.isError,true,JSON.stringify(undo))
  const edgeUndone=await liveState();assert.deepEqual(edgeUndone.selection,edgeBefore.selection);assert.deepEqual(edgeUndone.assets,edgeBefore.assets)
  legacyComplete=true
  // Bound the owned alpha29 exercise to a small canvas and a new opaque raster.
  await apply({type:'selection.set',selection:null})
  await apply({type:'document.crop',x:0,y:0,width:64,height:48,deleteCroppedPixels:false})
  const fixture=await apply({type:'layer.add_blank',name:'Packaged alpha29 tools'})
  const fixtureId=fixture.manifest.layers.find(l=>l.name==='Packaged alpha29 tools')!.id
  // Pixel assertions use an isolated raster and explicit nearest placement, not the default Mitchell display filter.
  for(const prior of fixture.manifest.layers.filter(layer=>layer.id!==fixtureId&&layer.isVisible))await apply({type:'layer.set_visibility',layerId:prior.id,visible:false})
  await apply({type:'layer.set_transform',layerId:fixtureId,transform:{...fixture.manifest.layers.find(layer=>layer.id===fixtureId)!.transform,sampling:'Nearest'}})
  await apply({type:'layer.fill',layerId:fixtureId,color:[.25,.5,.75,1],target:'image'})
  const identity=(value:EditorState)=>({sessionId:value.sessionId,documentId:value.manifest.documentID,expectedRevision:value.revision,idempotencyKey:randomUUID()})
  const imageFile=(value:EditorState,id=fixtureId)=>{const layer=value.manifest.layers.find(l=>l.id===id);assert.ok(layer?.imageFile);return layer.imageFile}
  const info=(value:EditorState,id=fixtureId)=>value.assets.find(a=>a.file===imageFile(value,id))!
  async function imageAtState(){const value=await liveState(),response=await client.callTool({name:'document.preview',arguments:{sessionId:value.sessionId,expectedRevision:value.revision,maxDimension:512}});assert.notEqual(response.isError,true,JSON.stringify(response));const item=response.content.find(v=>v.type==='image') as {data:string};const image=PNG.sync.read(Buffer.from(item.data,'base64'));assert.equal(image.width,64);assert.equal(image.height,48);return image}
  const pixel=(image:PNG,x:number,y:number)=>Array.from(image.data.subarray((y*image.width+x)*4,(y*image.width+x)*4+4))
  async function mutate(action:EditAction){const before=await liveState(),request={...identity(before),action},response=await client.callTool({name:'document.apply',arguments:request});assert.notEqual(response.isError,true,JSON.stringify(response));const result=response.structuredContent as EditResult,after=await liveState();assert.equal(after.revision,before.revision+(result.status==='applied'?1:0));return {before,after,request,result}}
  async function retry(request:unknown,result:EditResult){const before=await liveState(),response=await client.callTool({name:'document.apply',arguments:request as Record<string,unknown>});assert.notEqual(response.isError,true,JSON.stringify(response));assert.deepEqual(response.structuredContent,result);assert.equal((await liveState()).revision,before.revision)}
  async function undoTo(before:EditorState,after:EditorState){assert.ok(after.undoTransactionId);const response=await client.callTool({name:'history.undo',arguments:{...identity(after),transactionId:after.undoTransactionId}});assert.notEqual(response.isError,true,JSON.stringify(response));const restored=await liveState();assert.equal(restored.revision,after.revision+1);assert.deepEqual(restored.manifest,before.manifest);assert.deepEqual(restored.assets,before.assets);assert.deepEqual(restored.selection,before.selection);return restored}
  async function rejected(name:string,args:Record<string,unknown>){const before=await liveState();let response:Awaited<ReturnType<typeof client.callTool>>|undefined,protocolRejected=false;try{response=await client.callTool({name,arguments:args})}catch(cause){assert.ok(cause instanceof Error);assert.match(cause.message,/invalid|schema|argument|parameter|revision|source|layer|reference/i);protocolRejected=true}if(response)assert.equal(response.isError,true,JSON.stringify(response));else assert.equal(protocolRejected,true);const after=await liveState();assert.equal(after.revision,before.revision);assert.deepEqual(after.manifest,before.manifest);assert.deepEqual(after.assets,before.assets);assert.deepEqual(after.selection,before.selection);assert.deepEqual(after.historyBrush,before.historyBrush)}

  const captured=await mutate({type:'document.history_source',operation:'capture',label:'Packaged alpha29 source'})
  assert.equal(captured.result.status,'no_change');assert.equal(captured.after.undoTransactionId,captured.before.undoTransactionId);assert.deepEqual(captured.after.assets,captured.before.assets);const historyId=captured.after.historyBrush!.sourceId!;assert.ok(historyId);assert.ok(captured.after.historyBrush!.snapshots.some(s=>s.id===historyId));await retry(captured.request,captured.result)
  newChecks.push('Packaged History source capture is tool state with explicit sourceId, preserves revision/Undo/assets and caches retry')

  const pencil=await mutate({type:'layer.paint',layerId:fixtureId,tip:'pencil',erase:false,points:[[12.2,12.2],[28.2,12.2]],size:1,hardness:1,opacity:1,color:[1,0,0,1],target:'image'})
  assert.equal(pencil.result.status,'applied');assert.notEqual(info(pencil.after).hash,info(pencil.before).hash);const pencilPNG=await imageAtState();assert.deepEqual(pixel(pencilPNG,20,12),[255,0,0,255]);assert.deepEqual(pixel(pencilPNG,20,11),[64,128,191,255]);await retry(pencil.request,pencil.result);await undoTo(pencil.before,pencil.after)
  newChecks.push('Packaged Pencil action paints one hard pixel row, changes original asset, caches one transaction and exact Undo restores source')

  const bucket=await mutate({type:'layer.bucket_fill',layerId:fixtureId,point:[12,14],color:[.8,.2,.1,1],tolerance:0,antialiased:false,contiguous:true,opacity:1,sampleAllLayers:false})
  assert.equal(bucket.result.status,'applied');assert.notEqual(info(bucket.after).hash,info(bucket.before).hash);assert.deepEqual(pixel(await imageAtState(),20,20),[204,51,26,255]);await retry(bucket.request,bucket.result);await undoTo(bucket.before,bucket.after)
  const mergedBucket=await mutate({type:'layer.bucket_fill',layerId:fixtureId,point:[12,14],color:[.8,.2,.1,1],tolerance:0,antialiased:false,contiguous:true,opacity:1,sampleAllLayers:true});assert.equal(mergedBucket.result.status,'applied');assert.deepEqual(pixel(await imageAtState(),20,20),[204,51,26,255]);await undoTo(mergedBucket.before,mergedBucket.after)
  newChecks.push('Packaged Paint Bucket performs current-layer and real merged classification, changes RGB source and preserves exact Undo')

  for(const kind of ['dodge','burn','sponge'] as const){const tone=await mutate({type:'layer.tonal_brush',layerId:fixtureId,kind,points:[[32.5,24.5]],size:12,hardness:1,amount:.5,range:'midtones',protectTones:true,mode:'desaturate',vibrance:true});assert.equal(tone.result.status,'applied');assert.notEqual(info(tone.after).hash,info(tone.before).hash);const png=await imageAtState();assert.notDeepEqual(pixel(png,32,24).slice(0,3),[64,128,191]);assert.equal(pixel(png,32,24)[3],255);assert.deepEqual(pixel(png,2,2),[64,128,191,255]);await retry(tone.request,tone.result);await undoTo(tone.before,tone.after)}
  newChecks.push('Packaged Dodge/Burn/Sponge actions change local RGB, preserve alpha/outside, cache atomic results and Undo exact source; tone parity remains separate')

  const filled=await mutate({type:'layer.fill',layerId:fixtureId,color:[1,0,0,1],target:'image'})
  const restored=await mutate({type:'layer.history_brush',layerId:fixtureId,sourceId:historyId,kind:'history',points:[[32.5,24.5]],size:16,hardness:1,opacity:1,brushModel:'compositor',artSize:8})
  assert.equal(restored.result.status,'applied');const historyPNG=await imageAtState();assert.deepEqual(pixel(historyPNG,32,24),[64,128,191,255]);assert.deepEqual(pixel(historyPNG,2,2),[255,0,0,255]);await retry(restored.request,restored.result);await undoTo(restored.before,restored.after)
  const art=await mutate({type:'layer.history_brush',layerId:fixtureId,sourceId:historyId,kind:'art-history',points:[[32.5,24.5]],size:16,hardness:1,opacity:1,brushModel:'compositor',artSize:8});assert.equal(art.result.status,'applied');assert.deepEqual(pixel(await imageAtState(),32,24),[64,128,191,255]);await undoTo(art.before,art.after);await undoTo(filled.before,await liveState())
  newChecks.push('Packaged History and Art History restore selected retained raster locally with sourceId validation, one transaction/retry and exact Undo')

  const reservoir={premultipliedColor:[1,0,0,1] as [number,number,number,number],paintRemaining:.75}
  const mixer=await mutate({type:'layer.mixer_brush',layerId:fixtureId,points:[[24,24],[40,24]],size:8,hardness:1,opacity:1,spacing:.25,wet:.8,load:.75,mix:.5,flow:1,color:[1,0,0,1],cleanAfterStroke:false,loadAfterStroke:false,colorPickup:'average',protectAlpha:true,reservoir})
  assert.equal(mixer.result.status,'applied');assert.notEqual(info(mixer.after).hash,info(mixer.before).hash);assert.ok(mixer.result.mixerReservoir);assert.notDeepEqual(mixer.result.mixerReservoir,reservoir);assert.ok(mixer.result.mixerReservoir.paintRemaining>=0&&mixer.result.mixerReservoir.paintRemaining<=1);assert.notDeepEqual(pixel(await imageAtState(),32,24),[64,128,191,255]);await retry(mixer.request,mixer.result);await undoTo(mixer.before,mixer.after)
  assert.ok(mixer.request.action.type==='layer.mixer_brush');const dryMixer=await mutate({...mixer.request.action,wet:0,mix:0});assert.equal(dryMixer.result.status,'applied');assert.ok(dryMixer.result.mixerReservoir&&dryMixer.result.mixerReservoir.paintRemaining<reservoir.paintRemaining);await retry(dryMixer.request,dryMixer.result);await undoTo(dryMixer.before,dryMixer.after)
  newChecks.push('Packaged Mixer returns next explicit reservoir only after real pixel commit; retry returns identical reservoir/transaction and Undo restores asset')

  const frameBefore=await liveState(),frameRequest={...identity(frameBefore),label:'Packaged atomic frame',actions:[{type:'frame.create',name:'Packaged alpha29 frame',kind:'rectangle',bounds:[4,4,24,16],clientRef:'newFrame'},{type:'frame.place',layerId:{ref:'newFrame'},sourceId:fixtureId,fit:'cover'},{type:'layer.set_visibility',layerId:fixtureId,visible:false}]},frameResponse=await client.callTool({name:'document.apply_batch',arguments:frameRequest})
  assert.notEqual(frameResponse.isError,true,JSON.stringify(frameResponse));const frameResult=frameResponse.structuredContent as EditResult,frameAfter=await liveState(),frameId=frameResult.createdIds!.newFrame;assert.ok(frameId);assert.equal(frameAfter.revision,frameBefore.revision+1);const frameLayer=frameAfter.manifest.layers.find(l=>l.id===frameId)!;assert.deepEqual(frameLayer.frame,{kind:'rectangle',bounds:[4,4,24,16]});assert.equal(frameLayer.maskLinked,false);assert.ok(frameLayer.maskFile);assert.equal(info(frameAfter,frameId).hash,info(frameBefore).hash);const framePNG=await imageAtState();assert.deepEqual(pixel(framePNG,16,12),[64,128,191,255]);assert.notDeepEqual(pixel(framePNG,1,1),[64,128,191,255]);const frameRetry=await client.callTool({name:'document.apply_batch',arguments:frameRequest});assert.deepEqual(frameRetry.structuredContent,frameResult);assert.equal((await liveState()).revision,frameAfter.revision)
  const content=await mutate({type:'frame.set_content_transform',layerId:frameId,transform:{...frameLayer.transform,origin:[frameLayer.transform.origin[0]+12,frameLayer.transform.origin[1]]}});assert.deepEqual(content.after.manifest.layers.find(l=>l.id===frameId)!.frame,frameLayer.frame);assert.equal(info(content.after,frameId).hash,info(frameAfter,frameId).hash);assert.notDeepEqual(pixel(await imageAtState(),8,8),pixel(framePNG,8,8));await undoTo(content.before,content.after)
  const resized=await mutate({type:'frame.set_bounds',layerId:frameId,bounds:[5,5,20,12],kind:'ellipse'});assert.deepEqual(resized.after.manifest.layers.find(l=>l.id===frameId)!.frame,{kind:'ellipse',bounds:[5,5,20,12]});assert.equal(info(resized.after,frameId).hash,info(frameAfter,frameId).hash);await undoTo(resized.before,resized.after);await undoTo(frameBefore,await liveState())
  newChecks.push('Packaged Frame create/place uses atomic clientRef/createdIds, retains source asset, independently edits content/boundary and one Undo removes its entire batch')

  const vector:import('../src/shared/vector-path').VectorPath={fillRule:'nonzero',subpaths:[{id:'curve',closed:true,knots:[{id:'a0',point:[32,18],outHandle:[38,8]},{id:'a1',point:[52,18],inHandle:[46,8]},{id:'a2',point:[52,36]},{id:'a3',point:[32,36]}]}]}
  const createdPath=await mutate({type:'document.path_set',name:'Packaged cubic path',path:vector});assert.equal(createdPath.result.status,'applied');assert.deepEqual(createdPath.after.assets,createdPath.before.assets);const pathId=createdPath.after.manifest.vectorPaths!.find(p=>p.name==='Packaged cubic path')!.id;assert.ok(pathId)
  const selectedPath=await mutate({type:'selection.from_path',pathId,operation:'replace',antialiased:false});assert.equal(selectionCoverage(selectedPath.after.selection,42.5,26.5),1);assert.equal(selectionCoverage(selectedPath.after.selection,2.5,2.5),0);assert.deepEqual(selectedPath.after.assets,selectedPath.before.assets)
  const pathFill=await mutate({type:'layer.path_fill',layerId:fixtureId,pathId,color:[0,1,0,1]});assert.equal(pathFill.result.status,'applied');assert.deepEqual(pathFill.after.selection,pathFill.before.selection);assert.notEqual(info(pathFill.after).hash,info(pathFill.before).hash);const fillPNG=await imageAtState();assert.deepEqual(pixel(fillPNG,42,26),[0,255,0,255]);assert.deepEqual(pixel(fillPNG,2,2),[64,128,191,255]);await undoTo(pathFill.before,pathFill.after)
  const pathMask=await mutate({type:'layer.path_mask',layerId:fixtureId,pathId});const maskedPathLayer=pathMask.after.manifest.layers.find(l=>l.id===fixtureId)!;assert.equal(maskedPathLayer.vectorMask!.pathId,pathId);assert.ok(maskedPathLayer.maskFile);assert.equal(info(pathMask.after).hash,info(pathMask.before).hash);const oldMask=pathMask.after.assets.find(a=>a.file===maskedPathLayer.maskFile)!.hash
  const movedVector=structuredClone(vector);movedVector.subpaths[0].knots[0].point=[36,18];const editedPath=await mutate({type:'document.path_set',pathId,path:movedVector});assert.notEqual(editedPath.after.assets.find(a=>a.file===maskedPathLayer.maskFile)!.hash,oldMask);assert.equal(info(editedPath.after).hash,info(editedPath.before).hash);await undoTo(editedPath.before,editedPath.after)
  const deletedPath=await mutate({type:'document.path_delete',pathId});assert.equal(deletedPath.after.manifest.vectorPaths!.some(p=>p.id===pathId),false);await undoTo(deletedPath.before,deletedPath.after)
  newChecks.push('Packaged cubic Path persists handles, converts to selection, fills pixels, installs vector mask, regenerates linked mask on edit and supports delete/Undo')

  const invalidBefore=await liveState();await rejected('document.apply',{...identity(invalidBefore),action:{type:'layer.bucket_fill',layerId:fixtureId,point:[1,1],color:[2,0,0,1]}})
  await rejected('document.apply',{...identity(await liveState()),expectedRevision:invalidBefore.revision-1,action:{type:'layer.bucket_fill',layerId:fixtureId,point:[1,1],color:[1,0,0,1]}})
  await rejected('document.apply',{...identity(await liveState()),action:{type:'layer.history_brush',layerId:fixtureId,sourceId:randomUUID(),kind:'history',points:[[32,24]],size:8}})
  await rejected('document.apply_batch',{...identity(await liveState()),actions:[{type:'frame.create',name:'Rejected partial frame',kind:'rectangle',bounds:[2,2,8,8],clientRef:'badFrame'},{type:'frame.place',layerId:{ref:'badFrame'},sourceId:randomUUID(),fit:'cover'}]})
  await rejected('document.apply_batch',{...identity(await liveState()),actions:[{type:'document.history_source',operation:'clear'},{type:'layer.rename',layerId:fixtureId,name:'Must not rename'}]})
  newChecks.push('Packaged API rejects malformed color, stale revision/source and failed frame/source-state batches without losing source assets, selections, metadata or tool state')

  await mkdir('artifacts', { recursive: true })
  const validation = { status: 'PASS', version, platform: process.platform, checks:[...legacyChecks,...newChecks], previewSize: [png.width, png.height] }
  await writeFile('artifacts/packaged-mcp-alpha29-validation.json', JSON.stringify(validation, null, 2))
  console.log(JSON.stringify(validation, null, 2))
}catch(cause){await mkdir('artifacts',{recursive:true});await writeFile('artifacts/packaged-mcp-alpha29-validation.json',JSON.stringify({status:'FAIL',version,platform:process.platform,checks:[...(legacyComplete?legacyChecks:[]),...newChecks],error:cause instanceof Error?cause.stack??cause.message:String(cause)},null,2));throw cause} finally { await client.close() }
