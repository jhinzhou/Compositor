import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {actionSchema} from '../src/shared/contracts'
import {preparePatch,type PatchAction,PATCH_LIMITS} from '../src/core/patch-edit'
import {prepareRetouchTool,RETOUCH_TOOL_LIMITS,type RetouchToolAction} from '../src/core/retouch-tools'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {makeAsset} from '../src/core/project-io'
import {sampleHealingDonor} from '../src/shared/sampled-healing'
import type {Selection} from '../src/shared/pixel-contracts'
import type {PixelStage} from '../src/core/pixel-actions'
const retouch=(raw:unknown)=>actionSchema.parse(raw) as RetouchToolAction
const rect=(x:number,y:number,w:number,h:number):Selection=>({inverted:false,antialiased:false,shapes:[{kind:'rectangle',bounds:[x,y,w,h],feather:0,operation:'replace'}]})
function fixture(w=96,h=64){const png=blankPNG(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)png.data.set([60+x%40,90+y%30,130+(x+y)%12,255],(y*w+x)*4);const editor=new Editor();editor.importPNG(encodeRaster(png),'ROI test');const id=editor.state().manifest.layers[0].id,stage:PixelStage={...editor.snapshot(),selection:rect(50,24,12,10)};return {png,editor,stage,id}}
const patch=(id:string,extra:Partial<PatchAction>={}):PatchAction=>({type:'layer.patch',layerId:id,offset:[-24,0],mode:'source',adaptation:1,...extra})
const bytes=(png:PNG,x:number,y:number)=>png.data.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)

