import {EditorError,LIMITS,type Transform} from './contracts'
import {validateShapeStyle,type ShapeStyle} from './content-style'
export interface ShapeTransformRender {index:number;layerId:string;style:ShapeStyle;size:[number,number];sourceHash:string}
export interface PreparedShapeTransform {index:number;layerId:string;sourceHash:string;style:ShapeStyle;bytes:Uint8Array}
/** Native redrawShape rounds the target raster extent, keeping radius/lineWidth in document pixels. */
export function shapeTransformExtent(style:unknown,transform:Transform,current?:{width:number;height:number}):[number,number]|undefined {
 if(!style||!current)return
 validateShapeStyle(style)
 const size:[number,number]=[Math.max(1,Math.round(transform.size[0])),Math.max(1,Math.round(transform.size[1]))]
 if(size[0]===current.width&&size[1]===current.height)return
 if(size.some(value=>!Number.isFinite(value)||value>LIMITS.maxSide)||size[0]*size[1]>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The transformed shape exceeds the surface budget.')
 return size
}

/** The native text editor keeps transformed local (0,0) anchored when point-text raster dimensions change. */
export function contentRasterTransform(transform:Transform,oldSize:[number,number],nextSize:[number,number],fixedParagraph=false):Transform {
 if(fixedParagraph)return structuredClone(transform)
 const next=structuredClone(transform),anchor=(value:Transform):[number,number]=>{const x=(value.flipX?1:-1)*value.size[0]/2,y=(value.flipY?1:-1)*value.size[1]/2,angle=value.rotation*Math.PI/180;return [value.origin[0]+value.size[0]/2+x*Math.cos(angle)-y*Math.sin(angle),value.origin[1]+value.size[1]/2+x*Math.sin(angle)+y*Math.cos(angle)]}
 const before=anchor(transform);next.size=[transform.size[0]*nextSize[0]/oldSize[0],transform.size[1]*nextSize[1]/oldSize[1]];const after=anchor(next);next.origin=[next.origin[0]+before[0]-after[0],next.origin[1]+before[1]-after[1]];return next
}

export function resizedParagraphBox(old:Transform,source:[number,number],handle:[number,number],delta:[number,number]):{size:[number,number];transform:Transform} {
 const angle=old.rotation*Math.PI/180,dx=delta[0]*Math.cos(angle)+delta[1]*Math.sin(angle),dy=-delta[0]*Math.sin(angle)+delta[1]*Math.cos(angle),minW=16*old.size[0]/source[0],minH=16*old.size[1]/source[1]
 let left=0,top=0,right=old.size[0],bottom=old.size[1]
 if(handle[0]===0)left=Math.min(dx,right-minW);if(handle[0]===1)right=Math.max(left+minW,right+dx);if(handle[1]===0)top=Math.min(dy,bottom-minH);if(handle[1]===1)bottom=Math.max(top+minH,bottom+dy)
 const size:[number,number]=[Math.max(16,Math.round((right-left)*source[0]/old.size[0])),Math.max(16,Math.round((bottom-top)*source[1]/old.size[1]))]
 if(size.some(value=>value>LIMITS.maxSide)||size[0]*size[1]>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The paragraph box exceeds the surface budget.')
 const transform=structuredClone(old);transform.size=[size[0]*old.size[0]/source[0],size[1]*old.size[1]/source[1]]
 const point=(value:Transform,unit:[number,number]):[number,number]=>{const x=(unit[0]-.5)*value.size[0]*(value.flipX?-1:1),y=(unit[1]-.5)*value.size[1]*(value.flipY?-1:1);return [value.origin[0]+value.size[0]/2+x*Math.cos(angle)-y*Math.sin(angle),value.origin[1]+value.size[1]/2+x*Math.sin(angle)+y*Math.cos(angle)]}
 const anchor=point(old,[old.flipX?1-left/old.size[0]:left/old.size[0],old.flipY?1-top/old.size[1]:top/old.size[1]]),current=point(transform,[old.flipX?1:0,old.flipY?1:0]);transform.origin=[transform.origin[0]+anchor[0]-current[0],transform.origin[1]+anchor[1]-current[1]]
 return {size,transform}
}

/** Preserve the transformed centre when a source-local effect adds an equal margin on all sides. */
export function expandedContentTransform(transform:Transform,source:[number,number],inset:number):Transform {
 const next={...transform,origin:[...transform.origin] as [number,number],size:[...transform.size] as [number,number]},dx=inset*transform.size[0]/source[0],dy=inset*transform.size[1]/source[1]
 next.origin=[transform.origin[0]-dx,transform.origin[1]-dy];next.size=[transform.size[0]+2*dx,transform.size[1]+2*dy];return next
}
