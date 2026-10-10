import {_electron as electron,expect,type ElectronApplication} from '@playwright/test'
import {mkdtemp,mkdir,rm,writeFile,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {encodeRaster} from '../src/core/raster-edit'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {EditorState,EditAction} from '../src/shared/contracts'
import type {Selection} from '../src/shared/pixel-contracts'

// Tests only this temporary project/profile, renderer IPC and protocol assets.
// No clipboard or installed application is read or written.
if(process.env.COMPOSITOR_EXECUTABLE)throw Error('Protocol parity acceptance requires the isolated development runtime.')
const directory=await mkdtemp(join(tmpdir(),'compositor-parity-protocol-')),checks:string[]=[],errors:string[]=[]
let app:ElectronApplication|undefined
try {
 const editor=new Editor(),base=new PNG({width:24,height:16}),overlay=new PNG({width:24,height:16})
 for(let y=0;y<16;y++)for(let x=0;x<24;x++){base.data.set([255,0,0,255],(y*24+x)*4);overlay.data.set(x<8?[255,0,0,255]:x<16?[0,0,255,255]:[0,255,0,255],(y*24+x)*4)}
 editor.importPNG(encodeRaster(base),'Base red');const baseId=editor.state().manifest.activeLayerID!;editor.importPNG(encodeRaster(overlay),'Composite stripes');const topId=editor.state().manifest.activeLayerID!
 for(const layerId of [baseId,topId])editor.apply({...editor.identity(),action:{type:'layer.set_transform',layerId,transform:{origin:[0,0],size:[24,16],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}})
 await editor.saveAs(join(directory,'Protocol.comp'));const project=await realpath(join(directory,'Protocol.comp'))
 app=await electron.launch({args:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(directory,'profile')},timeout:60000})
 const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:60000})
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const result=await page.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.equal(result.ok,true,JSON.stringify(result));return (result as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 const edit=async(action:EditAction)=>rpc('apply',{...identity(await state()),action})
 const readonly=(s:EditorState)=>({revision:s.revision,modified:s.modified,manifest:s.manifest,assets:s.assets,selection:s.selection,canUndo:s.canUndo,canRedo:s.canRedo,undoTransactionId:s.undoTransactionId,redoTransactionId:s.redoTransactionId})
 const samples=(selection:Selection|null|undefined)=>[4,12,20].map(x=>selectionCoverage(selection??null,x+.5,8.5))
 async function bytes(s:EditorState,file:string):Promise<Buffer>{const asset=s.assets.find(asset=>asset.file===file)!;assert.ok(asset);const url=`compositor-asset://${s.sessionId}/${encodeURIComponent(file)}?hash=${asset.hash}`;return Buffer.from(await page.evaluate(async(url)=>{const response=await fetch(url);if(!response.ok)throw Error(`Asset HTTP ${response.status}`);return Array.from(new Uint8Array(await response.arrayBuffer()))},url))}
 await app.evaluate(({app},path)=>app.emit('open-file',{preventDefault(){}},path),project);await expect.poll(async()=>(await state()).projectPath,{timeout:30000}).toBe(project)
 // Every preview is queried before committing the same request, so mutation
 // counts and all three sampled stripe results have independent expectations.
 for(const variant of [{name:'include',excludeColors:[],invert:false,expected:[1,1,0]},{name:'exclude',excludeColors:[[0,0,255]],invert:false,expected:[1,0,0]},{name:'invert',excludeColors:[[0,0,255]],invert:true,expected:[0,1,1]}]){
  const before=await state(),request={...identity(before),action:{type:'selection.color_range',layerId:topId,colors:[[255,0,0],[0,0,255]],excludeColors:variant.excludeColors,tolerance:0,softness:0,invert:variant.invert,sampleAllLayers:true,antialiased:true,operation:'replace'}},preview=await rpc('selectionRasterPreview',{request,requestId:checks.length+1})
  assert.deepEqual(readonly(await state()),readonly(before));assert.deepEqual(samples(preview.selection),variant.expected)
  const raster=PNG.sync.read(Buffer.from(preview.url.split(',')[1],'base64'));assert.equal(raster.width,24);for(const [i,x] of [4,12,20].entries())assert.equal(raster.data[(8*24+x)*4],variant.expected[i]*255)
  await rpc('apply',request);const committed=await state();assert.equal(committed.revision,before.revision+1);assert.deepEqual(committed.selection,preview.selection);assert.deepEqual(committed.assets,before.assets);checks.push(`Color Range ${variant.name}: readonly preview equals one selection commit with expected document samples`)
 }
 await edit({type:'selection.wand',layerId:baseId,point:[4,8],tolerance:0,contiguous:false,sampleSize:'point',sampleAllLayers:false,antialiased:true,operation:'replace'});assert.deepEqual(samples((await state()).selection),[1,1,1]);checks.push('Wand current-layer sampling reads the transformed source independently of the visible overlay')
 await edit({type:'selection.wand',layerId:baseId,point:[4,8],tolerance:0,contiguous:false,sampleSize:'point',sampleAllLayers:true,antialiased:true,operation:'replace'});assert.deepEqual(samples((await state()).selection),[1,0,0]);checks.push('Wand all-layer sampling reads the actual document composite')
 await edit({type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[2,3,7,5],feather:0}]}})
 const beforeMask=await state(),created=await edit({type:'layer.mask',layerId:baseId,operation:'reveal'}),afterMask=await state(),maskLayer=afterMask.manifest.layers.find(layer=>layer.id===baseId)!
 assert.equal(afterMask.selection,null);assert.equal(maskLayer.maskLinked,true);const mask=PNG.sync.read(await bytes(afterMask,maskLayer.maskFile!));assert.equal(mask.width,24);assert.equal(mask.data[(4*24+4)*4],255);assert.equal(mask.data[(10*24+12)*4],0)
 await rpc('history',{...identity(afterMask),direction:'undo',transactionId:created.transactionId});const undone=await state();assert.deepEqual(undone.manifest,beforeMask.manifest);assert.deepEqual(undone.assets,beforeMask.assets);assert.deepEqual(undone.selection,beforeMask.selection)
 await rpc('history',{...identity(undone),direction:'redo'});assert.deepEqual((await state()).manifest,afterMask.manifest);assert.equal((await state()).selection,null);checks.push('Add Mask creates selected source-grid coverage and clears selection in one undoable transaction')
 await edit({type:'layer.mask',layerId:baseId,operation:'unlink'});await edit({type:'layer.mask',layerId:baseId,operation:'disable'})
 const beforeDistort=await state(),oldLayer=beforeDistort.manifest.layers.find(layer=>layer.id===baseId)!,originalImage=await bytes(beforeDistort,oldLayer.imageFile!),corners:[[number,number],[number,number],[number,number],[number,number]]=[[1,2],[22,1],[21,14],[2,15]],request=identity(beforeDistort),preview=await rpc('distortPreview',{...request,requestId:99,layerId:baseId,target:'mask',corners,trim:false})
 assert.deepEqual(readonly(await state()),readonly(beforeDistort));const changed=await rpc('apply',{...request,action:{type:'layer.distort',layerId:baseId,target:'mask',corners,trim:false}}),afterDistort=await state(),newLayer=afterDistort.manifest.layers.find(layer=>layer.id===baseId)!
 assert.deepEqual(await bytes(afterDistort,newLayer.maskFile!),Buffer.from(preview.url.split(',')[1],'base64'));assert.deepEqual(newLayer.maskPlacement??newLayer.transform,preview.transform);assert.deepEqual(newLayer.transform,oldLayer.transform);assert.equal(newLayer.maskEnabled,false);assert.equal(newLayer.maskLinked,false);assert.deepEqual(await bytes(afterDistort,newLayer.imageFile!),originalImage)
 await rpc('history',{...identity(afterDistort),direction:'undo',transactionId:changed.transactionId});const restored=await state();assert.deepEqual(restored.manifest,beforeDistort.manifest);assert.deepEqual(restored.assets,beforeDistort.assets);checks.push('Independent mask Distort readonly preview equals committed PNG and placement; image bytes, enable/link state and undo stay exact')
 assert.deepEqual(errors,[]);await mkdir('artifacts/parity-protocol',{recursive:true});await writeFile('artifacts/parity-protocol/validation.json',JSON.stringify({status:'PASS',checks,errors,scope:'Isolated development runtime, real renderer IPC and compositor-asset protocol; temporary project/profile, no clipboard access'},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}catch(error){await mkdir('artifacts/parity-protocol',{recursive:true});await writeFile('artifacts/parity-protocol/validation.json',JSON.stringify({status:'FAIL',checks,errors,failure:error instanceof Error?error.message:String(error)},null,2));throw error}
finally {if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}await rm(directory,{recursive:true,force:true})}
