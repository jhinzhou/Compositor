/** Float32 scalar port of f01e298 MetalWarp's rgba16Unorm working semantics.
 * Liquify moves persistent source offsets and samples immutable original pixels;
 * it never resamples the previous dab's color output. Native GPU precision is a separate gate.
 */
import {EditorError} from './contracts';
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from './deep-pixels';
export interface DeepWarpOptions {mode:'smudge'|'liquify';points:[number,number][];size:number;hardness:number;strength:number}
export interface DeepWarpResult {data:Uint16Array;dabs:[number,number][]}
const F=Math.fround,round=(v:number)=>v<0?-Math.floor(-v+.5):Math.floor(v+.5),clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
/** Dense integer-center RGBA16 document grid. Returned output owns its buffer. */
export function warpDeepPremultiplied(image:{width:number;height:number;data:Uint16Array},options:DeepWarpOptions):DeepWarpResult {
 const {width,height,data:original}=image,count=width*height;
 if(!(original instanceof Uint16Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(count)||count>MAX_DEEP_PIXELS||original.length!==count*4)throw new EditorError('INVALID_ARGUMENT','Invalid high-depth warp raster.');
 if(!['smudge','liquify'].includes(options.mode)||!Number.isFinite(options.size)||options.size<1||options.size>4096||!Number.isFinite(options.hardness)||options.hardness<0||options.hardness>1||!Number.isFinite(options.strength)||options.strength<0||options.strength>1||!options.points.length||options.points.length>100_000||options.points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1_000_000)))throw new EditorError('INVALID_ARGUMENT','Invalid high-depth warp parameters.');
 for(let i=0;i<original.length;i+=4)if(original[i]>original[i+3]||original[i+1]>original[i+3]||original[i+2]>original[i+3])throw new EditorError('INVALID_ARGUMENT','High-depth warp requires premultiplied colors.');
 const diameter=Math.max(2,options.size),radius=Math.ceil(diameter/2),side=2*radius+1,strength=F(Math.max(.01,options.strength)),hardness=F(Math.min(.98,options.hardness)),inverseRadius=F(1/F(diameter/2)),spacing=Math.max(1,diameter*(options.mode==='smudge'?.005:.025));
 // Bound all dabs and maximum scratch before allocating output, carried colors or offsets.
 const dabs:{center:[number,number];move:[number,number];bounds:[number,number,number,number]}[]=[];let last=options.points[0],visits=0,maxScratch=0;
 if(options.strength)for(const point of options.points.slice(1)){const distance=Math.hypot(point[0]-last[0],point[1]-last[1]);if(distance<spacing)continue;const steps=Math.ceil(distance/spacing);if(dabs.length+steps>100_000)throw new EditorError('RESOURCE_LIMIT','The high-depth warp exceeds its dab budget.');let previous=last;
  for(let step=1;step<=steps;step++){const t=step/steps,center:[number,number]=[last[0]+(point[0]-last[0])*t,last[1]+(point[1]-last[1])*t],move:[number,number]=[F(F(center[0]-previous[0])*strength),F(F(center[1]-previous[1])*strength)],margin=Math.ceil(Math.max(Math.abs(move[0]),Math.abs(move[1])))+2,cx=round(center[0]),cy=round(center[1]),bounds:[number,number,number,number]=[Math.max(0,cx-radius-margin),Math.max(0,cy-radius-margin),Math.min(width-1,cx+radius+margin),Math.min(height-1,cy+radius+margin)];
   visits+=Math.max(0,Math.min(width-1,cx+radius)-Math.max(0,cx-radius)+1)*Math.max(0,Math.min(height-1,cy+radius)-Math.max(0,cy-radius)+1);if(visits>80_000_000)throw new EditorError('RESOURCE_LIMIT','The high-depth warp exceeds its sampling-work budget.');maxScratch=Math.max(maxScratch,Math.max(0,bounds[2]-bounds[0]+1)*Math.max(0,bounds[3]-bounds[1]+1));dabs.push({center,move,bounds});previous=center;
  }last=point;
 }
 const estimatedBytes=original.byteLength*2+(options.mode==='smudge'?side*side*16:count*8+maxScratch*8)+dabs.length*64;
 if(estimatedBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The high-depth warp exceeds its 512 MiB working budget.',{estimatedBytes});
 const pixels=original.slice();if(!dabs.length)return {data:pixels,dabs:[]};
 const weight=(u:number)=>{if(u>=1)return 0;if(u<=hardness)return 1;const t=F(F(1-u)/F(1-hardness));return F(F(t*t)*F(3-F(2*t)));};
 const carried=new Float32Array(options.mode==='smudge'?side*side*4:0),offsets=new Float32Array(options.mode==='liquify'?count*2:0),scratch=new Float32Array(options.mode==='liquify'?maxScratch*2:0);
 if(options.mode==='smudge'){const cx=round(options.points[0][0]),cy=round(options.points[0][1]);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=width||y>=height)continue;const at=(y*width+x)*4,held=((dy+radius)*side+dx+radius)*4;for(let c=0;c<4;c++)carried[held+c]=pixels[at+c];}}
 const mix=(a:number,b:number,t:number)=>F(a+F(F(b-a)*t));
 for(const dab of dabs){const cx=round(dab.center[0]),cy=round(dab.center[1]),[x0,y0,x1,y1]=dab.bounds,cw=x1-x0+1,ch=y1-y0+1;
  if(options.mode==='liquify'){if(cw<2||ch<2)continue;for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)for(let c=0;c<2;c++)scratch[(y*cw+x)*2+c]=offsets[((y+y0)*width+x+x0)*2+c];}
  for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=width||y>=height)continue;const w=weight(F(F(Math.sqrt(F(dx*dx+dy*dy)))*inverseRadius));if(!w)continue;const at=(y*width+x)*4;
   if(options.mode==='smudge'){const held=((dy+radius)*side+dx+radius)*4;for(let c=0;c<4;c++){const painted=F(pixels[at+c]+F(F(F(carried[held+c]-pixels[at+c])*w)*strength));pixels[at+c]=clamp(round(painted),0,65535);carried[held+c]=painted;}}
   else{const sx=clamp(F(x-x0-F(dab.move[0]*w)),0,cw-1),sy=clamp(F(y-y0-F(dab.move[1]*w)),0,ch-1),ix=Math.min(cw-2,Math.trunc(sx)),iy=Math.min(ch-2,Math.trunc(sy)),fx=F(sx-ix),fy=F(sy-iy),moved=[0,0];
    for(let c=0;c<2;c++){const p=(iy*cw+ix)*2; moved[c]=F(mix(mix(scratch[p+c],scratch[p+2+c],fx),mix(scratch[p+cw*2+c],scratch[p+cw*2+2+c],fx),fy)-F(dab.move[c]*w));offsets[(y*width+x)*2+c]=moved[c];}
    const ox=clamp(F(x+moved[0]),0,width-1),oy=clamp(F(y+moved[1]),0,height-1),xx=Math.min(width-2,Math.trunc(ox)),yy=Math.min(height-2,Math.trunc(oy)),tx=F(ox-xx),ty=F(oy-yy);if(xx<0||yy<0)continue;
    const p=(yy*width+xx)*4;for(let c=0;c<4;c++)pixels[at+c]=clamp(round(mix(mix(original[p+c],original[p+4+c],tx),mix(original[p+width*4+c],original[p+width*4+4+c],tx),ty)),0,65535);
   }
   for(let c=0;c<3;c++)pixels[at+c]=Math.min(pixels[at+c],pixels[at+3]);
  }
 }
 return {data:pixels,dabs:dabs.map(d=>d.center)};
}
/** Independent native DeepPixels.c deep_take_painted rule, with copy-on-write output. */
export function takeDeepPainted(deep:Uint16Array,base:Uint8Array,painted:Uint8Array,width:number,height:number):Uint16Array {
 const count=width*height;if(!(deep instanceof Uint16Array)||!(base instanceof Uint8Array)||!(painted instanceof Uint8Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||count>MAX_DEEP_PIXELS||deep.length!==count*4||base.length!==deep.length||painted.length!==deep.length)throw new EditorError('INVALID_ARGUMENT','Invalid deep paint comparison raster.');
 if(deep.byteLength*2+base.byteLength+painted.byteLength>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The deep paint merge exceeds its working budget.');
 for(let i=0;i<deep.length;i+=4){if(deep[i]>deep[i+3]||deep[i+1]>deep[i+3]||deep[i+2]>deep[i+3]||base[i]>base[i+3]||base[i+1]>base[i+3]||base[i+2]>base[i+3]||painted[i]>painted[i+3]||painted[i+1]>painted[i+3]||painted[i+2]>painted[i+3])throw new EditorError('INVALID_ARGUMENT','Paint buffers must be premultiplied.');}
 const out=deep.slice();for(let i=0;i<deep.length;i+=4){if(base[i]===painted[i]&&base[i+1]===painted[i+1]&&base[i+2]===painted[i+2]&&base[i+3]===painted[i+3])continue;for(let c=0;c<4;c++)out[i+c]=painted[i+c]*257;}return out;
}
