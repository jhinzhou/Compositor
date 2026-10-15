import {PNG} from 'pngjs'
import {actionSchema,EditorError,LIMITS,type EditAction,type Layer,type Transform} from '../shared/contracts'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {validateHDRPixels} from '../shared/hdr-pixels'
import type {HDRCompositeAsset} from './hdr-composite'
import {gaussianLineConvolver} from '../shared/image-filter-algorithms'
import {warpHDRPremultiplied} from '../shared/hdr-warp'
import {prepareBrushStroke,brushStrokeExtentDiameter} from '../shared/brush-dynamics'
import {compactStroke} from '../shared/stroke-compaction'
import {smoothStroke} from '../shared/interaction-geometry'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {sourcePoint,documentPoint,selectionCoverage,encodeRaster} from './raster-edit'
import {paintHighDepthRaster} from './high-depth-paint'
import {placedRasterRect} from './stroke-raster'
import {carryFilterMask} from './filter-edit'
import {sampleHDRLayerInDocument,sampleHDRBilinear} from './hdr-resample'
import type {PixelStage} from './pixel-actions'
import type {RetouchAction} from './retouch-edit'
export type HDRPaintAction=Extract<EditAction,{type:'layer.paint'}>
export interface HDRStrokePrepared {hdr:Float32Array;width:number;height:number;transform:Transform;maskPNG?:Buffer}
interface Source {hdr:Float32Array;width:number;height:number;transform:Transform;layer:Layer;retainedBytes:number}
function source(stage:PixelStage,id:string):Source {
 const layer=stage.manifest.layers.find(item=>item.id===id)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The stroke layer no longer exists.')
 const asset=(layer.imageFile?stage.assets.get(layer.imageFile):undefined) as HDRCompositeAsset|undefined
 if(!asset||asset.bitDepth!==16||!asset.hdr||layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose an HDR Float32 image layer for this stroke.')
 const {width,height,hdr}=asset
 if(!(hdr instanceof Float32Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>MAX_DEEP_PIXELS||hdr.length!==width*height*4)throw new EditorError('INVALID_PROJECT','The high-depth stroke source has invalid dimensions.')
 validateHDRPixels(hdr,width,height,0)
 return {hdr,width,height,transform:structuredClone(layer.transform),layer,retainedBytes:hdr.byteLength+asset.bytes.length+(asset.displayBytes?.length??0)}
}
function budget(stage:PixelStage,s:Source,width:number,height:number,warp=false,size=0):void {
 const count=width*height,doc=stage.manifest.width*stage.manifest.height,mask=s.layer.maskFile&&stage.assets.get(s.layer.maskFile)
 if(!Number.isSafeInteger(count)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||count>MAX_DEEP_PIXELS||!Number.isSafeInteger(doc)||doc<1||doc>MAX_DEEP_PIXELS)throw new EditorError('RESOURCE_LIMIT','The high-depth stroke exceeds its raster size budget.')
 // Conservatively reserves retained source, copies/crop/coverage, document sampler
 // and warp outputs/offsets. Reserve worst-case resampler reduction scratch as well.
 const estimatedBytes=s.retainedBytes+count*(warp?49:64)+(warp?doc*48+s.hdr.byteLength*4+(2*Math.ceil(size/2)+1)**2*16:0)+(mask?mask.bytes.length+mask.width*mask.height*12:0)
 if(estimatedBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The high-depth stroke exceeds its 512 MiB working budget.',{estimatedBytes,maximumBytes:MAX_DEEP_WORKING_BYTES})
}
function bounds(s:Source,points:[number,number][],size:number,grow:boolean):[number,number,number,number] {
 let left=0,top=0,right=s.width,bottom=s.height
 if(grow){const rx=size/2*s.width/s.transform.size[0],ry=size/2*s.height/s.transform.size[1];for(const point of points){const [x,y]=sourcePoint({transform:s.transform},...point,s.width,s.height);left=Math.min(left,Math.floor(x-rx));top=Math.min(top,Math.floor(y-ry));right=Math.max(right,Math.ceil(x+rx));bottom=Math.max(bottom,Math.ceil(y+ry))}}
 return [left,top,right-left,bottom-top]
}
function expand(s:Source,rect:[number,number,number,number]):HDRStrokePrepared {
 const [left,top,width,height]=rect,transform=left||top||width!==s.width||height!==s.height?placedRasterRect(s.transform,s.width,s.height,left,top,width,height):structuredClone(s.transform)
 const hdr=width===s.width&&height===s.height&&!left&&!top?s.hdr:new Float32Array(width*height*4)
 if(hdr!==s.hdr)for(let y=0;y<s.height;y++)hdr.set(s.hdr.subarray(y*s.width*4,(y+1)*s.width*4),((y-top)*width-left)*4)
 return {hdr,width,height,transform}
}
function changed(a:Float32Array,b:Float32Array):boolean {for(let i=0;i<a.length;i++)if(a[i]!==b[i])return true;return false}
function finish(stage:PixelStage,s:Source,result:HDRStrokePrepared,trim:boolean):HDRStrokePrepared {
 validateHDRPixels(result.hdr,result.width,result.height,0)
 let {hdr,width,height,transform}=result
 if(trim){let left=width,top=height,right=0,bottom=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(hdr[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}
  // Keep the transparent surface when a stroke erases its final visible pixel.
  if(right&&(left||top||right!==width||bottom!==height)){const w=right-left,h=bottom-top,output=new Float32Array(w*h*4);for(let y=0;y<h;y++)output.set(hdr.subarray(((y+top)*width+left)*4,((y+top)*width+right)*4),y*w*4);transform=placedRasterRect(transform,width,height,left,top,w,h);hdr=output;width=w;height=h}
 }
 let maskPNG:Buffer|undefined
 if(s.layer.maskFile&&s.layer.maskLinked!==false&&!s.layer.maskPlacement&&(width!==s.width||height!==s.height||JSON.stringify(transform)!==JSON.stringify(s.transform))){
  const asset=stage.assets.get(s.layer.maskFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The linked stroke mask is missing.')
  if(asset.bytes[24]!==8||asset.bytes[25]!==0)throw new EditorError('INVALID_PROJECT','The linked stroke mask must be PNG8 grayscale.')
  const mask=PNG.sync.read(asset.bytes,{checkCRC:true}),carried=carryFilterMask(mask,s.transform,{png:{width,height} as PNG,transform,grew:true});maskPNG=encodeRaster(carried,true)
 }
 return {hdr,width,height,transform,...(maskPNG?{maskPNG}:{})}
}
/** Shared brush geometry with direct Float32 source-over/erase compositing.
 * Unlike the native Compositor display-proxy bridge, hit pixels retain original
 * negative and overwhite contributions; untouched Float32 samples stay exact.
 */
export function prepareHDRPaint(stage:PixelStage,input:HDRPaintAction):HDRStrokePrepared {
 const action=actionSchema.parse(input) as HDRPaintAction
 if(action.type!=='layer.paint'||action.target==='mask')throw new EditorError('UNSUPPORTED_FEATURE','High-depth paint edits image pixels; masks stay 8-bit.')
 const s=source(stage,action.layerId),noChange=()=>({hdr:s.hdr,width:s.width,height:s.height,transform:s.transform})
 if(!action.opacity||action.flow===0||stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return noChange()
 const prepared=prepareBrushStroke(action.points,action.size,action.smoothing??0,action.pressureSize!==false||action.pressureOpacity?action.pressures:undefined),rect=bounds(s,prepared.points,brushStrokeExtentDiameter(action.size,action.hardness,{brushModel:action.brushModel,tip:action.tip}),!action.erase)
 budget(stage,s,rect[2],rect[3]);const base=expand(s,rect)
 const hdr=paintHighDepthRaster(base.hdr,{width:base.width,height:base.height,transform:base.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},prepared.points,action.color,action.size,action.hardness,action.opacity,action.erase,stage.selection,{flow:action.flow,spacing:action.spacing,brushModel:action.brushModel,tip:action.tip,pressures:prepared.pressures,pressureSize:action.pressureSize,pressureOpacity:action.pressureOpacity})
 if(!changed(hdr,base.hdr))return noChange()
 return finish(stage,s,{...base,hdr},true)
}
/** This-layer Smudge/Liquify keep a document-space Float32 HDR copy and Float32 warp
 * state. Only the commit footprint returns to the source grid; unhit and unselected
 * pixels are copied from the original source, never from a reprojected whole layer.
 */
export function prepareHDRWarp(stage:PixelStage,input:RetouchAction):HDRStrokePrepared {
 const action=actionSchema.parse(input) as RetouchAction
 if(action.type!=='layer.retouch'||action.kind!=='smear'||action.target==='mask'||action.sourceMode==='all-layers')throw new EditorError('UNSUPPORTED_FEATURE','High-depth Smudge and Liquify support this image layer only.')
 const s=source(stage,action.layerId),noChange=()=>({hdr:s.hdr,width:s.width,height:s.height,transform:s.transform}),protect=action.protectAlpha!==false
 if(!action.opacity||action.points.length<2||stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return noChange()
 const points=smoothStroke(compactStroke(action.points,Math.min(.125,action.size*.005)),action.smoothing??0),rect=bounds(s,points,Math.max(2,action.size)+4,!protect)
 budget(stage,s,rect[2],rect[3],true,action.size);const base=expand(s,rect),working=sampleHDRLayerInDocument({hdr:s.hdr,width:s.width,height:s.height},s.transform,stage.manifest.width,stage.manifest.height),warped=warpHDRPremultiplied({data:working.hdr,width:working.width,height:working.height},{mode:action.smearMode??'smudge',points,size:action.size,hardness:action.hardness,strength:action.opacity})
 if(!warped.dabs.length)return noChange()
 // finishWarp uses an enlarged hard tip at opacity1 in copy mode. The original
 // brush strength was already applied by the warp kernels and must not apply twice.
 const coverage=brushStrokeCoverage({width:base.width,height:base.height,transform:base.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},warped.dabs,Math.max(2,action.size)+4,1),hdr=new Float32Array(base.hdr)
 for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
  const p=y*base.width+x,at=p*4;if(!coverage[p])continue
  const doc=documentPoint({transform:base.transform} as Layer,x+.5,y+.5,base.width,base.height),selected=selectionCoverage(stage.selection,...doc),amount=coverage[p]/255*selected;if(!amount)continue
  // Pixels outside the document were never part of the native warp work canvas.
  if(doc[0]<0||doc[1]<0||doc[0]>=working.width||doc[1]>=working.height)continue
  const color=sampleHDRBilinear(warped.data,working.width,working.height,...doc),unwarped=sampleHDRBilinear(working.hdr,working.width,working.height,...doc),alpha=base.hdr[at+3]
  if(color.every((value,c)=>value===unwarped[c]))continue
  if(protect){if(!alpha)continue;for(let c=0;c<3;c++){const normalized=color[3]>0?color[c]*alpha/color[3]:0;hdr[at+c]=Math.fround(base.hdr[at+c]+(normalized-base.hdr[at+c])*amount)}}
  else {hdr[at+3]=Math.max(0,Math.min(1,alpha+(color[3]-alpha)*amount));for(let c=0;c<3;c++)hdr[at+c]=hdr[at+3]?Math.fround(base.hdr[at+c]+(color[c]-base.hdr[at+c])*amount):0}
 }
 if(!changed(hdr,base.hdr))return noChange()
 return finish(stage,s,{...base,hdr},!protect)
}

/** Original source is softened once per stroke in Float32 extended sRGB. */
export function prepareHDRBlur(stage:PixelStage,input:RetouchAction):HDRStrokePrepared {
 const action=actionSchema.parse(input) as RetouchAction
 if(action.type!=='layer.retouch'||action.kind!=='blur'||action.target==='mask'||action.sourceMode==='all-layers')throw new EditorError('UNSUPPORTED_FEATURE','HDR blur supports this image layer only.')
 const s=source(stage,action.layerId),noChange=()=>({hdr:s.hdr,width:s.width,height:s.height,transform:s.transform}),protect=action.protectAlpha!==false
 if(!action.opacity||stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return noChange()
 const points=smoothStroke(compactStroke(action.points,Math.min(.125,action.size*.005)),action.smoothing??0),rect=bounds(s,points,action.size+2,!protect),width=rect[2],height=rect[3],count=width*height
 budget(stage,s,width,height)
 const pixelScale=Math.sqrt(s.transform.size[0]*s.transform.size[1]/(s.width*s.height)),sigma=Math.min(Math.min(50,Math.max(.5,action.blurRadius??5))/Math.max(1e-6,pixelScale),Math.max(s.width,s.height)/2),radius=Math.max(1,Math.ceil(sigma*3)),kernel=radius*2+1
 const pass=(n:number)=>{let padded=1;while(padded<n+radius*4)padded*=2;return {bytes:kernel>33?padded*32:0,ops:kernel>33?3*padded*Math.log2(padded):n*kernel}},rowWork=pass(width),columnWork=pass(height),estimatedWork=4*(height*rowWork.ops+width*columnWork.ops),maskAsset=s.layer.maskFile?stage.assets.get(s.layer.maskFile):undefined,estimatedBytes=s.retainedBytes+count*(maskAsset?84:72)+(maskAsset?maskAsset.bytes.length+maskAsset.width*maskAsset.height*4:0)+rowWork.bytes+columnWork.bytes+kernel*16+(width+height)*16
 if(estimatedWork>500_000_000||estimatedBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','HDR blur exceeds its bounded convolution work.',{estimatedWork,estimatedBytes})
 const base=expand(s,rect),coverage=brushStrokeCoverage({width,height,transform:base.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},points,action.size,action.hardness)
 if(stage.selection)for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,doc=documentPoint({transform:base.transform} as Layer,x+.5,y+.5,width,height);coverage[p]=Math.round(coverage[p]*selectionCoverage(stage.selection,...doc))}
 if(!coverage.some(v=>v))return noChange()
 const horizontal=gaussianLineConvolver(width,sigma),vertical=gaussianLineConvolver(height,sigma),intermediate=new Float32Array(count),soft=new Float32Array(count*4),row=new Float32Array(width),column=new Float32Array(height)
 for(let c=0;c<4;c++){for(let y=0;y<height;y++){for(let x=0;x<width;x++)row[x]=base.hdr[(y*width+x)*4+c];intermediate.set(horizontal(row),y*width)}for(let x=0;x<width;x++){for(let y=0;y<height;y++)column[y]=intermediate[y*width+x];const output=vertical(column);for(let y=0;y<height;y++)soft[(y*width+x)*4+c]=c===3?Math.max(0,Math.min(1,output[y])):output[y]}}
 const hdr=base.hdr.slice()
 for(let p=0;p<count;p++){const amount=coverage[p]/255*action.opacity;if(!amount)continue;const at=p*4,a=base.hdr[at+3],softAlpha=soft[at+3],sa=softAlpha*amount
  if(protect){if(!a)continue;for(let c=0;c<3;c++)hdr[at+c]=Math.fround(base.hdr[at+c]*(1-sa)+(softAlpha>0?soft[at+c]*a/softAlpha:0)*sa)}
  else{hdr[at+3]=Math.max(0,Math.min(1,softAlpha*amount+a*(1-sa)));for(let c=0;c<3;c++)hdr[at+c]=hdr[at+3]?Math.fround(soft[at+c]*amount+base.hdr[at+c]*(1-sa)):0}
 }
 if(!changed(hdr,base.hdr))return noChange()
 return finish(stage,s,{...base,hdr},!protect)
}
export function prepareHDRStroke(stage:PixelStage,action:HDRPaintAction|RetouchAction):HDRStrokePrepared {
 if(action.type==='layer.paint')return prepareHDRPaint(stage,action)
 if(action.kind==='blur')return prepareHDRBlur(stage,action)
 return prepareHDRWarp(stage,action)
}
