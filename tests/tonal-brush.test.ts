import test from 'node:test'
import assert from 'node:assert/strict'
import {tonalBrushPixels} from '../src/shared/tonal-brush'

test('dodge/burn only affect painted visible RGB and preserve exact alpha and unpainted bytes',()=>{
 const pixels=Uint8Array.from([80,100,120,128,64,64,64,255,91,12,44,0]),coverage=Uint8Array.from([255,0,255])
 const light=tonalBrushPixels(pixels,coverage,{kind:'dodge',amount:.5}),dark=tonalBrushPixels(pixels,coverage,{kind:'burn',amount:.5})
 assert.ok(light[0]>pixels[0]);assert.ok(dark[0]<pixels[0]);assert.equal(light[3],128);assert.equal(dark[3],128)
 assert.deepEqual(light.slice(4),pixels.slice(4));assert.deepEqual(dark.slice(4),pixels.slice(4));assert.equal(pixels[0],80)
})
test('range chooses shadows or highlights; repeated strokes accumulate and zero amount remains byte-exact',()=>{
 const pixels=Uint8Array.from([32,32,32,255,224,224,224,255]),coverage=Uint8Array.from([255,255]),shadow=tonalBrushPixels(pixels,coverage,{kind:'burn',amount:.5,range:'shadows'}),highlight=tonalBrushPixels(pixels,coverage,{kind:'burn',amount:.5,range:'highlights'})
 assert.ok(pixels[0]-shadow[0]>pixels[0]-highlight[0]);assert.ok(pixels[4]-highlight[4]>pixels[4]-shadow[4]);assert.ok(tonalBrushPixels(shadow,coverage,{kind:'burn',amount:.5,range:'shadows'})[0]<shadow[0]);assert.deepEqual(tonalBrushPixels(pixels,coverage,{kind:'dodge',amount:0}),pixels)
})
test('sponge desaturates toward luminance while vibrance keeps a fully saturated color in gamut',()=>{
 const pixels=Uint8Array.from([240,90,30,255,255,0,0,128,128,128,128,255]),coverage=Uint8Array.from([255,255,255]),gray=tonalBrushPixels(pixels,coverage,{kind:'sponge',mode:'desaturate',amount:1})
 assert.equal(gray[0],gray[1]);assert.equal(gray[1],gray[2]);assert.equal(gray[3],255);assert.equal(gray[7],128)
 const saturated=tonalBrushPixels(pixels,coverage,{kind:'sponge',mode:'saturate',amount:1,vibrance:true});assert.deepEqual(saturated.slice(4,8),pixels.slice(4,8));assert.deepEqual(saturated.slice(8),pixels.slice(8))
})
test('deep tonal edits retain low-order precision and HDR radiance outside the painted region',()=>{
 const deep=Uint16Array.from([20001,30003,10007,65535,19001,20003,21007,12345]),coverage=Uint8Array.from([128,0]),out=tonalBrushPixels(deep,coverage,{kind:'dodge',amount:.25})
 assert.ok(out instanceof Uint16Array);assert.ok(out[0]>deep[0]);assert.notEqual(out[0]%257,0);assert.deepEqual(out.slice(4),deep.slice(4))
 const hdr=Float32Array.from([2.7,.37,.83,.5,3.25,.19,.11,.7]),result=tonalBrushPixels(hdr,coverage,{kind:'sponge',mode:'desaturate',amount:.3});assert.ok(result instanceof Float32Array);assert.ok(result[0]>1);assert.equal(result[3],hdr[3]);assert.deepEqual(result.slice(4),hdr.slice(4))
})
test('invalid input or cancellation fails without editing the source',()=>{
 const pixels=Uint8Array.from([80,100,120,128]);assert.throws(()=>tonalBrushPixels(pixels,Uint8Array.of(255),{kind:'burn',amount:NaN}));assert.throws(()=>tonalBrushPixels(pixels,Uint8Array.of(255),{kind:'burn',amount:.5,cancelled:()=>true}),/cancelled/);assert.deepEqual([...pixels],[80,100,120,128])
})
test('Buffer-backed PNG pixels never alias a tonal preview',()=>{
 const source=Buffer.from([80,100,120,128]),out=tonalBrushPixels(source,Uint8Array.of(255),{kind:'dodge',amount:.5})
 assert.ok(out[0]>source[0]);assert.deepEqual([...source],[80,100,120,128]);out[0]=0;assert.equal(source[0],80)
})
test('HDR saturation overflow is rejected atomically instead of creating infinity',()=>{
 const source=Float32Array.from([3e38,1e36,1e36,1]),before=new Float32Array(source)
 assert.throws(()=>tonalBrushPixels(source,Uint8Array.of(255),{kind:'sponge',mode:'saturate',amount:1,vibrance:false}),/finite HDR range/);assert.deepEqual(source,before)
})
