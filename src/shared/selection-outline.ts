import {selectionGeometryBounds} from './selection-bounds'
import {selectionGeometryCoverage,sourcePoint} from './selection-coverage'
import type {Selection} from './pixel-contracts'
import {LIMITS} from './limits'

type Raster = NonNullable<Selection['shapes'][number]['raster']>
type Interval = [number, number]
type Edge = {x:number;y:number;endX:number;endY:number;direction:number;used?:boolean}
const cached = new WeakMap<object,string>()

function merge(intervals:Interval[]):Interval[] {
  intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  const result:Interval[]=[]
  for(const interval of intervals){const last=result.at(-1);if(last&&interval[0]<=last[1])last[1]=Math.max(last[1],interval[1]);else result.push([...interval])}
  return result
}

/** Parts of a row which have no selected neighbour above/below it. */
function exposed(row:Interval[],neighbours:Interval[]):Interval[] {
  const result:Interval[]=[];let neighbour=0
  for(const [start,end] of row){let x=start;while(neighbour<neighbours.length&&neighbours[neighbour][1]<=x)neighbour++
    let index=neighbour
    while(index<neighbours.length&&neighbours[index][0]<end){const [a,b]=neighbours[index];if(a>x)result.push([x,Math.min(a,end)]);x=Math.max(x,b);if(x>=end)break;index++}
    if(x<end)result.push([x,end])
  }
  return result
}

/**
 * Exact pixel-edge contours of nonzero RLE coverage, in the raster's local grid.
 * Shared scanline edges are removed; holes retain the opposite winding. No
 * width × height bitmap is allocated, and no first-N-run visual truncation is used.
 * Apply rasterSelectionMatrix separately to display a transformed selection.
 */
export function rasterSelectionOutline(raster:Raster):string {
  const previous=cached.get(raster);if(previous!==undefined)return previous
  if(raster.width>LIMITS.maxSide||raster.height>LIMITS.maxSide||raster.runs.length>100_000)throw new Error('Selection outline exceeds the resource budget.')
  const rows=new Map<number,Interval[]>()
  for(const [y,x,length,value] of raster.runs){
    if(value<=0||y<0||y>=raster.height)continue
    const start=Math.max(0,x),end=Math.min(raster.width,x+length);if(end<=start)continue
    const row=rows.get(y)??[];row.push([start,end]);rows.set(y,row)
  }
  for(const [y,row] of rows)rows.set(y,merge(row))
  const edges:Edge[]=[],outgoing=new Map<string,number[]>()
  function edge(x:number,y:number,endX:number,endY:number,direction:number):void {
    const key=`${x},${y}`,indices=outgoing.get(key)??[];indices.push(edges.length);outgoing.set(key,indices);edges.push({x,y,endX,endY,direction})
  }
  for(const [y,row] of rows){
    for(const [start,end] of exposed(row,rows.get(y-1)??[]))edge(start,y,end,y,0)
    for(const [start,end] of exposed(row,rows.get(y+1)??[]))edge(end,y+1,start,y+1,2)
    for(const [start,end] of row){edge(end,y,end,y+1,1);edge(start,y+1,start,y,3)}
  }
  const paths:string[]=[]
  for(const first of edges){if(first.used)continue
    const points:Array<[number,number]>=[[first.x,first.y]];let current=first
    while(!current.used){current.used=true;points.push([current.endX,current.endY]);if(current.endX===first.x&&current.endY===first.y)break
      const candidates=(outgoing.get(`${current.endX},${current.endY}`)??[]).map(index=>edges[index]).filter(item=>!item.used)
      // At diagonal pixel contacts, turn right to trace separate components.
      const rank=(direction:number)=>{const turn=(direction-current.direction+4)%4;return turn===1?0:turn===0?1:turn===3?2:3}
      candidates.sort((a,b)=>rank(a.direction)-rank(b.direction));if(!candidates.length)break;current=candidates[0]
    }
    // Collapse consecutive collinear scanline edges into one SVG command.
    const compact:Array<[number,number]>=[]
    for(const point of points){const a=compact.at(-2),b=compact.at(-1);if(a&&b&&((a[0]===b[0]&&b[0]===point[0])||(a[1]===b[1]&&b[1]===point[1])))compact[compact.length-1]=point;else compact.push(point)}
    let path=`M${compact[0][0]} ${compact[0][1]}`
    for(let i=1;i<compact.length;i++){const a=compact[i-1],b=compact[i];path+=a[1]===b[1]?`H${b[0]}`:`V${b[1]}`}
    paths.push(`${path}Z`)
  }
  const path=paths.join('');cached.set(raster,path);return path
}

