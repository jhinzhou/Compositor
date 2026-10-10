import {selectionGeometryBounds} from './selection-bounds'
import {gaussianSelectionCoverage} from './selection-gaussian'
import {EditorError} from './contracts'
import {LIMITS} from './limits'
import type {Layer} from './contracts'
import type {Selection} from './pixel-contracts'
export function sourcePoint(layer: Pick<Layer,'transform'>,x:number,y:number,width:number,height:number):[number,number]{
 const t=layer.transform,dx=x-t.origin[0]-t.size[0]/2,dy=y-t.origin[1]-t.size[1]/2,a=-t.rotation*Math.PI/180
 return [((dx*Math.cos(a)-dy*Math.sin(a))*(t.flipX?-1:1)/t.size[0]+.5)*width,((dx*Math.sin(a)+dy*Math.cos(a))*(t.flipY?-1:1)/t.size[1]+.5)*height]
}
const polygonRows=new WeakMap<number[][],{rows:Map<number,number[]>;work:number}>()
function polygonContains(points:number[][],x:number,y:number):boolean {
 let cached=polygonRows.get(points);if(!cached){cached={rows:new Map(),work:0};polygonRows.set(points,cached)}
 let crossings=cached.rows.get(y)
 if(!crossings){
  cached.work+=points.length
  if(cached.work>80_000_000)throw new EditorError('RESOURCE_LIMIT','Selection polygon exceeds the scanline intersection budget.')
  crossings=[]
  for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y))crossings.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]))}
  crossings.sort((a,b)=>a-b);cached.rows.set(y,crossings)
 }
 let lo=0,hi=crossings.length
 while(lo<hi){const mid=(lo+hi)>>1;if(crossings[mid]<=x)lo=mid+1;else hi=mid}
 return (crossings.length-lo)%2!==0
}
type CoverageRun={start:number;end:number;value:number;order:number}
const rasterMasks=new WeakMap<object,Map<number,{runs:CoverageRun[];overlap:boolean}>>()
function rasterCoverage(shape:Selection['shapes'][number],x:number,y:number):number{
 const raster=shape.raster!;let rows=rasterMasks.get(raster)
 if(!rows){
  if(raster.width*raster.height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Selection exceeds the pixel budget.')
  rows=new Map()
  for(let order=0;order<raster.runs.length;order++){const [y,x,length,value]=raster.runs[order];if(y<0||x<0||length<1||y>=raster.height||x+length>raster.width)throw new EditorError('INVALID_ARGUMENT','Selection runs are outside their bounds.');let row=rows.get(y);if(!row){row={runs:[],overlap:false};rows.set(y,row)}row.runs.push({start:x,end:x+length,value,order})}
  for(const row of rows.values()){row.runs.sort((a,b)=>a.start-b.start);let end=-1;for(const run of row.runs){if(run.start<end)row.overlap=true;end=Math.max(end,run.end)}}
  rasterMasks.set(raster,rows)
 }
 const [sx,sy]=sourcePoint({transform:{...raster.transform,sampling:'Nearest'}},x,y,raster.width,raster.height),ix=Math.floor(sx),iy=Math.floor(sy)
 if(ix<0||iy<0||ix>=raster.width||iy>=raster.height)return 0
 const row=rows.get(iy);if(!row)return 0
 if(row.overlap){let value=0,order=-1;for(const run of row.runs)if(run.start<=ix&&run.end>ix&&run.order>order){value=run.value;order=run.order}return value/255}
 let lo=0,hi=row.runs.length-1
 while(lo<=hi){const mid=(lo+hi)>>1,run=row.runs[mid];if(ix<run.start)hi=mid-1;else if(ix>=run.end)lo=mid+1;else return run.value/255}
 return 0
}
/** Geometry coverage before antialiasing/feather. Selection combination happens
 * before pixel averaging so touching added paths do not leave a soft seam. */
export function selectionGeometryCoverage(selection:Selection,x:number,y:number):number {
 let value=0
 for(const shape of selection.shapes){
  const [sx,sy,w,h]=shape.bounds
  let alpha=shape.kind==='raster'?rasterCoverage(shape,x,y):x<sx||y<sy||x>sx+w||y>sy+h?0:shape.kind==='ellipse'?((x-sx-w/2)**2/Math.max(.000001,(w/2)**2)+(y-sy-h/2)**2/Math.max(.000001,(h/2)**2)<=1?1:0):shape.kind==='polygon'?(polygonContains(shape.points!,x,y)?1:0):(x>=sx&&x<sx+w&&y>=sy&&y<sy+h?1:0)
  if(shape.operation==='replace')value=alpha
  else if(shape.operation==='add')value=Math.max(value,alpha)
  else if(shape.operation==='subtract')value*=1-alpha
  else value*=alpha
 }
 return selection.inverted?1-value:value
}
export function selectionHardPixelCoverage(selection:Selection,x:number,y:number):number {
 if((selection.antialiased===false&&!(selection.feather??0))||selection.shapes.every(shape=>shape.kind==='rectangle'&&shape.bounds.every(Number.isInteger)||shape.kind==='raster'&&shape.raster!.transform.rotation===0&&shape.raster!.transform.origin.every(Number.isInteger)&&shape.raster!.transform.size[0]===shape.raster!.width&&shape.raster!.transform.size[1]===shape.raster!.height))return selectionGeometryCoverage(selection,x,y)
 // Pixel area samples, not a distance ramp. Integer pixel-aligned masks retain
 // exactly their coverage; diagonal and curved vector boundaries gain AA.
 let sum=0;for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++)sum+=selectionGeometryCoverage(selection,x+(xx+.5)/4-.5,y+(yy+.5)/4-.5)
 return sum/16
}
type CoverageCache={left:number;top:number;width:number;height:number;coverage:Uint8Array}
const feathered=new WeakMap<Selection,CoverageCache>()
/** Use immutable Selection values. Call this before an in-place translation. */
export function invalidateSelectionCoverage(selection:Selection):void{feathered.delete(selection)}
function softCoverage(selection:Selection):CoverageCache {
 const previous=feathered.get(selection);if(previous)return previous
 const amount=selection.feather??Math.max(0,...selection.shapes.map(shape=>shape.feather)),halo=Math.ceil(amount*2)+1
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
 for(const shape of selection.shapes){const [x,y,w,h]=shape.bounds;if(shape.raster){const t=shape.raster.transform,cx=t.origin[0]+t.size[0]/2,cy=t.origin[1]+t.size[1]/2,a=t.rotation*Math.PI/180,ex=Math.abs(Math.cos(a))*t.size[0]/2+Math.abs(Math.sin(a))*t.size[1]/2,ey=Math.abs(Math.sin(a))*t.size[0]/2+Math.abs(Math.cos(a))*t.size[1]/2;left=Math.min(left,cx-ex);top=Math.min(top,cy-ey);right=Math.max(right,cx+ex);bottom=Math.max(bottom,cy+ey)}else{left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+w);bottom=Math.max(bottom,y+h)}}
 if(selection.canvasSize){const bounds=selectionGeometryBounds(selection,...selection.canvasSize,halo);left=bounds[0];top=bounds[1];right=left+bounds[2];bottom=top+bounds[3]}else if(!Number.isFinite(left)){left=0;top=0;right=1;bottom=1}else{left=Math.floor(left)-halo;top=Math.floor(top)-halo;right=Math.ceil(right)+halo;bottom=Math.ceil(bottom)+halo}
 const width=Math.max(1,Math.ceil(right-left)),height=Math.max(1,Math.ceil(bottom-top))
 if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>64_000_000)throw new EditorError('RESOURCE_LIMIT','Feathered selection exceeds the coverage budget.')
 const raw=new Uint8Array(width*height)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw[y*width+x]=Math.round(selectionHardPixelCoverage(selection,left+x+.5,top+y+.5)*255)
 const cached={left,top,width,height,coverage:gaussianSelectionCoverage(raw,width,height,amount)};feathered.set(selection,cached);return cached
}
export function selectionCoverage(selection:Selection|null|undefined,x:number,y:number):number {
 if(!selection)return 1
 x=Math.floor(x)+.5;y=Math.floor(y)+.5
 if(!selection.shapes.length)return selection.inverted?1:0
 const only=selection.shapes.length===1?selection.shapes[0]:undefined
 if(selection.canvasSize&&only?.kind==='rectangle'&&only.operation==='replace'&&only.bounds[0]<=0&&only.bounds[1]<=0&&only.bounds[0]+only.bounds[2]>=selection.canvasSize[0]&&only.bounds[1]+only.bounds[3]>=selection.canvasSize[1])return selection.inverted?0:1
 const amount=selection.feather??Math.max(0,...selection.shapes.map(shape=>shape.feather))
 if(!amount)return selectionHardPixelCoverage(selection,x,y)
 const cached=softCoverage(selection),ix=Math.floor(x-cached.left),iy=Math.floor(y-cached.top)
 if(ix<0||iy<0||ix>=cached.width||iy>=cached.height)return selection.inverted?1:0
 return cached.coverage[iy*cached.width+ix]/255
}
