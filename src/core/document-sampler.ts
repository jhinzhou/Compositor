import {EditorError,LIMITS,type Layer} from '../shared/contracts'
import {sourcePoint} from '../shared/selection-coverage'
import type {RGBAImage} from './selection-retouch'

function lanczos(value:number):number {const x=Math.abs(value);return x<1e-12?1:x>=3?0:Math.sin(Math.PI*x)*Math.sin(Math.PI*x/3)/(Math.PI*Math.PI*x*x/3)}
/** Native sharp 2× reductions use premultiplied Lanczos and transparent padding.
 * Clamp ringing to alpha after each pass; odd dimensions round up and retain
 * the original 2^level pixel phase instead of stretching to the rounded size. */
function halve(image:RGBAImage):RGBAImage {
 const width=Math.ceil(image.width/2),height=Math.ceil(image.height/2),horizontal=new Float32Array(width*image.height*4),data=new Uint8Array(width*height*4)
 const weights=Array.from({length:12},(_,i)=>lanczos((i-5.5)/2)),total=weights.reduce((a,b)=>a+b,0)
 for(let y=0;y<image.height;y++)for(let x=0;x<width;x++)for(let k=0;k<12;k++){const sx=x*2+k-5;if(sx<0||sx>=image.width)continue;for(let c=0;c<4;c++)horizontal[(y*width+x)*4+c]+=image.data[(y*image.width+sx)*4+c]*weights[k]/total}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const channels=[0,0,0,0];for(let k=0;k<12;k++){const sy=y*2+k-5;if(sy<0||sy>=image.height)continue;for(let c=0;c<4;c++)channels[c]+=horizontal[(sy*width+x)*4+c]*weights[k]/total}const alpha=Math.round(Math.max(0,Math.min(255,channels[3])));data[(y*width+x)*4+3]=alpha;for(let c=0;c<3;c++)data[(y*width+x)*4+c]=Math.round(Math.max(0,Math.min(alpha,channels[c])))}
 return {width,height,data}
}
/** Premultiplied sharp reductions shared by document sampling and Image Size.
 * The factor is the native context's x-axis device scale per source pixel. */
export function prepareLayerSampleSource(image:RGBAImage,factor:number,sampling:Layer['transform']['sampling']):{source:RGBAImage;scale:number;level:number} {
 if(!Number.isFinite(factor)||factor<=0)throw new EditorError('INVALID_ARGUMENT','The sample scale must be positive and finite.')
 if(image.data.length!==image.width*image.height*4)throw new EditorError('INVALID_ARGUMENT','The sample image has the wrong byte length.')
 const premultiplied=new Uint8Array(image.data.length)
 for(let at=0;at<image.data.length;at+=4){premultiplied[at+3]=image.data[at+3];for(let c=0;c<3;c++)premultiplied[at+c]=Math.round(image.data[at+c]*image.data[at+3]/255)}
 let source:RGBAImage={...image,data:premultiplied},level=0
 const wanted=sampling==='Nearest'||factor>=.5?0:Math.min(6,Math.floor(Math.log2(1/factor)))
 while(level<wanted&&(source.width>1||source.height>1)){source=halve(source);level++}
 return {source,scale:2**level,level}
}
export function sampleLayerInDocument(image:RGBAImage|null,transform:Layer['transform'],width:number,height:number):RGBAImage {
 if(width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>64_000_000)throw new EditorError('RESOURCE_LIMIT','Document selection sample exceeds the 64 MP budget.')
 const data=new Uint8Array(width*height*4)
 if(!image)return {width,height,data}
 if(image.data.length!==image.width*image.height*4)throw new EditorError('INVALID_ARGUMENT','The sample image has the wrong byte length.')
 const factor=transform.size[0]/image.width,{source,scale}=prepareLayerSampleSource(image,factor,transform.sampling),copy=transform.sampling==='Nearest'||transform.rotation===0&&Math.abs(factor*scale-1)<.001
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const [originalX,originalY]=sourcePoint({transform},x+.5,y+.5,image.width,image.height),sx=originalX/scale,sy=originalY/scale
  if(sx<0||sy<0||sx>=source.width||sy>=source.height)continue
  const channels=[0,0,0,0]
  if(copy){const at=(Math.floor(sy)*source.width+Math.floor(sx))*4;for(let c=0;c<4;c++)channels[c]=source.data[at+c]}
  else{const ix=Math.floor(sx-.5),iy=Math.floor(sy-.5),tx=sx-.5-ix,ty=sy-.5-iy;for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){const px=ix+xx,py=iy+yy;if(px<0||py<0||px>=source.width||py>=source.height)continue;const weight=(xx?tx:1-tx)*(yy?ty:1-ty);for(let c=0;c<4;c++)channels[c]+=source.data[(py*source.width+px)*4+c]*weight}}
  const at=(y*width+x)*4,alpha=data[at+3]=Math.round(channels[3]);for(let c=0;c<3;c++)data[at+c]=alpha?Math.round(Math.min(255,Math.max(0,channels[c]*255/alpha))):0
 }
 return {width,height,data}
}
