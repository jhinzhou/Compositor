/** Isolated real Electron acceptance, executed serially by the root agent.
 * Frozen Photoshop masks are installed through public IPC; Patch commits use
 * both public main apply IPC and real mouse gestures. Only open-dialog paths
 * are doubled. Photoshop pixels are independent frozen references; same-source CLI preparation
 * checks runtime consistency separately and is not a Photoshop oracle. */
import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createServer} from 'node:net'
import {gunzipSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
import {assetRepresentationURL} from '../src/shared/asset-representation'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {EditorState,EditAction} from '../src/shared/contracts'
import type {Selection} from '../src/shared/pixel-contracts'

interface Fixture {
 version:string;dataset:string;classification:string;width:number;height:number;sourceSha:string;sourceRGBA:string;coverageSha:string;coverage:string;compression:string;validNativeEffect:boolean
 operation:{mode:'source';transparent:boolean;offset:[number,number];nativeFeather:number;selection:string}
 cases:{id:string;diffusion:number;nativeRGBA:string;nativeSha:string;history:string;error:string;changed:number;outside:number;alphaChanged:number}[]
}
const root=process.cwd(),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/patch-tail-alpha28',packaged=!!process.env.COMPOSITOR_EXECUTABLE
const directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-patch-tail-alpha28-')))
const ids=['slanted-aa','slanted-feather05','slanted-feather25','slanted-feather5','curved-aa','core-and-soft-island'],checks:string[]=[],errors:string[]=[],measurements:Record<string,unknown>={}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
function exactSelection(f:Fixture,coverage:Uint8Array):Selection{
 const runs:[number,number,number,number][]=[]
 for(let y=0;y<f.height;y++)for(let x=0;x<f.width;){const start=x,value=coverage[y*f.width+x];while(x<f.width&&coverage[y*f.width+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
 // Native feather is already baked in coverage. Applying it twice invalidates the oracle.
 return {inverted:false,antialiased:false,shapes:[{kind:'raster',operation:'replace',bounds:[0,0,f.width,f.height],feather:0,raster:{width:f.width,height:f.height,transform:{origin:[0,0],size:[f.width,f.height],rotation:0,flipX:false,flipY:false},runs}}]}
}
async function loadFixture(id:string){
 const path=join(root,`fixtures/parity/photoshop-27.11-patch-tail-holdout-${id}-alpha28.json`),physical=await readFile(path),f=JSON.parse(physical.toString('utf8')) as Fixture
 assert.equal(f.dataset,'alpha28-independent-patch-tail-'+id);assert.equal(f.width,320);assert.equal(f.height,240);assert.deepEqual(f.operation.offset,[-104,24]);assert.equal(f.sourceSha,'d1b8be12247f4084873d4f18623e5f67d10166055740000a2ac2ab1f5ae7aee0');assert.equal(f.compression,'gzip');assert.ok(f.validNativeEffect);assert.match(f.version,/27\.11/);assert.equal(f.operation.mode,'source');assert.equal(f.operation.transparent,false)
 const source=gunzipSync(Buffer.from(f.sourceRGBA,'base64')),coverage=gunzipSync(Buffer.from(f.coverage,'base64')),native=gunzipSync(Buffer.from(f.cases[0].nativeRGBA,'base64'))
 assert.equal(source.length,f.width*f.height*4);assert.equal(native.length,source.length);assert.equal(coverage.length,f.width*f.height)
 assert.equal(sha(source),f.sourceSha);assert.equal(sha(coverage),f.coverageSha);assert.equal(sha(native),f.cases[0].nativeSha);assert.equal(f.cases[0].diffusion,5);assert.equal(f.cases[0].history,'修补选区');assert.equal(f.cases[0].error,'');assert.equal(f.cases[0].outside,0);assert.equal(f.cases[0].alphaChanged,0)
 const selection=exactSelection(f,coverage),editor=new Editor();editor.create(f.width,f.height)
 const decoy=new PNG({width:f.width,height:f.height});for(let p=0;p<f.width*f.height;p++)decoy.data.set([19,47,91,255],p*4)
 editor.importPNG(PNG.sync.write(decoy),'Tail Patch decoy');const decoyId=editor.state().manifest.activeLayerID!
 const sourcePNG=new PNG({width:f.width,height:f.height});sourcePNG.data=Buffer.from(source);editor.importPNG(PNG.sync.write(sourcePNG),`Tail Patch native target ${id}`)
 const targetId=editor.state().manifest.activeLayerID!,projectPath=join(directory,id+'.comp');await editor.saveAs(projectPath)
 // Choose the maximum-coverage pixel nearest the selection centroid: even low peaks are valid hit targets.
 let sumX=0,sumY=0,weight=0,peak=0;for(let p=0;p<coverage.length;p++){sumX+=(p%f.width+.5)*coverage[p];sumY+=(Math.floor(p/f.width)+.5)*coverage[p];weight+=coverage[p];peak=Math.max(peak,coverage[p])}assert.ok(weight>0)
 const center:[number,number]=[sumX/weight,sumY/weight];let at=-1,distance=Infinity
 for(let p=0;p<coverage.length;p++)if(coverage[p]===peak){const d=Math.hypot(p%f.width+.5-center[0],Math.floor(p/f.width)+.5-center[1]);if(d<distance){distance=d;at=p}}
 const start:[number,number]=[at%f.width+.5,Math.floor(at/f.width)+.5],end:[number,number]=[start[0]+f.operation.offset[0],start[1]+f.operation.offset[1]]
 assert.ok(end[0]>=0&&end[0]<f.width&&end[1]>=0&&end[1]<f.height)
 const cli=preparePatch({...editor.snapshot(),selection},{type:'layer.patch',layerId:targetId,offset:f.operation.offset,mode:'source',opacity:1,adaptation:1,protectAlpha:true})
 const cliRGBA=PNG.sync.read(cli.png).data
 return {id,f,source,coverage,native,selection,targetId,decoyId,projectPath,start,end,peak,cliRGBA,fixtureSHA:sha(physical)}
}
type Loaded=Awaited<ReturnType<typeof loadFixture>>
// Frozen production alpha27 residuals from independently decoded alpha28 references.
// These are bounds against regression, not a zero-error Photoshop parity gate.
const nativeBounds:Record<string,{mae:number;max:number;extra:number;missing:number}>={
 'slanted-aa':{mae:.993697044843976,max:8,extra:5,missing:9},
 'slanted-feather05':{mae:.7361347719098997,max:5,extra:180,missing:6},
 'slanted-feather25':{mae:.6344406587166382,max:9,extra:256,missing:34},
 'slanted-feather5':{mae:.5174295401568129,max:9,extra:281,missing:57},
 'curved-aa':{mae:.64920998980632,max:7,extra:7,missing:4},
 'core-and-soft-island':{mae:.4989784946236559,max:9,extra:317,missing:75}
}
function compare(f:Loaded,actual:Uint8Array){
 assert.equal(actual.length,f.source.length);assert.deepEqual(Buffer.from(actual),f.cliRGBA,'Runtime Patch must match current source CLI decoded RGBA exactly')
 let error=0,max=0,channels=0,changed=0,extra=0,missing=0
 for(let p=0;p<f.coverage.length;p++){
  assert.equal(actual[p*4+3],f.source[p*4+3],`alpha changed at ${p}`)
  if(!f.coverage[p])assert.deepEqual(Buffer.from(actual.subarray(p*4,p*4+4)),f.source.subarray(p*4,p*4+4),`outside RGBA changed at ${p}`)
  else for(let c=0;c<3;c++){const delta=Math.abs(actual[p*4+c]-f.native[p*4+c]);error+=delta;max=Math.max(max,delta);channels++}
  const productChanged=[0,1,2].some(c=>actual[p*4+c]!==f.source[p*4+c]),nativeChanged=[0,1,2].some(c=>f.native[p*4+c]!==f.source[p*4+c])
  if(productChanged)changed++;if(productChanged&&!nativeChanged)extra++;if(nativeChanged&&!productChanged)missing++
 }
 assert.ok(changed>0);const mae=error/channels,bounds=nativeBounds[f.id]
 assert.ok(mae<=bounds.mae+1e-12,`${f.id} covered RGB MAE ${mae} exceeds frozen ${bounds.mae}`);assert.ok(max<=bounds.max,`${f.id} max ${max} exceeds frozen ${bounds.max}`);assert.ok(extra<=bounds.extra,`${f.id} extra ${extra} exceeds ${bounds.extra}`);assert.ok(missing<=bounds.missing,`${f.id} missing ${missing} exceeds ${bounds.missing}`)
 return {runtimeCLIByteExact:true,cliDecodedRGBA_SHA256:sha(f.cliRGBA),actualDecodedRGBA_SHA256:sha(actual),outsideRGBAChanged:0,alphaChanged:0,nativeEffect:{status:'PARTIAL',coveredRGBMAE:mae,coveredRGBMax:max,changed,nativeChanged:f.f.cases[0].changed,extra,missing,nativeDecodedRGBA_SHA256:f.f.cases[0].nativeSha,byteExactNative:Buffer.from(actual).equals(f.native),regressionBounds:bounds,meaning:'Frozen residual upper bounds; passing runtime does not imply Photoshop equivalence'}}
}

try{
 const fixtures=await Promise.all(ids.map(loadFixture))
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(w.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(w.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(p=>p.url()===url)}else{await expect.poll(()=>app!.windows().map(p=>p.url())).toContain(url);page=app.windows().find(p=>p.url()===url)}assert.ok(page)
 const ui=page;ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 await app.evaluate(({BrowserWindow,app},url)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url)!;w.setContentSize(1280,850);if(process.platform==='darwin')app.setActivationPolicy('regular');w.show();app.focus({steal:true});w.focus()},url)
 const focusAttempts:unknown[]=[],nativeFocusTimeout=Number(process.env.COMPOSITOR_NATIVE_FOCUS_TIMEOUT_MS??15000)
 assert.ok(Number.isFinite(nativeFocusTimeout)&&nativeFocusTimeout>=15000&&nativeFocusTimeout<=60000,'Diagnostic native focus timeout must remain bounded to 15–60 seconds')
 console.log(JSON.stringify({stage:'native-focus-ready',...(await app.evaluate(({app})=>({pid:process.pid,executable:app.getPath('exe')}))),nativeFocusTimeout}))
 // macOS may defer activation until after the first show. Re-request real native
 // activation while polling; never replace isFocused() with page focus or a mock.
 await expect.poll(async()=>{
  await ui.bringToFront()
  const actual=await app!.evaluate(({BrowserWindow,app},url)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()===url)!;if(process.platform==='darwin')app.show();app.focus({steal:true});w.moveTop();w.focus();w.webContents.focus();return {focused:w.isFocused(),webContentsFocused:w.webContents.isFocused(),visible:w.isVisible(),focusable:w.isFocusable(),focusedWindow:BrowserWindow.getFocusedWindow()?.id}},url)
  focusAttempts.push(actual);measurements.initialNativeFocusAttempts=focusAttempts
  return actual.focused
 },{timeout:nativeFocusTimeout,intervals:[100,250,500,1000],message:'Actual isolated main BrowserWindow must acquire native focus before any editing'}).toBe(true)
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await ui.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.ok(result.ok,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),primary=process.platform==='darwin'?'Meta':'Control'
 async function frame(){await ui.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
 async function settle(){await expect(ui.getByTestId('editor-canvas')).toHaveAttribute('data-rendering','false',{timeout:20000})}
 async function assets(s:EditorState){const bytes:Record<string,Buffer>={};for(const asset of s.assets){const url=assetRepresentationURL(s,asset.file);bytes[asset.file]=Buffer.from(await ui.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),url))}return bytes}
 function targetFile(s:EditorState,f:Loaded){const layer=s.manifest.layers.find(l=>l.id===f.targetId);assert.ok(layer?.imageFile);return layer.imageFile}
 async function apply(action:EditAction){const s=await state();return rpc('apply',{sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID(),action})}
 async function unchanged(before:EditorState,bytes:Record<string,Buffer>){const after=await state();assert.equal(after.revision,before.revision);assert.deepEqual(after.manifest,before.manifest);assert.deepEqual(after.selection,before.selection);assert.deepEqual(await assets(after),bytes)}
 async function undo(before:EditorState,after:EditorState,bytes:Record<string,Buffer>){await ui.locator('.status-bar').click();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).revision).toBe(after.revision+1);const restored=await state();assert.deepEqual(restored.manifest,before.manifest);assert.deepEqual(restored.selection,before.selection);assert.deepEqual(await assets(restored),bytes);return restored}
 async function noBusy(){const s=await state();await expect.poll(async()=>{const result=await ui.evaluate(params=>window.compositor.request('switchDocument',params),{sessionId:s.sessionId});return result.ok},{timeout:10000,message:'Canceled Patch must release actual main document interaction lease'}).toBe(true);assert.equal((await state()).revision,s.revision);assert.deepEqual(await rpc('imageOperationState'),[])}
 async function point(x:number,y:number){const s=await state();return ui.locator('.canvas-wrap').evaluate((element,{x,y,width,height})=>{const r=element.getBoundingClientRect(),z=parseFloat((element as HTMLElement).style.width)/width,a=Number(document.querySelector('.editor-shell')?.getAttribute('data-view-angle')??0)*Math.PI/180,dx=(x-width/2)*z,dy=(y-height/2)*z;return {x:r.left+r.width/2+dx*Math.cos(a)-dy*Math.sin(a),y:r.top+r.height/2+dx*Math.sin(a)+dy*Math.cos(a)}},{x,y,width:s.manifest.width,height:s.manifest.height})}
 async function heldDrag(f:Loaded){const a=await point(...f.start),b=await point(...f.end);await ui.mouse.move(a.x,a.y);await ui.mouse.down();await ui.mouse.move(b.x,b.y,{steps:4});await frame()}
 async function configurePatch(){await ui.locator('.rail-tools>button[data-tool-group="J"]').click({button:'right'});await ui.getByRole('menu',{name:'Tools · J',exact:true}).getByRole('menuitemradio',{name:'Patch Tool',exact:true}).click();const bar=ui.getByTestId('patch-toolbar');await expect(bar).toBeVisible();await bar.getByRole('combobox',{name:'Patch mode',exact:true}).selectOption('source');const adaptation=bar.getByRole('spinbutton',{name:'Adaptation',exact:true});await adaptation.fill('1');await adaptation.press('Tab');await bar.getByRole('checkbox',{name:'Preserve target transparency',exact:true}).check()}
 await rpc('localeSet',{locale:'en'})
 for(const f of fixtures){
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},f.projectPath);await rpc('openDialog');await ui.getByRole('button',{name:'100%',exact:true}).click();await settle()
  await ui.getByRole('button',{name:'Select Tail Patch decoy image',exact:true}).click();await expect(ui.locator(`.layer-row[data-layer-id="${f.decoyId}"]`)).toHaveClass(/\bselected\b/);await expect(ui.locator('.layer-row.selected')).toHaveCount(1)
  await ui.getByRole('button',{name:`Select Tail Patch native target ${f.id} image`,exact:true}).click();await expect(ui.locator(`.layer-row[data-layer-id="${f.targetId}"]`)).toHaveClass(/\bselected\b/);await expect(ui.locator(`.layer-row[data-layer-id="${f.decoyId}"]`)).not.toHaveClass(/\bselected\b/);await expect(ui.locator('.layer-row.selected')).toHaveCount(1)
  await apply({type:'selection.set',selection:f.selection});await settle();let before=await state();const baseline=await assets(before),file=targetFile(before,f)
  assert.equal(sha(PNG.sync.read(baseline[file]).data),f.f.sourceSha)
  for(let y=0;y<f.f.height;y++)for(let x=0;x<f.f.width;x++)assert.equal(Math.round(selectionCoverage(before.selection,x+.5,y+.5)*255),f.coverage[y*f.f.width+x],`exact native coverage ${f.id} (${x},${y})`)
  assert.equal(before.manifest.activeLayerID,f.targetId)
  // The sidebar selected class is transient UI selection; manifest.activeLayerID remains the saved target.
  // Main-process public IPC route; this is not the auxiliary subject/content-fill imageJobs path.
  await apply({type:'layer.patch',layerId:f.targetId,offset:f.f.operation.offset,mode:'source',opacity:1,adaptation:1,protectAlpha:true})
  let after=await state();assert.equal(after.revision,before.revision+1);assert.deepEqual(after.selection,before.selection);assert.equal(after.manifest.activeLayerID,f.targetId)
  const rpcAssets=await assets(after),rpcPNG=PNG.sync.read(rpcAssets[targetFile(after,f)]),rpcMetrics=compare(f,rpcPNG.data)
  for(const [name,bytes] of Object.entries(baseline))if(name!==file)assert.deepEqual(rpcAssets[name],bytes,`RPC changed unrelated asset ${name}`)
  before=await undo(before,after,baseline);await noBusy();checks.push(`${f.id}: actual main apply RPC matches source CLI and frozen native residual bounds; exact one Undo, alpha/outside/decoy unchanged`)
  await configurePatch();await expect(ui.locator(`.layer-row[data-layer-id="${f.targetId}"]`)).toHaveClass(/\bselected\b/);before=await state();await heldDrag(f);await unchanged(before,baseline)
  await ui.mouse.up();await expect.poll(async()=>(await state()).revision,{timeout:30000}).toBe(before.revision+1)
  after=await state();const uiAssets=await assets(after),uiPNG=PNG.sync.read(uiAssets[targetFile(after,f)]),uiMetrics=compare(f,uiPNG.data)
  assert.deepEqual(uiPNG.data,rpcPNG.data,'UI Patch drag must match real main apply output');assert.deepEqual(after.selection,before.selection);assert.equal(after.manifest.activeLayerID,f.targetId)
  for(const [name,bytes] of Object.entries(baseline))if(name!==file)assert.deepEqual(uiAssets[name],bytes,`UI changed unrelated asset ${name}`)
  await settle();await ui.screenshot({path:join(output,`${f.id}-ui-result.png`)});await writeFile(join(output,`${f.id}-actual.png`),uiAssets[targetFile(after,f)])
  before=await undo(before,after,baseline);await noBusy();
  // UI, cancellation, Redo and persistence form the second per-case runtime check below.
  await heldDrag(f);await unchanged(before,baseline);await ui.keyboard.press('Escape');await ui.mouse.up();await frame();await unchanged(before,baseline);await noBusy();await settle();await ui.locator('.status-bar').click();await ui.keyboard.press(`${primary}+Shift+z`);await expect.poll(async()=>(await state()).revision).toBe(before.revision+1)
  const redone=await state();assert.deepEqual(redone.manifest,after.manifest);assert.deepEqual(redone.selection,after.selection);assert.deepEqual(await assets(redone),uiAssets)
  await rpc('saveCurrent',{sessionId:redone.sessionId});assert.equal((await state()).modified,false)
  await rpc('closeDocument',{sessionId:(await state()).sessionId});await rpc('openDialog');await settle();const reopened=await state();assert.equal(reopened.projectPath,f.projectPath);assert.equal(reopened.modified,false);assert.deepEqual(reopened.manifest,redone.manifest);assert.deepEqual(await assets(reopened),uiAssets);compare(f,PNG.sync.read((await assets(reopened))[targetFile(reopened,f)]).data)
  checks.push(`${f.id}: real UI Source Patch matches main RPC/CLI; held preview atomic; Escape releases lease; exact Undo/Redo and save/reopen preserve all assets`)
  measurements[f.id]={fixtureFileSHA256:f.fixtureSHA,sourceDecodedRGBA_SHA256:f.f.sourceSha,selectionCoverageSHA256:f.f.coverageSha,nativeVersion:f.f.version,nativeFeatherAlreadyBaked:f.f.operation.nativeFeather,nativeDiffusion:5,productAdaptation:1,selectionPeak:f.peak,mouseStart:f.start,mouseEnd:f.end,offset:f.f.operation.offset,targetLayerId:f.targetId,decoyLayerId:f.decoyId,rpc:rpcMetrics,ui:uiMetrics}
  // The re-opened committed project is saved; only this isolated fixture document closes.
  const current=await state();assert.equal(current.modified,false);await rpc('closeDocument',{sessionId:current.sessionId})
 }
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[])
 assert.equal(checks.length,12)
 const report={status:'PASS',runtimeStatus:'PASS',nativeEffectStatus:'PARTIAL',version:await app.evaluate(({app})=>app.getVersion()),packaged,checks,errors,measurements,inputMechanism:'Public preload IPC main apply + actual UI mouse/keyboard; native open-dialog paths doubled only',selectionOrigin:'Frozen native alpha mask installed via public selection.set IPC; not GUI drawn',nativeScope:'RGB8 procedural source, Photoshop 27.11 normal Source Patch Diffusion5 offset[-104,24]; all native MAE/max/extra/missing residuals nested under PARTIAL; no claim of Photoshop equivalence',route:'layer.patch uses primary main apply/worker route, not auxiliary imageJobs',systemClipboard:'untouched'}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(cause){
 if(page){measurements.failurePublicState=await page.evaluate(()=>window.compositor.request('state')).catch(error=>({error:String(error)}));measurements.failureVisibleError=await page.locator('.error-toast').innerText({timeout:1000}).catch(()=>null)}
 if(app)measurements.failureWindowFocus=await app.evaluate(({app,BrowserWindow})=>({pid:process.pid,version:app.getVersion(),packaged:app.isPackaged,executable:app.getPath('exe'),hidden:process.platform==='darwin'?app.isHidden():undefined,focusedWindow:BrowserWindow.getFocusedWindow()?.id,windows:BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL(),visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable(),minimized:w.isMinimized(),bounds:w.getBounds()}))})).catch(error=>({error:String(error)}))
 const report=JSON.stringify({status:'FAIL',packaged,checks,errors,measurements,error:String(cause),stack:cause instanceof Error?cause.stack:undefined},null,2);await writeFile(join(output,'report.json'),report);await writeFile(join(output,'first-failure.json'),report,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})
 await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).then(async()=>{await writeFile(join(output,'first-failure.png'),await readFile(join(output,'failure.png')),{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error})}).catch(()=>{});throw cause
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
