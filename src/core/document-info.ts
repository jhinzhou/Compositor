import {PNG} from 'pngjs'
import {EditorError,type Manifest} from '../shared/contracts'
import {sourcePoint} from '../shared/selection-coverage'
import {documentInfoSchema,emptyDocumentInfo,sampleRaster,type ColorReading,type DocumentInfo,type InfoRaster} from '../shared/document-info'
import {compositeDeepDocument} from './deep-composite'
import {compositeHDRDocument} from './hdr-composite'
import {assertPNGWorkingBudget,inspectPNG} from './deep-assets'
import type {Asset} from './project-io'

export interface DocumentColorReading {id:number;position:[number,number];reading:ColorReading|null;source:'merged'|'current';sourceLayerId?:string;sourcePrecision:InfoRaster['precision']}
export function getDocumentInfo(manifest:Manifest):DocumentInfo {return documentInfoSchema.parse(manifest.documentInfo??emptyDocumentInfo())}
/** Return a fresh metadata value. Editor owns revision, transaction and persistence. */
export function editDocumentInfo(manifest:Manifest,info:unknown):Manifest {return {...manifest,documentInfo:documentInfoSchema.parse(info)}}
/** Read canonical source pixels, never PNG display proxies or screen captures.
 * Merged sampling uses the same bounded high-depth compositor as high-depth export.
 * Unsupported merged appearances fail explicitly instead of inventing an accurate reading.
 * Current samples raw transformed raster pixels before opacity, masks or layer effects.
 */
export function readDocumentInfoSamples(manifest:Manifest,assets:ReadonlyMap<string,Asset>,currentLayerId?:string):DocumentColorReading[] {
 const info=getDocumentInfo(manifest);if(!info.samples.length)return []
 if(info.sampleTarget==='current'){
  const layer=manifest.layers.find(layer=>layer.id===(currentLayerId??manifest.activeLayerID)),asset=layer?.imageFile&&assets.get(layer.imageFile)
  if(!layer||!asset)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer for current-layer color sampling.')
  let raster:InfoRaster
  if(asset.hdr)raster={width:asset.width,height:asset.height,data:asset.hdr,precision:'float32',premultiplied:true}
  else if(asset.deep)raster={width:asset.width,height:asset.height,data:asset.deep,precision:'uint16',premultiplied:true}
  else {
   if(asset.bitDepth===16)throw new EditorError('INVALID_PROJECT','The original high-depth sample pixels are unavailable.')
   assertPNGWorkingBudget(asset.bytes,inspectPNG(asset.bytes));const decoded=PNG.sync.read(asset.bytes,{checkCRC:true})
   raster={width:decoded.width,height:decoded.height,data:decoded.data,precision:'uint8',premultiplied:false}
  }
  return info.samples.map(sample=>({id:sample.id,position:sample.position,source:'current',sourceLayerId:layer.id,sourcePrecision:raster.precision,reading:sampleRaster(raster,sample.position,info.sampleSize,point=>sourcePoint(layer,...point,raster.width,raster.height))}))
 }
 const floating=manifest.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.hdr)
 const image=floating?compositeHDRDocument(manifest,assets):compositeDeepDocument(manifest,assets)
 const raster:InfoRaster={...image,precision:floating?'float32':'uint16',premultiplied:true}
 const sourcePrecision:InfoRaster['precision']=floating?'float32':manifest.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.deep)?'uint16':'uint8'
 return info.samples.map(sample=>({id:sample.id,position:sample.position,source:'merged',sourcePrecision,reading:sampleRaster(raster,sample.position,info.sampleSize)}))
}
