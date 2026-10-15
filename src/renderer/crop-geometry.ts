import {EditorError} from '../shared/contracts'
import {LIMITS} from '../shared/limits'
import type {Selection} from '../shared/pixel-contracts'
import {selectionCoverage} from '../shared/selection-coverage'
import {cropRectangle,type Point as PixelPoint} from '../shared/interaction-geometry'
import {normalizeGrid,snapRect,snapTargets,type Rect,type SnapOptions} from './view-geometry'

export type CropRect=Rect
export type CropHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
export type CropDragMode='create'|'move'|CropHandle
export const CROP_HANDLES:CropHandle[]=['nw','n','ne','e','se','s','sw','w']
export function sameCropRect(a:CropRect,b:CropRect):boolean{return a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height}

export function pixelCropRect(rect:CropRect):CropRect {
  const x=Math.round(Math.min(rect.x,rect.x+rect.width)),y=Math.round(Math.min(rect.y,rect.y+rect.height))
  return {x,y,width:Math.max(1,Math.round(Math.max(rect.x,rect.x+rect.width))-x),height:Math.max(1,Math.round(Math.max(rect.y,rect.y+rect.height))-y)}
}
export function validCropRect(rect:CropRect):boolean{return Object.values(rect).every(Number.isFinite)&&Math.abs(rect.x)<=1_000_000&&Math.abs(rect.y)<=1_000_000&&rect.width>=1&&rect.height>=1&&rect.width<=LIMITS.maxSide&&rect.height<=LIMITS.maxSide&&rect.width*rect.height<=LIMITS.maxSurfacePixels}

/** Actual nonzero coverage, clipped to the canvas; shape-bound unions are wrong for
 * inversions, intersections and subtractions. This runs only on entering Crop. */
export function selectionBoundingBox(selection:Selection|null|undefined,width:number,height:number):CropRect|undefined {
  if(!selection)return undefined
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Selection crop exceeds the raster budget.')
  // Search boundaries instead of visiting every selected pixel. A large inverse
  // or rectangle usually resolves at its first edge samples, without freezing UI.
  let left=width,top=height,right=0,bottom=0
  rows:for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(selectionCoverage(selection,x+.5,y+.5)>0){top=y;break rows}
  if(top===height)return undefined
  rows:for(let y=height-1;y>=top;y--)for(let x=0;x<width;x++)if(selectionCoverage(selection,x+.5,y+.5)>0){bottom=y+1;break rows}
  columns:for(let x=0;x<width;x++)for(let y=top;y<bottom;y++)if(selectionCoverage(selection,x+.5,y+.5)>0){left=x;break columns}
  columns:for(let x=width-1;x>=left;x--)for(let y=top;y<bottom;y++)if(selectionCoverage(selection,x+.5,y+.5)>0){right=x+1;break columns}
  return {x:left,y:top,width:right-left,height:bottom-top}
}

function nearest(value:number,targets:number[],options:SnapOptions):number|undefined {
  const candidates=[...targets]
  if(options.grid&&options.gridVisible){const grid=normalizeGrid(options.grid),step=grid.spacing/grid.subdivisions,index=Math.round(value/step);candidates.push(Math.round(index*step))}
  const tolerance=(options.tolerance??8)/Math.max(options.zoom,.0001)
  let best:number|undefined,distance=tolerance+1
  for(const candidate of candidates){const d=Math.abs(candidate-value);if(d<=tolerance&&d<distance){best=candidate;distance=d}}
  return best
}

/** Snap only the dragged edges. Fixed-ratio frames snap when moved, never when
 * resized/created, so snapping cannot silently change the selected aspect ratio. */
