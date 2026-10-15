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
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {decodeDeepPNG,inspectPNG} from '../src/core/deep-assets'
import {decodeEXR} from '../src/core/hdr-codecs'
import {assetRepresentationURL} from '../src/shared/asset-representation'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {EditorState} from '../src/shared/contracts'

const root=process.cwd(),width=256,height=192,output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/retouch-crop-alpha23'
const directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-retouch-crop-alpha23-'))),paths=new Map<8|16|'hdr',string>()
const checks:string[]=[],errors:string[]=[],measurements:Record<string,unknown>={},packaged=!!process.env.COMPOSITOR_EXECUTABLE
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
// Distinct donor/target textures ensure a successful blend cannot be mistaken
// for an unchanged linear ramp. Alpha-zero hidden RGB also probes untouched data.
for(const precision of [8,16,'hdr'] as const){
 const editor=new Editor();editor.create(width,height);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:`Retouch crop ${precision}`}})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.id+(precision==='hdr'?'.exr':'.png');layer.imageFile=file
 if(precision===8){
  const image=new PNG({width,height});for(let y=0;y<height;y++)for(let x=0;x<width;x++){const left=x<128;image.data.set(x<4?[219,33,87,0]:[left?25+(x*17+y*7)%115:125+(x*3+y*19)%100,left?110+(x*13+y*3)%105:20+(x*19+y*11)%95,left?30+(x*7+y*23)%120:110+(x*11+y*5)%125,255],(y*width+x)*4)}
  const bytes=PNG.sync.write(image);snapshot.assets.set(file,makeAsset(file,bytes));await writeFile(join(output,'source-rgb8.png'),bytes)
 }else if(precision===16){
  const data=new Uint16Array(width*height*4);for(let i=0;i<width*height;i++)data.set([1001+(i%1024)*29,2303+(i%997)*31,4007+(i%887)*37,65535],i*4)
  snapshot.assets.set(file,makeDeepAsset(file,width,height,data));snapshot.manifest.version=12;await writeFile(join(output,'source-rgb16.png'),snapshot.assets.get(file)!.bytes)
 }else{
  const data=new Float32Array(width*height*4);for(let i=0;i<width*height;i++)data.set([1.25+(i%13)*.03125,-.25+(i%31)*.001,.25+(i%7)*.0625,1],i*4)
  snapshot.assets.set(file,makeHDRAsset(file,width,height,data));snapshot.manifest.version=13;await writeFile(join(output,'source-hdr.exr'),snapshot.assets.get(file)!.bytes)
 }
 editor.importDocument(snapshot.manifest,snapshot.assets,`Retouch crop ${precision}`);const path=join(directory,`retouch-crop-${precision}.comp`);await editor.saveAs(path);paths.set(precision,path)
}
try{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(item=>item.url()===url)}else{await expect.poll(()=>app!.windows().map(item=>item.url())).toContain(url);page=app.windows().find(item=>item.url()===url)}assert.ok(page)
 const ui=page;ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 await app.evaluate(({BrowserWindow},url)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!;window.setContentSize(1280,850);window.show();window.focus()},url)
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
 async function choosePatch(){await ui.locator('.rail-tools>button[data-tool-group="J"]').click({button:'right'});const menu=ui.getByRole('menu',{name:'Tools · J',exact:true});await expect(menu).toBeVisible();await menu.getByRole('menuitemradio',{name:'Patch Tool',exact:true}).click();await expect(ui.getByTestId('patch-toolbar')).toBeVisible()}
 async function choosePerspective(){await ui.locator('.rail-tools>button[data-tool-group="C"]').click();await ui.getByRole('combobox',{name:'Crop mode',exact:true}).selectOption('perspective');await ui.getByRole('checkbox',{name:'Four-corner input',exact:true}).check();await frame()}
 async function closeSaved(name:string){const s=await state(),path=join(directory,name+'.comp'),bytes=await sources(s);await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},path);await rpc('saveDialog',{sessionId:s.sessionId});await rpc('closeDocument',{sessionId:s.sessionId});const reopened=await open(path);assert.deepEqual(reopened.manifest,s.manifest);assert.deepEqual(await sources(reopened),bytes);await rpc('closeDocument',{sessionId:reopened.sessionId})}
 await rpc('localeSet',{locale:'en'});const initial=await open(paths.get(8)!),originalBytes=await sources(initial),original=PNG.sync.read(await image(initial));measurements.sourceSha256=createHash('sha256').update(await image(initial)).digest('hex')
 checks.push('isolated actual Electron opens self-authored texture/transparent RGB8 source; source URL hashes original bytes')
 await choosePatch();const toolbar=ui.getByTestId('patch-toolbar');await toolbar.getByRole('combobox',{name:'Patch mode',exact:true}).selectOption('source');const adaptation=toolbar.getByRole('spinbutton',{name:'Adaptation',exact:true});await adaptation.fill('0.4');await adaptation.press('Tab');await toolbar.getByRole('checkbox',{name:'Preserve target transparency',exact:true}).check()
 const beforeSelection=await state();await stroke([[170,65],[210,65],[210,105],[170,105],[170,65]]);await expect.poll(async()=>(await state()).revision).toBe(beforeSelection.revision+1);const selected=await state(),selectedBytes=await sources(selected);measurements.patchSelection={selection:selected.selection,revision:selected.revision,expectedTargetCoverage:selectionCoverage(selected.selection,190.5,85.5),expectedDonorCoverage:selectionCoverage(selected.selection,65.5,85.5)};assert.ok(selectionCoverage(selected.selection,190.5,85.5)>.95);assert.ok(selectionCoverage(selected.selection,65.5,85.5)<.05);assert.deepEqual(selectedBytes,originalBytes)
 checks.push('Patch Tool draws a real closed freehand selection without rewriting source pixels')
 await settle();const selectedDisplay=await displayDigest();await stroke([[190,85],[65,85]],true);await expect.poll(displayDigest,{timeout:20000,message:'Held Source Patch must render genuine visible feedback, not only keep the document unchanged'}).not.toBe(selectedDisplay);await settle();await unchanged(selected,selectedBytes);await ui.screenshot({path:join(output,'patch-source-held-preview.png'),animations:'disabled'});await ui.mouse.up();await expect.poll(async()=>(await state()).revision,{timeout:20000}).toBe(selected.revision+1)
 const sourceResult=await state(),sourceBytes=await sources(sourceResult),sourcePixels=PNG.sync.read(await image(sourceResult));assert.deepEqual(sourceResult.selection,selected.selection);assert.notDeepEqual(sourcePixels.data,original.data)
 let affected=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;if(selectionCoverage(selected.selection,x+.5,y+.5)===0)assert.deepEqual(sourcePixels.data.subarray(at,at+4),original.data.subarray(at,at+4));else if(!sourcePixels.data.subarray(at,at+4).equals(original.data.subarray(at,at+4)))affected++}assert.ok(affected>100);measurements.patchSourceAffectedPixels=affected
 await settle();await ui.screenshot({path:join(output,'patch-source-result.png'),animations:'disabled'});await undo(selected,sourceResult,selectedBytes);await redo(sourceResult,sourceBytes);await undo(selected,await state(),selectedBytes)
 checks.push('Source mode holds original bytes/revision during actual drag, blends only selected target and leaves donor/transparent hidden RGB unchanged; one Undo/Redo restores exact bytes and selection')
 await toolbar.getByRole('combobox',{name:'Patch mode',exact:true}).selectOption('destination');const destinationBefore=await state();await stroke([[190,85],[65,85]]);await expect.poll(async()=>(await state()).revision,{timeout:20000}).toBe(destinationBefore.revision+1)
 const destinationResult=await state(),destinationBytes=await sources(destinationResult),destinationPixels=PNG.sync.read(await image(destinationResult));assert.ok(selectionCoverage(destinationResult.selection,65.5,85.5)>.95);assert.ok(selectionCoverage(destinationResult.selection,190.5,85.5)<.05);assert.notDeepEqual(destinationPixels.data,original.data)
 for(let y=65;y<105;y++)for(let x=170;x<210;x++){const at=(y*width+x)*4;assert.deepEqual(destinationPixels.data.subarray(at,at+4),original.data.subarray(at,at+4),'Destination mode must retain selected donor instead of cutting/moving it')}
 await settle();await ui.screenshot({path:join(output,'patch-destination-result.png'),animations:'disabled'});await undo(destinationBefore,destinationResult,selectedBytes);await redo(destinationResult,destinationBytes);await undo(destinationBefore,await state(),selectedBytes)
 checks.push('Destination mode copies/blends donor texture, moves selection but retains donor pixels; one real Undo/Redo restores original byte arrays and selection')
 const canceled=await state();await stroke([[190,85],[65,85]],true);await ui.keyboard.press('Escape');await ui.mouse.up();await frame();await unchanged(canceled,selectedBytes);await noBusy();checks.push('Escape during held Patch preview writes no bytes/history and releases document lease')
 await focus();await ui.keyboard.press(`${primary}+d`);await expect.poll(async()=>(await state()).selection).toBe(null);await closeSaved('patch-complete')

 const corners=[[30,25],[225,30],[210,165],[40,155]] as const
 for(const precision of [8,16,'hdr'] as const){
  const before=await open(paths.get(precision)!),beforeBytes=await sources(before);await choosePerspective();const apply=ui.getByRole('button',{name:'Apply Crop',exact:true}),handles=ui.getByRole('button',{name:/^Perspective corner [1-4]$/}),cancel=ui.locator('.raster-toolbar').getByRole('button',{name:'Cancel',exact:true})
  await expect(apply).toBeDisabled();await expect(handles).toHaveCount(0)
  for(const p of corners.slice(0,3))await clickAt(p[0],p[1])
  await focus();await ui.keyboard.press('Enter');await unchanged(before,beforeBytes);await expect(apply).toBeDisabled();await expect(handles).toHaveCount(0)
  await clickAt(230,130);await expect(apply).toBeDisabled();await expect(handles).toHaveCount(0);await unchanged(before,beforeBytes);await ui.screenshot({path:join(output,`perspective-invalid-fourth-${precision}.png`),animations:'disabled'})
  await clickAt(...corners[3]);await expect(handles).toHaveCount(4);await expect(apply).toBeEnabled();await unchanged(before,beforeBytes)
  // Tab commits these fields without invoking the crop Enter shortcut.
  for(const [name,value] of [['Perspective output width','160'],['Perspective output height','110']]){const field=ui.getByRole('spinbutton',{name,exact:true});await field.fill(value);await field.press('Tab')}
  await expect(ui.locator('.crop-feedback')).toContainText('160 × 110');await ui.screenshot({path:join(output,`perspective-four-point-draft-${precision}.png`),animations:'disabled'});await apply.click();await expect.poll(async()=>(await state()).revision,{timeout:20000}).toBe(before.revision+1)
  const after=await state(),afterBytes=await sources(after),pixels=await image(after);assert.equal(after.manifest.width,160);assert.equal(after.manifest.height,110);assert.notDeepEqual(afterBytes,beforeBytes)
  if(precision===16){const header=inspectPNG(pixels),decoded=decodeDeepPNG(pixels);assert.equal(header.bitDepth,16);assert.equal(decoded.width,160);assert.equal(decoded.height,110);assert.ok(decoded.deep.some((v,i)=>i%4!==3&&v%257!==0),'RGB16 source must retain non-8-bit values');assert.ok(after.assets.find(a=>a.file===imageFile(after))?.bitDepth===16)}
  else if(precision==='hdr'){const decoded=decodeEXR(pixels);assert.equal(decoded.width,160);assert.equal(decoded.height,110);assert.ok(decoded.hdr.some((v,i)=>i%4===0&&v>1),'HDR source must retain extended highlights');assert.ok(decoded.hdr.some((v,i)=>i%4===1&&v<0),'HDR source must retain negative scene-linear samples');assert.ok(after.assets.find(a=>a.file===imageFile(after))?.isHDR)}
  else{assert.equal(inspectPNG(pixels).bitDepth,8);assert.ok(PNG.sync.read(pixels).data.some(v=>v>0))}
  measurements[`perspective-${precision}`]={width:after.manifest.width,height:after.manifest.height,sourceSha256:createHash('sha256').update(pixels).digest('hex'),assets:after.assets}
  await settle();await ui.screenshot({path:join(output,`perspective-four-point-result-${precision}.png`),animations:'disabled'});await undo(before,after,beforeBytes);await redo(after,afterBytes);await closeSaved(`perspective-four-point-${precision}`)
  checks.push(`${precision}: real clockwise four-click crop rejects incomplete Enter and invalid fourth point, accepts retry, commits once at original source precision; Undo/Redo and Save As/reopen retain exact original/output bytes`)

  const cancelBefore=await open(paths.get(precision)!),cancelBytes=await sources(cancelBefore);await choosePerspective();await clickAt(...corners[0]);await clickAt(...corners[1]);await focus();await ui.keyboard.press('Escape');await expect(handles).toHaveCount(0);await expect(apply).toBeDisabled();await unchanged(cancelBefore,cancelBytes);await noBusy()
  await clickAt(...corners[0]);await clickAt(...corners[1]);await expect(cancel).toBeEnabled();await cancel.click();await expect(handles).toHaveCount(0);await expect(apply).toBeDisabled();await unchanged(cancelBefore,cancelBytes);await noBusy();await rpc('closeDocument',{sessionId:cancelBefore.sessionId})
  checks.push(`${precision}: real Escape and toolbar Cancel discard partial four-point draft, keep Apply disabled and preserve source/revision with no document lease leak`)
 }
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[])
 const report={status:'PASS',version:await app.evaluate(({app})=>app.getVersion()),packaged,checks,errors,measurements,fixtureOrigin:'self-authored RGB8/PNG16/scene-linear EXR; not Photoshop output oracles',inputMechanism:'actual Electron mouse/keyboard, only native open/save dialog paths doubled',precisionBoundary:'Patch RGB8 only; four-point perspective source precision verified by decoded PNG16/EXR, not display proxies',systemClipboard:'untouched'}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(cause){
 if(page){measurements.failurePublicState=await page.evaluate(()=>window.compositor.request('state')).catch(error=>({error:String(error)}));measurements.failureVisibleError=await page.locator('.error-toast').innerText({timeout:1000}).catch(()=>null)}
 const report=JSON.stringify({status:'FAIL',packaged,checks,errors,measurements,error:String(cause),stack:cause instanceof Error?cause.stack:undefined},null,2);await writeFile(join(output,'report.json'),report)
 // Preserve the first failure even if a subsequent rerun replaces report.json.
 await writeFile(join(output,'first-failure.json'),report,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})
 await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).then(async()=>{const bytes=await readFile(join(output,'failure.png'));await writeFile(join(output,'first-failure.png'),bytes,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})}).catch(()=>{})
 throw cause
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
