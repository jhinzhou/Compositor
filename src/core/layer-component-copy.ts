import {EditorError,type EditAction} from '../shared/contracts'
import type {PixelStage} from './pixel-actions'
import {makeAsset} from './project-io'
import {validateLayerEffects} from '../shared/layer-effects'
type CopyAction=Extract<EditAction,{type:'layer.copy_mask'|'layer.copy_effect'}>
/** Native Option-drag copies one component, preserving its document placement and unrelated target components. */
export function copyLayerComponent(stage:PixelStage,action:CopyAction):string{
 if(action.layerId===action.sourceId)throw new EditorError('INVALID_ARGUMENT','Choose a different destination layer.')
 const source=stage.manifest.layers.find(layer=>layer.id===action.sourceId),target=stage.manifest.layers.find(layer=>layer.id===action.layerId)
 if(!source||!target)throw new EditorError('LAYER_NOT_FOUND','The component source or destination no longer exists.')
 if(action.type==='layer.copy_mask'){
  if(target.isGroup)throw new EditorError('INVALID_ARGUMENT','A copied mask must be dropped on a non-folder layer.')
  const asset=source.maskFile?stage.assets.get(source.maskFile):undefined
  if(!asset)throw new EditorError('INVALID_ARGUMENT','The source layer has no raster mask.')
  const file=`${target.id.toUpperCase()}.mask.png`,replacing=!!target.maskFile
  stage.assets.set(file,makeAsset(file,asset.bytes));target.maskFile=file;target.maskEnabled=source.maskEnabled;target.maskLinked=source.maskLinked;target.maskPlacement=structuredClone(source.maskPlacement??source.transform);if(source.photoshopMaskDefault!==undefined)target.photoshopMaskDefault=source.photoshopMaskDefault;else delete target.photoshopMaskDefault
  target.maskDensity=source.maskDensity;target.maskFeather=source.maskFeather;target.maskFeatherModel=source.maskFeatherModel;target.maskFeatherEdgeMode=source.maskFeatherEdgeMode
  stage.manifest.activeLayerID=target.id
  return replacing?'Replace layer mask':'Copy layer mask'
 }
 if(target.isGroup||!target.imageFile||target.adjustment)throw new EditorError('INVALID_ARGUMENT','Effects can only be copied to a raster layer.')
 const effect=(source.effects?validateLayerEffects(source.effects):undefined)?.[action.kind]
 if(!effect)throw new EditorError('INVALID_ARGUMENT','The requested source effect is missing.')
 target.effects=validateLayerEffects({...structuredClone(target.effects??{}),[action.kind]:structuredClone(effect)});stage.manifest.activeLayerID=target.id
 return `Copy ${action.kind}`
}
