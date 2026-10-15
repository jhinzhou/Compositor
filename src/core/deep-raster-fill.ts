import {PNG} from 'pngjs'
import {EditorError,LIMITS,type EditAction,type Layer,type Transform} from '../shared/contracts'
import {MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {placedRasterRect} from './stroke-raster'
import {carryFilterMask} from './filter-edit'
import type {PixelStage} from './pixel-actions'
import type {DeepStrokePrepared} from './deep-stroke-edit'
import type {HDRStrokePrepared} from './hdr-stroke-edit'

type Drawing=Extract<EditAction,{type:'layer.fill'|'layer.gradient'|'layer.clear_selected'}>
/** Repeat the complete drawing on the preserved source grid, as upstream
 * BrushCommit.deepPaint does. Gradients interpolate before quantizing to UNORM16. */
function prepareDrawing(stage:PixelStage,action:Drawing,floating:boolean):{deep:Uint16Array|Float32Array;width:number;height:number;transform:Transform;maskPNG?:Buffer} {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId),asset=layer?.imageFile?stage.assets.get(layer.imageFile):undefined
 if(!layer||!asset||!(floating?asset.hdr:asset.deep))throw new EditorError('INVALID_ARGUMENT','Choose a 16-bit raster layer.')
 const original=(floating?asset!.hdr:asset!.deep)!,scale=floating?1:65535,round=floating?Math.fround:Math.round;let width=asset.width,height=asset.height,left=0,top=0,transform:Transform=structuredClone(layer.transform)
 if(action.type==='layer.gradient'){
  let right=width,bottom=height
  for(const point of [[0,0],[stage.manifest.width,0],[0,stage.manifest.height],[stage.manifest.width,stage.manifest.height]]){
   const [x,y]=sourcePoint(layer,point[0],point[1],asset.width,asset.height);left=Math.min(left,Math.floor(x));top=Math.min(top,Math.floor(y));right=Math.max(right,Math.ceil(x));bottom=Math.max(bottom,Math.ceil(y))
  }
  width=right-left;height=bottom-top;transform=placedRasterRect(transform,asset.width,asset.height,left,top,width,height)
 }
 if(width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||width*height*48+asset.bytes.length+original.byteLength>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The high-depth drawing exceeds its working budget.')
 let deep:Uint16Array|Float32Array=floating?new Float32Array(width*height*4):new Uint16Array(width*height*4)
 for(let y=0;y<asset.height;y++)deep.set(original.subarray(y*asset.width*4,(y+1)*asset.width*4),((y-top)*width-left)*4)
 let changed=false
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const p=documentPoint({transform} as Layer,x+.5,y+.5,width,height),at=(y*width+x)*4,selected=selectionCoverage(stage.selection,...p)
  if(!selected)continue
  if(action.type==='layer.clear_selected'){
   for(let c=0;c<4;c++){const value=round(deep[at+c]*(1-selected));changed ||= value!==deep[at+c];deep[at+c]=value}continue
  }
  let color=action.type==='layer.fill'?action.color:action.from,opacity=1
  if(action.type==='layer.gradient'){
   if(p[0]<0||p[1]<0||p[0]>=stage.manifest.width||p[1]>=stage.manifest.height)continue
   const dx=action.end[0]-action.start[0],dy=action.end[1]-action.start[1],length=Math.max(.001,dx*dx+dy*dy),t=Math.min(1,Math.max(0,action.radial?Math.hypot(p[0]-action.start[0],p[1]-action.start[1])/Math.sqrt(length):((p[0]-action.start[0])*dx+(p[1]-action.start[1])*dy)/length))
   color=action.from.map((v,c)=>v+(action.to[c]-v)*t) as typeof color;opacity=action.opacity??1
  }
  const sa=color[3]*selected*opacity,alpha=round(sa*scale+deep[at+3]*(1-sa))
  for(let c=0;c<3;c++){const raw=round(color[c]*sa*scale+deep[at+c]*(1-sa)),value=floating?raw:Math.min(alpha,raw);changed ||= value!==deep[at+c];deep[at+c]=value}
  changed ||= alpha!==deep[at+3];deep[at+3]=alpha
 }
 if(!changed)return {deep:original,width:asset.width,height:asset.height,transform:structuredClone(layer.transform)}
 if(action.type==='layer.gradient'){
  let minX=width,minY=height,maxX=0,maxY=0
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(deep[(y*width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+1);maxY=Math.max(maxY,y+1)}
  if(maxX&&(minX||minY||maxX!==width||maxY!==height)){const w=maxX-minX,h=maxY-minY,cropped=floating?new Float32Array(w*h*4):new Uint16Array(w*h*4);for(let y=0;y<h;y++)cropped.set(deep.subarray(((y+minY)*width+minX)*4,((y+minY)*width+maxX)*4),y*w*4);transform=placedRasterRect(transform,width,height,minX,minY,w,h);deep=cropped;width=w;height=h}
 }
 let maskPNG:Buffer|undefined
 if(layer.maskFile&&!layer.maskPlacement&&JSON.stringify(transform)!==JSON.stringify(layer.transform)){
  if(layer.maskLinked===false)layer.maskPlacement=structuredClone(layer.transform)
  else {const mask=stage.assets.get(layer.maskFile);if(!mask)throw new EditorError('ASSET_NOT_FOUND','The linked gradient mask is missing.');maskPNG=encodeRaster(carryFilterMask(PNG.sync.read(mask.bytes),layer.transform,{png:{width,height} as PNG,transform,grew:true},255),true)}
 }
 return {deep,width,height,transform,...(maskPNG?{maskPNG}:{})}
}

export function prepareDeepDrawing(stage:PixelStage,action:Drawing):DeepStrokePrepared {return prepareDrawing(stage,action,false) as DeepStrokePrepared}
export function prepareHDRDrawing(stage:PixelStage,action:Drawing):HDRStrokePrepared {const {deep,...rest}=prepareDrawing(stage,action,true);return {...rest,hdr:deep as Float32Array}}
