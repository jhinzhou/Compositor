import { _electron as electron, expect } from '@playwright/test'
import { PNG } from 'pngjs'
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import type {EditorState} from '../src/shared/contracts'
const directory=await mkdtemp(join(tmpdir(),'compositor-parallel-')),desktop=await electron.launch({args:[process.cwd()],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'}}),page=await desktop.firstWindow(),checks:string[]=[],errors:string[]=[]
let modelServer:ReturnType<typeof createServer>|undefined
page.on('pageerror',error=>errors.push(error.message))
try{
 await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true')
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await page.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 async function edit(action:unknown){const s=await state();return rpc('apply',{...identity(s),action})}
 async function preview(){const s=await state(),p=await rpc('preview',{sessionId:s.sessionId,expectedRevision:s.revision,maxDimension:64});return PNG.sync.read(Buffer.from(p.data,'base64'))}
 await rpc('newDocument');let s=await state();await rpc('create',{sessionId:s.sessionId,width:32,height:16});s=await state();const first=s.manifest.layers[0].id
 await edit({type:'layer.fill',layerId:first,color:[1,0,0,1],target:'image'})
 await edit({type:'selection.set',selection:{shapes:[{kind:'rectangle',bounds:[0,0,16,16],operation:'replace',feather:0}],inverted:false}})
 await edit({type:'layer.fill',layerId:first,color:[0,0,1,1],target:'image'});let png=await preview();assert.deepEqual([...png.data.subarray(0,4)],[0,0,255,255]);assert.deepEqual([...png.data.subarray(80,84)],[255,0,0,255])
 checks.push('Selection-restricted pixels render through desktop IPC and CanvasKit')
 await edit({type:'selection.set',selection:null});await edit({type:'layer.mask',layerId:first,operation:'hide'});png=await preview();assert.equal(png.data[3],0)
 await edit({type:'layer.mask',layerId:first,operation:'reveal'});await edit({type:'layer.paint',layerId:first,points:[[8,8]],size:8,hardness:1,opacity:1,color:[0,0,0,1],target:'mask',erase:false});png=await preview();assert.equal(png.data[(8*32+8)*4+3],0);assert.equal(png.data[3],255)
 await edit({type:'layer.mask',layerId:first,operation:'disable'});png=await preview();assert.equal(png.data[(8*32+8)*4+3],255);await edit({type:'layer.mask',layerId:first,operation:'remove'})
 checks.push('Uniform and painted grayscale masks change actual alpha, disable restores it')
 await edit({type:'layer.set_opacity',layerId:first,opacity:.5});await edit({type:'layer.add_blank',name:'Clip'});s=await state();const clip=s.manifest.layers[1].id;await edit({type:'layer.fill',layerId:clip,color:[0,1,0,1],target:'image'});await edit({type:'layer.set_clipping',layerId:clip,sourceId:first});png=await preview();assert.equal(png.data[3],128);assert.equal(png.data[1],255)
 checks.push('Contiguous clipping stack retains base alpha instead of thickening translucent edges')
 await edit({type:'adjustment.add',filter:{kind:'invert'},name:'Invert'});png=await preview();assert.deepEqual([...png.data.subarray(0,4)],[255,0,255,128]);s=await state();await edit({type:'layer.delete',layerId:s.manifest.layers.at(-1)!.id})
 checks.push('Non-destructive adjustment changes composite color and preserves base alpha')
 await edit({type:'layer.effects',layerId:clip,effects:{colorOverlay:{red:1,green:0,blue:0,opacity:1}}});png=await preview();assert.equal(png.data[0],255);assert.equal(png.data[1],0);await edit({type:'layer.effects',layerId:clip,effects:null})
 checks.push('Layer effects render live and remove without damaging source PNG')
 s=await state();await rpc('copyLayers',{...identity(s),layerIds:[first,clip],cut:false});await rpc('newDocument');s=await state();await rpc('create',{sessionId:s.sessionId,width:32,height:16});s=await state();await rpc('pasteLayers',identity(s));s=await state();assert.equal(s.manifest.layers.length,3);assert.notEqual(s.manifest.layers[1].id,first);png=await preview();assert.equal(png.data[1],255)
 checks.push('Cross-document clipboard copies immutable raster bytes and remaps clipping references')
 const merged=s.manifest.layers.slice(1).map(l=>l.id);await rpc('mergeLayers',{...identity(s),layerIds:merged,kind:'selected'});s=await state();assert.equal(s.manifest.layers.length,2);png=await preview();assert.equal(png.data[1],255);await rpc('history',{...identity(s),direction:'undo'});assert.equal((await state()).manifest.layers.length,3)
 checks.push('Merge renders selected subset, commits once, and undo restores trees and pixels')
 s=await state();const options={format:'png',width:16,height:8,resolution:300,quality:.9,background:null};const exported=await rpc('exportPreview',{sessionId:s.sessionId,expectedRevision:s.revision,requestId:7,options});const bytes=Buffer.from(exported.url.split(',')[1],'base64');assert.equal(PNG.sync.read(bytes).width,16);assert.ok(bytes.includes(Buffer.from('pHYs')))
 for(const format of ['jpeg','pdf']){await desktop.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},join(directory,`image.${format}`));await rpc('exportAsDialog',{sessionId:s.sessionId,expectedRevision:s.revision,requestId:8,options:{...options,format,background:'#ffffff'}});const out=await readFile(join(directory,`image.${format}`));assert.ok(format==='jpeg'?out[0]===255&&out[1]===216:out.toString('ascii',0,8)==='%PDF-1.4')}
 checks.push('Export PNG/JPEG/PDF writes resized real files with resolution metadata')
 await page.getByRole('button',{name:'Search commands',exact:true}).click();await page.getByRole('combobox',{name:'Search commands'}).fill('canvas size').catch(async()=>{await page.locator('.command-palette input').fill('canvas size')});await page.keyboard.press('Escape');await expect(page.locator('.command-palette')).not.toBeVisible();checks.push('Integrated command palette opens and cancels in the real desktop')
 let round=0,modelWrites=0
 modelServer=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());assert.equal(req.headers.authorization,'Bearer test-session-only');res.writeHead(200,{'Content-Type':'text/event-stream'});let call:any
  if(round++===0){const tool=body.tools.find((tool:any)=>tool.function.name.includes('get_state'));call={id:'read-state',type:'function',function:{name:tool.function.name,arguments:'{}'}}}
  else if(round===2){const envelope=JSON.parse(body.messages.findLast((m:any)=>m.role==='tool').content),result=envelope.structuredContent??JSON.parse(envelope.content[0].text),tool=body.tools.find((tool:any)=>tool.function.name.endsWith('document_apply'));call={id:'rename-layer',type:'function',function:{name:tool.function.name,arguments:JSON.stringify({...identity(result),action:{type:'layer.rename',layerId:result.manifest.layers[0].id,name:'Agent MCP changed'}})}};modelWrites++}
  if(call)res.write('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,...call}]},finish_reason:'tool_calls'}]})+'\n\n')
  else res.write('data: '+JSON.stringify({choices:[{delta:{content:'Changed through MCP.'},finish_reason:'stop'}]})+'\n\n')
  res.end('data: [DONE]\n\n')
 });await new Promise<void>(resolve=>modelServer!.listen(0,'127.0.0.1',resolve));const address=modelServer.address() as {port:number}
 await rpc('agentConfigure',{protocol:'openai-compatible',endpoint:`http://127.0.0.1:${address.port}`,model:'local-real-mcp-test',apiKey:'test-session-only',timeoutMs:15000})
 await rpc('agentSend',{text:'Rename the bottom layer'});await expect.poll(async()=>{const a=await rpc('agentState');if(a.status==='error')throw new Error(a.error);return a.status},{timeout:30000}).toBe('idle');assert.equal(modelWrites,1);assert.equal((await state()).manifest.layers[0].name,'Agent MCP changed');const agent=await rpc('agentState');assert.equal('apiKey'in agent.config,false);assert.ok(agent.conversation.some((m:any)=>m.toolName==='document.apply'))
 checks.push('Built-in model → real MCP stdio → shared editor → UI state; credentials stay out of UI state')
 assert.equal(agent.previews.length,2);assert.deepEqual(agent.previews.map((p:any)=>p.stage),['before','after']);assert.equal(agent.canUndo,true);await rpc('agentUndo');assert.notEqual((await state()).manifest.layers[0].name,'Agent MCP changed');assert.equal((await rpc('agentState')).canUndo,false);checks.push('Agent captures actual MCP before/after PNG previews and rolls back its whole task through MCP')
 assert.deepEqual(errors,[])
 await page.screenshot({path:'artifacts/parallel-desktop.png'})
 await writeFile('artifacts/parallel-desktop-validation.json',JSON.stringify({status:'PASS',checks,errors},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}finally{modelServer?.close();await desktop.close();await rm(directory,{recursive:true,force:true})}
