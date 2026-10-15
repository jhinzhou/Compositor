// TypeScript port of latest Compositor Rendering/PatchPixels.c (6aea90a).
// Copyright (c) 2026 Wonder Assembly LLC; MIT notice: licenses/Compositor-MIT.txt.
// Changes: private output, deterministic sequential row bands, Float32 arithmetic,
// bounded memory/work and cancellation checkpoints. No source pixels are changed.
import { EditorError, LIMITS } from './contracts'
import { healMembrane } from './native-membrane'
const byteRaster=(value:unknown):boolean=>value instanceof Uint8Array||value instanceof Uint8ClampedArray
const F=Math.fround, MAX=F(3.4028234663852886e38), CH=6, R=3
export interface PatchFillOptions { seed?:number; maximumWork?:number; signal?:AbortSignal }
export interface PatchFillResult {data:Uint8Array;status:0|1;donorCount:number;filledPixels:number;levels:number;work:number;estimatedPeakBytes:number}
interface Level {w:number;h:number;color:Float32Array;hole:Uint8Array;known:Uint8Array;source:Uint8Array;target:Uint8Array;counts:Uint8Array;match:Int32Array;distance:Float32Array;sources:Int32Array;sourceCount:number}
const level=(w:number,h:number):Level=>({w,h,color:new Float32Array(w*h*CH),hole:new Uint8Array(w*h),known:new Uint8Array(w*h),source:new Uint8Array(w*h),target:new Uint8Array(w*h),counts:new Uint8Array(w*h),match:new Int32Array(w*h),distance:new Float32Array(w*h),sources:new Int32Array(w*h),sourceCount:0})
function next(state:number):number {let x=state;x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)||0x9e3779b9}
const evenRound=(v:number):number=>{const floor=Math.floor(v),fraction=v-floor;return fraction<.5?floor:fraction>.5?floor+1:floor%2?floor+1:floor}
/** Preflight before caller/IPC snapshots. Retained bytes account for PNG conversion,
 * queued jobs and process transport separately from this kernel's own storage. */
export function preflightPatchFill(rgba:Uint8Array,hole:Uint8Array,width:number,height:number,options:PatchFillOptions={},retainedBytes=0):number {
 const n=width*height,budget=options.maximumWork??120_000_000,seed=options.seed??0
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||n>LIMITS.maxSurfacePixels||!byteRaster(rgba)||!byteRaster(hole)||rgba.length!==n*4||hole.length!==n)throw new EditorError('INVALID_ARGUMENT','Patch fill requires equal-sized RGBA and selection rasters.')
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isFinite(budget)||budget<0||budget>500_000_000||!Number.isFinite(retainedBytes)||retainedBytes<0)throw new EditorError('INVALID_ARGUMENT','Invalid patch fill seed or compute budget.')
 if(options.signal?.aborted)throw new EditorError('CANCELED','Content fill was canceled.')
 if(n>budget)throw new EditorError('RESOURCE_LIMIT','Content fill exceeds the patch-search budget; use a smaller image or selection.')
 let x0=width,y0=height,x1=0,y1=0
 for(let y=0;y<height;y++){if(y%256===0&&options.signal?.aborted)throw new EditorError('CANCELED','Content fill was canceled.');for(let x=0;x<width;x++)if(hole[y*width+x]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1)}}
 const size=Math.max(x1-x0,y1-y0),margin=Math.max(64,size),area=x1>x0?(Math.min(width,x1+margin)-Math.max(0,x0-margin))*(Math.min(height,y1+margin)-Math.max(0,y0-margin)):0
 let inputBytes=0;for(const buffer of new Set<ArrayBufferLike>([rgba.buffer,hole.buffer]))inputBytes+=buffer.byteLength
 const peak=inputBytes+n*4+area*192+65536+retainedBytes
 if(peak>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Patch fill exceeds the 512 MiB memory budget; use a smaller image or selection.')
 return peak
}
/** Premultiplied RGBA8; nonzero coverage is a hole. Only fully opaque, unselected
 * 7x7 patches are donors. No-source returns an unchanged private copy for Heal fallback. */
