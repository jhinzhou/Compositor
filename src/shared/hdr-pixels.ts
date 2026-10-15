/** Native f5ae5ba HDR semantics: premultiplied extended sRGB, Float32 working
 * buffers, IEEE binary16 only at storage/native-reference boundaries. RGB may
 * be negative or exceed alpha/white; alpha remains finite in [0,1]. */
import {EditorError} from './contracts'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES,quantizeDeep16ToRGBA8} from './deep-pixels'
import {applyDeepColorFilter,supportsDeepColorFilter} from './deep-color-filters'
import {imageFilterSchema} from './image-filters'
const F=Math.fround,clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,v)),bitsBuffer=new ArrayBuffer(4),bitsF=new Float32Array(bitsBuffer),bitsU=new Uint32Array(bitsBuffer)
export const HDR_HALF_MAX=65504
function half(bits:number):number {const sign=bits&0x8000?-1:1,exponent=bits>>>10&31,mantissa=bits&1023;return exponent===0?sign*mantissa*2**-24:exponent===31?mantissa?NaN:sign*Infinity:sign*(1+mantissa/1024)*2**(exponent-15)}
/** IEEE binary16, including signed zero/subnormals/non-finite scalar patterns. */
export function halfToFloat(bits:number):number {if(!Number.isInteger(bits)||bits<0||bits>65535)throw new EditorError('INVALID_ARGUMENT','Expected a binary16 bit pattern.');return half(bits)}
/** IEEE round-to-nearest ties-to-even. Array storage helpers separately refuse NaN/Inf. */
export function floatToHalf(value:number):number {
 bitsF[0]=value;const u=bitsU[0],sign=u>>>16&0x8000,exponent=u>>>23&255;let mantissa=u&0x7fffff
 if(exponent===255)return sign|0x7c00|(mantissa?0x200:0)
 const e=exponent-127+15;if(e>=31)return sign|0x7c00
 if(e<=0){if(e< -10)return sign;mantissa|=0x800000;const shift=14-e,rest=mantissa&((1<<shift)-1),mid=1<<(shift-1);let out=mantissa>>>shift;if(rest>mid||rest===mid&&(out&1))out++;return sign|out}
 let out=sign|e<<10|mantissa>>>13;const rest=mantissa&8191;if(rest>4096||rest===4096&&(out&1))out++;return out
}
function geometry(data:{length:number;byteLength:number},width:number,height:number,bytesPerPixel=32):number {
 const count=width*height;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!Number.isSafeInteger(count)||count>MAX_DEEP_PIXELS||data.length!==count*4)throw new EditorError('INVALID_ARGUMENT','Invalid dense HDR raster dimensions.')
 const estimatedBytes=data.byteLength+count*bytesPerPixel;if(estimatedBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','HDR pixel work exceeds its 512 MiB budget.',{estimatedBytes});return count
}
export function validateHDRPixels(pixels:Float32Array,width:number,height:number,bytesPerPixel=32):void {
 if(!(pixels instanceof Float32Array))throw new EditorError('INVALID_ARGUMENT','Expected Float32 extended-sRGB HDR samples.')
 geometry(pixels,width,height,bytesPerPixel)
 for(let at=0;at<pixels.length;at+=4){const a=pixels[at+3];if(!Number.isFinite(a)||a<0||a>1)throw new EditorError('INVALID_ARGUMENT','HDR alpha must be finite and within [0,1].');for(let c=0;c<3;c++)if(!Number.isFinite(pixels[at+c])||a===0&&pixels[at+c]!==0)throw new EditorError('INVALID_ARGUMENT','HDR RGB must be finite and premultiplied; transparent colors must be zero.')}
}
export function decodeHDRHalf(bits:Uint16Array,width:number,height:number):Float32Array {
 if(!(bits instanceof Uint16Array))throw new EditorError('INVALID_ARGUMENT','Expected binary16 HDR samples.');geometry(bits,width,height,16)
 // Validate before output allocation, including non-finite RGB and alpha out of range.
 for(let at=0;at<bits.length;at+=4){const a=half(bits[at+3]);if(!Number.isFinite(a)||a<0||a>1)throw new EditorError('INVALID_ARGUMENT','Invalid binary16 HDR alpha.');for(let c=0;c<3;c++){const value=half(bits[at+c]);if(!Number.isFinite(value)||a===0&&value!==0)throw new EditorError('INVALID_ARGUMENT','Invalid premultiplied binary16 HDR color.')}}
 return Float32Array.from(bits,half)
}
export function encodeHDRHalf(pixels:Float32Array,width:number,height:number):Uint16Array {
 validateHDRPixels(pixels,width,height,8);for(const value of pixels)if(Math.abs(value)>HDR_HALF_MAX)throw new EditorError('RESOURCE_LIMIT','HDR values exceed finite binary16 storage; reduce exposure before saving.',{maximum:HDR_HALF_MAX})
 return Uint16Array.from(pixels,floatToHalf)
}
export function hdrPeak(pixels:Float32Array,width:number,height:number):number {validateHDRPixels(pixels,width,height,0);let peak=0;for(let at=0;at<pixels.length;at+=4)if(pixels[at+3]>0)for(let c=0;c<3;c++)peak=Math.max(peak,F(pixels[at+c]/pixels[at+3]));return peak}
/** Native deep_hdr_normalize: negative straight colors become zero, highlight
 * peak scales the full RGB triplet, and operation input is premultiplied UNORM16. */
