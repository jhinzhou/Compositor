import {selectionFeatherAmount,selectionFeatherHalo,selectionFeatherSigma,type SelectionFeatherModel} from './selection-gaussian'
import {EditorError} from './contracts'
import {LIMITS} from './limits'
import type {Selection} from './pixel-contracts'
import {selectionCoverage} from './selection-coverage'
import {selectionGeometryBounds} from './selection-bounds'

const normalized = new WeakMap<Selection, {width:number;height:number;selection:Selection}>()
function copyShape(shape:Selection['shapes'][number]):Selection['shapes'][number] {
  // Read numeric leaves explicitly: freehand drafts may contain reactive arrays,
  // which structuredClone cannot serialize even if their outer shape is plain.
  return {kind:shape.kind,operation:shape.operation,feather:shape.feather,bounds:[...shape.bounds],...(shape.points?{points:shape.points.map(([x,y])=>[x,y] as [number,number])}:{}),...(shape.raster?{raster:{width:shape.raster.width,height:shape.raster.height,transform:{...shape.raster.transform,origin:[...shape.raster.transform.origin] as [number,number],size:[...shape.raster.transform.size] as [number,number]},runs:shape.raster.runs.map(([y,x,length,value])=>[y,x,length,value] as [number,number,number,number])}}:{})}
}

const featherAmount=selectionFeatherAmount
/** Stream the final coverage into a bounded RLE field. No raster image or mask
 * asset is written. This prevents a subsequent shape from inheriting old blur. */
function materializeCoverage(selection:Selection,width:number,height:number):Selection {
  if(!selection.shapes.length)return {inverted:false,feather:0,canvasSize:[width,height],shapes:selection.inverted?[{kind:'rectangle',operation:'replace',feather:0,bounds:[0,0,width,height]}]:[]}
  const [left,top,w,h]=selectionGeometryBounds(selection,width,height,selectionFeatherHalo(selection))
  if(w*h>64_000_000)throw new EditorError('RESOURCE_LIMIT','Selection composition exceeds the coverage budget.')
  const aligned=selection.shapes.every(shape=>shape.kind==='rectangle'&&shape.bounds.every(Number.isInteger)||shape.kind==='raster'&&shape.raster!.transform.rotation===0&&shape.raster!.transform.origin.every(Number.isInteger)&&shape.raster!.transform.size[0]===shape.raster!.width&&shape.raster!.transform.size[1]===shape.raster!.height)
  const sampleFactor=aligned||selection.antialiased===false&&!featherAmount(selection)?1:16
  const complexity=Math.max(1,selection.shapes.reduce((work,shape)=>work+(shape.kind==='polygon'?shape.points!.length:1),0))
  if(w*h*complexity*sampleFactor>80_000_000)throw new EditorError('RESOURCE_LIMIT','Selection composition exceeds the coverage work budget.')
  const runs:[number,number,number,number][]=[]
  for(let y=0;y<h;y++){
    let start=0,value=Math.round(selectionCoverage(selection,left+.5,top+y+.5)*255)
    for(let x=1;x<=w;x++){
      const next=x<w?Math.round(selectionCoverage(selection,left+x+.5,top+y+.5)*255):-1
      if(next===value)continue
      if(value){runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Selection composition exceeds the coverage run budget.')}
      start=x;value=next
    }
  }
  if(!runs.length)return {inverted:false,shapes:[],antialiased:selection.antialiased,feather:0,...(selection.featherModel?{featherModel:selection.featherModel}:{}),canvasSize:[width,height]}
  return {inverted:false,antialiased:selection.antialiased,feather:0,...(selection.featherModel?{featherModel:selection.featherModel}:{}),canvasSize:[width,height],shapes:[{kind:'raster',operation:'replace',feather:0,bounds:[left,top,w,h],raster:{width:w,height:h,transform:{origin:[left,top],size:[w,h],rotation:0,flipX:false,flipY:false},runs}}]}
}

/** Materialize inverse and existing feather before appending another operation.
 * A global inverse or feather would otherwise apply to the new shape as well. */
export function selectionOperationBase(previous:Selection|null|undefined,width:number,height:number):Selection {
  if(!previous)return {shapes:[],inverted:false}
  if(!previous.inverted&&!featherAmount(previous))return previous
  const cached=normalized.get(previous)
  if(cached?.width===width&&cached.height===height)return cached.selection
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)
    throw new EditorError('RESOURCE_LIMIT','Inverted selection exceeds the document raster budget.')
  const selection=materializeCoverage(previous,width,height)
  normalized.set(previous,{width,height,selection})
  return selection
}

export function appendSelectionShape(previous:Selection|null|undefined,shape:Selection['shapes'][number],width:number,height:number,antialiased=previous?.antialiased??true,featherModel:SelectionFeatherModel|undefined=previous?.featherModel):Selection {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Selection exceeds the document raster budget.')
  if(shape.operation==='replace')return {inverted:false,shapes:[copyShape({...shape,feather:0})],antialiased,feather:shape.feather,...(featherModel?{featherModel}:{}),canvasSize:[width,height]}
  const base=selectionOperationBase(previous,width,height)
  if(base.shapes.length>=128)throw new EditorError('RESOURCE_LIMIT','Selection contains too many combined outlines.')
  const newShape=shape.feather?materializeCoverage({shapes:[copyShape({...shape,operation:'replace',feather:0})],inverted:false,antialiased,feather:shape.feather,...(featherModel?{featherModel}:{}),canvasSize:[width,height]},width,height).shapes[0]:copyShape({...shape,feather:0})
  // An empty new soft shape still matters for replace/intersection; replace has
  // already returned above. Intersect with empty coverage clears the selection.
  if(!newShape&&shape.operation==='intersect')return {inverted:false,shapes:[],antialiased,feather:0,...(featherModel?{featherModel}:{}),canvasSize:[width,height]}
  return {inverted:false,shapes:[...base.shapes.map(copyShape),...(newShape?[copyShape({...newShape,operation:shape.operation})]:[])],antialiased,feather:0,...(featherModel?{featherModel}:{}),canvasSize:[width,height]}
}

/** Add Gaussian variance without reinterpreting an existing project's radius.
 * If the equivalent radius cannot fit the serialized scalar, bake the previous
 * coverage before applying the new blur; never silently clamp the old blur. */
export function appendSelectionFeather(previous:Selection,width:number,height:number,amount:number,requestedModel?:SelectionFeatherModel):Selection {
 const model=requestedModel??previous.featherModel,oldSigma=selectionFeatherSigma(featherAmount(previous),previous.featherModel),factor=model==='photoshop'?1:.5
 const equivalentRadius=Math.hypot(oldSigma,selectionFeatherSigma(amount,model))/factor
 if(equivalentRadius<=250||featherAmount(previous)<=250&&selectionFeatherSigma(1,previous.featherModel)===factor)return {...previous,feather:Math.min(250,equivalentRadius),...(model?{featherModel:model}:{}),canvasSize:[width,height]}
 const base=selectionOperationBase(previous,width,height)
 return {...base,feather:Math.min(250,amount),...(model?{featherModel:model}:{}),canvasSize:[width,height]}
}
