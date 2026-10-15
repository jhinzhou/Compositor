import {_electron as electron,chromium,expect,type ElectronApplication,type Browser,type Page} from '@playwright/test'
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:net'
import {randomUUID,createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import type {EditorState,EditAction} from '../src/shared/contracts'
import type {Selection} from '../src/shared/pixel-contracts'
import {selectionCoverage} from '../src/shared/selection-coverage'

// Expected pixels come exclusively from the independently compiled upstream C
// fixtures. The production TypeScript Patch/Heal implementations are not called.
type Row={name:string;width:number;height:number;seed:number;mode?:string;opacity?:number;inputRGBA:string;coverage:string;expectedRGBA:string;status:number}
type Oracle={commit:string;generator:string;sourceSHA256:Record<string,string>;rows:Row[]}
const temp=await mkdtemp(join(tmpdir(),'compositor-patch-upstream-'))
const directory=process.env.COMPOSITOR_PATCH_ARTIFACTS??'artifacts/patch-upstream',checks:string[]=[],errors:string[]=[]
let app:ElectronApplication|undefined,browser:Browser|undefined,page:Page|undefined,version:string|undefined
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex')
const evidence:Record<string,unknown>={}
function selection(row:Row):Selection {
 const coverage=Buffer.from(row.coverage,'base64'),runs:[number,number,number,number][]=[]
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;){const value=coverage[y*row.width+x],start=x++;while(x<row.width&&coverage[y*row.width+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
 return {inverted:false,antialiased:false,shapes:[{kind:'raster',operation:'replace',bounds:[0,0,row.width,row.height],feather:0,raster:{width:row.width,height:row.height,transform:{origin:[0,0],size:[row.width,row.height],rotation:0,flipX:false,flipY:false},runs}}]}
}
try {
 await mkdir(directory,{recursive:true})
 const fixturePath='fixtures/parity/native-6aea90a-patch.json',fixtureBytes=await readFile(fixturePath),fixture:Oracle=JSON.parse(fixtureBytes.toString())
 const healingPath='fixtures/parity/native-6aea90a-healing.json',healingBytes=await readFile(healingPath),healing:Oracle=JSON.parse(healingBytes.toString())
 const row=fixture.rows.find(row=>row.name==='texture-small-hole'&&row.seed===0)!
 assert.ok(row,'Missing seed-0 upstream C fixture');assert.equal(row.status,1)
 const input=Buffer.from(row.inputRGBA,'base64'),expected=Buffer.from(row.expectedRGBA,'base64'),coverage=Buffer.from(row.coverage,'base64')
 assert.ok(input.every((value,index)=>index%4!==3||value===255),'This fixture must be opaque: C premultiplied bytes equal PNG straight RGBA')
 assert.notDeepEqual(expected,input,'Fixture must expose a changed result')
 const png=new PNG({width:row.width,height:row.height});png.data.set(input)
 const editor=new Editor();editor.create(row.width,row.height);editor.importPNG(PNG.sync.write(png),'Independent C Patch fixture')
 const layerId=editor.state().manifest.activeLayerID!,transform={origin:[0,0] as [number,number],size:[row.width,row.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
 editor.apply({...editor.identity(),action:{type:'layer.set_transform',layerId,transform}})
 await editor.saveAs(join(temp,'Patch.comp'));const path=await realpath(join(temp,'Patch.comp'))
 evidence.oracle={fixture:fixturePath,sha256:sha(fixtureBytes),commit:fixture.commit,generator:fixture.generator,sourceSHA256:fixture.sourceSHA256,row:row.name,seed:row.seed,width:row.width,height:row.height,inputPixelSHA256:sha(input),expectedPixelSHA256:sha(expected),conversion:'Fully opaque input/output: upstream premultiplied RGBA equals PNG straight RGBA exactly.'}
 let debugPort:number|undefined
 if(process.env.COMPOSITOR_EXECUTABLE){const listener=createServer();await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));debugPort=(listener.address() as {port:number}).port;await new Promise<void>(resolve=>listener.close(()=>resolve()))}
 app=await electron.launch({executablePath:process.env.COMPOSITOR_EXECUTABLE,args:debugPort?[`--remote-debugging-port=${debugPort}`]:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(temp,'profile')},timeout:60000})
 if(debugPort){await expect.poll(()=>app!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible())?.webContents.getURL()),{timeout:30000}).toContain('/index.html');const url=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.isVisible())!.webContents.getURL());browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);page=browser.contexts()[0].pages().find(p=>p.url()===url)!;assert.ok(page)}else page=await app.firstWindow()
 page.on('pageerror',error=>errors.push(error.message));await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000});version=await app.evaluate(({app})=>app.getVersion())
 const rpc=async<T=any>(method:string,params?:unknown):Promise<T>=>page!.evaluate(async({method,params})=>{const result=await window.compositor.request(method,params);if(!result.ok)throw Error(`${result.error.code}: ${result.error.message}`);return result.value},{method,params}) as Promise<T>
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()}),apply=async(action:EditAction)=>rpc('apply',{...identity(await state()),action})
 async function bytes(s:EditorState,file:string):Promise<Buffer>{const asset=s.assets.find(a=>a.file===file);assert.ok(asset);return Buffer.from(await page!.evaluate(async(url)=>Array.from(new Uint8Array(await(await fetch(url)).arrayBuffer())),`compositor-asset://${s.sessionId}/${encodeURIComponent(file)}?hash=${asset.hash}`))}
 async function layerPNG(s:EditorState):Promise<PNG>{const layer=s.manifest.layers.find(l=>l.id===layerId);assert.ok(layer?.imageFile);return PNG.sync.read(await bytes(s,layer.imageFile))}
 await rpc('localeSet',{locale:'en'});await app.evaluate(({app},path)=>app.emit('open-file',{preventDefault(){}},path),path);await expect.poll(async()=>(await state()).projectPath).toBe(path)
 const caps=await rpc('capabilities');assert.equal(caps.version,version);assert.equal(caps.protocolVersion,2);evidence.capabilities={app:caps.app,version:caps.version,protocolVersion:caps.protocolVersion,limitations:caps.limitations}
 checks.push('Isolated runtime reports its actual version and MCP protocol capabilities; fixture source provenance and hashes are recorded')
 await apply({type:'selection.set',selection:selection(row)})
 const before=await state(),originalLayer=before.manifest.layers.find(l=>l.id===layerId)!,original=await bytes(before,originalLayer.imageFile!)
 assert.deepEqual((await layerPNG(before)).data,input)
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)assert.equal(Math.round(selectionCoverage(before.selection,x+.5,y+.5)*255),coverage[y*row.width+x])
 checks.push('Generated PNG and every source-pixel selection coverage byte equal the independent opaque seed-0 C fixture')
 await page.getByLabel('Search commands',{exact:true}).click();await page.getByRole('combobox',{name:'Search commands',exact:true}).fill('Content-Aware Fill');await page.getByRole('option').filter({has:page!.getByText('Content-Aware Fill',{exact:true})}).click()
 await expect.poll(async()=>(await state()).revision,{timeout:60000}).toBe(before.revision+1)
 const after=await state(),actual=await layerPNG(after);assert.equal(actual.width,row.width);assert.equal(actual.height,row.height);assert.deepEqual(actual.data,expected);assert.deepEqual(after.manifest.layers.find(l=>l.id===layerId)!.transform,originalLayer.transform);assert.deepEqual(after.selection,before.selection)
 for(let p=0;p<coverage.length;p++)if(!coverage[p])assert.deepEqual(actual.data.subarray(p*4,p*4+4),input.subarray(p*4,p*4+4))
 await expect(page.locator('.error-toast')).toBeHidden();evidence.actualPatchPixelSHA256=sha(actual.data)
 await writeFile(join(directory,'patch-input.png'),original);await writeFile(join(directory,'patch-expected.png'),PNG.sync.write({...png,data:expected} as PNG));await writeFile(join(directory,'patch-actual.png'),PNG.sync.write(actual));await page.screenshot({path:join(directory,'patch-result.png')})
 checks.push('App Content-Aware Fill command commits through the actual auxiliary worker; all pixels match upstream C exactly in one revision and unselected bytes/placement/selection remain exact')
 await rpc('history',{...identity(after),direction:'undo'});const undone=await state();assert.deepEqual(undone.manifest,before.manifest);assert.deepEqual(undone.assets,before.assets);assert.deepEqual(undone.selection,before.selection);assert.deepEqual(await bytes(undone,originalLayer.imageFile!),original)
 await rpc('history',{...identity(undone),direction:'redo'});const redone=await state();assert.deepEqual(redone.manifest,after.manifest);assert.deepEqual(redone.assets,after.assets);assert.deepEqual(redone.selection,after.selection);assert.deepEqual((await layerPNG(redone)).data,expected)
 checks.push('One Undo restores byte-identical original PNG/assets/metadata/selection; Redo restores the exact C-matching committed result')
 await rpc('history',{...identity(redone),direction:'undo'})
 const healRow=healing.rows.find(item=>item.name===row.name&&item.mode==='content-aware'&&item.seed===148)!
 assert.ok(healRow);assert.equal(healRow.status,0);assert.equal(healRow.opacity,1);assert.deepEqual(Buffer.from(healRow.inputRGBA,'base64'),input);assert.deepEqual(Buffer.from(healRow.coverage,'base64'),coverage)
 const healBefore=await state()
 // A hard brush covering the entire image is gated by the exact fixture selection.
 // Omit healingMode to exercise the production default; seed148 is explicit only
 // because this independent upstream C healing oracle was captured with that seed.
 await apply({type:'layer.retouch',layerId,kind:'spot-heal',points:[[row.width/2,row.height/2]],size:4096,hardness:1,opacity:1,protectAlpha:false,seed:healRow.seed})
 const healed=await state(),healActual=await layerPNG(healed),healExpected=Buffer.from(healRow.expectedRGBA,'base64');assert.equal(healed.revision,healBefore.revision+1);assert.deepEqual(healActual.data,healExpected);assert.notDeepEqual(healActual.data,input)
 evidence.healing={fixture:healingPath,fixtureSHA256:sha(healingBytes),commit:healing.commit,row:healRow.name,mode:'default content-aware (healingMode omitted)',seed:healRow.seed,expectedPixelSHA256:sha(healExpected),actualPixelSHA256:sha(healActual.data)}
 await writeFile(join(directory,'heal-actual.png'),PNG.sync.write(healActual));await rpc('history',{...identity(healed),direction:'undo'});const healUndo=await state();assert.deepEqual(healUndo.manifest,healBefore.manifest);assert.deepEqual(healUndo.assets,healBefore.assets);assert.deepEqual(await bytes(healUndo,originalLayer.imageFile!),original)
 checks.push('Real IPC Spot Healing with omitted healingMode uses the latest default content-aware kernel, matches independent C seed148 pixels exactly and Undo restores original source bytes')
 assert.deepEqual(await rpc('imageOperationState'),[]);assert.deepEqual(errors,[]);await expect(page.locator('.error-toast')).toBeHidden()
 await writeFile(join(directory,'acceptance.json'),JSON.stringify({status:'PASS',version,packaged:!!process.env.COMPOSITOR_EXECUTABLE,executable:process.env.COMPOSITOR_EXECUTABLE??null,scope:'Real App command / IPC / actual worker; independent unmodified upstream C pixel oracles; isolated generated fixtures, no user images/profile',checks,errors,evidence},null,2));console.log(JSON.stringify({status:'PASS',version,checks,errors,evidence},null,2))
}catch(cause){await mkdir(directory,{recursive:true});await page?.screenshot({path:join(directory,'failure.png'),timeout:5000}).catch(()=>{});await writeFile(join(directory,'acceptance.json'),JSON.stringify({status:'FAIL',version,packaged:!!process.env.COMPOSITOR_EXECUTABLE,checks,errors,evidence,error:String(cause)},null,2));throw cause}
finally{await browser?.close().catch(()=>{});await app?.evaluate(({app})=>app.exit(0)).catch(()=>{});await app?.close().catch(()=>{});await rm(temp,{recursive:true,force:true})}
