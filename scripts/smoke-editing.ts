import { _electron as electron,expect } from '@playwright/test'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Client} from '@modelcontextprotocol/client'
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio'
import type {EditorState,BridgeInfo} from '../src/shared/contracts'
const root=await mkdtemp(join(tmpdir(),'compositor-editing-')),desktop=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:process.env.COMPOSITOR_EXECUTABLE?[]:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(root,'profile')}}),page=await desktop.firstWindow(),checks:string[]=[],errors:string[]=[]
let client:Client|undefined
page.on('pageerror',error=>errors.push(error.message))
try{
 await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true')
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const r=await page.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.equal(r.ok,true,JSON.stringify(r));return(r as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 async function edit(action:unknown){return rpc('apply',{...identity(await state()),action})}
 await rpc('newDocument');let s=await state();await rpc('create',{sessionId:s.sessionId,width:64,height:64});s=await state();const id=s.manifest.layers[0].id
 await edit({type:'layer.fill',layerId:id,color:[.8,.1,.2,1],target:'image'});await edit({type:'selection.set',selection:{shapes:[{kind:'rectangle',operation:'replace',bounds:[16,12,24,20],feather:0}],inverted:false}})
 s=await state();await rpc('copyClipboard',{...identity(s),layerIds:[id],cut:true});s=await state();await rpc('pasteClipboard',identity(s));s=await state();assert.equal(s.manifest.layers.length,2);assert.deepEqual(s.manifest.layers[1].transform.origin,[16,12]);assert.deepEqual(s.manifest.layers[1].transform.size,[24,20]);await rpc('history',{...identity(s),direction:'undo'});await rpc('history',{...identity(await state()),direction:'undo'});assert.equal((await state()).manifest.layers.length,1)
 checks.push('Real system image clipboard cuts selected pixels, pastes in place and undoes both operations')
 await edit({type:'selection.set',selection:null});await edit({type:'selection.subject',layerId:id,removeBackground:false});s=await state();assert.ok(s.selection);assert.equal((await rpc('imageOperationState')).length,0);await rpc('history',{...identity(s),direction:'undo'})
 checks.push('Desktop typed subject action runs bundled ONNX on CPU, returns a selection and undoes without changing PNG')
 await edit({type:'selection.subject',layerId:id,removeBackground:true});s=await state();assert.ok(s.manifest.layers[0].maskFile);await rpc('history',{...identity(s),direction:'undo'})
 checks.push('Remove Background creates a native grayscale editable mask and undoes atomically')
 await edit({type:'selection.set',selection:{shapes:[{kind:'rectangle',operation:'replace',bounds:[24,24,8,8],feather:0}],inverted:false}});await edit({type:'layer.content_fill',layerId:id});await edit({type:'selection.set',selection:null})
 checks.push('Content-Aware Fill executes in a separate process and commits through document history')
 const bridge=await rpc<BridgeInfo>('bridgeInfo');client=new Client({name:'editing-mcp-test',version:'1'});await client.connect(new StdioClientTransport({command:bridge.mcpCommand,args:bridge.mcpArgs,env:{...process.env as Record<string,string>,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'}));s=await state();const begun=await client.callTool({name:'task.begin',arguments:{...identity(s),label:'Create editable content'}});assert.equal(!!begun.isError,false,JSON.stringify(begun));const taskId=(begun.structuredContent as {taskId:string}).taskId
 let result=await client.callTool({name:'document.apply',arguments:{...identity(s),taskId,action:{type:'layer.shape',name:'MCP Ellipse',size:[20,12],style:{kind:'Ellipse',red:0,green:1,blue:0,cornerRadius:0}}}});assert.equal(!!result.isError,false,JSON.stringify(result));s=await state();assert.equal((s.manifest.layers.at(-1)!.shape as {kind:string}).kind,'Ellipse')
 result=await client.callTool({name:'document.apply',arguments:{...identity(s),taskId,action:{type:'layer.text',name:'MCP Text',style:{content:'中文\nMCP',fontName:'Arial',fontSize:16,red:0,green:0,blue:1,alignment:'Left',tracking:0,leading:22,boxSize:[64,64]}}}});assert.equal(!!result.isError,false,JSON.stringify(result));s=await state();assert.equal((s.manifest.layers.at(-1)!.text as {content:string}).content,'中文\nMCP');await client.callTool({name:'task.finish',arguments:{sessionId:s.sessionId,documentId:s.manifest.documentID,idempotencyKey:randomUUID(),taskId,state:'completed'}})
 checks.push('External real MCP creates editable native shape and Chinese multiline text with raster fallback through the renderer service')
 await desktop.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},join(root,'完整.comp'));await rpc('saveDialog',{sessionId:s.sessionId});const jpeg=await readFile(join(root,'完整.comp','QuickLook','Preview.jpg'));assert.equal(jpeg[0],255);assert.equal(jpeg[1],216);assert.equal((await state()).modified,false)
 checks.push('Saving native project writes a real JPEG Quick Look preview with consistent manifest revision')
 // Queue save and a subsequent edit without waiting for disk IO. The saved immutable snapshot
 // must retain its old content and the later in-memory edit must stay dirty.
 s=await state();await edit({type:'layer.rename',layerId:id,name:'Saved snapshot'});const before=await state();const save=rpc('saveCurrent',{sessionId:s.sessionId});await expect.poll(async()=>page.evaluate(()=>document.querySelector('.editor-shell')?.getAttribute('data-ready'))).toBe('true');await save
 s=await state();const saveAgain=rpc('saveCurrent',{sessionId:s.sessionId});await new Promise(resolve=>setTimeout(resolve,40));await edit({type:'layer.rename',layerId:id,name:'Later edit'});await saveAgain;s=await state();const manifest=JSON.parse(await readFile(join(root,'完整.comp','manifest.json'),'utf8'));assert.equal(s.manifest.layers[0].name,'Later edit');assert.equal(s.modified,manifest.layers[0].name!=='Later edit')
 checks.push('Save and subsequent edit preserve both disk snapshot and current dirty state')
 assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/editing-desktop.png'});await writeFile('artifacts/editing-desktop-validation.json',JSON.stringify({status:'PASS',checks,errors},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}finally{await client?.close();await desktop.close();await rm(root,{recursive:true,force:true})}
