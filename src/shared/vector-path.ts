import {z} from 'zod'
import {EditorError} from './errors'
import {LIMITS} from './limits'
import type {Selection} from './pixel-contracts'
export type VectorPoint=[number,number]
const point=z.tuple([z.number().finite().min(-1_000_000).max(1_000_000),z.number().finite().min(-1_000_000).max(1_000_000)])
const id=z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/)
export const vectorKnotSchema=z.object({id,point,inHandle:point.optional(),outHandle:point.optional()}).strict()
export const vectorPathSchema=z.object({fillRule:z.enum(['nonzero','evenodd']).default('nonzero'),subpaths:z.array(z.object({id,closed:z.boolean(),knots:z.array(vectorKnotSchema).min(1).max(4096)}).strict()).max(64)}).strict().superRefine((path,ctx)=>{
 const ids=path.subpaths.flatMap(subpath=>[subpath.id,...subpath.knots.map(knot=>knot.id)])
 if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',message:'Vector path IDs must be unique.'})
 if(path.subpaths.reduce((sum,subpath)=>sum+subpath.knots.length,0)>4096)ctx.addIssue({code:'custom',message:'Vector paths support at most 4096 knots.'})
 if(path.subpaths.some(subpath=>subpath.closed&&subpath.knots.length<2))ctx.addIssue({code:'custom',message:'A closed subpath requires at least two knots.'})
})
export const storedVectorPathsSchema=z.array(z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(256),path:vectorPathSchema}).strict()).max(64).refine(paths=>new Set(paths.map(path=>path.id)).size===paths.length,{message:'Document vector path IDs must be unique.'})
export const vectorMaskSchema=z.object({pathId:z.string().min(1).max(80),path:vectorPathSchema}).strict()
export type VectorKnot=z.infer<typeof vectorKnotSchema>
export type VectorPath=z.infer<typeof vectorPathSchema>
export interface FlattenedSubpath {id:string;closed:boolean;points:VectorPoint[]}
export function validateVectorPath(input:unknown):VectorPath{return vectorPathSchema.parse(input)}
const midpoint=(a:VectorPoint,b:VectorPoint):VectorPoint=>[(a[0]+b[0])/2,(a[1]+b[1])/2]
export function cubicVectorPoint(a:VectorPoint,b:VectorPoint,c:VectorPoint,d:VectorPoint,t:number):VectorPoint {
 if(!Number.isFinite(t)||t<0||t>1)throw new EditorError('INVALID_ARGUMENT','Cubic path parameter must be in 0..1.')
 const u=1-t;return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]]
}
function distanceToSegment(p:VectorPoint,a:VectorPoint,b:VectorPoint):number {
 const x=b[0]-a[0],y=b[1]-a[1],square=x*x+y*y,t=square?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*y)/square)):0
 return Math.hypot(p[0]-a[0]-t*x,p[1]-a[1]-t*y)
}
/** Adaptive de Casteljau flattening, measured in document pixels. Bound both
 * curve error and subdivisions; collinear overshoot is not treated as flat. */
