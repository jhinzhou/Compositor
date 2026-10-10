import {PNG} from 'pngjs'
import {EditorError,type EditAction} from '../shared/contracts'
import {blurMaskPixels} from '../shared/mask-pixels'
import {encodeRaster} from './raster-edit'
import {appendSelectionShape} from '../shared/selection-composition'
import {makeAsset} from './project-io'
import type {PixelStage} from './pixel-actions'
type MaskAction=Extract<EditAction,{type:'layer.mask_set_placement'|'selection.from_mask'|'layer.mask_filter'}>

export function applyMaskOperation(stage:PixelStage,action:MaskAction):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer?.maskFile)throw new EditorError('INVALID_ARGUMENT','Choose a layer with a raster mask.')
 const asset=stage.assets.get(layer.maskFile)
 if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer mask is missing.')
 if(action.type==='layer.mask_set_placement'){
  layer.maskLinked=false;layer.maskPlacement=structuredClone(action.transform)
  return 'Transform layer mask'
 }
 const png=PNG.sync.read(asset.bytes)
 if(action.type==='selection.from_mask'){
  // Compositor selects hidden (darker than 50% gray) pixels, not white mask coverage.
  const runs:[number,number,number,number][]=[]
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;){const start=x,hidden=png.data[(y*png.width+x)*4]<128;x++;while(x<png.width&&(png.data[(y*png.width+x)*4]<128)===hidden)x++;if(hidden)runs.push([y,start,x-start,255]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Mask selection exceeds the coverage budget.')}
  if(!runs.length)throw new EditorError('INVALID_ARGUMENT','This mask contains no hidden pixels to select.')
  const placement=layer.maskPlacement??layer.transform,transform={origin:placement.origin,size:placement.size,rotation:placement.rotation,flipX:placement.flipX,flipY:placement.flipY}
  stage.selection=appendSelectionShape(stage.selection,{kind:'raster',operation:action.operation,feather:0,bounds:[...transform.origin,...transform.size],raster:{width:png.width,height:png.height,transform:structuredClone(transform),runs}},stage.manifest.width,stage.manifest.height)
  return 'Load mask selection'
 }
 let output:ReturnType<typeof blurMaskPixels>
 try{output=blurMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},action.radius)}catch(cause){throw new EditorError('RESOURCE_LIMIT',cause instanceof Error?cause.message:String(cause))}
 const raster=new PNG({width:output.width,height:output.height});raster.data.set(output.data)
 const file=`${layer.id.toUpperCase()}.mask.png`;stage.assets.set(file,makeAsset(file,encodeRaster(raster,true)));layer.maskFile=file
 return action.filter==='feather'?'Feather layer mask':'Blur layer mask'
}