const outlineRasterRows=new WeakMap<Raster,Map<number,Raster['runs']>>()
const compositeCached=new WeakMap<Selection,{width:number;height:number;path:string}>()
function intersectIntervals(a:Interval[],b:Interval[]):Interval[]{const out:Interval[]=[];let i=0,j=0;while(i<a.length&&j<b.length){const left=Math.max(a[i][0],b[j][0]),right=Math.min(a[i][1],b[j][1]);if(left<right)out.push([left,right]);if(a[i][1]<b[j][1])i++;else j++}return out}
function rowIntervals(shape:Selection['shapes'][number],y:number,width:number):Interval[] {
 const [left,top,w,h]=shape.bounds,cy=y+.5
 const interval=(a:number,b:number,inclusive=false):Interval[]=>{const x=Math.max(0,Math.ceil(a-.5)),end=Math.min(width,inclusive?Math.floor(b-.5)+1:Math.ceil(b-.5));return end>x?[[x,end]]:[]}
 if(shape.kind==='rectangle')return cy>=top&&cy<top+h?interval(left,left+w):[]
 if(shape.kind==='ellipse'){const dy=(cy-top-h/2)/Math.max(.001,h/2);if(Math.abs(dy)>1)return [];const dx=w/2*Math.sqrt(Math.max(0,1-dy*dy));return interval(left+w/2-dx,left+w/2+dx,true)}
 if(shape.kind==='polygon'){if(cy<top||cy>=top+h)return [];const xs:number[]=[],points=shape.points!;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>cy)!==(b[1]>cy))xs.push(a[0]+(b[0]-a[0])*(cy-a[1])/(b[1]-a[1]))}xs.sort((a,b)=>a-b);const out:Interval[]=[];for(let i=0;i+1<xs.length;i+=2)out.push(...interval(xs[i],xs[i+1]));return merge(out)}
 const raster=shape.raster!,t=raster.transform
 if(t.rotation===0){const sy=Math.floor(sourcePoint({transform:{...t,sampling:'Nearest'}},0,cy,raster.width,raster.height)[1]);if(sy<0||sy>=raster.height)return []
  let rows=outlineRasterRows.get(raster);if(!rows){rows=new Map();for(const run of raster.runs){const entries=rows.get(run[0])??[];entries.push(run);rows.set(run[0],entries)}outlineRasterRows.set(raster,rows)}
  const out:Interval[]=[];for(const [,x,n,value] of rows.get(sy)??[])if(value>=128){const a=t.origin[0]+t.size[0]*(t.flipX?1-x/raster.width:x/raster.width),b=t.origin[0]+t.size[0]*(t.flipX?1-(x+n)/raster.width:(x+n)/raster.width);out.push(...interval(Math.min(a,b),Math.max(a,b)))}return merge(out)
 }
 // Rotated rasters use bounded document-space samples for this row only. They
 // never force scanning transparent full-width rows merely because of inverse.
 const single:Selection={shapes:[{...shape,operation:'replace'}],inverted:false},bounds=selectionGeometryBounds(single,width,LIMITS.maxSide),out:Interval[]=[]
 if(y<bounds[1]||y>=bounds[1]+bounds[3])return []
 let start=-1;for(let x=bounds[0];x<=bounds[0]+bounds[2];x++){const inside=x<bounds[0]+bounds[2]&&selectionGeometryCoverage(single,x+.5,cy)>=.5;if(inside&&start<0)start=x;else if(!inside&&start>=0){out.push([start,x]);start=-1}}return out
}
/** Final boolean geometry scanlines: wide empty canvas costs no per-pixel work.
 * Feather stays excluded because marching ants trace the outline before blur. */
export function selectionOutline(selection:Selection|null|undefined,width:number,height:number):string {
 if(!selection)return ''
 const previous=compositeCached.get(selection);if(previous?.width===width&&previous.height===height)return previous.path
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide)throw new Error('Selection outline exceeds the document coverage budget.')
 const [,top,,h]=selectionGeometryBounds(selection,width,height),runs:[number,number,number,number][]=[]
 if(selection.shapes.reduce((work,shape)=>work+(shape.kind==='polygon'?shape.points!.length*Math.min(h,Math.ceil(shape.bounds[3])+1):0),0)>80_000_000)throw new Error('Selection polygon outline exceeds the scanline work budget.')
 for(let y=top;y<top+h;y++){
  let row:Interval[]=[]
  for(const shape of selection.shapes){const next=rowIntervals(shape,y,width);row=shape.operation==='replace'?next:shape.operation==='add'?merge([...row,...next]):shape.operation==='subtract'?exposed(row,next):intersectIntervals(row,next)}
  if(selection.inverted)row=exposed([[0,width]],row)
  for(const [start,end] of row){runs.push([y,start,end-start,255]);if(runs.length>100_000)throw new Error('Selection outline exceeds the run budget.')}
 }
 const path=rasterSelectionOutline({width,height,runs,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false}})
 compositeCached.set(selection,{width,height,path});return path
}