export function snapCropRectangle(rect:CropRect,mode:CropDragMode,initial:CropRect,start:PixelPoint,point:PixelPoint,aspect:number|undefined,symmetric:boolean,options?:SnapOptions,ctrl=false):CropRect {
  if(!options?.enabled||ctrl||mode==='move'||aspect)return rect
  const targets=snapTargets({...options,includeCenters:false}),horizontal=mode==='create'||mode.includes('w')||mode.includes('e'),vertical=mode==='create'||mode.includes('n')||mode.includes('s')
  let left=rect.x,right=rect.x+rect.width,top=rect.y,bottom=rect.y+rect.height
  if(horizontal){if(Math.abs(point[0]-left)<=Math.abs(point[0]-right)){const x=nearest(left,targets.xs,options);if(x!==undefined&&x<right)left=x}else {const x=nearest(right,targets.xs,options);if(x!==undefined&&x>left)right=x}}
  if(vertical){if(Math.abs(point[1]-top)<=Math.abs(point[1]-bottom)){const y=nearest(top,targets.ys,options);if(y!==undefined&&y<bottom)top=y}else {const y=nearest(bottom,targets.ys,options);if(y!==undefined&&y>top)bottom=y}}
  if(symmetric){const cx=mode==='create'?start[0]:initial.x+initial.width/2,cy=mode==='create'?start[1]:initial.y+initial.height/2;if(horizontal){const half=Math.abs((Math.abs(point[0]-left)<=Math.abs(point[0]-right)?left:right)-cx);left=cx-half;right=cx+half}if(vertical){const half=Math.abs((Math.abs(point[1]-top)<=Math.abs(point[1]-bottom)?top:bottom)-cy);top=cy-half;bottom=cy+half}}
  return pixelCropRect({x:left,y:top,width:right-left,height:bottom-top})
}

export function cropDragRectangle(initial:CropRect,mode:Exclude<CropDragMode,'create'>,delta:PixelPoint,aspect?:number,symmetric=false,options?:SnapOptions,ctrl=false):CropRect {
  if(mode==='move'){
    const proposed={x:delta[0],y:delta[1]},snapped=options?snapRect(initial,proposed,{...options,enabled:options.enabled&&!ctrl,includeCenters:false,tolerance:options.tolerance??8}).delta:proposed
    return pixelCropRect({...initial,x:initial.x+snapped.x,y:initial.y+snapped.y})
  }
  const sx=mode.includes('w')?-1:mode.includes('e')?1:0,sy=mode.includes('n')?-1:mode.includes('s')?1:0,span=symmetric?2:1
  const rawWidth=sx?initial.width+delta[0]*sx*span:initial.width,rawHeight=sy?initial.height+delta[1]*sy*span:initial.height
  let width=Math.max(1,Math.abs(rawWidth)),height=Math.max(1,Math.abs(rawHeight))
  if(aspect&&aspect>0){if(!sx)width=height*aspect;else if(!sy)height=width/aspect;else {const baseHeight=initial.width/aspect,factor=Math.max(1/Math.min(initial.width,baseHeight),(rawWidth*initial.width+rawHeight*baseHeight)/(initial.width**2+baseHeight**2));width=initial.width*factor;height=baseHeight*factor}}
  const cx=initial.x+initial.width/2,cy=initial.y+initial.height/2,anchorX=symmetric||!sx?cx:sx<0?initial.x+initial.width:initial.x,anchorY=symmetric||!sy?cy:sy<0?initial.y+initial.height:initial.y
  const centerX=anchorX+(symmetric||!sx?0:sx*width/2*(rawWidth<0?-1:1)),centerY=anchorY+(symmetric||!sy?0:sy*height/2*(rawHeight<0?-1:1)),rect=pixelCropRect({x:centerX-width/2,y:centerY-height/2,width,height})
  const start:PixelPoint=[sx<0?initial.x:sx>0?initial.x+initial.width:cx,sy<0?initial.y:sy>0?initial.y+initial.height:cy],point:PixelPoint=[start[0]+delta[0],start[1]+delta[1]]
  return snapCropRectangle(rect,mode,initial,start,point,aspect,symmetric,options,ctrl)
}

export function createCropRectangle(start:PixelPoint,end:PixelPoint,aspect?:number,symmetric=false,options?:SnapOptions,ctrl=false):CropRect {
  const rect=cropRectangle(start,end,aspect,symmetric)
  return snapCropRectangle(rect,'create',rect,start,end,aspect,symmetric,options,ctrl)
}
