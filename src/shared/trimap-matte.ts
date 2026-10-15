import {EditorError} from './contracts'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'
import {matteBox,colorGuidedMatteFilter} from './subject-matte'

export interface TrimapRegion {x:number;y:number;width:number;height:number}
export interface TrimapMatteOptions {
 region?:TrimapRegion
 sampleRadius?:number
 guidedRadius?:number
 guidedBlend?:number
 minimumColorDistance?:number
 signal?:AbortSignal
}
export interface TrimapMatteReport {
 /** RGB projection and guide run in encoded sRGB, not linear-light matting. */
 colorDomain:'encoded-sRGB'
 guideAlpha:'opaque'
 unknownPixels:number
 resolvedPixels:number
 fallbackPixels:number
 lowContrastPixels:number
 missingAnchorPixels:number
 /** Unique retained input buffers, including backing bytes outside a view. */
 estimatedInputBytes:number
 estimatedWorkingBytes:number
 estimatedPeakBytes:number
 estimatedOperations:number
}
export interface TrimapMatteResult {mask:RasterSelection;report:TrimapMatteReport}
export const TRIMAP_MATTE_MAX_WORKING_BYTES=512*1024*1024
export const TRIMAP_MATTE_MAX_PEAK_BYTES=512*1024*1024
export const TRIMAP_MATTE_MAX_OPERATIONS=2_000_000_000
const invalid=(message:string):never=>{throw new EditorError('INVALID_ARGUMENT',message)}
function cancelled(signal?:AbortSignal):void{if(signal?.aborted)throw new EditorError('CANCELED','Trimap refinement was cancelled.')}
function bytes(value:unknown):boolean{return value instanceof Uint8Array||value instanceof Uint8ClampedArray}

/** Refine only the requested region. 0/255 are fixed background/foreground;
 * 128 is unknown. Nearby fixed samples estimate F and B, then project C onto
 * C = alpha F + (1-alpha) B in encoded sRGB. Missing or indistinguishable
 * samples preserve the original mask instead of inventing foreground.
 * This cannot infer spatially varying foreground/background colors, semantic
 * hair, or recover RGB from a flattened image. The RGB guide must be opaque
 * (all source alpha bytes 255), so hidden RGB cannot become a color anchor.
 * Known foreground 255 constrains the independent mask, not the source alpha.
 * It never changes source pixels.
 * Running box sums keep local sampling O(pixels), independent of radius.
 * The synchronous signal is checked at stage/row boundaries. Moving this
 * function to a worker alone does not let postMessage change its AbortSignal
 * while that worker is blocked; integration needs worker termination or a
 * shared atomic cancellation flag with a cooperative signal adapter. */
