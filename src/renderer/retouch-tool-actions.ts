import type {EditAction} from '../shared/contracts'
import {compactStroke} from '../shared/stroke-compaction'
export type RetouchToolMode='remove'|'content-move'|'red-eye'
export interface RetouchToolOptions{size:number;hardness:number;opacity:number;protectAlpha:boolean;fillClosedLoop:boolean;adaptation:number;pupilSize:number;darkenAmount:number}
export function redEyeBounds(points:readonly [number,number][]):[number,number,number,number]{
 const a=points[0],b=points.at(-1)??a;if(!a)throw new Error('Red Eye requires a point or rectangle.')
 if(Math.hypot(b[0]-a[0],b[1]-a[1])<2)return [a[0]-32,a[1]-32,64,64]
 return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(1,Math.abs(b[0]-a[0])),Math.max(1,Math.abs(b[1]-a[1]))]
}
export function retouchToolAction(mode:RetouchToolMode,layerId:string,points:readonly [number,number][],seed:number,options:RetouchToolOptions):Extract<EditAction,{type:'layer.remove'|'layer.content_aware_move'|'layer.red_eye'}>{
 if(mode==='red-eye')return {type:'layer.red_eye',layerId,bounds:redEyeBounds(points),pupilSize:options.pupilSize,darkenAmount:options.darkenAmount}
 const a=points[0],b=points.at(-1);if(!a||!b)throw new Error('The retouch tool requires at least one point.')
 if(mode==='content-move')return {type:'layer.content_aware_move',layerId,offset:[b[0]-a[0],b[1]-a[1]],adaptation:options.adaptation,opacity:options.opacity,protectAlpha:options.protectAlpha,seed}
 const compacted=compactStroke(points.map(point=>[...point]),Math.min(.125,options.size*.005))
 if(compacted.length>4096)throw new Error('Remove Tool exceeds 4,096 points. Use a shorter stroke.')
 return {type:'layer.remove',layerId,points:compacted,size:options.size,hardness:options.hardness,opacity:options.opacity,protectAlpha:options.protectAlpha,fillClosedLoop:options.fillClosedLoop,seed}
}
