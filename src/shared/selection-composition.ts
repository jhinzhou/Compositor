import {EditorError} from './contracts'
import {LIMITS} from './limits'
import type {Selection} from './pixel-contracts'
import {selectionCoverage} from './selection-coverage'

const normalized = new WeakMap<Selection, {width:number;height:number;selection:Selection}>()
function copyShape(shape:Selection['shapes'][number]):Selection['shapes'][number] {
  // Read numeric leaves explicitly: freehand drafts may contain reactive arrays,
  // which structuredClone cannot serialize even if their outer shape is plain.
  return {kind:shape.kind,operation:shape.operation,feather:shape.feather,bounds:[...shape.bounds],...(shape.points?{points:shape.points.map(([x,y])=>[x,y] as [number,number])}:{}),...(shape.raster?{raster:{width:shape.raster.width,height:shape.raster.height,transform:{...shape.raster.transform,origin:[...shape.raster.transform.origin] as [number,number],size:[...shape.raster.transform.size] as [number,number]},runs:shape.raster.runs.map(([y,x,length,value])=>[y,x,length,value] as [number,number,number,number])}}:{})}
}

/** Materialize the current inverse before appending an operation. Keeping the global
 * inverse flag would invert the new outline too; dropping it loses the current selection. */
export function selectionOperationBase(previous:Selection|null|undefined,width:number,height:number):Selection {
  if(!previous)return {shapes:[],inverted:false}
  if(!previous.inverted)return previous
  const cached=normalized.get(previous)
  if(cached?.width===width&&cached.height===height)return cached.selection
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)
    throw new EditorError('RESOURCE_LIMIT','Inverted selection exceeds the document raster budget.')
  const runs:[number,number,number,number][]=[]
  // Stream coverage into runs instead of retaining another document-sized bitmap.
  for(let y=0;y<height;y++){
    let start=0,value=Math.round(selectionCoverage(previous,.5,y+.5)*255)
    for(let x=1;x<=width;x++){
      const next=x<width?Math.round(selectionCoverage(previous,x+.5,y+.5)*255):-1
      if(next===value)continue
      if(value){runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Inverted selection exceeds the coverage budget.')}
      start=x;value=next
    }
  }
  const selection:Selection={inverted:false,shapes:[{kind:'raster',operation:'replace',feather:0,bounds:[0,0,width,height],raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs}}]}
  normalized.set(previous,{width,height,selection})
  return selection
}

export function appendSelectionShape(previous:Selection|null|undefined,shape:Selection['shapes'][number],width:number,height:number):Selection {
  const base=shape.operation==='replace'?{shapes:[]}:selectionOperationBase(previous,width,height)
  if(base.shapes.length>=128)throw new EditorError('RESOURCE_LIMIT','Selection contains too many combined outlines.')
  return {inverted:false,shapes:[...base.shapes.map(copyShape),copyShape({...shape,feather:0})],antialiased:previous?.antialiased??true,feather:0,canvasSize:[width,height]}
}
