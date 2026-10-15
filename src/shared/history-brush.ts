/** Local restoration from a retained raster state. Art mode is an explicit
 * source-color patch approximation, not Photoshop's private Art History styles. */
import {EditorError} from './errors'
import {LIMITS} from './limits'
export type HistoryBrushPixels=Uint8Array|Uint16Array|Float32Array
export function restoreHistoryBrushPixels(current:HistoryBrushPixels,source:HistoryBrushPixels,coverage:Float32Array,width:number,height:number,opacity:number,artSize?:number):HistoryBrushPixels {
 const depth=current instanceof Float32Array?'hdr':current instanceof Uint16Array?16:8
 const matches=depth==='hdr'?source instanceof Float32Array:depth===16?source instanceof Uint16Array:source instanceof Uint8Array
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||current.length!==width*height*4||source.length!==current.length||coverage.length!==width*height||!matches)throw new EditorError('INVALID_ARGUMENT','History Brush requires matching raster grids and pixel precision.')
 if(!Number.isFinite(opacity)||opacity<0||opacity>1||artSize!==undefined&&(!Number.isSafeInteger(artSize)||artSize<2||artSize>128))throw new EditorError('INVALID_ARGUMENT','History Brush requires finite opacity and a valid art scale.')
 const output=depth==='hdr'?new Float32Array(current):depth===16?new Uint16Array(current):new Uint8Array(current)
 const maximum=depth==='hdr'?1:depth===16?65535:255,cache=new Map<number,[number,number,number,number]>(),blocks=artSize?Math.ceil(width/artSize):0
 const stylized=(x:number,y:number):[number,number,number,number]=>{
  const left=Math.floor(x/artSize!)*artSize!,top=Math.floor(y/artSize!)*artSize!,key=Math.floor(top/artSize!)*blocks+Math.floor(left/artSize!)
  const old=cache.get(key);if(old)return old
  const right=Math.min(width,left+artSize!),bottom=Math.min(height,top+artSize!),sum:[number,number,number,number]=[0,0,0,0];let count=0
  for(let sy=top;sy<bottom;sy++)for(let sx=left;sx<right;sx++){
   const p=(sy*width+sx)*4,a=source[p+3]/maximum;sum[3]+=source[p+3]
   for(let c=0;c<3;c++)sum[c]+=source[p+c]*(depth===8?a:1);count++
  }
  for(let c=0;c<4;c++)sum[c]/=count
  if(depth===8){const a=sum[3]/255;for(let c=0;c<3;c++)sum[c]=a?sum[c]/a:0}
  cache.set(key,sum);return sum
 }
 for(let i=0;i<coverage.length;i++){
  const weight=coverage[i]*opacity;if(!Number.isFinite(weight)||weight<0||weight>1)throw new EditorError('INVALID_ARGUMENT','History Brush coverage must be finite and normalized.')
  if(weight===0)continue
  const p=i*4,s=artSize?stylized(i%width,Math.floor(i/width)):[source[p],source[p+1],source[p+2],source[p+3]]
  if(weight===1&&!artSize){output.set(s,p);continue}
  const alpha=current[p+3]*(1-weight)+s[3]*weight
  output[p+3]=depth==='hdr'?alpha:Math.round(alpha)
  if(depth===8){
   const a=alpha/255,da=current[p+3]/255,sa=s[3]/255
   for(let c=0;c<3;c++)output[p+c]=a?Math.round((current[p+c]*da*(1-weight)+s[c]*sa*weight)/a):0
  }else for(let c=0;c<3;c++)output[p+c]=depth==='hdr'?current[p+c]*(1-weight)+s[c]*weight:Math.round(current[p+c]*(1-weight)+s[c]*weight)
 }
 return output
}
