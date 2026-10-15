import {getCurrentScope,onScopeDispose,ref,watch,type Ref} from 'vue'
import type {EditorState} from '../shared/contracts'

export type MagneticPoint=[number,number]
export type MagneticOperation='replace'|'add'|'subtract'|'intersect'
export interface MagneticIdentity {sessionId:string;documentId:string;expectedRevision:number;idempotencyKey:string}
export interface MagneticGestureOptions {
 state:Ref<EditorState|undefined>
 selectedId:Ref<string|undefined>
 options:()=>{width:number;contrast:number;frequency:number;sampleAllLayers:boolean}
 canStart:()=>boolean
 operation?:()=>MagneticOperation
 point:(event:MouseEvent|PointerEvent)=>MagneticPoint
 identity:()=>MagneticIdentity
 send:<T>(method:string,params?:unknown)=>Promise<T|undefined>
 commit:(identity:MagneticIdentity,points:MagneticPoint[],operation:MagneticOperation)=>Promise<unknown>
 onError?:(message:string)=>void
}
interface Gesture {
 identity:MagneticIdentity
 layerId:string
 settings:ReturnType<MagneticGestureOptions['options']>
 operation:MagneticOperation
 width:number
 height:number
 controls:MagneticPoint[]
 cursor:MagneticPoint
 ticket:number
 dirty:boolean
 ready:Promise<boolean>
 loop?:Promise<void>
 finishing?:Promise<void>
 release?:Promise<void>
 canceled:boolean
 committing:boolean
}
const MAX_POINTS=4096
function samePoint(a:MagneticPoint,b:MagneticPoint):boolean{return a[0]===b[0]&&a[1]===b[1]}
function validPath(value:unknown):value is {points:MagneticPoint[]} {
 if(!value||typeof value!=='object'||!('points'in value)||!Array.isArray(value.points)||value.points.length<2||value.points.length>100_000)return false
 return value.points.every(point=>Array.isArray(point)&&point.length===2&&point.every(coordinate=>typeof coordinate==='number'&&Number.isFinite(coordinate)))
}
/** A magnetic gesture owns one document revision and one interaction lease.
 * Pointer movement keeps tracking after the first click, even with no button
 * held. Only the final closed image-derived path is committed to history. */
