/** Root runs serially after a build; executing this file launches Electron.
 * Real Photoshop RGBA is the only accepted-case oracle. Source Editor imports
 * below author input projects only; no source/core crop oracle is evaluated.
 * Native open/save dialog paths are doubled, all editing uses the live app. */
import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {createServer} from 'node:net'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset} from '../src/core/project-io'
import {assetRepresentationURL} from '../src/shared/asset-representation'
import type {EditorState} from '../src/shared/contracts'
import type {CropCorners} from '../src/shared/crop-projective'

type Source={width:number;height:number;rgbaZlib:string;sha256:string}
type NativeCase={name:string;sourceVariant:string;accepted:boolean;width:number;height:number;corners:CropCorners;nativeRGBAZlib:string;nativeRGBA_SHA256:string;baselineRGBAZlib?:string;baselineRGBA_SHA256:string;declineReason:string|null}
const root=process.cwd(),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/crop-axis-alpha30',packaged=!!process.env.COMPOSITOR_EXECUTABLE
const fixturePath=join(root,'fixtures/parity/photoshop-27.11-perspective-axis-rea-alpha30.json'),fixtureBytes=await readFile(fixturePath)
const fixture=JSON.parse(fixtureBytes.toString()) as {frozenCandidateSHA256:string;sources:Record<string,Source>;cases:NativeCase[]}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
assert.equal(fixture.frozenCandidateSHA256,'46241bed8604c76269682a06b35dd8e3eb9e1860c4fa99ebbba6eb0660a94e27')
assert.equal(fixture.cases.filter(c=>c.accepted).length,6);assert.equal(fixture.cases.filter(c=>!c.accepted).length,4)
function unpack(value:string,expectedSHA:string){const data=inflateSync(Buffer.from(value,'base64'));assert.equal(sha(data),expectedSHA);return data}
const directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-crop-axis-alpha30-'))),paths=new Map<string,string>(),checks:string[]=[],errors:string[]=[],measurements:Record<string,unknown>={}
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
for(const [variant,source]of Object.entries(fixture.sources)){
 const pixels=unpack(source.rgbaZlib,source.sha256);assert.equal(pixels.length,source.width*source.height*4)
 const editor=new Editor();editor.create(source.width,source.height);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:variant}})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.id+'.png',png=new PNG({width:source.width,height:source.height});png.data.set(pixels);layer.imageFile=file;snapshot.assets.set(file,makeAsset(file,PNG.sync.write(png)))
 editor.importDocument(snapshot.manifest,snapshot.assets,variant);const path=join(directory,variant+'.comp');await editor.saveAs(path);paths.set(variant,path)
}
try{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(w.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(w.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(p=>p.url()===url)}else{await expect.poll(()=>app!.windows().map(p=>p.url())).toContain(url);page=app.windows().find(p=>p.url()===url)}assert.ok(page)
 const ui=page,primary=process.platform==='darwin'?'Meta':'Control';ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 async function resize(width:number,height:number){await app!.evaluate(({BrowserWindow},{url,width,height})=>{const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url)!;window.setContentSize(width,height);window.show();window.focus()},{url,width,height});await frame()}
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await ui.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.ok(result.ok,JSON.stringify(result));return(result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 async function frame(){await ui.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
 async function settle(){await expect(ui.getByTestId('editor-canvas')).toHaveAttribute('data-rendering','false',{timeout:20000})}
 async function open(path:string){await app!.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path);await rpc('openDialog');await ui.getByRole('button',{name:'100%',exact:true}).click();await settle();return state()}
 async function sources(s:EditorState){const bytes:Record<string,Buffer>={};for(const asset of s.assets){const url=assetRepresentationURL(s,asset.file);bytes[asset.file]=Buffer.from(await ui.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),url))}return bytes}
 function imageFile(s:EditorState){const layer=s.manifest.layers.find(l=>l.id===s.manifest.activeLayerID);assert.ok(layer?.imageFile);return layer.imageFile}
 async function focus(){await ui.locator('.status-bar').click()}
 async function exactToolbarCrop(reference:NativeCase){
  await ui.locator('.rail-tools>button[data-tool-group="C"]').click();await ui.getByRole('combobox',{name:'Crop mode',exact:true}).selectOption('perspective');await ui.getByRole('checkbox',{name:'Four-corner input',exact:true}).check();await ui.getByRole('combobox',{name:'Crop ratio',exact:true}).selectOption('Free')
  // Choose a whole-CSS-pixel canvas origin through ordinary window sizing.
  // This prevents pointer coordinate quantization from changing the exact
  // full-source geometry and silently testing the general fallback instead.
  let bounds:{x:number;y:number;width:number;height:number}|null=null
  for(const [w,h]of [[1280,850],[1281,850],[1280,851],[1281,851]]){await resize(w,h);bounds=await ui.locator('.canvas-wrap').boundingBox();assert.ok(bounds);if(Math.abs(bounds.x-Math.round(bounds.x))<1e-8&&Math.abs(bounds.y-Math.round(bounds.y))<1e-8)break}
  assert.ok(bounds);assert.equal(bounds.x,Math.round(bounds.x),'exact pointer canvas X');assert.equal(bounds.y,Math.round(bounds.y),'exact pointer canvas Y')
  const source=fixture.sources[reference.sourceVariant];assert.deepEqual([bounds.width,bounds.height],[source.width,source.height])
  for(const[x,y]of reference.corners){await ui.mouse.click(bounds.x+x,bounds.y+y);await frame()}
  await expect(ui.getByRole('button',{name:/^Perspective corner [1-4]$/})).toHaveCount(4)
  const quad=await ui.locator('.crop-geometry-overlay circle[role="button"]').evaluateAll(elements=>elements.map(e=>[Number(e.getAttribute('cx')),Number(e.getAttribute('cy'))]));assert.deepEqual(quad,reference.corners)
  for(const[name,value]of [['Perspective output width',reference.width],['Perspective output height',reference.height]] as const){const field=ui.getByRole('spinbutton',{name,exact:true});await field.fill(String(value));await field.press('Tab');await expect(field).toHaveValue(String(value))}
  measurements.toolbar={case:reference.name,quad,input:'Actual four-corner mouse clicks and output fields; exact DOM quad asserted before Apply Crop'}
  await ui.screenshot({path:join(output,'toolbar-draft.png'),animations:'disabled'});await ui.getByRole('button',{name:'Apply Crop',exact:true}).click()
 }
 async function historyAndSave(before:EditorState,beforeBytes:Record<string,Buffer>,after:EditorState,afterBytes:Record<string,Buffer>,name:string){
  await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).revision).toBe(after.revision+1);const undone=await state();assert.deepEqual(undone.manifest,before.manifest);assert.deepEqual(undone.selection,before.selection);assert.deepEqual(await sources(undone),beforeBytes)
  await focus();await ui.keyboard.press(`${primary}+Shift+z`);await expect.poll(async()=>(await state()).revision).toBe(undone.revision+1);const redone=await state();assert.deepEqual(redone.manifest,after.manifest);assert.deepEqual(await sources(redone),afterBytes)
  const path=join(directory,'saved-'+name+'.comp');await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},path);await rpc('saveDialog',{sessionId:redone.sessionId});await rpc('closeDocument',{sessionId:redone.sessionId});const reopened=await open(path);assert.deepEqual(reopened.manifest,after.manifest);assert.deepEqual(await sources(reopened),afterBytes);await rpc('closeDocument',{sessionId:reopened.sessionId})
 }
 await resize(1280,850);await rpc('localeSet',{locale:'en'});await expect(ui.locator('.editor-shell')).toHaveAttribute('data-interaction-profile','photoshop')
 for(const [index,reference]of fixture.cases.entries()){
  const before=await open(paths.get(reference.sourceVariant)!),beforeBytes=await sources(before),input=fixture.sources[reference.sourceVariant],inputPixels=PNG.sync.read(beforeBytes[imageFile(before)]);assert.equal(sha(inputPixels.data),input.sha256);assert.deepEqual([inputPixels.width,inputPixels.height],[input.width,input.height])
  if(index===0)await exactToolbarCrop(reference)
  else await rpc('apply',{...identity(before),action:{type:'document.perspective_crop',corners:reference.corners,width:reference.width,height:reference.height,sampling:'High quality'}})
  await expect.poll(async()=>(await state()).revision,{timeout:20000}).toBe(before.revision+1);await settle();const after=await state(),afterBytes=await sources(after),actual=afterBytes[imageFile(after)],pixels=PNG.sync.read(actual)
  assert.deepEqual([after.manifest.width,after.manifest.height],[reference.width,reference.height]);assert.deepEqual([pixels.width,pixels.height],[reference.width,reference.height]);assert.equal(after.manifest.version,11)
  const native=unpack(reference.nativeRGBAZlib,reference.nativeRGBA_SHA256),expected=reference.accepted?native:unpack(reference.baselineRGBAZlib!,reference.baselineRGBA_SHA256);assert.deepEqual(pixels.data,expected,reference.name+' decoded RGBA oracle')
  let rgbSum=0,rgbMax=0,alphaSum=0,alphaMax=0,premultSum=0,premultMax=0;for(let at=0;at<native.length;at+=4){const ad=Math.abs(pixels.data[at+3]-native[at+3]);alphaSum+=ad;alphaMax=Math.max(alphaMax,ad);for(let c=0;c<3;c++){const d=Math.abs(pixels.data[at+c]-native[at+c]),pd=Math.abs(pixels.data[at+c]*pixels.data[at+3]/255-native[at+c]*native[at+3]/255);rgbSum+=d;rgbMax=Math.max(rgbMax,d);premultSum+=pd;premultMax=Math.max(premultMax,pd)}}
  const count=reference.width*reference.height,measurement={status:reference.accepted?'NATIVE_RGBA_EXACT':'DECLINED_BASELINE_IDENTICAL',actualRGBA_SHA256:sha(pixels.data),nativeRGBA_SHA256:reference.nativeRGBA_SHA256,encodedSHA256:sha(actual),declineReason:reference.declineReason,rgbMAE:rgbSum/(count*3),rgbMax,alphaMAE:alphaSum/count,alphaMax,premultMAE:premultSum/(count*3),premultMax,interaction:index===0?'Real toolbar':'Live Editor apply command',undoRedoAndSaveReopen:'PENDING'};measurements[reference.name]=measurement
  await writeFile(join(output,reference.name+'.png'),actual);await historyAndSave(before,beforeBytes,after,afterBytes,reference.name);measurement.undoRedoAndSaveReopen='PASS';checks.push(reference.name+': '+(reference.accepted?'exact real Photoshop RGBA':'original baseline RGBA unchanged')+'; native input, Undo/Redo, save/reopen exact')
 }
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[]);assert.equal(checks.length,10)
 const report={status:'PASS',version:await app.evaluate(({app})=>app.getVersion()),actualRuntime:await app.evaluate(()=>process.versions),packaged,fixtureSHA256:sha(fixtureBytes),frozenCandidateSHA256:fixture.frozenCandidateSHA256,counts:{nativeExact:6,declinedUnchanged:4,realToolbarCases:1,historySaveReopenCases:10},checks,errors,measurements,oracle:'Six immutable post-freeze real Photoshop outputs; four immutable original-path outputs. No source/core crop oracle.',boundary:'Native exactness is limited to the guarded RGB8 full-source even-center two-axis magnification scope. Other perspective/alpha behavior remains partial.',systemClipboard:'untouched'}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}catch(cause){
 if(page){measurements.failurePublicState=await page.evaluate(()=>window.compositor.request('state')).catch(e=>({error:String(e)}));measurements.failureVisibleError=await page.locator('.error-toast').innerText({timeout:1000}).catch(()=>null)}
 const report=JSON.stringify({status:'FAIL',packaged,checks,errors,measurements,error:String(cause),stack:cause instanceof Error?cause.stack:undefined},null,2);await writeFile(join(output,'report.json'),report);await writeFile(join(output,'first-failure.json'),report,{flag:'wx'}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e});await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).catch(()=>{});throw cause
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