export function patchFillPremultiplied(rgba:Uint8Array,hole:Uint8Array,width:number,height:number,options:PatchFillOptions={}):PatchFillResult {
 const preflightPeak=preflightPatchFill(rgba,hole,width,height,options)
 const n=width*height,budget=options.maximumWork??120_000_000,seed=options.seed??0
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||n>LIMITS.maxSurfacePixels||!byteRaster(rgba)||!byteRaster(hole)||rgba.length!==n*4||hole.length!==n)throw new EditorError('INVALID_ARGUMENT','Patch fill requires equal-sized RGBA and selection rasters.')
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isFinite(budget)||budget<0||budget>500_000_000)throw new EditorError('INVALID_ARGUMENT','Invalid patch fill seed or compute budget.')
 let work=0
 const charge=(amount:number):void=>{work+=amount;if(options.signal?.aborted)throw new EditorError('CANCELED','Content fill was canceled.');if(work>budget)throw new EditorError('RESOURCE_LIMIT','Content fill exceeds the patch-search budget; use a smaller image or selection.')}
 charge(n*2)
 let x0=width,y0=height,x1=0,y1=0,filledPixels=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(hole[y*width+x]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);filledPixels++}
 const size=Math.max(x1-x0,y1-y0),margin=Math.max(64,size),bx0=Math.max(0,x0-margin),by0=Math.max(0,y0-margin),bx1=Math.min(width,x1+margin),by1=Math.min(height,y1+margin)
 const count=filledPixels?(bx1-bx0)*(by1-by0):0,backings=new Set<ArrayBufferLike>([rgba.buffer,hole.buffer]);let inputBytes=0;for(const b of backings)inputBytes+=b.byteLength
 // 192 bytes/local pixel covers all pyramid levels and unreclaimed temporary arrays
 // (six-channel storage, SATs, snapshots, texture, vote, membrane) plus private output.
 const estimatedPeakBytes=Math.max(preflightPeak,inputBytes+n*4+count*192+65536)
 if(estimatedPeakBytes>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Patch fill exceeds the 512 MiB memory budget; use a smaller image or selection.')
 const output=new Uint8Array(rgba)
 const result=(status:0|1,donorCount=0,levels=0):PatchFillResult=>{charge(0);return {data:output,status,donorCount,filledPixels,levels,work,estimatedPeakBytes}}
 if(!filledPixels)return result(1)
 function classify(L:Level):void {
  const {w,h}=L,stride=w+1,known=new Float64Array(stride*(h+1)),holes=new Float64Array(stride*(h+1));charge(w*h*2)
  for(let y=0;y<h;y++){let k=0,t=0;for(let x=0;x<w;x++){k+=L.known[y*w+x];t+=L.hole[y*w+x];known[(y+1)*stride+x+1]=known[y*stride+x+1]+k;holes[(y+1)*stride+x+1]=holes[y*stride+x+1]+t}}
  const sum=(sat:Float64Array,x0:number,y0:number,x1:number,y1:number)=>sat[y1*stride+x1]-sat[y0*stride+x1]-sat[y1*stride+x0]+sat[y0*stride+x0]
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,a=Math.max(0,x-R),b=Math.max(0,y-R),c=Math.min(w,x+R+1),d=Math.min(h,y+R+1),t=sum(holes,a,b,c,d);L.target[p]=t>0?1:0;L.counts[p]=t+sum(known,a,b,c,d);L.source[p]=x>=R&&y>=R&&x+R<w&&y+R<h&&sum(known,x-R,y-R,x+R+1,y+R+1)===49?1:0;if(L.source[p])L.sources[L.sourceCount++]=p}
 }
 function distance(L:Level,p:number,q:number,best=MAX):number {
  const {w,h,color}=L,px=p%w,py=Math.floor(p/w),qx=q%w,qy=Math.floor(q/w),limit=best===MAX?MAX:F(best*L.counts[p]);let sum=0
  for(let dy=-R;dy<=R;dy++){const y=py+dy;if(y<0||y>=h)continue;for(let dx=-R;dx<=R;dx++){const x=px+dx,a=y*w+x;if(x<0||x>=w||!(L.hole[a]||L.known[a]))continue;charge(1);const b=((qy+dy)*w+qx+dx)*CH;for(let c=0;c<CH;c++){const d=F(color[a*CH+c]-color[b+c]);sum=F(sum+F(d*d))}}if(sum>=limit)return MAX}
  return L.counts[p]?F(sum/L.counts[p]):MAX
 }
 function measure(L:Level):void {charge(L.w*L.h);for(let p=0;p<L.w*L.h;p++)if(L.target[p])L.distance[p]=distance(L,p,L.match[p])}
 function pass(L:Level,forward:boolean,seed:number,before:Int32Array):void {
  const {w,h}=L,step=forward?1:-1,reach=Math.max(w,h),bands=h<32?1:16,bandSize=Math.ceil(h/bands);charge(w*h)
  for(let band=0;band<bands;band++){const start=band*bandSize,end=Math.min(h,start+bandSize);if(start>=end)continue;let state=(seed^Math.imul(band,0x9e3779b9)^0x85ebca6b)>>>0
   for(let i=0;i<end-start;i++){const y=forward?start+i:end-1-i;for(let j=0;j<w;j++){const x=forward?j:w-1-j,p=y*w+x;if(!L.target[p])continue;let best=L.match[p],bestDistance=L.distance[p]
    const consider=(c:number):void=>{if(!L.source[c]||c===best)return;const d=distance(L,p,c,bestDistance);if(d<bestDistance){best=c;bestDistance=d}}
    const nx=x-step,ny=y-step;if(nx>=0&&nx<w&&L.target[y*w+nx]){const m=L.match[y*w+nx];if(m%w+step>=0&&m%w+step<w)consider(m+step)}
    if(ny>=0&&ny<h&&L.target[ny*w+x]){const m=ny>=start&&ny<end?L.match[ny*w+x]:before[ny*w+x];if(Math.floor(m/w)+step>=0&&Math.floor(m/w)+step<h)consider(m+step*w)}
    for(let r=reach;r>=1;r=Math.floor(r/2)){state=next(state);const cx=best%w+state%(2*r+1)-r;state=next(state);const cy=Math.floor(best/w)+state%(2*r+1)-r;if(cx>=0&&cy>=0&&cx<w&&cy<h)consider(cy*w+cx)}L.match[p]=best;L.distance[p]=bestDistance
   }}
  }
 }
 function spread(L:Level,sharpness=1):number {charge(L.w*L.h);let total=0,count=0;for(let p=0;p<L.w*L.h;p++)if(L.target[p]&&L.distance[p]<MAX){total+=L.distance[p];count++}return F(F(F(2*F(count?total/count:1))+1)/sharpness)}
 function predict(L:Level,x:number,y:number,s:number,channels:number,out:Float32Array):number {
  const {w,h,color}=L;out.fill(0);let weights=0
  for(let dy=-R;dy<=R;dy++){const py=y-dy;if(py<0||py>=h)continue;for(let dx=-R;dx<=R;dx++){charge(1);const px=x-dx,p=py*w+px;if(px<0||px>=w||!L.target[p]||L.distance[p]===MAX)continue;const q=L.match[p],at=((Math.floor(q/w)+dy)*w+q%w+dx)*CH,weight=F(Math.exp(F(-L.distance[p]/s)));for(let c=0;c<channels;c++)out[c]=F(out[c]+F(color[at+c]*weight));weights=F(weights+weight)}}
  if(weights>0)for(let c=0;c<channels;c++)out[c]=F(out[c]/weights);return weights
 }
 function vote(L:Level,sharpness:number):void {const s=spread(L,sharpness),out=new Float32Array(CH);for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){const p=y*L.w+x;if(L.hole[p]&&predict(L,x,y,s,CH,out)>0)for(let c=0;c<CH;c++)L.color[p*CH+c]=out[c]}}
 function adapt(L:Level):void {
  const {w,h}=L,s=spread(L),role=new Uint8Array(w*h),offset=new Float32Array(w*h*4),mean=[0,0,0,0],predicted=new Float32Array(4);let edges=0;charge(w*h*9)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(L.hole[p]){role[p]=2;continue}if(!L.known[p])continue;let touches=false;for(let j=-1;j<=1&&!touches;j++)for(let i=-1;i<=1;i++){const qx=x+i,qy=y+j;if(qx>=0&&qy>=0&&qx<w&&qy<h&&L.hole[qy*w+qx]){touches=true;break}}if(!touches||predict(L,x,y,s,4,predicted)<=0)continue;role[p]=1;for(let c=0;c<4;c++){offset[p*4+c]=F(L.color[p*CH+c]-predicted[c]);mean[c]+=offset[p*4+c]}edges++}
  if(edges){for(let p=0;p<w*h;p++)if(role[p]===2)for(let c=0;c<4;c++)offset[p*4+c]=F(mean[c]/edges);healMembrane(offset,role,w,h,0,charge);for(let p=0;p<w*h;p++)if(role[p]===2)for(let c=0;c<4;c++)L.color[p*CH+c]=F(L.color[p*CH+c]+offset[p*4+c])}
 }
 function texture(L:Level):void {
  const {w,h,color}=L,stride=w+1,edge=new Float32Array(w*h*2),sat=new Float64Array(stride*(h+1)*3);charge(w*h*8)
  const luma=(p:number)=>F(F(F(color[p*CH]+color[p*CH+1])+color[p*CH+2])/3)
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(!L.known[p])continue;if(x>0&&x+1<w&&L.known[p-1]&&L.known[p+1])edge[p*2]=F(Math.abs(F(luma(p+1)-luma(p-1)))/2);if(y>0&&y+1<h&&L.known[p-w]&&L.known[p+w])edge[p*2+1]=F(Math.abs(F(luma(p+w)-luma(p-w)))/2)}
  for(let y=0;y<h;y++){const row=[0,0,0];for(let x=0;x<w;x++){const p=y*w+x;row[0]+=edge[p*2];row[1]+=edge[p*2+1];row[2]+=L.known[p];for(let k=0;k<3;k++)sat[((y+1)*stride+x+1)*3+k]=sat[(y*stride+x+1)*3+k]+row[k]}}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(!L.known[p])continue;const x0=Math.max(0,x-2),y0=Math.max(0,y-2),x1=Math.min(w,x+3),y1=Math.min(h,y+3),v=[0,0,0];for(let k=0;k<3;k++)v[k]=sat[(y1*stride+x1)*3+k]-sat[(y0*stride+x1)*3+k]-sat[(y1*stride+x0)*3+k]+sat[(y0*stride+x0)*3+k];color[p*CH+4]=F(F(v[0]/v[2])*6);color[p*CH+5]=F(F(v[1]/v[2])*6)}
 }
 function downsample(A:Level):Level {const C=level(Math.ceil(A.w/2),Math.ceil(A.h/2));charge(C.w*C.h*4);const all=new Float32Array(CH),sure=new Float32Array(CH);for(let y=0;y<C.h;y++)for(let x=0;x<C.w;x++){let present=0,known=0,hole=0;all.fill(0);sure.fill(0);for(let j=0;j<2;j++)for(let i=0;i<2;i++){const fx=2*x+i,fy=2*y+j;if(fx>=A.w||fy>=A.h)continue;const p=fy*A.w+fx;present++;known+=A.known[p];hole|=A.hole[p];for(let c=0;c<CH;c++){all[c]+=A.color[p*CH+c];if(A.known[p])sure[c]+=A.color[p*CH+c]}}const p=y*C.w+x;C.hole[p]=hole;C.known[p]=!hole&&known===present?1:0;for(let c=0;c<CH;c++)C.color[p*CH+c]=known?sure[c]/known:all[c]/present}classify(C);return C}
 function inward(L:Level):void {const {w,h}=L,n=w*h,done=new Uint8Array(L.known),nextDone=new Uint8Array(n),mean=Array(CH).fill(0),sum=new Float32Array(CH);let known=0;charge(n);for(let p=0;p<n;p++)if(L.known[p]){known++;for(let c=0;c<CH;c++)mean[c]+=L.color[p*CH+c]}
  for(let changed=true;changed;){changed=false;nextDone.set(done);charge(n*9);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;if(!L.hole[p]||done[p])continue;sum.fill(0);let around=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const qx=x+i,qy=y+j;if((i||j)&&qx>=0&&qy>=0&&qx<w&&qy<h&&done[qy*w+qx]){for(let c=0;c<CH;c++)sum[c]+=L.color[(qy*w+qx)*CH+c];around++}}if(around){for(let c=0;c<CH;c++)L.color[p*CH+c]=sum[c]/around;nextDone[p]=1;changed=true}}done.set(nextDone)}for(let p=0;p<n;p++)if(L.hole[p]&&!done[p])for(let c=0;c<CH;c++)L.color[p*CH+c]=known?F(mean[c]/known):0
 }
 function randomly(L:Level,seed:number):void {let state=seed|1;charge(L.w*L.h);for(let p=0;p<L.w*L.h;p++)if(L.target[p]){state=next(state);L.match[p]=L.sources[state%L.sourceCount]}}
 function upsample(C:Level,L:Level,seed:number):void {let state=seed|1;charge(L.w*L.h);for(let y=0;y<L.h;y++)for(let x=0;x<L.w;x++){const p=y*L.w+x,c=Math.floor(y/2)*C.w+Math.floor(x/2);if(L.hole[p])for(let k=0;k<CH;k++)L.color[p*CH+k]=C.color[c*CH+k];if(!L.target[p])continue;let candidate=-1;if(C.target[c]){const m=C.match[c],mx=2*(m%C.w)+(x&1),my=2*Math.floor(m/C.w)+(y&1);if(mx<L.w&&my<L.h&&L.source[my*L.w+mx])candidate=my*L.w+mx}if(candidate<0){state=next(state);candidate=L.sources[state%L.sourceCount]}L.match[p]=candidate}}
 function settle(L:Level,iterations:number,seed:number):void {const before=new Int32Array(L.w*L.h);for(let i=0;i<iterations;i++){charge(L.w*L.h);before.set(L.match);pass(L,i%2===0,(seed+Math.imul(i,0x632be5ab))>>>0,before);vote(L,1);measure(L)}}
 const fine=level(bx1-bx0,by1-by0);charge(count)
 for(let y=0;y<fine.h;y++)for(let x=0;x<fine.w;x++){const p=y*fine.w+x,s=((by0+y)*width+bx0+x)*4;fine.hole[p]=hole[(by0+y)*width+bx0+x]?1:0;fine.known[p]=!fine.hole[p]&&rgba[s+3]===255?1:0;for(let c=0;c<4;c++)fine.color[p*CH+c]=rgba[s+c]}
 classify(fine);texture(fine);if(!fine.sourceCount)return result(0,0,1)
 const levels=[fine];for(let span=size;span>28&&levels.length<12;span=Math.floor(span/2)){const prev=levels[levels.length-1];if(prev.w<56||prev.h<56)break;const coarse=downsample(prev);if(!coarse.sourceCount)break;levels.push(coarse)}
 const coarse=levels[levels.length-1];inward(coarse);randomly(coarse,seed);measure(coarse);settle(coarse,12,seed)
 for(let i=levels.length-2;i>=0;i--){const L=levels[i];upsample(levels[i+1],L,(seed+i)>>>0);measure(L);vote(L,1);measure(L);settle(L,i===0?4:6,(seed+0x1000*(i+1))>>>0)}vote(fine,8);adapt(fine)
 charge(count);for(let y=0;y<fine.h;y++)for(let x=0;x<fine.w;x++){const p=y*fine.w+x;if(!fine.hole[p])continue;const t=((by0+y)*width+bx0+x)*4;output[t+3]=evenRound(Math.max(0,Math.min(255,fine.color[p*CH+3])));for(let c=0;c<3;c++)output[t+c]=evenRound(Math.max(0,Math.min(output[t+3],fine.color[p*CH+c])))}return result(1,fine.sourceCount,levels.length)
}
