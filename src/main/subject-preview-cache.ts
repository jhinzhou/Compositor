import {EditorError} from '../shared/contracts'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'

export interface SubjectPreviewKey {
 sessionId:string
 documentId:string
 revision:number
 layerId:string
 removeBackground:boolean
 sampleAllLayers:boolean
 box?:[number,number,number,number]
 point?:[number,number]
}
export interface SubjectPreviewSource {image:RGBAImage;coarse:RasterSelection;space:'document'|'source'}
export interface SubjectPreviewCacheOptions {byteBudget?:number;ttlMs?:number}
export const SUBJECT_PREVIEW_CACHE_MAX_BYTES=128*1024*1024
interface Entry {key:string;sessionId:string;controller:AbortController;promise:Promise<SubjectPreviewSource>;bytes:number;value?:SubjectPreviewSource;timer?:ReturnType<typeof setTimeout>;cleanup:Set<()=>void>}
function canceled():EditorError{return new EditorError('CANCELED','Subject preview source was canceled or superseded.')}
function keyString(key:SubjectPreviewKey):string {
 if(!key.sessionId||!key.documentId||!key.layerId||!Number.isSafeInteger(key.revision)||key.revision<0||typeof key.removeBackground!=='boolean'||typeof key.sampleAllLayers!=='boolean'||key.box&&(key.box.length!==4||key.box.some(value=>!Number.isFinite(value))||key.box[2]<=0||key.box[3]<=0)||key.point&&(key.point.length!==2||key.point.some(value=>!Number.isFinite(value))))throw new EditorError('INVALID_ARGUMENT','Invalid subject preview source identity.')
 // Enumerate only source fields. Extra UI settings (including matte sliders) do
 // not affect this key; tuple values are serialized now, not retained mutable.
 return JSON.stringify([key.sessionId,key.documentId,key.revision,key.layerId,key.removeBackground,key.sampleAllLayers,key.box??null,key.point??null])
}
function resultBytes(result:SubjectPreviewSource):number {
 const {image,coarse}=result,count=image?.width*image?.height
 if(!image||!coarse||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||!(image.data instanceof Uint8Array)||image.data.length!==count*4||coarse.width!==image.width||coarse.height!==image.height||!(coarse.coverage instanceof Uint8Array)||coarse.coverage.length!==count||result.space!=='document'&&result.space!=='source')throw new EditorError('INVALID_ARGUMENT','Invalid subject preview image or coarse mask.')
 // Count retained backing buffers, not just typed-array views: a small subarray
 // must not smuggle a huge decoded/model buffer past the cache's byte budget.
 return [...new Set([image.data.buffer,coarse.coverage.buffer])].reduce((sum,buffer)=>sum+buffer.byteLength,0)
}

/** One revision-bound coarse inference source, shared by preview and Apply.
 * Refinement parameters deliberately stay outside the key. The source arrays
 * are read-only by convention; refineSubjectMatte returns a new mask.
 *
 * A cancel rejects callers immediately and aborts the loader signal. A new
 * source waits for the old loader to physically settle before starting, so a
 * model runtime that cannot interrupt session.run never receives overlapping
 * inference calls. Late success/failure cannot replace the new entry.
 */
