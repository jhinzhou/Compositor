import {EditorError} from './errors'
import {gaussianLineConvolver} from './image-filter-algorithms'
export interface ProgressiveBlurSettings {from:number;to:number;start?:[number,number];end?:[number,number];radial:boolean;inverted:boolean}
export interface ProgressiveBlurPlacement {origin:[number,number];size:[number,number];rotation:number;flipX:boolean;flipY:boolean}
export interface ProgressiveBlurSides {left?:boolean;right?:boolean;top?:boolean;bottom?:boolean}
/** Native session initial line: visible layer at35% of its height to its foot.
 * Endpoints remain document coordinates; rotation/flips are handled at execution. */
export function defaultProgressiveBlurLine(placement:ProgressiveBlurPlacement,canvas:[number,number]):{start:[number,number];end:[number,number]} {
 let left=Math.max(0,placement.origin[0]),top=Math.max(0,placement.origin[1]),right=Math.min(canvas[0],placement.origin[0]+placement.size[0]),bottom=Math.min(canvas[1],placement.origin[1]+placement.size[1])
 if(right<=left||bottom<=top){left=0;top=0;right=canvas[0];bottom=canvas[1]}
 return {start:[(left+right)/2,top+(bottom-top)*.35],end:[(left+right)/2,bottom]}
}
export function progressiveBlurSourceLine(settings:ProgressiveBlurSettings,width:number,height:number,placement?:ProgressiveBlurPlacement):{start:[number,number];end:[number,number]} {
 const source=(p:[number,number]):[number,number]=>{if(!placement)return [...p];const r=placement.rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r),dx=p[0]-placement.origin[0]-placement.size[0]/2,dy=p[1]-placement.origin[1]-placement.size[1]/2;return [((dx*c+dy*s)*(placement.flipX?-1:1)/placement.size[0]+.5)*width,((-dx*s+dy*c)*(placement.flipY?-1:1)/placement.size[1]+.5)*height]}
 const start=settings.start?source(settings.start):[width/2,0] as [number,number];let end=settings.end?source(settings.end):[width/2,height] as [number,number]
 if([...start,...end].some(v=>!Number.isFinite(v))||!Number.isFinite(Math.hypot(end[0]-start[0],end[1]-start[1])))throw new EditorError('INVALID_ARGUMENT','Invalid Progressive Blur endpoint mapping.')
 if(Math.hypot(end[0]-start[0],end[1]-start[1])<1)end=[start[0],start[1]+1]
 return {start,end}
}
export function progressiveBlurRadiusAt(settings:ProgressiveBlurSettings,line:{start:[number,number];end:[number,number]},x:number,y:number):number {
 const dx=line.end[0]-line.start[0],dy=line.end[1]-line.start[1],length=Math.hypot(dx,dy),share=Math.max(0,Math.min(1,settings.radial?Math.hypot(x-line.start[0],y-line.start[1])/length:((x-line.start[0])*(dx/length)+(y-line.start[1])*(dy/length))/length)),from=settings.inverted?settings.to:settings.from,to=settings.inverted?settings.from:settings.to
 return from+(to-from)*share
}
function scales(max:number):number[]{const result=[0];if(max<=0)return result;for(let r=.5;r<max;r*=2)result.push(r);result.push(max);return result}
export function assertProgressiveBlurBudget(width:number,height:number,settings:ProgressiveBlurSettings):number[] {
 const n=width*height,max=Math.max(settings.from,settings.to),levels=settings.from===settings.to?[0,max]:scales(max)
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!Number.isSafeInteger(n)||width<1||height<1||![settings.from,settings.to].every(v=>Number.isFinite(v)&&v>=0))throw new EditorError('INVALID_ARGUMENT','Invalid Progressive Blur surface.')
 if(!max)return [0]
 let work=0,fftBytes=0
 for(const sigma of levels.slice(1)){const radius=Math.max(1,Math.ceil(sigma*3)),kernel=2*radius+1,pass=(length:number)=>{let padded=1;while(padded<length+radius*4)padded*=2;fftBytes=Math.max(fftBytes,kernel>33?padded*64:0);return kernel>33?3*padded*Math.log2(padded):length*kernel};work+=4*(height*pass(width)+width*pass(height))}
 if(work>500_000_000||n*76+fftBytes+(width+height)*16>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Progressive Blur exceeds its bounded multiscale working budget.',{estimatedWork:work,estimatedBytes:n*76+fftBytes+(width+height)*16})
 return levels
}
/** Bounded multiscale approximation to native CIMaskedVariableBlur. Same spatial
 * radius field, not an assertion of CoreImage private kernel pixel identity.
 * Float32 premultiplied data, including signed/overwhite HDR, never uses PNG8. */
export function progressiveBlurPixels(source:Float32Array,width:number,height:number,settings:ProgressiveBlurSettings,sides:ProgressiveBlurSides={},placement?:ProgressiveBlurPlacement):Float32Array {
 const levels=assertProgressiveBlurBudget(width,height,settings),n=width*height,max=Math.max(settings.from,settings.to)
 if(!(source instanceof Float32Array)||source.length!==n*4)throw new EditorError('INVALID_ARGUMENT','Invalid Progressive Blur source.')
 if(!max)return source.slice()
 const line=progressiveBlurSourceLine(settings,width,height,placement),radii=new Float32Array(n),output=new Float32Array(source.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)radii[y*width+x]=progressiveBlurRadiusAt(settings,line,x+.5,y+.5)
 let previous=source
 for(let l=1;l<levels.length;l++){
  const radius=levels[l],low=levels[l-1],next=gaussian(source,width,height,radius,sides)
  for(let i=0;i<n;i++){const r=Math.min(max,radii[i]);if(r<low||r>radius||l>1&&r===low)continue;const amount=(r*r-low*low)/(radius*radius-low*low),at=i*4;for(let c=0;c<4;c++)output[at+c]=previous[at+c]+(next[at+c]-previous[at+c])*amount}
  previous=next
 }
 return output
}
function gaussian(source:Float32Array,width:number,height:number,sigma:number,sides:ProgressiveBlurSides):Float32Array {
 const out=new Float32Array(source.length),temp=new Float32Array(width*height),row=new Float32Array(width),column=new Float32Array(height),horizontal=gaussianLineConvolver(width,sigma,{start:sides.left,end:sides.right}),vertical=gaussianLineConvolver(height,sigma,{start:sides.top,end:sides.bottom})
 for(let c=0;c<4;c++){for(let y=0;y<height;y++){for(let x=0;x<width;x++)row[x]=source[(y*width+x)*4+c];temp.set(horizontal(row),y*width)}for(let x=0;x<width;x++){for(let y=0;y<height;y++)column[y]=temp[y*width+x];const result=vertical(column);for(let y=0;y<height;y++)out[(y*width+x)*4+c]=result[y]}}
 return out
}
