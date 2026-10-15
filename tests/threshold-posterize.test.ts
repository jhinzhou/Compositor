import test from 'node:test'
import assert from 'node:assert/strict'
import {applyImageFilter,defaultFilter,imageFilterSchema,specToNativeAdjustment} from '../src/shared/image-filters'
import {applyDeepColorFilter} from '../src/shared/deep-color-filters'
import {applyHDRColorFilter} from '../src/shared/hdr-pixels'
import {assertHighDepthFilterSupported} from '../src/core/high-depth-filter'
import {EditorError} from '../src/shared/contracts'

test('discrete adjustments have independent validated settings and no fictional native adjustment record',()=>{
 assert.deepEqual(defaultFilter('threshold'),{kind:'threshold',level:128})
 assert.deepEqual(defaultFilter('posterize'),{kind:'posterize',levels:4})
 for(const input of [{kind:'threshold',level:0},{kind:'threshold',level:256},{kind:'threshold',level:127.5},{kind:'posterize',levels:1},{kind:'posterize',levels:256},{kind:'posterize',levels:3.5},{kind:'threshold',level:NaN}])assert.equal(imageFilterSchema.safeParse(input).success,false)
 for(const kind of ['threshold','posterize'])assert.throws(()=>specToNativeAdjustment({kind}),/not a native adjustment/)
})
test('Threshold compares combined brightness, includes the cutoff, preserves alpha and hidden RGB',()=>{
 const image={width:6,height:1,data:Uint8ClampedArray.from([255,0,0,91,0,255,0,137,127,127,127,255,128,128,128,255,255,255,255,255,23,47,89,0])},copy=image.data.slice()
 assert.deepEqual([...applyImageFilter(image,{kind:'threshold'}).data],[0,0,0,91,255,255,255,137,0,0,0,255,255,255,255,255,255,255,255,255,23,47,89,0])
 assert.deepEqual(image.data,copy)
})
test('Posterize quantizes each RGB channel independently and selection blends premultiplied color',()=>{
 const image={width:3,height:1,data:Uint8ClampedArray.from([42,43,213,107,100,180,240,255,27,57,87,0])}
 assert.deepEqual([...applyImageFilter(image,{kind:'posterize',levels:4}).data],[0,0,255,107,85,170,255,255,27,57,87,0])
 const selected=applyImageFilter(image,{kind:'posterize',levels:4},new Uint8Array([0,128,0]))
 assert.deepEqual(selected.data.subarray(0,4),image.data.subarray(0,4));assert.equal(selected.data[4],92);assert.equal(selected.data[7],255)
})
test('Threshold16 decides adjacent source values with identical PNG8 preview, without changing alpha',()=>{
 const pixels=new Uint16Array([32895,32895,32895,65535,32896,32896,32896,65535,25103,25103,25103,50009,0,0,0,0]),copy=pixels.slice()
 assert.equal(Math.round(pixels[0]/257),Math.round(pixels[4]/257))
 assert.deepEqual(applyDeepColorFilter(pixels,4,1,{kind:'threshold'}),new Uint16Array([0,0,0,65535,65535,65535,65535,65535,50009,50009,50009,50009,0,0,0,0]))
 assert.deepEqual(pixels,copy)
})
test('Posterize16 resolves between-preview level boundaries and repremultiplies against the exact alpha',()=>{
 const pixels=new Uint16Array([21844,21845,43691,65535,16669,16670,33339,50009]),copy=pixels.slice()
 assert.equal(Math.round(pixels[0]/257),Math.round(pixels[1]/257))
 assert.deepEqual(applyDeepColorFilter(pixels,2,1,{kind:'posterize',levels:3}),new Uint16Array([0,32768,65535,65535,0,25005,25005,50009]))
 assert.deepEqual(pixels,copy)
})
test('both discrete adjustments reject HDR before normalization and preserve negative and overwhite samples',()=>{
 const source=new Float32Array([-0.125,3.125,0.5001,.8]),copy=source.slice()
 for(const kind of ['threshold','posterize']){
  const check=(error:unknown)=>error instanceof EditorError&&error.code==='UNSUPPORTED_FEATURE'
  assert.throws(()=>applyHDRColorFilter(source,1,1,{kind}),check)
  assert.throws(()=>assertHighDepthFilterSupported({kind},true),check)
  assert.deepEqual(source,copy)
 }
})