export class SubjectPreviewCache {
 private entry?:Entry
 private drain:Promise<void>=Promise.resolve()
 private readonly byteBudget:number
 private readonly ttlMs:number
 constructor(options:SubjectPreviewCacheOptions={}) {
  this.byteBudget=options.byteBudget??SUBJECT_PREVIEW_CACHE_MAX_BYTES;this.ttlMs=options.ttlMs??300_000
  if(!Number.isSafeInteger(this.byteBudget)||this.byteBudget<1||this.byteBudget>SUBJECT_PREVIEW_CACHE_MAX_BYTES||!Number.isFinite(this.ttlMs)||this.ttlMs<1||this.ttlMs>3_600_000)throw new EditorError('INVALID_ARGUMENT','Invalid subject preview cache budget or lifetime.')
 }
 get(key:SubjectPreviewKey,loader:(signal:AbortSignal)=>Promise<SubjectPreviewSource>,signal?:AbortSignal):Promise<SubjectPreviewSource> {
  if(signal?.aborted)return Promise.reject(canceled())
  const encoded=keyString(key)
  if(this.entry?.key===encoded){const entry=this.entry;if(entry.value)this.expireLater(entry);this.watchSignal(entry,signal);return entry.promise}
  this.invalidate()
  const controller=new AbortController(),entry:Entry={key:encoded,sessionId:key.sessionId,controller,promise:undefined as unknown as Promise<SubjectPreviewSource>,bytes:0,cleanup:new Set()}
  const work=this.drain.then(()=>{if(controller.signal.aborted)throw canceled();return loader(controller.signal)})
  this.drain=work.then(()=>{},()=>{})
  entry.promise=new Promise((resolve,reject)=>{
   const abort=()=>reject(canceled());controller.signal.addEventListener('abort',abort,{once:true})
   work.then(result=>{
    if(controller.signal.aborted||this.entry!==entry){reject(canceled());return}
    try {
     const bytes=resultBytes(result)
     if(bytes<=this.byteBudget){entry.bytes=bytes;entry.value=result;this.expireLater(entry)}
     else this.drop(entry,false) // Oversized source may be used once, never retained.
     this.removeSignalWatchers(entry);controller.signal.removeEventListener('abort',abort);resolve(result)
    }catch(error){this.drop(entry,false);controller.signal.removeEventListener('abort',abort);reject(error)}
   },error=>{this.drop(entry,false);controller.signal.removeEventListener('abort',abort);reject(controller.signal.aborted?canceled():error)})
  })
  this.entry=entry;this.expireLater(entry);this.watchSignal(entry,signal)
  return entry.promise
 }
 /** Cancel on document close, source change or preview Cancel. Matte changes use
  * get with the same key and leave the in-flight coarse inference intact. */
 invalidate():void {if(this.entry)this.drop(this.entry,true)}
 /** A late Cancel from an old document cannot abort another document's job. */
 invalidateSession(sessionId:string):boolean {if(this.entry?.sessionId!==sessionId)return false;this.drop(this.entry,true);return true}
 private drop(entry:Entry,abort:boolean):void {
  if(this.entry===entry)this.entry=undefined
  if(entry.timer)clearTimeout(entry.timer)
  entry.timer=undefined;entry.value=undefined;entry.bytes=0;this.removeSignalWatchers(entry)
  if(abort&&!entry.controller.signal.aborted)entry.controller.abort()
 }
 private removeSignalWatchers(entry:Entry):void {for(const cleanup of entry.cleanup)cleanup();entry.cleanup.clear()}
 private watchSignal(entry:Entry,signal?:AbortSignal):void {
  if(!signal)return
  if(signal.aborted){if(this.entry===entry)this.drop(entry,true);return}
  const abort=()=>{if(this.entry===entry)this.drop(entry,true)}
  signal.addEventListener('abort',abort,{once:true});entry.cleanup.add(()=>signal.removeEventListener('abort',abort))
  // Resolved sources need no loader cancellation watcher. Explicit invalidate
  // still clears them; an old completed preview's later abort cannot evict Apply.
  if(entry.value)this.removeSignalWatchers(entry)
 }
 private expireLater(entry:Entry):void {
  if(entry.timer)clearTimeout(entry.timer)
  entry.timer=setTimeout(()=>{if(this.entry===entry)this.drop(entry,true)},this.ttlMs)
  entry.timer.unref?.()
 }
 stats():{entries:0|1;bytes:number;inFlight:boolean}{return {entries:this.entry?1:0,bytes:this.entry?.bytes??0,inFlight:!!this.entry&&!this.entry.value}}
}
