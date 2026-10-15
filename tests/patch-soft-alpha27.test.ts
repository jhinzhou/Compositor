import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
import {blendSampledHealing} from '../src/shared/sampled-healing'
import type {Selection} from '../src/shared/pixel-contracts'
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),ids=['slanted-aa','curved-polygon-aa','slanted-feather2','slanted-feather6','lowpeak6-feather8','lowpeak14-feather8']
interface Fixture {width:number;height:number;sourceSha:string;sourceRGBA:string;coverageSha:string;coverage:string;validNativeEffect:boolean;operation:{offset:[number,number];nativeFeather:number};cases:{nativeRGBA:string;nativeSha:string;history:string;error:string;changed:number;outside:number;alphaChanged:number}[]}
async function nativeFixture(id:string){
 const fixture=JSON.parse(await readFile(`fixtures/parity/photoshop-27.11-patch-soft-holdout-${id}-alpha27.json`,'utf8')) as Fixture,source=Uint8Array.from(gunzipSync(Buffer.from(fixture.sourceRGBA,'base64'))),coverage=Uint8Array.from(gunzipSync(Buffer.from(fixture.coverage,'base64'))),native=Uint8Array.from(gunzipSync(Buffer.from(fixture.cases[0].nativeRGBA,'base64')))
 assert.equal(sha(source),fixture.sourceSha);assert.equal(sha(coverage),fixture.coverageSha);assert.equal(sha(native),fixture.cases[0].nativeSha);assert.ok(fixture.validNativeEffect);assert.equal(fixture.cases[0].history,'修补选区');assert.equal(fixture.cases[0].error,'')
 const png=new PNG({width:fixture.width,height:fixture.height});png.data=Buffer.from(source);const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Independent native soft-domain fixture');const runs:[number,number,number,number][]=[]
 for(let y=0;y<fixture.height;y++)for(let x=0;x<fixture.width;){const start=x,value=coverage[y*fixture.width+x];while(x<fixture.width&&coverage[y*fixture.width+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
 // Exact baked native raster; do not apply nativeFeather a second time.
 const selection:Selection={inverted:false,antialiased:false,shapes:[{kind:'raster',operation:'replace',bounds:[0,0,fixture.width,fixture.height],feather:0,raster:{width:fixture.width,height:fixture.height,transform:{origin:[0,0],size:[fixture.width,fixture.height],rotation:0,flipX:false,flipY:false},runs}}]}
 editor.apply({...editor.identity(),action:{type:'selection.set',selection}});const snapshot=editor.snapshot(),layerId=snapshot.manifest.layers[0].id;return {fixture,source,coverage,native,editor,selection,snapshot,layerId,stage:{...snapshot,selection}}
}
for(const id of ids)test(`Independent native alpha27 ${id}: exact provenance, no outside/alpha edits and frozen soft-v1 error bound`,async()=>{
 const f=await nativeFixture(id),prepared=preparePatch(f.stage,{type:'layer.patch',layerId:f.layerId,mode:'source',offset:f.fixture.operation.offset}),actual=PNG.sync.read(prepared.png).data;let error=0,max=0,channels=0,changed=0
 for(let p=0;p<f.coverage.length;p++){assert.equal(actual[p*4+3],f.source[p*4+3]);if(!f.coverage[p])assert.deepEqual(actual.subarray(p*4,p*4+4),Buffer.from(f.source.subarray(p*4,p*4+4)));else for(let c=0;c<3;c++){const d=Math.abs(actual[p*4+c]-f.native[p*4+c]);error+=d;max=Math.max(max,d);channels++}if([0,1,2].some(c=>actual[p*4+c]!==f.source[p*4+c]))changed++}
 if(id.startsWith('lowpeak')){assert.deepEqual(actual,Buffer.from(f.native));assert.equal(changed,f.fixture.cases[0].changed)}
 else if(id.includes('feather')){assert.ok(error/channels<1,`MAE ${error/channels}`);assert.ok(max<=8,`max ${max}`)}
 else {assert.ok(error/channels<1.3);assert.ok(max<=6)}
 assert.equal(sha(f.stage.assets.get(f.snapshot.manifest.layers[0].imageFile!)!.bytes),sha(f.snapshot.assets.get(f.snapshot.manifest.layers[0].imageFile!)!.bytes))
})
test('Soft tail respects frozen premultiplied donor confidence, one coverage/opacity, hidden RGB and both alpha policies',()=>{
 const destination=Uint8Array.from([80,100,120,128,11,22,33,0,71,82,93,255]),donor=Float32Array.from([40,30,20,64,40,30,20,64,40,30,20,64]),coverage=Uint8Array.from([64,64,0]),before=destination.slice(),opacity=.5,sa=64/255*opacity*64/255,da=128/255
 for(const protectAlpha of [true,false]){const actual=blendSampledHealing(destination,donor,coverage,3,1,{selectionCoreThreshold:128,selectionSoftTail:true,opacity,protectAlpha}),alpha=protectAlpha?da:sa+da*(1-sa);for(let c=0;c<3;c++){const color=donor[c]*255/64,expected=Math.round(protectAlpha?destination[c]*(1-sa)+color*sa:(color*sa+destination[c]*da*(1-sa))/alpha);assert.equal(actual[c],expected)}assert.equal(actual[3],protectAlpha?128:Math.round(alpha*255));assert.deepEqual(actual.subarray(8),destination.subarray(8));if(protectAlpha)assert.deepEqual(actual.subarray(4,8),destination.subarray(4,8))}
 assert.deepEqual(destination,before);assert.deepEqual(blendSampledHealing(destination,donor,coverage,3,1,{selectionSoftTail:true,selectionCoreThreshold:128,opacity:0}),destination)
})
test('Soft extension compute is charged; cancellation during membrane rejects without mutation',()=>{
 const w=24,h=20,destination=new Uint8Array(w*h*4),donor=new Float32Array(w*h*4),coverage=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;destination.set([90+x,80+y,70,255],p*4);donor.set([40,30,20,255],p*4);if(x>=5&&x<19&&y>=4&&y<16)coverage[p]=x>=8&&x<16&&y>=7&&y<13?255:64}
 destination.set([220,30,110,255],(10*w+12)*4);const before=destination.slice(),budget=100_000;assert.ok(blendSampledHealing(destination,donor,coverage,w,h,{maximumWork:budget,selectionCoreThreshold:128}).some((v,i)=>v!==destination[i]));assert.throws(()=>blendSampledHealing(destination,donor,coverage,w,h,{maximumWork:budget,selectionCoreThreshold:128,selectionSoftTail:true}),/budget/)
 const signal=new AbortController().signal;let checks=0;Object.defineProperty(signal,'aborted',{get:()=>++checks>310});assert.throws(()=>blendSampledHealing(destination,donor,coverage,w,h,{signal,selectionCoreThreshold:128,selectionSoftTail:true}),/canceled/);assert.deepEqual(destination,before)
})
test('Soft Source/Destination previews and commits share bytes with retry, Undo/Redo, save/reopen and canceled preparation',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'patch-soft-alpha27-'));try{for(const mode of ['source','destination'] as const){const f=await nativeFixture('slanted-feather2'),action={type:'layer.patch' as const,layerId:f.layerId,mode,offset:f.fixture.operation.offset},prepared=preparePatch(f.stage,action),request={...f.editor.identity(),action},applied=f.editor.apply(request),after=f.editor.snapshot();assert.deepEqual(after.assets.get(after.manifest.layers[0].imageFile!)!.bytes,prepared.png);assert.deepEqual(f.editor.apply(request),applied);f.editor.history({...f.editor.identity(),direction:'undo'});assert.deepEqual(f.editor.snapshot(),f.snapshot);f.editor.history({...f.editor.identity(),direction:'redo'});assert.deepEqual(f.editor.snapshot(),after);await f.editor.saveAs(join(folder,mode+'.comp'));const reopened=new Editor();await reopened.open(join(folder,mode+'.comp'));assert.deepEqual(reopened.snapshot().assets,f.editor.snapshot().assets);const controller=new AbortController();controller.abort();assert.throws(()=>preparePatch(f.stage,action,{signal:controller.signal}),/canceled/);assert.deepEqual(f.stage,{...f.snapshot,selection:f.selection})}}finally{await rm(folder,{recursive:true,force:true})}
})
