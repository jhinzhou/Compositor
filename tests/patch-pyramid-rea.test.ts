import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
import {blendSampledHealing} from '../src/shared/sampled-healing'
import type {Selection} from '../src/shared/pixel-contracts'
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),decode=(v:string)=>Uint8Array.from(gunzipSync(Buffer.from(v,'base64')))
const oldFiles=[...['natural-explicit','natural-heldout','synthetic-explicit','natural-third-independent','independent-irregular-aa','independent-irregular-feather4','independent-isolated-soft-peak'].map(v=>`photoshop-27.11-patch-${v}-alpha26.json`),...['slanted-aa','curved-polygon-aa','slanted-feather2','slanted-feather6','lowpeak6-feather8','lowpeak14-feather8'].map(v=>`photoshop-27.11-patch-soft-holdout-${v}-alpha27.json`),...['slanted-aa','slanted-feather05','slanted-feather25','slanted-feather5','curved-aa','core-and-soft-island'].map(v=>`photoshop-27.11-patch-tail-holdout-${v}-alpha28.json`)]
async function stage(width:number,height:number,source:Uint8Array,coverage:Uint8Array){
 const png=new PNG({width,height});png.data=Buffer.from(source);const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Frozen REA native Patch reference');const runs:[number,number,number,number][]=[]
 for(let y=0;y<height;y++)for(let x=0;x<width;){const value=coverage[y*width+x],start=x;while(x<width&&coverage[y*width+x]===value)x++;if(value)runs.push([y,start,x-start,value])}
 const selection:Selection={inverted:false,antialiased:false,shapes:[{kind:'raster',bounds:[0,0,width,height],operation:'replace',feather:0,raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs}}]};editor.apply({...editor.identity(),action:{type:'selection.set',selection}});const snapshot=editor.snapshot();return {editor,snapshot,selection,stage:{...snapshot,selection},layerId:snapshot.manifest.layers[0].id}
}
function compare(actual:Uint8Array,source:Uint8Array,mask:Uint8Array,native:Uint8Array){let max=0,bytes=0,extra=0,missing=0
 for(let p=0;p<mask.length;p++){assert.equal(actual[p*4+3],source[p*4+3]);if(!mask[p])assert.deepEqual(actual.subarray(p*4,p*4+4),source.subarray(p*4,p*4+4));const edited=[0,1,2,3].some(c=>actual[p*4+c]!==source[p*4+c]),reference=[0,1,2,3].some(c=>native[p*4+c]!==source[p*4+c]);if(edited&&!reference)extra++;if(reference&&!edited)missing++;for(let c=0;c<4;c++){const delta=Math.abs(actual[p*4+c]-native[p*4+c]);max=Math.max(max,delta);if(delta)bytes++}}
 assert.ok(max<=1,`Maximum native channel error ${max}`);assert.ok(bytes<=2,`Native mismatched channels ${bytes}`);assert.equal(extra,0);assert.equal(missing,0)
}
for(const file of oldFiles)test(`REA default D5 production path: disclosed native regression ${file}`,async()=>{
 const f=JSON.parse(await readFile(new URL('../fixtures/parity/'+file,import.meta.url),'utf8')),source=decode(f.sourceRGBA),mask=decode(f.coverage),sample=f.cases.find((c:any)=>c.diffusion===5),native=decode(sample.nativeRGBA)
 assert.equal(sha(source),f.sourceSha);assert.equal(sha(mask),f.coverageSha);assert.equal(sha(native),sample.nativeSha);assert.equal(sample.history,'修补选区');assert.ok(!sample.error)
 const s=await stage(f.width,f.height,source,mask),prepared=preparePatch(s.stage,{type:'layer.patch',layerId:s.layerId,mode:'source',offset:f.operation.offset});compare(Uint8Array.from(PNG.sync.read(prepared.png).data),source,mask,native)
})
const fresh=JSON.parse(await readFile(new URL('../fixtures/parity/photoshop-27.11-patch-rea-pyramid-alpha29.json',import.meta.url),'utf8'))
test('Fresh REA cohort retains all 24 post-freeze native D1/D5/D7 records, with native source/mask/history identities',()=>{
 assert.equal(fresh.fixtures.length,24);assert.equal(fresh.candidateSHA256,'f06506f1390346809b08932cb86ac04ab066abbc5ec3344a782167ff5f8317a9')
 for(const f of fresh.fixtures){const source=decode(f.sourceRGBA),mask=decode(f.coverage),native=decode(f.nativeRGBA);assert.equal(sha(source),f.sourceSha);assert.equal(sha(mask),f.coverageSha);assert.equal(sha(native),f.nativeSha);assert.equal(f.nativeMetadata.activeHistory,'修补选区');assert.equal(f.nativeMetadata.error,'');assert.equal(Number(f.nativeMetadata.healSmoothFactor),f.d);assert.equal(source.length,f.width*f.height*4);for(let p=0;p<mask.length;p++){assert.equal(native[p*4+3],source[p*4+3]);if(!mask[p])assert.deepEqual(native.subarray(p*4,p*4+4),source.subarray(p*4,p*4+4))}}
})
for(const f of fresh.fixtures.filter((v:any)=>v.d===5))test(`REA frozen independent D5 production parity ${f.id}`,async()=>{
 const source=decode(f.sourceRGBA),mask=decode(f.coverage),native=decode(f.nativeRGBA),s=await stage(f.width,f.height,source,mask),prepared=preparePatch(s.stage,{type:'layer.patch',layerId:s.layerId,mode:'source',offset:f.offset});compare(Uint8Array.from(PNG.sync.read(prepared.png).data),source,mask,native)
})
test('REA default Patch keeps single coverage/opacity, no-core donor edits, transparent legacy, budget/cancel and private arrays',()=>{
 const width=32,height=28,destination=new Uint8Array(width*height*4),donor=new Float32Array(width*height*4),mask=new Uint8Array(width*height);for(let p=0;p<mask.length;p++){destination.set([120,100,80,255],p*4);donor.set([40,30,20,255],p*4)}for(let y=7;y<20;y++)for(let x=9;x<24;x++)mask[y*width+x]=96
 const before=destination.slice(),options={selectionCoreThreshold:128,selectionSoftTail:true,selectionPyramid:true},output=blendSampledHealing(destination,donor,mask,width,height,{...options,opacity:.5});for(let c=0;c<3;c++)assert.equal(output[(10*width+12)*4+c],Math.round(destination[c]*(1-96/255*.5)+donor[c]*(96/255*.5)));assert.deepEqual(blendSampledHealing(destination,donor,mask,width,height,{...options,opacity:0}),destination)
 for(const protectAlpha of [true,false]){const p=10*width+12;destination.set([211,33,57,0],p*4);donor.set([10,20,30,64],p*4);assert.deepEqual(blendSampledHealing(destination,donor,mask,width,height,{...options,protectAlpha}),blendSampledHealing(destination,donor,mask,width,height,{selectionCoreThreshold:128,selectionSoftTail:true,protectAlpha}))}destination.set(before);donor.set([40,30,20,255],(10*width+12)*4)
 for(let y=10;y<18;y++)for(let x=12;x<21;x++)mask[y*width+x]=255
 assert.throws(()=>blendSampledHealing(destination,donor,mask,width,height,{...options,maximumWork:width*height+20}),/budget/);const signal=new AbortController().signal;let checks=0;Object.defineProperty(signal,'aborted',{get:()=>++checks>40});assert.throws(()=>blendSampledHealing(destination,donor,mask,width,height,{...options,signal}),/canceled/);assert.deepEqual(destination,before)
 assert.deepEqual(blendSampledHealing(destination,donor,mask,width,height,{adaptation:.7}),blendSampledHealing(destination,donor,mask,width,height,{adaptation:.7,selectionPyramid:false}))
})
test('REA Patch real Editor Source/Destination preview/commit, retry, Undo/Redo and saved reopen share exact bytes',async()=>{
 const f=fresh.fixtures.find((v:any)=>v.id==='woven-feather-d5'),source=decode(f.sourceRGBA),mask=decode(f.coverage),folder=await mkdtemp(join(tmpdir(),'rea-patch-history-'))
 try{for(const mode of ['source','destination'] as const){const s=await stage(f.width,f.height,source,mask),action={type:'layer.patch' as const,layerId:s.layerId,mode,offset:f.offset},prepared=preparePatch(s.stage,action),request={...s.editor.identity(),action},result=s.editor.apply(request),after=s.editor.snapshot();assert.deepEqual(after.assets.get(after.manifest.layers[0].imageFile!)!.bytes,prepared.png);assert.deepEqual(s.editor.apply(request),result);s.editor.history({...s.editor.identity(),direction:'undo'});assert.deepEqual(s.editor.snapshot(),s.snapshot);s.editor.history({...s.editor.identity(),direction:'redo'});assert.deepEqual(s.editor.snapshot(),after);await s.editor.saveAs(join(folder,mode+'.comp'));const reopened=new Editor();await reopened.open(join(folder,mode+'.comp'));assert.deepEqual(reopened.snapshot().assets,s.editor.snapshot().assets)}}finally{await rm(folder,{recursive:true,force:true})}
})
