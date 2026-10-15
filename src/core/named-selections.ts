import {EditorError,LIMITS,type EditAction,type Manifest} from '../shared/contracts'
import {NAMED_SELECTION_LIMITS,namedSelectionsSchema,type NamedSelection,type SelectionCombine} from '../shared/named-selections'
import {selectionCoverage} from '../shared/selection-coverage'
import type {Selection} from '../shared/pixel-contracts'
import type {PixelStage} from './pixel-actions'

type NamedAction=Extract<EditAction,{type:'selection.save_named'|'selection.load_named'|'selection.rename_named'|'selection.delete_named'}>
type Run=NamedSelection['runs'][number]
function sizeBudget(width:number,height:number,count=1):void{
 if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height*Math.max(1,count)>NAMED_SELECTION_LIMITS.maxPixels)throw new EditorError('RESOURCE_LIMIT','Named selections exceed the coverage pixel budget.')
}
/** Scan rows into canonical nonzero runs, without allocating a document bitmap. */
function capture(name:string,width:number,height:number,valueAt:(x:number,y:number)=>number,runBudget:number=NAMED_SELECTION_LIMITS.maxRuns):NamedSelection{
 sizeBudget(width,height)
 const runs:Run[]=[]
 for(let y=0;y<height;y++){
  let start=0,value=Math.round(Math.max(0,Math.min(255,valueAt(.5,y+.5))))
  for(let x=1;x<=width;x++){
   const valueNext=x<width?Math.round(Math.max(0,Math.min(255,valueAt(x+.5,y+.5)))):-1
   if(valueNext===value)continue
   if(value){runs.push([y,start,x-start,value]);if(runs.length>runBudget)throw new EditorError('RESOURCE_LIMIT','Named selections exceed the coverage run budget.')}
   start=x;value=valueNext
  }
 }
 return {name,width,height,runs}
}
function checked(manifest:Manifest,channels:NamedSelection[]):void{
 const parsed=namedSelectionsSchema.safeParse(channels)
 if(!parsed.success)throw new EditorError('RESOURCE_LIMIT','Named selections exceed the project coverage budget.')
 if(Buffer.byteLength(JSON.stringify({...manifest,namedSelections:channels}))>LIMITS.maxManifestBytes)throw new EditorError('RESOURCE_LIMIT','The project manifest exceeds its 4 MiB limit.')
}
export function namedSelectionAsSelection(channel:NamedSelection):Selection{
 const {width,height}=channel
 return {inverted:false,antialiased:false,feather:0,canvasSize:[width,height],shapes:[{kind:'raster',operation:'replace',bounds:[0,0,width,height],feather:0,raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs:channel.runs.map(run=>[...run] as Run)}}]}
}
function sampler(channel:NamedSelection):(x:number,y:number)=>number{
 const rows=new Map<number,Run[]>()
 for(const run of channel.runs){let row=rows.get(run[0]);if(!row){row=[];rows.set(run[0],row)}row.push(run)}
 return (x,y)=>{
  if(x<0||y<0||x>=channel.width||y>=channel.height)return 0
  const row=rows.get(Math.floor(y));if(!row)return 0
  const column=Math.floor(x);let lo=0,hi=row.length-1
  while(lo<=hi){const mid=(lo+hi)>>1,run=row[mid];if(column<run[1])hi=mid-1;else if(column>=run[1]+run[2])lo=mid+1;else return run[3]}
  return 0
 }
}
function combine(a:number,b:number,operation:SelectionCombine):number{
 return operation==='replace'?b:operation==='add'?Math.max(a,b):operation==='subtract'?a*(1-b/255):a*b/255
}
export function applyNamedSelectionAction(stage:PixelStage,action:NamedAction):string{
 const channels=stage.manifest.namedSelections??[],index=channels.findIndex(channel=>channel.name===action.name),{width,height}=stage.manifest
 if(action.type==='selection.save_named'){
  if(!stage.selection)throw new EditorError('INVALID_ARGUMENT','Create a selection before saving a named selection.')
  if(index>=0&&!action.overwrite)throw new EditorError('INVALID_ARGUMENT','A named selection already uses this name. Enable overwrite or choose another name.')
  const others=channels.filter((_,i)=>i!==index)
  if(others.length>=NAMED_SELECTION_LIMITS.maxCount)throw new EditorError('RESOURCE_LIMIT','The document already has 32 named selections.')
  sizeBudget(width,height,others.length+1)
  const captured=capture(action.name,width,height,(x,y)=>selectionCoverage(stage.selection,x,y)*255,NAMED_SELECTION_LIMITS.maxRuns-others.reduce((sum,channel)=>sum+channel.runs.length,0))
  const next=[...channels];if(index>=0)next[index]=captured;else next.push(captured)
  checked(stage.manifest,next);stage.manifest.namedSelections=next;return 'Save named selection'
 }
 if(index<0)throw new EditorError('INVALID_ARGUMENT','The named selection no longer exists.')
 if(action.type==='selection.load_named'){
  if(action.operation==='replace')stage.selection=namedSelectionAsSelection(channels[index])
  else {const sample=sampler(channels[index]),current=stage.selection;stage.selection=namedSelectionAsSelection(capture(action.name,width,height,(x,y)=>combine(current?selectionCoverage(current,x,y)*255:0,sample(x,y),action.operation)))}
  return 'Load named selection'
 }
 if(action.type==='selection.rename_named'){
  if(channels.some((channel,i)=>i!==index&&channel.name===action.newName))throw new EditorError('INVALID_ARGUMENT','A named selection already uses this name. Enable overwrite or choose another name.')
  const next=channels.map((channel,i)=>i===index?{...channel,name:action.newName}:channel);checked(stage.manifest,next);stage.manifest.namedSelections=next;return 'Rename named selection'
 }
 const next=channels.filter((_,i)=>i!==index);if(next.length)stage.manifest.namedSelections=next;else delete stage.manifest.namedSelections
 return 'Delete named selection'
}

/** Named alpha channels stay on the document grid during destructive geometry edits. */
export function transformNamedSelections(manifest:Manifest,width:number,height:number,map:(x:number,y:number)=>[number,number],smooth=false,clampEdges=false):void{
 if(!manifest.namedSelections?.length)return
 sizeBudget(width,height,manifest.namedSelections.length)
 let remaining=NAMED_SELECTION_LIMITS.maxRuns
 const channels=manifest.namedSelections.map(channel=>{
  const sample=sampler(channel)
  const transformed=capture(channel.name,width,height,(x,y)=>{
   const [sx,sy]=map(x,y)
   if(!smooth)return sample(sx,sy)
   if(clampEdges&&(sx<0||sy<0||sx>=channel.width||sy>=channel.height))return 0
   const px=sx-.5,py=sy-.5,ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy
   const tap=clampEdges?(x:number,y:number)=>sample(Math.max(.5,Math.min(channel.width-.5,x)),Math.max(.5,Math.min(channel.height-.5,y))):sample
   return tap(ix+.5,iy+.5)*(1-fx)*(1-fy)+tap(ix+1.5,iy+.5)*fx*(1-fy)+tap(ix+.5,iy+1.5)*(1-fx)*fy+tap(ix+1.5,iy+1.5)*fx*fy
  },remaining)
  remaining-=transformed.runs.length;return transformed
 })
 checked({...manifest,width,height},channels);manifest.namedSelections=channels
}
