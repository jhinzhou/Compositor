import {EditorError} from './contracts'
import {LIMITS} from './limits'
import type {Selection} from './pixel-contracts'
import {selectionGeometryBounds} from './selection-bounds'
import {selectionCoverage} from './selection-coverage'
import {selectionFeatherHalo} from './selection-gaussian'

export const SELECTION_MODIFY_COVERAGE_BUDGET = 25_000_000
export const SELECTION_MODIFY_WORK_BUDGET = 250_000_000
type Operation = 'smooth' | 'border'
function validateAmount(operation:Operation,amount:number):void {
 const maximum=operation==='smooth'?100:200
 if(!Number.isInteger(amount)||amount<1||amount>maximum)throw new EditorError('INVALID_ARGUMENT',`Selection ${operation} amount must be an integer between 1 and ${maximum}.`)
}
function validateDimensions(width:number,height:number):void {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide)throw new EditorError('INVALID_ARGUMENT','Selection modification requires valid canvas dimensions.')
}
function workEstimate(width:number,height:number,radius:number,range=false):number {
 // Initial disk histogram per row, then two sample updates per disk scanline.
 // The two-level histogram bounds each query to at most 32 bins (64 for min/max).
 return height*(2*radius+1)**2+width*height*(4*radius+2+(range?64:32))
}
function assertBudget(width:number,height:number,work:number):void {
 if(width*height>SELECTION_MODIFY_COVERAGE_BUDGET)throw new EditorError('RESOURCE_LIMIT','Selection modification exceeds the 25 MP coverage budget.')
 if(work>SELECTION_MODIFY_WORK_BUDGET)throw new EditorError('RESOURCE_LIMIT','Selection modification exceeds the neighborhood work budget.')
}
function samplingWork(selection:Selection,width:number,height:number):number {
 let cost=0
 const aligned=selection.shapes.every(shape=>shape.kind==='rectangle'&&shape.bounds.every(Number.isInteger)||shape.kind==='raster'&&shape.raster!.transform.rotation===0&&shape.raster!.transform.origin.every(Number.isInteger)&&shape.raster!.transform.size[0]===shape.raster!.width&&shape.raster!.transform.size[1]===shape.raster!.height)
 for(const shape of selection.shapes){
  if(!shape.raster){cost++;continue}
  const rows=new Map<number,[number,number][]>()
  for(const [y,x,n] of shape.raster.runs){let row=rows.get(y);if(!row){row=[];rows.set(y,row)}row.push([x,x+n])}
  let rowCost=1
  for(const row of rows.values()){
   row.sort((a,b)=>a[0]-b[0]);let end=-1,overlap=false
   for(const [start,right] of row){if(start<end)overlap=true;end=Math.max(end,right)}
   rowCost=Math.max(rowCost,overlap?row.length:Math.ceil(Math.log2(row.length+1)))
  }
  cost+=rowCost
 }
 // Curved/transformed AA uses sixteen geometry samples. Count overlapping RLE
 // rows separately: that legacy sampler scans them instead of binary searching.
 return width*height*cost*(aligned||selection.antialiased===false&&!selection.feather?1:16)
}
/** Exact disk-neighborhood statistics on 8-bit coverage. A sliding histogram
 * keeps work proportional to radius, avoiding a radius-squared scan per pixel. */
