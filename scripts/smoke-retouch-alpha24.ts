/** Actual, isolated Electron acceptance. Only native open/save dialog paths are
 * doubled. All editing gestures use mouse/keyboard and public command state.
 * Self-authored sources are precision/interaction probes, not Photoshop oracles.
 * Root runs this serially after building; importing it launches Electron. */
import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {assetRepresentationURL} from '../src/shared/asset-representation'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {EditorState} from '../src/shared/contracts'

const root=process.cwd(),width=128,height=96,output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/retouch-alpha24'
const directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-retouch-alpha24-')))
const checks:string[]=[],errors:string[]=[],measurements:Record<string,unknown>={},packaged=!!process.env.COMPOSITOR_EXECUTABLE
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
// Self-authored neutral background, isolated red pupil/highlight and colored object.
const fixture=new PNG({width,height})
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const pupil=Math.hypot(x+.5-32,y+.5-48)<7,highlight=Math.hypot(x+.5-30,y+.5-46)<1.5,object=x>=64&&x<80&&y>=30&&y<46
 fixture.data.set(x<3?[215,22,87,0]:highlight?[245,245,245,255]:pupil?[220,32,25,255]:object?[25+(x%3)*5,65,205+(y%3)*5,255]:[160,150,140,255],(y*width+x)*4)
}
const fixtureBytes=PNG.sync.write(fixture),fixtureEditor=new Editor();fixtureEditor.importPNG(fixtureBytes,'Alpha24 retouch test source');const fixturePath=join(directory,'retouch-rgb8.comp');await fixtureEditor.saveAs(fixturePath);await writeFile(join(output,'source.png'),fixtureBytes)
try{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(item=>item.url()===url)}else{await expect.poll(()=>app!.windows().map(item=>item.url())).toContain(url);page=app.windows().find(item=>item.url()===url)}assert.ok(page)
 const ui=page;ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 await app.evaluate(({BrowserWindow,app},url)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!;window.setContentSize(1280,850);window.show();app.focus({steal:true});window.focus()},url)
 await expect.poll(()=>app!.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)?.isFocused(),url)).toBe(true)
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await ui.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.ok(result.ok,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),primary=process.platform==='darwin'?'Meta':'Control'
 async function frame(){await ui.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
 async function settle(){await expect(ui.getByTestId('editor-canvas')).toHaveAttribute('data-rendering','false',{timeout:20000})}
 async function displayDigest(){const bytes=await ui.getByTestId('editor-canvas').evaluate(element=>{const canvas=element as HTMLCanvasElement,context=canvas.getContext('2d');if(!context)throw new Error('Actual editor canvas has no 2D context');return Array.from(context.getImageData(0,0,canvas.width,canvas.height).data)});return createHash('sha256').update(Buffer.from(bytes)).digest('hex')}
 async function focus(){await ui.locator('.status-bar').click()}
 async function open(path:string){await app!.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path);await rpc('openDialog');await ui.getByRole('button',{name:'100%',exact:true}).click();await settle();return state()}
 async function point(x:number,y:number){const s=await state();return ui.locator('.canvas-wrap').evaluate((element,{x,y,width,height})=>{const rect=element.getBoundingClientRect(),zoom=parseFloat((element as HTMLElement).style.width)/width,angle=Number(document.querySelector('.editor-shell')?.getAttribute('data-view-angle')??0)*Math.PI/180,dx=(x-width/2)*zoom,dy=(y-height/2)*zoom;return {x:rect.left+rect.width/2+dx*Math.cos(angle)-dy*Math.sin(angle),y:rect.top+rect.height/2+dx*Math.sin(angle)+dy*Math.cos(angle)}},{x,y,width:s.manifest.width,height:s.manifest.height})}
 async function mouseAt(x:number,y:number){const p=await point(x,y);await ui.mouse.move(p.x,p.y);await frame()}
 async function clickAt(x:number,y:number){const p=await point(x,y);await ui.mouse.click(p.x,p.y);await frame()}
 async function stroke(points:readonly (readonly[number,number])[],held=false){await mouseAt(...points[0]);await ui.mouse.down();for(const p of points.slice(1))await mouseAt(...p);if(!held)await ui.mouse.up();await frame()}
 async function sources(s:EditorState){const bytes:Record<string,Buffer>={};for(const asset of s.assets){const url=assetRepresentationURL(s,asset.file);bytes[asset.file]=Buffer.from(await ui.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),url))}return bytes}
 function imageFile(s:EditorState){const layer=s.manifest.layers.find(item=>item.id===s.manifest.activeLayerID);assert.ok(layer?.imageFile);return layer.imageFile}
 async function image(s:EditorState){return (await sources(s))[imageFile(s)]}
 async function unchanged(before:EditorState,bytes:Record<string,Buffer>){const after=await state();assert.equal(after.revision,before.revision);assert.deepEqual(after.manifest,before.manifest);assert.deepEqual(after.selection,before.selection);assert.deepEqual(await sources(after),bytes)}
 async function noBusy(){const before=await state();await expect.poll(async()=>{const result=await ui.evaluate(params=>window.compositor.request('switchDocument',params),{sessionId:before.sessionId});return result.ok},{timeout:10000,message:'Gesture cancellation must release its actual main-process lease'}).toBe(true);assert.equal((await state()).revision,before.revision)}
 async function undo(before:EditorState,after:EditorState,bytes:Record<string,Buffer>){await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).revision).toBe(after.revision+1);const undone=await state();assert.deepEqual(undone.manifest,before.manifest);assert.deepEqual(undone.selection,before.selection);assert.deepEqual(await sources(undone),bytes);return undone}
 async function redo(after:EditorState,bytes:Record<string,Buffer>){const before=await state();await focus();await ui.keyboard.press(`${primary}+Shift+z`);await expect.poll(async()=>(await state()).revision).toBe(before.revision+1);assert.deepEqual((await state()).manifest,after.manifest);assert.deepEqual((await state()).selection,after.selection);assert.deepEqual(await sources(await state()),bytes)}
 async function closeSaved(name:string){const s=await state(),path=join(directory,name+'.comp'),bytes=await sources(s);await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},path);await rpc('saveDialog',{sessionId:s.sessionId});await rpc('closeDocument',{sessionId:s.sessionId});const reopened=await open(path);assert.deepEqual(reopened.manifest,s.manifest);assert.deepEqual(await sources(reopened),bytes);await rpc('closeDocument',{sessionId:reopened.sessionId})}
 async function choose(label:string,testId:string){await ui.locator('.rail-tools>button[data-tool-group="J"]').click({button:'right'});const menu=ui.getByRole('menu',{name:'Tools · J',exact:true});await menu.getByRole('menuitemradio',{name:label,exact:true}).click();await expect(ui.getByTestId(testId)).toBeVisible()}
 function pixel(png:PNG,x:number,y:number){return [...png.data.subarray((y*width+x)*4,(y*width+x)*4+4)]}
 async function selectionRect(){await ui.locator('.rail-tools>button[data-tool-group="M"]').click({button:'right'});await ui.getByRole('menu',{name:'Tools · M',exact:true}).getByRole('menuitemradio',{name:'Rectangular Marquee',exact:true}).click();const before=await state();await stroke([[60,26],[84,50]]);await expect.poll(async()=>(await state()).revision).toBe(before.revision+1);assert.ok(selectionCoverage((await state()).selection,72.5,38.5)>.99)}
 await rpc('localeSet',{locale:'en'});const initial=await open(fixturePath),originalBytes=await sources(initial),original=PNG.sync.read(await image(initial))
 checks.push('isolated real Electron opens self-authored RGB8 source with red pupil, white highlight, colored object and hidden transparent RGB')

 await choose('Remove Tool','retouch-tool-toolbar');let toolbar=ui.getByTestId('retouch-tool-toolbar')
 const diameter=toolbar.getByRole('spinbutton',{name:'Remove brush size',exact:true});await diameter.fill('20');await diameter.press('Tab')
 const removeBefore=await state();await stroke([[29,48],[35,48]],true);await unchanged(removeBefore,originalBytes);await ui.mouse.up();await expect.poll(async()=>(await state()).revision,{timeout:30000}).toBe(removeBefore.revision+1)
 const removed=await state(),removedBytes=await sources(removed),removedPixels=PNG.sync.read(await image(removed));assert.ok(pixel(removedPixels,32,48)[0]<pixel(original,32,48)[0]-20);assert.notDeepEqual(removedPixels.data,original.data)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<18||x>46||y<37||y>59){const at=(y*width+x)*4;assert.deepEqual(removedPixels.data.subarray(at,at+4),original.data.subarray(at,at+4))}
 await settle();await ui.screenshot({path:join(output,'remove-result.png')});await undo(removeBefore,removed,originalBytes);await redo(removed,removedBytes);await undo(removeBefore,await state(),originalBytes)
 checks.push('Remove real stroke changes covered red defect, preserves every outside pixel and transparent hidden RGB, commits once and restores exact bytes with Undo/Redo')
 const removeCanceled=await state();await stroke([[29,48],[35,48]],true);await ui.keyboard.press('Escape');await ui.mouse.up();await unchanged(removeCanceled,originalBytes);await noBusy();checks.push('Escape cancels held Remove gesture without mutation/history and releases native document lease')

 await choose('Red Eye Tool','retouch-tool-toolbar');const redBefore=await state();await stroke([[20,36],[44,60]]);await expect.poll(async()=>(await state()).revision,{timeout:30000}).toBe(redBefore.revision+1)
 const corrected=await state(),correctedBytes=await sources(corrected),correctedPixels=PNG.sync.read(await image(corrected));const pupil=pixel(correctedPixels,32,48);assert.ok(pupil[0]<80);assert.ok(Math.abs(pupil[0]-pupil[1])<15);assert.deepEqual(pixel(correctedPixels,30,46),pixel(original,30,46));assert.deepEqual(pixel(correctedPixels,72,38),pixel(original,72,38))
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<20||x>=44||y<36||y>=60){const at=(y*width+x)*4;assert.deepEqual(correctedPixels.data.subarray(at,at+4),original.data.subarray(at,at+4))}
 await settle();await ui.screenshot({path:join(output,'red-eye-result.png')});await undo(redBefore,corrected,originalBytes);await redo(corrected,correctedBytes);await undo(redBefore,await state(),originalBytes)
 checks.push('Red Eye real bounding-box gesture neutralizes red pupil while preserving white catchlight, unrelated colors and outside pixels; one exact Undo/Redo')
 const redCanceled=await state();await stroke([[20,36],[44,60]],true);await ui.keyboard.press('Escape');await ui.mouse.up();await unchanged(redCanceled,originalBytes);await noBusy();checks.push('Escape cancels held Red Eye bounding box without data/history mutation or busy-lock leak')

 await selectionRect();const selected=await state(),selectedBytes=await sources(selected);await choose('Content-Aware Move Tool','retouch-tool-toolbar');toolbar=ui.getByTestId('retouch-tool-toolbar');const adaptation=toolbar.getByRole('spinbutton',{name:'Content-aware move adaptation',exact:true});await adaptation.fill('0');await adaptation.press('Tab')
 await settle();const originalDisplay=await displayDigest();await stroke([[72,38],[104,58]]);await expect.poll(displayDigest,{timeout:20000}).not.toBe(originalDisplay);await expect(toolbar.getByRole('button',{name:'Apply Content-Aware Move',exact:true})).toBeEnabled();await unchanged(selected,selectedBytes);await settle();await ui.screenshot({path:join(output,'content-move-pending.png')})
 await focus();await ui.keyboard.press('Escape');await unchanged(selected,selectedBytes);await noBusy();checks.push('Content-Aware Move real drag leaves canonical bytes/history unchanged pending confirmation; Escape discards draft and releases lease')
 await stroke([[72,38],[104,58]]);await expect(toolbar.getByRole('button',{name:'Apply Content-Aware Move',exact:true})).toBeEnabled();await unchanged(selected,selectedBytes);await focus();await ui.keyboard.press('Enter');await expect.poll(async()=>(await state()).revision,{timeout:30000}).toBe(selected.revision+1)
 const moved=await state(),movedBytes=await sources(moved),movedPixels=PNG.sync.read(await image(moved));assert.ok(selectionCoverage(moved.selection,104.5,58.5)>.99);assert.ok(selectionCoverage(moved.selection,72.5,38.5)<.01);assert.deepEqual(pixel(movedPixels,104,58),pixel(original,72,38));assert.notDeepEqual(pixel(movedPixels,72,38),pixel(original,72,38));assert.deepEqual(pixel(movedPixels,32,48),pixel(original,32,48))
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(selectionCoverage(selected.selection,x+.5,y+.5)===0&&selectionCoverage(moved.selection,x+.5,y+.5)===0){const at=(y*width+x)*4;assert.deepEqual(movedPixels.data.subarray(at,at+4),original.data.subarray(at,at+4))}
 await settle();await ui.screenshot({path:join(output,'content-move-result.png')});await undo(selected,moved,selectedBytes);await redo(moved,movedBytes);checks.push('Content-Aware Move Enter commits source repair and destination transfer atomically, translates selection, preserves unrelated pixels and supports exact single-step Undo/Redo')
 await focus();await ui.keyboard.press(`${primary}+d`);await expect.poll(async()=>(await state()).selection).toBe(null);await closeSaved('retouch-alpha24-result');checks.push('Actual Save As/close/reopen retains accepted output bytes and manifest')
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[])
 const report={status:'PASS',version:await app.evaluate(({app})=>app.getVersion()),packaged,checks,errors,measurements,fixtureOrigin:'self-authored RGB8 diagnostic source; not a Photoshop output oracle',inputMechanism:'actual Electron mouse/keyboard; only native open/save dialog paths doubled',systemClipboard:'untouched'}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(cause){
 if(page){measurements.failurePublicState=await page.evaluate(()=>window.compositor.request('state')).catch(error=>({error:String(error)}));measurements.failureVisibleError=await page.locator('.error-toast').innerText({timeout:1000}).catch(()=>null)}
 if(app)measurements.failureWindowFocus=await app.evaluate(({app,BrowserWindow})=>({pid:process.pid,version:app.getVersion(),packaged:app.isPackaged,executable:app.getPath('exe'),hidden:process.platform==='darwin'?app.isHidden():undefined,focusedWindow:BrowserWindow.getFocusedWindow()?.id,windows:BrowserWindow.getAllWindows().map(window=>({id:window.id,url:window.webContents.getURL(),visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable(),minimized:window.isMinimized(),bounds:window.getBounds()}))})).catch(error=>({error:String(error)}))
 const report=JSON.stringify({status:'FAIL',packaged,checks,errors,measurements,error:String(cause),stack:cause instanceof Error?cause.stack:undefined},null,2);await writeFile(join(output,'report.json'),report)
 // Preserve the first failure even if a subsequent rerun replaces report.json.
 await writeFile(join(output,'first-failure.json'),report,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})
 await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).then(async()=>{const bytes=await readFile(join(output,'failure.png'));await writeFile(join(output,'first-failure.png'),bytes,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})}).catch(()=>{})
 throw cause
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
