import {applyImageFilter,type PixelImage} from './image-filters'
import {LIMITS} from './limits'

/** Native LayerMask.background counts each perimeter pixel once, including corners. */
export function maskBackground(image:PixelImage):0|255 {
  let sum=0,count=0
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(!x||!y||x===image.width-1||y===image.height-1){sum+=image.data[(y*image.width+x)*4];count++}
  return sum*2>=count*255?255:0
}
/** Fixed-grid gray blur. Outside the raster is the mask's dominant perimeter tone. */
export function blurMaskPixels(image:PixelImage,radius:number,samplingScale=1):PixelImage {
  const {width,height,data}=image
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||data.length!==width*height*4)throw Error('Invalid mask raster dimensions.')
  if(!Number.isFinite(radius)||radius<0||radius>250)throw Error('Mask blur radius must be between 0 and 250.')
  if(!Number.isFinite(samplingScale)||samplingScale<=0||samplingScale>128)throw Error('Invalid mask runtime sampling scale.');
  const sigma=radius*samplingScale
  if(!radius||width===1&&height===1)return {width,height,data:new Uint8ClampedArray(data)}
  const pad=Math.ceil(3*sigma)+2,w=width+2*pad,h=height+2*pad
  if(w>LIMITS.maxSide||h>LIMITS.maxSide||w*h>LIMITS.maxSurfacePixels)throw Error('Mask blur exceeds the raster memory budget.')
  const background=maskBackground(image),padded=new Uint8ClampedArray(w*h*4)
  for(let i=0;i<padded.length;i+=4)padded.set([background,background,background,255],i)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=data[(y*width+x)*4];padded.set([value,value,value,255],((y+pad)*w+x+pad)*4)}
  const blurred=applyImageFilter({width:w,height:h,data:padded},{kind:'gaussianBlur',radius},undefined,samplingScale),output=new Uint8ClampedArray(data.length)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=blurred.data[((y+pad)*w+x+pad)*4];output.set([value,value,value,255],(y*width+x)*4)}
  return {width,height,data:output}
}
