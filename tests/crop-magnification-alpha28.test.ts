import test from 'node:test'
import assert from 'node:assert/strict'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import {PNG} from 'pngjs'
import {cropSourceIsMagnifying,cropMappingIsMagnifying,CROP_MAGNIFICATION_BOUND_PROBES,cropSampleTapCount,sampleCropBicubic} from '../src/core/crop-sampling'
const width=32,height=16
function fixture(depth:8|16|32){const data=depth===8?new Uint8Array(width*height*4):depth===16?new Uint16Array(width*height*4):new Float32Array(width*height*4),opaque=depth===8?255:depth===16?65535:1
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const alpha=x<20?opaque:opaque*.5;data.set(depth===32?[-.25*alpha,2.375*alpha,.00390625*alpha,alpha]:[alpha*.17,alpha*.63,alpha*.37,alpha],(y*width+x)*4)}return data}
const options=(depth:8|16|32,filter:'mitchell'|'catmull-rom-9/8')=>({premultiplied:depth!==8,filter})
test('magnification profile requires both source Jacobian principal axes smaller than one, including rotation/shear',()=>{
 assert.equal(cropSourceIsMagnifying([32,0,0,0,16,0,0,0,1],64,32,.5,.5),true)
 assert.equal(cropSourceIsMagnifying([0,-32,32,32,0,0,0,0,1],64,64,.5,.5),true)
 assert.equal(cropSourceIsMagnifying([32,32,0,0,32,0,0,0,1],64,64,.5,.5),true)
 assert.equal(cropSourceIsMagnifying([32,64,0,0,32,0,0,0,1],64,64,.5,.5),false)
 assert.equal(cropSourceIsMagnifying([32,0,0,0,32,0,0,0,1],64,32,.5,.5),false)
 assert.equal(cropSourceIsMagnifying([32,0,0,0,16,0,0,0,1],32,16,.5,.5),false)
 assert.equal(cropSourceIsMagnifying([32,0,0,0,16,0,0,0,1],16,8,.5,.5),false)
 assert.equal(cropSourceIsMagnifying([32,0,0,0,16,0,0,0,1],0,32,.5,.5),false)
 assert.equal(cropSourceIsMagnifying([32,0,0,0,16,0,0,0,0],64,32,.5,.5),false)
})
for(const depth of [8,16,32] as const)test(`wide reconstruction ${depth}: every fractional/edge alpha preserved, source bytes unchanged`,()=>{
 const data=fixture(depth),before=data.slice(),quantize=(n:number)=>depth===32?Math.fround(n):Math.round(n)
 for(let u=-1;u<=33;u+=.137)for(const v of [0,.5,3.21,7.67,13.89,16.23]){
  const old=sampleCropBicubic(data,width,height,u,v,options(depth,'mitchell')),wide=sampleCropBicubic(data,width,height,u,v,options(depth,'catmull-rom-9/8'))
  assert.equal(quantize(wide[3]),quantize(old[3]),`alpha ${u},${v}`)
  // When a nonopaque sample is inside the actual widened support, no new-kernel contribution is allowed.
  if(u>=18.25||u<=1.75||v<=1.75||v>=14.25)assert.deepEqual(wide,old,`transparent/boundary exact fallback ${u},${v}`)
 }
 assert.deepEqual(data,before)
})
test('HDR wide reconstruction retains negative, over-white and sub-byte values; RGB16 uses native opaque65535',()=>{
 const hdr=fixture(32),deep=fixture(16),before=hdr.slice()
 for(const [u,v] of [[8.123,7.567],[11.19,8.77]]){
  const out=sampleCropBicubic(hdr,width,height,u,v,{premultiplied:true,filter:'catmull-rom-9/8'})
  for(const [c,n] of [-.25,2.375,.00390625,1].entries())assert.ok(Math.abs(out[c]-n)<1e-12)
  assert.ok(out[0]<0&&out[1]>1&&out[2]>0&&out[2]<1/255)
  const d=sampleCropBicubic(deep,width,height,u,v,{premultiplied:true,filter:'catmull-rom-9/8'});assert.equal(Math.round(d[3]),65535)
 }
 assert.deepEqual(hdr,before)
})
test('continuous opaque-distance transition does not create source-cell switch seams on signed high-frequency RGB',()=>{
 const data=new Uint8Array(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([127+Math.round(32*Math.sin(2*Math.PI*x*.293+.37)),127+Math.round(32*Math.cos(x*.9)),127,x<20?255:0],(y*width+x)*4)
 // Approach both sides of all integer source cells, including the former hard guard boundary17.5.
 for(let x=3;x<23;x++){const a=sampleCropBicubic(data,width,height,x+.5-1e-6,7.67,{premultiplied:false,filter:'catmull-rom-9/8'}),b=sampleCropBicubic(data,width,height,x+.5+1e-6,7.67,{premultiplied:false,filter:'catmull-rom-9/8'});for(let c=0;c<4;c++)assert.ok(Math.abs(a[c]-b[c])<.001,`cell${x} channel${c}: ${a[c]} -> ${b[c]}`)}
})
test('transparent hidden RGB and masks cannot enter wide color reconstruction',()=>{
 const a=fixture(8) as Uint8Array,b=a.slice();for(let p=0;p<width*height;p++)if(p%width>=20){a[p*4+3]=b[p*4+3]=0;b.set([250,10,240,0],p*4)}
 for(let u=15;u<24;u+=.127)assert.deepEqual(sampleCropBicubic(a,width,height,u,7.13,{premultiplied:false,filter:'catmull-rom-9/8'}),sampleCropBicubic(b,width,height,u,7.13,{premultiplied:false,filter:'catmull-rom-9/8'}))
 for(const background of [0,255])for(const u of [-5.3,.37,17.9,39.1])assert.deepEqual(sampleCropBicubic(a,width,height,u,7.13,{premultiplied:false,mask:true,background,filter:'catmull-rom-9/8'}),sampleCropBicubic(a,width,height,u,7.13,{premultiplied:false,mask:true,background,filter:'mitchell'}))
})
test('wide reconstruction tap budget includes64 alpha guard positions and16 fallback/transition taps',()=>{
 const data=fixture(8);let alphaReads=0
 const traced=new Proxy(data,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key)&&Number(key)%4===3)alphaReads++;return Reflect.get(target,key,target)}})
 sampleCropBicubic(traced,width,height,17.8,7.67,{premultiplied:false,filter:'catmull-rom-9/8'})
 assert.equal(alphaReads,80);assert.equal(cropSampleTapCount([1,1],'catmull-rom-9/8'),80);assert.equal(cropSampleTapCount([1,1],'mitchell'),16)
 alphaReads=0;sampleCropBicubic(traced,width,height,9.123,7.67,{premultiplied:false,filter:'catmull-rom-9/8'});assert.equal(alphaReads,64)
 assert.equal(cropSampleTapCount([2,3],'catmull-rom-9/8'),64+cropSampleTapCount([2,3],'mitchell'))
 const old=sampleCropBicubic(data,width,height,9.123,7.67,{premultiplied:false,footprint:[2,3]}),wide=sampleCropBicubic(data,width,height,9.123,7.67,{premultiplied:false,footprint:[2,3],filter:'catmull-rom-9/8'});assert.deepEqual(wide,old,'Explicit profile cannot replace minification')
})

