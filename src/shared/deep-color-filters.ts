import {posterizeChannel,thresholdWhite} from './tonal-discretization';
import { imageFilterSchema, type ImageFilter } from './image-filters';
import { applyDeepColorCube, MAX_DEEP_PIXELS, MAX_DEEP_WORKING_BYTES } from './deep-pixels';

export const DEEP_COLOR_FILTER_KINDS = ['levels', 'curves', 'exposure', 'invert', 'hsl', 'blackWhite', 'colorBalance', 'gradientMap', 'threshold', 'posterize'] as const;
type Kind = typeof DEEP_COLOR_FILTER_KINDS[number];
type Settings = Extract<ImageFilter, {kind: Kind}>;
const f = Math.fround;
const clamp = (v:number) => Math.max(0,Math.min(1,v));
const rgb = (hex:string) => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
function parse(input:unknown):Settings {
  const settings=imageFilterSchema.parse(input);
  if (!(DEEP_COLOR_FILTER_KINDS as readonly string[]).includes(settings.kind)) throw new RangeError('This filter has no supported deep color implementation.');
  return settings as Settings;
}
export function supportsDeepColorFilter(input:unknown):boolean { try { parse(input); return true; } catch { return false; } }
function validate(pixels:Uint16Array,width:number,height:number):void {
  if (!(pixels instanceof Uint16Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(width*height)||width*height>MAX_DEEP_PIXELS||pixels.length!==width*height*4||pixels.byteLength*2+33**3*16>MAX_DEEP_WORKING_BYTES) throw new RangeError('Expected bounded dense premultiplied RGBA16 samples.');
  for(let i=0;i<pixels.length;i+=4) if(pixels[i]>pixels[i+3]||pixels[i+1]>pixels[i+3]||pixels[i+2]>pixels[i+3]) throw new RangeError('Deep RGB must not exceed alpha.');
}
function compileCurve(points:{x:number;y:number}[]):(x:number)=>number {
  const deltas=points.slice(1).map((point,i)=>(point.y-points[i].y)/(point.x-points[i].x));
  const slopes=points.map((_,i)=>i===0?deltas[0]:i===points.length-1?deltas.at(-1)!:deltas[i-1]*deltas[i]<=0?0:2/(1/deltas[i-1]+1/deltas[i]));
  return x=>{if(x<=points[0].x)return points[0].y;if(x>=points.at(-1)!.x)return points.at(-1)!.y;let i=0;while(i<points.length-2&&points[i+1].x<=x)i++;const start=points[i],end=points[i+1],h=end.x-start.x,t=clamp((x-start.x)/h);return Math.max(0,Math.min(255,(2*t**3-3*t*t+1)*start.y+(t**3-2*t*t+t)*h*slopes[i]+(-2*t**3+3*t*t)*end.y+(t**3-t*t)*h*slopes[i+1]));};
}
function toHSL(r:number,g:number,b:number):number[] {
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo,l=(hi+lo)/2;
  if(!d)return [0,0,l];
  let h=hi===r?(g-b)/d:hi===g?(b-r)/d+2:(r-g)/d+4; h*=60;if(h<0)h+=360;
  return [h,Math.min(1,d/(1-Math.abs(2*l-1))),l];
}
function fromHSL(h:number,s:number,l:number):number[] {
  if(s<=0)return [l,l,l]; h=((h%360)+360)%360/60;
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h%2-1)),m=l-c/2;
  const p=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
  return p.map(v=>clamp(v+m));
}
function hueTransform(settings:Extract<Settings,{kind:'hsl'}>):(r:number,g:number,b:number)=>number[] {
  const forward=(a:number,b:number)=>((b-a)%360+360)%360;
  const weight=(band:number[],h:number)=>{const span=forward(band[0],band[3]),at=forward(band[0],h),ramp=forward(band[0],band[1]),end=forward(band[0],band[2]);return !span?1:at>span?0:at<ramp?ramp?at/ramp:1:at<=end?1:span>end?(span-at)/(span-end):1;};
  const responses=Array.from({length:361},(_,h)=>{const response=[settings.hue,settings.saturation,settings.lightness];for(const range of settings.hueRanges){let w=weight(range.band,h);if(settings.invertRange&&settings.activeRange===range.range)w=1-w;response[0]+=range.hue*w;response[1]+=range.saturation*w;response[2]+=range.lightness*w;}return response;});
  return (r,g,b)=>{let [h,s,l]=toHSL(r,g,b),amount=0;
    if(settings.colorize){const selected=settings.hueRanges.find(range=>range.range===settings.activeRange);h=selected?.hue??settings.hue;s=clamp((selected?.saturation??settings.saturation)/100);amount=(selected?.lightness??settings.lightness)/100;}
    else{const response=responses[Math.min(360,Math.max(0,Math.round(h)))];amount=Math.max(-1,Math.min(1,response[2]/100));
      // Real PS references: RGB Lightness precedes the saturation expansion.
      const mixed=[r,g,b].map(v=>amount<0?v*(1+amount):v+(1-v)*amount);[,s,l]=toHSL(mixed[0],mixed[1],mixed[2]);
      h+=response[0];const shift=Math.max(-1,Math.min(1,response[1]/100));s=shift<=0?Math.max(0,s*(1+shift)):shift>=1?s>0?1:0:Math.min(1,s/(1-shift));return fromHSL(h,s,l);}
    amount=Math.max(-1,Math.min(1,amount));l=amount>=0?l+(1-l)*amount:l*(1+amount);return fromHSL(h,s,clamp(l));
  };
}
function nativeLatticeColor(settings:Extract<Settings,{kind:'blackWhite'|'colorBalance'|'gradientMap'}>,r:number,g:number,b:number):number[] {
  // GPUAdjustment builds a 33³ lattice from rounded opaque bytes, then applies native byte kernels.
  const bytes=[r,g,b].map(v=>Math.round(v*255));
  if(settings.kind==='gradientMap'){
    const level=Math.floor((2126*bytes[0]+7152*bytes[1]+722*bytes[2]+5000)/10000),dark=rgb(settings.reversed?settings.highlights:settings.shadows),light=rgb(settings.reversed?settings.shadows:settings.highlights);
    return dark.map((v,c)=>f(Math.round(clamp(v+(light[c]-v)*level/255)*255)/255));
  }
  const color=bytes.map(v=>f(v/255));
  if(settings.kind==='blackWhite'){
    const [rr,gg,bb]=color,mx=Math.max(...color),mn=Math.min(...color),md=f(f(f(f(rr+gg)+bb)-mx)-mn);
    const primary=mx===rr?0:mx===gg?2:4,secondary=mx===rr?gg>=bb?1:5:mx===gg?rr>=bb?1:3:gg>=rr?3:5;
    const gray=clamp(f(f(mn+f(f(md-mn)*f(settings.weights[secondary]/100)))+f(f(mx-md)*f(settings.weights[primary]/100))));
    const output=settings.tint&&settings.tintSaturation>0?fromHSL(settings.tintHue,settings.tintSaturation/100,gray).map(f):[gray,gray,gray];
    return output.map(v=>f(Math.round(f(v*255))/255));
  }
  const brightness=(c:number[])=>f(f(f(f(.299)*c[0])+f(f(.587)*c[1]))+f(f(.114)*c[2]));
  const before=brightness(color);
  for(let c=0;c<3;c++){
    const v=color[c],vb=f(v-f(.333)),vb1=f(f(v+f(.333))-1);
    const shadow=f(clamp(f(f(vb/-.25)+.5))*f(.7)),mid=f(f(clamp(f(f(vb/.25)+.5))*clamp(f(f(vb1/-.25)+.5)))*f(.7)),high=f(clamp(f(f(vb1/.25)+.5))*f(.7));
    color[c]=clamp(f(v+f(f(f(f(settings.shadows[c]/100)*shadow)+f(f(settings.midtones[c]/100)*mid))+f(f(settings.highlights[c]/100)*high))));
  }
  const after=brightness(color);
  if(settings.preserveLuminosity&&after>f(.0001)){const ratio=f(before/after);for(let c=0;c<3;c++)color[c]=clamp(f(color[c]*ratio));}
  return color.map(v=>f(Math.round(f(v*255))/255));
}
const cubeCache=new Map<string,Float32Array>();
/** Native 33³ semantics: HSL corners are full Double colors; other mixed-channel corners run byte kernels.
 * Only lattice corners use bytes. Deep source samples are never quantized.
 */
