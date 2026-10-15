/** Color-constrained erasing. This is an alpha edit, not background color
 * decontamination or a claim of Photoshop's undocumented matching algorithm. */
import {EditorError} from '../shared/errors'
import type {Layer} from '../shared/contracts'
import type {RGBA,Selection} from '../shared/pixel-contracts'
import {sourcePoint,selectionCoverage} from '../shared/selection-coverage'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {brushStrokeExtentDiameter,prepareBrushStroke} from '../shared/brush-dynamics'
import {strokeSegments,type StrokePoint} from '../shared/stroke-compaction'
import {magicEraseColorTables,magicEraseColorScore,magicEraseAntialiasCoverage} from '../shared/magic-erase-antialias'
export type ColorEraseData=Uint8Array|Uint16Array|Float32Array
export interface ColorEraseImage<T extends ColorEraseData=ColorEraseData>{width:number;height:number;data:T}
export interface ColorEraseContext {transform:Layer['transform'];selection?:Selection|null;canvasSize?:[number,number]}
export interface ColorEraseOptions {signal?:AbortSignal;maximumWork?:number}
export interface BackgroundEraseParams {points:StrokePoint[];size:number;hardness:number;opacity:number;tolerance:number;sampling:'continuous'|'once'|'background';limits:'contiguous'|'discontiguous'|'find-edges';protectForeground:boolean;foreground:RGBA;background:RGBA;sampleAllLayers?:boolean;smoothing?:number;brushModel?:'photoshop'|'compositor'}
export interface MagicEraseParams {point:StrokePoint;tolerance:number;contiguous:boolean;antialiased:boolean;opacity:number;sampleImage?:ColorEraseImage<Uint8Array>}
export interface ColorEraseResult<T extends ColorEraseData=ColorEraseData>{data:T;affectedPixels:number;work:number;documentCoverage?:{width:number;height:number;coverage:Float32Array;beforeSelectionAndOpacity:true}}
export const COLOR_ERASE_LIMITS={pixels:16_000_000,work:120_000_000,workingBytes:512*1024*1024} as const
const invalid=(message:string):never=>{throw new EditorError('INVALID_ARGUMENT',message)}
const resource=():never=>{throw new EditorError('RESOURCE_LIMIT','Color Erase exceeds its 16 MP, 120 million work or 512 MiB budget.')}
const checkCanceled=(options:ColorEraseOptions)=>{if(options.signal?.aborted)throw new EditorError('CANCELED','Color Erase was canceled.')}
function finite(value:number,lo:number,hi:number,name:string){if(!Number.isFinite(value)||value<lo||value>hi)invalid(`Invalid Color Erase ${name}.`)}
function point(p:StrokePoint){if(!Array.isArray(p)||p.length!==2)invalid('Invalid Color Erase point.');for(const v of p)finite(v,-1_000_000,1_000_000,'point')}
function checkImage(image:ColorEraseImage){const n=image.width*image.height;if(!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1||image.width>30000||image.height>30000||n>COLOR_ERASE_LIMITS.pixels)resource();if(!(image.data instanceof Uint8Array||image.data instanceof Uint16Array||image.data instanceof Float32Array)||image.data.length!==n*4)invalid('Color Erase requires a dense RGBA raster.');return n}
function checkContext(context:ColorEraseContext){const t=context.transform;if(!t||t.origin?.length!==2||t.size?.length!==2)invalid('Invalid Color Erase placement.');for(const v of t.origin)finite(v,-1_000_000,1_000_000,'origin');for(const v of t.size)finite(v,1,300_000,'size');finite(t.rotation,-1_000_000,1_000_000,'rotation');if(typeof t.flipX!=='boolean'||typeof t.flipY!=='boolean')invalid('Invalid Color Erase placement flags.');if(context.canvasSize){if(context.canvasSize.length!==2)invalid('Invalid Color Erase canvas size.');for(const v of context.canvasSize)finite(v,1,30000,'canvas size')}}
function clone<T extends ColorEraseData>(data:T):T{return (data instanceof Float32Array?new Float32Array(data):data instanceof Uint16Array?new Uint16Array(data):new Uint8Array(data)) as T}
/** Includes existing source backing stores, one target clone, flood/AA buffers
 * and shared brush density. Pure arithmetic permits giant-image budget tests. */
