import {PNG} from 'pngjs'
import {EditorError} from '../shared/contracts'
import type {PixelStage} from './pixel-actions'
import {sampleLayerInDocument} from './document-sampler'
import {IMAGE_SELECTION_LIMITS,magneticLassoPath,type MagneticLassoOptions} from './image-driven-selection'
import type {PixelPoint,RGBAImage} from './selection-retouch'

export interface MagneticSelectionParameters extends MagneticLassoOptions {layerId:string;points:PixelPoint[];sampleAllLayers?:boolean}
/** Revision ownership is enforced by the command controller. This function only
 * reads a staged snapshot and returns document coordinates; no assets, selection
 * or history are changed. RGB16/HDR analysis uses the saved SDR display proxy. */
export function magneticSelectionPath(stage:PixelStage,params:MagneticSelectionParameters,composite?:RGBAImage):PixelPoint[] {
 const {width,height}=stage.manifest
 if(width*height>IMAGE_SELECTION_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Magnetic Lasso analysis supports up to 16 MP.')
 let image:RGBAImage
 if(params.sampleAllLayers){
  if(!composite)throw new EditorError('ASYNC_OPERATION_REQUIRED','Sample All Layers requires a revision-matched document composite.')
  if(composite.width!==width||composite.height!==height)throw new EditorError('INVALID_ARGUMENT','Magnetic Lasso requires a document-sized composite.')
  image=composite
 }else{
  const layer=stage.manifest.layers.find(value=>value.id===params.layerId)
  if(!layer||layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer for Magnetic Lasso.')
  const asset=layer.imageFile?stage.assets.get(layer.imageFile):undefined
  if(layer.imageFile&&!asset)throw new EditorError('ASSET_NOT_FOUND','The Magnetic Lasso image sample is missing.')
  if(asset&&asset.width*asset.height>IMAGE_SELECTION_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Magnetic Lasso source analysis supports up to 16 MP.')
  const png=asset?PNG.sync.read(asset.displayBytes??asset.bytes):null
  image=sampleLayerInDocument(png,layer.transform,width,height)
 }
 return magneticLassoPath(image,params.points,params)
}
