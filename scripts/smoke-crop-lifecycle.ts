/** Isolated actual Electron crop acceptance; root runs this serially.
 * Source grids are self-authored. Unit tests separately compare full RGBA16/HDR;
 * preview equality here verifies the actual desktop's visible composite.
 * Foreign pointer and window blur are explicitly synthetic DOM lifecycle probes.
 * No system clipboard reads/writes and no Photoshop automation. */
import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {assetRepresentationURL} from '../src/shared/asset-representation'
import {translate,type Locale} from '../src/shared/i18n'
import type {EditorState,PreviewResult} from '../src/shared/contracts'

const root=process.cwd(),width=320,height=240,temp=await realpath(await mkdtemp(join(tmpdir(),'compositor-crop-'))),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/crop-lifecycle'
const checks:string[]=[],errors:string[]=[],paths=new Map<8|16|'hdr',string>();let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
for(const precision of [8,16,'hdr'] as const){
 const editor=new Editor();editor.create(width,height);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:`Crop source ${precision}`}})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.id+(precision==='hdr'?'.exr':'.png');layer.imageFile=file;layer.maskFile=layer.id+'.mask.png';layer.maskLinked=false;layer.maskPlacement=structuredClone(layer.transform)
 if(precision==='hdr'){
  const data=new Float32Array(width*height*4);for(let i=0;i<width*height;i++)data.set([1.25+(i%13)*.03125,-.125+(i%31)*.015625,.25+(i%7)*.0625,1],i*4)
  snapshot.assets.set(file,makeHDRAsset(file,width,height,data));snapshot.manifest.version=13
 }else if(precision===16){
  const data=new Uint16Array(width*height*4);for(let i=0;i<width*height;i++)data.set([1001+(i%1024)*29,2303+(i%997)*31,4007+(i%887)*37,65535],i*4)
  snapshot.assets.set(file,makeDeepAsset(file,width,height,data));snapshot.manifest.version=12
 }else{
  const png=new PNG({width,height});for(let i=0;i<width*height;i++)png.data.set([13+i%211,29+i%173,47+i%139,255],i*4);snapshot.assets.set(file,makeAsset(file,PNG.sync.write(png)))
 }
 const mask=new PNG({width,height});for(let i=0;i<width*height;i++){const v=i%17?255:120;mask.data.set([v,v,v,255],i*4)}snapshot.assets.set(layer.maskFile,makeAsset(layer.maskFile,PNG.sync.write(mask,{colorType:0})))
 editor.importDocument(snapshot.manifest,snapshot.assets,`Crop ${precision}`);const path=join(temp,`crop-${precision}.comp`);await editor.saveAs(path);paths.set(precision,path)
}
try{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 const packaged=!!process.env.COMPOSITOR_EXECUTABLE
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(temp,'profile')},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(item=>item.url()===url)}else{await expect.poll(()=>app!.windows().map(item=>item.url())).toContain(url);page=app.windows().find(item=>item.url()===url)}assert.ok(page)
 const ui=page;ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 await app.evaluate(({BrowserWindow},url)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!;window.setContentSize(1050,720);window.show();window.focus()},url)
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await ui.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.ok(result.ok,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 async function apply(action:unknown){return rpc('apply',{...identity(await state()),action})}
 async function open(path:string){await app!.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path);return rpc<EditorState>('openDialog')}
 async function preview(){const s=await state(),result=await rpc<PreviewResult>('preview',{sessionId:s.sessionId,expectedRevision:s.revision,maxDimension:320});return PNG.sync.read(Buffer.from(result.data,'base64'))}
 async function sourceBytes(s:EditorState){const result:Record<string,number[]>={};for(const asset of s.assets){const url=assetRepresentationURL(s,asset.file);result[asset.file]=await ui.evaluate(async url=>Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),url)}return result}
 const focus=()=>ui.locator('.status-bar').click(),primary=process.platform==='darwin'?'Meta':'Control',frame=ui.locator('.crop-frame')
 async function point(x:number,y:number){const box=await ui.locator('.canvas-wrap').boundingBox();assert.ok(box);return {x:box.x+x*box.width/width,y:box.y+y*box.height/height}}
 async function draft(held=false){const a=await point(80,60),b=await point(240,180);await ui.mouse.move(a.x,a.y);await ui.mouse.down();await ui.mouse.move(b.x,b.y,{steps:4});if(!held){await ui.mouse.up();await expect(ui.getByRole('button',{name:'Apply Crop',exact:true})).toBeEnabled()}else await expect(frame).toBeVisible()}
 const geometry=()=>frame.evaluate(node=>({left:(node as HTMLElement).style.left,top:(node as HTMLElement).style.top,width:(node as HTMLElement).style.width,height:(node as HTMLElement).style.height}))
 await rpc('localeSet',{locale:'en'});await open(paths.get(8)!);await ui.getByRole('button',{name:'100%',exact:true}).click();await ui.locator('.rail-tools>button[data-tool-group="C"]').click()
 for(const locale of ['en','zh-CN'] as Locale[]){await rpc('localeSet',{locale});const label=ui.locator('.crop-preserve-mode');await expect(label).toHaveText(translate(locale,'Non-destructive crop'));await expect(label).toHaveAttribute('title',translate(locale,'Pixels outside the crop are preserved. Expand the canvas to reveal them again.'));const box=await label.boundingBox();assert.ok(box&&box.x>=0&&box.y>=0&&box.x+box.width<=1051);await ui.screenshot({path:join(output,`crop-${locale}.png`),animations:'disabled'})}
 checks.push('ZH/EN non-destructive mode label and recovery explanation fit the minimum window')
 await rpc('localeSet',{locale:'en'});const initial=await state(),originalBytes=await sourceBytes(initial);await focus();await draft(true);await ui.keyboard.press('Enter')
 await expect.poll(async()=>(await state()).revision).toBe(initial.revision+1);const committed=await state();assert.equal(committed.manifest.width,160);assert.equal(committed.manifest.height,120);assert.deepEqual(await sourceBytes(committed),originalBytes)
 await ui.mouse.up();await expect(ui.getByRole('button',{name:'Apply Crop',exact:true})).toBeDisabled();assert.equal((await state()).revision,committed.revision)
 await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).revision).toBe(committed.revision+1);assert.deepEqual((await state()).manifest,initial.manifest);checks.push('Enter with the creation pointer held commits once; late pointerup leaves no stale draft and Undo releases the lease')
 // Observe the real owner pointer; only non-owner end events are synthesized.
 await ui.evaluate(()=>{document.addEventListener('pointerdown',event=>{(window as any).__cropPointer=event.pointerId},{capture:true})})
 const handle=ui.locator('.crop-handle.e'),box=await handle.boundingBox();assert.ok(box);await ui.mouse.move(box.x+box.width/2,box.y+box.height/2);await ui.mouse.down();await ui.mouse.move(box.x-16,box.y+box.height/2);const intermediate=await geometry()
 await handle.evaluate(node=>{const id=(window as any).__cropPointer+100;node.dispatchEvent(new PointerEvent('pointerup',{pointerId:id,bubbles:true}));node.dispatchEvent(new PointerEvent('pointercancel',{pointerId:id,bubbles:true}));node.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:id,bubbles:true}))});assert.deepEqual(await geometry(),intermediate)
 await ui.mouse.move(box.x-30,box.y+box.height/2);assert.notDeepEqual(await geometry(),intermediate);await ui.mouse.up();await ui.getByRole('button',{name:'Cancel',exact:true}).click();await rpc('saveCurrent',{sessionId:(await state()).sessionId});checks.push('Synthetic foreign pointerup/cancel/lostcapture leave the actual mouse handle drag active; cancel then save proves lease release')
 await draft();const pending=await geometry(),beforeBlur=await state(),resize=await handle.boundingBox();assert.ok(resize);await ui.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await ui.mouse.down();await ui.mouse.move(resize.x+25,resize.y+resize.height/2);assert.notDeepEqual(await geometry(),pending)
 await ui.evaluate(()=>window.dispatchEvent(new Event('blur')));await ui.mouse.up();assert.deepEqual(await geometry(),pending);assert.equal((await state()).revision,beforeBlur.revision)
 await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(beforeBlur.revision+1);assert.equal((await state()).manifest.width,160);await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).manifest.width).toBe(width);checks.push('Synthetic focus loss rolls handle geometry back to the preceding pending crop; Apply and Undo remain usable')
 await ui.getByRole('button',{name:'Transform (V)',exact:true}).click().catch(async()=>{await focus();await ui.keyboard.press('v')})
 await rpc('closeDocument',{sessionId:(await state()).sessionId})
 for(const precision of [8,16,'hdr'] as const){
  const opened=await open(paths.get(precision)!),bytes=await sourceBytes(opened),original=await preview()
  await apply({type:'document.crop',x:80,y:60,width:160,height:120,deleteCroppedPixels:false});const cropped=await state();assert.deepEqual(await sourceBytes(cropped),bytes);await rpc('saveCurrent',{sessionId:cropped.sessionId});await rpc('closeDocument',{sessionId:cropped.sessionId});const reopened=await open(paths.get(precision)!);assert.equal(reopened.manifest.width,160);assert.deepEqual(await sourceBytes(reopened),bytes)
  await apply({type:'document.crop',x:-80,y:-60,width,height,deleteCroppedPixels:false});const restored=await state(),restoredPreview=await preview();assert.deepEqual(restored.manifest,opened.manifest);assert.deepEqual(restoredPreview.data,original.data);assert.deepEqual(await sourceBytes(restored),bytes)
  const rejected=await ui.evaluate(params=>window.compositor.request('apply',params),{...identity(restored),action:{type:'document.crop',x:0,y:0,width:100,height:100,deleteCroppedPixels:true}});assert.equal(rejected.ok,false);if(!rejected.ok)assert.equal(rejected.error.code,'UNSUPPORTED_FEATURE');assert.deepEqual(await state(),restored)
  await ui.screenshot({path:join(output,`restored-${precision}.png`),animations:'disabled'});checks.push(`${precision}: actual IPC crop/save/close/reopen/extend restores desktop pixels and exact source image/mask bytes; unsupported deletion is atomic`)
  if(precision==='hdr')assert.ok(restored.assets.some(asset=>asset.isHDR));if(precision===16)assert.ok(restored.assets.some(asset=>asset.bitDepth===16));await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})});await rpc('closeDocument',{sessionId:restored.sessionId})
 }
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({status:'PASS',checks,errors,fixtureOrigin:'self-authored PNG8/PNG16/EXR grids; not an independent Photoshop crop pixel oracle',syntheticBoundaries:['foreign pointer lifecycle events','window blur DOM event'],systemClipboard:'untouched'},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}catch(cause){await writeFile(join(output,'report.json'),JSON.stringify({status:'FAIL',checks,errors,error:String(cause)},null,2));if(page)await page.screenshot({path:join(output,'failure.png'),timeout:5000}).catch(()=>{});throw cause}
finally{if(browser)await browser.close().catch(()=>{});if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await rm(temp,{recursive:true,force:true})}
