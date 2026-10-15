import {computed,onScopeDispose,ref,shallowRef,toRaw,watch,type Ref} from 'vue'
import type {EditorState} from '../shared/contracts'
import {constrainRulerEnd,documentInfoSchema,emptyDocumentInfo,nextSampleId,type DocumentInfo,type InfoPoint} from '../shared/document-info'
import type {DocumentColorReading} from '../core/document-info'

export interface InfoIdentity {sessionId:string;documentId:string;expectedRevision:number;idempotencyKey:string}
export interface InfoToolOptions {
 state:Ref<EditorState|undefined>;selectedId:Ref<string|undefined>;tool:Ref<string>;
 canStart:()=>boolean;point:(event:{clientX:number;clientY:number})=>InfoPoint;identity:()=>InfoIdentity;
 send:<T>(method:string,params?:unknown)=>Promise<T|undefined>
}
type RulerHandle='start'|'end'|'third'|'line'
type PointerTarget=Pick<Element,'setPointerCapture'|'releasePointerCapture'|'hasPointerCapture'>
interface Gesture {identity:InfoIdentity;tool:string;pointerId:number;target?:PointerTarget;before:DocumentInfo;draft:DocumentInfo;start:InfoPoint;kind:'sample'|'ruler';id?:number;handle?:RulerHandle;ready:Promise<boolean>;cancelled:boolean;finishing:boolean}
const copy=<T>(value:T):T=>structuredClone(toRaw(value))
/** Owned pointer lease, preview and metadata transaction. All points are supplied
 * by App's document-coordinate mapper; this module never reads CSS rectangles. */