export function colorEraseWorkingBytes(targetPixels:number,samplingPixels:number,bytesPerSample:1|2|4,background=false):number{return targetPixels*8*bytesPerSample+samplingPixels*11+(background?targetPixels*5:0)}
function budget(image:ColorEraseImage,context:ColorEraseContext,options:ColorEraseOptions,domain=image,background=false){
 checkCanceled(options);const n=checkImage(image),m=checkImage(domain);checkContext(context)
 const max=options.maximumWork??COLOR_ERASE_LIMITS.work;finite(max,0,COLOR_ERASE_LIMITS.work,'work budget')
 const retained=image.data.buffer.byteLength+(image.data.buffer===domain.data.buffer?0:domain.data.buffer.byteLength),buffers=n*image.data.BYTES_PER_ELEMENT*4+m*11+(background?n*5:0)
 if(retained+buffers>COLOR_ERASE_LIMITS.workingBytes)resource()
 let work=0,reserved=0;return {n,m,reserve(bytes:number){reserved+=bytes;if(retained+buffers+reserved>COLOR_ERASE_LIMITS.workingBytes)resource()},tick(amount=1){work+=amount;if(work>max)resource();checkCanceled(options)},get work(){return work}}
}
function documentPoint(context:ColorEraseContext,x:number,y:number,width:number,height:number):StrokePoint{const t=context.transform,a=t.rotation*Math.PI/180,u=(x/width-.5)*t.size[0]*(t.flipX?-1:1),v=(y/height-.5)*t.size[1]*(t.flipY?-1:1);return [t.origin[0]+t.size[0]/2+u*Math.cos(a)-v*Math.sin(a),t.origin[1]+t.size[1]/2+u*Math.sin(a)+v*Math.cos(a)]}
const inCanvas=(context:ColorEraseContext,p:StrokePoint)=>!context.canvasSize||p[0]>=0&&p[1]>=0&&p[0]<context.canvasSize[0]&&p[1]<context.canvasSize[1]
function straight(image:ColorEraseImage,index:number):number[]|null{const at=index*4,alpha=image.data[at+3];if(!Number.isFinite(alpha)||alpha<0)invalid('Invalid Color Erase alpha.');if(!alpha)return null;const maximum=image.data instanceof Float32Array?1:image.data instanceof Uint16Array?65535:255;if(alpha>maximum)invalid('Invalid Color Erase alpha.');const color=[0,1,2].map(c=>image.data instanceof Uint8Array?image.data[at+c]:image.data[at+c]/alpha*255);if(color.some(v=>!Number.isFinite(v)))invalid('Invalid Color Erase color.');return color}
function colorAt(image:ColorEraseImage,p:StrokePoint){const x=Math.floor(p[0]),y=Math.floor(p[1]);return x<0||y<0||x>=image.width||y>=image.height?null:straight(image,y*image.width+x)}
const distance=(a:number[],b:number[])=>Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]),Math.abs(a[2]-b[2]))
function flood(matches:Uint8Array,width:number,height:number,seeds:number[],tick:(n?:number)=>void):Uint8Array{
 const output=new Uint8Array(matches.length),queue=new Uint32Array(matches.length);let head=0,tail=0
 for(const p of seeds){tick();if(p>=0&&p<matches.length&&matches[p]&&!output[p]){output[p]=255;queue[tail++]=p}}
 while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);for(const q of [x? p-1:-1,x+1<width?p+1:-1,y?p-width:-1,y+1<height?p+width:-1]){tick();if(q>=0&&matches[q]&&!output[q]){output[q]=255;queue[tail++]=q}}}return output
}
function erase<T extends ColorEraseData>(image:ColorEraseImage<T>,context:ColorEraseContext,coverage:(x:number,y:number,p:number)=>number,opacity:number,state:ReturnType<typeof budget>):ColorEraseResult<T>{
 const output=clone(image.data);let affectedPixels=0
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){state.tick();const p=y*image.width+x,at=p*4;if(!image.data[at+3])continue;const doc=documentPoint(context,x+.5,y+.5,image.width,image.height);if(!inCanvas(context,doc))continue
  const amount=Math.max(0,Math.min(1,coverage(x,y,p)))*selectionCoverage(context.selection??null,...doc)*opacity;if(!amount)continue;const keep=1-amount,alpha=image.data[at+3]*keep
  output[at+3]=image.data instanceof Float32Array?Math.fround(alpha):Math.round(alpha)
  for(let c=0;c<3;c++)output[at+c]=!output[at+3]?0:image.data instanceof Uint8Array?image.data[at+c]:image.data instanceof Float32Array?Math.fround(image.data[at+c]*keep):Math.round(image.data[at+c]*keep)
  if([0,1,2,3].some(c=>output[at+c]!==image.data[at+c]))affectedPixels++
 }return {data:output,affectedPixels,work:state.work}
}
export function backgroundErasePixels<T extends ColorEraseData>(image:ColorEraseImage<T>,context:ColorEraseContext,params:BackgroundEraseParams,options:ColorEraseOptions={}):ColorEraseResult<T>{
 const state=budget(image,context,options,image,true);if(params.limits==='find-edges')throw new EditorError('UNSUPPORTED_FEATURE','Find Edges Background Eraser is not implemented; use Contiguous or Discontiguous.');if(params.sampleAllLayers)throw new EditorError('UNSUPPORTED_FEATURE','Background Eraser currently samples only the target source layer.')
 if(!['continuous','once','background'].includes(params.sampling)||!['contiguous','discontiguous'].includes(params.limits))invalid('Invalid Background Eraser mode.')
 if(typeof params.protectForeground!=='boolean')invalid('Invalid Background Eraser protection flag.')
 finite(params.size,1,4096,'brush size');finite(params.hardness,0,1,'hardness');finite(params.opacity,0,1,'opacity');finite(params.tolerance,0,255,'tolerance');finite(params.smoothing??0,0,5000,'smoothing');if(params.brushModel!==undefined&&!['photoshop','compositor'].includes(params.brushModel))invalid('Invalid Background Eraser brush model.');for(const color of [params.foreground,params.background]){if(color?.length!==4)invalid('Invalid Background Eraser color.');for(const v of color)finite(v,0,1,'color')}
 if(!Array.isArray(params.points)||!params.points.length||params.points.length>100_000)invalid('Invalid Background Eraser stroke.');params.points.forEach(point)
 if(!params.opacity)return {data:clone(image.data),affectedPixels:0,work:state.work}
 // Reserve the shared helpers' maximum segment storage before preparation.
 // Compaction has a bounded eight-million scan budget and is performed twice
 // (preparation and the coverage helper); charge both before synchronous work.
 state.reserve(params.points.length*96+200_000*128)
 state.tick(params.points.length*4+2*Math.min(8_000_000,params.points.length*Math.max(0,params.points.length-2)))
 const points=prepareBrushStroke(params.points,params.size,params.smoothing??0).points
 if(params.brushModel==='photoshop'){let length=0;for(let i=1;i<points.length;i++)length+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);if(Math.ceil(length/Math.max(.25,Math.fround(params.size*.25)))+1>200_000)resource()}
 let segments:ReturnType<typeof strokeSegments>
 try{segments=strokeSegments(points,Math.max(8,params.size))}catch(error){if(error instanceof Error&&error.message==='Stroke path exceeds its geometry budget.')resource();throw error}
 state.tick(segments.length)
 const reference=params.sampling==='background'?params.background.slice(0,3).map(v=>v*255):colorAt(image,sourcePoint({transform:context.transform},...points[0],image.width,image.height)),foreground=params.foreground.slice(0,3).map(v=>v*255)
 if(params.sampling!=='continuous'&&!reference)return {data:clone(image.data),affectedPixels:0,work:state.work}
 const extent=brushStrokeExtentDiameter(params.size,params.hardness,{brushModel:params.brushModel})/2+2,rx=extent*image.width/context.transform.size[0]+2,ry=extent*image.height/context.transform.size[1]+2
 let estimate=state.n
 for(const [ax,ay,bx,by]of segments){const a=sourcePoint({transform:context.transform},ax,ay,image.width,image.height),b=sourcePoint({transform:context.transform},bx,by,image.width,image.height),area=Math.max(0,Math.min(image.width,Math.ceil(Math.max(a[0],b[0])+rx))-Math.max(0,Math.floor(Math.min(a[0],b[0])-rx)))*Math.max(0,Math.min(image.height,Math.ceil(Math.max(a[1],b[1])+ry))-Math.max(0,Math.floor(Math.min(a[1],b[1])-ry)));estimate+=area*(params.brushModel==='photoshop'?Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)/Math.max(.25,params.size*.25))+1):params.hardness<1?16:1)}
 state.tick(estimate);let brush:Uint8Array
 try{brush=brushStrokeCoverage({width:image.width,height:image.height,transform:context.transform,...(context.canvasSize?{canvasWidth:context.canvasSize[0],canvasHeight:context.canvasSize[1]}:{})},points,params.size,params.hardness,{brushModel:params.brushModel})}catch(error){if(error instanceof Error&&(error.message==='Brush coverage exceeds the compute budget; use shorter strokes.'||error.message==='Stroke path exceeds its geometry budget.'))resource();throw error}
 checkCanceled(options)
 const matches=new Uint8Array(state.n)
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){state.tick();const p=y*image.width+x;if(!brush[p])continue;const doc=documentPoint(context,x+.5,y+.5,image.width,image.height);if(!inCanvas(context,doc)||!selectionCoverage(context.selection??null,...doc))continue;const color=straight(image,p);if(!color)continue;let sample=reference
  if(params.sampling==='continuous'){let best=Infinity,nearest:StrokePoint=points[0];for(const [ax,ay,bx,by]of segments){state.tick();const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((doc[0]-ax)*dx+(doc[1]-ay)*dy)/Math.max(1e-12,dx*dx+dy*dy))),q:StrokePoint=[ax+t*dx,ay+t*dy],d=(doc[0]-q[0])**2+(doc[1]-q[1])**2;if(d<best){best=d;nearest=q}}sample=colorAt(image,sourcePoint({transform:context.transform},...nearest,image.width,image.height))}
  if(!sample)continue;const diff=distance(color,sample);if(diff<=params.tolerance&&(!params.protectForeground||distance(color,foreground)>diff))matches[p]=255
 }
 const seeds=points.map(p=>{const [x,y]=sourcePoint({transform:context.transform},...p,image.width,image.height),ix=Math.floor(x),iy=Math.floor(y);return ix<0||iy<0||ix>=image.width||iy>=image.height?-1:iy*image.width+ix}),region=params.limits==='contiguous'?flood(matches,image.width,image.height,seeds,state.tick):matches
 return erase(image,context,(_x,_y,p)=>region[p]?brush[p]/255:0,params.opacity,state)
}
function bilinearColor(image:ColorEraseImage,u:number,v:number,tick:(n?:number)=>void):number[]|null{const x=Math.floor(u-.5),y=Math.floor(v-.5),tx=u-.5-x,ty=v-.5-y,result=[0,0,0];let total=0
 for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){tick();const sx=x+xx,sy=y+yy;if(sx<0||sy<0||sx>=image.width||sy>=image.height)continue;const i=sy*image.width+sx,color=straight(image,i);if(!color)continue;const alpha=image.data[i*4+3]/(image.data instanceof Float32Array?1:image.data instanceof Uint16Array?65535:255),weight=(xx?tx:1-tx)*(yy?ty:1-ty)*alpha;total+=weight;for(let c=0;c<3;c++)result[c]+=color[c]*weight}return total?result.map(v=>v/total):null
}
export function magicErasePixels<T extends ColorEraseData>(image:ColorEraseImage<T>,context:ColorEraseContext,params:MagicEraseParams,options:ColorEraseOptions={}):ColorEraseResult<T>{
 const domain=params.sampleImage??image,state=budget(image,context,options,domain);finite(params.tolerance,0,255,'tolerance');finite(params.opacity,0,1,'opacity');point(params.point);if(typeof params.contiguous!=='boolean'||typeof params.antialiased!=='boolean')invalid('Invalid Magic Eraser flags.');if(params.sampleImage&&!(domain.data instanceof Uint8Array))invalid('Merged Magic Eraser samples require document-grid RGBA8.')
 if(params.sampleImage&&context.canvasSize&&(domain.width!==context.canvasSize[0]||domain.height!==context.canvasSize[1]))invalid('Merged Magic Eraser sample dimensions must match the document grid.')
 if(!params.opacity||!inCanvas(context,params.point))return {data:clone(image.data),affectedPixels:0,work:state.work}
 const seedPoint=params.sampleImage?params.point:sourcePoint({transform:context.transform},...params.point,image.width,image.height),reference=colorAt(domain,seedPoint)
 if(!reference)return {data:clone(image.data),affectedPixels:0,work:state.work}
 // The measured native model is RGB8 current-layer AA with integer tolerance.
 // Keep merged, high-depth, fractional-tolerance and AA-off routes compatible.
 const nativeAA=params.antialiased&&!params.sampleImage&&image.data instanceof Uint8Array&&Number.isInteger(params.tolerance)
 if(nativeAA)state.reserve(1536+128*4)
 const tables=nativeAA?magicEraseColorTables(reference,params.tolerance):undefined,scores=nativeAA?new Uint8Array(state.m):undefined
 const docAt=(x:number,y:number):StrokePoint=>params.sampleImage?[x,y]:documentPoint(context,x,y,image.width,image.height),matches=new Uint8Array(state.m);let matched=0
 for(let y=0;y<domain.height;y++)for(let x=0;x<domain.width;x++){state.tick();const p=y*domain.width+x,doc=docAt(x+.5,y+.5);if(scores){state.tick(6);scores[p]=magicEraseColorScore(tables!,domain.data[p*4],domain.data[p*4+1],domain.data[p*4+2])}if(!inCanvas(context,doc)||!selectionCoverage(context.selection??null,...doc))continue;const color=straight(domain,p);if(color&&(scores?scores[p]===127:distance(color,reference)<=params.tolerance)){matches[p]=255;matched++}}
 const sx=Math.floor(seedPoint[0]),sy=Math.floor(seedPoint[1]),region=params.contiguous?flood(matches,domain.width,domain.height,[sy*domain.width+sx],state.tick):matches,coverage=new Float32Array(state.m)
 if(scores)magicEraseAntialiasCoverage(region,scores,domain.width,domain.height,coverage,state.tick)
 else for(let y=0;y<domain.height;y++)for(let x=0;x<domain.width;x++){state.tick();const p=y*domain.width+x;if(!region[p])continue;if(!params.antialiased||matched===state.m){coverage[p]=1;continue}
  // Four subpixel color tests soften only the accepted connected region;
  // they must not create a new matching island across a foreground barrier.
  // This is a bounded inward antialias approximation, not PS decontamination.
  let selected=0;for(const dy of [.25,.75])for(const dx of [.25,.75]){const color=bilinearColor(domain,x+dx,y+dy,state.tick);if(color&&distance(color,reference)<=params.tolerance)selected++}coverage[p]=selected/4
 }
 const result=erase(image,context,(x,y,p)=>{if(!params.sampleImage)return coverage[p];const doc=documentPoint(context,x+.5,y+.5,image.width,image.height),dx=Math.floor(doc[0]),dy=Math.floor(doc[1]);return dx<0||dy<0||dx>=domain.width||dy>=domain.height?0:coverage[dy*domain.width+dx]},params.opacity,state)
 if(params.sampleImage)result.documentCoverage={width:domain.width,height:domain.height,coverage,beforeSelectionAndOpacity:true}
 return result
}