test('Patch handles a real 5 MP source using a small donor region, preserving every uncovered RGBA byte',()=>{
 const {png,stage,id}=fixture(2500,2000),action=patch(id,{adaptation:0,offset:[-24.5,.5]}),before=Buffer.from(png.data),result=preparePatch(stage,action),out=PNG.sync.read(result.png)
 assert.equal(result.affectedPixels,120);assert.deepEqual([...bytes(out,55,28)],[...sampleHealingDonor(before,2500,2000,31,29)].map(Math.round));let outsideChanges=0;for(let y=0;y<2000;y++)for(let x=0;x<2500;x++)if(x<50||x>=62||y<24||y>=34){const at=(y*2500+x)*4;for(let c=0;c<4;c++)if(out.data[at+c]!==before[at+c])outsideChanges++}assert.equal(outsideChanges,0);assert.deepEqual(png.data,before)
})
test('Patch fractional/feathered Source and Destination are invariant when unchanged surrounding image is padded',()=>{
 const small=fixture(),large=fixture(300,240),smallLayer=small.stage.manifest.layers[0],largeLayer=large.stage.manifest.layers[0]
 // A larger source raster has identical nearby pixels and 1:1 placement, so
 // adding distant unselected pixels must never change local solver results.
 for(let y=0;y<64;y++)for(let x=0;x<96;x++)large.png.data.set(bytes(small.png,x,y),(y*300+x)*4)
 const file=largeLayer.imageFile!;large.stage.assets.set(file,makeAsset(file,encodeRaster(large.png)))
 for(const mode of ['source','destination'] as const){const selection={...rect(50,24,12,10),feather:1.25,featherModel:'photoshop' as const};small.stage.selection=selection;large.stage.selection=structuredClone(selection);const a=patch(small.id,{mode,offset:[-24.5,.5]}),s=PNG.sync.read(preparePatch(small.stage,a).png),l=PNG.sync.read(preparePatch(large.stage,{...a,layerId:large.id}).png);let maximum=0;for(let y=0;y<64;y++)for(let x=0;x<96;x++)for(let c=0;c<4;c++)maximum=Math.max(maximum,Math.abs(bytes(s,x,y)[c]-bytes(l,x,y)[c]));assert.ok(maximum<=1,`padding changed local byte values by ${maximum}`)}
 assert.deepEqual(smallLayer.transform.origin,[0,0])
})
test('Patch budgets charge local work and reject oversized working areas before allocating donors; cancellation leaves source untouched',()=>{
 const {stage,id}=fixture(),before=stage.assets.get(stage.manifest.layers[0].imageFile!)!;stage.selection=rect(50,24,4,4);const result=preparePatch(stage,patch(id,{adaptation:0}),{maximumWork:50_000});assert.ok(result.affectedPixels>0);assert.throws(()=>preparePatch(stage,patch(id),{maximumWork:100}),/budget/);const controller=new AbortController();controller.abort();assert.throws(()=>preparePatch(stage,patch(id),{signal:controller.signal}),/canceled/);assert.strictEqual(stage.assets.get(before.file),before)
 const huge={...stage,assets:new Map(stage.assets)};huge.assets.set(before.file,{...before,width:4001,height:4000});assert.throws(()=>preparePatch(huge,patch(id)),/16 MP/);assert.equal(PATCH_LIMITS.workingPixels,4_000_000)
})
test('A full inverted 5 MP Patch selection refuses the working-area budget while preserving source and selection',()=>{
 const {stage,id}=fixture(2500,2000);stage.selection={inverted:true,antialiased:false,shapes:[]};const before=stage.assets.get(stage.manifest.layers[0].imageFile!)!;assert.throws(()=>preparePatch(stage,patch(id)),/4 MP selected working area/);assert.strictEqual(stage.assets.get(before.file),before);assert.equal(stage.selection.inverted,true)
})
test('Red Eye processes a small eye on a real source larger than 2 MP, retaining alpha, hidden RGB, distant red and all outside pixels',()=>{
 const {png,stage,id}=fixture(2000,1200),file=stage.manifest.layers[0].imageFile!;stage.selection=null
 for(let y=24;y<32;y++)for(let x=50;x<58;x++)png.data.set([205,32,27,128],(y*2000+x)*4)
 png.data.set([250,251,252,128],(26*2000+52)*4);png.data.set([200,31,25,0],(27*2000+53)*4);png.data.set([205,32,27,255],(1000*2000+1500)*4);stage.assets.set(file,makeAsset(file,encodeRaster(png)))
 const before=Buffer.from(png.data),result=prepareRetouchTool(stage,{type:'layer.red_eye',layerId:id,bounds:[46,20,16,16],pupilSize:1,darkenAmount:.5}),out=PNG.sync.read(result.png);assert.deepEqual([...bytes(out,54,28)],[32,32,32,128]);assert.deepEqual(bytes(out,52,26),bytes(png,52,26));assert.deepEqual(bytes(out,53,27),bytes(png,53,27));assert.deepEqual(bytes(out,1500,1000),bytes(png,1500,1000));let outsideChanges=0;for(let y=0;y<1200;y++)for(let x=0;x<2000;x++)if(x<46||x>=62||y<20||y>=36){const at=(y*2000+x)*4;for(let c=0;c<4;c++)if(out.data[at+c]!==before[at+c])outsideChanges++}assert.equal(outsideChanges,0);assert.deepEqual(before,png.data)
})
test('Red Eye source and eye-region limits reject before changing pixels; Remove and Move retain their bounded search limits',()=>{
 const {stage,id}=fixture(),file=stage.manifest.layers[0].imageFile!,before=stage.assets.get(file)!,a={type:'layer.red_eye' as const,layerId:id,bounds:[20,10,20,20] as[number,number,number,number]}
 const huge={...stage,assets:new Map(stage.assets)};huge.assets.set(file,{...before,width:4001,height:4000});assert.throws(()=>prepareRetouchTool(huge,retouch(a)),/16 MP/);huge.assets.set(file,{...before,width:2500,height:2000});assert.throws(()=>prepareRetouchTool(huge,retouch({...a,bounds:[0,0,2500,2000],pupilSize:1})),/2 MP eye-region/)
 for(const action of [{type:'layer.remove' as const,layerId:id,points:[[40,20]] as[number,number][],size:5},{type:'layer.content_aware_move' as const,layerId:id,offset:[5,0] as[number,number]}])assert.throws(()=>prepareRetouchTool(huge,retouch(action)),/2 MP working raster/)
 assert.equal(RETOUCH_TOOL_LIMITS.redEyeSourcePixels,16_000_000);assert.strictEqual(stage.assets.get(file),before)
})
for(const kind of ['patch','red-eye'] as const)test(`ROI ${kind} preview equals one atomic Editor transaction, Undo/Redo and saved source pixels`,async()=>{
 const {editor,id,stage,png}=fixture(),file=stage.manifest.layers[0].imageFile!
 for(let y=24;y<32;y++)for(let x=50;x<58;x++)png.data.set([205,32,27,128],(y*96+x)*4)
 stage.assets.set(file,makeAsset(file,encodeRaster(png)));editor.restore(stage.manifest,stage.assets,'ROI transactional')
 editor.apply({...editor.identity(),action:{type:'selection.set',selection:stage.selection}})
 const before=editor.snapshot(),selection=editor.state().selection??null,a=kind==='patch'?patch(id):{type:'layer.red_eye' as const,layerId:id,bounds:[46,20,16,16] as[number,number,number,number],pupilSize:1},prepared=kind==='patch'?preparePatch({...before,selection},a as PatchAction):prepareRetouchTool({...before,selection},retouch(a)),request={...editor.identity(),action:a},result=editor.apply(request),after=editor.snapshot()
 assert.equal(result.status,'applied');assert.deepEqual(after.assets.get(after.manifest.layers[0].imageFile!)!.bytes,prepared.png);assert.deepEqual(editor.apply(request),result);editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
 const dir=await mkdtemp(join(tmpdir(),'retouch-roi-alpha25-'));try{const path=join(dir,'result.comp');await editor.saveAs(path);const reopened=new Editor();await reopened.open(path);assert.deepEqual(reopened.snapshot().assets,editor.snapshot().assets);assert.deepEqual(reopened.snapshot().manifest,editor.snapshot().manifest)}finally{await rm(dir,{recursive:true,force:true})}
})
