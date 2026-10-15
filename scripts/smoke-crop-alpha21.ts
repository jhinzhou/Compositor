/** Isolated actual Electron crop acceptance; root runs this serially.
 * Source grids are self-authored. Unit tests separately compare full RGBA16/HDR;
 * preview equality here verifies the actual desktop's visible composite.
 * Window blur is an explicitly synthetic DOM lifecycle probe; reference lines and corners use mouse input.
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

const root=process.cwd(),width=320,height=240,temp=await realpath(await mkdtemp(join(tmpdir(),'compositor-crop-alpha21-'))),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/crop-alpha21'
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
 const focus=()=>ui.locator('.status-bar').click(),primary=process.platform==='darwin'?'Meta':'Control'
 async function point(x:number,y:number){const box=await ui.locator('.canvas-wrap').boundingBox();assert.ok(box);return {x:box.x+x*box.width/width,y:box.y+y*box.height/height}}
 await rpc('localeSet',{locale:'en'});
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})});
 async function saveReopen(name:string){const final=await state(),bytes=await sourceBytes(final),before=await preview(),saved=join(temp,name+'.comp');await app!.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},saved);await rpc('saveDialog',{sessionId:final.sessionId});await rpc('closeDocument',{sessionId:final.sessionId});const reopened=await open(saved);assert.deepEqual(reopened.manifest,final.manifest);assert.deepEqual(await sourceBytes(reopened),bytes);assert.deepEqual((await preview()).data,before.data);await rpc('closeDocument',{sessionId:reopened.sessionId})}
 async function dragLine(held=false){const a=await point(70,90),b=await point(250,120);await ui.mouse.move(a.x,a.y);await ui.mouse.down();await ui.mouse.move(b.x,b.y,{steps:8});if(!held)await ui.mouse.up()}
 async function createPerspectiveRectangle(){
  // A fresh perspective tool now asks for real input rather than seeding a
  // full-canvas draft. Cancel any retained geometry through the toolbar before
  // exercising the creation path; reselecting the same mode can retain a draft.
  const before=await state(),bytes=await sourceBytes(before),handles=ui.getByRole('button',{name:/^Perspective corner [1-4]$/})
  if(await handles.count()){
   await ui.locator('.raster-toolbar').getByRole('button',{name:'Cancel',exact:true}).click()
   await ui.getByRole('combobox',{name:'Crop mode',exact:true}).selectOption('perspective')
  }
  await ui.getByRole('checkbox',{name:'Four-corner input',exact:true}).uncheck()
  await expect(handles).toHaveCount(0)
  assert.equal((await state()).revision,before.revision);assert.deepEqual(await sourceBytes(await state()),bytes)
  const a=await point(30,20),b=await point(285,210)
  await ui.mouse.move(a.x,a.y);await ui.mouse.down();await ui.mouse.move(b.x,b.y,{steps:8});await ui.mouse.up();await expect(handles).toHaveCount(4)
  assert.equal((await state()).revision,before.revision);assert.deepEqual(await sourceBytes(await state()),bytes)
 }
 for(const precision of [8,16,'hdr'] as const){
  const initial=await open(paths.get(precision)!),bytes=await sourceBytes(initial),original=await preview();await ui.getByRole('button',{name:'100%',exact:true}).click();await ui.locator('.rail-tools>button[data-tool-group="C"]').click();const modes=ui.getByRole('combobox',{name:'Crop mode',exact:true});await modes.selectOption('straighten');await focus();await dragLine(precision===8);
  if(precision===8){await ui.keyboard.press('Enter');await ui.mouse.up()}else await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(initial.revision+1);const straight=await state();assert.equal(straight.manifest.width,Math.round(width/((width/height)*Math.sin(Math.atan(1/6))+Math.cos(Math.atan(1/6)))));assert.equal(straight.manifest.height,Math.round(height/((width/height)*Math.sin(Math.atan(1/6))+Math.cos(Math.atan(1/6)))));assert.ok(Math.abs(straight.manifest.layers[0].transform.rotation+Math.atan(1/6)*180/Math.PI)<1e-7);assert.deepEqual(await sourceBytes(straight),bytes);
  await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).manifest.width).toBe(width);assert.deepEqual((await state()).manifest,initial.manifest);assert.deepEqual((await preview()).data,original.data);checks.push(`${precision}: real UI reference-line straighten preserves exact image/mask source; one transaction and Undo restore placements and pixels`);
  await modes.selectOption('straighten');await dragLine();const beforeReapply=await state();await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(beforeReapply.revision+1);await saveReopen(`straighten-${precision}`);checks.push(`${precision}: actual straighten Save As/close/reopen retains source depth and visible composite`);
  await open(paths.get(precision)!);await ui.getByRole('button',{name:'100%',exact:true}).click();await ui.locator('.rail-tools>button[data-tool-group="C"]').click();await modes.selectOption('perspective');await expect(ui.locator('.crop-preserve-mode')).toHaveText('Resamples layers');
  const beforePerspective=await state(),beforeBytes=await sourceBytes(beforePerspective);
  await createPerspectiveRectangle()
  for(const [i,x,y] of [[1,45,30],[2,275,42],[3,250,205],[4,58,195]]){const handle=ui.getByRole('button',{name:`Perspective corner ${i}`,exact:true}),b=await handle.boundingBox(),target=await point(x,y);assert.ok(b);await ui.mouse.move(b.x+b.width/2,b.y+b.height/2);await ui.mouse.down();await ui.mouse.move(target.x,target.y,{steps:6});await ui.mouse.up()}
  const outW=ui.getByRole('spinbutton',{name:'Perspective output width',exact:true}),outH=ui.getByRole('spinbutton',{name:'Perspective output height',exact:true});await outW.fill('200');await outW.press('Enter');await outH.fill('150');await outH.press('Enter');await expect(ui.locator('.crop-feedback')).toContainText('200 × 150');const screenshot=PNG.sync.read(await ui.screenshot({path:join(output,`perspective-draft-${precision}.png`),animations:'disabled'})),viewportSize=await ui.evaluate(()=>({width:innerWidth,height:innerHeight}));for(let i=1;i<=4;i++){const handle=await ui.getByRole('button',{name:`Perspective corner ${i}`,exact:true}).boundingBox();assert.ok(handle);const x=Math.round((handle.x+handle.width/2)*screenshot.width/viewportSize.width),y=Math.round((handle.y+handle.height/2)*screenshot.height/viewportSize.height),offset=(y*screenshot.width+x)*4;assert.ok(screenshot.data[offset]>=240&&screenshot.data[offset+1]>=240&&screenshot.data[offset+2]>=240,`Perspective corner ${i} must remain visibly white above the SDR thumbnail`)}await ui.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(beforePerspective.revision+1);const afterPerspective=await state();assert.equal(afterPerspective.manifest.width,200);assert.equal(afterPerspective.manifest.height,150);assert.notDeepEqual(await sourceBytes(afterPerspective),beforeBytes);if(precision===16)assert.ok(afterPerspective.assets.some(a=>a.bitDepth===16));if(precision==='hdr')assert.ok(afterPerspective.assets.some(a=>a.isHDR));const afterPixels=await preview();assert.ok(afterPixels.data.some(v=>v>0));
  await focus();await ui.keyboard.press(`${primary}+z`);await expect.poll(async()=>(await state()).manifest.width).toBe(width);assert.deepEqual((await state()).manifest,beforePerspective.manifest);assert.deepEqual(await sourceBytes(await state()),beforeBytes);await ui.keyboard.press(`${primary}+Shift+z`);await expect.poll(async()=>(await state()).manifest.width).toBe(200);assert.deepEqual((await preview()).data,afterPixels.data);checks.push(`${precision}: real four-corner drag + explicit dimensions, all handles visibly above SDR thumbnail, resamples at source depth; Undo/Redo recover original sources and output`);
  await saveReopen(`perspective-${precision}`);checks.push(`${precision}: actual perspective Save As/close/reopen retains resampled source depth and preview`)
 }
 await open(paths.get(8)!);await ui.getByRole('button',{name:'100%',exact:true}).click();await ui.locator('.rail-tools>button[data-tool-group="C"]').click();await ui.getByRole('combobox',{name:'Crop mode',exact:true}).selectOption('perspective');await createPerspectiveRectangle();
 const modes=ui.getByRole('combobox',{name:'Crop mode',exact:true});
 for(const locale of ['en','zh-CN'] as Locale[]){await rpc('localeSet',{locale});await ui.getByRole('combobox',{name:translate(locale,'Crop mode'),exact:true}).selectOption('perspective');await expect(ui.locator('.crop-preserve-mode')).toHaveText(translate(locale,'Resamples layers'));await expect(ui.locator('.crop-feedback')).toContainText(translate(locale,'SDR geometry preview'));const toolbar=ui.locator('.transform-toolbar').last();const overflow=await toolbar.evaluate(n=>n.scrollWidth>n.clientWidth);if(overflow)assert.equal(await toolbar.evaluate(n=>getComputedStyle(n).overflowX),'auto');await ui.screenshot({path:join(output,`crop-modes-${locale}.png`),animations:'disabled'})}checks.push('ZH/EN mode, output fields and resampling notice remain accessible at minimum window; overflow uses horizontal toolbar scroll');
 await rpc('localeSet',{locale:'en'});await modes.selectOption('straighten');const beforeCancel=await state();await dragLine(true);await ui.keyboard.press('Escape');await ui.mouse.up();assert.equal((await state()).revision,beforeCancel.revision);await rpc('saveCurrent',{sessionId:beforeCancel.sessionId});checks.push('Real Escape during held reference line cancels draft and releases document lease');
 await modes.selectOption('perspective');await createPerspectiveRectangle();const corner=ui.getByRole('button',{name:'Perspective corner 2',exact:true}),b=await corner.boundingBox();assert.ok(b);const beforeBlur=await state();await ui.mouse.move(b.x+b.width/2,b.y+b.height/2);await ui.mouse.down();await ui.mouse.move(b.x-30,b.y+25,{steps:4});await ui.evaluate(()=>window.dispatchEvent(new Event('blur')));await ui.mouse.up();assert.equal((await state()).revision,beforeBlur.revision);await ui.getByRole('button',{name:'Cancel',exact:true}).click();await rpc('saveCurrent',{sessionId:beforeBlur.sessionId});checks.push('Synthetic window blur cancels actual perspective handle drag; cancel/save proves lease release');
 await expect(ui.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({status:'PASS',checks,errors,fixtureOrigin:'self-authored PNG8/PNG16/EXR grids; actual native Photoshop geometry/pixel comparisons are separate fixtures',syntheticBoundaries:['window blur DOM event'],systemClipboard:'untouched'},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}catch(cause){await writeFile(join(output,'report.json'),JSON.stringify({status:'FAIL',checks,errors,error:String(cause)},null,2));if(page)await page.screenshot({path:join(output,'failure.png'),timeout:5000}).catch(()=>{});throw cause}
finally{if(browser)await browser.close().catch(()=>{});if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await rm(temp,{recursive:true,force:true})}
