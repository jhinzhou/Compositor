import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {magicErasePixels,type MagicEraseParams,type ColorEraseContext} from '../src/core/color-erase'
import {magicEraseColorTables,magicEraseColorScore,magicEraseAntialiasCoverage} from '../src/shared/magic-erase-antialias'
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-magic-aa-rea-alpha30.json',import.meta.url),'utf8'))
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex')
const context=(width:number,height:number):ColorEraseContext=>({transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'},canvasSize:[width,height]})
for(const c of fixture.cases)test(`REA Magic AA ${c.cohort} ${c.name}: immutable native alpha/visible/premultiplied gate`,()=>{
 const source=fixture.sources[c.sourceId],data=inflateSync(Buffer.from(source.rgbaZlib,'base64')),native=inflateSync(Buffer.from(c.rgbaZlib,'base64')),before=Buffer.from(data)
 assert.equal(sha(data),source.rgbaSHA256);assert.equal(sha(native),c.rgbaSHA256)
 const result=magicErasePixels({width:source.width,height:source.height,data},context(source.width,source.height),c.params),n=source.width*source.height
 let alphaDiff=0,alphaMax=0,alphaSum=0,visible=0,premult=0
 for(let p=0;p<n;p++){const at=p*4,d=Math.abs(result.data[at+3]-native[at+3]);alphaDiff+=d>0?1:0;alphaMax=Math.max(alphaMax,d);alphaSum+=d;for(let k=0;k<3;k++){if(native[at+3])visible+=result.data[at+k]!==native[at+k]?1:0;premult+=Math.round(result.data[at+k]*result.data[at+3]/255)!==Math.round(native[at+k]*native[at+3]/255)?1:0}}
 assert.equal(alphaDiff,c.expectedAlphaDiff);assert.equal(alphaMax,c.expectedAlphaMax);assert.equal(visible,0)
 if(c.expectedAlphaDiff===0)assert.equal(premult,0)
 else{assert.equal(premult,10350);assert.ok(alphaSum/n<=c.disclosedBaseline.alphaMAE);assert.ok(alphaMax<=c.disclosedBaseline.alphaMax)}
 assert.deepEqual(data,before);assert.notEqual(result.data.buffer,data.buffer)
})
test('REA fixtures retain failed V1 and separate V2 disclosed cases from four post-freeze independent native results',()=>{
 assert.equal(fixture.cases.length,15);assert.equal(fixture.cases.filter((c:any)=>c.cohort==='post-v2-freeze-independent').length,4)
 assert.ok(fixture.cases.some((c:any)=>c.frozenV1?.alphaMax>100));assert.equal(fixture.cases.find((c:any)=>c.name==='fresh-islands-t8-c0-o100').frozenV1.alphaDiff,4488)
 assert.equal(fixture.v2Freeze.candidateSHA256,'7165e520cf92120291a324d6283a1cbc6a298ff475cf815168335f8b118bc1e1')
})
test('Old disclosed alpha28 256-pixel AA residual is eliminated without changing hidden RGB normalization',()=>{
 const f=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-color-erase-aa-residual-alpha28.json',import.meta.url),'utf8')),c=f.cases[0],s=f.sources[c.sourceVariant],data=inflateSync(Buffer.from(s.rgbaZlib,'base64')),native=inflateSync(Buffer.from(c.rgbaZlib,'base64')),result=magicErasePixels({width:s.width,height:s.height,data},context(s.width,s.height),c.params)
 let hidden=0;for(let p=0;p<s.width*s.height;p++){assert.equal(result.data[p*4+3],native[p*4+3]);for(let k=0;k<3;k++){assert.equal(result.data[p*4+k]*result.data[p*4+3],native[p*4+k]*native[p*4+3]);if(!native[p*4+3]&&result.data[p*4+k]!==native[p*4+k])hidden++}}assert.ok(hidden>0)
})
test('REA AA source point flooring, selection/canvas bounds, work/cancel atomicity and fallback routes remain explicit',()=>{
 const w=8,h=4,data=Uint8Array.from({length:w*h*4},(_,i)=>i%4===3?201:i%4===0?31:64),image={width:w,height:h,data},before=data.slice(),params:MagicEraseParams={point:[.75,.75],tolerance:0,contiguous:true,antialiased:true,opacity:.43},ctx=context(w,h)
 assert.deepEqual(magicErasePixels(image,ctx,params).data,magicErasePixels(image,ctx,{...params,point:[.01,.01]}).data)
 const selection={inverted:false,antialiased:false,shapes:[{kind:'rectangle' as const,operation:'replace' as const,bounds:[0,0,2,4] as [number,number,number,number],feather:0}]},selected=magicErasePixels(image,{...ctx,selection},params)
 for(let y=0;y<h;y++)for(let x=2;x<w;x++)assert.deepEqual(selected.data.subarray((y*w+x)*4,(y*w+x)*4+4),data.subarray((y*w+x)*4,(y*w+x)*4+4))
 const clipped=magicErasePixels(image,{...ctx,canvasSize:[2,h]},params);for(let y=0;y<h;y++)for(let x=2;x<w;x++)assert.equal(clipped.data[(y*w+x)*4+3],201)
 const abort=new AbortController();abort.abort();assert.throws(()=>magicErasePixels(image,ctx,params,{signal:abort.signal}),{code:'CANCELED'});assert.throws(()=>magicErasePixels(image,ctx,params,{maximumWork:10}),{code:'RESOURCE_LIMIT'});assert.deepEqual(data,before)
 const merged=magicErasePixels(image,ctx,{...params,sampleImage:image});assert.ok(merged.documentCoverage);assert.equal(merged.data[3],115,'Merged route keeps prior unquantized opacity')
 const fractional=magicErasePixels(image,ctx,{...params,tolerance:.25});assert.equal(fractional.data[3],115)
 const deep={width:1,height:1,data:Uint16Array.from([1001,2003,3007,50001])},d=magicErasePixels(deep,context(1,1),{...params,opacity:.5});assert.deepEqual([...d.data],[501,1002,1504,25001])
})
test('Six-channel LUT and ordered boundary passes remain independently bounded and cancelable',()=>{
 const tables=magicEraseColorTables([64,64,64],32);assert.equal(magicEraseColorScore(tables,36,90,204),60);assert.equal(magicEraseColorScore(tables,97,64,64),126)
 let work=0;const region=Uint8Array.from([255,0,0]),score=Uint8Array.from([127,0,127]),coverage=new Float32Array(3)
 magicEraseAntialiasCoverage(region,score,3,1,coverage,()=>{work++});assert.ok(work>3);assert.deepEqual([...coverage],[1,0,0],'A zero-score grown pixel cannot pass the >=128 threshold or propagate two pixels')
 assert.throws(()=>magicEraseAntialiasCoverage(Uint8Array.from([255,0]),Uint8Array.from([127,64]),2,1,new Float32Array(2),()=>{throw Error('cancel')}),/cancel/)
})