export function useInfoTools(options:InfoToolOptions) {
 const info=computed(()=>documentInfoSchema.parse(options.state.value?.manifest.documentInfo??emptyDocumentInfo()))
 const gesture=shallowRef<Gesture>(),draft=shallowRef<DocumentInfo>(),readings=shallowRef<DocumentColorReading[]>([])
 const loading=ref(false),error=ref(''),showPanel=ref(false),active=computed(()=>!!gesture.value),displayInfo=computed(()=>draft.value??info.value)
 let readTicket=0,disposed=false
 const valid=(current:Gesture)=>!disposed&&!current.cancelled&&options.state.value?.sessionId===current.identity.sessionId&&options.state.value?.manifest.documentID===current.identity.documentId&&options.state.value?.revision===current.identity.expectedRevision&&options.tool.value===current.tool
 const inside=(point:InfoPoint)=>!!options.state.value&&point[0]>=0&&point[1]>=0&&point[0]<options.state.value.manifest.width&&point[1]<options.state.value.manifest.height
 const finite=(point:InfoPoint)=>point.every(Number.isFinite)
 const report=(cause:unknown)=>{error.value=cause instanceof Error?cause.message:String(cause)}
 async function refresh(clearError=true):Promise<void> {
  const ticket=++readTicket,state=options.state.value;readings.value=[];if(clearError)error.value=''
  if(!state||!info.value.samples.length||active.value||disposed){loading.value=false;return}
  const sessionId=state.sessionId,expectedRevision=state.revision;loading.value=true
  try{const result=await options.send<DocumentColorReading[]>('documentInfoRead',{sessionId,expectedRevision,...(info.value.sampleTarget==='current'&&options.selectedId.value?{layerId:options.selectedId.value}:{})});if(ticket===readTicket&&!disposed){readings.value=result??[]}}
  catch(cause){if(ticket===readTicket&&!disposed)report(cause)}
  finally{if(ticket===readTicket&&!disposed)loading.value=false}
 }
 function releaseCapture(current:Gesture):void {try{if(current.target?.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId)}catch{/* Detached targets can lose capture during a tab switch. */}}
 async function finish(cancel=false):Promise<void> {
  const current=gesture.value;if(!current)return
  if(cancel){current.cancelled=true;draft.value=undefined;releaseCapture(current)}
  if(current.finishing)return
  current.finishing=true
  try{
   const acquired=await current.ready
   if(acquired&&valid(current)&&JSON.stringify(current.before)!==JSON.stringify(current.draft))await options.send('apply',{...current.identity,action:{type:'document.info',info:copy(current.draft)}})
  }catch(cause){report(cause)}
  finally{
   releaseCapture(current)
   try{await options.send('interaction',{sessionId:current.identity.sessionId,interactionId:current.identity.idempotencyKey,busy:false})}catch(cause){report(cause)}
   if(gesture.value===current){gesture.value=undefined;draft.value=undefined}
   if(!disposed)void refresh(false)
  }
 }
 const cancel=()=>finish(true)
 function begin(event:PointerEvent,kind:'sample'|'ruler'):Gesture|undefined {
  if(event.button!==0||active.value||!options.canStart()||!options.state.value)return
  const start=options.point(event);if(!finite(start))return
  let identity:InfoIdentity;try{identity=options.identity()}catch(cause){report(cause);return}
  const before=copy(info.value),target=event.currentTarget as PointerTarget|null
  const current:Gesture={identity,tool:options.tool.value,pointerId:event.pointerId,target:target??undefined,before,draft:copy(before),start,kind,cancelled:false,finishing:false,ready:Promise.resolve(false)}
  gesture.value=current;draft.value=current.draft;showPanel.value=true;error.value='';readings.value=[];++readTicket;loading.value=false
  try{target?.setPointerCapture(event.pointerId)}catch{/* Window-level root handlers still cancel and settle the lease. */}
  event.preventDefault()
  current.ready=Promise.resolve().then(()=>options.send('interaction',{sessionId:identity.sessionId,interactionId:identity.idempotencyKey,busy:true})).then(result=>result!==undefined).catch(cause=>{report(cause);return false})
  return current
 }
 function startSample(event:PointerEvent,id?:number):void {
  if(event.button!==0||!(options.tool.value==='color-sampler'||(id===undefined&&options.tool.value==='eyedropper'&&event.shiftKey)))return
  if(id!==undefined&&event.altKey){event.preventDefault();void removeSample(id);return}
  const state=options.state.value;if(!state)return
  const start=options.point(event);if(id===undefined&&!inside(start))return
  const existing=id===undefined?undefined:info.value.samples.find(sample=>sample.id===id)
  if(id!==undefined&&!existing)return
  const assigned=id??nextSampleId(info.value);if(assigned===undefined){error.value='A document can contain up to 10 color samples.';return}
  const current=begin(event,'sample');if(!current)return;current.id=assigned
  if(!existing)current.draft.samples.push({id:assigned,position:[...current.start]})
  draft.value=copy(current.draft)
 }
 function startRuler(event:PointerEvent,handle?:RulerHandle):void {
  if(options.tool.value!=='ruler')return
  if(handle&&!info.value.ruler)return
  const start=options.point(event);if(!handle&&!inside(start))return
  const current=begin(event,'ruler');if(!current)return
  const ruler=current.draft.ruler
  if(!ruler){current.draft.ruler={start:[...start],end:[...start]};current.handle='end'}
  else if(!handle){current.draft.ruler={start:[...start],end:[...start]};current.handle='end'}
  else if(event.altKey&&handle!=='line'&&handle!=='third'){
   if(handle==='end')current.draft.ruler={start:[...ruler.end],end:[...ruler.start],third:[...ruler.end]}
   else current.draft.ruler={...ruler,third:[...ruler.start]}
   current.handle='third'
  }else current.handle=handle
  draft.value=copy(current.draft)
 }
 function move(event:PointerEvent):void {
  const current=gesture.value;if(!current||current.finishing||event.pointerId!==current.pointerId)return
  if(!valid(current)){void cancel();return}
  const point=options.point(event);if(!finite(point))return
  if(current.kind==='sample'){
   const sample=current.draft.samples.find(sample=>sample.id===current.id);if(sample)sample.position=[...point]
  }else {
   const ruler=current.draft.ruler!;if(current.handle==='line'){
    const original=current.before.ruler!,delta=[point[0]-current.start[0],point[1]-current.start[1]]
    current.draft.ruler={start:[original.start[0]+delta[0],original.start[1]+delta[1]],end:[original.end[0]+delta[0],original.end[1]+delta[1]],...(original.third?{third:[original.third[0]+delta[0],original.third[1]+delta[1]] as InfoPoint}:{})}
   }else if(current.handle==='start')ruler.start=constrainRulerEnd(ruler.end,point,event.shiftKey)
   else if(current.handle)ruler[current.handle]=constrainRulerEnd(ruler.start,point,event.shiftKey)
  }
  draft.value=copy(current.draft);event.preventDefault()
 }
 async function change(value:DocumentInfo):Promise<void> {
  if(active.value||!options.canStart()||!options.state.value||disposed)return
  try{const next=documentInfoSchema.parse(copy(value));if(JSON.stringify(next)===JSON.stringify(info.value))return;await options.send('apply',{...options.identity(),action:{type:'document.info',info:next}})}catch(cause){report(cause)}
 }
 const removeSample=(id:number)=>change({...copy(info.value),samples:info.value.samples.filter(sample=>sample.id!==id)})
 const clearSamples=()=>change({...copy(info.value),samples:[]})
 const clearRuler=()=>{const next=copy(info.value);delete next.ruler;return change(next)}
 const originalFinish=finish
 function lineTouchesCanvas(start:InfoPoint,end:InfoPoint):boolean {
  const state=options.state.value;if(!state)return false
  // Liang–Barsky clipping: two outside endpoints can still cross the image.
  const dx=end[0]-start[0],dy=end[1]-start[1],width=state.manifest.width,height=state.manifest.height
  let low=0,high=1
  for(const [p,q] of [[-dx,start[0]],[dx,width-start[0]],[-dy,start[1]],[dy,height-start[1]]]){
   if(p===0){if(q<0)return false;continue}
   const ratio=q/p;if(p<0)low=Math.max(low,ratio);else high=Math.min(high,ratio);if(low>high)return false
  }
  return true
 }
 async function finishWithBounds(cancelled=false):Promise<void> {
  const current=gesture.value
  if(current&&!cancelled&&!current.finishing){
   if(current.kind==='sample')current.draft.samples=current.draft.samples.filter(sample=>sample.id!==current.id||inside(sample.position))
   else if(current.draft.ruler&&!lineTouchesCanvas(current.draft.ruler.start,current.draft.ruler.end)&&(!current.draft.ruler.third||!lineTouchesCanvas(current.draft.ruler.start,current.draft.ruler.third)))delete current.draft.ruler
  }
  await originalFinish(cancelled)
 }
 const stop=watch(()=>[options.state.value?.sessionId,options.state.value?.manifest.documentID,options.state.value?.revision,options.selectedId.value,options.tool.value] as const,()=>{
  const current=gesture.value;if(current&&!valid(current))void cancel()
  if(['color-sampler','ruler'].includes(options.tool.value))showPanel.value=true
  void refresh()
 },{immediate:true,flush:'sync'})
 const blur=()=>{void cancel()};if(typeof window!=='undefined')window.addEventListener('blur',blur)
 onScopeDispose(()=>{disposed=true;++readTicket;stop();if(typeof window!=='undefined')window.removeEventListener('blur',blur);void cancel()})
 return {info,displayInfo,readings,loading,error,showPanel,active,startSample,startRuler,move,finish:finishWithBounds,cancel,change,removeSample,clearSamples,clearRuler,refresh}
}
