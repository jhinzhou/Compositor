import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RasterStrokePreview} from '../src/renderer/raster-stroke-preview'
const tick=()=>new Promise<void>(resolve=>queueMicrotask(resolve))
test('stroke previews serialize, skip obsolete queued points and publish only the latest snapshot',async()=>{
 const calls:number[]=[],results:number[]=[],resolvers:((value:number)=>void)[]=[]
 const preview=new RasterStrokePreview<number,number>(async value=>{calls.push(value);return await new Promise(resolve=>resolvers.push(resolve))},value=>results.push(value),undefined,123)
 preview.update(1);preview.update(2);preview.update(3);assert.deepEqual(calls,[1]);assert.equal(preview.pending,true)
 resolvers[0](1);await tick();assert.deepEqual(calls,[1,3]);assert.deepEqual(results,[])
 resolvers[1](3);await tick();assert.deepEqual(results,[3]);assert.equal(preview.pending,false);assert.equal(preview.seed,123)
})
test('cancel discards queued input, async output and late failures',async()=>{
 let resolve!:(value:number)=>void,reject!:(error:Error)=>void
 const outputs:number[]=[],errors:unknown[]=[]
 const first=new RasterStrokePreview<number,number>(async()=>new Promise(res=>{resolve=res}),value=>outputs.push(value),error=>errors.push(error))
 first.update(1);first.update(2);first.cancel();resolve(1);await tick();assert.equal(outputs.length,0);assert.equal(first.pending,false)
 const second=new RasterStrokePreview<number,number>(async()=>new Promise((_res,rej)=>{reject=rej}),value=>outputs.push(value),error=>errors.push(error))
 second.update(1);second.cancel();reject(new Error('canceled'));await tick();assert.equal(errors.length,0)
})
test('recoverable preview failure does not stall subsequent points',async()=>{
 const errors:unknown[]=[],outputs:number[]=[]
 const preview=new RasterStrokePreview<number,number>(async value=>{if(value===1)throw new Error('surface');return value},value=>outputs.push(value),error=>errors.push(error))
 preview.update(1);await tick();preview.update(2);await tick();assert.equal(errors.length,1);assert.deepEqual(outputs,[2])
})

test('invalidating an open dialog drops its old completion and allows a fresh generation',async()=>{
 const pending:{resolve:(n:number)=>void}[]=[],values:number[]=[]
 const scheduler=new RasterStrokePreview<number,number>(()=>new Promise(resolve=>pending.push({resolve})),value=>values.push(value))
 scheduler.update(1);scheduler.invalidate();scheduler.update(2);pending[0].resolve(1);await new Promise(resolve=>setTimeout(resolve,0));pending[1].resolve(2);await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(values,[2])
})
