import {kernelLineConvolver} from './image-filter-algorithms'
import type {PixelImage} from './image-filters'
import {LIMITS} from './limits'
import type {Transform} from './contracts'

export type MaskFeatherModel='compositor'|'photoshop'
export type MaskFeatherEdgeMode='clamp'|'default'
/** Only this source-grid boundary mode was measured against native Properties.
 * The persisted choice survives crop/placement changes, so no runtime inference. */
export function fullCanvasMaskEdgeMode(source:{width:number;height:number},placement:Transform,document:{width:number;height:number}):MaskFeatherEdgeMode{
 return source.width===document.width&&source.height===document.height&&placement.origin[0]===0&&placement.origin[1]===0&&placement.size[0]===document.width&&placement.size[1]===document.height&&placement.rotation===0?'clamp':'default'
}
/** The retained box4 branch's variance, also used unchanged for f>=2.
 * This is a measured approximation, not Photoshop's private implementation. */
export function photoshopMaskFeatherSigma(feather:number):number{
 if(!Number.isFinite(feather)||feather<0||feather>250)throw Error('Mask feather must be between 0 and 250 source pixels.')
 return Math.sqrt(feather*feather+Math.min(1/6,2*feather*feather/3))
}
function box4CDF(x:number,sigma:number):number{
 const a=sigma*Math.sqrt(3/4),t=(x+4*a)/(2*a)
 if(t<=0)return 0;if(t>=4)return 1;if(t>2)return 1-box4CDF(-x,sigma)
 // Irwin–Hall CDF of four uniform boxes, with symmetry to avoid cancellation.
 return Math.max(0,Math.min(1,(t**4-4*Math.max(0,t-1)**4+6*Math.max(0,t-2)**4)/24))
}
function box4Kernel(feather:number):Float64Array{
 const sigma=photoshopMaskFeatherSigma(feather);if(!sigma)return Float64Array.of(1)
 const radius=Math.ceil(sigma*Math.sqrt(12)+.5),kernel=new Float64Array(radius*2+1);let sum=0
 for(let offset=-radius;offset<=radius;offset++){const weight=Math.max(0,box4CDF(offset+.5,sigma)-box4CDF(offset-.5,sigma));kernel[offset+radius]=weight;sum+=weight}
 for(let i=0;i<kernel.length;i++)kernel[i]/=sum
 return kernel
}
/** Small kernels use point Gaussian precision with a continuous variance and
 * pixel-footprint support taper. No radius-specific coefficient lookup. The
 * quadratic zero limit avoids introducing a blur plane at arbitrarily small f.
 * A linear variance floor applies once the subpixel footprint reaches .5px. */
function compactGaussianKernel(feather:number):Float64Array{
 const variance=Math.max(feather*feather,Math.min(4*feather*feather,feather))+Math.min(1/6,feather*feather/6)
 if(!variance)return Float64Array.of(1) // The floating-point subnormal zero limit.
 const sigma=Math.sqrt(variance),support=3*sigma,radius=Math.ceil(support+.5),kernel=new Float64Array(radius*2+1);let sum=0
 for(let offset=-radius;offset<=radius;offset++){const footprint=Math.max(0,Math.min(1,support+.5-Math.abs(offset))),value=Math.exp(-(offset*offset)/(2*variance))*footprint;kernel[offset+radius]=value;sum+=value}
 for(let i=0;i<kernel.length;i++)kernel[i]/=sum
 return kernel
}
export function photoshopMaskFeatherKernel(feather:number):Float64Array{
 // Validation stays in the shared sigma function before any allocation.
 const box=box4Kernel(feather);if(!feather||feather>=2)return box
 const gaussian=compactGaussianKernel(feather),weight=Math.min(1,2-feather);if(weight===1)return gaussian
 // Crossfade across the one-to-two source-pixel precision transition. Kernels
 // are aligned by their origin, rather than resizing either source raster.
 const radius=Math.max(box.length,gaussian.length)>>1,br=box.length>>1,gr=gaussian.length>>1,kernel=new Float64Array(2*radius+1);let sum=0
 for(let i=0;i<kernel.length;i++){const offset=i-radius;kernel[i]=weight*(gaussian[offset+gr]??0)+(1-weight)*(box[offset+br]??0);sum+=kernel[i]}
 for(let i=0;i<kernel.length;i++)kernel[i]/=sum
 return kernel
}
/** Grayscale values stay floating through both passes, then round once. The
 * outside tone is an infinite plane; subtract it before zero-padded convolution. */
export function photoshopMaskFeatherPixels(image:PixelImage,feather:number,background:number):PixelImage{
 const {width,height,data}=image
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||width*height*40>512*1024*1024||data.length!==width*height*4)throw Error('Mask feather exceeds the raster memory budget.')
 if(!Number.isFinite(background)||background<0||background>255)throw Error('Invalid mask background.')
 const kernel=photoshopMaskFeatherKernel(feather),horizontal=kernelLineConvolver(width,kernel),vertical=kernelLineConvolver(height,kernel),temp=new Float32Array(width*height),row=new Float32Array(width),column=new Float32Array(height),output=new Uint8ClampedArray(data.length)
 for(let y=0;y<height;y++){for(let x=0;x<width;x++)row[x]=data[(y*width+x)*4]-background;temp.set(horizontal(row),y*width)}
 for(let x=0;x<width;x++){for(let y=0;y<height;y++)column[y]=temp[y*width+x];const values=vertical(column);for(let y=0;y<height;y++){const value=Math.max(0,Math.min(255,Math.round(background+values[y])));output.set([value,value,value,255],(y*width+x)*4)}}
 return {width,height,data:output}
}