export function flattenVectorPath(input:VectorPath,tolerance=.25,maximumPoints=100_000):FlattenedSubpath[] {
 const path=validateVectorPath(input)
 if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>10||!Number.isSafeInteger(maximumPoints)||maximumPoints<2||maximumPoints>100_000)throw new EditorError('INVALID_ARGUMENT','Invalid vector path flattening limits.')
 let count=0
 return path.subpaths.map(subpath=>{
  const points:VectorPoint[]=[]
  const append=(p:VectorPoint)=>{if(++count>maximumPoints)throw new EditorError('RESOURCE_LIMIT','Vector path flattening exceeds its point budget.');points.push([...p])}
  append(subpath.knots[0].point)
  const segment=(a:VectorPoint,b:VectorPoint,c:VectorPoint,d:VectorPoint,depth=0)=>{
   if(Math.max(distanceToSegment(b,a,d),distanceToSegment(c,a,d))<=tolerance){append(d);return}
   if(depth>=20)throw new EditorError('RESOURCE_LIMIT','Vector path curvature exceeds the supported flattening depth.')
   const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),middle=midpoint(abc,bcd)
   segment(a,ab,abc,middle,depth+1);segment(middle,bcd,cd,d,depth+1)
  }
  const edges=subpath.closed?subpath.knots.length:subpath.knots.length-1
  for(let i=0;i<edges;i++){const a=subpath.knots[i],b=subpath.knots[(i+1)%subpath.knots.length];if(a.outHandle||b.inHandle)segment(a.point,a.outHandle??a.point,b.inHandle??b.point,b.point);else append(b.point)}
  return {id:subpath.id,closed:subpath.closed,points}
 })
}
export function vectorPathSVG(input:VectorPath):string {
 const path=validateVectorPath(input),p=(point:VectorPoint)=>point.join(' ')
 return path.subpaths.map(subpath=>{
  const commands=[`M ${p(subpath.knots[0].point)}`],edges=subpath.closed?subpath.knots.length:subpath.knots.length-1
  for(let i=0;i<edges;i++){const a=subpath.knots[i],b=subpath.knots[(i+1)%subpath.knots.length];if(a.outHandle||b.inHandle)commands.push(`C ${p(a.outHandle??a.point)} ${p(b.inHandle??b.point)} ${p(b.point)}`);else if(i<subpath.knots.length-1)commands.push(`L ${p(b.point)}`)}
  if(subpath.closed)commands.push('Z');return commands.join(' ')
 }).join(' ')
}
/** Affine coordinate changes preserve cubic control geometry. Projective
 * mappings need rational curves and must not use this helper as exact math. */
export function mapVectorPath(input:VectorPath,pointMapper:(point:VectorPoint)=>VectorPoint):VectorPath {
 const path=validateVectorPath(input)
 for(const subpath of path.subpaths)for(const knot of subpath.knots){knot.point=pointMapper([...knot.point]);if(knot.inHandle)knot.inHandle=pointMapper([...knot.inHandle]);if(knot.outHandle)knot.outHandle=pointMapper([...knot.outHandle])}
 return validateVectorPath(path)
}
export function moveVectorKnot(input:VectorPath,knotId:string,point:VectorPoint):VectorPath {
 const path=validateVectorPath(input),knot=path.subpaths.flatMap(subpath=>subpath.knots).find(knot=>knot.id===knotId)
 if(!knot)throw new EditorError('INVALID_ARGUMENT','The path knot is unavailable.')
 const delta:VectorPoint=[point[0]-knot.point[0],point[1]-knot.point[1]];knot.point=[...point]
 for(const key of ['inHandle','outHandle'] as const)if(knot[key])knot[key]=[knot[key]![0]+delta[0],knot[key]![1]+delta[1]]
 return validateVectorPath(path)
}
export function deleteVectorKnot(input:VectorPath,knotId:string):VectorPath {
 const path=validateVectorPath(input);let found=false
 path.subpaths=path.subpaths.map(subpath=>{const knots=subpath.knots.filter(knot=>{if(knot.id===knotId){found=true;return false}return true});return {...subpath,knots,closed:subpath.closed&&knots.length>=2}}).filter(subpath=>subpath.knots.length)
 if(!found)throw new EditorError('INVALID_ARGUMENT','The path knot is unavailable.')
 return validateVectorPath(path)
}
/** Split an existing cubic exactly; adding a node need not alter the curve. */
export function splitVectorSegment(input:VectorPath,subpathId:string,afterKnotId:string,t:number,newId:string):VectorPath {
 const path=validateVectorPath(input),subpath=path.subpaths.find(subpath=>subpath.id===subpathId),index=subpath?.knots.findIndex(knot=>knot.id===afterKnotId)??-1
 if(!subpath||index<0||!subpath.closed&&index===subpath.knots.length-1||!Number.isFinite(t)||t<=0||t>=1)throw new EditorError('INVALID_ARGUMENT','Choose an existing path segment and an interior split parameter.')
 const a=subpath.knots[index],b=subpath.knots[(index+1)%subpath.knots.length],lerp=(x:VectorPoint,y:VectorPoint):VectorPoint=>[x[0]+(y[0]-x[0])*t,x[1]+(y[1]-x[1])*t],ab=lerp(a.point,a.outHandle??a.point),bc=lerp(a.outHandle??a.point,b.inHandle??b.point),cd=lerp(b.inHandle??b.point,b.point),abc=lerp(ab,bc),bcd=lerp(bc,cd),point=lerp(abc,bcd)
 a.outHandle=ab;b.inHandle=cd;subpath.knots.splice(index+1,0,{id:newId,point,inHandle:abc,outHandle:bcd});return validateVectorPath(path)
}
export function setVectorKnotHandle(input:VectorPath,knotId:string,key:'inHandle'|'outHandle',point:VectorPoint|undefined,symmetric=false):VectorPath {
 const path=validateVectorPath(input),knot=path.subpaths.flatMap(subpath=>subpath.knots).find(knot=>knot.id===knotId)
 if(!knot)throw new EditorError('INVALID_ARGUMENT','The path knot is unavailable.')
 if(point)knot[key]=[...point];else delete knot[key]
 const other=key==='inHandle'?'outHandle':'inHandle'
 if(symmetric){if(point)knot[other]=[2*knot.point[0]-point[0],2*knot.point[1]-point[1]];else delete knot[other]}
 return validateVectorPath(path)
}
/** Fill/selection closes open contours by a straight edge, like SVG fill. Four
 * subscanlines and analytic horizontal coverage avoid allocating a 4x image. */
