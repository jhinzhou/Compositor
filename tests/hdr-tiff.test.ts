import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {inspectFloatTIFF,decodeFloatTIFF} from '../src/core/hdr-tiff'
import {prepareWideImport} from '../src/core/wide-import'
import {EditorError} from '../src/shared/contracts'
const root=new URL('../fixtures/hdr-tiff/',import.meta.url),reference=JSON.parse(readFileSync(new URL('reference.json',root),'utf8')) as {fixtures:{file:string;width:number;height:number;linearRGBA:number[];sha256:string}[]}
const transfer=(n:number)=>{const a=Math.abs(n);return Math.sign(n)*(a<=.0031308?a*12.92:1.055*a**(1/2.4)-.055)}
const tagAt=(bytes:Buffer,id:number)=>{const little=bytes.toString('ascii',0,2)==='II',u16=(at:number)=>little?bytes.readUInt16LE(at):bytes.readUInt16BE(at),u32=(at:number)=>little?bytes.readUInt32LE(at):bytes.readUInt32BE(at),ifd=u32(4);for(let i=0;i<u16(ifd);i++){const at=ifd+2+i*12;if(u16(at)===id)return {at,little,u16,u32}}throw new Error('Missing fixture tag '+id)}
const setTag=(bytes:Buffer,id:number,value:number)=>{const t=tagAt(bytes,id),type=t.u16(t.at+2);if(type===3)t.little?bytes.writeUInt16LE(value,t.at+8):bytes.writeUInt16BE(value,t.at+8);else t.little?bytes.writeUInt32LE(value,t.at+8):bytes.writeUInt32BE(value,t.at+8)}
test('36 independently decoded floating TIFF fixtures preserve HALF/FLOAT/DOUBLE RGB, strip codecs, planar storage and byte order',()=>{
 for(const item of reference.fixtures){const bytes=readFileSync(new URL(item.file,root)),original=Buffer.from(bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);const result=decodeFloatTIFF(bytes);assert.equal(result.width,item.width,item.file);assert.equal(result.height,item.height,item.file)
  for(let p=0;p<result.hdr.length;p+=4){const alpha=item.linearRGBA[p+3];assert.equal(result.hdr[p+3],alpha,item.file);for(let c=0;c<3;c++)assert.equal(result.hdr[p+c],Math.fround(transfer(item.linearRGBA[p+c])*alpha),`${item.file} sample ${p+c}`)}
  assert.deepEqual(bytes,original,item.file)
 }
})
test('float TIFF wide import creates true FLOAT EXR and keeps signed samples and highlights above white',()=>{
 const bytes=readFileSync(new URL('float32-chunky-deflate-p3-le.tif',root)),result=prepareWideImport(bytes,'source.tif','TARGET.png')!;assert.equal(result.asset.file,'TARGET.exr');assert.equal(result.asset.isHDR,true);assert.ok(result.asset.hdr!.some(v=>v>1));assert.ok(result.asset.hdr!.some(v=>v<0));assert.match(result.warnings.join(' '),/scene-linear/)
})
test('associated alpha and TIFF orientations follow source semantics without quantizing unaffected floats',()=>{
 const bytes=readFileSync(new URL('float32-chunky-none-p1-le.tif',root)),base=decodeFloatTIFF(bytes)
 for(let orientation=1;orientation<=8;orientation++){const changed=Buffer.from(bytes);setTag(changed,274,orientation);const result=decodeFloatTIFF(changed);assert.equal(result.width,orientation>=5?7:19);assert.equal(result.height,orientation>=5?19:7);for(let y=0;y<7;y++)for(let x=0;x<19;x++){const [xx,yy]=[[x,y],[18-x,y],[18-x,6-y],[x,6-y],[y,x],[6-y,x],[6-y,18-x],[y,18-x]][orientation-1];assert.deepEqual(result.hdr.slice((yy*result.width+xx)*4,(yy*result.width+xx)*4+4),base.hdr.slice((y*19+x)*4,(y*19+x)*4+4))}}
 const associated=Buffer.from(bytes);setTag(associated,338,1);const h=inspectFloatTIFF(associated)!,offset=h.offsets[0];associated.writeFloatLE(2,offset);associated.writeFloatLE(.5,offset+4);associated.writeFloatLE(.25,offset+8);associated.writeFloatLE(.25,offset+12)
 // Clear zero-alpha samples because associated alpha cannot represent hidden emissive RGB.
 for(let i=0;i<h.offsets.length;i++){const lines=Math.min(h.rows,h.height-i*h.rows);for(let p=0;p<h.width*lines;p++){const at=h.offsets[i]+p*16;if(associated.readFloatLE(at+12)===0)for(let c=0;c<3;c++)associated.writeFloatLE(0,at+c*4)}}
 assert.equal(decodeFloatTIFF(associated).hdr[0],Math.fround(transfer(8)*.25))
})
test('float TIFF refuses malformed dimensions, codecs, transfer declarations, missing alpha and nonfinite data',()=>{
 const source=readFileSync(new URL('float32-chunky-none-p1-le.tif',root))
 for(const [id,value] of [[259,7],[338,0],[284,3],[278,0],[256,30000]] as [number,number][]){const bytes=Buffer.from(source);setTag(bytes,id,value);assert.throws(()=>decodeFloatTIFF(bytes),EditorError)}
 const predictor=readFileSync(new URL('float32-chunky-deflate-p3-le.tif',root));setTag(predictor,317,2);assert.throws(()=>decodeFloatTIFF(predictor),EditorError)
 const truncated=source.subarray(0,source.length-10);assert.throws(()=>decodeFloatTIFF(truncated),EditorError)
 for(const value of [NaN,Infinity]){const bytes=Buffer.from(source),h=inspectFloatTIFF(bytes)!;bytes.writeFloatLE(value,h.offsets[0]);assert.throws(()=>decodeFloatTIFF(bytes),EditorError)}
 const ordinary=Buffer.from(source),t=tagAt(ordinary,339),start=t.u32(t.at+4)*2<=4?t.at+8:t.u32(t.at+8);for(let i=0;i<t.u32(t.at+4);i++)ordinary.writeUInt16LE(1,start+i*2);assert.equal(inspectFloatTIFF(ordinary),undefined)
})
test('linear matrix ICC uses declared primaries without clipping; nonlinear ICC is explicitly refused',()=>{
 const bytes=readFileSync(new URL('float32-icc-linear.tif',root)),h=inspectFloatTIFF(bytes)!,result=decodeFloatTIFF(bytes),item=reference.fixtures.find(f=>f.file==='float32-chunky-none-p1-le.tif')!
 assert.ok(h.matrix);assert.match(result.warnings[0],/actual primaries/)
 for(let p=0;p<result.hdr.length;p+=4){const a=item.linearRGBA[p+3];for(let c=0;c<3;c++){const linear:number=h.matrix![c*3]*item.linearRGBA[p]+h.matrix![c*3+1]*item.linearRGBA[p+1]+h.matrix![c*3+2]*item.linearRGBA[p+2];assert.equal(result.hdr[p+c],Math.fround(transfer(linear)*a))}}
 assert.ok(result.hdr.some(v=>v>1));assert.ok(result.hdr.some(v=>v<0));assert.throws(()=>decodeFloatTIFF(readFileSync(new URL('float32-icc-nonlinear.tif',root))),EditorError)
})
