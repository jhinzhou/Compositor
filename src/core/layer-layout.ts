import {EditorError,type BatchMutation,type Manifest} from '../shared/contracts'
import {selectedRoots,selectionBounds,sharedTransformActions,type Bounds} from './layer-operations'
export type Alignment='left'|'center'|'right'|'top'|'middle'|'bottom'
export function alignLayers(manifest:Manifest,ids:string[],alignment:Alignment,target:'selection'|'canvas'='selection'):BatchMutation['actions']{
 const roots=selectedRoots(manifest,ids),frame=target==='canvas'||roots.length===1?{x:0,y:0,width:manifest.width,height:manifest.height}:selectionBounds(manifest,ids)
 if(!frame||!roots.length)return []
 return roots.flatMap(root=>{
  const r=selectionBounds(manifest,[root.id]);if(!r)return []
  let dx=0,dy=0
  if(alignment==='left')dx=frame.x-r.x
  if(alignment==='center')dx=frame.x+frame.width/2-r.x-r.width/2
  if(alignment==='right')dx=frame.x+frame.width-r.x-r.width
  if(alignment==='top')dy=frame.y-r.y
  if(alignment==='middle')dy=frame.y+frame.height/2-r.y-r.height/2
  if(alignment==='bottom')dy=frame.y+frame.height-r.y-r.height
  return dx||dy?sharedTransformActions(manifest,[root.id],{kind:'translate',dx,dy}):[]
 })
}
export function distributeLayers(manifest:Manifest,ids:string[],axis:'horizontal'|'vertical'):BatchMutation['actions']{
 const items=selectedRoots(manifest,ids).map(root=>({root,r:selectionBounds(manifest,[root.id])})).filter((item):item is {root:typeof item.root;r:Bounds}=>!!item.r)
 if(items.length<3)throw new EditorError('INVALID_ARGUMENT','Select at least three layers to distribute.')
 const center=(r:Bounds)=>axis==='horizontal'?r.x+r.width/2:r.y+r.height/2
 items.sort((a,b)=>center(a.r)-center(b.r));const first=center(items[0].r),gap=(center(items.at(-1)!.r)-first)/(items.length-1)
 return items.slice(1,-1).flatMap((item,index)=>{const delta=first+gap*(index+1)-center(item.r);return sharedTransformActions(manifest,[item.root.id],{kind:'translate',dx:axis==='horizontal'?delta:0,dy:axis==='vertical'?delta:0})})
}
