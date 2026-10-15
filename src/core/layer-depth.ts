import {PNG} from 'pngjs'
import {EditorError,LIMITS,type EditAction} from '../shared/contracts'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {assertDeepAssetBudget} from './deep-assets'
import {makeAsset,makeDeepAsset} from './project-io'
import {blankPNG} from './raster-edit'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'

/** Explicit precision conversion is a normal, reversible source transaction. */
export function convertLayerDepth(stage:PixelStage,action:Extract<EditAction,{type:'layer.convert_depth'}>):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The conversion layer was removed.')
 if(layer.isGroup||layer.adjustment||layer.text)throw new EditorError('INVALID_ARGUMENT','Choose a pixel or blank layer to change its bit depth.')
 const asset=layer.imageFile?stage.assets.get(layer.imageFile):undefined,current=asset?.bitDepth??8
 if(current===action.bitDepth&&!asset?.hdr)return `Convert to ${action.bitDepth}-Bit`
 const file=`${layer.id.toUpperCase()}.png`
 if(action.bitDepth===16){
  const width=asset?asset.width:Math.max(1,Math.round(layer.transform.size[0])),height=asset?asset.height:Math.max(1,Math.round(layer.transform.size[1]))
  if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>MAX_DEEP_PIXELS||width*height*56>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The bit-depth conversion exceeds its raster working budget.')
  assertDeepAssetBudget(stage.assets.values(),width*height*56)
  const deep=new Uint16Array(width*height*4)
  if(asset?.hdr){for(let i=0;i<deep.length;i+=4){deep[i+3]=Math.round(asset.hdr[i+3]*65535);for(let c=0;c<3;c++)deep[i+c]=Math.min(deep[i+3],Math.round(Math.max(0,asset.hdr[i+c])*65535))}}
  else {const png=asset?PNG.sync.read(asset.bytes):blankPNG(width,height);for(let i=0;i<deep.length;i+=4){deep[i+3]=png.data[i+3]*257;for(let c=0;c<3;c++)deep[i+c]=Math.round(png.data[i+c]*png.data[i+3]/255)*257}}
  stage.assets.set(file,makeDeepAsset(file,width,height,deep))
 }else {
  if(!asset?.displayBytes)throw new EditorError('INVALID_PROJECT','The preserved source has no display quantization.')
  stage.assets.set(file,makeAsset(file,asset.displayBytes))
 }
 layer.imageFile=file;delete layer.shape;invalidatePhotoshopComponent(layer,'vector')
 return `Convert to ${action.bitDepth}-Bit`
}