export function deepColorFilterCube(input:unknown):Float32Array {
  const settings=parse(input);
  if(!['hsl','blackWhite','colorBalance','gradientMap'].includes(settings.kind))throw new RangeError('This filter does not use a deep color cube.');
  const key=JSON.stringify(settings),known=cubeCache.get(key);if(known)return known.slice();
  const transform=settings.kind==='hsl'?hueTransform(settings):(r:number,g:number,b:number)=>nativeLatticeColor(settings as Extract<Settings,{kind:'blackWhite'|'colorBalance'|'gradientMap'}>,r,g,b);
  const cube=new Float32Array(33**3*4);
  for(let b=0;b<33;b++)for(let g=0;g<33;g++)for(let r=0;r<33;r++){const at=(r+g*33+b*33*33)*4;cube.set(transform(r/32,g/32,b/32),at);cube[at+3]=1;}
  if(cubeCache.size>=8)cubeCache.delete(cubeCache.keys().next().value!);cubeCache.set(key,cube);return cube.slice();
}
/** Direct source16 evaluation for channel-separable operations; native 33³ lookup for mixed channels.
 * Source alpha is kept exactly. Selection blending belongs to the command layer.
 */
export function applyDeepColorFilter(pixels:Uint16Array,width:number,height:number,input:unknown):Uint16Array {
  const settings=parse(input);validate(pixels,width,height);
  const identity=settings.kind==='levels'?settings.ranges.every(v=>v.black===0&&v.white===255&&v.gamma===1&&v.outputBlack===0&&v.outputWhite===255):settings.kind==='curves'?settings.channels.every(points=>points[0].x===0&&points.at(-1)!.x===255&&points.every(p=>p.x===p.y)):settings.kind==='exposure'?settings.exposure===0&&settings.offset===0&&settings.gamma===1:settings.kind==='hsl'?!settings.colorize&&settings.hue===0&&settings.saturation===0&&settings.lightness===0&&settings.hueRanges.every(v=>v.hue===0&&v.saturation===0&&v.lightness===0):settings.kind==='colorBalance'?[...settings.shadows,...settings.midtones,...settings.highlights].every(v=>v===0):false;
  if(identity)return pixels.slice();
  if(settings.kind==='hsl'||settings.kind==='blackWhite'||settings.kind==='colorBalance'||settings.kind==='gradientMap')return applyDeepColorCube(pixels,width,height,deepColorFilterCube(settings),33);
  const curves=settings.kind==='curves'?settings.channels.map(compileCurve):undefined;
  const out=pixels.slice(),decode=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,encode=(v:number)=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
  const level=(v:number,s:Extract<Settings,{kind:'levels'}>['ranges'][number])=>(s.outputBlack+clamp((v*255-s.black)/(s.white-s.black))**(1/s.gamma)*(s.outputWhite-s.outputBlack))/255;
  for(let at=0;at<pixels.length;at+=4){const alpha=pixels[at+3];if(!alpha)continue;if(settings.kind==='threshold'){const value=thresholdWhite(pixels[at],pixels[at+1],pixels[at+2],alpha,settings.level)?alpha:0;out.fill(value,at,at+3);continue;}for(let c=0;c<3;c++){const value=pixels[at+c]/alpha;let result:number;
    switch(settings.kind){case 'posterize':result=posterizeChannel(value,settings.levels);break;case 'invert':out[at+c]=alpha-pixels[at+c];continue;case 'levels':result=level(level(value,settings.ranges[c+1]),settings.ranges[0]);break;case 'curves':result=curves![0](curves![c+1](value*255))/255;break;case 'exposure':result=encode(Math.max(0,decode(value)*2**settings.exposure+settings.offset)**(1/settings.gamma));break;}
    out[at+c]=Math.round(clamp(result)*alpha);
  }}return out;
}
