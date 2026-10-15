import {applyImageFilter,type PixelImage} from './image-filters'
import {maskBackground} from './mask-pixels'
import {LIMITS} from './limits'
import {expandedContentTransform} from './content-transform'
import type {Transform} from './contracts'
import {sourcePoint} from './selection-coverage'
import {photoshopMaskFeatherKernel,photoshopMaskFeatherPixels,type MaskFeatherModel,type MaskFeatherEdgeMode} from './mask-feather'

export const MAX_MASK_FEATHER=250
export interface MaskProperties {density:number;feather:number;featherModel?:MaskFeatherModel;featherEdgeMode?:MaskFeatherEdgeMode}
export interface MaskPropertySource {maskDensity?:number;maskFeather?:number;maskFeatherModel?:MaskFeatherModel;maskFeatherEdgeMode?:MaskFeatherEdgeMode;photoshopMaskDefault?:unknown}
export interface EffectiveMask {image:PixelImage;inset:number;background:number}
export function maskProperties(layer:MaskPropertySource):MaskProperties{
 const density=layer.maskDensity??1,feather=layer.maskFeather??0
 if(layer.maskFeatherModel!==undefined&&!['compositor','photoshop'].includes(layer.maskFeatherModel))throw Error('Invalid mask feather model.')
 if(layer.maskFeatherEdgeMode!==undefined&&!['clamp','default'].includes(layer.maskFeatherEdgeMode))throw Error('Invalid mask feather edge mode.')
 if(!Number.isFinite(density)||density<0||density>1||!Number.isFinite(feather)||feather<0||feather>MAX_MASK_FEATHER)throw Error('Mask density must be between 0 and 1 and feather between 0 and 250 source pixels.')
 return {density,feather,...(layer.maskFeatherModel?{featherModel:layer.maskFeatherModel}:{}),...(layer.maskFeatherEdgeMode?{featherEdgeMode:layer.maskFeatherEdgeMode}:{})}
}
export function maskPropertyGeometry(width:number,height:number,layer:MaskPropertySource):{width:number;height:number;inset:number}{
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('Invalid mask raster dimensions.')
 const {density,feather,featherModel}=maskProperties(layer),inset=feather>0&&(width>1||height>1)?featherModel==='photoshop'?(photoshopMaskFeatherKernel(feather).length-1)/2+2:Math.ceil(feather*3)+2:0,w=width+2*inset,h=height+2*inset
 if(w>LIMITS.maxSide||h>LIMITS.maxSide||w*h>LIMITS.maxSurfacePixels||(!inset&&density===1?false:w*h*(inset?40:12)>512*1024*1024))throw Error('Mask properties exceed the 512 MiB working raster budget.')
 return {width:w,height:h,inset}
}
/** Density is a white blend after feather, never a write to the saved PNG.
 * Feather uses source-mask pixels and pads with the original outside tone, so
 * independently placed and group masks can fade beyond their original bounds. */
export function effectiveMaskPixels(source:PixelImage,layer:MaskPropertySource):EffectiveMask{
 const {width,height,data}=source,{density,feather,featherModel,featherEdgeMode}=maskProperties(layer)
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||data.length!==width*height*4)throw Error('Invalid mask raster dimensions.')
 const originalBackground=typeof layer.photoshopMaskDefault==='number'&&Number.isFinite(layer.photoshopMaskDefault)?Math.max(0,Math.min(255,Math.round(layer.photoshopMaskDefault))):maskBackground(source)
 const background=Math.round(255+(originalBackground-255)*density)
 // Native 1px masks represent a uniform infinite plane; feather is a no-op.
 const {inset,width:w,height:h}=maskPropertyGeometry(width,height,layer)
 if(!inset&&density===1)return {image:source,inset:0,background}
 let image:PixelImage
 if(inset){const padded=new Uint8ClampedArray(w*h*4);for(let i=0;i<padded.length;i+=4)padded.set([originalBackground,originalBackground,originalBackground,255],i)
  if(featherModel==='photoshop'&&featherEdgeMode==='clamp')for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.max(0,Math.min(width-1,x-inset)),sy=Math.max(0,Math.min(height-1,y-inset)),value=data[(sy*width+sx)*4];padded.set([value,value,value,255],(y*w+x)*4)}
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=data[(y*width+x)*4];padded.set([value,value,value,255],((y+inset)*w+x+inset)*4)}
  image=featherModel==='photoshop'?photoshopMaskFeatherPixels({width:w,height:h,data:padded},feather,originalBackground):applyImageFilter({width:w,height:h,data:padded},{kind:'gaussianBlur',radius:feather})
 }else image={width,height,data:new Uint8ClampedArray(data)}
 if(density!==1)for(let i=0;i<image.data.length;i+=4){const value=Math.round(255+(image.data[i]-255)*density);image.data.set([value,value,value,255],i)}
 return {image,inset,background}
}
export function effectiveMaskTransform(placement:Transform,source:Pick<PixelImage,'width'|'height'>,inset:number):Transform{return inset?expandedContentTransform(placement,[source.width,source.height],inset):placement}
export function maskPropertiesKey(hash:string,layer:MaskPropertySource):string{return JSON.stringify([hash,layer.maskDensity??1,layer.maskFeather??0,layer.photoshopMaskDefault??null,layer.maskFeatherModel??'compositor',layer.maskFeatherEdgeMode??'default'])}
/** Document-grid sampling for loaded coverage and external clipping bakes. */
export function sampleEffectiveMask(mask:EffectiveMask,placement:Transform,x:number,y:number):number{
 const {image,background}=mask,{width,height,data}=image
 if(width===1&&height===1)return data[0]
 const [sx,sy]=sourcePoint({transform:placement},x,y,width,height),value=(x:number,y:number)=>x<0||y<0||x>=width||y>=height?background:data[(y*width+x)*4]
 if(placement.sampling==='Nearest')return value(Math.floor(sx),Math.floor(sy))
 const left=Math.floor(sx-.5),top=Math.floor(sy-.5),tx=sx-.5-left,ty=sy-.5-top
 return Math.round(value(left,top)*(1-tx)*(1-ty)+value(left+1,top)*tx*(1-ty)+value(left,top+1)*(1-tx)*ty+value(left+1,top+1)*tx*ty)
}
