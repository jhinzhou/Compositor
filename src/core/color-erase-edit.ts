/** Shared preparation for stroke previews, UI/MCP edits and atomic history. */
import {PNG} from 'pngjs'
import {EditorError,type EditAction,type Transform} from '../shared/contracts'
import {backgroundErasePixels,magicErasePixels,type ColorEraseImage} from './color-erase'
import {makeAsset,makeDeepAsset,type Asset} from './project-io'
import {countAssetBytes} from './deep-assets'
import {encodeRaster} from './raster-edit'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'
import type {RGBAImage} from './selection-retouch'
export type ColorEraseAction=Extract<EditAction,{type:'layer.background_erase'|'layer.magic_erase'}>
const WORKING_BYTES=512*1024*1024,SOURCE_PIXELS=16_000_000
export interface ColorErasePrepared {asset:Asset;transform:Transform;affectedPixels:number}
export function prepareColorErase(stage:PixelStage,action:ColorEraseAction,sampleImage?:RGBAImage,options:{signal?:AbortSignal;maximumWork?:number}={}):ColorErasePrepared{
 if(options.signal?.aborted)throw new EditorError('CANCELED','Color erasing was canceled.')
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The eraser layer no longer exists.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','Unlock this layer before erasing.')
 if(layer.text||layer.shape)throw new EditorError('RASTERIZATION_REQUIRED','Rasterize this text or shape layer before erasing its image pixels.')
 if(layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster image layer to erase.')
 const asset=layer.imageFile&&stage.assets.get(layer.imageFile)
 if(!asset)throw new EditorError('ASSET_NOT_FOUND','The eraser source image is missing.')
 if(asset.hdr)throw new EditorError('UNSUPPORTED_FEATURE','Background and Magic Eraser do not yet support floating HDR pixels. The original source and history have been kept.')
 if(asset.bitDepth===16&&!asset.deep)throw new EditorError('INVALID_PROJECT','The 16-bit eraser source lacks preserved high-depth pixels.')
 const pixels=asset.width*asset.height
 // Includes private work arrays, source decode and final encoding overhead;
 // reject before PNG decoding or cloning a high-depth surface.
 if(pixels>SOURCE_PIXELS||pixels*(asset.deep?64:40)+countAssetBytes(asset)+(sampleImage?.data.byteLength??0)>WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','Color erasing exceeds its 16 MP source or 512 MiB working budget.')
 if(action.type==='layer.magic_erase'&&action.sampleAllLayers){
  if(!sampleImage)throw new EditorError('INVALID_ARGUMENT','Magic Eraser merged sampling requires a revision-checked document raster.')
  if(sampleImage.width!==stage.manifest.width||sampleImage.height!==stage.manifest.height||sampleImage.data.length!==sampleImage.width*sampleImage.height*4)throw new EditorError('INVALID_ARGUMENT','The merged eraser source must match document dimensions.')
 }
 if(action.opacity===0)return {asset,transform:structuredClone(layer.transform),affectedPixels:0}
 const image:ColorEraseImage=asset.deep?{width:asset.width,height:asset.height,data:asset.deep}:{...PNG.sync.read(asset.bytes)}
 if(image.width!==asset.width||image.height!==asset.height)throw new EditorError('INVALID_PROJECT','The eraser source dimensions do not match its descriptor.')
 const context={transform:layer.transform,selection:stage.selection,canvasSize:[stage.manifest.width,stage.manifest.height] as [number,number]}
 const result=action.type==='layer.background_erase'?backgroundErasePixels(image,context,action,options):magicErasePixels(image,context,{...action,sampleImage},options)
 if(options.signal?.aborted)throw new EditorError('CANCELED','Color erasing was canceled.')
 if(!result.affectedPixels)return {asset,transform:structuredClone(layer.transform),affectedPixels:0}
 const file=`${layer.id.toUpperCase()}.png`
 let output:Asset
 if(asset.deep)output=makeDeepAsset(file,asset.width,asset.height,result.data as Uint16Array)
 else{const png=new PNG({width:asset.width,height:asset.height});png.data.set(result.data);output=makeAsset(file,encodeRaster(png))}
 return {asset:output,transform:structuredClone(layer.transform),affectedPixels:result.affectedPixels}
}
export function applyColorEraseOperation(stage:PixelStage,action:ColorEraseAction,sampleImage?:RGBAImage):string{
 const result=prepareColorErase(stage,action,sampleImage),layer=stage.manifest.layers.find(item=>item.id===action.layerId)!
 if(result.affectedPixels){stage.assets.set(result.asset.file,result.asset);layer.imageFile=result.asset.file;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')}
 return action.type==='layer.background_erase'?'Background Eraser':'Magic Eraser'
}
