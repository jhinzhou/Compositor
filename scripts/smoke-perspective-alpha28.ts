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

const root=process.cwd(),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/perspective-alpha28',packaged=!!process.env.COMPOSITOR_EXECUTABLE
const fixture=JSON.parse(await readFile(join(root,'fixtures/parity/photoshop-27.11-perspective-gui-alpha28.json'),'utf8'))
const native=fixture.cases.find((entry:{name:string})=>entry.name==='actual-gui-strong-alpha28');assert.ok(native)
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
function decode(entry:{rgbaZlib:string;sha256:string;width:number;height:number}){const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(sha(bytes),entry.sha256);assert.equal(bytes.length,entry.width*entry.height*4);return bytes}
const source=decode(fixture.source),width=fixture.source.width,height=fixture.source.height
assert.deepEqual([width,height],[512,384]);assert.deepEqual([native.width,native.height],[421,306])
assert.ok(source.every((v,i)=>i%4!==3||v===255),'Deep/HDR seed uses the opaque GUI calibration source')
const corners:CropCorners=native.corners,directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-perspective-alpha28-')))
const paths=new Map<8|16|'hdr',string>(),checks:string[]=[],errors:string[]=[],measurements:Record<string,unknown>={}
const oraclePath=join(directory,'same-runtime-core-oracle.cjs'),execFileAsync=promisify(execFile)
await build({entryPoints:[join(root,'scripts/perspective-smoke-oracle-alpha28.ts')],bundle:true,platform:'node',format:'cjs',outfile:oraclePath,logLevel:'silent'})
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
await mkdir(output,{recursive:true})
for(const precision of [8,16,'hdr'] as const){
 const editor=new Editor();editor.create(width,height);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:`Perspective alpha28 ${precision}`}})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.id+(precision==='hdr'?'.exr':'.png');layer.imageFile=file
 let asset:Asset
 if(precision===8){const image=new PNG({width,height});image.data.set(source);asset=makeAsset(file,PNG.sync.write(image))}
 else if(precision===16){const data=new Uint16Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=i%4===3?source[i]*257:Math.min(65535,source[i]*257+13+(i%17));asset=makeDeepAsset(file,width,height,data);snapshot.manifest.version=12}
 else{const data=new Float32Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=i%4===3?source[i]/255:i%4===0?1.25+source[i]/255:i%4===1?-.5+source[i]/1020:source[i]/255;asset=makeHDRAsset(file,width,height,data);snapshot.manifest.version=13}
 snapshot.assets.set(file,asset);editor.importDocument(snapshot.manifest,snapshot.assets,`Perspective alpha28 ${precision}`)
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
  const owned=globalThis as typeof globalThis&{alpha28PerspectiveActions?:unknown[]};owned.alpha28PerspectiveActions=[]
  ipcMain.removeHandler('editor:request');ipcMain.handle('editor:request',(event,input)=>{if(input?.method==='apply'&&input.params?.action?.type==='document.perspective_crop')owned.alpha28PerspectiveActions!.push(structuredClone(input.params.action));return original(event,input)})
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
 async function rawQuad(){return ui.locator('.crop-geometry-overlay circle[role="button"]').evaluateAll(elements=>elements.map(element=>[Number(element.getAttribute('cx')),Number(element.getAttribute('cy'))]))}
 async function sameRuntimeExpected(s:EditorState,bytes:Record<string,Buffer>,name:string){
  const actions=await app!.evaluate(()=>((globalThis as typeof globalThis&{alpha28PerspectiveActions?:unknown[]}).alpha28PerspectiveActions??[])),action=actions.at(-1) as {corners:CropCorners;width:number;height:number;sampling:'High quality'};assert.ok(action);assert.equal(action.sampling,'High quality')
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
 async function guiQuadDraft(){await quadDraft(corners);await sizeEquals(420,306)}
 async function explicitSize(w:number,h:number){for(const[name,value]of [['Perspective output width',w],['Perspective output height',h]] as const){const field=ui.getByRole('spinbutton',{name,exact:true});await field.fill(String(value));await field.press('Tab')}await sizeEquals(w,h)}
 async function undo(before:EditorState,after:EditorState,bytes:Record<string,Buffer>){await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).revision).toBe(after.revision+1);const undone=await state();assert.deepEqual(undone.manifest,before.manifest);assert.deepEqual(undone.selection,before.selection);assert.deepEqual(await sources(undone),bytes)}
 async function redo(after:EditorState,bytes:Record<string,Buffer>){const before=await state();await focus();await ui.keyboard.press(`${primary}+Shift+z`);await expect.poll(async()=>(await state()).revision).toBe(before.revision+1);assert.deepEqual((await state()).manifest,after.manifest);assert.deepEqual(await sources(await state()),bytes)}
 async function saveAndReopen(name:string){const before=await state(),bytes=await sources(before),path=join(directory,'saved-'+name+'.comp');await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},path);await rpc('saveDialog',{sessionId:before.sessionId});await rpc('closeDocument',{sessionId:before.sessionId});const reopened=await open(path);assert.deepEqual(reopened.manifest,before.manifest);assert.deepEqual(await sources(reopened),bytes);await rpc('closeDocument',{sessionId:reopened.sessionId})}


 function exactSamples(actual:Uint8Array|Uint16Array|Float32Array,expected:Uint8Array|Uint16Array|Float32Array,label:string){
  assert.equal(actual.length,expected.length,label+' length');let count=0,max=0;const first:{index:number;actual:number;expected:number}[]=[]
  for(let i=0;i<actual.length;i++)if(!Object.is(actual[i],expected[i])){count++;max=Math.max(max,Math.abs(actual[i]-expected[i]));if(first.length<8)first.push({index:i,actual:actual[i],expected:expected[i]})}
  assert.equal(count,0,JSON.stringify({label,count,max,first}));assert.equal(sha(new Uint8Array(actual.buffer,actual.byteOffset,actual.byteLength)),sha(new Uint8Array(expected.buffer,expected.byteOffset,expected.byteLength)),label+' decoded bytes')
 }
 function assertCore(precision:8|16|'hdr',actual:Buffer,expected:Buffer){
  if(precision===8){const a=PNG.sync.read(actual),e=PNG.sync.read(expected);assert.deepEqual([a.width,a.height],[e.width,e.height]);exactSamples(a.data,e.data,'RGBA8 core');return}
  if(precision===16){assert.equal(inspectPNG(actual).bitDepth,16);const a=decodeDeepPNG(actual),e=decodeDeepPNG(expected);exactSamples(a.deep,e.deep,'RGBA16 core');assert.ok(a.deep.some((v,i)=>i%4!==3&&v%257!==0));for(let i=0;i<a.deep.length;i+=4)for(let c=0;c<3;c++)assert.ok(a.deep[i+c]<=a.deep[i+3]);return}
  const a=decodeEXR(actual),e=decodeEXR(expected);exactSamples(a.hdr,e.hdr,'HDR working Float32 core');assert.ok(a.hdr.some((v,i)=>i%4===0&&v>1));assert.ok(a.hdr.some((v,i)=>i%4===1&&v<0));for(let i=3;i<a.hdr.length;i+=4)assert.ok(a.hdr[i]>=0&&a.hdr[i]<=1)
 }
 function nativeGate(actual:Buffer,reference:any,label:string){
  const pixels=PNG.sync.read(actual),oracle=decode(reference);assert.deepEqual([pixels.width,pixels.height],[reference.width,reference.height]);let rgbSum=0,rgbMax=0,alphaSum=0,alphaMax=0,premultSum=0,premultMax=0
  for(let i=0;i<oracle.length;i+=4){const aa=pixels.data[i+3],ea=oracle[i+3],ad=Math.abs(aa-ea);alphaSum+=ad;alphaMax=Math.max(alphaMax,ad);for(let c=0;c<3;c++){const d=Math.abs(pixels.data[i+c]-oracle[i+c]),pm=Math.abs(pixels.data[i+c]*aa/255-oracle[i+c]*ea/255);rgbSum+=d;rgbMax=Math.max(rgbMax,d);premultSum+=pm;premultMax=Math.max(premultMax,pm)}}
  const count=pixels.width*pixels.height,metrics={rgbMAE:rgbSum/(count*3),rgbMax,alphaMAE:alphaSum/count,alphaMax,premultRGBMAE:premultSum/(count*3),premultRGBMax:premultMax},gate=reference.gate;assert.ok(gate,label+' immutable native gate required')
  for(const [key,maximum]of [['rgbMAE',gate.maximumRGBMAE],['rgbMax',gate.maximumRGBMax],['alphaMAE',gate.maximumAlphaMAE],['alphaMax',gate.maximumAlphaMax],['premultRGBMAE',gate.maximumPremultRGBMAE]] as const){assert.ok(typeof maximum==='number'&&Number.isFinite(maximum));assert.ok(metrics[key]<=maximum,JSON.stringify({label,metric:key,actual:metrics[key],maximum}))}
  if(gate.maximumPremultRGBMax!==undefined){assert.ok(typeof gate.maximumPremultRGBMax==='number'&&Number.isFinite(gate.maximumPremultRGBMax));assert.ok(metrics.premultRGBMax<=gate.maximumPremultRGBMax,JSON.stringify({label,metric:'premultRGBMax',actual:metrics.premultRGBMax,maximum:gate.maximumPremultRGBMax}))}
  if(reference.baselineRGBAZlib){const baseline=inflateSync(Buffer.from(reference.baselineRGBAZlib,'base64'));assert.equal(sha(baseline),reference.baselineRGBA_SHA256);assert.equal(baseline.length,pixels.data.length);let changed=0;for(let i=3;i<baseline.length;i+=4)changed+=Number(baseline[i]!==pixels.data[i]);assert.equal(changed,0,label+' every alpha sample must match the unchanged baseline')}
  measurements[label+'-native']={...metrics,gate,nativeSHA256:reference.sha256,actualEncodedSHA256:sha(actual),status:'PARTIAL_NATIVE_EFFECT_PARITY',boundary:'Core exactness and passing regression limits do not establish Photoshop pixel equivalence'}
 }
 async function cropResult(before:EditorState,beforeBytes:Record<string,Buffer>,precision:8|16|'hdr',name:string,w:number,h:number){
  const after=await state(),afterBytes=await sources(after),actual=await image(after),expected=await sameRuntimeExpected(before,beforeBytes,name);assert.deepEqual([after.manifest.width,after.manifest.height],[w,h]);assert.deepEqual([expected.action.width,expected.action.height],[w,h]);assert.equal(after.revision,before.revision+1);assertCore(precision,actual,expected.bytes)
  assert.equal(after.manifest.version,precision==='hdr'?13:precision===16?12:11);if(precision==='hdr')assert.equal(after.assets.find(asset=>asset.file===imageFile(after))?.isHDR,true);else if(precision===16)assert.equal(after.assets.find(asset=>asset.file===imageFile(after))?.bitDepth,16)
  const suffix=precision==='hdr'?'exr':'png';await writeFile(join(output,name+'-actual.'+suffix),actual);await writeFile(join(output,name+'-expected.'+suffix),expected.bytes)
  measurements[name+'-core']={actualEncodedSHA256:sha(actual),expectedEncodedSHA256:sha(expected.bytes),encodedStreamsEqual:actual.equals(expected.bytes),sourceEncodedSHA256:sha(beforeBytes[imageFile(before)]),edgeQuad:expected.action.corners,comparison:'Same actual Electron CLI core, matching decoded precision; native Photoshop effects evaluated separately'}
  return {after,afterBytes,actual}
 }
 async function finishCase(before:EditorState,beforeBytes:Record<string,Buffer>,after:EditorState,afterBytes:Record<string,Buffer>,name:string){await settle();await undo(before,after,beforeBytes);await redo(after,afterBytes);await saveAndReopen(name)}

 await rpc('localeSet',{locale:'en'});await expect(ui.locator('.editor-shell')).toHaveAttribute('data-interaction-profile','photoshop')
 for(const precision of [8,16,'hdr'] as const){
  const before=await open(paths.get(precision)!),beforeBytes=await sources(before);await guiQuadDraft();assert.equal((await state()).revision,before.revision);assert.deepEqual(await sources(await state()),beforeBytes)
  measurements[`gui-${precision}-autoSize`]={actual:[420,306],native:[421,306],residual:[-1,0],status:'PARTIAL_AUTOMATIC_SIZE_PARITY',interaction:'Real rectangle/corner drags; automatic fields observed before manual dimensions'}
  await ui.screenshot({path:join(output,`gui-${precision}-draft.png`),animations:'disabled'});await explicitSize(421,306);measurements[`gui-${precision}-rawQuad`]=await rawQuad()
  await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision,{timeout:20000}).toBe(before.revision+1)
  const result=await cropResult(before,beforeBytes,precision,`gui-${precision}`,421,306);if(precision===8)nativeGate(result.actual,native,'gui-rgb8')
  await finishCase(before,beforeBytes,result.after,result.afterBytes,`gui-${precision}`);checks.push(`${precision}: real native GUI edge quad yields automatic420306, then explicit421306 native reference; exact core/source/history/save and depth/alpha preserved; automatic/effect parity remains partial`)
 }
 const sizes=JSON.parse(await readFile(join(root,'fixtures/parity/photoshop-27.11-perspective-size-independent-alpha28.json'),'utf8')),strong=sizes.cases.find((c:{name:string})=>c.name==='independent-strong');assert.ok(strong);assert.deepEqual([strong.width,strong.height],[391,262])
 for(const precision of [8,16,'hdr'] as const){
  const before=await open(paths.get(precision)!),beforeBytes=await sources(before);await quadDraft(strong.corners);await sizeEquals(390,261);assert.equal((await state()).revision,before.revision);assert.deepEqual(await sources(await state()),beforeBytes);measurements[`strong-${precision}-rawQuad`]=await rawQuad()
  // No output-field edits and no direct apply RPC: this validates automatic UI size.
  await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(before.revision+1)
  const result=await cropResult(before,beforeBytes,precision,`strong-${precision}`,390,261);measurements[`strong-${precision}-nativeSize`]={actual:[390,261],native:[391,262],residual:[-1,-1],status:'PARTIAL_AUTOMATIC_SIZE_PARITY',pixelComparison:'Not computed across different output dimensions'}
  await finishCase(before,beforeBytes,result.after,result.afterBytes,`strong-${precision}`);checks.push(`${precision}: real independent strong drag applies default automatic390261 without editing size; native391262 remains1x1 partial; exact core/source/alpha/history/save`)
 }
 const legacyBefore=await open(paths.get(8)!),legacyBytes=await sources(legacyBefore);await chooseProfile('compositor');await choosePerspective();await drag([88,33],[456,346]);await assertQuad([[88,33],[456,33],[456,346],[88,346]]);await sizeEquals(368,313)
 await ui.locator('.raster-toolbar').getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await state()).revision,legacyBefore.revision);assert.deepEqual(await sources(await state()),legacyBytes);await chooseProfile('photoshop');await rpc('closeDocument',{sessionId:legacyBefore.sessionId})
 checks.push('Legacy exclusive368313 rectangle and Cancel preserve source/revision; profile switch uses real Keyboard shortcuts UI')

 const sampling=JSON.parse(await readFile(join(root,'fixtures/parity/photoshop-27.11-perspective-sampling-independent-alpha28.json'),'utf8'))
 for(const name of ['opaque-holdout-fractional-up','alpha-holdout-fractional-up']){
  const reference=sampling.cases.find((c:{name:string})=>c.name===name);assert.ok(reference);const input=sampling.sources[reference.sourceVariant];assert.ok(input);const inputRGBA=decode(input),editor=new Editor();editor.create(input.width,input.height);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name}})
  const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=layer.id+'.png';layer.imageFile=file;const image=new PNG({width:input.width,height:input.height});image.data.set(inputRGBA);const asset=makeAsset(file,PNG.sync.write(image));snapshot.assets.set(file,asset);editor.importDocument(snapshot.manifest,snapshot.assets,name);const path=join(directory,name+'.comp');await editor.saveAs(path)
  const before=await open(path),beforeBytes=await sources(before);assert.equal(sha(PNG.sync.read(beforeBytes[imageFile(before)]).data),input.sha256);await quadDraft(reference.corners);assert.equal((await state()).revision,before.revision);assert.deepEqual(await sources(await state()),beforeBytes);await explicitSize(reference.width,reference.height);measurements[name+'-rawQuad']=await rawQuad()
  await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(before.revision+1)
  const result=await cropResult(before,beforeBytes,8,name,reference.width,reference.height);nativeGate(result.actual,reference,name);if(name.startsWith('alpha-')){const pixels=PNG.sync.read(result.actual).data;assert.ok(inputRGBA.some((v,i)=>i%4===3&&v>0&&v<255));assert.ok(pixels.some((v,i)=>i%4===3&&v>0&&v<255))}
  await finishCase(before,beforeBytes,result.after,result.afterBytes,name);checks.push(`${name}: actual fractional quad plus explicit${reference.width}x${reference.height} native sampling; exact actual-runtime core/source/alpha/history/save and immutable independent native gates; effect parity partial`)
 }
 assert.equal(checks.length,9);await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[])
 const report={status:'PASS',photoshopParity:'PARTIAL',version:await app.evaluate(({app})=>app.getVersion()),hostRuntime:process.versions,actualRuntime:await app.evaluate(()=>process.versions),packaged,checks,errors,measurements,inputMechanism:'Actual Electron profile controls, mouse quad geometry, automatic fields, manual sampling dimensions and keyboard Undo/Redo; native dialog paths doubled only',nativeBoundary:'Immutable real Photoshop GUI and independent opaque/alpha sampling references are measured independently of same-runtime core equality. RGB16/HDR verify authored precision/alpha/history, not Photoshop deep-effect equivalence.',remainingAutoSizeGap:'GUI420306 vs native421306 remains1x0; independentstrong390261 vs391262 and its three scale/rotation variants remain1x1; alpha26 independent398265 vs395264 remains3x1. No output-dimension correction is fitted.',systemClipboard:'untouched'}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))

}catch(cause){
 if(page){measurements.failurePublicState=await page.evaluate(()=>window.compositor.request('state')).catch(error=>({error:String(error)}));measurements.failureVisibleError=await page.locator('.error-toast').innerText({timeout:1000}).catch(()=>null)}
 const report=JSON.stringify({status:'FAIL',packaged,checks,errors,measurements,error:String(cause),stack:cause instanceof Error?cause.stack:undefined},null,2);await writeFile(join(output,'report.json'),report);await writeFile(join(output,'first-failure.json'),report,{flag:'wx'}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error});await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).catch(()=>{});throw cause
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
