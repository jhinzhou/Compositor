import {randomUUID} from 'node:crypto'
import {EditorError} from '../shared/contracts'
import {assertDeepAssetBudget,deepAssetWorkingBytes,inspectPNG,DEEP_ASSET_WORKING_BUDGET} from './deep-assets'
import {decodeRadianceHDR,inspectRadianceHDR} from './hdr-codecs'
import {hdrAssetWorkingBytes} from './hdr-assets'
import {makeAsset,makeAssetEXR,makeHDRAsset,type Asset} from './project-io'
import {inspectFloatTIFF,decodeFloatTIFF} from './hdr-tiff'

export interface WideImportResult {asset:Asset;warnings:string[]}
/** Call before the ordinary 8-bit importer. Undefined keeps that path intact.
 * targetFile is only a desired stem: the encoded format determines its extension.
 */
export function prepareWideImport(bytes:Buffer,sourceName:string,targetFile=`${randomUUID().toUpperCase()}.png`,options:{retainedAssets?:Iterable<Asset>}={}):WideImportResult|undefined {
 const extension=sourceName.toLowerCase().split('.').pop(),stem=targetFile.replace(/\.(?:png|exr)$/i,''),retained=[...(options.retainedAssets??[])]
 const exr=bytes.length>=4&&bytes.readUInt32LE(0)===20000630,rgbe=bytes.subarray(0,10).toString('ascii').startsWith('#?RADIANCE')||bytes.subarray(0,6).toString('ascii')==='#?RGBE'
 if(exr||extension==='exr'){
  assertDeepAssetBudget(retained,hdrAssetWorkingBytes(bytes))
  return {asset:makeAssetEXR(`${stem}.exr`,bytes),warnings:['OpenEXR scene-linear color was converted to the floating extended-sRGB working space. Original EXR bytes are preserved, including sub-white sources; the SDR preview clips highlights.']}
 }
 if(rgbe||extension==='hdr'||extension==='rgbe'){
  const header=inspectRadianceHDR(bytes),working=bytes.length*2+header.width*header.height*80+header.height*128+1024*1024
  if(working>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','Radiance import and EXR persistence exceed the 512 MiB working budget.')
  assertDeepAssetBudget(retained,working)
  const {width,height,hdr}=decodeRadianceHDR(bytes)
  return {asset:makeHDRAsset(`${stem}.exr`,width,height,hdr),warnings:['Radiance RGBE scene-linear color and declared primaries were converted to extended sRGB and stored in a FLOAT+ZIP EXR asset. The original RGBE container is not the project asset; the SDR preview clips highlights.']}
 }
 if(['II','MM'].includes(bytes.toString('ascii',0,2))){
  const header=inspectFloatTIFF(bytes)
  if(header){const working=header.estimatedBytes+header.width*header.height*80
   if(working>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','Float TIFF import and EXR persistence exceed the 512 MiB working budget.')
   assertDeepAssetBudget(retained,working)
   const {width,height,hdr,warnings}=decodeFloatTIFF(bytes)
   return {asset:makeHDRAsset(`${stem}.exr`,width,height,hdr),warnings}
  }
 }
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  const header=inspectPNG(bytes)
  if(header.bitDepth!==16)return
  assertDeepAssetBudget(retained,deepAssetWorkingBytes(bytes,header))
  return {asset:makeAsset(`${stem}.png`,bytes,{allow16:true}),warnings:['16-bit sRGB PNG samples and original encoded bytes are preserved; the canvas uses a separate 8-bit display proxy.']}
 }
 return
}
