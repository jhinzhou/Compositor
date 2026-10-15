import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {cropSourceFootprint,cropSampleTapCount,sampleCropBicubic} from '../src/core/crop-sampling'
import type {CropCorners} from '../src/shared/crop-projective'

const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-sampling-alpha26-actionmanager-diagnostic.json',import.meta.url),'utf8'))
const decode=(entry:{rgbaZlib:string;sha256:string;width:number;height:number})=>{const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(bytes.length,entry.width*entry.height*4);return bytes}
const source=decode(fixture.source),png=new PNG({width:fixture.source.width,height:fixture.source.height});png.data.set(source)
const input=makeAsset('sampling.png',PNG.sync.write(png)),placement={origin:[0,0] as [number,number],size:[png.width,png.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
const baseline=new Map([['exact-ui-quad-down',{mae:5.8,max:105,alpha:28}],['exact-ui-quad-up',{mae:6,max:110,alpha:40}],['calibration-requested',{mae:6.75,max:120,alpha:0}],['axis-full-down',{mae:3.2,max:50,alpha:14}]])
for(const reference of fixture.cases)test(`native ActionManager ${reference.name}: source-footprint antialias preserves the independently captured improvement`,()=>{
 assert.equal(reference.referenceKind,'native-actionmanager');assert.equal(reference.geometryVerified,true)
 const native=decode(reference),before=Buffer.from(input.bytes),actual=PNG.sync.read(perspectiveCropRaster(input,placement,reference.corners as CropCorners,reference.width,reference.height,'High quality').bytes)
 let sum=0,max=0,alpha=0
 for(let i=0;i<native.length;i++){const delta=Math.abs(actual.data[i]-native[i]);if(i%4===3)alpha=Math.max(alpha,delta);else{sum+=delta;max=Math.max(max,delta)}}
 const limit=baseline.get(reference.name)!;assert.ok(sum/(actual.width*actual.height*3)<=limit.mae);assert.ok(max<=limit.max);assert.ok(alpha<=limit.alpha)
 assert.deepEqual(input.bytes,before)
})

test('rotation and shear determine the source footprint, including near-unit exact work count',()=>{
 assert.deepEqual(cropSourceFootprint([0,-64,64,32,0,0,0,0,1],8,8,.37,.61),[8,4])
 assert.equal(cropSampleTapCount(),16);assert.equal(cropSampleTapCount([1+1e-12,1]),16);assert.equal(cropSampleTapCount([1.28,1.28]),36);assert.equal(cropSampleTapCount([8,4]),512)
 assert.throws(()=>sampleCropBicubic(new Uint8Array(4),1,1,.5,.5,{premultiplied:false,footprint:[Infinity,1]}),RangeError)
})

for(const depth of [16,'hdr'] as const)test(`${depth}: minification keeps genuine precision, fractional alpha and source buffers`,()=>{
 const width=32,height=32,data=depth===16?new Uint16Array(width*height*4):new Float32Array(width*height*4),color=depth===16?[1001,5703,14009,40001]:[-.137,1.625,.01337,.625]
 for(let n=0;n<width*height;n++)data.set(color,n*4)
 const asset=depth===16?makeDeepAsset('precision.png',width,height,data as Uint16Array):makeHDRAsset('precision.exr',width,height,data as Float32Array),before=data.slice(),result=perspectiveCropRaster(asset,{...placement,size:[width,height]},[[0,0],[width,0],[width,height],[0,height]],8,8,'High quality'),values=result.hdr??result.deep!
 for(const [x,y] of [[3,3],[3,4],[4,3],[4,4]])for(let c=0;c<4;c++)assert.equal(values[(y*8+x)*4+c],data[c])
 assert.deepEqual(data,before);assert.equal(result.bitDepth,asset.bitDepth);assert.equal(!!result.hdr,!!asset.hdr)
})

test('expanded antialias cannot exceed the shared crop work budget or mutate the source',()=>{
 const before=Buffer.from(input.bytes)
 assert.throws(()=>perspectiveCropRaster(input,placement,[[0,0],[100_000,0],[100_000,100_000],[0,100_000]],1,1,'High quality'),(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='RESOURCE_LIMIT')
 const work={samples:119_999_999},quad:CropCorners=[[0,0],[png.width,0],[png.width,png.height],[0,png.height]]
 perspectiveCropRaster(input,placement,quad,1,1,'Nearest',false,0,work);assert.equal(work.samples,120_000_000)
 assert.throws(()=>perspectiveCropRaster(input,placement,quad,1,1,'Nearest',false,0,work),(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='RESOURCE_LIMIT')
 assert.deepEqual(input.bytes,before)
})