export function normalizeHDR(pixels:Float32Array,width:number,height:number):{normal:Uint16Array;scales:Float32Array} {
 validateHDRPixels(pixels,width,height,12);for(let at=0;at<pixels.length;at+=4)if(pixels[at+3]>0)for(let c=0;c<3;c++)if(!Number.isFinite(F(pixels[at+c]/pixels[at+3])))throw new EditorError('RESOURCE_LIMIT','HDR straight color exceeds finite Float32 normalization.');const normal=new Uint16Array(pixels.length),scales=new Float32Array(width*height)
 for(let at=0;at<pixels.length;at+=4){const a=clamp(pixels[at+3]),color=[0,1,2].map(c=>a>0?Math.max(0,F(pixels[at+c]/a)):0),scale=Math.max(1,...color);scales[at/4]=scale;for(let c=0;c<3;c++)normal[at+c]=Math.round(F(F(Math.min(1,F(color[c]/scale))*a)*65535));normal[at+3]=Math.round(F(a*65535))}
 return {normal,scales}
}
export function restoreHDR(normal:Uint16Array,scales:Float32Array,width:number,height:number):Float32Array {
 if(!(normal instanceof Uint16Array)||!(scales instanceof Float32Array))throw new EditorError('INVALID_ARGUMENT','Invalid HDR normalization buffers.');geometry(normal,width,height,20)
 if(scales.length!==width*height||scales.some(v=>!Number.isFinite(v)||v<1))throw new EditorError('INVALID_ARGUMENT','HDR normalization scales must be finite and at least 1.')
 for(let at=0;at<normal.length;at+=4)if(normal[at]>normal[at+3]||normal[at+1]>normal[at+3]||normal[at+2]>normal[at+3])throw new EditorError('INVALID_ARGUMENT','Normalized HDR colors must be premultiplied UNORM16.')
 const pixels=new Float32Array(normal.length);for(let at=0;at<normal.length;at+=4){for(let c=0;c<3;c++)pixels[at+c]=F(F(normal[at+c]/65535)*scales[at/4]);pixels[at+3]=F(normal[at+3]/65535)}validateHDRPixels(pixels,width,height,0);return pixels
}
/** Extended sRGB is mirrored below black and carried beyond white. */
export function extendedSRGBToLinear(value:number):number {const v=F(Math.abs(value)),linear=v<=F(.04045)?F(v/F(12.92)):F(Math.pow(F(F(v+F(.055))/F(1.055)),F(2.4)));return value<0?-linear:linear}
export function linearToExtendedSRGB(value:number):number {const v=F(Math.abs(value)),encoded=v<=F(.0031308)?F(v*F(12.92)):F(F(F(1.055)*F(Math.pow(v,F(1/F(2.4)))))-F(.055));return value<0?-encoded:encoded}
/** Photoshop Exposure Gamma mirrors negative linear values around zero (Adobe
 * HDR Exposure documentation). Deliberate divergence from Compositor's max(0). */
