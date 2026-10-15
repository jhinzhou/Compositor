import test from 'node:test'
import assert from 'node:assert/strict'
import {assertCameraRawShadowsBudget,cameraRawShadows} from '../src/shared/camera-raw-shadows'
import {EditorError} from '../src/shared/contracts'
test('Shadows working-budget math rejects oversized full-resolution and skinny surfaces without allocating their pixels',()=>{
 assert.doesNotThrow(()=>assertCameraRawShadowsBudget(3200,2400))
 for(const [width,height] of [[8192,8192],[30_000,2000],[1,20_000_000]])assert.throws(()=>assertCameraRawShadowsBudget(width,height),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT'&&error.message.includes('512 MiB'))
 for(const [width,height] of [[0,1],[1.5,1],[NaN,1]])assert.throws(()=>assertCameraRawShadowsBudget(width,height),error=>error instanceof EditorError&&error.code==='INVALID_ARGUMENT')
})
test('Straight Shadows wrapper rejects before conversion-length access; zero Shadows remains a free immutable no-op',()=>{
 // A metadata-only surface proves ordering without a giant array. Validation
 // reads length once. A second read would reach conversion allocation and fail
 // before allocating, so the old misplaced guard cannot pass this test.
 const width=8192,height=8192;let reads=0
 const data={get length(){if(++reads>1)throw Error('Reached full-size conversion allocation');return width*height*4}} as Uint8ClampedArray
 assert.throws(()=>cameraRawShadows({width,height,data},50),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.equal(reads,1)
 let zeroReads=0;const zero={width,height,data:{get length(){zeroReads++;return width*height*4}} as Uint8ClampedArray};assert.strictEqual(cameraRawShadows(zero,0),zero);assert.equal(zeroReads,1)
})
