/** Port of Compositor 1.4.8 Rendering/HealPixels.c, Robbie Tilton, MIT license.
 * Source: robbietilton/Compositor commit 24ef2885daae750537ec8d094f33e8556a8dfc9a.
 * Operates on a private premultiplied RGBA8 copy; Float32 membrane matches native storage. */
import {patchFillPremultiplied, type PatchFillOptions} from './native-patch-fill'
import {EditorError} from './contracts'
import {healMembrane} from './native-membrane'
import {LIMITS} from './limits'
export type HealingMode='content-aware'|'create-texture'|'proximity-match'
const OUTSIDE=0,RING=1,HOLE=2,F=Math.fround
const round=(v:number)=>v<0?-Math.round(-v):Math.round(v)
function hash(x:number):number{x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return (x^(x>>>16))>>>0}
const unit=(key:number)=>(hash(key)>>>8)/16777216
export function healPremultipliedLegacy1_4_8(rgba:Uint8Array,coverage:Uint8Array,width:number,height:number,opacity=1,mode:HealingMode='content-aware',seed=0):Uint8Array {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||rgba.length!==width*height*4||coverage.length!==width*height)throw Error('Invalid healing raster.')
 if(!Number.isFinite(opacity)||opacity<0||opacity>1||!Number.isInteger(seed)||seed<0||seed>0xffffffff||!['content-aware','create-texture','proximity-match'].includes(mode))throw Error('Invalid healing parameters.')
 const output=new Uint8Array(rgba);let bx0=width,by0=height,bx1=0,by1=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(coverage[y*width+x]){bx0=Math.min(bx0,x);by0=Math.min(by0,y);bx1=Math.max(bx1,x+1);by1=Math.max(by1,y+1)}
 if(bx1<=bx0||!opacity)return output
 const ring=Math.min(16,Math.max(2,Math.floor(Math.max(bx1-bx0,by1-by0)/8))),wx0=Math.max(0,bx0-ring),wy0=Math.max(0,by0-ring),wx1=Math.min(width,bx1+ring),wy1=Math.min(height,by1+ring),ww=wx1-wx0,wh=wy1-wy0,wn=ww*wh
 if(wn*(ww>32&&wh>32?40:300)>80_000_000)throw Error('Healing membrane exceeds the compute budget; use shorter strokes.')
 const role=new Uint8Array(wn),near=new Uint8Array(wn),prefix=new Int32Array(Math.max(ww,wh)+1),value=new Float32Array(wn*4)
 for(let y=0;y<wh;y++)for(let x=0;x<ww;x++)role[y*ww+x]=coverage[(wy0+y)*width+wx0+x]?HOLE:OUTSIDE
 for(let y=0;y<wh;y++){prefix[0]=0;for(let x=0;x<ww;x++)prefix[x+1]=prefix[x]+(role[y*ww+x]===HOLE?1:0);for(let x=0;x<ww;x++)near[y*ww+x]=prefix[Math.min(ww,x+ring+1)]-prefix[Math.max(0,x-ring)]>0?1:0}
 for(let x=0;x<ww;x++){prefix[0]=0;for(let y=0;y<wh;y++)prefix[y+1]=prefix[y]+near[y*ww+x];for(let y=0;y<wh;y++)if(role[y*ww+x]===OUTSIDE&&prefix[Math.min(wh,y+ring+1)]-prefix[Math.max(0,y-ring)]>0)role[y*ww+x]=RING}
 const ringCount=role.reduce((sum,v)=>sum+(v===RING?1:0),0);if(!ringCount)return output
 const score=(dx:number,dy:number):number=>{if(Math.abs(dx)<ww&&Math.abs(dy)<wh||wx0+dx<0||wy0+dy<0||wx0+ww+dx>width||wy0+wh+dy>height)return Infinity;let sum=0,n=0;for(let y=0;y<wh;y++)for(let x=0;x<ww;x++)if(role[y*ww+x]===RING){const t=((wy0+y)*width+wx0+x)*4,s=((wy0+y+dy)*width+wx0+x+dx)*4;for(let c=0;c<4;c++)sum+=(rgba[t+c]-rgba[s+c])**2;n++}return n?sum/n:Infinity}
 let ox=0,oy=0,haveSource=false
 if(mode!=='create-texture'){let best=Infinity;const factors=[1.05,1.35,1.75,2.25,2.8],count=mode==='proximity-match'?2:5;for(let f=0;f<count;f++)for(let a=0;a<24;a++){const angle=a*Math.PI/12,dx=round(Math.cos(angle)*factors[f]*ww),dy=round(Math.sin(angle)*factors[f]*wh),result=score(dx,dy)*(1+(mode==='proximity-match'?.6:.1)*f);if(result<best){best=result;ox=dx;oy=dy}}if(Number.isFinite(best)){const cx=ox,cy=oy;let refined=score(cx,cy);for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++){const result=score(cx+i,cy+j);if(result<refined){refined=result;ox=cx+i;oy=cy+j}}haveSource=true}}
 const mean=[0,0,0,0],detail=[0,0,0]
 for(let y=0;y<wh;y++)for(let x=0;x<ww;x++){const p=y*ww+x;if(role[p]!==RING)continue;const ix=wx0+x,iy=wy0+y,t=(iy*width+ix)*4,s=((iy+oy)*width+ix+ox)*4;for(let c=0;c<4;c++){value[p*4+c]=rgba[t+c]-(haveSource?rgba[s+c]:0);mean[c]+=value[p*4+c]}if(!haveSource)for(let c=0;c<3;c++){let around=0,n=0;for(const [nx,ny] of [[ix-1,iy],[ix+1,iy],[ix,iy-1],[ix,iy+1]])if(nx>=0&&ny>=0&&nx<width&&ny<height){around+=rgba[(ny*width+nx)*4+c];n++}if(n)detail[c]+=(rgba[t+c]-around/n)**2}}
 for(let c=0;c<4;c++)mean[c]/=ringCount;for(let p=0;p<wn;p++)if(role[p]===HOLE)for(let c=0;c<4;c++)value[p*4+c]=mean[c];healMembrane(value,role,ww,wh);for(let c=0;c<3;c++)detail[c]=Math.sqrt(detail[c]/ringCount)*.9
 opacity=F(opacity)
 for(let y=0;y<wh;y++)for(let x=0;x<ww;x++){const p=y*ww+x;if(role[p]!==HOLE)continue;const ix=wx0+x,iy=wy0+y,t=(iy*width+ix)*4,s=((iy+oy)*width+ix+ox)*4,amount=coverage[iy*width+ix]/255*opacity;let grain=0;if(!haveSource){const key=hash(seed^hash(iy*width+ix));grain=Math.sqrt(-2*Math.log(1-unit(key)))*Math.cos(2*Math.PI*unit(key^0x68e31da4))}const out=[0,0,0,0];for(let c=0;c<4;c++){const healed=(haveSource?rgba[s+c]:0)+value[p*4+c]+(c<3?grain*detail[c]:0);out[c]=rgba[t+c]+(healed-rgba[t+c])*amount}output[t+3]=round(Math.min(255,Math.max(0,out[3])));for(let c=0;c<3;c++)output[t+c]=round(Math.min(output[t+3],Math.max(0,out[c])))}
 return output
}
/** Latest HealPixels.c: content-aware uses PatchPixels, then blends covered pixels.
 * When no fully opaque 7x7 donor exists, the upstream fallback is Create Texture.
 * Proximity Match/Create Texture preserve the independently verified 1.4.8 kernel. */
