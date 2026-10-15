import {EditorError,type Transform} from './contracts'
import type {RGBA} from './pixel-contracts'
export const MIXER_BRUSH_LIMITS={pixels:4_000_000,work:120_000_000,dabs:50_000,points:10_000} as const
export interface MixerBrushReservoir {premultipliedColor:[number,number,number,number];paintRemaining:number}
export interface MixerBrushSettings {wet:number;load:number;mix:number;flow:number;color:RGBA;cleanAfterStroke:boolean;loadAfterStroke:boolean;colorPickup:'average'|'tip'}
export interface MixerBrushStroke extends MixerBrushSettings {points:[number,number][];size:number;hardness:number;opacity:number;spacing?:number;protectAlpha?:boolean}
export interface MixerBrushGrid {width:number;height:number;transform:Transform;canvasWidth:number;canvasHeight:number}
export type MixerBrushPixels=Uint8Array|Uint16Array|Float32Array
const clamp=(v:number)=>Math.max(0,Math.min(1,v)),F=Math.fround
export function cleanMixerBrushReservoir():MixerBrushReservoir{return {premultipliedColor:[0,0,0,0],paintRemaining:0}}
export function loadMixerBrushReservoir(color:RGBA,load:number):MixerBrushReservoir {if(color.length!==4||color.some(v=>!Number.isFinite(v)||v<0||v>1)||!Number.isFinite(load)||load<0||load>1)throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush paint load.');return {premultipliedColor:[color[0]*color[3],color[1]*color[3],color[2]*color[3],color[3]],paintRemaining:load}}
export function validateMixerBrushReservoir(value:MixerBrushReservoir):void {if(!value||!Array.isArray(value.premultipliedColor)||value.premultipliedColor.length!==4||value.premultipliedColor.some(v=>!Number.isFinite(v))||value.premultipliedColor[3]<0||value.premultipliedColor[3]>1||!Number.isFinite(value.paintRemaining)||value.paintRemaining<0||value.paintRemaining>1||value.premultipliedColor[3]===0&&value.premultipliedColor.slice(0,3).some(v=>v!==0))throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush reservoir snapshot.')}
export function validateMixerBrushStroke(action:MixerBrushStroke):void {
 if(!action||!Array.isArray(action.points)||action.points.length<1||action.points.length>MIXER_BRUSH_LIMITS.points||action.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1_000_000))||!Number.isFinite(action.size)||action.size<1||action.size>4096||[action.hardness,action.opacity,action.wet,action.load,action.mix,action.flow].some(v=>!Number.isFinite(v)||v<0||v>1)||action.spacing!==undefined&&(!Number.isFinite(action.spacing)||action.spacing<.01||action.spacing>10)||!['average','tip'].includes(action.colorPickup)||typeof action.cleanAfterStroke!=='boolean'||typeof action.loadAfterStroke!=='boolean')throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush stroke settings.')
 loadMixerBrushReservoir(action.color,action.load)
}
/** Practical wet-paint approximation, not a recovered Photoshop Mixer solver.
 * Every arc-length dab reads the evolving canvas, picks up pigment into an
 * explicit reservoir, deposits a mixture and consumes its load. Input raster
 * and reservoir are immutable, so speculative previews cannot advance paint. */
