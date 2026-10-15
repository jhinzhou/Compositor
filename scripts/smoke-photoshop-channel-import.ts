import {_electron as electron,chromium,expect,type Browser,type ElectronApplication,type Page} from '@playwright/test'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import {createHash,randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import type {EditorState,RpcResult} from '../src/shared/contracts'
import {photoshopChannelFixture} from './fixtures/photoshop-channel-fixtures'

// The good input is the independently authored 2x1 RGB16 RLE byte fixture,
// not a PSD written by the reader under test. The bad input is ImageIO's
// independently generated malformed checker. Native dialogs alone are stubbed.
const [goodInput,badInput='fixtures/photoshop-corpus/imageio/hard-edge-checker.psd']=process.argv.slice(2)
const temp=await mkdtemp(join(tmpdir(),'photoshop-channels-')),inputs=[goodInput?resolve(goodInput):join(temp,'independent-rgb16-rle.psd'),resolve(badInput)],hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex'),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/photoshop-channel-import',checks:string[]=[],errors:string[]=[]
let inputHashes:string[]=[]
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
try{
 await mkdir(output,{recursive:true});if(!goodInput)await writeFile(inputs[0],photoshopChannelFixture({depth:16,mode:'rle'}));inputHashes=await Promise.all(inputs.map(hash));let port:number|undefined
 if(process.env.COMPOSITOR_EXECUTABLE){const listener=createServer();await new Promise<void>(accept=>listener.listen(0,'127.0.0.1',accept));port=(listener.address() as {port:number}).port;await new Promise<void>(accept=>listener.close(()=>accept()))}
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:port?[`--remote-debugging-port=${port}`]:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(temp,'profile')},timeout:60000})
 if(port){await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible())?.webContents.getURL()),{timeout:30000}).toContain('/index.html');const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible())!.webContents.getURL());browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(p=>p.url()===url);assert.ok(page)}else page=await app.firstWindow()
 page.on('pageerror',error=>errors.push(error.message));await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 const request=<T>(method:string,params?:unknown)=>page!.evaluate(({method,params})=>window.compositor.request(method,params),{method,params}) as Promise<RpcResult<T>>
 async function rpc<T>(method:string,params?:unknown):Promise<T>{const value=await request<T>(method,params);assert.equal(value.ok,true,JSON.stringify(value));return (value as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state')
 await rpc('localeSet',{locale:'en'});const before=await state()
 // Start the deferred import promise without awaiting it, then exercise the UI.
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},inputs[1]);const bad=request('openDialog')
 const panel=page.getByRole('dialog',{name:'Photoshop conversion report',exact:true})
 await expect(panel.getByRole('alert')).toContainText('malformed RLE',{timeout:30000});await expect(panel.getByRole('button',{name:'Continue import',exact:true})).toBeDisabled();const rejected=await state();assert.deepEqual(rejected.manifest,before.manifest);assert.deepEqual(rejected.assets,before.assets);assert.equal(rejected.sessionId,before.sessionId);assert.equal(rejected.revision,before.revision);checks.push('Malformed layer PackBits is rejected by the real import worker before opening a document')
 await panel.getByRole('button',{name:'Cancel import',exact:true}).click();assert.equal((await bad).ok,true);await expect(panel).toBeHidden();checks.push('Cancel dismisses a failed import and preserves the existing session, assets and revision')
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},inputs[0]);const good=request('openDialog')
 await expect(panel.getByRole('button',{name:'Continue import',exact:true})).toBeEnabled({timeout:30000});await expect(panel).toContainText('retained as PNG16');await expect(panel).toContainText('masks remain 8-bit');await expect(panel).toContainText('export remains 8-bit');await panel.getByRole('button',{name:'Continue import',exact:true}).click();assert.equal((await good).ok,true);await expect(panel).toBeHidden();const imported=await state(),sourceHeader=await readFile(inputs[0]);assert.equal(imported.manifest.width,sourceHeader.readUInt32BE(18));assert.equal(imported.manifest.height,sourceHeader.readUInt32BE(14));assert.equal(imported.manifest.version,12);assert.notEqual(imported.sessionId,before.sessionId)
 const fetchBytes=(url:string)=>page!.evaluate(async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`Asset fetch failed: ${response.status}`);return Array.from(new Uint8Array(await response.arrayBuffer()))},url).then(bytes=>Buffer.from(bytes))
 const layer=imported.manifest.layers.find(item=>item.imageFile)!,asset=imported.assets.find(item=>item.file===layer.imageFile)!,sourceURL=`compositor-asset://${imported.sessionId}/${encodeURIComponent(asset.file)}?hash=${asset.hash}`,bytes=await fetchBytes(sourceURL),display=await fetchBytes(`${sourceURL}&representation=display&displayHash=${asset.displayHash}`)
 assert.equal(asset.bitDepth,16);assert.equal(asset.pixelFormat,'rgba16-premultiplied-srgb');assert.equal(bytes[24],16);assert.equal(display[24],8);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.hash);assert.equal(createHash('sha256').update(display).digest('hex'),asset.displayHash)
 if(!goodInput)assert.deepEqual([...PNG.sync.read(bytes,{skipRescale:true}).data],[65535,32768,0,0,257,65535,32896,65535]);checks.push('RGB16 import retains canonical PNG16 straight samples and serves a separately hashed PNG8 display proxy with explicit mask/export boundaries')
 const identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 await rpc('apply',{...identity(imported),action:{type:'layer.set_opacity',layerId:layer.id,opacity:layer.opacity===.25?.75:.25}});const changed=await state();await rpc('history',{...identity(changed),direction:'undo'});assert.deepEqual((await state()).assets,imported.assets);assert.equal((await state()).manifest.layers.find(item=>item.id===layer.id)?.opacity,layer.opacity);assert.deepEqual(await fetchBytes(sourceURL),bytes);assert.deepEqual(await Promise.all(inputs.map(hash)),inputHashes);checks.push('Imported layers remain editable and undoable; canonical PNG16 and both source Photoshop files stay byte-identical')
 const savePath=join(temp,'source16.comp'),copyPath=join(temp,'source16-copy.comp')
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},savePath);await rpc('saveDialog',{sessionId:imported.sessionId});await rpc('saveCurrent',{sessionId:imported.sessionId})
 await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path})},copyPath);await rpc('saveCopyDialog',{sessionId:imported.sessionId})
 for(const path of [savePath,copyPath]){assert.equal(JSON.parse(await readFile(join(path,'manifest.json'),'utf8')).version,12);for(const source of imported.assets.filter(a=>a.bitDepth===16)){const png=await readFile(join(path,'images',source.file));assert.equal(png[24],16);assert.equal(createHash('sha256').update(png).digest('hex'),source.hash)}}
 await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]})},copyPath);await rpc('openDialog');const reopened=await state();assert.equal(reopened.manifest.version,12);assert.deepEqual(reopened.assets,imported.assets);assert.deepEqual(await fetchBytes(`compositor-asset://${reopened.sessionId}/${encodeURIComponent(asset.file)}?hash=${asset.hash}`),bytes);checks.push('Real save, Save Copy and reopen preserve v12 metadata and every original PNG16 source hash')
 await expect(page.locator('.error-toast')).toBeHidden();assert.deepEqual(errors,[]);await page.screenshot({path:join(output,'canvas.png'),animations:'disabled'});await writeFile(join(output,'checks.json'),JSON.stringify({status:'PASS',checks,errors,inputHashes},null,2)+'\n');console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}catch(cause){await writeFile(join(output,'checks.json'),JSON.stringify({status:'FAIL',checks,errors,error:String(cause)},null,2));await page?.screenshot({path:join(output,'failure.png'),timeout:5000}).catch(()=>{});throw cause}
finally{await browser?.close().catch(()=>{});if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await rm(temp,{recursive:true,force:true})}
