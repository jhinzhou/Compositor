import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {decodeEXR,encodeEXR,inspectEXR,decodeRadianceHDR,encodeRadianceHDR,exrHalfToFloat,floatToEXRHalf} from '../src/core/hdr-codecs'
import {EditorError} from '../src/shared/contracts'
const record=JSON.parse(readFileSync('fixtures/hdr-codec/reference.json','utf8')) as {width:number;height:number;rows:{file:string;pixelType:'half'|'float';compression:string;sha256:string;linearPremultipliedRGBA:number[]}[]}
const fail=(code:string)=>(error:unknown)=>error instanceof EditorError&&error.code===code
const encoded=(x:number)=>Math.sign(x)*(Math.abs(x)<=.0031308?Math.abs(x)*12.92:1.055*Math.pow(Math.abs(x),1/2.4)-.055)
function locate(bytes:Buffer,name:string):number {let pos=8;while(bytes[pos]){const end=bytes.indexOf(0,pos),key=bytes.toString('ascii',pos,end);pos=bytes.indexOf(0,end+1)+1;const size=bytes.readInt32LE(pos);pos+=4;if(key===name)return pos;pos+=size}throw new Error(name)}
function sample():Float32Array{return new Float32Array([2,1,.5,1,.5,.25,.125,.25,.0001,.0002,.0004,.0001,0,0,0,0,-.5,.003,4,1])}

test('10 independent OpenEXR HALF/FLOAT/RGB fixtures decode across NONE/RLE/ZIPS/ZIP with scene-linear transfer and exact alpha',()=>{
 for(const row of record.rows){const bytes=readFileSync('fixtures/hdr-codec/'+row.file),before=Buffer.from(bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);const result=decodeEXR(bytes);assert.equal(result.width,record.width);assert.equal(result.height,record.height)
  for(let at=0;at<result.hdr.length;at+=4){const alpha=row.linearPremultipliedRGBA[at+3];assert.equal(result.hdr[at+3],alpha);for(let c=0;c<3;c++){const expected=Math.fround(alpha?encoded(row.linearPremultipliedRGBA[at+c]/alpha)*alpha:0);assert.equal(result.hdr[at+c],expected===0?0:expected)}}assert.deepEqual(bytes,before);assert.ok([...result.hdr].some(v=>v>1));assert.ok([...result.hdr].some(v=>v<0))
 }
})

test('EXR encoding round trips true HDR and low alpha without mutating source, independently of compression',()=>{
 const hdr=sample(),before=hdr.slice()
 for(const pixelType of ['half','float'] as const)for(const compression of ['none','rle','zips','zip'] as const){const bytes=encodeEXR(5,1,hdr,{pixelType,compression}),header=inspectEXR(bytes),result=decodeEXR(bytes);assert.equal(header.compression,['none','rle','zips','zip'].indexOf(compression));assert.equal(header.channels[0].type,pixelType==='half'?1:2)
  for(let at=0;at<hdr.length;at++)assert.ok(Math.abs(result.hdr[at]-hdr[at])<=Math.max(pixelType==='half'?.002:1e-6,Math.abs(hdr[at])*(pixelType==='half'?.002:1e-6)),`${pixelType}/${compression} delta ${at}`)
 }assert.deepEqual(hdr,before)
})

test('HALF boundaries are IEEE nearest-even including subnormal, signed zero and overflow refusal',()=>{
 assert.equal(floatToEXRHalf(1),0x3c00);assert.equal(exrHalfToFloat(0x7bff),65504);assert.equal(floatToEXRHalf(1+2**-11),0x3c00);assert.equal(floatToEXRHalf(1+3*2**-11),0x3c02);assert.equal(floatToEXRHalf(2**-24),1);assert.equal(floatToEXRHalf(2**-25),0);assert.equal(floatToEXRHalf(3*2**-25),2);assert.equal(floatToEXRHalf(-0),0x8000);assert.ok(Object.is(exrHalfToFloat(0x8000),-0));assert.ok(Number.isNaN(exrHalfToFloat(0x7e00)));assert.throws(()=>floatToEXRHalf(65505),fail('INVALID_ARGUMENT'));assert.throws(()=>floatToEXRHalf(NaN),fail('INVALID_ARGUMENT'))
})

test('EXR structural/unsupported inputs and working budgets fail explicitly without changing caller data',()=>{
 const valid=encodeEXR(5,1,sample(),{compression:'none'}),before=Buffer.from(valid)
 for(const flag of [512,2048,4096]){const bytes=Buffer.from(valid);bytes.writeUInt32LE(2|flag,4);assert.throws(()=>decodeEXR(bytes),fail('UNSUPPORTED_FEATURE'))}
 const unsupportedCompression=Buffer.from(valid);unsupportedCompression[locate(valid,'compression')]=4;assert.throws(()=>decodeEXR(unsupportedCompression),fail('UNSUPPORTED_FEATURE'))
 const unequal=Buffer.from(valid);unequal.writeInt32LE(1,locate(valid,'displayWindow'));assert.throws(()=>decodeEXR(unequal),fail('UNSUPPORTED_FEATURE'))
 const header=inspectEXR(valid),offset=Number(valid.readBigUInt64LE(header.headerBytes)),nan=Buffer.from(valid);nan.writeUInt16LE(0x7e00,offset+8+2*5);assert.throws(()=>decodeEXR(nan),fail('INVALID_ARGUMENT'))
 const emissive=Buffer.from(valid);emissive.writeUInt16LE(0,offset+8);assert.throws(()=>decodeEXR(emissive),fail('UNSUPPORTED_FEATURE'))
 const badOffset=Buffer.from(valid);badOffset.writeBigUInt64LE(8n,header.headerBytes);assert.throws(()=>decodeEXR(badOffset),fail('INVALID_ARGUMENT'));assert.throws(()=>decodeEXR(valid.subarray(0,-1)),fail('INVALID_ARGUMENT'))
 assert.throws(()=>decodeEXR(valid,{maximumBytes:64}),fail('RESOURCE_LIMIT'));assert.throws(()=>encodeEXR(5,1,sample(),{maximumBytes:64}),fail('RESOURCE_LIMIT'));assert.deepEqual(valid,before)
})

