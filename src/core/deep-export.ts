import {PNG} from 'pngjs'
import {EditorError,type Manifest} from '../shared/contracts'
import {exportOptionsSchema} from '../shared/export-options'
import {compositeDeepDocument,inspectDeepComposite,sampleDeepCompositeRegion} from './deep-composite'
import {compositeHDRDocument,inspectHDRComposite,sampleHDRCompositeRegion} from './hdr-composite'
import {encodeEXR} from './hdr-codecs'
import {quantizeHDRPreview} from '../shared/hdr-pixels'
import {quantizeDeep16ToRGBA8,MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {encodeDeepPNG,assertDeepAssetBudget,pngChunkCRC} from './deep-assets'
import type {Asset} from './project-io'

/** Original sources are composed and resized before any output quantization. */
export function encodeDeepExport(snapshot:{manifest:Manifest;assets:Map<string,Asset>},input:unknown,context:{retainedWorkingBytes?:number;retainedAssets?:Iterable<Asset>}={}){
 const options=exportOptionsSchema.parse(input),hasHDR=snapshot.manifest.layers.some(layer=>layer.imageFile&&snapshot.assets.get(layer.imageFile)?.hdr),floating=hasHDR||options.format==='exr',area=options.width*options.height
 if(options.format!=='exr'&&!(options.format==='png'&&options.bitDepth===16))throw new EditorError('INVALID_ARGUMENT','Choose EXR or PNG16 for high-depth export.')
 const retainedWorkingBytes=context.retainedWorkingBytes??0
 if(!Number.isSafeInteger(retainedWorkingBytes)||retainedWorkingBytes<0)throw new EditorError('INVALID_ARGUMENT','Invalid retained export working budget.')
 const inspection=floating?inspectHDRComposite(snapshot.manifest,snapshot.assets):inspectDeepComposite(snapshot.manifest,snapshot.assets),workingBytes=inspection.estimatedWorkingBytes+area*80+retainedWorkingBytes
 if(workingBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','The high-depth composition and export exceed their combined working budget.',{estimatedWorkingBytes:workingBytes,maximumWorkingBytes:MAX_DEEP_WORKING_BYTES})
 // The codec cap above stays independent of assets in other open documents.
 // Their retained source/history storage belongs to the workspace byte budget.
 assertDeepAssetBudget([...snapshot.assets.values(),...(context.retainedAssets??[])],workingBytes)
 // PNG keeps transparency at either depth, matching the existing PNG8 path.
 const region={x:0,y:0,width:snapshot.manifest.width,height:snapshot.manifest.height},rgb=options.format!=='png'&&options.background?[1,3,5].map(i=>parseInt(options.background!.slice(i,i+2),16)/255):undefined
 let pixels:Uint16Array|Float32Array
 if(floating){const image=compositeHDRDocument(snapshot.manifest,snapshot.assets),sampled=sampleHDRCompositeRegion(image,region,options.width,options.height);pixels=sampled.data;if(rgb)for(let i=0;i<pixels.length;i+=4){for(let c=0;c<3;c++)pixels[i+c]+=rgb[c]*(1-pixels[i+3]);pixels[i+3]=1}}
 else {const image=compositeDeepDocument(snapshot.manifest,snapshot.assets),sampled=sampleDeepCompositeRegion(image,region,options.width,options.height);pixels=sampled.data;if(rgb)for(let i=0;i<pixels.length;i+=4){for(let c=0;c<3;c++)pixels[i+c]=Math.round(pixels[i+c]+rgb[c]*(65535-pixels[i+3]));pixels[i+3]=65535}}
 const preview=pixels instanceof Float32Array?quantizeHDRPreview(pixels,options.width,options.height):quantizeDeep16ToRGBA8(pixels,options.width,options.height),previewPNG=PNG.sync.write({width:options.width,height:options.height,data:Buffer.from(preview)} as PNG)
 if(options.format==='exr'){if(!(pixels instanceof Float32Array))throw new EditorError('INVALID_ARGUMENT','EXR export requires floating-point samples.');return {data:encodeEXR(options.width,options.height,pixels,{pixelType:'float',compression:'zip'}),previewPNG,mimeType:'image/x-exr',extension:'exr',bitDepth:32 as const,isHDR:true}}
 const deep=pixels instanceof Uint16Array?pixels:Uint16Array.from(pixels,(value,i)=>Math.round(Math.max(0,Math.min(i%4===3?1:pixels[i-i%4+3],value))*65535)),encoded=encodeDeepPNG(options.width,options.height,deep)
 const physical=Buffer.alloc(21);physical.writeUInt32BE(9);physical.write('pHYs',4);physical.writeUInt32BE(Math.round(options.resolution/.0254),8);physical.writeUInt32BE(Math.round(options.resolution/.0254),12);physical[16]=1;physical.writeUInt32BE(pngChunkCRC(physical.subarray(4,17)),17)
 return {data:Buffer.concat([encoded.subarray(0,33),physical,encoded.subarray(33)]),previewPNG,mimeType:'image/png',extension:'png',bitDepth:16 as const,isHDR:false}
}
