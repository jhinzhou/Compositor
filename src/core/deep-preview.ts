import {createHash} from 'node:crypto'
import {z} from 'zod'
import {EditorError,manifestSchema,type EditorState,type Manifest} from '../shared/contracts'
import {quantizeDeep16ToRGBA8} from '../shared/deep-pixels'
import {quantizeDeepScreenRGBA8} from '../shared/deep-screen-display'
import {compositeHDRDocument,inspectHDRComposite,sampleHDRCompositeRegion,type HDRCompositeImage} from './hdr-composite'
import {quantizeHDRPreview} from '../shared/hdr-pixels'
import {compositeDeepDocument,inspectDeepComposite,sampleDeepCompositeRegion,type DeepCompositeImage} from './deep-composite'
import {assertDeepAssetBudget,inspectPNG} from './deep-assets'
import {MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {makeAsset,type Asset} from './project-io'
const requestSchema=z.object({sessionId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),manifest:manifestSchema,width:z.number().int().min(1).max(16384),height:z.number().int().min(1).max(16384),screenQuantization:z.boolean().optional(),region:z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().positive(),height:z.number().finite().positive()})}).strict()
const DRAFT_CACHE_BYTES=64*1024*1024
function draftPNG(asset:Asset):Buffer {
 const bytes=asset.displayBytes??asset.bytes;if(asset.bitDepth!==16)return bytes
 // An ancillary chunk makes the display URL identify its true deep source even
 // when two RGBA16 results quantize to exactly the same RGBA8 preview.
 const data=Buffer.from('deep-source\0'+asset.hash+' '+asset.file),chunk=Buffer.alloc(data.length+12)
 chunk.writeUInt32BE(data.length);chunk.write('tEXt',4);data.copy(chunk,8)
 let crc=0xffffffff;for(const byte of chunk.subarray(4,-4)){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}chunk.writeUInt32BE((crc^0xffffffff)>>>0,chunk.length-4)
 return Buffer.concat([bytes.subarray(0,-12),chunk,bytes.subarray(-12)])
}
/** Worker-owned deep drafts: renderer never sends original high-depth pixel payloads. */
export class DeepPreviewService {
 private drafts=new Map<string,{sessionId:string;revision:number;asset:Asset}>()
 private cache?:{key:string;image:DeepCompositeImage|HDRCompositeImage;floating:boolean}
 /** Export callers include this readonly retained storage in their own preflight. */
 retainedWorkingBytes():number {
  const backing=new Set<ArrayBufferLike>();let bytes=[...this.drafts.keys()].reduce((n,key)=>n+key.length*2,0)
  for(const {asset} of this.drafts.values())for(const value of [asset.bytes,asset.hdr,asset.deep,asset.displayBytes])if(value&&!backing.has(value.buffer)){backing.add(value.buffer);bytes+=value.buffer.byteLength}
  if(this.cache&&!backing.has(this.cache.image.data.buffer))bytes+=this.cache.image.data.buffer.byteLength
  return bytes
 }
 remember(state:EditorState,asset:Asset):string {
  const display=asset.displayBytes??asset.bytes,tagBytes=asset.bitDepth===16?Buffer.byteLength('deep-source\0'+asset.hash+' '+asset.file)+12:0,pngBytes=display.length+tagBytes,urlBytes=2*('data:image/png;base64,'.length+4*Math.ceil(pngBytes/3)),temporaryBytes=asset.bitDepth===16?pngBytes:0
  // Include source/display backing stores, worst-case UTF-16 URL storage and
  // the tagged PNG temporary. Refuse/evict before allocating the new URL.
  assertDeepAssetBudget([asset],urlBytes+temporaryBytes,DRAFT_CACHE_BYTES)
  for(const [key,draft] of this.drafts)if(draft.sessionId!==state.sessionId||draft.revision!==state.revision)this.drafts.delete(key)
  while(this.drafts.size){
   let fits=this.drafts.size<2
   if(fits)try{assertDeepAssetBudget([...this.drafts.values()].map(d=>d.asset).concat(asset),[...this.drafts.keys()].reduce((n,key)=>n+key.length*2,0)+urlBytes+temporaryBytes,DRAFT_CACHE_BYTES)}catch(error){if(!(error instanceof EditorError)||error.code!=='RESOURCE_LIMIT')throw error;fits=false}
   if(fits)break;this.drafts.delete(this.drafts.keys().next().value!)
  }
  const url=`data:image/png;base64,${draftPNG(asset).toString('base64')}`
  this.drafts.set(url,{sessionId:state.sessionId,revision:state.revision,asset})
  return url
 }
 render(input:unknown,state:EditorState,snapshot:{manifest:Manifest;assets:Map<string,Asset>}) {
  const request=requestSchema.parse(input)
  if(request.sessionId!==state.sessionId||request.expectedRevision!==state.revision)throw new EditorError('SNAPSHOT_EXPIRED','The deep composite source has changed. Request the current revision.')
  for(const [key,draft] of this.drafts)if(draft.sessionId!==state.sessionId||draft.revision!==state.revision)this.drafts.delete(key)
  const manifest=structuredClone(request.manifest),assets=new Map(snapshot.assets)
  let inlineBytes=0
  for(const layer of manifest.layers)for(const field of ['imageFile','maskFile'] as const){
   const file=layer[field];if(!file)continue
   if(!file.startsWith('data:image/png;base64,')){if(!snapshot.assets.has(file))throw new EditorError('ASSET_NOT_FOUND','The deep preview asset is outside the current snapshot.');continue}
   const draft=this.drafts.get(file),name=`${layer.id.toUpperCase()}${field==='maskFile'?'.mask':''}.${field==='imageFile'&&draft?.asset.hdr?'exr':'png'}`
   let asset:Asset
   if(draft&&draft.sessionId===state.sessionId&&draft.revision===state.revision){if(draft.asset.file!==name)throw new EditorError('ASSET_NOT_FOUND','This preview belongs to a different layer.');asset=draft.asset}
   else {
    const original=snapshot.manifest.layers.find(item=>item.id===layer.id),source=original?.imageFile&&snapshot.assets.get(original.imageFile)
    if(field==='imageFile'&&source&&source.bitDepth===16)throw new EditorError('SNAPSHOT_EXPIRED','The high-depth draft is expired. Request a new stroke preview.')
    inlineBytes+=file.length;if(inlineBytes>32*1024*1024)throw new EditorError('RESOURCE_LIMIT','Inline preview images exceed the working budget.')
    const bytes=Buffer.from(file.slice('data:image/png;base64,'.length),'base64'),header=inspectPNG(bytes);if(header.width*header.height*20>64*1024*1024)throw new EditorError('RESOURCE_LIMIT','Inline preview decoding exceeds the working budget.');asset=makeAsset(name,bytes)
   }
   assets.set(name,{...asset,file:name});layer[field]=name
  }
  const key=createHash('sha256').update(JSON.stringify([state.sessionId,state.revision,manifest,[...assets].map(([file,asset])=>[file,asset.hash])])).digest('hex')
  if(this.cache?.key!==key){this.cache=undefined;
   const floating=manifest.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.hdr),inspection=floating?inspectHDRComposite(manifest,assets):inspectDeepComposite(manifest,assets),draftAssets=[...this.drafts.values()].map(d=>d.asset),draftBytes=draftAssets.reduce((n,a)=>n+(a.hdr?.byteLength??a.deep?.byteLength??0)+a.bytes.byteLength+(a.displayBytes?.byteLength??0),0),extra=request.width*request.height*24+draftBytes
   if(!inspection.supported)throw new EditorError(inspection.reasons.some(reason=>reason.feature==='budget'||reason.feature==='work')?'RESOURCE_LIMIT':'UNSUPPORTED_FEATURE','The document cannot currently be composited at high depth.',inspection)
   if(inspection.estimatedWorkingBytes+extra>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','Deep composition, drafts and display output exceed the working budget.')
   assertDeepAssetBudget([...assets.values(),...draftAssets],inspection.estimatedWorkingBytes+extra)
   const image=floating?compositeHDRDocument(manifest,assets):compositeDeepDocument(manifest,assets);if(image.data.byteLength<=64*1024*1024)this.cache={key,image,floating};else return this.sample(image,request,floating)}
  return this.sample(this.cache!.image,request,this.cache!.floating)
 }
 private sample(image:DeepCompositeImage|HDRCompositeImage,request:z.infer<typeof requestSchema>,floating:boolean){if(image.data.byteLength+request.width*request.height*24+[...this.drafts.values()].reduce((n,d)=>n+(d.asset.hdr?.byteLength??d.asset.deep?.byteLength??0),0)>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','Deep viewport output exceeds the working budget.');if(floating){const sampled=sampleHDRCompositeRegion(image as HDRCompositeImage,request.region,request.width,request.height);return {width:sampled.width,height:sampled.height,data:request.screenQuantization?quantizeDeepScreenRGBA8(sampled.data,sampled.width,sampled.height):quantizeHDRPreview(sampled.data,sampled.width,sampled.height),sourceBitDepth:16 as const,isHDR:true}}const sampled=sampleDeepCompositeRegion(image as DeepCompositeImage,request.region,request.width,request.height);return {width:sampled.width,height:sampled.height,data:request.screenQuantization?quantizeDeepScreenRGBA8(sampled.data,sampled.width,sampled.height):quantizeDeep16ToRGBA8(sampled.data,sampled.width,sampled.height),sourceBitDepth:16 as const,isHDR:false}}
}
