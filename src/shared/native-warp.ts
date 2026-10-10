/** CPU WarpStroke port from Compositor 1.4.8 Document/SmudgeLiquify.swift, MIT.
 * Uses premultiplied byte buffers and a carried Float32 brush; geometry is supplied by the caller. */
import {LIMITS} from './limits'
export type WarpMode='smudge'|'liquify'
const F=Math.fround,round=(value:number)=>value<0?-Math.round(-value):Math.round(value)
export function warpPremultiplied(image:{width:number;height:number;data:Uint8Array},options:{mode:WarpMode;points:[number,number][];size:number;hardness:number;strength:number}):Uint8Array {
 const {width,height}=image;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||image.data.length!==width*height*4)throw Error('Invalid warp raster.')
 if(!['smudge','liquify'].includes(options.mode)||!Number.isFinite(options.size)||options.size<1||options.size>4096||!Number.isFinite(options.hardness)||options.hardness<0||options.hardness>1||!Number.isFinite(options.strength)||options.strength<0||options.strength>1||!options.points.length||options.points.length>100_000||options.points.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v)>1_000_000)))throw Error('Invalid warp parameters.')
 const pixels=new Uint8Array(image.data),diameter=Math.max(2,options.size),radius=Math.ceil(diameter/2),side=radius*2+1,strength=F(Math.max(.01,options.strength)),hardness=F(Math.min(.98,options.hardness)),invR=F(1/F(diameter/2)),spacing=Math.max(1,diameter*(options.mode==='smudge'?.005:.025))
 if(!options.strength||options.points.length<2)return pixels
 let visits=0,last=options.points[0],carried=new Float32Array(options.mode==='smudge'?side*side*4:0)
 const weight=(u:number):number=>{if(u>=1)return 0;if(u<=hardness)return 1;const t=F(F(1-u)/F(1-hardness));return F(F(t*t)*F(3-F(2*t)))}
 if(options.mode==='smudge'){const cx=round(last[0]),cy=round(last[1]);for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=width||y>=height)continue;const p=(y*width+x)*4,c=((dy+radius)*side+dx+radius)*4;for(let k=0;k<4;k++)carried[c+k]=pixels[p+k]}}
 for(const point of options.points.slice(1)){const distance=Math.hypot(point[0]-last[0],point[1]-last[1]);if(distance<spacing)continue;const steps=Math.ceil(distance/spacing);visits+=steps*Math.min(side,width)*Math.min(side,height);if(visits>80_000_000)throw Error('Warp stroke exceeds the compute budget; use shorter strokes.');let previous=last
  for(let step=1;step<=steps;step++){const t=step/steps,center:[number,number]=[last[0]+(point[0]-last[0])*t,last[1]+(point[1]-last[1])*t],cx=round(center[0]),cy=round(center[1])
   if(options.mode==='smudge')for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=cx+dx,y=cy+dy;if(x<0||y<0||x>=width||y>=height)continue;const w=weight(F(F(Math.sqrt(F(dx*dx+dy*dy)))*invR));if(!w)continue;const p=(y*width+x)*4,c=((dy+radius)*side+dx+radius)*4;for(let k=0;k<4;k++){const painted=F(pixels[p+k]+F(F(F(carried[c+k]-pixels[p+k])*w)*strength));pixels[p+k]=round(Math.min(255,Math.max(0,painted)));carried[c+k]=painted}}
   else {const moveX=F(F(center[0]-previous[0])*strength),moveY=F(F(center[1]-previous[1])*strength),margin=Math.ceil(Math.max(Math.abs(moveX),Math.abs(moveY)))+2,x0=Math.max(0,cx-radius-margin),x1=Math.min(width-1,cx+radius+margin),y0=Math.max(0,cy-radius-margin),y1=Math.min(height-1,cy+radius+margin),cw=x1-x0+1,ch=y1-y0+1;if(cw>=2&&ch>=2){const scratch=new Float32Array(cw*ch*4);for(let y=0;y<ch;y++)for(let x=0;x<cw;x++)for(let k=0;k<4;k++)scratch[(y*cw+x)*4+k]=pixels[((y+y0)*width+x+x0)*4+k]
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=cx+dx,y=cy+dy;if(x<x0||y<y0||x>x1||y>y1)continue;const w=weight(F(F(Math.sqrt(F(dx*dx+dy*dy)))*invR));if(!w)continue;const sx=Math.min(cw-1,Math.max(0,F(x-x0-F(moveX*w)))),sy=Math.min(ch-1,Math.max(0,F(y-y0-F(moveY*w)))),ix=Math.min(cw-2,Math.trunc(sx)),iy=Math.min(ch-2,Math.trunc(sy)),fx=F(sx-ix),fy=F(sy-iy),p=(y*width+x)*4,s00=(iy*cw+ix)*4,s10=s00+4,s01=s00+cw*4,s11=s01+4;for(let k=0;k<4;k++){const top=F(scratch[s00+k]+F(F(scratch[s10+k]-scratch[s00+k])*fx)),bottom=F(scratch[s01+k]+F(F(scratch[s11+k]-scratch[s01+k])*fx));pixels[p+k]=round(Math.min(255,Math.max(0,F(top+F(F(bottom-top)*fy)))))}}}}
   previous=center
  }last=point
 }
 return pixels
}
