import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {inflateSync} from 'node:zlib'
import {sourcePoint} from '../src/core/raster-edit'
import type {EditorState} from '../src/shared/contracts'

const directory=await mkdtemp(join(tmpdir(),'compositor-alpha20-brush-')),artifact=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/photoshop-alpha20-brush',checks:string[]=[],errors:string[]=[]
let app:ElectronApplication|undefined,browser:Browser|undefined
try{
 await mkdir(artifact,{recursive:true})
 const packaged=!!process.env.COMPOSITOR_EXECUTABLE,probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(e=>e?reject(e):resolve()))
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[process.env.COMPOSITOR_SMOKE_ENTRY??process.cwd()]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(w.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(w.webContents.getURL()))!.webContents.getURL())
 let selectedPage:Page|undefined
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);selectedPage=browser.contexts()[0].pages().find(p=>p.url()===url)}else{await expect.poll(()=>app!.windows().map(p=>p.url())).toContain(url);selectedPage=app.windows().find(p=>p.url()===url)}assert.ok(selectedPage);const page=selectedPage;page.on('pageerror',error=>errors.push(error.message))
 await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await page.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(current:EditorState)=>({sessionId:current.sessionId,documentId:current.manifest.documentID,expectedRevision:current.revision,idempotencyKey:randomUUID()})
 async function pixels(current:EditorState):Promise<PNG>{const layer=current.manifest.layers.find(item=>item.id===current.manifest.activeLayerID)!,asset=current.assets.find(item=>item.file===layer.imageFile)!,url=`compositor-asset://${current.sessionId}/${encodeURIComponent(asset.file)}?hash=${asset.hash}`,bytes=await page.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),url);return PNG.sync.read(Buffer.from(bytes))}
 await rpc('localeSet',{locale:'en'});const references=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-brush-v6.json','utf8'))
 for(const sample of [{name:'tip-d8-h75-dot-o100-f100-s25',size:8,h:75,flow:100,spacing:25,line:false,limit:6},{name:'tip-d32-h90-dot-o100-f100-s25',size:32,h:90,flow:100,spacing:25,line:false,limit:9},{name:'tip-d32-h0-len160-o100-f20-s20',size:32,h:0,flow:20,spacing:20,line:true,limit:5},{name:'tip-d32-h100-len160-o100-f20-s20',size:32,h:100,flow:20,spacing:20,line:true,limit:19}]){
  await rpc('newDocument');await rpc('create',{sessionId:(await state()).sessionId,width:256,height:192});await page.locator('.rail-tools>button[data-tool-mode="brush"]').click();const controls=page.locator('.raster-toolbar');await controls.getByLabel('Brush preset',{exact:true}).selectOption(sample.h===0?'soft-round':'hard-round')
  for(const [label,value] of [['Brush size',sample.size],['Hardness',sample.h],['Opacity',100],['Brush flow',sample.flow],['Brush spacing',sample.spacing]] as const){await controls.getByLabel(label,{exact:true}).fill(String(value));await controls.getByLabel(label,{exact:true}).press('Enter')}
  await page.getByRole('button',{name:'100%',exact:true}).click();await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-rendering','false');const before=await state(),box=await page.locator('.canvas-wrap').boundingBox();assert.ok(box);const start=sample.line?48:128;await page.mouse.move(box.x+start,box.y+96);await page.mouse.down();if(sample.line){await page.mouse.move(box.x+208,box.y+96,{steps:160});assert.equal((await state()).revision,before.revision)}await page.mouse.up();await expect.poll(async()=>(await state()).revision).toBe(before.revision+1);const after=await state(),image=await pixels(after),layer=after.manifest.layers.find(l=>l.id===after.manifest.activeLayerID)!,native=references.rows.find((r:{name:string})=>r.name===sample.name);assert.ok(native);const raw=inflateSync(Buffer.from(native.alphaLEZlib,'base64'));let max=0;for(let y=0;y<192;y++)for(let x=0;x<256;x++){const [sx,sy]=sourcePoint(layer,x+.5,y+.5,image.width,image.height),ix=Math.floor(sx),iy=Math.floor(sy),actual=ix<0||iy<0||ix>=image.width||iy>=image.height?0:image.data[(iy*image.width+ix)*4+3];max=Math.max(max,Math.abs(actual-raw.readUInt16LE((y*256+x)*2)))}assert.ok(max<=sample.limit,`${sample.name} actual mouse max${max} exceeds native measured${sample.limit}`);await rpc('history',{...identity(after),direction:'undo'});assert.deepEqual((await state()).assets,before.assets);await rpc('history',{...identity(await state()),direction:'redo'});assert.deepEqual((await state()).assets,after.assets);checks.push(`${sample.name}: actual fields and mouse ${sample.line?'continuous Flow stroke':'stamp'} native Alpha max${max}/255, single undoable transaction, exact source Undo/Redo`);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})});await rpc('closeDocument',{sessionId:after.sessionId})
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:`${artifact}/canvas.png`,animations:'disabled'})
 await writeFile(`${artifact}/checks.json`,JSON.stringify({status:'PASS',checks,errors},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}catch(error){await writeFile(`${artifact}/checks.json`,JSON.stringify({status:'FAIL',checks,errors,error:String(error)},null,2));if(app){const page=await app.firstWindow().catch(()=>undefined);await page?.screenshot({path:`${artifact}/failure.png`,animations:'disabled',timeout:5000}).catch(()=>{})}throw error}
finally{if(browser)await browser.close().catch(()=>{});if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await rm(directory,{recursive:true,force:true})}
