/** Alpha28 disclosed-corpus research only; frozen alpha27 algorithm plus declared boundary/quantization hypotheses. */
import {EditorError} from '../../src/shared/contracts'
import {healMembrane} from '../../src/shared/native-membrane'

export const SAMPLED_HEALING_LIMITS={pixels:4_000_000,work:120_000_000} as const
export interface SampledHealingOptions {opacity?:number;adaptation?:number;protectAlpha?:boolean;signal?:AbortSignal;maximumWork?:number;selectionCoreThreshold?:number;selectionSoftTail?:boolean;tailBoundary?:'neumann'|'dirichlet';quantizeColor?:boolean;tailContinuation?:'plane'|'normal-gradient';isolateSoftComponents?:boolean;boundaryMean?:boolean;stagedQuantization?:boolean}
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
 if(options.boundaryMean&&adaptation&&ringCount){
  const before=difference.slice();mean.fill(0)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=y*w+x;if(roles[q]!==1)continue;let weight=0;const values=[0,0,0]
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const z=ny*w+nx;if(roles[z]!==1)continue;const a=(dx===0?2:1)*(dy===0?2:1);weight+=a;for(let c=0;c<3;c++)values[c]+=before[z*4+c]*a}
   for(let c=0;c<3;c++)mean[c]+=difference[q*4+c]=values[c]/weight
  }
 }
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
   if(coverage[p]&&donor[p*4+3]>0){roles[q]=2;for(let c=0;c<3;c++)difference[q*4+c]=mean[c]/ringCount}else if(options.tailBoundary==='dirichlet'&&destination[p*4+3]>0&&donor[p*4+3]>0){roles[q]=1;for(let c=0;c<3;c++)difference[q*4+c]=destination[p*4+c]-straight(p,c)}else roles[q]=0
  }}
  if(options.isolateSoftComponents){
   charge(w*h*6);const queue=new Int32Array(w*h)
   for(let q=0;q<roles.length;q++)if(roles[q]===2){let head=0,end=0,anchored=false;queue[end++]=q;roles[q]=3
    while(head<end){if((head&1023)===0)charge(0);const at=queue[head++],x=at%w,y=Math.floor(at/w);for(const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const next=ny*w+nx;if(roles[next]===1)anchored=true;else if(roles[next]===2){roles[next]=3;queue[end++]=next}}}
    for(let i=0;i<end;i++){const at=queue[i];roles[at]=anchored?4:5;if(!anchored)for(let c=0;c<3;c++)difference[at*4+c]=0}
   }
   for(let q=0;q<roles.length;q++)if(roles[q]===4)roles[q]=2;else if(roles[q]===5)roles[q]=0
  }
  healMembrane(difference,roles,w,h,0,charge)
 }
 if(softTail&&hasCore&&adaptation&&ringCount&&options.tailContinuation){
  const core:number[]=[];for(let q=0;q<roles.length;q++){const p=(top+Math.floor(q/w))*width+left+q%w;if(coverage[p]>=coreThreshold&&donor[p*4+3]>0)core.push(q)}
  if(options.tailContinuation==='plane'){
   const mx=core.reduce((v,q)=>v+q%w,0)/core.length,my=core.reduce((v,q)=>v+Math.floor(q/w),0)/core.length,means=[0,0,0],xf=[0,0,0],yf=[0,0,0];let xx=0,xy=0,yy=0
   for(const q of core){const x=q%w-mx,y=Math.floor(q/w)-my;xx+=x*x;xy+=x*y;yy+=y*y;for(let c=0;c<3;c++){means[c]+=difference[q*4+c];xf[c]+=x*difference[q*4+c];yf[c]+=y*difference[q*4+c]}}
   const det=xx*yy-xy*xy,bx=xf.map((v,c)=>det?(v*yy-yf[c]*xy)/det:xx?v/xx:0),by=yf.map((v,c)=>det?(v*xx-xf[c]*xy)/det:yy?v/yy:0)
   for(let q=0;q<roles.length;q++)if(roles[q]===2)for(let c=0;c<3;c++)difference[q*4+c]=means[c]/core.length+bx[c]*(q%w-mx)+by[c]*(Math.floor(q/w)-my)
  }else{
   for(let q=0;q<roles.length;q++)if(roles[q]===2){const x=q%w,y=Math.floor(q/w);let nearest=-1,best=Infinity;for(const candidate of core){const distance=(candidate%w-x)**2+(Math.floor(candidate/w)-y)**2;if(distance<best){nearest=candidate;best=distance}}
    const cx=nearest%w,cy=Math.floor(nearest/w),xf=[0,0,0],yf=[0,0,0];let xx=0,xy=0,yy=0
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const p=(top+ny)*width+left+nx;if(coverage[p]<coreThreshold||!donor[p*4+3])continue;const at=(ny*w+nx)*4;xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;for(let c=0;c<3;c++){xf[c]+=dx*(difference[at+c]-difference[nearest*4+c]);yf[c]+=dy*(difference[at+c]-difference[nearest*4+c])}}
    const det=xx*yy-xy*xy;for(let c=0;c<3;c++){const bx=det?(xf[c]*yy-yf[c]*xy)/det:xx?xf[c]/xx:0,by=det?(yf[c]*xx-xf[c]*xy)/det:yy?yf[c]/yy:0;difference[q*4+c]=difference[nearest*4+c]+bx*(x-cx)+by*(y-cy)}
   }
  }
 }
 // A donor's alpha affects strength, never injects invisible RGB into the correction.
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=(top+y)*width+left+x,q=y*w+x,at=p*4;if(softTail?!coverage[p]||donor[at+3]===0:roles[q]!==2)continue
  const amount=coverage[p]/255*opacity,sa=donor[at+3]/255*amount,da=destination[at+3]/255,alpha=protectAlpha?da:sa+da*(1-sa)
  if(protectAlpha&&!da)continue
  for(let c=0;c<3;c++){const floatingColor=Math.max(0,Math.min(255,straight(p,c)+(ringCount&&(!softTail||hasCore)?difference[q*4+c]*adaptation:0))),color=options.quantizeColor?Math.round(floatingColor):floatingColor;output[at+c]=options.stagedQuantization&&protectAlpha?Math.max(0,Math.min(255,destination[at+c]+Math.round((straight(p,c)-destination[at+c])*sa)+Math.round((color-straight(p,c))*sa))):Math.round(protectAlpha?destination[at+c]*(1-sa)+color*sa:alpha?(color*sa+destination[at+c]*da*(1-sa))/alpha:0)}
  output[at+3]=protectAlpha?destination[at+3]:Math.round(alpha*255)
 }
 charge(w*h);return output
}
