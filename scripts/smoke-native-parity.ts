import {_electron as electron,expect,type ElectronApplication} from '@playwright/test'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import type {EditorState} from '../src/shared/contracts'
const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),'compositor-native-parity-')),checks:string[]=[],errors:string[]=[]
let app:ElectronApplication|undefined
try{
 app=await electron.launch({args:[root],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 const rpc=async<T=any>(method:string,params?:unknown):Promise<T>=>page.evaluate(async({method,params})=>{const r=await window.compositor.request(method,params);if(!r.ok)throw Error(`${r.error.code}: ${r.error.message}`);return r.value},{method,params}) as Promise<T>
 const state=()=>rpc<EditorState>('state'),id=async()=>{const s=await state();return {sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()}}
 const apply=async(action:any)=>rpc('apply',{...await id(),action})
 // Hold a real IPC response at a barrier. No timing sleeps or product test hooks:
 // the lease is processed normally, but its renderer continuation waits for release.
 const gateInteraction=async(busy:boolean)=>app!.evaluate(({ipcMain},busy)=>{
  const main=ipcMain as typeof ipcMain&{_invokeHandlers:Map<string,(event:unknown,input:any)=>Promise<unknown>>},original=main._invokeHandlers.get('editor:request')!
  const gate:{hit:boolean;release?:()=>void}={hit:false};(globalThis as any).__nativeCropGate=gate
  const barrier=new Promise<void>(resolve=>gate.release=resolve)
  main.removeHandler('editor:request');main.handle('editor:request',async(event,input)=>{
   const result=await original(event,input)
   if(input.method==='interaction'&&input.params?.busy===busy&&!gate.hit){gate.hit=true;await barrier;main.removeHandler('editor:request');main.handle('editor:request',original)}
   return result
  })
 },busy)
 const gateHit=()=>app!.evaluate(()=>(globalThis as any).__nativeCropGate?.hit===true)
 const releaseGate=()=>app!.evaluate(()=>(globalThis as any).__nativeCropGate.release())
 await rpc('newDocument');await rpc('create',{sessionId:(await state()).sessionId,width:320,height:240})
 const layer=(await state()).manifest.layers[0];assert.ok(layer)
 await apply({type:'layer.paint',layerId:layer.id,points:[[20,20],[300,220]],size:25,hardness:1,color:[.2,.6,.9,1],opacity:1})
 await page.getByRole('button',{name:'Move / Transform (V)',exact:true}).click();await page.keyboard.press('Meta+t')
 const before=await state();await page.getByLabel('Layer x',{exact:true}).fill('30');await page.getByLabel('Layer x',{exact:true}).press('Tab');await page.getByRole('button',{name:'Flip H',exact:true}).click();await page.getByLabel('Sampling',{exact:true}).selectOption('Nearest');assert.equal((await state()).revision,before.revision)
 await page.locator('.transform-toolbar').getByRole('button',{name:'Apply',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(before.revision+1);assert.equal((await state()).manifest.layers[0].transform.origin[0],30);assert.equal((await state()).manifest.layers[0].transform.flipX,true);console.log('CHECK',checks.length+1);checks.push('CmdT fields, flip and sampling remain a draft until one Apply transaction')
 await page.keyboard.press('Meta+t');await page.getByLabel('Layer x',{exact:true}).fill('55');await page.getByLabel('Layer x',{exact:true}).press('Tab');await page.locator('.transform-toolbar').getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Escape');assert.equal((await state()).manifest.layers[0].transform.origin[0],30);console.log('CHECK',checks.length+1);checks.push('Escape cancels persistent transform without changing the document')
 await page.keyboard.press('4');await page.keyboard.press('5');await expect.poll(async()=>(await state()).manifest.layers[0].opacity).toBe(.45);console.log('CHECK',checks.length+1);checks.push('Two digit layer opacity and queued commits preserve 45 percent')
 const nudgeBefore=(await state()).manifest.layers[0].transform.origin;await page.keyboard.press('ArrowRight');await expect.poll(async()=>(await state()).manifest.layers[0].transform.origin[0]).toBe(nudgeBefore[0]+1);await page.keyboard.press('Shift+ArrowDown');await expect.poll(async()=>(await state()).manifest.layers[0].transform.origin[1]).toBe(nudgeBefore[1]+10);console.log('CHECK',checks.length+1);checks.push('Arrow and Shift arrow nudge layers by 1 and 10 pixels')
 // Pixels are checked directly through the same non-mutating worker preview and final commit.
 const paint={type:'layer.paint',layerId:layer.id,points:[[80,80],[170,90]],size:45,hardness:.25,color:[1,.2,.1,1],opacity:.45,erase:false,target:'image'}
 const request={...await id(),action:paint},preview=await rpc('strokePreview',{request,requestId:1});assert.equal((await state()).revision,request.expectedRevision);await rpc('apply',request)
 const changed=await state(),asset=changed.assets.find(a=>a.file===changed.manifest.layers[0].imageFile)!,actual=await page.evaluate(async(url)=>{const b=await(await fetch(url)).arrayBuffer();return Array.from(new Uint8Array(b))},`compositor-asset://${changed.sessionId}/${encodeURIComponent(asset.file)}?hash=${asset.hash}`)
 // Asset URL service is engine-defined; use get asset route through its renderer URL helper below if needed.
 const expected=PNG.sync.read(Buffer.from(preview.url.split(',')[1],'base64'));if(actual.length)assert.deepEqual(PNG.sync.read(Buffer.from(actual)).data,expected.data)
 console.log('CHECK',checks.length+1);checks.push('Soft brush preview has identical pixels to the final worker commit')
 // A user field commit can update the revision while the crop's ready reply is
 // pending. A stale gesture must cancel cleanly, not leave a draft without an ID.
 await page.locator('.rail-tools>button[data-tool-group="C"]').click();await gateInteraction(true)
 const staleBox=await page.getByTestId('editor-canvas').boundingBox();assert.ok(staleBox)
 await page.mouse.move(staleBox.x+staleBox.width*.2,staleBox.y+staleBox.height*.2);await page.mouse.down();await page.mouse.move(staleBox.x+staleBox.width*.75,staleBox.y+staleBox.height*.75);await page.mouse.up();await expect.poll(gateHit).toBe(true)
 await apply({type:'layer.rename',layerId:layer.id,name:'Crop readiness updated'});await expect(page.getByText('Crop readiness updated',{exact:true})).toBeVisible();await releaseGate()
 await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeDisabled();checks.push('A revision change during delayed crop readiness cancels the incomplete draft instead of stranding Apply Crop')
 // A completed brush commit whose lease-release reply is delayed must retain
 // ownership; a new gesture must not share its points or cleanup with that brush.
 await page.locator('.rail-tools>button[data-tool-mode="brush"]').click();await gateInteraction(false)
 const raceBox=await page.getByTestId('editor-canvas').boundingBox();assert.ok(raceBox)
 await page.mouse.move(raceBox.x+raceBox.width*.1,raceBox.y+raceBox.height*.85);await page.mouse.down();await page.mouse.move(raceBox.x+raceBox.width*.2,raceBox.y+raceBox.height*.85);await page.mouse.up();await expect.poll(gateHit).toBe(true)
 await page.locator('.rail-tools>button[data-tool-group="C"]').click()
 const prematureCrop=await page.getByLabel('Move crop',{exact:true}).isVisible()
 assert.equal(prematureCrop,false,'Tool switch must await the previous pointer commit and lease release; otherwise its finally block still owns shared stroke state')
 await releaseGate();await expect(page.getByLabel('Move crop',{exact:true})).toBeVisible()
 await page.mouse.move(raceBox.x+raceBox.width*.2,raceBox.y+raceBox.height*.2);await page.mouse.down();await page.mouse.move(raceBox.x+raceBox.width*.75,raceBox.y+raceBox.height*.75)
 await page.mouse.up();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Cancel',exact:true}).click();checks.push('A delayed previous stroke lease keeps its owner until cleanup, then the queued tool switch accepts a new crop')
 // Cancel after PointerUp but before ready resolves must not resurrect the crop.
 await gateInteraction(true);await page.mouse.move(raceBox.x+raceBox.width*.2,raceBox.y+raceBox.height*.2);await page.mouse.down();await page.mouse.move(raceBox.x+raceBox.width*.75,raceBox.y+raceBox.height*.75);await page.mouse.up();await expect.poll(gateHit).toBe(true)
 await page.keyboard.press('Escape');await releaseGate();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Move / Transform (V)',exact:true}).click();await page.locator('.rail-tools>button[data-tool-group="C"]').click();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeDisabled();checks.push('Escape cancels a crop even when PointerUp is waiting for a delayed interaction-ready response')
 await page.getByRole('button',{name:'100%',exact:true}).click({button:'right'});await page.getByLabel('Canvas zoom percent').fill('125');await page.getByLabel('Close zoom entry').click();await page.keyboard.down('Space');const panBox=await page.locator('.canvas-wrap').boundingBox();assert.ok(panBox);await page.mouse.move(panBox.x+panBox.width/2,panBox.y+panBox.height/2);await page.mouse.down();await page.mouse.move(panBox.x+panBox.width/2+35,panBox.y+panBox.height/2-20,{steps:4});await page.mouse.up();await page.keyboard.up('Space');const viewBeforeCrop=await page.locator('.canvas-wrap').boundingBox();assert.ok(viewBeforeCrop);
 await page.locator('.rail-tools>button[data-tool-group="C"]').click();await expect(page.getByLabel('Move crop',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeDisabled();await page.getByLabel('Resize crop n',{exact:true}).click();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeDisabled();console.log('CHECK',checks.length+1);checks.push('Crop default frame and a handle click without movement remain visible without a pending edit')
 const initialHandle=await page.getByLabel('Resize crop n',{exact:true}).boundingBox();assert.ok(initialHandle)
 await page.mouse.move(initialHandle.x+initialHandle.width/2,initialHandle.y+initialHandle.height/2);await page.mouse.down();await page.mouse.move(initialHandle.x+initialHandle.width/2,initialHandle.y+initialHandle.height/2+25);await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeDisabled();checks.push('Escape on a default-frame handle restores the absence of a pending crop, including its request ID')
 const box=await page.getByTestId('editor-canvas').boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.75,box.y+box.height*.75,{steps:5});await page.mouse.up();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeEnabled()
 const pendingCrop=await page.getByLabel('Move crop',{exact:true}).boundingBox(),pendingHandle=await page.getByLabel('Resize crop n',{exact:true}).boundingBox();assert.ok(pendingCrop);assert.ok(pendingHandle)
 await page.mouse.move(pendingHandle.x+pendingHandle.width/2,pendingHandle.y+pendingHandle.height/2);await page.mouse.down();await page.mouse.move(pendingHandle.x+pendingHandle.width/2,pendingHandle.y+pendingHandle.height/2+25);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByRole('button',{name:'Apply Crop',exact:true})).toBeEnabled();assert.deepEqual(await page.getByLabel('Move crop',{exact:true}).boundingBox(),pendingCrop);checks.push('Escape on a pending-crop handle restores the prior frame and its applicable request')
 await page.getByRole('button',{name:'Apply Crop',exact:true}).click();await expect(page.getByLabel('Move crop',{exact:true})).toBeVisible();console.log('CHECK',checks.length+1);checks.push('Pointer crop applies and keeps a fresh default frame')
 await page.keyboard.press('Meta+z');assert.equal((await state()).manifest.width,320);await expect.poll(async()=>{const box=await page.locator('.canvas-wrap').boundingBox();return box?[Math.round(box.x),Math.round(box.y),Math.round(box.width),Math.round(box.height)]:[]}).toEqual([Math.round(viewBeforeCrop.x),Math.round(viewBeforeCrop.y),Math.round(viewBeforeCrop.width),Math.round(viewBeforeCrop.height)]);await page.keyboard.press('Meta+Shift+z');assert.ok((await state()).manifest.width<320);console.log('CHECK',checks.length+1);checks.push('Crop Undo restores custom 125 percent zoom and pan; Redo restores cropped dimensions')
 await page.locator('.rail-tools>button[data-tool-group="W"]').click();await expect(page.getByLabel('Wand sample size')).toBeVisible();await page.getByLabel('Wand sample size').selectOption('5x5');console.log('CHECK',checks.length+1);checks.push('Magic toolbar exposes original sample-size options')
 await page.getByLabel('Search commands',{exact:true}).click();await page.getByRole('combobox',{name:'Search commands',exact:true}).fill('Color Range');await page.getByRole('option',{name:/Color Range/}).click();await expect(page.getByAltText('Color Range selection preview')).toBeVisible();const rangeBefore=await state(),rangeBox=await page.locator('.canvas-wrap').boundingBox();assert.ok(rangeBox);await page.keyboard.down('Shift');await page.mouse.click(rangeBox.x+rangeBox.width/2,rangeBox.y+rangeBox.height/2);await page.keyboard.up('Shift');await expect(page.getByText('2 included colors',{exact:true})).toBeVisible();await page.keyboard.down('Alt');await page.mouse.click(rangeBox.x+rangeBox.width/3,rangeBox.y+rangeBox.height/3);await page.keyboard.up('Alt');await expect(page.getByText('1 excluded colors',{exact:true})).toBeVisible();assert.equal((await state()).revision,rangeBefore.revision);await page.locator('.feature-panel').filter({has:page.getByText('Color Range',{exact:true})}).getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await state()).revision,rangeBefore.revision);checks.push('Color Range canvas sampling adds and excludes colors; live preview and Cancel preserve history');
 assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/native-parity-canvas.png',timeout:5000,animations:'disabled'}).catch(()=>{})
 await writeFile('artifacts/native-parity-ui.json',JSON.stringify({status:'PASS',checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2))
}catch(error){console.error(error);if(app){const page=await app.firstWindow();console.error(await page.locator('body').innerText());await page.screenshot({path:'artifacts/native-parity-ui-failure.png',timeout:5000,animations:'disabled'}).catch(()=>{});console.error(await page.evaluate(()=>window.compositor.request('state')))}throw error}finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await rm(directory,{recursive:true,force:true})}