function diskStatistics(input:Uint8Array,width:number,height:number,radius:number,mode:'median'|'range',edge:'clamp'|'zero'):{low:Uint8Array;high?:Uint8Array} {
 if(!radius)return {low:input.slice(),high:mode==='range'?input.slice():undefined}
 const spans=Array.from({length:radius*2+1},(_,i)=>Math.floor(Math.sqrt(radius*radius-(i-radius)**2)))
 const count=spans.reduce((sum,span)=>sum+span*2+1,0),rank=Math.floor(count/2)
 const histogram=new Uint32Array(256),blocks=new Uint32Array(16),low=new Uint8Array(input.length),high=mode==='range'?new Uint8Array(input.length):undefined
 function sample(x:number,y:number):number {
  if(edge==='zero'&&(x<0||y<0||x>=width||y>=height))return 0
  return input[Math.max(0,Math.min(height-1,y))*width+Math.max(0,Math.min(width-1,x))]
 }
 function change(value:number,delta:number):void {histogram[value]+=delta;blocks[value>>4]+=delta}
 for(let y=0;y<height;y++){
  histogram.fill(0);blocks.fill(0)
  for(let row=0;row<spans.length;row++)for(let x=-spans[row];x<=spans[row];x++)change(sample(x,y+row-radius),1)
  for(let x=0;x<width;x++){
   let block=0,below=0
   if(mode==='median'){
    while(below+blocks[block]<=rank){below+=blocks[block];block++}
    let value=block*16;while(below+histogram[value]<=rank){below+=histogram[value];value++}
    low[y*width+x]=value
   }else{
    while(!blocks[block])block++;let value=block*16;while(!histogram[value])value++;low[y*width+x]=value
    block=15;while(!blocks[block])block--;value=block*16+15;while(!histogram[value])value--;high![y*width+x]=value
   }
   if(x+1<width)for(let row=0;row<spans.length;row++){const yy=y+row-radius,span=spans[row];change(sample(x-span,yy),-1);change(sample(x+span+1,yy),1)}
  }
 }
 return {low,high}
}
export function smoothSelectionCoverage(input:Uint8Array,width:number,height:number,radius:number):Uint8Array {
 validateDimensions(width,height);validateAmount('smooth',radius)
 if(input.length!==width*height)throw new EditorError('INVALID_ARGUMENT','Selection coverage dimensions do not match its pixels.')
 assertBudget(width,height,workEstimate(width,height,radius))
 return diskStatistics(input,width,height,radius,'median','clamp').low
}
/** Width is the total centered band, not the outward expansion radius. Odd
 * widths blend adjacent discrete disk radii, retaining fractional edge coverage. */
export function borderSelectionCoverage(input:Uint8Array,width:number,height:number,bandWidth:number):Uint8Array {
 validateDimensions(width,height);validateAmount('border',bandWidth)
 if(input.length!==width*height)throw new EditorError('INVALID_ARGUMENT','Selection coverage dimensions do not match its pixels.')
 const radius=bandWidth/2,lower=Math.floor(radius),upper=Math.ceil(radius),mix=radius-lower
 assertBudget(width,height,workEstimate(width,height,lower,true)+(mix?workEstimate(width,height,upper,true):0))
 const first=diskStatistics(input,width,height,lower,'range','zero'),output=new Uint8Array(input.length)
 for(let i=0;i<output.length;i++)output[i]=Math.round((first.high![i]-first.low[i])*(1-mix))
 if(mix){const second=diskStatistics(input,width,height,upper,'range','zero');for(let i=0;i<output.length;i++)output[i]=Math.round((first.high![i]-first.low[i])*(1-mix)+(second.high![i]-second.low[i])*mix)}
 return output
}
export function modifyDocumentSelection(selection:Selection,width:number,height:number,operation:Operation,amount:number):Selection {
 validateDimensions(width,height);validateAmount(operation,amount)
 const radius=operation==='smooth'?amount:Math.ceil(amount/2),bounds=selectionGeometryBounds(selection,width,height,selectionFeatherHalo(selection)+radius+1),[left,top,w,h]=bounds
 const work=operation==='smooth'?workEstimate(w,h,radius):workEstimate(w,h,Math.floor(amount/2),true)+(amount%2?workEstimate(w,h,radius,true):0)
 assertBudget(w,h,work+samplingWork(selection,w,h))
 if(!w||!h)return {inverted:false,antialiased:selection.antialiased,feather:0,canvasSize:[width,height],shapes:[]}
 // Bake the effective channel once: all gray levels, inverse, AA, and the current
 // feather become data. The output must not apply the same feather a second time.
 const input=new Uint8Array(w*h),source={...selection,canvasSize:[width,height] as [number,number]}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)input[y*w+x]=Math.round(selectionCoverage(source,left+x+.5,top+y+.5)*255)
 const output=operation==='smooth'?smoothSelectionCoverage(input,w,h,amount):borderSelectionCoverage(input,w,h,amount),runs:[number,number,number,number][]=[]
 for(let y=0;y<h;y++)for(let x=0;x<w;){const start=x,value=output[y*w+x];while(x<w&&output[y*w+x]===value)x++;if(value)runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Modified selection exceeds the coverage run budget.')}
 return {inverted:false,antialiased:selection.antialiased,feather:0,canvasSize:[width,height],shapes:runs.length?[{kind:'raster',operation:'replace',feather:0,bounds,raster:{width:w,height:h,transform:{origin:[left,top],size:[w,h],rotation:0,flipX:false,flipY:false},runs}}]:[]}
}
