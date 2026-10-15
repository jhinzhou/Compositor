/** f5ae5ba DeepLayer.run: deterministic dithered low and 1/2/4-step probe runs,
 * channel-wise least-squares reconstruction. Camera Raw uses ten independent
 * color probes; never flatten the original source to one PNG8 operation. */
import {EditorError} from './contracts'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from './deep-pixels'
import {applyImageFilter,imageFilterSchema,type ImageFilter} from './image-filters'
const F=Math.fround,RATIO=F(255/65535),round=(v:number)=>Math.floor(v+.5)
export type DeepByteOperation=(premultiplied:Uint8Array,width:number,height:number)=>Uint8Array
function geometry(deep:Uint16Array,width:number,height:number,bytesPerPixel:number):void {
 const count=width*height;if(!(deep instanceof Uint16Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(count)||count>MAX_DEEP_PIXELS||deep.length!==count*4)throw new EditorError('INVALID_ARGUMENT','Invalid dense deep filter source.')
 if(deep.byteLength+count*bytesPerPixel>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','High-depth filter runs exceed their 512 MiB working budget.')
 for(let at=0;at<deep.length;at+=4)if(deep[at]>deep[at+3]||deep[at+1]>deep[at+3]||deep[at+2]>deep[at+3])throw new EditorError('INVALID_ARGUMENT','Deep filter probes require premultiplied RGBA16.')
}
function noise(x:number,y:number,c:number):number {let h=(Math.imul(x,0x9e3779b1)^Math.imul(y,0x85ebca77)^Math.imul(c+1,0xc2b2ae3d))>>>0;h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);h^=h>>>12;h=Math.imul(h,0x297a2d39);h^=h>>>15;return F((h>>>8)/16777216)}
function low(value:number,alpha:number,x:number,y:number,c:number):number {return Math.max(0,Math.min(alpha,Math.floor(F(F(value*RATIO)+noise(x,y,c)))-1))}
function past(value:number,l:number):number {return Math.max(0,Math.min(2,F(F(value*RATIO)-l)))}
export function splitDeepPixels(deep:Uint16Array,width:number,height:number,step=0,channel=-1):Uint8Array {
 geometry(deep,width,height,4);if(![0,1,2,4].includes(step)||![-1,0,1,2].includes(channel))throw new EditorError('INVALID_ARGUMENT','Invalid native deep probe step/channel.')
 const out=new Uint8Array(deep.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,a=round(F(deep[at+3]*RATIO));for(let c=0;c<3;c++)out[at+c]=Math.min(a,low(deep[at+c],a,x,y,c)+(channel<0||channel===c?step:0));out[at+3]=a}return out
}
function change(l:number,s1:number,s2:number,s4:number,p:number,room:number):{change:number;offset:number;fit:boolean} {
 if(room<=0)return {change:0,offset:0,fit:false}
 const steps=room===1||p<1?F(F(s1-l)*Math.min(p,1)):F(F(s1-l)+F(F(s2-s1)*F(p-1))),fallback={change:steps,offset:0,fit:false};if(room<4)return fallback
 const mean=F(F(F(F(l+s1)+s2)+s4)/4),slope=F(F(F(F(F(-1.75*l)+F(-.75*s1))+F(.25*s2))+F(2.25*s4))/8.75),start=F(mean-F(slope*1.75)),off=Math.max(Math.abs(F(l-start)),Math.abs(F(F(s1-start)-slope)),Math.abs(F(F(s2-start)-F(2*slope))),Math.abs(F(F(s4-start)-F(4*slope))))
 return off>1?fallback:{change:F(slope*p),offset:F(start-l),fit:true}
}
function checkByteResults(results:Uint8Array[],length:number):void {for(const bytes of results){if(!(bytes instanceof Uint8Array)||bytes.length!==length)throw new EditorError('INVALID_ARGUMENT','Deep operations must return same-size premultiplied RGBA8.');for(let at=0;at<bytes.length;at+=4)if(bytes[at]>bytes[at+3]||bytes[at+1]>bytes[at+3]||bytes[at+2]>bytes[at+3])throw new EditorError('INVALID_ARGUMENT','Deep operation results must be premultiplied RGBA8.')}}
export function mergeDeepPixels(deep:Uint16Array,width:number,height:number,lowResult:Uint8Array,near:Uint8Array[],mid:Uint8Array[],far:Uint8Array[],mixes=false):Uint16Array {
 geometry(deep,width,height,8+(mixes?10:4)*4);const n=mixes?3:1;if(near.length!==n||mid.length!==n||far.length!==n)throw new EditorError('INVALID_ARGUMENT','Wrong deep probe result count.');checkByteResults([lowResult,...near,...mid,...far],deep.length)
 const out=new Uint16Array(deep.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,a=round(F(deep[at+3]*RATIO)),outAlpha=F(lowResult[at+3]*257),lo=[0,1,2].map(c=>low(deep[at+c],a,x,y,c)),p=[0,1,2].map(c=>past(deep[at+c],lo[c])),room=lo.map(v=>a-v)
  for(let c=0;c<3;c++){const l=lowResult[at+c];let value=l,offset=0,fits=0;for(let k=mixes?0:c;k<(mixes?3:c+1);k++){const r=mixes?k:0,delta=change(l,near[r][at+c],mid[r][at+c],far[r][at+c],p[k],room[k]);value=F(value+delta.change);if(delta.fit){offset=F(offset+delta.offset);fits++}}if(fits)value=F(value+F(offset/fits));out[at+c]=round(Math.max(0,Math.min(outAlpha,F(value*257))))}out[at+3]=round(outAlpha)
 }return out
}
export function runDeepOperation(deep:Uint16Array,width:number,height:number,operation:DeepByteOperation,mixes=false):Uint16Array {
 geometry(deep,width,height,mixes?100:72);if(typeof operation!=='function')throw new EditorError('INVALID_ARGUMENT','Deep filter requires a pixel operation.')
 const run=(step:number,c:number)=>{const result=operation(splitDeepPixels(deep,width,height,step,c),width,height);checkByteResults([result],deep.length);return result},lo=run(0,-1),channels=mixes?[0,1,2]:[-1],near=channels.map(c=>run(1,c)),mid=channels.map(c=>run(2,c)),far=channels.map(c=>run(4,c));return mergeDeepPixels(deep,width,height,lo,near,mid,far,mixes)
}
/** Raw's color mixers, Tonal Contrast's brightness and Scanlines depend on all
 * input channels. Native FilterKind.mixesChannels requests ten runs for these. */
export function deepFilterMixesChannels(filter:ImageFilter):boolean {return ['cameraRaw','tonalContrast','scanlines'].includes(filter.kind)}
export function runDeepFilter(deep:Uint16Array,width:number,height:number,input:unknown,mixes?:boolean):Uint16Array {
 const filter=imageFilterSchema.parse(input)
 return runDeepOperation(deep,width,height,base=>{const straight=new Uint8ClampedArray(base.length);for(let at=0;at<base.length;at+=4){const a=base[at+3];for(let c=0;c<3;c++)straight[at+c]=a?Math.min(255,Math.round(base[at+c]*255/a)):0;straight[at+3]=a}const filtered=applyImageFilter({width,height,data:straight},filter),out=new Uint8Array(base.length);if(filtered.width!==width||filtered.height!==height)throw new EditorError('UNSUPPORTED_FEATURE','Deep filter operations must keep source geometry.');for(let at=0;at<out.length;at+=4){const a=filtered.data[at+3];for(let c=0;c<3;c++)out[at+c]=Math.round(filtered.data[at+c]*a/255);out[at+3]=a}return out},mixes??deepFilterMixesChannels(filter))
}