export function rasterizeVectorPath(input:VectorPath,width:number,height:number,antialiased=true):Uint8Array {
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Vector path raster dimensions exceed the canvas budget.')
 const flattened=flattenVectorPath(input),edges:VectorPoint[][]=[]
 for(const subpath of flattened){const points=subpath.points;if(points.length<3)continue;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(a[1]!==b[1])edges.push([a,b])}}
 const samples=antialiased?4:1
 if(height*samples*edges.length+width*height*samples>80_000_000)throw new EditorError('RESOURCE_LIMIT','Vector path fill exceeds its scan conversion work budget.')
 const output=new Uint8Array(width*height),rule=input.fillRule
 for(let y=0;y<height;y++)for(let sample=0;sample<samples;sample++){
  const sy=y+(sample+.5)/samples,intersections:{x:number;delta:number}[]=[]
  for(const [a,b] of edges)if(sy>=Math.min(a[1],b[1])&&sy<Math.max(a[1],b[1]))intersections.push({x:a[0]+(sy-a[1])*(b[0]-a[0])/(b[1]-a[1]),delta:b[1]>a[1]?1:-1})
  intersections.sort((a,b)=>a.x-b.x);let winding=0
  for(let i=0;i<intersections.length-1;i++){
   winding=rule==='evenodd'?1-winding:winding+intersections[i].delta;if(!winding)continue
   const first=Math.max(0,Math.ceil(intersections[i].x*samples-.5)),end=Math.min(width*samples,Math.ceil(intersections[i+1].x*samples-.5))
   for(let x=Math.floor(first/samples);x<Math.ceil(end/samples);x++)output[y*width+x]+=Math.max(0,Math.min(end,(x+1)*samples)-Math.max(first,x*samples))
  }
 }
 for(let i=0;i<output.length;i++)output[i]=Math.round(output[i]*255/(samples*samples))
 return output
}
export function vectorPathSelection(input:VectorPath,width:number,height:number,antialiased=true):Selection['shapes'][number] {
 const coverage=rasterizeVectorPath(input,width,height,antialiased),runs:[number,number,number,number][]=[]
 for(let y=0;y<height;y++)for(let x=0;x<width;){const start=x,value=coverage[y*width+x++];while(x<width&&coverage[y*width+x]===value)x++;if(value)runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','Vector path selection exceeds its coverage run budget.')}
 return {kind:'raster',bounds:[0,0,width,height],operation:'replace',feather:0,raster:{width,height,transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false},runs}}
}