export function useMagneticLasso(options:MagneticGestureOptions){
 const active=ref(false),points=ref<MagneticPoint[]>([])
 let gesture:Gesture|undefined,disposed=false,commitPending=false
 function current(g:Gesture):boolean {
  const state=options.state.value
  return gesture===g&&!g.canceled&&state?.sessionId===g.identity.sessionId&&state.manifest.documentID===g.identity.documentId&&state.revision===g.identity.expectedRevision&&options.selectedId.value===g.layerId
 }
 function release(g:Gesture):Promise<void>{
  if(!g.release)g.release=(async()=>{await g.ready;try{await options.send('interaction',{sessionId:g.identity.sessionId,interactionId:g.identity.idempotencyKey,busy:false})}catch{/* The owning session may already have closed. */}})()
  return g.release
 }
 function clear(g:Gesture):void{if(gesture===g){gesture=undefined;active.value=false;points.value=[]}}
 function cancel(g:Gesture):Promise<void>{g.canceled=true;g.ticket++;g.dirty=false;clear(g);return release(g)}
 function boundedPoint(event:MouseEvent|PointerEvent,g:Pick<Gesture,'width'|'height'>):MagneticPoint {
  const [x,y]=options.point(event)
  if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Magnetic Lasso requires finite canvas coordinates.')
  // Number.EPSILON alone does not move a 30000px upper bound below the edge.
  return [Math.max(0,Math.min(g.width-1e-7,x)),Math.max(0,Math.min(g.height-1e-7,y))]
 }
 function inputPoints(g:Gesture):MagneticPoint[]{const result=g.controls.map(point=>[...point] as MagneticPoint);if(!samePoint(result.at(-1)!,g.cursor))result.push([...g.cursor]);return result}
 async function preview(g:Gesture,raw:MagneticPoint[],closed:boolean):Promise<MagneticPoint[]|undefined>{
  if(raw.length<2||raw.length>MAX_POINTS)return undefined
  const result=await options.send<{points:MagneticPoint[]}>('magneticLassoPreview',{sessionId:g.identity.sessionId,expectedRevision:g.identity.expectedRevision,layerId:g.layerId,points:raw,...g.settings,closed})
  return validPath(result)?result.points.map(point=>[...point] as MagneticPoint):undefined
 }
 function schedule(g:Gesture):void{
  g.dirty=true;g.ticket++
  if(g.loop||g.finishing)return
  g.loop=(async()=>{
   if(!await g.ready||!current(g)){await cancel(g);return}
   while(current(g)&&!g.finishing&&g.dirty){
    g.dirty=false;const ticket=g.ticket,raw=inputPoints(g);if(raw.length<2)continue
    try{const result=await preview(g,raw,false);if(!current(g))return;if(!result){await cancel(g);return}if(ticket===g.ticket)points.value=result}
    catch(cause){if(current(g)&&ticket===g.ticket)options.onError?.(cause instanceof Error?cause.message:String(cause));await cancel(g);return}
   }
  })().finally(()=>{g.loop=undefined;if(current(g)&&g.dirty&&!g.finishing)schedule(g)})
 }
 function append(g:Gesture,point:MagneticPoint):boolean{
  if(samePoint(g.controls.at(-1)!,point))return false
  // Keep one slot for the moving tip; never truncate a gesture on overflow.
  if(g.controls.length>=MAX_POINTS-1){options.onError?.('Magnetic Lasso exceeds the 4096-point interaction budget. The selection has been kept.');void cancel(g);return false}
  g.controls.push(point);return true
 }
 async function start(event:MouseEvent|PointerEvent):Promise<void>{
  if(disposed||commitPending||event.button!==0)return
  if(gesture){
   const g=gesture;if(g.finishing||!current(g))return
   if(event.detail>=2){await finish();return}
   try{g.cursor=boundedPoint(event,g);append(g,g.cursor);if(current(g))schedule(g)}catch{await cancel(g)}
   return
  }
  const state=options.state.value,layerId=options.selectedId.value
  if(!state||!layerId||!options.canStart())return
  const identity=options.identity();if(identity.sessionId!==state.sessionId||identity.documentId!==state.manifest.documentID||identity.expectedRevision!==state.revision)return
  const settings={...options.options()},g:Gesture={identity:{...identity},layerId,settings,operation:event.shiftKey?(event.altKey?'intersect':'add'):event.altKey?'subtract':options.operation?.()??'replace',width:state.manifest.width,height:state.manifest.height,controls:[],cursor:[0,0],ticket:0,dirty:false,ready:Promise.resolve(false),canceled:false,committing:false}
  try{g.cursor=boundedPoint(event,g);g.controls=[g.cursor]}catch{return}
  gesture=g;active.value=true;points.value=[[...g.cursor]]
  g.ready=Promise.resolve().then(()=>options.send<{busy:boolean}>('interaction',{sessionId:identity.sessionId,interactionId:identity.idempotencyKey,busy:true})).then(value=>value?.busy===true).catch(()=>false)
  if(!await g.ready||!current(g)){await cancel(g);return}
  if(g.dirty)schedule(g)
 }
 function move(event:MouseEvent|PointerEvent):void{
  const g=gesture;if(!g||g.finishing)return
  if(!current(g)){void cancel(g);return}
  try{
   const point=boundedPoint(event,g);if(samePoint(point,g.cursor))return;g.cursor=point
   const spacing=Math.max(2,24-g.settings.frequency*.2)
   if(Math.hypot(point[0]-g.controls.at(-1)![0],point[1]-g.controls.at(-1)![1])>=spacing)append(g,point)
   if(current(g))schedule(g)
  }catch{void cancel(g)}
 }
 function backspace():void{
  const g=gesture;if(!g||g.finishing)return
  if(g.controls.length<=1){void cancel(g);return}
  g.controls.pop();g.cursor=[...g.controls.at(-1)!];g.ticket++
  if(g.controls.length===1){points.value=[[...g.cursor]];g.dirty=false}else schedule(g)
 }
 async function finish(canceled=false):Promise<void>{
  const g=gesture;if(!g)return
  if(canceled){g.canceled=true;g.ticket++;g.dirty=false;clear(g);if(!g.committing)await release(g);else await g.finishing;return}
  if(g.finishing)return g.finishing
  g.finishing=(async()=>{
   try{
    if(!await g.ready||!current(g))return
    // Invalidate the open preview and wait for its single flight before asking
    // for closed coverage; no stale open response may replace this final path.
    g.ticket++;g.dirty=false;await g.loop
    if(!current(g))return
    const result=await preview(g,inputPoints(g),true)
    if(!current(g)||!result||result.length<3)return
    // Signed areas can cancel on a legitimate self-crossing selection. Reject
    // only genuinely collinear paths; the selection model owns fill semantics.
    const first=result[0],second=result.find(point=>!samePoint(point,first))
    if(!second||!result.some(point=>Math.abs((second[0]-first[0])*(point[1]-first[1])-(second[1]-first[1])*(point[0]-first[0]))>1e-6))return
    points.value=result;g.committing=true;commitPending=true
    await options.commit({...g.identity},result,g.operation)
   }catch(cause){if(current(g))options.onError?.(cause instanceof Error?cause.message:String(cause))}
   finally{await release(g);if(g.committing)commitPending=false;clear(g)}
  })()
  return g.finishing
 }
 const stop=watch(()=>[options.state.value?.sessionId,options.state.value?.manifest.documentID,options.state.value?.revision,options.selectedId.value],()=>{const g=gesture;if(g&&!g.committing&&!current(g))void cancel(g)},{flush:'sync'})
 const blur=()=>{void finish(true)}
 if(typeof window!=='undefined')window.addEventListener('blur',blur)
 function dispose():void{if(disposed)return;disposed=true;stop();if(typeof window!=='undefined')window.removeEventListener('blur',blur);void finish(true)}
 if(getCurrentScope())onScopeDispose(dispose)
 return {active,points,start,move,finish,backspace,dispose}
}
