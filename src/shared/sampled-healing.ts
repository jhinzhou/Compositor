import {EditorError} from './contracts'
import {healMembrane} from './native-membrane'
import {blendPatchPyramid} from './patch-pyramid'

export const SAMPLED_HEALING_LIMITS={pixels:4_000_000,work:120_000_000} as const
export interface SampledHealingOptions {opacity?:number;adaptation?:number;protectAlpha?:boolean;signal?:AbortSignal;maximumWork?:number;selectionCoreThreshold?:number;selectionSoftTail?:boolean;selectionPyramid?:boolean}
/** A frozen donor in premultiplied byte units, preserving transparent-edge interpolation. */
export function sampleHealingDonor(rgba:Uint8Array,width:number,height:number,x:number,y:number):[number,number,number,number] {
 const x0=Math.floor(x-.5),y0=Math.floor(y-.5),fx=x-.5-x0,fy=y-.5-y0,out:[number,number,number,number]=[0,0,0,0]
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const sx=x0+dx,sy=y0+dy;if(sx<0||sy<0||sx>=width||sy>=height)continue
  const at=(sy*width+sx)*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy),alpha=rgba[at+3]
  out[3]+=alpha*weight;for(let c=0;c<3;c++)out[c]+=rgba[at+c]*alpha/255*weight
 }
 return out
}
/** Donor texture plus a harmonic boundary color correction. Not Adobe's proprietary solver.
 * Operates on private arrays; leaves every uncovered straight RGBA byte untouched. */
export function blendSampledHealing(destination:Uint8Array,donor:Float32Array,coverage:Uint8Array,width:number,height:number,options:SampledHealingOptions={}):Uint8Array {
 const count=width*height,opacity=options.opacity??1,adaptation=options.adaptation??1,protectAlpha=options.protectAlpha!==false,budget=options.maximumWork??SAMPLED_HEALING_LIMITS.work,requestedThreshold=options.selectionCoreThreshold??1
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||destination.length!==count*4||donor.length!==count*4||coverage.length!==count||![opacity,adaptation].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Number.isFinite(budget)||budget<0||budget>SAMPLED_HEALING_LIMITS.work||!Number.isInteger(requestedThreshold)||requestedThreshold<1||requestedThreshold>255)throw new EditorError('INVALID_ARGUMENT','Invalid sampled healing raster or parameters.')
 if(count>SAMPLED_HEALING_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Sampled healing exceeds its raster budget; use a smaller image.')
 let work=0;const charge=(amount:number)=>{work+=amount;if(options.signal?.aborted)throw new EditorError('CANCELED','Sampled healing was canceled.');if(work>budget)throw new EditorError('RESOURCE_LIMIT','Sampled healing exceeds its blending budget; use a smaller selection or stroke.')}
 charge(count);const output=new Uint8Array(destination);if(!opacity)return output
 let left=width,top=height,right=0,bottom=0,peakCoverage=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,at=p*4;for(let c=0;c<4;c++)if(!Number.isFinite(donor[at+c])||donor[at+c]<0||donor[at+c]>255||c<3&&donor[at+c]>donor[at+3]+.0001)throw new EditorError('INVALID_ARGUMENT','Invalid premultiplied healing donor.');if(coverage[p]&&donor[at+3]>0){peakCoverage=Math.max(peakCoverage,coverage[p]);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}}
 if(right<=left)return output
 if(options.selectionPyramid===true){const result=blendPatchPyramid(destination,donor,coverage,width,height,output,{left,top,right,bottom},{opacity,adaptation,softTail:options.selectionSoftTail===true},charge);if(result)return result}
 // Patch keeps the sharp-AA 50% core and uses a compositing tail for soft masks.
 // Other healing callers retain threshold 1 and the historical low-peak fallback.
 // Patch's soft path instead preserves the donor edit without inventing a core.
 const softTail=options.selectionSoftTail===true,hasCore=peakCoverage>=requestedThreshold,coreThreshold=hasCore||softTail?requestedThreshold:1
 left=Math.max(0,left-2);top=Math.max(0,top-2);right=Math.min(width,right+2);bottom=Math.min(height,bottom+2)
 const w=right-left,h=bottom-top,roles=new Uint8Array(w*h),difference=new Float32Array(w*h*4),mean=[0,0,0];let ringCount=0
 const straight=(p:number,c:number)=>donor[p*4+3]>0?donor[p*4+c]*255/donor[p*4+3]:0
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=(top+y)*width+left+x,q=y*w+x;if(coverage[p]>=coreThreshold&&donor[p*4+3]>0){roles[q]=2;continue}
  if(destination[p*4+3]===0||donor[p*4+3]===0)continue
  let near=false;for(let dy=-2;dy<=2&&!near;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<w&&yy<h){const neighbor=(top+yy)*width+left+xx;if(coverage[neighbor]>=coreThreshold&&donor[neighbor*4+3]>0){near=true;break}}}
  if(near){roles[q]=1;ringCount++;for(let c=0;c<3;c++){const value=destination[p*4+c]-straight(p,c);difference[q*4+c]=value;mean[c]+=value}}
 }
 charge(w*h*25)
 if(adaptation&&ringCount){for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)difference[q*4+c]=mean[c]/ringCount;healMembrane(difference,roles,w,h,0,charge)}
 // Soft Patch coverage is a compositing mask, not an enlarged repair membrane.
 // Keep the solved >=50% core fixed and harmonically extend its correction into
 // the weak tail with a free outer boundary. No core means no color adaptation,
 // but still copies the frozen donor through the original coverage once.
 if(softTail&&hasCore&&adaptation&&ringCount){
  charge(w*h)
  for(let y=0;y<h;y++){charge(0);for(let x=0;x<w;x++){
   const p=(top+y)*width+left+x,q=y*w+x
   if(roles[q]===2){roles[q]=1;continue}
   if(coverage[p]&&donor[p*4+3]>0){roles[q]=2;for(let c=0;c<3;c++)difference[q*4+c]=mean[c]/ringCount}else roles[q]=0
  }}
  healMembrane(difference,roles,w,h,0,charge)
 }
 // A donor's alpha affects strength, never injects invisible RGB into the correction.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=(top+y)*width+left+x,q=y*w+x,at=p*4;if(softTail?!coverage[p]||donor[at+3]===0:roles[q]!==2)continue
  const amount=coverage[p]/255*opacity,sa=donor[at+3]/255*amount,da=destination[at+3]/255,alpha=protectAlpha?da:sa+da*(1-sa)
  if(protectAlpha&&!da)continue
  for(let c=0;c<3;c++){const color=Math.max(0,Math.min(255,straight(p,c)+(ringCount&&(!softTail||hasCore)?difference[q*4+c]*adaptation:0)));output[at+c]=Math.round(protectAlpha?destination[at+c]*(1-sa)+color*sa:alpha?(color*sa+destination[at+c]*da*(1-sa))/alpha:0)}
  output[at+3]=protectAlpha?destination[at+3]:Math.round(alpha*255)
 }
 charge(w*h);return output
}
