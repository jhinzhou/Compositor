import {_electron as electron,expect} from '@playwright/test'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import type {EditorState,RpcResult} from '../src/shared/contracts'
// Own development app, throwaway profile and a non-user photo. No clipboard.
if(process.env.COMPOSITOR_EXECUTABLE)throw new Error('Subject acceptance requires the isolated development app.')
const directory=await mkdtemp(join(tmpdir(),'compositor-parity-subject-')),reports:{name:string;status:string;error?:string;details?:unknown}[]=[],errors:string[]=[],timings:Record<string,number>={}
const app=await electron.launch({args:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(directory,'profile')},timeout:60000}),page=await app.firstWindow()
page.on('pageerror',error=>errors.push(error.message))
await app.evaluate(({dialog},photo)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[photo]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})},resolve('artifacts/subject-photo.jpg'))
async function result<T=any>(method:string,params?:unknown):Promise<RpcResult<T>>{return await page.evaluate(({method,params})=>window.compositor.request(method,params),{method,params}) as RpcResult<T>}
async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const value=await result<T>(method,params);assert.equal(value.ok,true,JSON.stringify(value));return (value as {ok:true;value:T}).value}
const state=()=>rpc<EditorState>('state'),identity=(value:EditorState)=>({sessionId:value.sessionId,documentId:value.manifest.documentID,expectedRevision:value.revision,idempotencyKey:randomUUID()})
const digest=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex')
const persistent=(s:EditorState)=>({revision:s.revision,manifest:s.manifest,assets:s.assets,selection:s.selection,activity:s.activity,undo:s.undoTransactionId,redo:s.redoTransactionId,canUndo:s.canUndo,canRedo:s.canRedo,modified:s.modified})
async function asset(s:EditorState,file:string){const info=s.assets.find(a=>a.file===file)!;assert.ok(info);return Buffer.from(await page.evaluate(async url=>[...new Uint8Array(await(await fetch(url)).arrayBuffer())],`compositor-asset://${s.sessionId}/${encodeURIComponent(file)}?hash=${info.hash}`))}
function draftMask(s:EditorState,layerId:string){const file=s.manifest.layers.find(l=>l.id===layerId)!.maskFile!;assert.ok(file.startsWith('data:image/png;base64,'));return PNG.sync.read(Buffer.from(file.split(',')[1],'base64'))}
async function check(name:string,run:()=>Promise<unknown>){try{const details=await run();reports.push({name,status:'PASS',details})}catch(error){reports.push({name,status:'FAIL',error:error instanceof Error?error.stack:String(error)});await page.screenshot({path:`artifacts/parity-subject/failure-${reports.length}.png`}).catch(()=>{})}}
async function openPanel(){await page.getByRole('button',{name:'Search commands',exact:true}).click();await page.getByRole('combobox',{name:'Search commands',exact:true}).fill('Select Subject / Object');await page.getByRole('combobox',{name:'Search commands',exact:true}).press('Enter');await expect(page.getByRole('region',{name:'Subject and object selection'})).toBeVisible()}
try{
 await mkdir('artifacts/parity-subject',{recursive:true});await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000});await rpc('newDocument');await rpc('importDialog');
 const baseline=await state(),layer=baseline.manifest.layers.find(l=>l.imageFile)!;assert.ok(layer)
 const sourceHash=digest(await asset(baseline,layer.imageFile!)),request={...identity(baseline),action:{type:'selection.subject',layerId:layer.id,removeBackground:true,sampleAllLayers:false,operation:'replace',matteQuality:'basic',refineEdges:12,matteContrast:25,shiftEdge:0}}
 let advanced:{state:EditorState;url:string;requestId:number;cacheReady:boolean},advancedRequest:any
 await check('Basic preview leaves the document, source pixels and history unchanged',async()=>{
  const start=performance.now(),preview=await rpc('subjectPreview',{request,requestId:1});timings.basicMs=performance.now()-start
  assert.equal(preview.requestId,1);assert.equal(preview.cacheReady,true);assert.ok(preview.url.startsWith('data:image/png;base64,'));const mask=draftMask(preview.state,layer.id);assert.ok(mask.data.some((v:number,i:number)=>i%4===0&&v<240));assert.deepEqual(persistent(await state()),persistent(baseline));assert.equal(digest(await asset(await state(),layer.imageFile!)),sourceHash)
  return {maskWidth:mask.width,maskHeight:mask.height,elapsedMs:timings.basicMs}
 })
 await check('Advanced parameters produce a new draft using the same source without document history',async()=>{
  const basic=await rpc('subjectPreview',{request,requestId:2});advancedRequest={...request,action:{...request.action,matteQuality:'advanced',refineEdges:8,matteContrast:70,shiftEdge:-2}}
  const start=performance.now();advanced=await rpc('subjectPreview',{request:advancedRequest,requestId:3});timings.advancedMs=performance.now()-start
  assert.notEqual(digest(draftMask(basic.state,layer.id).data),digest(draftMask(advanced.state,layer.id).data));assert.deepEqual(persistent(await state()),persistent(baseline));return {elapsedMs:timings.advancedMs}
 })
 await check('Apply commits the exact preview mask once; Undo preserves original image pixels',async()=>{
  assert.ok(advanced);const applied=await rpc('apply',advancedRequest),committed=await state();assert.equal(applied.status,'applied');assert.equal(committed.revision,baseline.revision+1);assert.notEqual(committed.undoTransactionId,baseline.undoTransactionId)
  const actual=PNG.sync.read(await asset(committed,committed.manifest.layers.find(l=>l.id===layer.id)!.maskFile!)),expected=draftMask(advanced.state,layer.id);assert.equal(actual.width,expected.width);assert.equal(actual.height,expected.height);assert.deepEqual(actual.data,expected.data);assert.equal(digest(await asset(committed,layer.imageFile!)),sourceHash)
  const duplicate=await rpc('apply',advancedRequest);assert.equal(duplicate.revision,committed.revision);assert.equal((await state()).revision,committed.revision)
  await rpc('history',{...identity(await state()),direction:'undo'});const undone=await state();assert.equal(undone.manifest.layers.find(l=>l.id===layer.id)!.maskFile,layer.maskFile);assert.equal(digest(await asset(undone,layer.imageFile!)),sourceHash)
  return {maskHash:digest(actual.data),idempotent:true}
 })
 await check('Canceling a new coarse inference cannot mutate document/history or leave a mask',async()=>{
  const before=await state(),pendingRequest={...identity(before),action:request.action}
  await page.evaluate(input=>{(window as any).subjectPending=window.compositor.request('subjectPreview',input)},{request:pendingRequest,requestId:4});await rpc('cancelSubjectPreview',{sessionId:before.sessionId});const canceled=await page.evaluate(()=>(window as any).subjectPending) as RpcResult
  assert.equal(canceled.ok,false,JSON.stringify(canceled));assert.equal((canceled as any).error.code,'CANCELED');assert.deepEqual(persistent(await state()),persistent(before));return {code:(canceled as any).error.code}
 })
 await check('Actual panel supports Basic→Advanced preview→Cancel and then preview→Apply',async()=>{
  await openPanel();const panel=page.getByRole('region',{name:'Subject and object selection'}),before=await state();await panel.getByRole('button',{name:'Remove Background',exact:true}).click();await expect(panel.getByRole('img',{name:'Background removal preview'})).toBeVisible({timeout:60000});assert.deepEqual(persistent(await state()),persistent(before));
  await panel.getByLabel('Matte Quality',{exact:true}).selectOption('advanced');await expect(panel.getByLabel('Matte Contrast value',{exact:true})).toBeVisible();await panel.getByLabel('Matte Contrast value',{exact:true}).fill('80');await panel.getByLabel('Matte Contrast value',{exact:true}).blur();await expect(panel.getByRole('button',{name:'Apply background removal',exact:true})).toBeEnabled({timeout:60000});await panel.getByRole('button',{name:'Cancel preview',exact:true}).click();await expect(panel.getByRole('img',{name:'Background removal preview'})).toHaveCount(0);assert.deepEqual(persistent(await state()),persistent(before));
  await panel.getByRole('button',{name:'Remove Background',exact:true}).click();await expect(panel.getByRole('img',{name:'Background removal preview'})).toBeVisible({timeout:60000});await expect(panel.getByRole('button',{name:'Apply background removal',exact:true})).toBeEnabled({timeout:60000});await panel.getByRole('button',{name:'Apply background removal',exact:true}).click();await expect.poll(async()=>(await state()).revision,{timeout:60000}).toBe(before.revision+1);await expect(panel.getByRole('img',{name:'Background removal preview'})).toHaveCount(0);assert.ok((await state()).manifest.layers.find(l=>l.id===layer.id)!.maskFile);await page.screenshot({path:'artifacts/parity-subject/applied-advanced.png'})
 })
 assert.deepEqual(errors,[])
}finally{
 await writeFile('artifacts/parity-subject/acceptance.json',JSON.stringify({scope:'Isolated development Electron Subject preview/Apply acceptance; U2NetP differs from native Vision',photo:'artifacts/subject-photo.jpg',reports,timings,errors},null,2));console.log(JSON.stringify({reports,timings,errors},null,2));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(directory,{recursive:true,force:true})
}
assert.ok(reports.length===5&&reports.every(report=>report.status==='PASS'),JSON.stringify(reports));assert.deepEqual(errors,[])
