import {strict as assert} from 'node:assert'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {effectScope,ref} from 'vue'
import type {EditorState} from '../src/shared/contracts'
import {emptyDocumentInfo,type DocumentInfo} from '../src/shared/document-info'
import {useInfoTools,type InfoToolOptions} from '../src/renderer/use-info-tools'
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}
function pointer(x:number,y:number,extra:Partial<PointerEvent>={}):PointerEvent{return {button:0,pointerId:7,clientX:x,clientY:y,altKey:false,shiftKey:false,currentTarget:null,preventDefault(){},...extra} as PointerEvent}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}
function fixture(info:DocumentInfo=emptyDocumentInfo(),custom?:(method:string,params:any)=>Promise<unknown>){
 const state=ref<EditorState>({sessionId:randomUUID(),revision:4,title:'gesture',modified:false,canUndo:false,canRedo:false,warnings:[],assets:[],activity:[],manifest:{format:'com.compositor.project',version:13,colorSpace:'sRGB',documentID:randomUUID(),width:100,height:80,resolution:72,layers:[],documentInfo:info}})
 const selectedId=ref<string>(),tool=ref('color-sampler'),calls:{method:string;params:any}[]=[],scope=effectScope();let counter=0
 const options:InfoToolOptions={state,selectedId,tool,canStart:()=>true,point:event=>[event.clientX,event.clientY],identity:()=>({sessionId:state.value.sessionId,documentId:state.value.manifest.documentID,expectedRevision:state.value.revision,idempotencyKey:`gesture-${++counter}`}),send:async <T>(method:string,params?:unknown)=>{calls.push({method,params:structuredClone(params)});return (custom?await custom(method,params):method==='documentInfoRead'?[]:{status:'applied'}) as T}}
 const api=scope.run(()=>useInfoTools(options))!;return {state,selectedId,tool,calls,scope,api}
}
test('sample gesture captures one revision, previews doc points, holds a lease and commits exactly once',async()=>{
 const f=fixture();try{f.api.startSample(pointer(12,13));assert.equal(f.api.active.value,true);assert.deepEqual(f.api.displayInfo.value.samples,[{id:1,position:[12,13]}]);assert.equal(f.api.info.value.samples.length,0)
 f.api.move(pointer(28,39));f.api.move(pointer(99,79,{pointerId:99}));assert.deepEqual(f.api.displayInfo.value.samples[0].position,[28,39]);await Promise.all([f.api.finish(),f.api.finish()]);assert.equal(f.api.active.value,false)
 const apply=f.calls.filter(call=>call.method==='apply');assert.equal(apply.length,1);assert.equal(apply[0].params.expectedRevision,4);assert.deepEqual(apply[0].params.action.info.samples,[{id:1,position:[28,39]}]);const leases=f.calls.filter(call=>call.method==='interaction');assert.equal(leases.length,2);assert.equal(leases[0].params.busy,true);assert.equal(leases[1].params.busy,false);assert.equal(leases[0].params.interactionId,apply[0].params.idempotencyKey);assert.equal(leases[1].params.interactionId,apply[0].params.idempotencyKey)
 }finally{f.scope.stop()}
})
test('cancel before asynchronous lease grant restores preview and releases after grant without a commit',async()=>{
 const grant=deferred<unknown>(),f=fixture(emptyDocumentInfo(),async(method,params)=>method==='interaction'&&params.busy?grant.promise:{})
 try{f.api.startSample(pointer(10,20));const settling=f.api.cancel();assert.equal(f.api.displayInfo.value.samples.length,0);await tick();assert.equal(f.calls.filter(call=>call.method==='interaction').length,1);grant.resolve({});await settling;assert.equal(f.api.active.value,false);assert.equal(f.calls.some(call=>call.method==='apply'),false);assert.deepEqual(f.calls.filter(call=>call.method==='interaction').map(call=>call.params.busy),[true,false])}finally{f.scope.stop()}
})
test('revision/session/tool changes invalidate gestures and never submit their expired snapshot',async()=>{
 for(const change of ['revision','session','tool'] as const){const grant=deferred<unknown>(),f=fixture(emptyDocumentInfo(),async(method,params)=>method==='interaction'&&params.busy?grant.promise:{})
  try{f.api.startSample(pointer(10,20));const startedSession=f.state.value.sessionId;await tick();if(change==='revision')f.state.value={...f.state.value,revision:5};else if(change==='session')f.state.value={...f.state.value,sessionId:randomUUID()};else f.tool.value='move';grant.resolve({});await tick();await tick();assert.equal(f.calls.some(call=>call.method==='apply'),false);assert.equal(f.calls.find(call=>call.method==='interaction'&&call.params.busy===false)!.params.sessionId,startedSession)}finally{f.scope.stop()}
 }
})
test('an unsuccessful lease acquisition cannot commit metadata',async()=>{
 const f=fixture(emptyDocumentInfo(),async(method,params)=>method==='interaction'&&params.busy?undefined:{})
 try{f.api.startSample(pointer(5,8));await f.api.finish();assert.equal(f.calls.some(call=>call.method==='apply'),false);assert.equal(f.api.active.value,false)}finally{f.scope.stop()}
})
test('sample drag outside removes only that point; Alt-click deletes using current revision without a pointer lease',async()=>{
 const info={...emptyDocumentInfo(),samples:[{id:2,position:[10,20] as [number,number]},{id:7,position:[30,40] as [number,number]}]},f=fixture(info)
 try{await tick();f.api.startSample(pointer(10,20),2);f.api.move(pointer(-1,20));await f.api.finish();assert.deepEqual(f.calls.find(call=>call.method==='apply')!.params.action.info.samples,[info.samples[1]])
 f.calls.length=0;f.state.value={...f.state.value,revision:6};f.api.startSample(pointer(30,40,{altKey:true}),7);await tick();assert.equal(f.calls.find(call=>call.method==='apply')!.params.expectedRevision,6);assert.equal(f.calls.some(call=>call.method==='interaction'),false)
 }finally{f.scope.stop()}
})
test('eyedropper Shift-created sample uses the same lease without forcing a different tool name',async()=>{
 const f=fixture();try{f.tool.value='eyedropper';f.api.startSample(pointer(10,20,{shiftKey:true}));await f.api.finish();assert.equal(f.calls.filter(call=>call.method==='apply').length,1);assert.equal(f.api.showPanel.value,true)}finally{f.scope.stop()}
})
test('ruler draws in doc space, Shift constrains 45 degrees, and Alt-end creates an arm at that endpoint',async()=>{
 const f=fixture({...emptyDocumentInfo(),ruler:{start:[10,10],end:[30,10]}})
 try{f.tool.value='ruler';f.api.startRuler(pointer(30,10,{altKey:true}),'end');f.api.move(pointer(40,20,{shiftKey:true}));assert.deepEqual(f.api.displayInfo.value.ruler,{start:[30,10],end:[10,10],third:[40,20]});await f.api.finish();assert.deepEqual(f.calls.find(call=>call.method==='apply')!.params.action.info.ruler,{start:[30,10],end:[10,10],third:[40,20]})}finally{f.scope.stop()}
})
test('middle dragging translates both ruler arms; complete off-canvas translation removes the ruler',async()=>{
 const f=fixture({...emptyDocumentInfo(),ruler:{start:[10,10],end:[30,10],third:[10,30]}})
 try{f.tool.value='ruler';f.api.startRuler(pointer(20,10),'line');f.api.move(pointer(25,17));assert.deepEqual(f.api.displayInfo.value.ruler,{start:[15,17],end:[35,17],third:[15,37]});f.api.move(pointer(220,10));await f.api.finish();assert.equal(f.calls.find(call=>call.method==='apply')!.params.action.info.ruler,undefined)}finally{f.scope.stop()}
})
test('a ruler crossing the image survives even when both endpoints are outside',async()=>{
 const f=fixture({...emptyDocumentInfo(),ruler:{start:[-10,20],end:[110,20]}})
 try{f.tool.value='ruler';f.api.startRuler(pointer(50,20),'line');f.api.move(pointer(50,21));await f.api.finish();assert.deepEqual(f.calls.find(call=>call.method==='apply')!.params.action.info.ruler,{start:[-10,21],end:[110,21]})}finally{f.scope.stop()}
})
test('old readonly replies are dropped after new revision or new selected layer requests',async()=>{
 const queries:{reply:ReturnType<typeof deferred<unknown>>;params:any}[]=[],f=fixture({...emptyDocumentInfo(),samples:[{id:1,position:[1,2]}],sampleTarget:'current'},async(method,params)=>{if(method!=='documentInfoRead')return {};const reply=deferred<unknown>();queries.push({reply,params});return reply.promise})
 try{await tick();f.selectedId.value=randomUUID();await tick();assert.equal(queries.length,2);const recent=[{id:1,position:[1,2],source:'current',sourcePrecision:'uint16',reading:{rgb:[2001,3001,4001],alpha:1,precision:'uint16',pixelCount:1,transparent:false}}];queries[1].reply.resolve(recent);await tick();queries[0].reply.resolve([{id:99}]);await tick();assert.deepEqual(f.api.readings.value,recent);assert.equal(f.api.loading.value,false)}finally{f.scope.stop()}
})
test('right click and invalid-start coordinates never acquire a gesture lease',async()=>{
 const f=fixture();try{f.api.startSample(pointer(1,2,{button:2}));f.api.startSample(pointer(-1,2));f.api.startRuler(pointer(NaN,2));await tick();assert.equal(f.api.active.value,false);assert.equal(f.calls.length,0)}finally{f.scope.stop()}
})
test('ruler cannot start a sample or delete a nearby marker, and sampler cannot start a ruler handle',async()=>{
 const f=fixture({...emptyDocumentInfo(),samples:[{id:1,position:[20,24]}]})
 try{f.tool.value='ruler';await tick();f.calls.length=0;f.api.startSample(pointer(20,20),1);f.api.startSample(pointer(20,24,{altKey:true}),1);assert.equal(f.api.active.value,false);assert.equal(f.calls.length,0)
 f.api.startRuler(pointer(20,20));f.api.move(pointer(60,50,{shiftKey:true}));await f.api.finish();const committed=f.calls.find(call=>call.method==='apply')!.params.action.info;assert.deepEqual(committed.samples,[{id:1,position:[20,24]}]);assert.ok(committed.ruler)
 f.tool.value='color-sampler';await tick();f.calls.length=0;f.api.startRuler(pointer(20,20));assert.equal(f.api.active.value,false);assert.equal(f.calls.length,0)
 f.tool.value='eyedropper';await tick();f.calls.length=0;f.api.startSample(pointer(20,24,{shiftKey:true}),1);f.api.startSample(pointer(70,40));assert.equal(f.api.active.value,false);assert.equal(f.calls.length,0)
 }finally{f.scope.stop()}
})
test('registered window blur cancels a live ruler lease and is removed at scope disposal',async()=>{
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window'),listeners=new Map<string,EventListener>(),scopeWindow={addEventListener:(name:string,fn:EventListener)=>listeners.set(name,fn),removeEventListener:(name:string,fn:EventListener)=>{if(listeners.get(name)===fn)listeners.delete(name)}}
 Object.defineProperty(globalThis,'window',{value:scopeWindow,configurable:true});let f:ReturnType<typeof fixture>|undefined
 try{f=fixture({...emptyDocumentInfo(),ruler:{start:[10,10],end:[30,10]}});f.tool.value='ruler';await tick();f.calls.length=0
  assert.equal(listeners.has('blur'),true);f.api.startRuler(pointer(30,10),'end');f.api.move(pointer(50,20));await tick();assert.equal(f.api.active.value,true);assert.notDeepEqual(f.api.displayInfo.value.ruler,f.api.info.value.ruler)
  listeners.get('blur')!({type:'blur'} as Event);await tick();await tick();assert.equal(f.api.active.value,false);assert.deepEqual(f.api.displayInfo.value.ruler,f.api.info.value.ruler);assert.equal(f.calls.some(call=>call.method==='apply'),false);assert.deepEqual(f.calls.filter(call=>call.method==='interaction').map(call=>call.params.busy),[true,false]);f.scope.stop();assert.equal(listeners.has('blur'),false)
 }finally{f?.scope.stop();if(prior)Object.defineProperty(globalThis,'window',prior);else Reflect.deleteProperty(globalThis,'window')}
})
