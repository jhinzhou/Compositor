import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from '../src/core/project-io'
import {photoshopPerspectiveCropCorners,perspectiveCropSize,type CropCorners} from '../src/shared/crop-projective'

const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-alpha25.json',import.meta.url),'utf8'))
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
const decode=(entry:{rgbaZlib:string;sha256:string;width:number;height:number})=>{const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(sha(bytes),entry.sha256);assert.equal(bytes.length,entry.width*entry.height*4);return bytes}
const source=decode(fixture.source),sourcePNG=new PNG({width:fixture.source.width,height:fixture.source.height});sourcePNG.data.set(source)
const asset=makeAsset('reference.png',PNG.sync.write(sourcePNG)),placement={origin:[0,0] as [number,number],size:[sourcePNG.width,sourcePNG.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
for(const reference of fixture.cases)test(`independent native holdout ${reference.name}: fixed native size PS profile sampling and alpha`,()=>{
 assert.equal(reference.geometryVerified,true);const native=decode(reference),sourceBefore=Buffer.from(asset.bytes),corners=structuredClone(reference.corners) as CropCorners
 const corrected=photoshopPerspectiveCropCorners(corners,reference.width,reference.height),actual=PNG.sync.read(perspectiveCropRaster(asset,placement,corrected,reference.width,reference.height,'High quality').bytes)
 assert.deepEqual(corners,reference.corners);assert.deepEqual(asset.bytes,sourceBefore)
 let sum=0,max=0;for(let i=0;i<native.length;i++){const delta=Math.abs(actual.data[i]-native[i]);if(i%4===3)assert.equal(delta,0,`alpha at pixel ${i/4}`);else{sum+=delta;max=Math.max(max,delta)}}
 const mae=sum/(actual.width*actual.height*3);assert.ok(mae<=reference.maximumRGBMAE,`${reference.name}: MAE ${mae}`);assert.ok(max<=reference.maximumRGBDelta,`${reference.name}: max ${max}`)
})
test('native size evidence preserves the explicit unresolved automatic-size gap rather than adopting a longest-edge fit',()=>{
 const expected=new Map([['axis-rectangle',[201,134]],['fractional-parallelogram',[331,200]],['old-quad-repeat',[348,224]],['strong-trapezoid',[265,239]],['opposite-quad',[363,242]]])
 let widthGap=0,heightGap=0;for(const reference of fixture.cases){const size=perspectiveCropSize(reference.corners);assert.deepEqual([size.width,size.height],expected.get(reference.name));widthGap=Math.max(widthGap,Math.abs(size.width-reference.width));heightGap=Math.max(heightGap,Math.abs(size.height-reference.height))}assert.equal(widthGap,66);assert.equal(heightGap,33)
})
for(const depth of [8,16,'hdr'] as const)test(`${depth}: explicit Photoshop inclusive identity retains real source precision, including fractional alpha and HDR range`,()=>{
 const width=5,height=4,raw:CropCorners=[[0,0],[width-1,0],[width-1,height-1],[0,height-1]];let input:Asset
 if(depth==='hdr'){const data=new Float32Array(width*height*4);for(let i=0;i<width*height;i++)data.set([1.5+i/16,-.125,.25,.625],i*4);input=makeHDRAsset('identity.exr',width,height,data)}
 else if(depth===16){const data=new Uint16Array(width*height*4);for(let i=0;i<width*height;i++)data.set([1001+i*13,2703+i*17,5007+i*19,40009],i*4);input=makeDeepAsset('identity.png',width,height,data)}
 else{const png=new PNG({width,height});for(let i=0;i<width*height;i++)png.data.set([10+i,90+i,130+i,160],i*4);input=makeAsset('identity.png',PNG.sync.write(png))}
 const before=Buffer.from(input.bytes),output=perspectiveCropRaster(input,{...placement,size:[width,height]},photoshopPerspectiveCropCorners(raw,width,height),width,height,'High quality'),data=(a:Asset)=>a.hdr??a.deep??PNG.sync.read(a.bytes).data
 assert.deepEqual(data(output),data(input));assert.deepEqual(input.bytes,before);assert.equal(output.bitDepth,input.bitDepth);assert.equal(!!output.hdr,!!input.hdr)
})
