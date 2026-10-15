import {PNG} from 'pngjs'
import {actionSchema,EditorError,LIMITS,type EditAction,type Layer,type Transform} from '../shared/contracts'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {warpDeepPremultiplied} from '../shared/deep-warp'
import {prepareBrushStroke,brushStrokeExtentDiameter} from '../shared/brush-dynamics'
import {compactStroke} from '../shared/stroke-compaction'
import {smoothStroke} from '../shared/interaction-geometry'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {sourcePoint,documentPoint,selectionCoverage,encodeRaster} from './raster-edit'
import {paintHighDepthRaster} from './high-depth-paint'
import {placedRasterRect} from './stroke-raster'
import {carryFilterMask} from './filter-edit'
import {sampleDeepLayerInDocument,sampleDeepBilinear} from './deep-resample'
import type {PixelStage} from './pixel-actions'
import type {RetouchAction} from './retouch-edit'
export type DeepPaintAction=Extract<EditAction,{type:'layer.paint'}>
export interface DeepStrokePrepared {deep:Uint16Array;width:number;height:number;transform:Transform;maskPNG?:Buffer}
interface Source {deep:Uint16Array;width:number;height:number;transform:Transform;layer:Layer;retainedBytes:number}
function source(stage:PixelStage,id:string):Source {
 const layer=stage.manifest.layers.find(item=>item.id===id)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The stroke layer no longer exists.')
 const asset=layer.imageFile&&stage.assets.get(layer.imageFile)
 if(!asset||asset.bitDepth!==16||!asset.deep||layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a 16-bit image layer for this stroke.')
 const {width,height,deep}=asset
 if(!(deep instanceof Uint16Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>MAX_DEEP_PIXELS||deep.length!==width*height*4)throw new EditorError('INVALID_PROJECT','The high-depth stroke source has invalid dimensions.')
 for(let at=0;at<deep.length;at+=4)if(deep[at]>deep[at+3]||deep[at+1]>deep[at+3]||deep[at+2]>deep[at+3])throw new EditorError('INVALID_PROJECT','High-depth strokes require premultiplied sRGB samples.')
 return {deep,width,height,transform:structuredClone(layer.transform),layer,retainedBytes:deep.byteLength+asset.bytes.length+(asset.displayBytes?.length??0)}
}
function budget(stage:PixelStage,s:Source,width:number,height:number,warp=false,size=0):void {
 const count=width*height,doc=stage.manifest.width*stage.manifest.height,mask=s.layer.maskFile&&stage.assets.get(s.layer.maskFile)
 if(!Number.isSafeInteger(count)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||count>MAX_DEEP_PIXELS||!Number.isSafeInteger(doc)||doc<1||doc>MAX_DEEP_PIXELS)throw new EditorError('RESOURCE_LIMIT','The high-depth stroke exceeds its raster size budget.')
 // Conservatively reserves retained source, copies/crop/coverage, document sampler
 // and warp outputs/offsets. Reserve worst-case resampler reduction scratch as well.
 const estimatedBytes=s.retainedBytes+count*(warp?25:40)+(warp?doc*32+s.deep.byteLength*4+(2*Math.ceil(size/2)+1)**2*16:0)+(mask?mask.bytes.length+mask.width*mask.height*12:0)
 if(estimatedBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The high-depth stroke exceeds its 512 MiB working budget.',{estimatedBytes,maximumBytes:MAX_DEEP_WORKING_BYTES})
}
function bounds(s:Source,points:[number,number][],size:number,grow:boolean):[number,number,number,number] {
 let left=0,top=0,right=s.width,bottom=s.height
 if(grow){const rx=size/2*s.width/s.transform.size[0],ry=size/2*s.height/s.transform.size[1];for(const point of points){const [x,y]=sourcePoint({transform:s.transform},...point,s.width,s.height);left=Math.min(left,Math.floor(x-rx));top=Math.min(top,Math.floor(y-ry));right=Math.max(right,Math.ceil(x+rx));bottom=Math.max(bottom,Math.ceil(y+ry))}}
 return [left,top,right-left,bottom-top]
}
function expand(s:Source,rect:[number,number,number,number]):DeepStrokePrepared {
 const [left,top,width,height]=rect,transform=left||top||width!==s.width||height!==s.height?placedRasterRect(s.transform,s.width,s.height,left,top,width,height):structuredClone(s.transform)
 const deep=width===s.width&&height===s.height&&!left&&!top?s.deep:new Uint16Array(width*height*4)
 if(deep!==s.deep)for(let y=0;y<s.height;y++)deep.set(s.deep.subarray(y*s.width*4,(y+1)*s.width*4),((y-top)*width-left)*4)
 return {deep,width,height,transform}
}
function changed(a:Uint16Array,b:Uint16Array):boolean {for(let i=0;i<a.length;i++)if(a[i]!==b[i])return true;return false}
function finish(stage:PixelStage,s:Source,result:DeepStrokePrepared,trim:boolean):DeepStrokePrepared {
 let {deep,width,height,transform}=result
 if(trim){let left=width,top=height,right=0,bottom=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(deep[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}
  // Keep the transparent surface when a stroke erases its final visible pixel.
  if(right&&(left||top||right!==width||bottom!==height)){const w=right-left,h=bottom-top,output=new Uint16Array(w*h*4);for(let y=0;y<h;y++)output.set(deep.subarray(((y+top)*width+left)*4,((y+top)*width+right)*4),y*w*4);transform=placedRasterRect(transform,width,height,left,top,w,h);deep=output;width=w;height=h}
 }
 let maskPNG:Buffer|undefined
 if(s.layer.maskFile&&s.layer.maskLinked!==false&&!s.layer.maskPlacement&&(width!==s.width||height!==s.height||JSON.stringify(transform)!==JSON.stringify(s.transform))){
  const asset=stage.assets.get(s.layer.maskFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The linked stroke mask is missing.')
  if(asset.bytes[24]!==8||asset.bytes[25]!==0)throw new EditorError('INVALID_PROJECT','The linked stroke mask must be PNG8 grayscale.')
  const mask=PNG.sync.read(asset.bytes,{checkCRC:true}),carried=carryFilterMask(mask,s.transform,{png:{width,height} as PNG,transform,grew:true});maskPNG=encodeRaster(carried,true)
 }
 return {deep,width,height,transform,...(maskPNG?{maskPNG}:{})}
}
/** Shared brush geometry with direct RGBA16 compositing. This intentionally
 * improves on native Compositor's PNG8 paint bridge; no source sample is rounded
 * to a display byte before painting, and unaffected channels remain exact.
 */
export function prepareDeepPaint(stage:PixelStage,input:DeepPaintAction):DeepStrokePrepared {
 const action=actionSchema.parse(input) as DeepPaintAction
 if(action.type!=='layer.paint'||action.target==='mask')throw new EditorError('UNSUPPORTED_FEATURE','High-depth paint edits image pixels; masks stay 8-bit.')
 const s=source(stage,action.layerId),noChange=()=>({deep:s.deep,width:s.width,height:s.height,transform:s.transform})
 if(!action.opacity||action.flow===0||stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return noChange()
 const prepared=prepareBrushStroke(action.points,action.size,action.smoothing??0,action.pressureSize!==false||action.pressureOpacity?action.pressures:undefined),rect=bounds(s,prepared.points,brushStrokeExtentDiameter(action.size,action.hardness,{brushModel:action.brushModel,tip:action.tip}),!action.erase)
 budget(stage,s,rect[2],rect[3]);const base=expand(s,rect)
 const deep=paintHighDepthRaster(base.deep,{width:base.width,height:base.height,transform:base.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},prepared.points,action.color,action.size,action.hardness,action.opacity,action.erase,stage.selection,{flow:action.flow,spacing:action.spacing,brushModel:action.brushModel,tip:action.tip,pressures:prepared.pressures,pressureSize:action.pressureSize,pressureOpacity:action.pressureOpacity})
 if(!changed(deep,base.deep))return noChange()
 return finish(stage,s,{...base,deep},true)
}
/** This-layer Smudge/Liquify keep a document-space RGBA16 copy and Float32 warp
 * state. Only the commit footprint returns to the source grid; unhit and unselected
 * pixels are copied from the original source, never from a reprojected whole layer.
 */
export function prepareDeepWarp(stage:PixelStage,input:RetouchAction):DeepStrokePrepared {
 const action=actionSchema.parse(input) as RetouchAction
 if(action.type!=='layer.retouch'||action.kind!=='smear'||action.target==='mask'||action.sourceMode==='all-layers')throw new EditorError('UNSUPPORTED_FEATURE','High-depth Smudge and Liquify support this image layer only.')
 const s=source(stage,action.layerId),noChange=()=>({deep:s.deep,width:s.width,height:s.height,transform:s.transform}),protect=action.protectAlpha!==false
 if(!action.opacity||action.points.length<2||stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return noChange()
 const points=smoothStroke(compactStroke(action.points,Math.min(.125,action.size*.005)),action.smoothing??0),rect=bounds(s,points,Math.max(2,action.size)+4,!protect)
 budget(stage,s,rect[2],rect[3],true,action.size);const base=expand(s,rect),working=sampleDeepLayerInDocument({deep:s.deep,width:s.width,height:s.height},s.transform,stage.manifest.width,stage.manifest.height),warped=warpDeepPremultiplied({data:working.deep,width:working.width,height:working.height},{mode:action.smearMode??'smudge',points,size:action.size,hardness:action.hardness,strength:action.opacity})
 if(!warped.dabs.length)return noChange()
 // finishWarp uses an enlarged hard tip at opacity1 in copy mode. The original
 // brush strength was already applied by the warp kernels and must not apply twice.
 const coverage=brushStrokeCoverage({width:base.width,height:base.height,transform:base.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},warped.dabs,Math.max(2,action.size)+4,1),deep=new Uint16Array(base.deep)
 for(let y=0;y<base.height;y++)for(let x=0;x<base.width;x++){
  const p=y*base.width+x,at=p*4;if(!coverage[p])continue
  const doc=documentPoint({transform:base.transform} as Layer,x+.5,y+.5,base.width,base.height),selected=selectionCoverage(stage.selection,...doc),amount=coverage[p]/255*selected;if(!amount)continue
  // Pixels outside the document were never part of the native warp work canvas.
  if(doc[0]<0||doc[1]<0||doc[0]>=working.width||doc[1]>=working.height)continue
  const color=sampleDeepBilinear(warped.data,working.width,working.height,...doc),unwarped=sampleDeepBilinear(working.deep,working.width,working.height,...doc),alpha=base.deep[at+3]
  if(color.every((value,c)=>value===unwarped[c]))continue
  if(protect){if(!alpha)continue;for(let c=0;c<3;c++){const normalized=color[3]>0?Math.max(0,Math.min(alpha,color[c]*alpha/color[3])):0;deep[at+c]=Math.round(base.deep[at+c]+(normalized-base.deep[at+c])*amount)}}
  else {deep[at+3]=Math.max(0,Math.min(65535,Math.round(alpha+(color[3]-alpha)*amount)));for(let c=0;c<3;c++)deep[at+c]=Math.max(0,Math.min(deep[at+3],Math.round(base.deep[at+c]+(color[c]-base.deep[at+c])*amount)))}
 }
 if(!changed(deep,base.deep))return noChange()
 return finish(stage,s,{...base,deep},!protect)
}