test('whole-map interval proof rejects mixed scale and unsafe denominator, preserving one reconstruction family',()=>{
 const mixed=[32,0,0,0,32,0,-.4,0,1]
 assert.equal(cropSourceIsMagnifying(mixed,64,64,0,.5),true)
 assert.equal(cropSourceIsMagnifying(mixed,64,64,1,.5),false)
 assert.equal(cropMappingIsMagnifying(mixed,64,64),false)
 assert.equal(cropMappingIsMagnifying([32,0,0,0,32,0,0,0,1],64,64),true)
 assert.equal(cropMappingIsMagnifying([32,0,0,0,32,0,0,0,1],64,32),false)
 assert.equal(cropMappingIsMagnifying([32,0,0,0,32,0,-2,0,1],64,64),false)
 assert.equal(cropMappingIsMagnifying([32,0,0,0,32,0,0,0,-1],64,64),true)
 assert.equal(cropMappingIsMagnifying([32,0,0,0,32,0,0,0,1e-16],64,64),false)
 assert.equal(CROP_MAGNIFICATION_BOUND_PROBES,64)
 // Actual projective enlargement has a certified bound throughout, not only at corners.
 const safe=[20,2,1,1,16,2,.02,-.03,1]
 assert.equal(cropMappingIsMagnifying(safe,64,64),true)
 for(let y=0;y<=100;y++)for(let x=0;x<=100;x++)assert.equal(cropSourceIsMagnifying(safe,64,64,x/100,y/100),true)
})

test('general Crop work includes80 bounded taps plus64 proof probes per image; masks/aligned copies remain old cost',()=>{
 const png=new PNG({width:8,height:8});png.data.fill(255);const asset=makeAsset('work.png',PNG.sync.write(png)),before=Buffer.from(asset.bytes),placement={origin:[0,0] as [number,number],size:[8,8] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},quad:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[8,0],[8,8],[0,8]],work={samples:0}
 const general:typeof quad=[[0,.125],[8,.125],[8,8.125],[0,8.125]] // Retain the general sampler's budget gate outside the new full-source axis path.
 perspectiveCropRaster(asset,placement,general,12,12,'High quality',false,0,work);assert.equal(work.samples,12*12*80+64)
 perspectiveCropRaster(asset,placement,general,12,12,'High quality',false,0,work);assert.equal(work.samples,2*(12*12*80+64),'Shared multilayer work cannot reset per source')
 const mask={samples:0};perspectiveCropRaster(asset,placement,quad,12,12,'High quality',true,255,mask);assert.equal(mask.samples,12*12*16)
 const aligned={samples:0};perspectiveCropRaster(asset,placement,quad,8,8,'High quality',false,0,aligned);assert.equal(aligned.samples,64)
 assert.throws(()=>perspectiveCropRaster(asset,placement,general,12,12,'High quality',false,0,{samples:120_000_000-63}),/work budget/)
 assert.deepEqual(asset.bytes,before)
})

test('near-isotropic ±shear uses stable spectral norm and cannot hide a minified principal axis',()=>{
 const side=128
 for(const sign of [-1,1]){
  const s=1-2e-9,k=sign*3e-9,m=[side*s,side*k,0,side*k,side*s,0,0,0,1]
  assert.equal(cropSourceIsMagnifying(m,side,side,.5,.5),false,'True max singular=s+abs(k)=1.000000001')
  assert.equal(cropMappingIsMagnifying(m,side,side),false)
  const safeS=1-10e-9,safe=[side*safeS,side*k,0,side*k,side*safeS,0,0,0,1]
  assert.equal(cropSourceIsMagnifying(safe,side,side,.5,.5),true,'Both axes below1−1e−9')
  assert.equal(cropMappingIsMagnifying(safe,side,side),true)
 }
})
