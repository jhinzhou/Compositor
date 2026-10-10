import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {CameraRawPreviewBrightnessCache,type CameraRawPreviewSourceKey} from '../src/core/camera-raw-preview-cache'
import {cameraRawBrightness} from '../src/shared/camera-raw-adaptive'
import {filterRaster} from '../src/core/filter-edit'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
const placement={origin:[0,0] as [number,number],size:[4,2] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'Nearest' as const}
function source(){const png=blankPNG(4,2);for(let i=0;i<8;i++)png.data.set([30+i*25,180-i*13,50+i*7,i===7?0:128+i*18],i*4);return png}
const identity=(bytes:Buffer,sourceVersion='same'):CameraRawPreviewSourceKey=>({sessionId:'session',layerId:'layer',hash:createHash('sha256').update(bytes).digest('hex'),width:4,height:2,sourceVersion})
test('freshly decoded PNGs and changing Camera Raw sliders reuse one source measurement while preview remains byte-equal to uncached filter results',()=>{
 let measured=0;const cache=new CameraRawPreviewBrightnessCache(4,image=>{measured++;return cameraRawBrightness(image)}),encoded=encodeRaster(source()),key=identity(encoded)
 for(const filter of [{kind:'cameraRaw',contrast:10},{kind:'cameraRaw',contrast:-50,highlights:20},{kind:'cameraRaw',shadows:60},{kind:'cameraRaw',exposure:1,contrast:25}]){const png=PNG.sync.read(encoded),brightness=cache.get(key,{width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)}),expected=filterRaster(png,placement,null,filter),actual=filterRaster(PNG.sync.read(encoded),placement,null,filter,{knownBrightness:brightness});assert.deepEqual(actual.png.data,expected.png.data);assert.deepEqual(actual.transform,expected.transform)}
 assert.equal(measured,1);assert.equal(cache.size,1)
})
test('source hashes, selection/crop versions, dimensions and session changes invalidate scalar statistics and bounded LRU does not retain old surfaces',()=>{
 let measured=0;const cache=new CameraRawPreviewBrightnessCache(2,image=>{measured++;return cameraRawBrightness(image)}),png=source(),image={width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},key=identity(encodeRaster(png)),first=cache.get(key,image);first.brightest=0;assert.notEqual(cache.get(key,image).brightest,0)
 cache.get({...key,sourceVersion:'selection/crop-changed'},image);assert.equal(measured,2);cache.get(key,image);assert.equal(measured,2)
 const changed={...image,data:new Uint8ClampedArray(image.data)};changed.data[0]=250;cache.get({...key,hash:'different-pixel-hash'},changed);assert.equal(measured,3);assert.equal(cache.size,2)
 cache.get({...key,sourceVersion:'selection/crop-changed'},image);assert.equal(measured,4);cache.get({...key,sessionId:'other-session'},image);assert.equal(measured,5)
 const resized={width:2,height:4,data:new Uint8ClampedArray(image.data)};cache.get({...key,width:2,height:4},resized);assert.equal(measured,6);assert.equal(cache.size,2)
 assert.throws(()=>cache.get(key,resized),/dimensions changed/);assert.throws(()=>new CameraRawPreviewBrightnessCache(0));assert.throws(()=>new CameraRawPreviewBrightnessCache(17))
})