export function applyHDRExposure(pixels:Float32Array,width:number,height:number,input:{exposure?:number;offset?:number;gamma?:number}):Float32Array {
 const spec=imageFilterSchema.parse({kind:'exposure',...input});if(spec.kind!=='exposure')throw new EditorError('INVALID_ARGUMENT','Expected exposure settings.');validateHDRPixels(pixels,width,height,16)
 if(spec.exposure===0&&spec.offset===0&&spec.gamma===1)return pixels.slice()
 const scale=F(2**spec.exposure),offset=F(spec.offset),inverseGamma=F(1/spec.gamma),out=pixels.slice()
 for(let at=0;at<out.length;at+=4){const a=pixels[at+3];if(!(a>0))continue;for(let c=0;c<3;c++){const linear=F(F(extendedSRGBToLinear(F(pixels[at+c]/a))*scale)+offset),corrected=F(Math.pow(Math.abs(linear),inverseGamma))*(linear<0?-1:1);out[at+c]=F(linearToExtendedSRGB(corrected)*a)}}validateHDRPixels(out,width,height,0);return out
}
/** Exposure is exact extended-space algebra. Other supported color operations
 * use the native normalized16/brightness-restoration bridge; source never PNG8. */
export function applyHDRColorFilter(pixels:Float32Array,width:number,height:number,input:unknown):Float32Array {
 const spec=imageFilterSchema.parse(input)
 if(spec.kind==='threshold'||spec.kind==='posterize')throw new EditorError('UNSUPPORTED_FEATURE','Threshold and Posterize support only 8/16-bit images. HDR source values are kept unchanged.')
 if(!supportsDeepColorFilter(spec))throw new EditorError('UNSUPPORTED_FEATURE','This color filter has no HDR implementation.')
 validateHDRPixels(pixels,width,height,44)
 if(spec.kind==='exposure')return applyHDRExposure(pixels,width,height,{exposure:spec.exposure,offset:spec.offset,gamma:spec.gamma})
 const {normal,scales}=normalizeHDR(pixels,width,height);return restoreHDR(applyDeepColorFilter(normal,width,height,spec),scales,width,height)
}
/** Native deep_take_painted_hdr. Changed premult8 pixels become [0,1] half-range
 * fresh paint; unchanged pixels retain original extended values exactly. */
export function takeHDRPainted(pixels:Float32Array,base:Uint8Array,painted:Uint8Array,width:number,height:number):Float32Array {
 validateHDRPixels(pixels,width,height,24)
 if(!(base instanceof Uint8Array)||!(painted instanceof Uint8Array)||base.length!==pixels.length||painted.length!==pixels.length)throw new EditorError('INVALID_ARGUMENT','Invalid HDR paint proxy dimensions.')
 for(let at=0;at<base.length;at+=4)for(let c=0;c<3;c++)if(base[at+c]>base[at+3]||painted[at+c]>painted[at+3])throw new EditorError('INVALID_ARGUMENT','HDR paint proxies must be premultiplied.')
 const out=pixels.slice();for(let at=0;at<out.length;at+=4)if([0,1,2,3].some(c=>base[at+c]!==painted[at+c]))for(let c=0;c<4;c++)out[at+c]=F(painted[at+c]/255);return out
}
export function extractHDRAlpha(pixels:Float32Array,width:number,height:number):{pixels:Float32Array;alpha:Float32Array} {
 validateHDRPixels(pixels,width,height,20);const out=pixels.slice(),alpha=new Float32Array(width*height);for(let at=0;at<out.length;at+=4){const a=pixels[at+3];alpha[at/4]=a;for(let c=0;c<3;c++)out[at+c]=a>0?F(pixels[at+c]/a):0;out[at+3]=1}return {pixels:out,alpha}
}
export function restoreHDRAlpha(pixels:Float32Array,alpha:Float32Array,width:number,height:number):Float32Array {
 validateHDRPixels(pixels,width,height,20);if(!(alpha instanceof Float32Array)||alpha.length!==width*height||alpha.some(v=>!Number.isFinite(v)||v<0||v>1))throw new EditorError('INVALID_ARGUMENT','Invalid HDR clipping alpha.')
 const out=pixels.slice();for(let at=0;at<out.length;at+=4){const a=alpha[at/4];for(let c=0;c<3;c++)out[at+c]=F(pixels[at+c]*a);out[at+3]=a}validateHDRPixels(out,width,height,0);return out
}
/** SDR preview boundary only: highlights clip to white here, while the asset and
 * composite stay HDR. Exposure-before-preview can reveal those stored highlights. */
export function quantizeHDRPreview(pixels:Float32Array,width:number,height:number):Uint8Array {
 validateHDRPixels(pixels,width,height,16);const normal=new Uint16Array(pixels.length);for(let at=0;at<normal.length;at+=4){const a=pixels[at+3];normal[at+3]=Math.round(a*65535);for(let c=0;c<3;c++)normal[at+c]=Math.min(normal[at+3],Math.round(clamp(pixels[at+c],0,a)*65535))}return quantizeDeep16ToRGBA8(normal,width,height)
}
