import {EditorError,type EditAction,type Layer,type Manifest} from '../shared/contracts'
import {descendants} from './manifest'
export function layerProtected(manifest:Manifest,id:string,position=false):boolean{
 let layer:Layer|undefined=manifest.layers.find(item=>item.id===id);const seen=new Set<string>()
 while(layer&&!seen.has(layer.id)){if(layer.locked||position&&layer.positionLocked)return true;seen.add(layer.id);layer=manifest.layers.find(item=>item.id===layer!.parentID)}return false
}
/** Shared enforcement also covers workers and MCP, not just disabled UI controls. */
export function assertLayerActionUnlocked(manifest:Manifest,action:EditAction):void{
 if(action.type.startsWith('selection.')&&action.type!=='selection.transform_pixels'&&!(action.type==='selection.subject'&&action.removeBackground)&&!(action.type==='selection.refine_edges'&&action.output!=='selection')||['layer.set_lock','layer.rename','layer.duplicate','layer.set_visibility'].includes(action.type))return
 let ids:string[]=[]
 if('layerId'in action&&typeof action.layerId==='string')ids=[action.layerId]
 if(action.type==='layer.move')ids=action.layerIds
 if((action.type==='layer.move'||action.type==='layer.set_parent')&&typeof action.parentId==='string'&&layerProtected(manifest,action.parentId))throw new EditorError('INVALID_ARGUMENT','The layer is locked. Unlock it before editing.')
 if(['layer.delete','group.ungroup','layer.move','layer.set_parent'].includes(action.type))ids=[...new Set(ids.flatMap(id=>[...descendants(manifest,id)]))]
 const position=['layer.set_transform','layer.mask_set_placement','layer.distort','selection.transform_pixels'].includes(action.type)
 if(ids.some(id=>layerProtected(manifest,id,position)))throw new EditorError('INVALID_ARGUMENT','The layer is locked. Unlock it before editing.')
}
