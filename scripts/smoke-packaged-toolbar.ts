import {_electron as electron,expect} from '@playwright/test'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'

const expectedVersion=JSON.parse(await readFile('package.json','utf8')).version
const executable=resolve(process.argv[2]??`release/${expectedVersion}/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron`)
const profile=await mkdtemp(join(tmpdir(),'compositor-toolbar-'))
const app=await electron.launch({executablePath:executable,args:[],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:profile}})
const checks:string[]=[]
try{
 async function read<T>(source:string):Promise<T>{return app.evaluate(({BrowserWindow},source)=>BrowserWindow.getAllWindows().find(w=>w.isVisible())!.webContents.executeJavaScript(source),source)}
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible())?.webContents.getURL()),{timeout:30000}).toContain('/index.html')
 await expect.poll(()=>read("document.querySelector('.editor-shell')?.dataset.ready"),{timeout:30000}).toBe('true')
 const version=await app.evaluate(({app})=>app.getVersion());assert.equal(version,expectedVersion)
 const before=await read<any>("window.compositor.request('state').then(r=>r.value)")
 const tools=await read<{label:string;disabled:boolean}[]>("Array.from(document.querySelectorAll('.rail-tools button')).map(b=>({label:b.getAttribute('aria-label'),disabled:b.disabled}))")
 assert.equal(tools.length,15)
 for(const tool of tools){
  assert.equal(tool.disabled,false,tool.label)
  const rect=await read<{x:number;y:number}>(`(()=>{const button=Array.from(document.querySelectorAll('.rail-tools button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(tool.label)});const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
  await app.evaluate(({BrowserWindow},position)=>{const contents=BrowserWindow.getAllWindows().find(w=>w.isVisible())!.webContents;contents.sendInputEvent({type:'mouseMove',...position});contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...position});contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...position})},rect)
  await expect.poll(()=>read(`Array.from(document.querySelectorAll('.rail-tools button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(tool.label)}).classList.contains('active')`)).toBe(true)
  checks.push(`Packaged actual pointer click activates ${tool.label}`)
 }
 const after=await read<any>("window.compositor.request('state').then(r=>r.value)");assert.equal(after.revision,before.revision);assert.deepEqual(after.manifest,before.manifest)
 const screenshot=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(w=>w.isVisible())!.webContents.capturePage()).toPNG().toString('base64'))
 await mkdir('artifacts/toolbar',{recursive:true});await writeFile('artifacts/toolbar/packaged.png',Buffer.from(screenshot,'base64'));const report={status:'PASS',version,executable,checks,unchangedDocument:true,tools};await writeFile('artifacts/toolbar/packaged.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(profile,{recursive:true,force:true})}
