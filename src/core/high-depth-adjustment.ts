import {EditorError,LIMITS} from '../shared/contracts'
import {imageFilterSchema,type ImageFilter} from '../shared/image-filters'
import {applyDeepColorFilter,supportsDeepColorFilter} from '../shared/deep-color-filters'
import {applyHDRColorFilter,normalizeHDR,restoreHDR,validateHDRPixels} from '../shared/hdr-pixels'
import {runDeepFilter} from '../shared/deep-filter-run'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {applyHighDepthSpatialPixels} from './high-depth-filter'
const extras=new Set(['grain','addNoise','gaussianBlur','motionBlur'])
export function supportsHighDepthAdjustment(input:unknown):boolean {try{const filter=imageFilterSchema.parse(input);return supportsDeepColorFilter(filter)||extras.has(filter.kind)}catch{return false}}
export interface HighDepthAdjustmentEstimate {extraBytes:number;operations:number}
/** Full-canonical document grid anchors native Grain and Noise's pattern at(0,0).
 * Viewport/tiles are sampled after compositing, so they cannot reseed the pattern. */
export function highDepthAdjustmentEstimate(width:number,height:number,input:unknown):HighDepthAdjustmentEstimate {
 const filter=imageFilterSchema.parse(input),count=width*height
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||!Number.isSafeInteger(count)||count>MAX_DEEP_PIXELS)throw new EditorError('RESOURCE_LIMIT','Invalid high-depth adjustment surface.')
 if(!supportsHighDepthAdjustment(filter))throw new EditorError('UNSUPPORTED_FEATURE','This adjustment has no high-depth implementation.')
 if(!extras.has(filter.kind))return {extraBytes:0,operations:0}
 if(filter.kind==='grain'||filter.kind==='addNoise'){if(count*104>MAX_DEEP_WORKING_BYTES||count*48>500_000_000)throw new EditorError('RESOURCE_LIMIT','High-depth noise adjustment exceeds its bounded working budget.');return {extraBytes:count*104,operations:count*48}}
 let w=width,h=height,sigma=filter.kind==='gaussianBlur'?filter.radius:filter.kind==='motionBlur'?filter.distance/Math.sqrt(12):1,both=filter.kind==='gaussianBlur',rotated=false
 if(filter.kind==='motionBlur'&&Math.abs(filter.angle%90)>1e-8){const angle=filter.angle*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));w=Math.ceil(width*c+height*s)+3;h=Math.ceil(width*s+height*c)+3;rotated=true}
 const radius=Math.max(1,Math.ceil(sigma*3)),kernel=radius*2+1,pass=(n:number)=>{let padded=1;while(padded<n+radius*4)padded*=2;return {ops:kernel>33?3*padded*Math.log2(padded):n*kernel,bytes:kernel>33?padded*32:0}},x=pass(w),y=pass(h),vertical=filter.kind==='motionBlur'&&Math.abs(filter.angle%90)<1e-8&&Math.abs(Math.sin(filter.angle*Math.PI/180))>.5
 const operations=4*((both||!vertical?h*x.ops:0)+(both||vertical?w*y.ops:0))+(rotated?count*32+w*h*16:0),extraBytes=count*64+(rotated?w*h*52:0)+x.bytes+y.bytes+kernel*16+(w+h)*16
 if(w>LIMITS.maxSide||h>LIMITS.maxSide||!Number.isSafeInteger(w*h)||w*h>MAX_DEEP_PIXELS||extraBytes>MAX_DEEP_WORKING_BYTES||operations>500_000_000)throw new EditorError('RESOURCE_LIMIT','High-depth adjustment scratch exceeds its bounded working surface.')
 return {extraBytes,operations}
}
function filter(input:unknown):ImageFilter {const spec=imageFilterSchema.parse(input);if(!supportsHighDepthAdjustment(spec))throw new EditorError('UNSUPPORTED_FEATURE','Unsupported high-depth adjustment.');return spec}
/** Adjustment color replaces color beneath it; canvas dimensions and the target
 * alpha remain fixed by default. Native Normal blur explicitly opts out through context. Blur color divides by blurred alpha before restoring target
 * alpha, matching native Preserve Transparency's outline treatment. */
export interface HighDepthAdjustmentContext {preserveAlpha?:boolean}
export function applyDeepAdjustment(source:Uint16Array,width:number,height:number,input:unknown,context:HighDepthAdjustmentContext={}):Uint16Array {
 const spec=filter(input);highDepthAdjustmentEstimate(width,height,spec)
 if(supportsDeepColorFilter(spec))return applyDeepColorFilter(source,width,height,spec)
 if(!(source instanceof Uint16Array)||source.length!==width*height*4)throw new EditorError('INVALID_ARGUMENT','Invalid UNORM16 adjustment pixels.')
 for(let at=0;at<source.length;at+=4)if(source[at]>source[at+3]||source[at+1]>source[at+3]||source[at+2]>source[at+3])throw new EditorError('INVALID_ARGUMENT','Expected premultiplied adjustment pixels.')
 if(spec.kind==='grain'&&!spec.amount)return source.slice()
 const spatial=spec.kind==='gaussianBlur'||spec.kind==='motionBlur',out=new Uint16Array(source.length)
 if(spatial){const result=applyHighDepthSpatialPixels(Float32Array.from(source,v=>v/65535),width,height,spec);if(context.preserveAlpha===false)return Uint16Array.from(result,(v,i)=>Math.round(Math.max(0,Math.min(i%4===3?65535:result[i-i%4+3]*65535,v*65535))));for(let at=0;at<out.length;at+=4){const alpha=source[at+3],blurAlpha=result[at+3];for(let c=0;c<3;c++)out[at+c]=alpha&&blurAlpha?Math.round(Math.max(0,Math.min(alpha,result[at+c]*alpha/blurAlpha))):0;out[at+3]=alpha}}
 else {const result=runDeepFilter(source,width,height,spec);for(let at=0;at<out.length;at+=4){const alpha=source[at+3],next=result[at+3];for(let c=0;c<3;c++)out[at+c]=alpha&&next?Math.round(Math.max(0,Math.min(alpha,result[at+c]*alpha/next))):0;out[at+3]=alpha}}
 return out
}
export function applyHDRAdjustment(source:Float32Array,width:number,height:number,input:unknown,context:HighDepthAdjustmentContext={}):Float32Array {
 const spec=filter(input);highDepthAdjustmentEstimate(width,height,spec)
 if(supportsDeepColorFilter(spec))return applyHDRColorFilter(source,width,height,spec)
 validateHDRPixels(source,width,height,0)
 if(spec.kind==='grain'&&!spec.amount)return source.slice()
 let result:Float32Array
 if(spec.kind==='gaussianBlur'||spec.kind==='motionBlur'){result=applyHighDepthSpatialPixels(source,width,height,spec);if(context.preserveAlpha===false)return result}
 else {const normalized=normalizeHDR(source,width,height);result=restoreHDR(runDeepFilter(normalized.normal,width,height,spec),normalized.scales,width,height)}
 for(let at=0;at<result.length;at+=4){const alpha=source[at+3],next=result[at+3];for(let c=0;c<3;c++)result[at+c]=alpha&&next?result[at+c]*alpha/next:0;result[at+3]=alpha}
 validateHDRPixels(result,width,height,0);return result
}