export function mixBrushStroke<T extends MixerBrushPixels>(source:T,grid:MixerBrushGrid,action:MixerBrushStroke,inputReservoir?:MixerBrushReservoir,options:{selectionCoverage?:Uint8Array;signal?:AbortSignal;maximumWork?:number}={}):{pixels:T;reservoir:MixerBrushReservoir;affectedPixels:number} {
 validateMixerBrushStroke(action);const reservoir=inputReservoir?structuredClone(inputReservoir):loadMixerBrushReservoir(action.color,action.load);validateMixerBrushReservoir(reservoir)
 const {width,height,transform:t}=grid,count=width*height,budget=options.maximumWork??MIXER_BRUSH_LIMITS.work
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||count>MIXER_BRUSH_LIMITS.pixels||source.length!==count*4||!(source instanceof Uint8Array||source instanceof Uint16Array||source instanceof Float32Array)||options.selectionCoverage&&options.selectionCoverage.length!==count||!Number.isFinite(budget)||budget<0||budget>MIXER_BRUSH_LIMITS.work||!Number.isFinite(t.rotation)||t.origin.some(v=>!Number.isFinite(v))||t.size.some(v=>!Number.isFinite(v)||v<=0))throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush raster or compute budget.')
 let work=0,dabs=0;const charge=(n:number)=>{work+=n;if(options.signal?.aborted)throw new EditorError('CANCELED','Mixer Brush was canceled.');if(work>budget)throw new EditorError('RESOURCE_LIMIT','Mixer Brush exceeds its stroke compute budget.')}
 charge(count);const scale=source instanceof Uint8Array?255:source instanceof Uint16Array?65535:1,straight=source instanceof Uint8Array
 for(let at=0;at<source.length;at+=4){const alpha=source[at+3]/scale;if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush source alpha.');for(let c=0;c<3;c++)if(!Number.isFinite(source[at+c])||!straight&&(source instanceof Uint16Array&&source[at+c]>source[at+3]||!alpha&&source[at+c]!==0))throw new EditorError('INVALID_ARGUMENT','Mixer Brush requires finite premultiplied high-depth samples.')}
 const output=(source instanceof Uint8Array?Uint8Array.from(source):source.slice()) as T
 if(!action.opacity||!action.flow)return {pixels:output,reservoir,affectedPixels:0}
 reservoir.paintRemaining=Math.min(reservoir.paintRemaining,action.load)
 charge(count);const working=new Float32Array(source.length),touched=new Uint8Array(count)
 for(let at=0;at<source.length;at+=4){const a=source[at+3]/scale;working[at+3]=a;for(let c=0;c<3;c++)working[at+c]=straight?source[at+c]/scale*a:source[at+c]/scale}
 const angle=t.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),spacing=Math.max(.25,action.size*(action.spacing??.1)),radius=action.size/2,aa=Math.max(.001,Math.min(t.size[0]/width,t.size[1]/height)),edgeFloor=Math.exp(-2.5)
 const local=(x:number,y:number):[number,number]=>{const dx=x-t.origin[0]-t.size[0]/2,dy=y-t.origin[1]-t.size[1]/2;return [((dx*cos+dy*sin)*(t.flipX?-1:1)/t.size[0]+.5)*width,((-dx*sin+dy*cos)*(t.flipY?-1:1)/t.size[1]+.5)*height]}
 const document=(x:number,y:number):[number,number]=>{const u=(x/width-.5)*t.size[0]*(t.flipX?-1:1),v=(y/height-.5)*t.size[1]*(t.flipY?-1:1);return [t.origin[0]+t.size[0]/2+u*cos-v*sin,t.origin[1]+t.size[1]/2+u*sin+v*cos]}
 const tipSample=(x:number,y:number):[number,number,number,number]=>{const [sx,sy]=local(x,y),x0=Math.floor(sx-.5),y0=Math.floor(sy-.5),fx=sx-.5-x0,fy=sy-.5-y0,sample:[number,number,number,number]=[0,0,0,0];for(let j=0;j<2;j++)for(let i=0;i<2;i++){const X=x0+i,Y=y0+j;if(X<0||Y<0||X>=width||Y>=height)continue;const weight=(i?fx:1-fx)*(j?fy:1-fy);for(let c=0;c<4;c++)sample[c]+=working[(Y*width+X)*4+c]*weight}return sample}
 const stamp=(x:number,y:number)=>{
  if(++dabs>MIXER_BRUSH_LIMITS.dabs)throw new EditorError('RESOURCE_LIMIT','Mixer Brush exceeds its dab budget.')
  const [sx,sy]=local(x,y),rx=(radius+aa)*width/t.size[0],ry=(radius+aa)*height/t.size[1],left=Math.max(0,Math.floor(sx-rx)),right=Math.min(width,Math.ceil(sx+rx)),top=Math.max(0,Math.floor(sy-ry)),bottom=Math.min(height,Math.ceil(sy+ry)),sample:[number,number,number,number]=[0,0,0,0];let total=0
  const dabWeight=(X:number,Y:number)=>{const [docX,docY]=document(X+.5,Y+.5);if(docX<0||docY<0||docX>=grid.canvasWidth||docY>=grid.canvasHeight)return 0;const distance=Math.hypot(docX-x,docY-y),edge=action.hardness===1?clamp((radius-distance)/aa+.5):Math.max(0,(Math.exp(-2.5*clamp((distance/radius-action.hardness)/(1-action.hardness))**2)-edgeFloor)/(1-edgeFloor)),p=Y*width+X;return action.protectAlpha&&source[p*4+3]===0?0:edge*(options.selectionCoverage?options.selectionCoverage[p]/255:1)}
  charge(Math.max(0,right-left)*Math.max(0,bottom-top)*2)
  for(let Y=top;Y<bottom;Y++){charge(0);for(let X=left;X<right;X++){
   const p=Y*width+X,weight=dabWeight(X,Y);if(!weight)continue;total+=weight;for(let c=0;c<4;c++)sample[c]+=working[p*4+c]*weight
  }}
  if(!total)return
  for(let c=0;c<4;c++)sample[c]/=total
  if(action.colorPickup==='tip'){const tip=tipSample(x,y);for(let c=0;c<4;c++)sample[c]=tip[c]}
  const loaded=[...reservoir.premultipliedColor],picked=loaded.map((v,c)=>v+(sample[c]-v)*action.wet),paint=loaded.map((v,c)=>v+(picked[c]-v)*action.mix)
  reservoir.paintRemaining=clamp(reservoir.paintRemaining+action.wet*sample[3]*(1-reservoir.paintRemaining))
  const strength=action.flow*reservoir.paintRemaining
  for(let Y=top;Y<bottom;Y++){charge(0);for(let X=left;X<right;X++){const p=Y*width+X,weight=dabWeight(X,Y),at=p*4,amount=weight*strength,sa=paint[3]*amount,da=working[at+3];if(!sa)continue;touched[p]=1
   if(action.protectAlpha){for(let c=0;c<3;c++)working[at+c]=F(working[at+c]*(1-sa)+(paint[3]?paint[c]/paint[3]*da:0)*sa)}else{for(let c=0;c<3;c++)working[at+c]=F(paint[c]*amount+working[at+c]*(1-sa));working[at+3]=F(sa+da*(1-sa))}
   for(let c=0;c<4;c++)if(!Number.isFinite(working[at+c]))throw new EditorError('RESOURCE_LIMIT','Mixer Brush HDR paint exceeds finite Float32 range.')
  }}
  for(let c=0;c<4;c++)reservoir.premultipliedColor[c]=picked[c]
  // Local approximation: load is consumed per brush-diameter travelled; Wet
  // refills from canvas pigment. This constant is not Adobe's private formula.
  reservoir.paintRemaining=clamp(reservoir.paintRemaining-action.flow*(spacing/action.size)*.05)
 }
 stamp(...action.points[0]);let carry=spacing
 for(let i=1;i<action.points.length;i++){const a=action.points[i-1],b=action.points[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);let distance=carry;while(distance<=length){stamp(a[0]+dx*distance/length,a[1]+dy*distance/length);distance+=spacing}carry=distance-length}
 let affectedPixels=0
 for(let y=0;y<height;y++){charge(width);for(let x=0;x<width;x++){const p=y*width+x;if(!touched[p])continue;const at=p*4,originalAlpha=source[at+3]/scale,alpha=action.protectAlpha?originalAlpha:originalAlpha+(working[at+3]-originalAlpha)*action.opacity
  for(let c=0;c<3;c++){const original=straight?source[at+c]/scale*originalAlpha:source[at+c]/scale,value=original+(working[at+c]-original)*action.opacity;output[at+c]=straight?Math.round(clamp(alpha?value/alpha:0)*255):source instanceof Uint16Array?Math.round(Math.max(0,Math.min(alpha,value))*65535):F(alpha?value:0)}
  output[at+3]=straight?Math.round(alpha*255):source instanceof Uint16Array?Math.round(alpha*65535):F(alpha);if([0,1,2,3].some(c=>output[at+c]!==source[at+c]))affectedPixels++
 }}
 let next=reservoir;if(action.cleanAfterStroke)next=cleanMixerBrushReservoir();if(action.loadAfterStroke)next=loadMixerBrushReservoir(action.color,action.load);return {pixels:output,reservoir:next,affectedPixels}
}