export function healPremultiplied(rgba:Uint8Array,coverage:Uint8Array,width:number,height:number,opacity=1,mode:HealingMode='content-aware',seed=0,options:Omit<PatchFillOptions,'seed'>={}):Uint8Array {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||rgba.length!==width*height*4||coverage.length!==width*height)throw Error('Invalid healing raster.')
 if(!Number.isFinite(opacity)||opacity<0||opacity>1||!Number.isInteger(seed)||seed<0||seed>0xffffffff||!['content-aware','create-texture','proximity-match'].includes(mode))throw Error('Invalid healing parameters.')
 if(options.signal?.aborted)throw new EditorError('CANCELED','Healing was canceled.')
 if(!opacity)return new Uint8Array(rgba)
 if(mode!=='content-aware')return healPremultipliedLegacy1_4_8(rgba,coverage,width,height,opacity,mode,seed)
 const patch=patchFillPremultiplied(rgba,coverage,width,height,{...options,seed})
 if(!patch.status)return healPremultipliedLegacy1_4_8(rgba,coverage,width,height,opacity,'create-texture',seed)
 if(patch.work+coverage.length>(options.maximumWork??120_000_000))throw new EditorError('RESOURCE_LIMIT','Healing exceeds the patch-search budget; use a smaller stroke.')
 const output=patch.data;opacity=F(opacity)
 for(let p=0;p<coverage.length;p++)if(coverage[p]){const t=p*4,amount=coverage[p]/255*opacity,alpha=rgba[t+3]+(output[t+3]-rgba[t+3])*amount;output[t+3]=round(Math.max(0,Math.min(255,alpha)));for(let c=0;c<3;c++)output[t+c]=round(Math.max(0,Math.min(output[t+3],rgba[t+c]+(output[t+c]-rgba[t+c])*amount)))}
 if(options.signal?.aborted)throw new EditorError('CANCELED','Healing was canceled.')
 return output
}
