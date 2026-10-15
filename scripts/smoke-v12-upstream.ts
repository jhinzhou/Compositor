import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import type {EditorState} from '../src/shared/contracts'

// Self-authored native packages exercise the actual UI/worker/save chain. They are not
// independent upstream-app fixtures or evidence for 16-bit editing/HDR compatibility.
const root=process.cwd(),temp=await realpath(await mkdtemp(join(tmpdir(),'compositor-v12-upstream-'))),
 output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/v12-upstream',checks:string[]=[],errors:string[]=[]
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
let sources:Record<string,unknown>={}
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
async function packageHashes(path:string):Promise<Record<string,string>>{
 const hashes:Record<string,string>={}
 async function walk(relative:string){for(const entry of (await readdir(join(path,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(relative,entry.name);if(entry.isDirectory())await walk(file);else{assert.ok(entry.isFile(),`Unexpected fixture entry ${file}`);hashes[file]=sha(await readFile(join(path,file)))}}}
 await walk('');return hashes
}
try{
 await mkdir(output,{recursive:true})
 const original=join(temp,'Native-v11.comp'),source8=join(temp,'Upstream-v12-8.comp'),source16=join(temp,'Upstream-v12-16.comp'),future=join(temp,'Unsupported-v13.comp'),copy=join(temp,'Saved-v11-copy.comp')
 const authored=new Editor({journalDirectory:join(temp,'authoring-journals')}),pixels=new PNG({width:2,height:1})
 pixels.data=Buffer.from([23,67,191,255,199,41,79,255]);authored.importPNG(PNG.sync.write(pixels),'Authored v12 source')
 const authoredState=authored.state(),layerId=authoredState.manifest.activeLayerID!
 authored.apply({...authored.identity(),action:{type:'layer.mask',layerId,operation:'reveal'}})
 await authored.saveAs(original);assert.equal(JSON.parse(await readFile(join(original,'manifest.json'),'utf8')).version,11)
 await cp(original,source8,{recursive:true});const manifest=JSON.parse(await readFile(join(source8,'manifest.json'),'utf8'));manifest.version=12
 await writeFile(join(source8,'manifest.json'),JSON.stringify(manifest));await cp(source8,source16,{recursive:true})
 const imageFile=manifest.layers.find((layer:{id:string})=>layer.id===layerId).imageFile as string
 const deep=PNG.sync.write({width:2,height:1,data:new Uint16Array([10001,20002,30003,65535,40004,50005,60006,65535])} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true})
 assert.equal(deep[24],16);await writeFile(join(source16,'images',imageFile),deep)
 await cp(source16,future,{recursive:true});await writeFile(join(future,'manifest.json'),JSON.stringify({...manifest,version:13}))
 const before8=await packageHashes(source8),before16=await packageHashes(source16),beforeFuture=await packageHashes(future),originalImage=await readFile(join(source8,'images',imageFile))
 sources={provenance:'Self-authored Editor v11 package with v12 manifest; genuine encoded PNG16 supplied separately. No independent upstream-app fixture.',eightBit:before8,sixteenBit:before16,futureVersion:beforeFuture,deepPNGHeaderBitDepth:deep[24],originalPixelSHA256:sha(pixels.data)}
 let debugPort:number|undefined
 if(process.env.COMPOSITOR_EXECUTABLE){const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));debugPort=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))}
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:debugPort?[`--remote-debugging-port=${debugPort}`]:[root],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(temp,'profile')},timeout:60000})
 if(debugPort){await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.isVisible())?.webContents.getURL()),{timeout:30000}).toContain('/index.html');const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.isVisible())!.webContents.getURL());browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);page=browser.contexts()[0].pages().find(item=>item.url()===url)!;assert.ok(page)}else page=await app.firstWindow()
 const visible=page;visible.on('pageerror',error=>errors.push(error.message));await expect(visible.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await visible.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state')
 async function choose(path:string){await app!.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},path)}
 async function assetPixels(s:EditorState,file:string){const asset=s.assets.find(asset=>asset.file===file)!;assert.ok(asset);const encoded=await visible.evaluate(async url=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),`compositor-asset://${s.sessionId}/${encodeURIComponent(file)}?hash=${asset.hash}`);return PNG.sync.read(Buffer.from(encoded))}
 await rpc('localeSet',{locale:'en'});await choose(source8);await rpc('openDialog')
 const loaded=await state();assert.equal(loaded.projectPath,source8);assert.equal(loaded.manifest.version,11);assert.equal(loaded.modified,false);assert.equal(loaded.manifest.width,2);assert.equal(loaded.manifest.height,1)
 assert.match(loaded.warnings.join(' '),/Version 12.*only 8-bit.*version 11/);assert.deepEqual((await assetPixels(loaded,imageFile)).data,pixels.data);assert.deepEqual(await packageHashes(source8),before8)
 await expect(visible.locator('.project-tab.active')).toContainText('Upstream-v12-8');await visible.screenshot({path:join(output,'v12-8-open.png')});checks.push('Actual openDialog loads v12 PNG8 into v11 RGBA8, reports compatibility warning and leaves all source files unchanged')
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},copy);await rpc('saveCopyDialog',{sessionId:loaded.sessionId})
 const copied=JSON.parse(await readFile(join(copy,'manifest.json'),'utf8'));assert.equal(copied.version,11);assert.equal(JSON.parse(await readFile(join(source8,'manifest.json'),'utf8')).version,12)
 assert.deepEqual(await packageHashes(source8),before8);assert.deepEqual(await readFile(join(copy,'images',imageFile)),originalImage)
 for(const asset of loaded.assets)assert.deepEqual(await readFile(join(copy,'images',asset.file)),await readFile(join(source8,'images',asset.file)))
 assert.equal((await state()).projectPath,source8);checks.push('Actual Save a Copy writes a separate v11 package with exact PNG/mask bytes and keeps original v12 source/path intact')
 await rpc('closeDocument',{sessionId:loaded.sessionId});await choose(copy);await rpc('openDialog');const reopened=await state()
 assert.equal(reopened.projectPath,copy);assert.equal(reopened.manifest.version,11);assert.deepEqual(reopened.manifest,loaded.manifest);assert.deepEqual((await assetPixels(reopened,imageFile)).data,pixels.data);assert.equal(reopened.modified,false)
 checks.push('Closing and reopening the saved v11 copy preserves document structure and exact original RGBA8 pixels')
 await choose(source16);await rpc('openDialog');const loaded16=await state(),deepInfo=loaded16.assets.find(asset=>asset.file===imageFile)!
 assert.equal(loaded16.projectPath,source16);assert.equal(loaded16.manifest.version,12);assert.equal(loaded16.modified,false);assert.equal(deepInfo.bitDepth,16);assert.equal(deepInfo.hash,sha(deep));assert.ok(deepInfo.displayHash);assert.equal(deepInfo.pixelFormat,'rgba16-premultiplied-srgb')
 async function encodedAsset(representation:'source'|'display'){const url=`compositor-asset://${loaded16.sessionId}/${encodeURIComponent(imageFile)}?hash=${deepInfo.hash}${representation==='display'?`&representation=display&displayHash=${deepInfo.displayHash}`:''}`;return Buffer.from(await visible.evaluate(async url=>{const response=await fetch(url);if(!response.ok)throw Error(`Asset response ${response.status}`);return Array.from(new Uint8Array(await response.arrayBuffer()))},url))}
 assert.deepEqual(await encodedAsset('source'),deep);const proxy=await encodedAsset('display');assert.equal(proxy[24],8);assert.equal(sha(proxy),deepInfo.displayHash);assert.notEqual(sha(proxy),sha(deep));assert.deepEqual(await packageHashes(source16),before16)
 await expect(visible.locator('[data-testid="deep-status"]')).toHaveText('16-bit layer · 8-bit display');await expect(visible.locator('[data-testid="editor-canvas"]')).toHaveAttribute('data-rendering','false');await visible.screenshot({path:join(output,'v12-16-preserved.png')})
 checks.push('Actual openDialog loads v12 PNG16, retains exact original source/hash and 16-bit metadata, displays explicit PNG8 proxy and keeps original package unchanged')
 await choose(future);const beforeReject=await state(),rejected=await visible.evaluate(()=>window.compositor.request('openDialog'))
 assert.equal(rejected.ok,false);if(!rejected.ok){assert.equal(rejected.error.code,'INVALID_ARGUMENT');assert.ok(JSON.stringify(rejected.error.details).includes('version'))}
 assert.deepEqual(await state(),beforeReject);assert.deepEqual(await packageHashes(future),beforeFuture)
 await visible.getByRole('button',{name:'Search commands',exact:true}).click();await visible.getByRole('combobox',{name:'Search commands',exact:true}).fill('Open Project');await visible.getByRole('option').filter({has:visible.getByText('Open Project',{exact:true})}).click()
 const alert=visible.locator('.error-toast');await expect(alert).toBeVisible();await expect(alert).toContainText('version');assert.deepEqual(await state(),beforeReject)
 assert.deepEqual(await packageHashes(future),beforeFuture);assert.deepEqual(await packageHashes(source16),before16);assert.deepEqual(await packageHashes(source8),before8);assert.deepEqual(await encodedAsset('source'),deep)
 await visible.screenshot({path:join(output,'v13-refused.png')});checks.push('Actual openDialog and UI Open Project refuse future v13 without tab/revision/pixels/history change or source write')
 assert.deepEqual(errors,[])
 const report={status:'PASS',version:await app.evaluate(({app})=>app.getVersion()),packaged:!!process.env.COMPOSITOR_EXECUTABLE,scope:'Actual macOS Electron UI/worker .comp v12 PNG8/v11 copy compatibility and exact PNG16 source preservation/display proxy; future v13 refused. No deep pixel editing/HDR or independent upstream-app quality evidence',sources,checks,errors}
 await writeFile(join(output,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){
 if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{})
 const report={status:'FAIL',version:await app?.evaluate(({app})=>app.getVersion()).catch(()=>undefined),packaged:!!process.env.COMPOSITOR_EXECUTABLE,sources,checks,errors,failure:error instanceof Error?{name:error.name,message:error.message,stack:error.stack}:{message:String(error)}}
 await mkdir(output,{recursive:true});await writeFile(join(output,'acceptance.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report,null,2));throw error
}finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(temp,{recursive:true,force:true})}
