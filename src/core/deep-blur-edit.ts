import {PNG} from 'pngjs'
import {EditorError,LIMITS,type Layer,type Transform} from '../shared/contracts'
import {gaussianLineConvolver} from '../shared/image-filter-algorithms'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {compactStroke} from '../shared/stroke-compaction'
import {smoothStroke} from '../shared/interaction-geometry'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {placedRasterRect} from './stroke-raster'
import {carryFilterMask} from './filter-edit'
import type {PixelStage} from './pixel-actions'
import type {RetouchAction} from './retouch-edit'

export const DEEP_BLUR_WORKING_BUDGET=512*1024*1024
export const DEEP_BLUR_COMPUTE_BUDGET=500_000_000
export interface DeepBlurPrepared {deep:Uint16Array;width:number;height:number;transform:Transform;maskPNG?:Buffer}
/** f01e298 BlurTool takes one softened source at stroke start, in the layer's grid.
 * Our integrated Gaussian uses Float32 passes with transparent outside samples.
 * Core Image's private kernel and native downsampling of oversized samples are not pixel-equivalence claims.
 * Oversized work is refused rather than covertly making the 16-bit sample coarser.
 */
export function prepareDeepBlur(stage:PixelStage,input:RetouchAction):DeepBlurPrepared {
 if(input.kind!=='blur'||input.target==='mask'||input.sourceMode==='all-layers')throw new EditorError('UNSUPPORTED_FEATURE','High-depth blur supports this image layer only.')
 const layer=stage.manifest.layers.find(item=>item.id===input.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The blur layer no longer exists.')
 const asset=layer.imageFile?stage.assets.get(layer.imageFile):undefined
 if(!asset?.deep||asset.bitDepth!==16||layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a 16-bit image layer to blur.')
 const source=asset.deep,sourceWidth=asset.width,sourceHeight=asset.height,oldTransform=structuredClone(layer.transform)
 if(source.length!==sourceWidth*sourceHeight*4)throw new EditorError('INVALID_PROJECT','The high-depth layer has invalid pixel dimensions.')
 for(let at=0;at<source.length;at+=4)if(source[at]>source[at+3]||source[at+1]>source[at+3]||source[at+2]>source[at+3])throw new EditorError('INVALID_PROJECT','High-depth blur requires premultiplied sRGB pixels.')
 const points=smoothStroke(compactStroke(input.points,Math.min(.125,input.size*.005)),input.smoothing??0),protect=input.protectAlpha!==false,opacity=input.opacity??1
 if(!opacity||stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return {deep:source,width:sourceWidth,height:sourceHeight,transform:oldTransform}
 const perPixel=Math.sqrt(oldTransform.size[0]*oldTransform.size[1]/(sourceWidth*sourceHeight)),sigma=Math.min(Math.min(50,Math.max(.5,input.blurRadius??5))/Math.max(1e-6,perPixel),Math.max(sourceWidth,sourceHeight)/2)
 let left=0,top=0,right=sourceWidth,bottom=sourceHeight
 if(!protect){const radius=(input.size+2)/2,rx=radius*sourceWidth/oldTransform.size[0],ry=radius*sourceHeight/oldTransform.size[1];for(const point of points){const [x,y]=sourcePoint({transform:oldTransform},...point,sourceWidth,sourceHeight);left=Math.min(left,Math.floor(x-rx));top=Math.min(top,Math.floor(y-ry));right=Math.max(right,Math.ceil(x+rx));bottom=Math.max(bottom,Math.ceil(y+ry))}}
 const width=right-left,height=bottom-top,count=width*height
 if(!Number.isSafeInteger(count)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||count>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The high-depth blur working raster exceeds its size budget.')
 const kernelLength=Math.max(1,Math.ceil(sigma*3))*2+1
 // Estimate direct or FFT convolution before allocating full-size work arrays.
 const pass=(length:number)=>{let n=1;while(n<length+Math.ceil(sigma*3)*4)n*=2;return {bytes:kernelLength>33?n*32:0,ops:kernelLength>33?3*n*Math.log2(n):length*kernelLength}}
 const horizontalWork=pass(width),verticalWork=pass(height),maskAsset=layer.maskFile?stage.assets.get(layer.maskFile):undefined
 const estimatedBytes=source.byteLength+asset.bytes.length+(asset.displayBytes?.length??0)+count*(maskAsset?56:40)+horizontalWork.bytes+verticalWork.bytes+kernelLength*16+(width+height)*16+(maskAsset?maskAsset.bytes.length+maskAsset.width*maskAsset.height*4:0)
 if(estimatedBytes>DEEP_BLUR_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','The high-depth blur exceeds its 512 MiB working budget.',{estimatedBytes,maximumBytes:DEEP_BLUR_WORKING_BUDGET})
 const estimatedWork=4*(height*horizontalWork.ops+width*verticalWork.ops)
 if(estimatedWork>DEEP_BLUR_COMPUTE_BUDGET)throw new EditorError('RESOURCE_LIMIT','The high-depth blur exceeds its convolution compute budget.',{estimatedWork,maximumWork:DEEP_BLUR_COMPUTE_BUDGET})
 const transform=left||top||width!==sourceWidth||height!==sourceHeight?placedRasterRect(oldTransform,sourceWidth,sourceHeight,left,top,width,height):structuredClone(oldTransform)
 const base=width===sourceWidth&&height===sourceHeight&&!left&&!top?source:new Uint16Array(count*4)
 if(base!==source)for(let y=0;y<sourceHeight;y++)base.set(source.subarray(y*sourceWidth*4,(y+1)*sourceWidth*4),((y-top)*width-left)*4)
 const coverage=brushStrokeCoverage({width,height,transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},points,input.size,input.hardness??1)
 if(stage.selection)for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,doc=documentPoint({transform} as Layer,x+.5,y+.5,width,height);coverage[p]=Math.round(coverage[p]*selectionCoverage(stage.selection,...doc))}
 if(!opacity||!coverage.some(value=>value))return {deep:source,width:sourceWidth,height:sourceHeight,transform:oldTransform}
 const horizontal=gaussianLineConvolver(width,sigma),vertical=gaussianLineConvolver(height,sigma),intermediate=new Float32Array(count),soft=new Uint16Array(count*4),row=new Float32Array(width),column=new Float32Array(height)
 for(let c=0;c<4;c++){
  for(let y=0;y<height;y++){for(let x=0;x<width;x++)row[x]=base[(y*width+x)*4+c];intermediate.set(horizontal(row),y*width)}
  for(let x=0;x<width;x++){for(let y=0;y<height;y++)column[y]=intermediate[y*width+x];const result=vertical(column);for(let y=0;y<height;y++)soft[(y*width+x)*4+c]=Math.max(0,Math.min(65535,Math.round(result[y])))}
 }
 const output=new Uint16Array(base)
 for(let p=0;p<count;p++){
  const amount=coverage[p]/255*opacity;if(!amount)continue
  const at=p*4,sourceAlpha=soft[at+3],baseAlpha=base[at+3],sa=sourceAlpha/65535*amount
  if(protect){if(!baseAlpha)continue;for(let c=0;c<3;c++)output[at+c]=Math.min(baseAlpha,Math.round(base[at+c]*(1-sa)+(sourceAlpha?soft[at+c]*baseAlpha/sourceAlpha:0)*sa))}
  else{output[at+3]=Math.min(65535,Math.round(sourceAlpha*amount+baseAlpha*(1-sa)));for(let c=0;c<3;c++)output[at+c]=Math.min(output[at+3],Math.round(soft[at+c]*amount+base[at+c]*(1-sa)))}
 }
 let cropLeft=0,cropTop=0,cropRight=width,cropBottom=height
 if(!protect){cropLeft=width;cropTop=height;cropRight=0;cropBottom=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(output[(y*width+x)*4+3]){cropLeft=Math.min(cropLeft,x);cropTop=Math.min(cropTop,y);cropRight=Math.max(cropRight,x+1);cropBottom=Math.max(cropBottom,y+1)}if(!cropRight){cropLeft=0;cropTop=0;cropRight=width;cropBottom=height}}
 const outputWidth=cropRight-cropLeft,outputHeight=cropBottom-cropTop,cropped=cropLeft||cropTop||outputWidth!==width||outputHeight!==height,deep=cropped?new Uint16Array(outputWidth*outputHeight*4):output,outputTransform=cropped?placedRasterRect(transform,width,height,cropLeft,cropTop,outputWidth,outputHeight):transform
 if(cropped)for(let y=0;y<outputHeight;y++)deep.set(output.subarray(((y+cropTop)*width+cropLeft)*4,((y+cropTop)*width+cropRight)*4),y*outputWidth*4)
 let maskPNG:Buffer|undefined
 if(maskAsset&&layer.maskLinked!==false&&!layer.maskPlacement&&(outputWidth!==sourceWidth||outputHeight!==sourceHeight||outputTransform.origin[0]!==oldTransform.origin[0]||outputTransform.origin[1]!==oldTransform.origin[1])){
  const header=maskAsset.bytes;if(header[24]!==8||header[25]!==0)throw new EditorError('INVALID_PROJECT','The linked blur mask must be PNG8 grayscale.')
  const mask=PNG.sync.read(header,{checkCRC:true}),carried=carryFilterMask(mask,oldTransform,{png:{width:outputWidth,height:outputHeight} as PNG,transform:outputTransform,grew:true});maskPNG=encodeRaster(carried,true)
 }
 return {deep,width:outputWidth,height:outputHeight,transform:outputTransform,...(maskPNG?{maskPNG}:{})}
}
