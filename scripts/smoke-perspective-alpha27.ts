/** Root runs this serially after a build. Importing it launches Electron.
 * All crop geometry/profile/size/apply/undo gestures use actual UI input.
 * Only native open/save dialog paths are doubled; RPC reads public state.
 * Native RGB8 oracle and authored deep/HDR precision probes are distinguished. */
import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {createServer} from 'node:net'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {build} from 'esbuild'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from '../src/core/project-io'
import {decodeDeepPNG,inspectPNG} from '../src/core/deep-assets'
import {decodeEXR} from '../src/core/hdr-codecs'
import {assetRepresentationURL} from '../src/shared/asset-representation'
import type {EditorState} from '../src/shared/contracts'
import type {CropCorners} from '../src/shared/crop-projective'

const root=process.cwd(),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/perspective-alpha27',packaged=!!process.env.COMPOSITOR_EXECUTABLE
const fixture=JSON.parse(await readFile(join(root,'fixtures/parity/photoshop-27.11-perspective-gui-alpha27.json'),'utf8'))
const native=fixture.cases.find((entry:{name:string})=>entry.name==='actual-mouse-auto-292163');assert.ok(native)
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
function decode(entry:{rgbaZlib:string;sha256:string;width:number;height:number}){const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(sha(bytes),entry.sha256);assert.equal(bytes.length,entry.width*entry.height*4);return bytes}
const source=decode(fixture.source),nativePixels=decode(native),width=fixture.source.width,height=fixture.source.height
assert.deepEqual([width,height],[384,256]);assert.deepEqual([native.width,native.height],[292,163])
const corners:CropCorners=native.corners,directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-perspective-alpha27-')))
const paths=new Map<8|16|'hdr',string>(),checks:string[]=[],errors:string[]=[],measurements:Record<string,unknown>={}
const oraclePath=join(directory,'same-runtime-core-oracle.cjs'),execFileAsync=promisify(execFile)
await build({entryPoints:[join(root,'scripts/perspective-smoke-oracle-alpha27.ts')],bundle:true,platform:'node',format:'cjs',outfile:oraclePath,logLevel:'silent'})
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
for(const precision of [8,16,'hdr'] as const){
 const editor=new Editor();editor.create(width,height);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:`Perspective alpha27 ${precision}`}})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.id+(precision==='hdr'?'.exr':'.png');layer.imageFile=file
 let asset:Asset
 if(precision===8){const image=new PNG({width,height});image.data.set(source);asset=makeAsset(file,PNG.sync.write(image))}
 else if(precision===16){const data=new Uint16Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=i%4===3?source[i]*257:Math.min(65535,source[i]*257+13+(i%17));asset=makeDeepAsset(file,width,height,data);snapshot.manifest.version=12}
 else{const data=new Float32Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=i%4===3?source[i]/255:i%4===0?1.25+source[i]/255:i%4===1?-.5+source[i]/1020:source[i]/255;asset=makeHDRAsset(file,width,height,data);snapshot.manifest.version=13}
 snapshot.assets.set(file,asset);editor.importDocument(snapshot.manifest,snapshot.assets,`Perspective alpha27 ${precision}`)
 const path=join(directory,`perspective-${precision}.comp`);await editor.saveAs(path);paths.set(precision,path)
}
try{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(item=>item.url()===url)}else{await expect.poll(()=>app!.windows().map(item=>item.url())).toContain(url);page=app.windows().find(item=>item.url()===url)}assert.ok(page)
 const ui=page;ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 await app.evaluate(({ipcMain})=>{
  const handlers=(ipcMain as unknown as {_invokeHandlers:Map<string,(event:Electron.IpcMainInvokeEvent,input:any)=>unknown>})._invokeHandlers,original=handlers.get('editor:request');if(!original)throw new Error('Editor RPC handler missing')
  const owned=globalThis as typeof globalThis&{alpha27PerspectiveActions?:unknown[]};owned.alpha27PerspectiveActions=[]
  ipcMain.removeHandler('editor:request');ipcMain.handle('editor:request',(event,input)=>{if(input?.method==='apply'&&input.params?.action?.type==='document.perspective_crop')owned.alpha27PerspectiveActions!.push(structuredClone(input.params.action));return original(event,input)})
 })
 await app.evaluate(({BrowserWindow},url)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!;window.setContentSize(1280,850);window.show();window.focus()},url)
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await ui.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.ok(result.ok,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),primary=process.platform==='darwin'?'Meta':'Control'
 async function frame(){await ui.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))))}
 async function settle(){await expect(ui.getByTestId('editor-canvas')).toHaveAttribute('data-rendering','false',{timeout:20000})}
 async function focus(){await ui.locator('.status-bar').click()}
 async function open(path:string){await app!.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path);await rpc('openDialog');await ui.getByRole('button',{name:'100%',exact:true}).click();await settle();return state()}
 async function point(x:number,y:number){const s=await state();return ui.locator('.canvas-wrap').evaluate((element,{x,y,width,height})=>{const rect=element.getBoundingClientRect(),zoom=parseFloat((element as HTMLElement).style.width)/width,angle=Number(document.querySelector('.editor-shell')?.getAttribute('data-view-angle')??0)*Math.PI/180,dx=(x-width/2)*zoom,dy=(y-height/2)*zoom;return{x:rect.left+rect.width/2+dx*Math.cos(angle)-dy*Math.sin(angle),y:rect.top+rect.height/2+dx*Math.sin(angle)+dy*Math.cos(angle)}},{x,y,width:s.manifest.width,height:s.manifest.height})}
 async function drag(a:[number,number],b:[number,number]){const p=await point(...a),q=await point(...b);await ui.mouse.move(p.x,p.y);await frame();await ui.mouse.down();await ui.mouse.move(q.x,q.y,{steps:5});await frame();await ui.mouse.up();await frame()}
 async function sources(s:EditorState){const bytes:Record<string,Buffer>={};for(const asset of s.assets){const url=assetRepresentationURL(s,asset.file);bytes[asset.file]=Buffer.from(await ui.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),url))}return bytes}
 function imageFile(s:EditorState){const layer=s.manifest.layers.find(item=>item.id===s.manifest.activeLayerID);assert.ok(layer?.imageFile);return layer.imageFile}
 // Build the oracle from the physical source representation actually loaded
 // into this session, including EXR's scene-linear FLOAT transfer roundtrip.
 function loadedSource(s:EditorState,bytes:Record<string,Buffer>){const file=imageFile(s);assert.ok(bytes[file]);return makeAsset(file,bytes[file],{allow16:true,allowHDR:true})}
 async function rawQuad(){return ui.locator('.crop-geometry-overlay circle[role="button"]').evaluateAll(elements=>elements.map(element=>[Number(element.getAttribute('cx')),Number(element.getAttribute('cy'))]))}
 async function sameRuntimeExpected(s:EditorState,bytes:Record<string,Buffer>,name:string){
  const actions=await app!.evaluate(()=>((globalThis as typeof globalThis&{alpha27PerspectiveActions?:unknown[]}).alpha27PerspectiveActions??[])),action=actions.at(-1) as {corners:CropCorners;width:number;height:number;sampling:'High quality'};assert.ok(action);assert.equal(action.sampling,'High quality')
  const file=imageFile(s),layer=s.manifest.layers.find(l=>l.id===s.manifest.activeLayerID)!;assert.ok(bytes[file]);const sourcePath=join(directory,name+'-source'+(file.endsWith('.exr')?'.exr':'.png')),expectedPath=join(directory,name+'-expected'+(file.endsWith('.exr')?'.exr':'.png')),reportPath=join(output,name+'-same-runtime-oracle.json'),jobPath=join(directory,name+'-oracle-job.json')
  await writeFile(sourcePath,bytes[file]);await writeFile(jobPath,JSON.stringify({sourcePath,assetFile:file,outputPath:expectedPath,reportPath,placement:layer.transform,...action}));const executable=await app!.evaluate(()=>process.execPath)
  await execFileAsync(executable,[oraclePath,jobPath],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},cwd:root,timeout:20000});const report=JSON.parse(await readFile(reportPath,'utf8')),actualRuntime=await app!.evaluate(()=>process.versions);assert.equal(report.sourceSHA256,sha(bytes[file]));for(const key of ['node','v8','electron','zlib'])assert.equal(report.runtime[key],actualRuntime[key as keyof typeof actualRuntime]);measurements[name+'-oracle']=report
  return {bytes:await readFile(expectedPath),action}
 }
 async function image(s:EditorState){return(await sources(s))[imageFile(s)]}
 async function assertQuad(expected:CropCorners){await expect.poll(()=>ui.locator('.crop-geometry-overlay circle[role="button"]').evaluateAll(elements=>elements.map(element=>[Number(element.getAttribute('cx')),Number(element.getAttribute('cy'))]).map(p=>p.map(value=>Math.round(value*1e6)/1e6)))).toEqual(expected)}
 async function choosePerspective(){await ui.locator('.rail-tools>button[data-tool-group="C"]').click();await ui.getByRole('combobox',{name:'Crop mode',exact:true}).selectOption('perspective');await ui.getByRole('checkbox',{name:'Four-corner input',exact:true}).uncheck();await ui.getByRole('combobox',{name:'Crop ratio',exact:true}).selectOption('Free');await frame()}
 async function chooseProfile(profile:'photoshop'|'compositor'){await focus();await ui.getByRole('button',{name:'Search commands',exact:true}).click();await ui.getByRole('combobox',{name:'Search commands',exact:true}).fill('Keyboard Shortcuts');await ui.getByRole('option',{name:/Keyboard Shortcuts/}).click();await expect(ui.getByRole('dialog',{name:'Keyboard shortcuts',exact:true})).toBeVisible();await ui.getByRole('button',{name:profile==='photoshop'?'Photoshop':'Compositor',exact:true}).click();await ui.getByRole('dialog',{name:'Keyboard shortcuts',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();await expect(ui.locator('.editor-shell')).toHaveAttribute('data-interaction-profile',profile)}
 async function sizeEquals(w:number,h:number){await expect(ui.getByRole('spinbutton',{name:'Perspective output width',exact:true})).toHaveValue(String(w));await expect(ui.getByRole('spinbutton',{name:'Perspective output height',exact:true})).toHaveValue(String(h))}
 async function quadDraft(expected:CropCorners){
  await choosePerspective();if(await ui.getByRole('button',{name:/^Perspective corner [1-4]$/}).count()){await ui.locator('.raster-toolbar').getByRole('button',{name:'Cancel',exact:true}).click();await choosePerspective()}
  await drag(expected[0],[expected[1][0]-1,expected[2][1]-1]);await expect(ui.getByRole('button',{name:/^Perspective corner [1-4]$/})).toHaveCount(4)
  for(let index=1;index<4;index++){const handle=await ui.getByRole('button',{name:`Perspective corner ${index+1}`,exact:true}).boundingBox();assert.ok(handle);const target=await point(...expected[index]);await ui.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await ui.mouse.down();await ui.mouse.move(target.x,target.y,{steps:5});await ui.mouse.up();await frame()}
  await assertQuad(expected)
 }
 async function oldQuadDraft(){await quadDraft(corners);await sizeEquals(292,163)}
 async function explicitSize(w:number,h:number){for(const[name,value]of [['Perspective output width',w],['Perspective output height',h]] as const){const field=ui.getByRole('spinbutton',{name,exact:true});await field.fill(String(value));await field.press('Tab')}await sizeEquals(w,h)}
 async function undo(before:EditorState,after:EditorState,bytes:Record<string,Buffer>){await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).revision).toBe(after.revision+1);const undone=await state();assert.deepEqual(undone.manifest,before.manifest);assert.deepEqual(undone.selection,before.selection);assert.deepEqual(await sources(undone),bytes)}
 async function redo(after:EditorState,bytes:Record<string,Buffer>){const before=await state();await focus();await ui.keyboard.press(`${primary}+Shift+z`);await expect.poll(async()=>(await state()).revision).toBe(before.revision+1);assert.deepEqual((await state()).manifest,after.manifest);assert.deepEqual(await sources(await state()),bytes)}
 async function saveAndReopen(name:string){const before=await state(),bytes=await sources(before),path=join(directory,'saved-'+name+'.comp');await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},path);await rpc('saveDialog',{sessionId:before.sessionId});await rpc('closeDocument',{sessionId:before.sessionId});const reopened=await open(path);assert.deepEqual(reopened.manifest,before.manifest);assert.deepEqual(await sources(reopened),bytes);await rpc('closeDocument',{sessionId:reopened.sessionId})}

 await rpc('localeSet',{locale:'en'});await expect(ui.locator('.editor-shell')).toHaveAttribute('data-interaction-profile','photoshop')
 for(const precision of [8,16,'hdr'] as const){
  const before=await open(paths.get(precision)!),beforeBytes=await sources(before);await oldQuadDraft();assert.equal((await state()).revision,before.revision);assert.deepEqual(await sources(await state()),beforeBytes)
  await ui.screenshot({path:join(output,`draft-${precision}.png`),animations:'disabled'});await explicitSize(292,163);measurements[`gui-${precision}-rawQuad`]=await rawQuad()
  await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision,{timeout:20000}).toBe(before.revision+1)
  const after=await state(),afterBytes=await sources(after),actual=await image(after),expected=await sameRuntimeExpected(before,beforeBytes,`gui-${precision}`);assert.deepEqual([after.manifest.width,after.manifest.height],[292,163]);assert.deepEqual([expected.action.width,expected.action.height],[292,163])
  if(precision===8){const result=PNG.sync.read(actual);assert.deepEqual(result.data,PNG.sync.read(expected.bytes).data);let sum=0,max=0,alphaMax=0;for(let i=0;i<nativePixels.length;i++){const delta=Math.abs(result.data[i]-nativePixels[i]);if(i%4===3)alphaMax=Math.max(alphaMax,delta);else{sum+=delta;max=Math.max(max,delta)}}const mae=sum/(292*163*3);measurements.nativeRGB8={mae,max,alphaMax,width:result.width,height:result.height,nativeRGBA_SHA256:native.sha256,sourceRGBA_SHA256:fixture.source.sha256};assert.ok(mae<=5.485,`Native GUI calibration regression: MAE ${mae}, parity remains partial`);assert.ok(max<=80,`Native GUI calibration max ${max}`);assert.equal(alphaMax,0)}
  else{
   const sourceAsset=loadedSource(before,beforeBytes)
   // Compare identical decoded representations. The offline oracle runs in
   // the actual Electron V8; history/save encoded bytes stay exact below.
   if(precision===16){const pixels=decodeDeepPNG(actual);assert.equal(inspectPNG(actual).bitDepth,16);assert.deepEqual(pixels.deep,decodeDeepPNG(expected.bytes).deep);assert.ok(pixels.deep.some((value,index)=>index%4!==3&&value%257!==0));assert.equal(after.assets.find(asset=>asset.file===imageFile(after))?.bitDepth,16)}
   else{const pixels=decodeEXR(actual);assert.deepEqual(pixels.hdr,decodeEXR(expected.bytes).hdr);assert.ok(pixels.hdr.some((value,index)=>index%4===0&&value>1));assert.ok(pixels.hdr.some((value,index)=>index%4===1&&value<0));assert.ok(after.assets.find(asset=>asset.file===imageFile(after))?.isHDR)}
   measurements[`precision-${precision}`]={sourceEncodedSHA256:sha(sourceAsset.bytes),actualSHA256:sha(actual),expectedEncodedSHA256:sha(expected.bytes),encodedStreamsEqual:actual.equals(expected.bytes),edgeQuad:expected.action.corners,comparison:'Physical .comp loaded source plus captured public action; exact decoded core oracle in actual Electron runtime; not Photoshop deep/HDR oracle'}
  }
  await settle();await ui.screenshot({path:join(output,`result-${precision}.png`),animations:'disabled'});await undo(before,after,beforeBytes);await redo(after,afterBytes);await saveAndReopen(`perspective-${precision}`)
  checks.push(`${precision}: actual PS-profile inclusive rectangle drag and three real corner drags yield actual alpha27 native event EDGE quad; suggestion292163, explicit292163, one history step, Undo/Redo and save/reopen preserve decoded source and encoded output bytes`)
 }

 const affineFixture=JSON.parse(await readFile(join(root,'fixtures/parity/photoshop-27.11-perspective-affine-holdout-alpha27.json'),'utf8')),affineNative=affineFixture.cases.find((c:{name:string})=>c.name==='unseen-axis-down-240160'),fullQuad:CropCorners=[[0,0],[384,0],[384,256],[0,256]]
 for(const precision of [8,16,'hdr'] as const){
  const before=await open(paths.get(precision)!),beforeBytes=await sources(before);await quadDraft(fullQuad);await explicitSize(240,160);measurements[`affine-${precision}-rawQuad`]=await rawQuad();await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(before.revision+1)
  const after=await state(),bytes=await sources(after),actual=await image(after),sourceAsset=loadedSource(before,beforeBytes),expected=await sameRuntimeExpected(before,beforeBytes,`affine-${precision}`);assert.deepEqual([expected.action.width,expected.action.height],[240,160])
  await writeFile(join(output,`affine-${precision}-actual.${precision==='hdr'?'exr':'png'}`),actual);await writeFile(join(output,`affine-${precision}-expected.${precision==='hdr'?'exr':'png'}`),expected.bytes)
  if(precision===8){const pixels=PNG.sync.read(actual),oracle=decode(affineNative);assert.deepEqual(pixels.data,PNG.sync.read(expected.bytes).data);let sum=0,max=0,alphaMax=0;for(let i=0;i<oracle.length;i++){const delta=Math.abs(pixels.data[i]-oracle[i]);if(i%4===3)alphaMax=Math.max(alphaMax,delta);else{sum+=delta;max=Math.max(max,delta)}}const mae=sum/(240*160*3);assert.ok(mae<3.1);assert.ok(max<=43);assert.ok(alphaMax<=11);measurements.affineNative={mae,max,alphaMax,nativeSHA256:affineNative.sha256}}
  else if(precision===16){const pixels=decodeDeepPNG(actual);assert.deepEqual(pixels.deep,decodeDeepPNG(expected.bytes).deep);assert.ok(pixels.deep.some((v,i)=>i%4!==3&&v%257!==0));assert.equal(inspectPNG(actual).bitDepth,16)}
  else{const pixels=decodeEXR(actual);assert.deepEqual(pixels.hdr,decodeEXR(expected.bytes).hdr);assert.ok(pixels.hdr.some((v,i)=>i%4===0&&v>1));assert.ok(pixels.hdr.some((v,i)=>i%4===1&&v<0))}
  measurements[`affine-precision-${precision}`]={sourceEncodedSHA256:sha(sourceAsset.bytes),actualSHA256:sha(actual),expectedEncodedSHA256:sha(expected.bytes),encodedStreamsEqual:actual.equals(expected.bytes),edgeQuad:expected.action.corners,comparison:'Physical .comp loaded source and captured public action; exact decoded core oracle in actual Electron runtime; same-runtime history/save bytes exact'}
  await undo(before,after,beforeBytes);await redo(after,bytes);await saveAndReopen(`affine-${precision}`);checks.push(`${precision}: real full-source inclusive rectangle plus explicit240160 invokes isotropic minification; native RGB8 residual guarded, decoded deep/HDR/source/history/save retain precision`)
 }
 const projectiveFixture=JSON.parse(await readFile(join(root,'fixtures/parity/photoshop-27.11-perspective-projective-holdout-alpha27.json'),'utf8')),projectiveNative=projectiveFixture.cases.find((c:{name:string})=>c.name==='unseen-projective-alpha-down-180120')
 const alphaEditor=new Editor();alphaEditor.create(width,height);alphaEditor.apply({...alphaEditor.identity(),action:{type:'layer.add_blank',name:'Independent alpha projective'}});const alphaSnapshot=alphaEditor.snapshot(),alphaLayer=alphaSnapshot.manifest.layers[0],alphaFile=alphaLayer.id+'.png';alphaLayer.imageFile=alphaFile;const alphaPNG=new PNG({width,height});alphaPNG.data.set(decode(projectiveFixture.source));const alphaAsset=makeAsset(alphaFile,PNG.sync.write(alphaPNG));alphaSnapshot.assets.set(alphaFile,alphaAsset);alphaEditor.importDocument(alphaSnapshot.manifest,alphaSnapshot.assets,'Independent alpha');const alphaPath=join(directory,'independent-alpha.comp');await alphaEditor.saveAs(alphaPath)
 const projectiveBefore=await open(alphaPath),projectiveBytes=await sources(projectiveBefore);await quadDraft(projectiveNative.corners);await explicitSize(180,120);measurements.projectiveRawQuad=await rawQuad();await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(projectiveBefore.revision+1)
 const projectiveAfter=await state(),projectiveOutput=await sources(projectiveAfter),projectiveActual=PNG.sync.read(await image(projectiveAfter)),projectiveSameRuntime=await sameRuntimeExpected(projectiveBefore,projectiveBytes,'projective-heldout'),projectiveExpected=PNG.sync.read(projectiveSameRuntime.bytes),projectiveOracle=decode(projectiveNative);assert.deepEqual([projectiveSameRuntime.action.width,projectiveSameRuntime.action.height],[180,120]);assert.deepEqual(projectiveActual.data,projectiveExpected.data);let projectiveSum=0,projectiveMax=0,projectiveAlphaMax=0;for(let i=0;i<projectiveOracle.length;i++){const delta=Math.abs(projectiveActual.data[i]-projectiveOracle[i]);if(i%4===3)projectiveAlphaMax=Math.max(projectiveAlphaMax,delta);else{projectiveSum+=delta;projectiveMax=Math.max(projectiveMax,delta)}}const projectiveMAE=projectiveSum/(180*120*3);assert.ok(projectiveMAE<=31.546);assert.ok(projectiveMax<=181);assert.equal(projectiveAlphaMax,0);measurements.projectiveHeldout={mae:projectiveMAE,max:projectiveMax,alphaMax:projectiveAlphaMax,status:'PARTIAL_EFFECT_PARITY_NOT_ACCEPTED',nativeSHA256:projectiveNative.sha256,rejectedQuadratureMAE:34.37638888888889}
 await undo(projectiveBefore,projectiveAfter,projectiveBytes);await redo(projectiveAfter,projectiveOutput);await saveAndReopen('projective-independent-alpha');checks.push('Real four-corner projective down180120 on independent fractional-alpha input preserves core/source/history; native RGB residual remains partial and rejected quadrature was not enabled')
 const legacyBefore=await open(paths.get(8)!),legacyBytes=await sources(legacyBefore);await chooseProfile('compositor');await choosePerspective();await drag([45,39],[336,209]);await assertQuad([[45,39],[336,39],[336,209],[45,209]]);await sizeEquals(291,170)
 await ui.locator('.raster-toolbar').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await state()).revision,legacyBefore.revision);assert.deepEqual(await sources(await state()),legacyBytes);await chooseProfile('photoshop');await rpc('closeDocument',{sessionId:legacyBefore.sessionId})
 checks.push('Compositor profile keeps original exclusive291170 rectangle drag; Cancel preserves source/revision and switching profile uses real Keyboard shortcuts UI')
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[])
 const report={status:'PASS',version:await app.evaluate(({app})=>app.getVersion()),hostRuntime:process.versions,actualRuntime:await app.evaluate(()=>process.versions),packaged,checks,errors,measurements,inputMechanism:'Actual Electron profile controls, mouse geometry, dimensions and keyboard Undo/Redo; native open/save dialog paths doubled only',nativeBoundary:'RGB8 actual alpha27 Photoshop GUI + affine/projective holdout effects measured; strict engineering guards are not Photoshop pixel parity. RGB16/HDR are authored precision/edge-semantic regression, not native Photoshop equivalence',remainingAutoSizeGap:'Actual alpha27 GUI292163 is exact; alpha26 independent398265 vs395264 remains3x1 and two new strong size cases309215 vs311216 remain2x1. True projective high-frequency and magnification effect parity remains partial.',systemClipboard:'untouched'}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(cause){
 if(page){measurements.failurePublicState=await page.evaluate(()=>window.compositor.request('state')).catch(error=>({error:String(error)}));measurements.failureVisibleError=await page.locator('.error-toast').innerText({timeout:1000}).catch(()=>null)}
 const report=JSON.stringify({status:'FAIL',packaged,checks,errors,measurements,error:String(cause),stack:cause instanceof Error?cause.stack:undefined},null,2);await writeFile(join(output,'report.json'),report);await writeFile(join(output,'first-failure.json'),report,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error});await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).catch(()=>{});throw cause
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
