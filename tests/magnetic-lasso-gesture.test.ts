import test from 'node:test'
import assert from 'node:assert/strict'
import {ref} from 'vue'
import {Editor} from '../src/core/editor'
import type {EditorState} from '../src/shared/contracts'
import {useMagneticLasso,type MagneticGestureOptions,type MagneticPoint} from '../src/renderer/use-magnetic-lasso'
function event(x:number,y:number,more:Partial<MouseEvent>={}):MouseEvent{return {button:0,detail:1,clientX:x,clientY:y,shiftKey:false,altKey:false,buttons:0,...more} as MouseEvent}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j});return {resolve,reject,promise}}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve))
function setup(extra?:Partial<MagneticGestureOptions>){
 const editor=new Editor();editor.create(100,80)
 const state=ref<EditorState|undefined>(editor.state()),selectedId=ref<string|undefined>('sample-layer'),calls:{method:string;params:any}[]=[],commits:{identity:unknown;points:MagneticPoint[];operation:string}[]=[]
 const options:MagneticGestureOptions={state,selectedId,options:()=>({width:24,contrast:.1,frequency:20,sampleAllLayers:false}),canStart:()=>true,point:evt=>[evt.clientX,evt.clientY],identity:()=>({...editor.identity()}),send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});if(method==='interaction')return {busy:(params as {busy:boolean}).busy} as T;return {points:[[10.5,10.5],[30.5,10.5],[30.5,30.5],[10.5,30.5],...(params as {closed:boolean}).closed?[[10.5,10.5]]:[]]} as T},commit:async(identity,points,operation)=>{commits.push({identity,points,operation})},...extra}
 const gesture=useMagneticLasso(options);return {gesture,options,state,selectedId,calls,commits}
}
test('Magnetic gesture tracks hover movement, captures modifiers once, and commits one closed result under one lease',async()=>{
 const {gesture,calls,commits}=setup();await gesture.start(event(10,10,{shiftKey:true}));assert.equal(gesture.active.value,true)
 gesture.move(event(30,10,{buttons:0,altKey:true}));await tick();assert.ok(calls.some(call=>call.method==='magneticLassoPreview'));assert.equal(gesture.points.value.length,4)
 await gesture.start(event(30,30));await gesture.finish();assert.equal(commits.length,1);assert.equal(commits[0].operation,'add');assert.equal(commits[0].points.length,5);assert.deepEqual(commits[0].points[0],commits[0].points.at(-1));assert.equal(gesture.active.value,false)
 const leases=calls.filter(call=>call.method==='interaction');assert.deepEqual(leases.map(call=>call.params.busy),[true,false]);assert.equal(leases[0].params.interactionId,leases[1].params.interactionId);gesture.dispose()
})
test('Cancel while lease acquisition is pending eventually releases exactly the acquired lease without preview or commit',async()=>{
 const acquiring=deferred<{busy:boolean}>(),calls:{method:string;params:any}[]=[],{gesture,commits}=setup({send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});if((params as {busy?:boolean})?.busy)return acquiring.promise as Promise<T>;return {busy:false} as T}})
 const start=gesture.start(event(10,10));const cancel=gesture.finish(true);assert.equal(gesture.active.value,false);acquiring.resolve({busy:true});await Promise.all([start,cancel]);assert.deepEqual(calls.map(call=>call.params.busy),[true,false]);assert.equal(commits.length,0);gesture.dispose()
})
test('Preview replies are coalesced and stale tickets never replace the snapped path',async()=>{
 const pending=deferred<{points:MagneticPoint[]}>();let previews=0
 const {gesture}=setup({send:async<T>(method:string,params?:unknown)=>{if(method==='interaction')return {busy:(params as {busy:boolean}).busy} as T;if(++previews===1)return pending.promise as Promise<T>;return {points:[[50.5,10.5],[60.5,10.5]]} as T}})
 await gesture.start(event(10,10));gesture.move(event(30,10));await tick();gesture.move(event(50,10));gesture.move(event(60,10));assert.equal(previews,1)
 pending.resolve({points:[[20.5,10.5],[30.5,10.5]]});await tick();await tick();assert.equal(previews,2);assert.deepEqual(gesture.points.value,[[50.5,10.5],[60.5,10.5]]);await gesture.finish(true);gesture.dispose()
})
test('Document revision, session and selected-layer changes cancel instead of committing old image analysis',async()=>{
 for(const change of ['revision','session','layer']){
  const {gesture,state,selectedId,commits,calls}=setup();await gesture.start(event(10,10));gesture.move(event(30,10));await tick()
  if(change==='revision')state.value={...state.value!,revision:state.value!.revision+1};else if(change==='session')state.value={...state.value!,sessionId:'other-session'};else selectedId.value='other-layer'
  assert.equal(gesture.active.value,false);await tick();await gesture.finish();assert.equal(commits.length,0);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1);gesture.dispose()
 }
})
test('Backspace removes the previous sampled anchor and its following segment; returning to the first anchor clears stale preview',async()=>{
 const {gesture,calls}=setup();await gesture.start(event(10,10));await gesture.start(event(30,10));await gesture.start(event(30,30));await tick();gesture.backspace();await tick()
 const last=calls.filter(call=>call.method==='magneticLassoPreview').at(-1)!;assert.deepEqual(last.params.points,[[10,10],[30,10]])
 gesture.backspace();assert.deepEqual(gesture.points.value,[[10,10]]);gesture.backspace();assert.equal(gesture.active.value,false);await tick();gesture.dispose()
})
test('Canvas coordinates are clamped and overflow cancels the full gesture instead of silently dropping points',async()=>{
 const {gesture,calls,commits}=setup({options:()=>({width:24,contrast:.1,frequency:100,sampleAllLayers:false})});await gesture.start(event(-50,-10));gesture.move(event(500,500));await tick();const first=calls.find(call=>call.method==='magneticLassoPreview')!;assert.deepEqual(first.params.points[0],[0,0]);assert.ok(first.params.points[1][0]<100&&first.params.points[1][1]<80)
 for(let i=0;i<4200;i++)gesture.move(event(i%2?10:90,40));assert.equal(gesture.active.value,false);await tick();assert.equal(commits.length,0);gesture.dispose()
})
test('Double-click finishes once; repeated finish calls share the pending final result',async()=>{
 const closed=deferred<{points:MagneticPoint[]}>();let closedCalls=0
 const {gesture,commits}=setup({send:async<T>(method:string,params?:unknown)=>{if(method==='interaction')return {busy:(params as {busy:boolean}).busy} as T;if((params as {closed:boolean}).closed){closedCalls++;return closed.promise as Promise<T>}return {points:[[10,10],[30,30]]} as T}})
 await gesture.start(event(10,10));gesture.move(event(30,30));await tick();const finish=gesture.start(event(30,30,{detail:2})),repeat=gesture.finish();await tick();assert.equal(closedCalls,1);closed.resolve({points:[[10,10],[30,10],[30,30],[10,10]]});await Promise.all([finish,repeat]);assert.equal(commits.length,1);gesture.dispose()
})
test('Invalid preview, rejected lease and empty/collinear final paths never write history and release leases',async()=>{
 for(const failure of ['lease','preview','collinear']){
  const {gesture,commits,calls}=setup({send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});if(method==='interaction')return (failure==='lease'&&(params as {busy:boolean}).busy?undefined:{busy:(params as {busy:boolean}).busy}) as T|undefined;if(failure==='preview')return undefined;return {points:[[10,10],[20,20],[30,30],[10,10]]} as T}})
  await gesture.start(event(10,10));gesture.move(event(30,30));await tick();await gesture.finish();assert.equal(commits.length,0);assert.equal(gesture.active.value,false);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1);gesture.dispose()
 }
})
test('Window blur cancels and releases the lease without waiting for a pending preview reply',async()=>{
 const original=globalThis.window,listeners=new Map<string,()=>void>();(globalThis as any).window={addEventListener:(type:string,listener:()=>void)=>listeners.set(type,listener),removeEventListener:(type:string)=>listeners.delete(type)}
 try{
  const preview=deferred<{points:MagneticPoint[]}>(),calls:{method:string;params:any}[]=[]
  const {gesture,commits}=setup({send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});return method==='interaction'?{busy:(params as {busy:boolean}).busy} as T:preview.promise as Promise<T>}})
  await gesture.start(event(10,10));gesture.move(event(30,30));await tick();listeners.get('blur')!();await tick();assert.equal(gesture.active.value,false);assert.equal(commits.length,0);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1)
  preview.resolve({points:[[10,10],[30,30]]});await tick();assert.deepEqual(gesture.points.value,[]);gesture.dispose();assert.equal(listeners.has('blur'),false)
 }finally{(globalThis as any).window=original}
})
test('Canceling a pending final closed preview releases the lease and cannot commit its late result',async()=>{
 const closed=deferred<{points:MagneticPoint[]}>();let requested=false
 const {gesture,commits,calls}=setup({send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});if(method==='interaction')return {busy:(params as {busy:boolean}).busy} as T;if((params as {closed:boolean}).closed){requested=true;return closed.promise as Promise<T>}return {points:[[10,10],[30,10],[30,30]]} as T}})
 await gesture.start(event(10,10));gesture.move(event(30,10));await gesture.start(event(30,30));await tick();const finishing=gesture.finish();await tick();assert.equal(requested,true);await gesture.finish(true);assert.equal(gesture.active.value,false);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1)
 closed.resolve({points:[[10,10],[30,10],[30,30],[10,10]]});await finishing;assert.equal(commits.length,0);assert.deepEqual(gesture.points.value,[]);gesture.dispose()
})
test('Cancel during a commit keeps its lease until settlement and prevents a competing gesture',async()=>{
 const committing=deferred<void>();let writes=0
 const {gesture,calls}=setup({commit:async()=>{writes++;await committing.promise}})
 await gesture.start(event(10,10));gesture.move(event(30,10));await gesture.start(event(30,30));await tick();const finishing=gesture.finish();await tick();assert.equal(writes,1)
 const cancel=gesture.finish(true);await gesture.start(event(15,15));assert.equal(gesture.active.value,false);assert.equal(calls.filter(call=>call.method==='interaction'&&call.params.busy).length,1);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,0)
 committing.resolve();await Promise.all([finishing,cancel]);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1);gesture.dispose()
})
test('A noncollinear self-crossing magnetic selection can commit even when its signed areas cancel',async()=>{
 const {gesture,commits}=setup({send:async<T>(method:string,params?:unknown)=>method==='interaction'?{busy:(params as {busy:boolean}).busy} as T:{points:[[10,10],[30,30],[30,10],[10,30],[10,10]]} as T})
 await gesture.start(event(10,10));gesture.move(event(30,30));await tick();await gesture.finish();assert.equal(commits.length,1);assert.deepEqual(commits[0].points,[[10,10],[30,30],[30,10],[10,30],[10,10]]);assert.equal(gesture.active.value,false);gesture.dispose()
})
test('Current open and closed readonly preview failures remain visible and release the lease without committing',async()=>{
 for(const stage of ['open','closed']){
  const errors:string[]=[],calls:{method:string;params:any}[]=[]
  const {gesture,commits}=setup({onError:message=>errors.push(message),send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});if(method==='interaction')return {busy:(params as {busy:boolean}).busy} as T;if(stage==='open'||(params as {closed:boolean}).closed)throw new Error(`RESOURCE_LIMIT: current ${stage} preview`);return {points:[[10,10],[30,10],[30,30]]} as T}})
  await gesture.start(event(10,10));gesture.move(event(30,30));await tick();await gesture.finish()
  assert.deepEqual(errors,[`RESOURCE_LIMIT: current ${stage} preview`]);assert.equal(gesture.active.value,false);assert.equal(commits.length,0);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1);gesture.dispose()
 }
})
test('Escape suppresses late rejected open and closed readonly previews while releasing the lease exactly once',async()=>{
 for(const stage of ['open','closed']){
  const pending=deferred<{points:MagneticPoint[]}>(),errors:string[]=[],calls:{method:string;params:any}[]=[];let requested=false
  const {gesture,commits}=setup({onError:message=>errors.push(message),send:async<T>(method:string,params?:unknown)=>{calls.push({method,params});if(method==='interaction')return {busy:(params as {busy:boolean}).busy} as T;if(stage==='open'||(params as {closed:boolean}).closed){requested=true;return pending.promise as Promise<T>}return {points:[[10,10],[30,10],[30,30]]} as T}})
  await gesture.start(event(10,10));gesture.move(event(30,30));await tick();const finishing=stage==='closed'?gesture.finish():Promise.resolve();await tick();assert.equal(requested,true)
  await gesture.finish(true);pending.reject(new Error('REVISION_CONFLICT: obsolete preview'));await finishing;await tick()
  assert.deepEqual(errors,[]);assert.equal(gesture.active.value,false);assert.equal(commits.length,0);assert.equal(calls.filter(call=>call.method==='interaction'&&!call.params.busy).length,1);gesture.dispose()
 }
})
test('A revision change suppresses rejection from the obsolete final preview rather than showing an error on the new document state',async()=>{
 const pending=deferred<{points:MagneticPoint[]}>(),errors:string[]=[]
 const {gesture,state,commits}=setup({onError:message=>errors.push(message),send:async<T>(method:string,params?:unknown)=>method==='interaction'?{busy:(params as {busy:boolean}).busy} as T:(params as {closed:boolean}).closed?pending.promise as Promise<T>:{points:[[10,10],[30,10],[30,30]]} as T})
 await gesture.start(event(10,10));gesture.move(event(30,30));await tick();const finishing=gesture.finish();await tick()
 state.value={...state.value!,revision:state.value!.revision+1};assert.equal(gesture.active.value,false);pending.reject(new Error('SNAPSHOT_EXPIRED: old revision'));await finishing
 assert.deepEqual(errors,[]);assert.equal(commits.length,0);gesture.dispose()
})
test('An obsolete hover ticket failure cancels safely without publishing its error over a newer pointer position',async()=>{
 const pending=deferred<{points:MagneticPoint[]}>(),errors:string[]=[]
 const {gesture,commits}=setup({onError:message=>errors.push(message),send:async<T>(method:string,params?:unknown)=>method==='interaction'?{busy:(params as {busy:boolean}).busy} as T:pending.promise as Promise<T>})
 await gesture.start(event(10,10));gesture.move(event(30,10));await tick();gesture.move(event(50,30));pending.reject(new Error('RESOURCE_LIMIT: old hover ticket'));await tick()
 assert.deepEqual(errors,[]);assert.equal(gesture.active.value,false);assert.equal(commits.length,0);gesture.dispose()
})
