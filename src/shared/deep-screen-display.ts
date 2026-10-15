import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from './deep-pixels'

/** Display-only boundary for upstream 905efc5: uniform noise under half an
 * RGBA8 level. Sources, saved proxies and export quantization are independent.
 * Portable deterministic noise matches the distribution, not CIRandomGenerator's
 * proprietary sequence. Coordinates are output pixels, stable on repeat draws.
 */
function noise(x:number,y:number,channel:number):number {
 let hash=(Math.imul(x+1,0x9e3779b1)^Math.imul(y+1,0x85ebca77)^Math.imul(channel+1,0xc2b2ae3d))>>>0
 hash=Math.imul(hash^(hash>>>16),0x7feb352d)>>>0
 hash=Math.imul(hash^(hash>>>15),0x846ca68b)>>>0
 return ((hash^(hash>>>16))>>>0)/0x100000000
}
export function quantizeDeepScreenRGBA8(pixels:Uint16Array|Float32Array,width:number,height:number):Uint8Array {
 const floating=pixels instanceof Float32Array,count=width*height
 if(!(pixels instanceof Uint16Array||floating)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(count)||count>MAX_DEEP_PIXELS||pixels.length!==count*4)throw new RangeError('Invalid high-depth screen dimensions or samples.')
 if(pixels.byteLength+count*4>MAX_DEEP_WORKING_BYTES)throw new RangeError('High-depth screen quantization exceeds the working budget.')
 const scale=floating?255:255/65535
 // Refuse invalid source before output allocation. Extended HDR RGB is allowed,
 // clipping solely at this SDR screen boundary; source buffers stay untouched.
 for(let at=0;at<pixels.length;at+=4){const alpha=pixels[at+3],max=floating?1:65535;if(!Number.isFinite(alpha)||alpha<0||alpha>max)throw new RangeError('Invalid high-depth screen alpha.');for(let c=0;c<3;c++){const value=pixels[at+c];if(!Number.isFinite(value)||alpha===0&&value!==0||!floating&&(value<0||value>alpha))throw new RangeError('Invalid premultiplied high-depth screen color.')}}
 const out=new Uint8Array(count*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=(y*width+x)*4,alpha=Math.round(pixels[at+3]*scale)
  out[at+3]=alpha
  for(let c=0;c<3;c++){
   const value=Math.max(0,Math.min(pixels[at+3],pixels[at+c]))*scale
   const premultiplied=Math.max(0,Math.min(alpha,Math.round(value+.999*(noise(x,y,c)-.5))))
   out[at+c]=alpha?Math.min(255,Math.floor((premultiplied*255+Math.floor(alpha/2))/alpha)):0
  }
 }
 return out
}
