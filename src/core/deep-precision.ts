import {randomUUID} from 'node:crypto'
import {inspectDeepComposite} from './deep-composite'
import {inspectHDRComposite} from './hdr-composite'
import {specToNativeAdjustment} from '../shared/image-filters'
import type {Asset} from './project-io'
import {supportsHighDepthAdjustment} from './high-depth-adjustment'
import {assertHighDepthFilterSupported} from './high-depth-filter'
import {EditorError,type EditAction,type Manifest} from '../shared/contracts'

type DepthAssets=ReadonlyMap<string,Asset>
/** Every mutation and preview shares this gate until its deep implementation is enabled. */
export function assertDeepActionSupported(manifest:Manifest,assets:DepthAssets,action:EditAction):void{
 if(action.type==='layer.background_erase'||action.type==='layer.magic_erase'){
  const target=manifest.layers.find(layer=>layer.id===action.layerId)
  if(target?.imageFile&&assets.get(target.imageFile)?.hdr)throw new EditorError('UNSUPPORTED_FEATURE','Background and Magic Eraser do not yet preserve floating HDR edits. The original pixels and history have been kept.',{action:action.type,precisionRule:'blocked',layerIds:[target.id]})
 }
 const deepLayers=manifest.layers.filter(layer=>layer.imageFile&&assets.get(layer.imageFile)?.bitDepth===16)
 if(!deepLayers.length)return
 const refuse=(ids:string[]=deepLayers.map(layer=>layer.id))=>{throw new EditorError('UNSUPPORTED_FEATURE','This operation does not yet preserve 16-bit layer data. The original pixels and history have been kept.',{action:action.type,sourceBitDepth:16,precisionRule:'blocked',layerIds:ids})}
 if(action.type==='adjustment.add'||action.type==='adjustment.set'){
  if(!supportsHighDepthAdjustment(action.filter))refuse()
  const next=structuredClone(manifest)
  if(action.type==='adjustment.add')next.layers.push({id:randomUUID().toUpperCase(),name:action.name,isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',adjustment:specToNativeAdjustment(action.filter),transform:{origin:[0,0],size:[next.width,next.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}})
  if(action.type==='adjustment.set'){const layer=next.layers.find(item=>item.id===action.layerId);if(layer)layer.adjustment=specToNativeAdjustment(action.filter)}
  const inspection=next.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.hdr)?inspectHDRComposite(next,assets):inspectDeepComposite(next,assets)
  if(!inspection.supported)throw new EditorError(inspection.reasons.some(reason=>['budget','work'].includes(reason.feature))?'RESOURCE_LIMIT':'UNSUPPORTED_FEATURE','This layer stack cannot yet be composed at 16 bits. The source and history have been kept.',{reasons:inspection.reasons})
  return
 }

 if(!('layerId'in action)||typeof action.layerId!=='string')return
 const layer=deepLayers.find(layer=>layer.id===action.layerId)
 // All-layers sampling must not silently quantify a deep donor into an image edit.
 if(action.type==='layer.retouch'&&action.sourceMode==='all-layers'&&action.target!=='mask')refuse()
 if(!layer)return
 if('target'in action&&action.target==='mask')return
 if(action.type==='layer.paint'||action.type==='layer.bucket_fill'||action.type==='layer.tonal_brush'||action.type==='layer.mixer_brush'||action.type==='layer.history_brush')return
 if(['layer.convert_depth','layer.fill','layer.gradient','layer.clear_selected'].includes(action.type))return
 if(action.type==='layer.retouch'&&action.kind==='smear'&&action.sourceMode!=='all-layers')return
 if(action.type==='layer.filter'){assertHighDepthFilterSupported(action.filter,!!(layer.imageFile&&assets.get(layer.imageFile)?.hdr));return}
 if(action.type==='layer.retouch'&&action.kind==='blur'&&action.sourceMode!=='all-layers')return
 if(['layer.paint','layer.fill','layer.gradient','layer.filter','layer.distort','layer.retouch','layer.patch','layer.clear_selected','layer.content_fill','layer.text','layer.shape','selection.transform_pixels'].includes(action.type))refuse([layer.id])
 if(action.type==='selection.refine_edges'&&action.output==='new-layer')refuse([layer.id])
}

export function assertDeepMergeSupported(manifest:Manifest,assets:DepthAssets,ids:readonly string[]):void{
 const deep=manifest.layers.filter(layer=>ids.includes(layer.id)&&layer.imageFile&&assets.get(layer.imageFile)?.bitDepth===16)
 if(deep.length)throw new EditorError('UNSUPPORTED_FEATURE','Merging these layers does not yet preserve 16-bit data. The original layers have been kept.',{sourceBitDepth:16,precisionRule:'blocked',layerIds:deep.map(layer=>layer.id)})
}
