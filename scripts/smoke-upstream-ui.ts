import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import {randomUUID,createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import type {EditorState} from '../src/shared/contracts'
import {translate} from '../src/shared/i18n'
const root=process.cwd(),temp=await realpath(await mkdtemp(join(tmpdir(),'compositor-upstream-ui-'))),output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/upstream-ui'
const checks:string[]=[],errors:string[]=[];let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined
const fixture=PNG.sync.write({width:20,height:10,data:new Uint16Array(Array.from({length:800},(_,index)=>index%4===3?65535:10001+index*13))} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true}),hash=createHash('sha256').update(fixture).digest('hex')
await mkdir(output,{recursive:true});await writeFile(join(temp,'precision.png'),fixture)
await writeFile(join(temp,'linear.hdr'),Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 2\n'),Buffer.from([128,64,32,130,64,128,32,130,32,64,128,130,128,128,128,130])]))
try{
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()))
 const packaged=!!process.env.COMPOSITOR_EXECUTABLE
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:[...(packaged?[]:[root]),...(packaged?[`--remote-debugging-port=${port}`]:[])],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(temp,'profile')},timeout:60000})
 await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&/^(file:|https?:)/.test(window.webContents.getURL()))!.webContents.getURL())
 if(packaged){browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages().find(item=>item.url()===url)}else{await expect.poll(()=>app!.windows().map(item=>item.url())).toContain(url);page=app.windows().find(item=>item.url()===url)}assert.ok(page)
 // Keep all ClipboardItem formats inside this isolated Electron process; never replace the user's pasteboard.
 await app.evaluate(({clipboard,BrowserWindow},url)=>{
  const memory:{items:Electron.ClipboardItem[];text:string}={items:[],text:''}
  clipboard.read=async()=>memory.items
  clipboard.write=async items=>{memory.items=items;memory.text='';for(const item of items){if(item.types.includes('text/plain'))memory.text=await (await item.getType('text/plain')).text()}}
  clipboard.readText=async()=>memory.text
  const contents=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!.webContents
  // Dimension-field fallback is simulated, because webContents.paste() normally reads the real system pasteboard.
  contents.paste=()=>{void contents.executeJavaScript(`(()=>{const input=document.activeElement;if(input instanceof HTMLInputElement&&input.matches('.new-dimensions input')){input.value=${JSON.stringify(memory.text)};input.dispatchEvent(new Event('input',{bubbles:true}))}})()`)}
 },url)
 const ui=page;ui.on('pageerror',error=>errors.push(error.message));await expect(ui.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 await app.evaluate(({BrowserWindow},url)=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!;window.setContentSize(1050,720);window.show();window.focus()},url)
 async function rpc<T=unknown>(method:string,params?:unknown):Promise<T>{const result=await ui.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.ok(result.ok,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state')
 async function apply(action:unknown){const s=await state();return rpc('apply',{sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID(),action})}
 const local=(text:string)=>translate('zh-CN',text)
 await rpc('localeSet',{locale:'zh-CN'});await rpc('newDocument')
 await app.evaluate(async({clipboard,ClipboardItem},bytes)=>{await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(bytes)],{type:'image/png'})})])},[...fixture])
 const widthField=ui.locator('.new-canvas-form input').first();await widthField.focus();await ui.keyboard.press(process.platform==='darwin'?'Meta+v':'Control+v')
 await expect.poll(async()=>(await state()).manifest.layers.length).toBe(1)
 let s=await state();assert.equal(s.manifest.width,20);assert.equal(s.manifest.height,10);assert.equal(s.assets[0].bitDepth,16);assert.equal(s.assets[0].hash,hash);checks.push('New canvas process-local clipboard paste takes priority over focused width field and retains original PNG16 bytes')
 await expect(ui.locator('.layer-depth-badge')).toHaveText(local('16-Bit'))
 const originalSession=s.sessionId,layerId=s.manifest.layers[0].id
 await ui.locator('.layer-row').first().click({button:'right'});await ui.getByRole('button',{name:local('Convert to 8-bit'),exact:true}).click();await expect.poll(async()=>(await state()).assets[0].bitDepth??8).toBe(8);const converted=await state();assert.notEqual(converted.assets[0].hash,hash);const encodedDepth=await ui.evaluate(async({sessionId,asset})=>{const bytes=new Uint8Array(await(await fetch(`compositor-asset://${sessionId}/${encodeURIComponent(asset.file)}?hash=${asset.hash}`)).arrayBuffer());return bytes[24]},{sessionId:converted.sessionId,asset:converted.assets[0]});assert.equal(encodedDepth,8)
 await rpc('history',{sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:(await state()).revision,idempotencyKey:randomUUID(),direction:'undo'});assert.equal((await state()).assets[0].hash,hash)
 checks.push('Layer depth badge and context conversion perform real 16-to-8 conversion; Undo restores exact 16-bit source')
 const footer=ui.locator('.layer-footer > button'),labels=await footer.evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')))
 assert.ok(labels.indexOf(local('New adjustment layer'))<labels.indexOf(local('Layer effects')))
 await ui.getByRole('button',{name:local('New adjustment layer'),exact:true}).click();await expect(ui.locator('.layer-footer-menu button')).toHaveCount(12);await ui.locator('.layer-footer-menu button').first().click();await expect(ui.locator('.filter-panel')).toBeVisible();await ui.locator('.filter-panel button').filter({hasText:local('Cancel')}).click()
 await ui.getByRole('button',{name:local('Layer effects'),exact:true}).click();await expect(ui.locator('.layer-footer-menu button')).toHaveCount(6);await ui.locator('.layer-footer-menu button').first().click();await expect(ui.locator('.effects-panel')).toBeVisible();await ui.keyboard.press('Escape');checks.push('Footer order, all native adjustment choices and all six effects open their actual panels')
 await ui.keyboard.press(process.platform==='darwin'?'Meta+Shift+e':'Control+Shift+e')
 // Open by the shared menu/action channel if the current shortcut has been customized.
 if(!await ui.locator('.export-panel').isVisible())await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!.webContents.send('editor:action','export-as'),url)
 await expect(ui.locator('.export-panel')).toBeVisible();await expect(ui.locator('.export-formats > button')).toHaveText(['JPEG','PNG']);await ui.locator('.export-more > button').click();await expect(ui.locator('.export-format-menu button')).toHaveText(['PDF']);await ui.locator('.export-formats > button').filter({hasText:'PNG'}).click();await ui.getByLabel(local('16-bit PNG'),{exact:true}).check();await expect(ui.locator('.export-depth-note')).toHaveText(local('PNG preserves 16-bit color values.'));await ui.locator('.export-panel button').filter({hasText:local('Cancel')}).click();checks.push('Export exposes JPEG/PNG first, PDF under More, hides EXR for SDR and offers real 16-bit PNG')
 // Synthetic DOM drag is used only to supply the same custom payload as an actual layer-row drag.
 s=await state();await apply({type:'layer.set_transform',layerId,transform:{...s.manifest.layers[0].transform,origin:[100,80],rotation:90}});s=await state();const before=s
 await ui.locator('.project-tabs').evaluate((element,payload)=>{const dataTransfer=new DataTransfer();dataTransfer.setData('application/x-compositor-layers',JSON.stringify(payload));element.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}))},{sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,layerIds:[layerId]})
 await expect.poll(async()=>(await state()).sessionId).not.toBe(originalSession);s=await state();assert.equal(s.manifest.width,10);assert.equal(s.manifest.height,20);assert.equal(s.assets[0].hash,hash);assert.deepEqual((await rpc<EditorState>('state',{sessionId:originalSession})).manifest,before.manifest);checks.push('Whole tab bar layer drop creates a fitted rotated document, leaves source unchanged and preserves deep asset')
 const newSession=s.sessionId,count=s.workspace!.documents.length
 await ui.locator(`.project-tab[data-session-id="${newSession}"]`).evaluate((element,payload)=>{const dataTransfer=new DataTransfer();dataTransfer.setData('application/x-compositor-layers',JSON.stringify(payload));element.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}))},{sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,layerIds:[s.manifest.layers[0].id]})
 assert.equal((await state()).workspace!.documents.length,count);checks.push('Dropping layers on their source tab creates no duplicate document')
 const cdp=await ui.context().newCDPSession(ui),newButtonBounds=await ui.locator('.new-button').boundingBox();assert.ok(newButtonBounds)
 const fileCount=(await state()).workspace!.documents.length,data={items:[],files:[join(temp,'precision.png'),join(temp,'linear.hdr')],dragOperationsMask:1},position={x:newButtonBounds.x+newButtonBounds.width/2,y:newButtonBounds.y+newButtonBounds.height/2}
 await cdp.send('Input.dispatchDragEvent',{type:'dragEnter',...position,data});await cdp.send('Input.dispatchDragEvent',{type:'dragOver',...position,data});await cdp.send('Input.dispatchDragEvent',{type:'drop',...position,data})
 await expect.poll(async()=>(await state()).workspace!.documents.length,{timeout:30000}).toBe(fileCount+2);s=await state();assert.equal(s.assets[0].isHDR,true);await expect(ui.locator('.layer-depth-badge')).toHaveText('HDR');checks.push('Native file drag on the new-document button creates one original-size document per PNG16/HDR file')
 await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!.webContents.send('editor:action','export-as'),url)
 await expect(ui.locator('.export-panel')).toBeVisible();await ui.locator('.export-more > button').click();await expect(ui.locator('.export-format-menu button')).toHaveText(['PDF','EXR']);await ui.locator('.export-format-menu button').filter({hasText:'EXR'}).click();await expect(ui.locator('.export-depth-note')).toHaveText(local('EXR preserves HDR values.'));await ui.locator('.export-panel button').filter({hasText:local('Cancel')}).click();checks.push('HDR document shows EXR in More and labels its preserved HDR values')
 const cachedSource=await state(),cachedLayer=cachedSource.manifest.layers[0].id
 await rpc('copyClipboard',{sessionId:cachedSource.sessionId,documentId:cachedSource.manifest.documentID,expectedRevision:cachedSource.revision,idempotencyKey:randomUUID(),layerIds:[cachedLayer]});await apply({type:'layer.set_opacity',layerId:cachedLayer,opacity:.3});await rpc('newDocument');await ui.locator('.new-canvas-form input').first().focus();await ui.keyboard.press(process.platform==='darwin'?'Meta+v':'Control+v')
 await expect.poll(async()=>(await state()).manifest.layers.length).toBe(1);s=await state();assert.equal(s.assets[0].hash,cachedSource.assets[0].hash);assert.equal(s.assets[0].isHDR,true);assert.equal(s.manifest.layers[0].opacity,1);checks.push('Internal clipboard new-canvas paste uses copy-time HDR assets even after the source changes')
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false})});await rpc('closeDocument',{sessionId:(await state()).sessionId})
 await rpc('newDocument');await app.evaluate(async({clipboard,ClipboardItem})=>{await clipboard.write([new ClipboardItem({'text/plain':new Blob(['1234'],{type:'text/plain'})})])});const numeric=ui.locator('.new-canvas-form input').first();await numeric.focus();await numeric.press(process.platform==='darwin'?'Meta+a':'Control+a');await ui.keyboard.press(process.platform==='darwin'?'Meta+v':'Control+v');await expect(numeric).toHaveValue('1234');assert.equal((await state()).manifest.layers.length,0);checks.push('Numeric text chooses dimension-field fallback and updates the field through a process-local paste adapter')
 const screenshot=await app.evaluate(async({BrowserWindow},url)=>(await BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!.webContents.capturePage(undefined,{stayHidden:false,stayAwake:true})).toPNG().toString('base64'),url);await writeFile(join(output,'upstream-ui-zh.png'),Buffer.from(screenshot,'base64'))
 assert.deepEqual(errors,[]);await writeFile(join(output,'report.json'),JSON.stringify({status:'PASS',checks,errors,inputOrigin:'self-authored PNG16/RGBE fixtures',clipboardBoundary:'process-local ClipboardItem mock; numeric native paste adapter simulated; user system pasteboard untouched',dragBoundary:'native CDP file data; DOM custom layer-drag payload',closeBoundary:'discard prompt mocked for an already-tested fixture tab in isolated profile',sourceHash:hash},null,2));console.log(JSON.stringify({status:'PASS',checks},null,2))
}catch(error){await writeFile(join(output,'report.json'),JSON.stringify({status:'FAIL',checks,errors,error:String(error),stack:error instanceof Error?error.stack:undefined},null,2));throw error}
finally{await browser?.close().catch(()=>{});await app?.close().catch(()=>{});await rm(temp,{recursive:true,force:true})}
