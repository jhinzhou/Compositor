import {fullCanvasMaskEdgeMode} from '../shared/mask-feather'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import {PNG} from 'pngjs'
import {EditorError,type EditAction} from '../shared/contracts'
import {blurMaskPixels} from '../shared/mask-pixels'
import {encodeRaster} from './raster-edit'
import {appendSelectionShape} from '../shared/selection-composition'
import {makeAsset} from './project-io'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask,maskPropertyGeometry} from '../shared/mask-properties'
import type {PixelStage} from './pixel-actions'
type MaskAction=Extract<EditAction,{type:'layer.mask_set_placement'|'selection.from_mask'|'layer.mask_filter'|'layer.mask_properties'}>

export function applyMaskOperation(stage:PixelStage,action:MaskAction):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer?.maskFile)throw new EditorError('INVALID_ARGUMENT','Choose a layer with a raster mask.')
 const asset=stage.assets.get(layer.maskFile)
 if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer mask is missing.')
 if(action.type==='layer.mask_properties'){const model=action.featherModel??layer.maskFeatherModel,edgeMode=action.featherEdgeMode??layer.maskFeatherEdgeMode??(model==='photoshop'?fullCanvasMaskEdgeMode(asset,layer.maskPlacement??layer.transform,stage.manifest):undefined);try{maskPropertyGeometry(asset.width,asset.height,{maskDensity:action.density,maskFeather:action.feather,maskFeatherModel:model,maskFeatherEdgeMode:edgeMode})}catch(cause){throw new EditorError('RESOURCE_LIMIT',cause instanceof Error?cause.message:String(cause))}layer.maskDensity=action.density;layer.maskFeather=action.feather;if(action.featherModel!==undefined)layer.maskFeatherModel=action.featherModel;if(edgeMode!==undefined)layer.maskFeatherEdgeMode=edgeMode;invalidatePhotoshopComponent(layer,'mask');return 'Set mask properties'}
 if(action.type==='layer.mask_set_placement'){
  layer.maskLinked=false;layer.maskPlacement=structuredClone(action.transform);invalidatePhotoshopComponent(layer,'mask')
  return 'Transform layer mask'
 }
 const png=PNG.sync.read(asset.bytes)
 if(action.type==='selection.from_mask'){
  // Preserve the legacy MCP action default; the Photoshop profile requests visible coverage explicitly.
  const runs:[number,number,number,number][]=[]
  const effective=action.coverage==='visible'?effectiveMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},layer):undefined,mask=effective?.image??png
  const expanded=effectiveMaskTransform(layer.maskPlacement??layer.transform,png,effective?.inset??0),documentGrid=!!effective&&((layer.maskDensity??1)!==1||(layer.maskFeather??0)!==0||effective.background!==0||mask.width===1&&mask.height===1),width=documentGrid?stage.manifest.width:mask.width,height=documentGrid?stage.manifest.height:mask.height
  // Uniform 1px masks are infinite coverage planes, not a tiny selected tile.
  // Pixel-aligned sparse rows also retain the large-document contour fast path.
  if(effective&&mask.width===1&&mask.height===1){
   const value=mask.data[0],transform={origin:[0,0] as [number,number],size:[stage.manifest.width,stage.manifest.height] as [number,number],rotation:0,flipX:false,flipY:false}
   stage.selection=appendSelectionShape(stage.selection,{kind:'raster',operation:action.operation,feather:0,bounds:[...transform.origin,...transform.size],raster:{width:stage.manifest.width,height:stage.manifest.height,transform,runs:value?Array.from({length:stage.manifest.height},(_,y)=>[y,0,stage.manifest.width,value] as [number,number,number,number]):[]}},stage.manifest.width,stage.manifest.height)
   return 'Load mask selection'
  }
  if(documentGrid&&width*height>32_000_000)throw new EditorError('RESOURCE_LIMIT','Loading mask properties as a selection is limited to 32 megapixels.')
  const coverage=(x:number,y:number)=>documentGrid?sampleEffectiveMask(effective!,expanded,x+.5,y+.5):action.coverage==='visible'?mask.data[(y*mask.width+x)*4]:(mask.data[(y*mask.width+x)*4]<128?255:0)
  for(let y=0;y<height;y++)for(let x=0;x<width;){const start=x,value=coverage(x,y);x++;while(x<width&&coverage(x,y)===value)x++;if(value)runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Mask selection exceeds the coverage budget.')}
  if(!runs.length && action.coverage!=='visible')throw new EditorError('INVALID_ARGUMENT','This mask contains no hidden pixels to select.')
  const placement=documentGrid?{origin:[0,0] as [number,number],size:[width,height] as [number,number],rotation:0,flipX:false,flipY:false}:expanded,transform={origin:placement.origin,size:placement.size,rotation:placement.rotation,flipX:placement.flipX,flipY:placement.flipY}
  stage.selection=appendSelectionShape(stage.selection,{kind:'raster',operation:action.operation,feather:0,bounds:[...transform.origin,...transform.size],raster:{width,height,transform:structuredClone(transform),runs}},stage.manifest.width,stage.manifest.height)
  return 'Load mask selection'
 }
 let output:ReturnType<typeof blurMaskPixels>
 try{output=blurMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},action.radius,1,layer.photoshopMaskDefault)}catch(cause){throw new EditorError('RESOURCE_LIMIT',cause instanceof Error?cause.message:String(cause))}
 const raster=new PNG({width:output.width,height:output.height});raster.data.set(output.data)
 const file=`${layer.id.toUpperCase()}.mask.png`;stage.assets.set(file,makeAsset(file,encodeRaster(raster,true)));layer.maskFile=file;invalidatePhotoshopComponent(layer,'mask')
 return action.filter==='feather'?'Feather layer mask':'Blur layer mask'
}