test('EXR multi-chunk placement works in reversed physical/offset order and rejects duplicated scanlines',()=>{
 const bytes=readFileSync('fixtures/hdr-codec/openexr-float-zip.exr'),header=inspectEXR(bytes),swapped=Buffer.from(bytes),offset=header.headerBytes
 assert.equal(header.chunkCount,2);const first=swapped.readBigUInt64LE(offset),second=swapped.readBigUInt64LE(offset+8);swapped.writeBigUInt64LE(second,offset);swapped.writeBigUInt64LE(first,offset+8);assert.deepEqual(decodeEXR(swapped).hdr,decodeEXR(bytes).hdr)
 swapped.writeBigUInt64LE(second,offset+8);assert.throws(()=>decodeEXR(swapped),fail('INVALID_ARGUMENT'))
 const shifted=Buffer.from(bytes),dw=locate(bytes,'dataWindow'),display=locate(bytes,'displayWindow');for(const field of [dw,display]){shifted.writeInt32LE(-3,field);shifted.writeInt32LE(7,field+4);shifted.writeInt32LE(7,field+8);shifted.writeInt32LE(25,field+12)}for(let chunk=0;chunk<2;chunk++){const where=Number(shifted.readBigUInt64LE(offset+chunk*8));shifted.writeInt32LE(shifted.readInt32LE(where)+7,where)}assert.deepEqual(decodeEXR(shifted).hdr,decodeEXR(bytes).hdr)
})

const radianceHeader=(resolution:string,extra='')=>Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nPRIMARIES=.64 .33 .30 .60 .15 .06 .3127 .3290\n'+extra+'\n'+resolution+'\n')
test('Radiance flat, old repeat and modern per-channel RLE preserve highlights, orientation, exposure and source bytes',()=>{
 const flat=Buffer.concat([radianceHeader('-Y 1 +X 2'),Buffer.from([128,64,32,131,64,32,16,130])]),before=Buffer.from(flat),decoded=decodeRadianceHDR(flat)
 for(let x=0;x<2;x++)for(let c=0;c<3;c++){const raw=flat.subarray(flat.length-8+x*4),linear=(raw[c]+.5)*2**(raw[3]-136);assert.equal(decoded.hdr[x*4+c],Math.fround(encoded(linear)))}assert.deepEqual(flat,before)
 const flip=Buffer.concat([radianceHeader('+Y 1 -X 2'),flat.subarray(-8)]);assert.deepEqual(decodeRadianceHDR(flip).hdr,Float32Array.from([...decoded.hdr.subarray(4),...decoded.hdr.subarray(0,4)]))
 const repeated=Buffer.concat([radianceHeader('-Y 1 +X 8'),Buffer.from([128,64,32,131,1,1,1,7])]),modern=Buffer.concat([radianceHeader('-Y 1 +X 8'),Buffer.from([2,2,0,8,136,128,136,64,136,32,136,131])]);assert.deepEqual(decodeRadianceHDR(repeated).hdr,decodeRadianceHDR(modern).hdr)
 const exposure=Buffer.concat([radianceHeader('-Y 1 +X 2','EXPOSURE=2\nCOLORCORR=2 1 1\n'),flat.subarray(-8)]);assert.equal(decodeRadianceHDR(exposure).hdr[0],Math.fround(encoded(128.5*2**-5/4)))
})

test('Radiance opaque RGBE encoding emits color primaries and RLE and round trips within format quantization',()=>{
 const hdr=Float32Array.from({length:17*2*4},(_,at)=>at%4===3?1:[.5,2,4][at%4]),before=hdr.slice(),bytes=encodeRadianceHDR(17,2,hdr),decoded=decodeRadianceHDR(bytes)
 assert.ok(bytes.subarray(0,200).toString().includes('PRIMARIES='));for(let at=0;at<hdr.length;at++)assert.ok(Math.abs(hdr[at]-decoded.hdr[at])<.03);assert.deepEqual(hdr,before)
 assert.throws(()=>encodeRadianceHDR(5,1,sample()),fail('UNSUPPORTED_FEATURE'));assert.throws(()=>decodeRadianceHDR(Buffer.concat([radianceHeader('-Y 1 +X 8'),Buffer.from([2,2,0,8,0])])),fail('INVALID_ARGUMENT'))
})

test('Radiance color primaries adapt equal-energy white to D65; unknown format and nonfinite/range headers are refused',()=>{
 const bytes=Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n'),Buffer.from([128,128,128,129])]),result=decodeRadianceHDR(bytes);assert.ok(Math.abs(result.hdr[0]-result.hdr[1])<1e-6);assert.ok(Math.abs(result.hdr[1]-result.hdr[2])<1e-6)
 assert.throws(()=>decodeRadianceHDR(Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\nxxxx')),fail('UNSUPPORTED_FEATURE'));assert.throws(()=>decodeRadianceHDR(Buffer.concat([radianceHeader('-Y 30000 +X 30000'),Buffer.from([0,0,0,0])])),fail('RESOURCE_LIMIT'));assert.throws(()=>decodeRadianceHDR(Buffer.concat([radianceHeader('-Y 1 +X 1','EXPOSURE=NaN\n'),Buffer.from([0,0,0,0])])),fail('INVALID_ARGUMENT'))
})
