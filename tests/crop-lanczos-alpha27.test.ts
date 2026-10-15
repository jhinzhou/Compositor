import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {cropIsotropicAffineMinification,cropSampleTapCount,sampleCropBicubic} from '../src/core/crop-sampling'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {decodeDeepPNG} from '../src/core/deep-assets'
import {decodeEXR} from '../src/core/hdr-codecs'
import type {CropCorners} from '../src/shared/crop-projective'
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-calibration-alpha27.json',import.meta.url),'utf8'))
const sourceRGBA=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64')),png=new PNG({width:384,height:256});png.data.set(sourceRGBA)
const asset=makeAsset('calibration.png',PNG.sync.write(png)),placement={origin:[0,0] as [number,number],size:[384,256] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
const difference=(a:Uint8Array,b:Uint8Array)=>{let sum=0,max=0,alphaSum=0,alphaMax=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(i%4===3){alphaSum+=d;alphaMax=Math.max(alphaMax,d)}else{sum+=d;max=Math.max(max,d)}}return {mae:sum/(a.length/4*3),max,alphaMAE:alphaSum/(a.length/4),alphaMax}}
test('filter selection uses the composed affine similarity, rejecting anisotropy even when 45-degree row lengths coincide',()=>{
 assert.equal(cropIsotropicAffineMinification([384,0,0,0,256,0,0,0,1],240,160),true)
 assert.equal(cropIsotropicAffineMinification([0,-384,384,256,0,0,0,0,1],160,240),true)
 assert.equal(cropIsotropicAffineMinification([384,0,0,0,256,0,0,0,1],600,400),false)
 assert.equal(cropIsotropicAffineMinification([1,0,0,0,1,0,0,0,1],1,1),false)
 const c=Math.SQRT1_2;assert.equal(cropIsotropicAffineMinification([2*c,-3*c,0,2*c,3*c,0,0,0,1],1,1),false)
 for(const matrix of [[2,.1,0,0,2,0,0,0,1],[2,0,0,0,2,0,.02,0,1],[Infinity,0,0,0,2,0,0,0,1]])assert.equal(cropIsotropicAffineMinification(matrix,1,1),false)
 assert.equal(cropSampleTapCount([1.6,1.6],'lanczos3'),100);assert.equal(cropSampleTapCount([1.6,1.6]),64)
})
test('native calibration preserves affine downsampling and accepts verified whole-map magnification; interpolation requests remain ignored/unverified',()=>{
 for(const group of fixture.interpolationGroups){assert.equal(group.distinctDecodedOutputs,1);assert.equal(group.fieldVerifiedEffective,false)}
 const reference=fixture.cases.find((c:any)=>c.name==='axis-down-bicubicAutomatic'),native=inflateSync(Buffer.from(reference.rgbaZlib,'base64')),actual=PNG.sync.read(perspectiveCropRaster(asset,placement,reference.corners,300,200,'High quality').bytes),result=difference(actual.data,native)
 assert.ok(result.mae<2.86);assert.ok(result.max<=37);assert.ok(result.alphaMAE<=.1);assert.ok(result.alphaMax<=13);assert.deepEqual(asset.bytes,makeAsset('calibration.png',PNG.sync.write(png)).bytes)
 // Non-magnifying projective output remains byte-stable. Alpha28's frozen
 // whole-map magnification improves axis-up RGB MAE from 1.8709569444444445
 // to 1.5140347222222221. The recovered axis Smoother is now RGBA exact;
 // the independent general downsampling gate below remains unchanged.
 // Native descriptor interpolation fields remain ineffective in this cohort.
 for(const [name,mae,max,alphaMax]of [['perspective-down-bicubicAutomatic',5.788827777777778,101,0],['axis-up-bicubicAutomatic',0,0,0]] as const){const r=fixture.cases.find((c:any)=>c.name===name),out=PNG.sync.read(perspectiveCropRaster(asset,placement,r.corners,r.width,r.height,'High quality').bytes),d=difference(out.data,inflateSync(Buffer.from(r.rgbaZlib,'base64')));assert.equal(d.mae,mae);assert.equal(d.max,max);assert.equal(d.alphaMax,alphaMax)}
})
function independentWindowSample(data:Uint16Array|Float32Array,w:number,h:number,u:number,v:number,scale:number){
 const sinc=(x:number)=>Math.abs(x)<1e-12?1:Math.sin(Math.PI*x)/(Math.PI*x),kernel=(x:number)=>Math.abs(x)<3?sinc(x)*sinc(x/3):0,out=[0,0,0,0],left=Math.floor(u-.5),top=Math.floor(v-.5),radius=Math.ceil(3*scale);let normalization=0
 for(let dy=1-radius;dy<=radius;dy++)for(let dx=1-radius;dx<=radius;dx++){const weight=kernel((left+dx+.5-u)/scale)*kernel((top+dy+.5-v)/scale);normalization+=weight;const x=left+dx,y=top+dy;if(x<0||y<0||x>=w||y>=h)continue;for(let c=0;c<4;c++)out[c]+=data[(y*w+x)*4+c]*weight}
 return out.map(v=>v/normalization)
}
for(const precision of [16,'hdr'] as const)test(`${precision}: new similarity kernel preserves premultiplied source precision, negative/HDR range and one final format quantization`,()=>{
 const w=16,h=12,data=precision===16?new Uint16Array(w*h*4):new Float32Array(w*h*4)
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(precision===16)data.set([2001+x*1103,7009+y*1249,3007+(x+y)*701,50001+x*223],i);else data.set([1.3+x*.017,-.4+y*.008,.29+(x+y)*.007,.71+x*.006],i)}
 const original=data.slice(),source=precision===16?makeDeepAsset('precision.png',w,h,data as Uint16Array):makeHDRAsset('precision.exr',w,h,data as Float32Array),p={...placement,size:[w,h] as [number,number]},corners:CropCorners=[[0,0],[w,0],[w,h],[0,h]],out=perspectiveCropRaster(source,p,corners,8,6,'High quality'),result=precision===16?decodeDeepPNG(out.bytes).deep:decodeEXR(out.bytes).hdr
 const x=3,y=2,expected=independentWindowSample(original,w,h,(x+.5)*2,(y+.5)*2,2),at=(y*8+x)*4
 for(let c=0;c<4;c++)assert.equal(result[at+c],precision===16?Math.round(expected[c]):Math.fround(expected[c]))
 assert.deepEqual(data,original);assert.deepEqual(precision===16?source.deep:source.hdr,original)
 if(precision===16)assert.ok(result.some((v,i)=>i%4!==3&&v%257!==0));else{assert.ok(result.some((v,i)=>i%4===0&&v>1));assert.ok(result.some((v,i)=>i%4===1&&v<0));assert.ok(result.some((v,i)=>i%4===3&&v>0&&v<1))}
})
test('full six-radius support obeys shared work budget before mutating source; mask exterior stays explicit background and opaque alpha',()=>{
 const work={samples:120_000_000-5_000_000},before=asset.bytes.slice(),corners:CropCorners=[[0,0],[384,0],[384,256],[0,256]]
 // The whole-map selection proof adds exactly64 work units even when it
 // rejects enlargement and retains Lanczos3; the120M ceiling is unchanged.
 perspectiveCropRaster(asset,placement,corners,240,160,'High quality',false,0,work);assert.equal(work.samples,120_000_000-5_000_000+240*160*100+64)
 assert.throws(()=>perspectiveCropRaster(asset,placement,corners,240,160,'High quality',false,0,work),/actual antialias sampling work budget/);assert.deepEqual(asset.bytes,before)
 const data=new Uint8Array([71,71,71,255]);const sample=sampleCropBicubic(data,1,1,-100,-100,{premultiplied:false,mask:true,background:93,footprint:[1.6,1.6],filter:'lanczos3'});for(let c=0;c<3;c++)assert.ok(Math.abs(sample[c]-93)<1e-10);assert.ok(Math.abs(sample[3]-255)<1e-10)
})
test('mechanism frozen before new ratio and quarter-turn native holdouts improves RGB and alpha without tuning parameters',()=>{
 const held=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-affine-holdout-alpha27.json',import.meta.url),'utf8'));assert.equal(held.source.sha256,fixture.source.sha256);assert.equal(held.cases.length,2)
 for(const reference of held.cases){const native=inflateSync(Buffer.from(reference.rgbaZlib,'base64')),actual=PNG.sync.read(perspectiveCropRaster(asset,placement,reference.corners,reference.width,reference.height,'High quality').bytes),result=difference(actual.data,native);assert.ok(result.mae<3.1);assert.ok(result.max<=43);assert.ok(result.alphaMAE<=.146);assert.ok(result.alphaMax<=11)}
})
