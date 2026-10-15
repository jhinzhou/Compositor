import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {decodePhotoshop} from '../src/core/photoshop-io'
import {photoshopChannelFixture} from '../scripts/fixtures/photoshop-channel-fixtures'
import {createHash} from 'node:crypto'

// Independently authored Adobe PSD channel bytes, no ag-psd writer.
const pixels=(document:ReturnType<typeof decodePhotoshop>)=>PNG.sync.read(document.assets.get(document.manifest.layers[0].imageFile!)!.bytes).data
const straight16=(document:ReturnType<typeof decodePhotoshop>)=>PNG.sync.read(document.assets.get(document.manifest.layers[0].imageFile!)!.bytes,{skipRescale:true}).data
test('independent RGB16 PackBits and raw channels retain original straight RGBA16 including hidden RGB',()=>{
 const raw=decodePhotoshop(photoshopChannelFixture()),rle=decodePhotoshop(photoshopChannelFixture({mode:'rle'}))
 assert.deepEqual([...straight16(raw)],[65535,32768,0,0,257,65535,32896,65535])
 assert.deepEqual([...straight16(rle)],[...straight16(raw)])
 assert.equal(rle.manifest.version,12);assert.equal(rle.assets.get(rle.manifest.layers[0].imageFile!)!.bitDepth,16)
 assert.ok(rle.warnings.some(warning=>warning.includes('retained as PNG16')))
 assert.ok(rle.warnings.some(warning=>warning.includes('masks remain 8-bit')))
 assert.ok(rle.warnings.some(warning=>warning.includes('export remains 8-bit')))
})
test('valid16 RLE and NOP rows in PSD/PSB preserve input bytes and quantize multiple rows identically',()=>{
 for(const psb of [false,true]){
  const raw=photoshopChannelFixture({width:3,height:2,psb}),original=Buffer.from(raw),reference=straight16(decodePhotoshop(raw));assert.deepEqual(raw,original)
  for(const mode of ['rle','rle-nop'] as const){const bytes=photoshopChannelFixture({width:3,height:2,mode,psb}),before=createHash('sha256').update(bytes).digest('hex');assert.deepEqual(straight16(decodePhotoshop(bytes)),reference);assert.equal(createHash('sha256').update(bytes).digest('hex'),before)}
 }
})
test('odd8 raw row padding, RLE padding and NOP decode to the same actual pixels in PSD/PSB',()=>{
 for(const psb of [false,true]){
  const reference=pixels(decodePhotoshop(photoshopChannelFixture({width:3,height:2,depth:8,psb})))
  for(const mode of ['raw-row-pad','rle','rle-row-pad','rle-nop'] as const){const bytes=photoshopChannelFixture({width:3,height:2,depth:8,mode,psb}),before=Buffer.from(bytes);assert.deepEqual(pixels(decodePhotoshop(bytes)),reference);assert.deepEqual(bytes,before)}
 }
})