export function refineTrimapMatte(mask:RasterSelection,guide:RGBAImage,trimap:Uint8Array,options:TrimapMatteOptions={}):TrimapMatteResult {
 const {width,height}=mask,count=width*height
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>30_000||height>30_000)invalid('Invalid trimap raster dimensions.')
 if(count>32_000_000)throw new EditorError('RESOURCE_LIMIT','Trimap source is limited to 32 megapixels.')
 if(guide.width!==width||guide.height!==height||!bytes(mask.coverage)||!bytes(guide.data)||!bytes(trimap)||mask.coverage.length!==count||guide.data.length!==count*4||trimap.length!==count)invalid('Trimap, mask and guide must have equal byte-raster dimensions.')
 const sampleRadius=options.sampleRadius??16,guidedRadius=options.guidedRadius??2,guidedBlend=options.guidedBlend??.1,minimumColorDistance=options.minimumColorDistance??.05
 if(!Number.isInteger(sampleRadius)||sampleRadius<1||sampleRadius>64||!Number.isInteger(guidedRadius)||guidedRadius<1||guidedRadius>40||!Number.isFinite(guidedBlend)||guidedBlend<0||guidedBlend>1||!Number.isFinite(minimumColorDistance)||minimumColorDistance<.01||minimumColorDistance>1)invalid('Invalid trimap refinement settings.')
 const region=options.region??{x:0,y:0,width,height}
 if(![region.x,region.y,region.width,region.height].every(Number.isInteger)||region.x<0||region.y<0||region.width<1||region.height<1||region.x+region.width>width||region.y+region.height>height)invalid('Trimap refinement region must lie inside the source raster.')
 const halo=sampleRadius+2*guidedRadius,x0=Math.max(0,region.x-halo),y0=Math.max(0,region.y-halo),x1=Math.min(width,region.x+region.width+halo),y1=Math.min(height,region.y+region.height+halo),w=x1-x0,h=y1-y0,n=w*h
 // Includes copied output, local image/prior, class means and the existing
 // color guide's 13 scratch arrays, plus conservative box-filter temporaries.
 const inputBuffers=new Set([mask.coverage.buffer,guide.data.buffer,trimap.buffer]),estimatedInputBytes=[...inputBuffers].reduce((sum,buffer)=>sum+buffer.byteLength,0)
 const estimatedWorkingBytes=count+n*256+65_536,estimatedPeakBytes=estimatedInputBytes+estimatedWorkingBytes,estimatedOperations=2*count+n*512+32*(sampleRadius+guidedRadius)*(w+h)
 // ROI limits local computation but validation still scans the whole source
 // alpha and trimap, and source views retain their entire backing buffers.
 if(estimatedWorkingBytes>TRIMAP_MATTE_MAX_WORKING_BYTES||estimatedPeakBytes>TRIMAP_MATTE_MAX_PEAK_BYTES||estimatedOperations>TRIMAP_MATTE_MAX_OPERATIONS)throw new EditorError('RESOURCE_LIMIT','Trimap refinement exceeds its peak memory or operation budget; use smaller retained inputs or a smaller region.',{estimatedInputBytes,estimatedWorkingBytes,estimatedPeakBytes,estimatedOperations})
 cancelled(options.signal)
 for(let i=0;i<count;i++){if((i&65535)===0)cancelled(options.signal);if(trimap[i]!==0&&trimap[i]!==128&&trimap[i]!==255)invalid('Trimap values must be 0 (background), 128 (unknown), or 255 (foreground).');if(guide.data[i*4+3]!==255)invalid('Trimap refinement requires an opaque RGB guide; transparent PNG alpha is not supported by this prototype.')}
 // All validation and budget checks precede allocation or processing.
 const coverage=new Uint8Array(mask.coverage),localImage=new Uint8Array(n*4),prior=new Float32Array(n),foreground=new Float32Array(n),background=new Float32Array(n)
 for(let y=y0;y<y1;y++){cancelled(options.signal);for(let x=x0;x<x1;x++){const index=y*width+x,local=(y-y0)*w+x-x0;localImage.set(guide.data.subarray(index*4,index*4+4),local*4);prior[local]=trimap[index]===128?mask.coverage[index]/255:trimap[index]/255;foreground[local]=trimap[index]===255?1:0;background[local]=trimap[index]===0?1:0}}
 const fgWeight=matteBox(foreground,w,h,sampleRadius),bgWeight=matteBox(background,w,h,sampleRadius),fgColor:Float32Array[]=[],bgColor:Float32Array[]=[]
 for(let channel=0;channel<3;channel++){
  cancelled(options.signal)
  const values=new Float32Array(n);for(let i=0;i<n;i++)values[i]=localImage[i*4+channel]/255*foreground[i]
  const fg=matteBox(values,w,h,sampleRadius);for(let i=0;i<n;i++)fg[i]=fgWeight[i]>0?fg[i]/fgWeight[i]:0;fgColor.push(fg)
  for(let i=0;i<n;i++)values[i]=localImage[i*4+channel]/255*background[i]
  const bg=matteBox(values,w,h,sampleRadius);for(let i=0;i<n;i++)bg[i]=bgWeight[i]>0?bg[i]/bgWeight[i]:0;bgColor.push(bg)
 }
 const resolved=new Uint8Array(n),report:TrimapMatteReport={colorDomain:'encoded-sRGB',guideAlpha:'opaque',unknownPixels:0,resolvedPixels:0,fallbackPixels:0,lowContrastPixels:0,missingAnchorPixels:0,estimatedInputBytes,estimatedWorkingBytes,estimatedPeakBytes,estimatedOperations}
 for(let y=0;y<h;y++){cancelled(options.signal);for(let x=0;x<w;x++){
  const i=y*w+x,global=(y+y0)*width+x+x0;if(trimap[global]!==128)continue
  const inside=x+x0>=region.x&&x+x0<region.x+region.width&&y+y0>=region.y&&y+y0<region.y+region.height
  if(inside)report.unknownPixels++
  if(fgWeight[i]<1e-8||bgWeight[i]<1e-8){if(inside){report.fallbackPixels++;report.missingAnchorPixels++}continue}
  let dot=0,length=0;for(let channel=0;channel<3;channel++){const delta=fgColor[channel][i]-bgColor[channel][i];dot+=(localImage[i*4+channel]/255-bgColor[channel][i])*delta;length+=delta*delta}
  if(length<minimumColorDistance*minimumColorDistance){if(inside){report.fallbackPixels++;report.lowContrastPixels++}continue}
  prior[i]=Math.min(1,Math.max(0,dot/length));resolved[i]=1;if(inside)report.resolvedPixels++
 }}
 cancelled(options.signal)
 const refined=guidedBlend>0&&report.resolvedPixels?colorGuidedMatteFilter(prior,{width:w,height:h,data:localImage},guidedRadius):prior
 for(let y=region.y;y<region.y+region.height;y++){cancelled(options.signal);for(let x=region.x;x<region.x+region.width;x++){
  const global=y*width+x,local=(y-y0)*w+x-x0,label=trimap[global]
  coverage[global]=label===255?255:label===0?0:resolved[local]?Math.round(255*(prior[local]*(1-guidedBlend)+refined[local]*guidedBlend)):mask.coverage[global]
 }}
 cancelled(options.signal)
 return {mask:{...mask,coverage},report}
}
