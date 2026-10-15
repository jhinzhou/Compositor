import {PNG} from 'pngjs'
import {EditorError} from '../shared/contracts'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'

/** Drafts are local, disposable reads. Finishing an older request must never
 * remove or publish the newer request occupying the same document. */
export class EdgeRefinementPreviews {
  private jobs=new Map<string,{requestId:number;controller:AbortController}>()
  begin(sessionId:string,requestId:number):AbortController {
    this.cancel(sessionId)
    if(this.jobs.size>=8)throw new EditorError('RESOURCE_LIMIT','At most eight edge refinement previews may run.')
    const controller=new AbortController()
    this.jobs.set(sessionId,{requestId,controller})
    return controller
  }
  assertCurrent(sessionId:string,controller:AbortController):void {
    if(controller.signal.aborted||this.jobs.get(sessionId)?.controller!==controller)throw new EditorError('CANCELED','The edge refinement preview was canceled.')
  }
  cancel(sessionId:string,requestId?:number):boolean {
    const job=this.jobs.get(sessionId)
    if(!job||requestId!==undefined&&job.requestId!==requestId)return false
    this.jobs.delete(sessionId);job.controller.abort();return true
  }
  finish(sessionId:string,controller:AbortController):void {
    if(this.jobs.get(sessionId)?.controller===controller)this.jobs.delete(sessionId)
  }
  dispose():void {for(const id of [...this.jobs.keys()])this.cancel(id)}
}

/** Display thumbnails never become the algorithm's input. Source dimensions
 * remain separate so CSS gestures map to full-resolution source coordinates. */
export function edgeRefinementImages(image:RGBAImage,coverage:RasterSelection,trimap?:Uint8Array){
  const count=image.width*image.height
  if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||count>32_000_000||image.data.length!==count*4||coverage.width!==image.width||coverage.height!==image.height||coverage.coverage.length!==count||trimap&&trimap.length!==count)throw new EditorError('INVALID_ARGUMENT','Edge refinement preview images have inconsistent dimensions.')
  const scale=Math.min(1,1024/Math.max(image.width,image.height)),width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale))
  const source=new PNG({width,height}),mask=new PNG({width,height}),constraints=trimap?new PNG({width,height}):undefined
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.min(image.width-1,Math.floor((x+.5)*image.width/width)),sy=Math.min(image.height-1,Math.floor((y+.5)*image.height/height)),i=sy*image.width+sx,at=(y*width+x)*4
    source.data.set(image.data.subarray(i*4,i*4+4),at)
    const value=coverage.coverage[i];mask.data.set([value,value,value,255],at)
    if(constraints){const label=trimap![i];constraints.data.set([label,label,label,255],at)}
  }
  const url=(png:PNG)=>`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
  return {width:image.width,height:image.height,previewWidth:width,previewHeight:height,sourceURL:url(source),coverageURL:url(mask),...(constraints?{trimapURL:url(constraints)}:{})}
}
