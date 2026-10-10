import test from 'node:test'
import assert from 'node:assert/strict'
import {SubjectPreviewCache,SUBJECT_PREVIEW_CACHE_MAX_BYTES,type SubjectPreviewKey,type SubjectPreviewSource} from '../src/main/subject-preview-cache'
const key:SubjectPreviewKey={sessionId:'session',documentId:'document',revision:1,layerId:'layer',removeBackground:false,sampleAllLayers:true}
const source=():SubjectPreviewSource=>({image:{width:2,height:1,data:new Uint8Array(8)},coarse:{width:2,height:1,coverage:new Uint8Array([120,255])},space:'document'})
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve))

test('same source shares one in-flight Promise and completed coarse source across matte settings',async()=>{
 const cache=new SubjectPreviewCache(),job=deferred<SubjectPreviewSource>();let calls=0
 const load=async()=>{calls++;return job.promise},a=cache.get(key,load),b=cache.get({...key,matteContrast:70} as SubjectPreviewKey,load)
 assert.equal(a,b);await tick();assert.equal(calls,1)
 const value=source();job.resolve(value);assert.equal(await a,value)
 assert.equal(await cache.get(key,load),value);assert.equal(calls,1);assert.deepEqual(cache.stats(),{entries:1,bytes:10,inFlight:false});cache.invalidate()
})
test('revision and every source field invalidate; box and point tuples are copied into identity',async()=>{
 const cache=new SubjectPreviewCache();let calls=0
 const loader=async()=>{calls++;return source()}
 const initial={...key,box:[0,0,2,1] as [number,number,number,number],point:[.5,.5] as [number,number]}
 await cache.get(initial,loader);initial.box[0]=1;await cache.get(initial,loader);assert.equal(calls,2)
 for(const change of [{revision:2},{sessionId:'second'},{documentId:'second'},{layerId:'second'},{removeBackground:true},{sampleAllLayers:false},{box:[1,0,1,1] as [number,number,number,number]},{point:[1.5,.5] as [number,number]}])await cache.get({...key,...change},loader)
 assert.equal(calls,10);cache.invalidate()
})
test('supersession rejects immediately, waits for uninterruptible loader and refuses late result resurrection',async()=>{
 const cache=new SubjectPreviewCache(),old=deferred<SubjectPreviewSource>(),next=deferred<SubjectPreviewSource>();let oldSignal:AbortSignal|undefined,newCalls=0
 const a=cache.get(key,async signal=>{oldSignal=signal;return old.promise}),aRejected=assert.rejects(a,error=>(error as {code:string}).code==='CANCELED')
 await tick();const b=cache.get({...key,revision:2},async()=>{newCalls++;return next.promise})
 await aRejected;assert.equal(oldSignal?.aborted,true);await tick();assert.equal(newCalls,0)
 old.resolve(source());await tick();assert.equal(newCalls,1);assert.equal(cache.stats().inFlight,true)
 const value=source();next.resolve(value);assert.equal(await b,value);assert.equal(cache.stats().entries,1);cache.invalidate()
})
test('failed and invalid loader results are removed and a retry executes a fresh inference',async()=>{
 const cache=new SubjectPreviewCache();let calls=0
 await assert.rejects(cache.get(key,async()=>{calls++;throw new Error('MODEL_BUSY')}),/MODEL_BUSY/)
 assert.equal(cache.stats().entries,0)
 await assert.rejects(cache.get(key,async()=>({...source(),coarse:{width:3,height:1,coverage:new Uint8Array(3)}})),/Invalid/)
 assert.equal(cache.stats().entries,0);await cache.get(key,async()=>{calls++;return source()});assert.equal(calls,2);cache.invalidate()
})
test('external cancel aborts only the matching entry and an obsolete signal cannot evict a completed source',async()=>{
 const cache=new SubjectPreviewCache(),cancel=new AbortController(),job=deferred<SubjectPreviewSource>();let signal:AbortSignal|undefined
 const promise=cache.get(key,async input=>{signal=input;return job.promise},cancel.signal),rejected=assert.rejects(promise,/canceled/)
 await tick();cancel.abort();await rejected;assert.equal(signal?.aborted,true);assert.equal(cache.stats().entries,0)
 job.resolve(source());await tick();const later=new AbortController();await cache.get(key,async()=>source(),later.signal);later.abort();assert.equal(cache.stats().entries,1);cache.invalidate()
})
test('oversized retained backing buffers bypass caching without truncating a usable result',async()=>{
 const cache=new SubjectPreviewCache({byteBudget:16}),value=source();value.image.data=new Uint8Array(100).subarray(0,8)
 const returned=await cache.get(key,async()=>value);assert.equal(returned,value);assert.equal(returned.image.data.byteLength,8);assert.equal(cache.stats().entries,0)
 assert.throws(()=>new SubjectPreviewCache({byteBudget:SUBJECT_PREVIEW_CACHE_MAX_BYTES+1}),/budget/)
})
test('idle expiry releases the source and the next request reloads',async()=>{
 const cache=new SubjectPreviewCache({ttlMs:10});let calls=0
 const loader=async()=>{calls++;return source()}
 await cache.get(key,loader);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(cache.stats().entries,0)
 await cache.get(key,loader);assert.equal(calls,2);cache.invalidate()
})

test('pending sources expire and cannot repopulate the cache when a late loader completes',async()=>{
 const cache=new SubjectPreviewCache({ttlMs:10}),job=deferred<SubjectPreviewSource>();let signal:AbortSignal|undefined
 const rejected=assert.rejects(cache.get(key,async input=>{signal=input;return job.promise}),/canceled/)
 await new Promise(resolve=>setTimeout(resolve,30));await rejected;assert.equal(signal?.aborted,true);assert.equal(cache.stats().entries,0)
 job.resolve(source());await tick();assert.equal(cache.stats().entries,0)
})
test('a canceled queued source never starts its loader after the preceding job settles',async()=>{
 const cache=new SubjectPreviewCache(),old=deferred<SubjectPreviewSource>();let calls=0
 const a=cache.get(key,async()=>old.promise),aRejected=assert.rejects(a,/canceled/);await tick()
 const b=cache.get({...key,revision:2},async()=>{calls++;return source()}),bRejected=assert.rejects(b,/canceled/)
 cache.invalidate();await Promise.all([aRejected,bRejected]);old.resolve(source());await tick();assert.equal(calls,0);assert.equal(cache.stats().entries,0)
})
test('late cancellation from another document cannot cancel the current source',async()=>{
 const cache=new SubjectPreviewCache(),job=deferred<SubjectPreviewSource>();let signal:AbortSignal|undefined
 const pending=cache.get(key,async input=>{signal=input;return job.promise});await tick()
 assert.equal(cache.invalidateSession('old-session'),false);assert.equal(signal?.aborted,false);assert.equal(cache.stats().inFlight,true)
 const rejected=assert.rejects(pending,/canceled/);assert.equal(cache.invalidateSession(key.sessionId),true);await rejected;assert.equal(signal?.aborted,true)
 job.resolve(source());await tick();assert.equal(cache.stats().entries,0)
})
