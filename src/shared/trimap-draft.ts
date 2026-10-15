import {EditorError} from './errors'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'
import {TRIMAP_MATTE_MAX_PEAK_BYTES,TRIMAP_MATTE_MAX_OPERATIONS} from './trimap-matte'

export interface TrimapStroke {value:0|128|255;size:number;points:[number,number][]}
export interface TrimapDraftSettings {boundaryRadius?:number;sampleRadius?:number;guidedRadius?:number;region?:[number,number,number,number];strokes?:TrimapStroke[]}
export interface NormalizedTrimapDraftSettings {boundaryRadius:number;sampleRadius:number;guidedRadius:number;region?:[number,number,number,number];strokes:TrimapStroke[]}
export interface TrimapRefinementBudget {estimatedInputBytes:number;estimatedWorkingBytes:number;estimatedPeakBytes:number;estimatedOperations:number;snapshotBytes:number}
const byteRaster=(value:unknown):boolean=>value instanceof Uint8Array||value instanceof Uint8ClampedArray
const invalid=(message:string):never=>{throw new EditorError('INVALID_ARGUMENT',message)}
function dimensions(width:number,height:number):number {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>30_000||height>30_000)invalid('Invalid trimap draft raster dimensions.')
 const count=width*height;if(count>32_000_000)throw new EditorError('RESOURCE_LIMIT','Trimap source is limited to 32 megapixels.');return count
}
/** Validates before cloning; returned settings contain no references into the
 * caller's regions, stroke objects or points. Out-of-image pointer coordinates
 * are permitted, but strokes are clipped to the explicit processing region. */
export function normalizeTrimapDraftSettings(settings:TrimapDraftSettings,width:number,height:number):NormalizedTrimapDraftSettings {
 dimensions(width,height)
 if(!settings||typeof settings!=='object'||Array.isArray(settings))invalid('Invalid trimap draft settings.')
 const boundaryRadius=settings.boundaryRadius===undefined?4:settings.boundaryRadius,sampleRadius=settings.sampleRadius===undefined?16:settings.sampleRadius,guidedRadius=settings.guidedRadius===undefined?2:settings.guidedRadius,region=settings.region,strokes=settings.strokes===undefined?[]:settings.strokes
 if(!Number.isInteger(boundaryRadius)||boundaryRadius<1||boundaryRadius>40||!Number.isInteger(sampleRadius)||sampleRadius<1||sampleRadius>64||!Number.isInteger(guidedRadius)||guidedRadius<1||guidedRadius>40)invalid('Invalid trimap draft radii.')
 if(region!==undefined&&(!Array.isArray(region)||region.length!==4||!region.every(Number.isInteger)||region[0]<0||region[1]<0||region[2]<1||region[3]<1||region[0]+region[2]>width||region[1]+region[3]>height))invalid('Trimap refinement region must lie inside the source raster.')
 if(!Array.isArray(strokes)||strokes.length>256)invalid('Trimap draft accepts at most 256 strokes.')
 let points=0
 for(const stroke of strokes){
  if(!stroke||![0,128,255].includes(stroke.value)||!Number.isFinite(stroke.size)||stroke.size<1||stroke.size>512||!Array.isArray(stroke.points)||!stroke.points.length)invalid('Invalid trimap stroke.')
  points+=stroke.points.length;if(points>10_000)invalid('Trimap draft accepts at most 10000 stroke points.')
  for(const point of stroke.points)if(!Array.isArray(point)||point.length!==2||!point.every(value=>Number.isFinite(value)&&Math.abs(value)<=1_000_000))invalid('Invalid trimap stroke point.')
 }
 return {boundaryRadius,sampleRadius,guidedRadius,region:region?[...region]:undefined,strokes:strokes.map(stroke=>({value:stroke.value,size:stroke.size,points:stroke.points.map(point=>[...point])}))}
}
function regionOf(settings:NormalizedTrimapDraftSettings,width:number,height:number):[number,number,number,number]{return settings.region??[0,0,width,height]}
function settingsBytes(settings:NormalizedTrimapDraftSettings):number{return 4096+settings.strokes.reduce((sum,stroke)=>sum+128+stroke.points.length*96,0)}
/** Liang-Barsky clips centers before interpolation, avoiding billions of
 * useless samples for a pointer trajectory far outside a small region. */
function clipSegment(a:[number,number],b:[number,number],region:[number,number,number,number],radius:number):[number,number,number,number]|undefined {
 const [x,y,w,h]=region,dx=b[0]-a[0],dy=b[1]-a[1],p=[-dx,dx,-dy,dy],q=[a[0]-x+radius,x+w+radius-a[0],a[1]-y+radius,y+h+radius-a[1]];let start=0,end=1
 for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return;continue}const t=q[i]/p[i];if(p[i]<0)start=Math.max(start,t);else end=Math.min(end,t);if(start>end)return}
 return [a[0]+start*dx,a[1]+start*dy,a[0]+end*dx,a[1]+end*dy]
}
function draftOperations(settings:NormalizedTrimapDraftSettings,width:number,height:number):number {
 const region=regionOf(settings,width,height);let work=16*width*height+settings.strokes.reduce((sum,stroke)=>sum+stroke.points.length*96,0)
 for(const stroke of settings.strokes){const step=Math.max(.5,stroke.size/4),cost=128+Math.min(region[2]*region[3],(Math.ceil(stroke.size)+2)**2),points=stroke.points
  for(let i=0;i<Math.max(1,points.length-1);i++){const segment=clipSegment(points[i],points[Math.min(points.length-1,i+1)],region,stroke.size/2);if(segment){const distance=Math.hypot(segment[2]-segment[0],segment[3]-segment[1]);work+=(Math.ceil(distance/step)+1)*cost}}
 }
 return work
}
/** Whole-operation bound: caller-retained buffers, immutable queued snapshot,
 * IPC encode/decode copies, child image/selection, draft temporaries, output
 * transport and matting workspace. Other retained jobs are charged three times
 * (parent snapshot plus possible transport/child copy), never just view bytes. */
export function estimateTrimapRefinementBudget(image:RGBAImage,selection:RasterSelection,settings:NormalizedTrimapDraftSettings,retainedSnapshotBytes=0):TrimapRefinementBudget {
 const count=dimensions(image.width,image.height)
 if(!byteRaster(image.data))invalid('Trimap guide must contain byte pixels.')
 if(!byteRaster(selection.coverage))invalid('Trimap coverage must contain byte pixels.')
 if(selection.width!==image.width||selection.height!==image.height||image.data.length!==count*4||selection.coverage.length!==count)invalid('Trimap, mask and guide must have equal byte-raster dimensions.')
 const [x,y,w,h]=regionOf(settings,image.width,image.height),halo=settings.sampleRadius+2*settings.guidedRadius,localWidth=Math.min(image.width,x+w+halo)-Math.max(0,x-halo),localHeight=Math.min(image.height,y+h+halo)-Math.max(0,y-halo),local=localWidth*localHeight,metadata=settingsBytes(settings)
 const buffers=new Set([image.data.buffer,selection.coverage.buffer]),estimatedInputBytes=[...buffers].reduce((sum,buffer)=>sum+buffer.byteLength,0),snapshotBytes=count*5+metadata,estimatedWorkingBytes=count*30+local*256+metadata*6+65_536+retainedSnapshotBytes*3,estimatedPeakBytes=estimatedInputBytes+estimatedWorkingBytes,estimatedOperations=2*count+local*512+32*(settings.sampleRadius+settings.guidedRadius)*(localWidth+localHeight)+draftOperations(settings,image.width,image.height)
 const budget={estimatedInputBytes,estimatedWorkingBytes,estimatedPeakBytes,estimatedOperations,snapshotBytes}
 if(estimatedPeakBytes>TRIMAP_MATTE_MAX_PEAK_BYTES||estimatedOperations>TRIMAP_MATTE_MAX_OPERATIONS)throw new EditorError('RESOURCE_LIMIT','Trimap draft and refinement exceed the total peak memory or operation budget; use smaller retained inputs, fewer strokes, or a smaller region.',budget)
 return budget
}
/** O(pixels) separable min/max class windows. A coarse <=5/>=250 region is
 * stable only when its radius neighbourhood has the same class. Partial
 * coverage and class boundaries are unknown; no radius-squared dilation. */
export function buildTrimapDraft(selection:RasterSelection,settings:TrimapDraftSettings={}):Uint8Array {
 const {width,height,coverage}=selection,count=dimensions(width,height)
 if(!byteRaster(coverage)||coverage.length!==count)invalid('Invalid trimap draft coverage bytes.')
 const normalized=normalizeTrimapDraftSettings(settings,width,height),work=draftOperations(normalized,width,height),peak=coverage.buffer.byteLength+count*3+Math.max(width,height)*8+settingsBytes(normalized)*2
 if(peak>TRIMAP_MATTE_MAX_PEAK_BYTES||work>TRIMAP_MATTE_MAX_OPERATIONS)throw new EditorError('RESOURCE_LIMIT','Trimap draft exceeds its memory or stroke-operation budget.')
 const min=new Uint8Array(count),max=new Uint8Array(count),result=new Uint8Array(count),small=new Int32Array(Math.max(width,height)),large=new Int32Array(Math.max(width,height)),radius=normalized.boundaryRadius,label=(index:number)=>coverage[index]<=5?0:coverage[index]>=250?255:128
 for(let y=0;y<height;y++){let loHead=0,loTail=0,hiHead=0,hiTail=0,right=-1;const row=y*width
  for(let x=0;x<width;x++){while(right<Math.min(width-1,x+radius)){right++;const value=label(row+right);while(loTail>loHead&&label(row+small[loTail-1])>=value)loTail--;small[loTail++]=right;while(hiTail>hiHead&&label(row+large[hiTail-1])<=value)hiTail--;large[hiTail++]=right}while(small[loHead]<x-radius)loHead++;while(large[hiHead]<x-radius)hiHead++;min[row+x]=label(row+small[loHead]);max[row+x]=label(row+large[hiHead])}
 }
 for(let x=0;x<width;x++){let loHead=0,loTail=0,hiHead=0,hiTail=0,bottom=-1
  for(let y=0;y<height;y++){while(bottom<Math.min(height-1,y+radius)){bottom++;const low=min[bottom*width+x],high=max[bottom*width+x];while(loTail>loHead&&min[small[loTail-1]*width+x]>=low)loTail--;small[loTail++]=bottom;while(hiTail>hiHead&&max[large[hiTail-1]*width+x]<=high)hiTail--;large[hiTail++]=bottom}while(small[loHead]<y-radius)loHead++;while(large[hiHead]<y-radius)hiHead++;const low=min[small[loHead]*width+x],high=max[large[hiHead]*width+x];result[y*width+x]=low===high?low:128}
 }
 const region=regionOf(normalized,width,height),[rx,ry,rw,rh]=region
 for(const stroke of normalized.strokes){const radius=stroke.size/2,step=Math.max(.5,stroke.size/4),stamp=(cx:number,cy:number)=>{
  for(let y=Math.max(ry,Math.ceil(cy-radius-.5));y<=Math.min(ry+rh-1,Math.floor(cy+radius-.5));y++){const dy=y+.5-cy,extent=Math.sqrt(Math.max(0,radius*radius-dy*dy)),left=Math.max(rx,Math.ceil(cx-extent-.5)),right=Math.min(rx+rw-1,Math.floor(cx+extent-.5));if(left<=right)result.fill(stroke.value,y*width+left,y*width+right+1)}
  // A one-pixel hard brush still paints its nearest raster pixel at an integer
  // corner rather than disappearing between four pixel centres.
  if(stroke.size===1){const x=Math.floor(cx),y=Math.floor(cy);if(x>=rx&&x<rx+rw&&y>=ry&&y<ry+rh)result[y*width+x]=stroke.value}
 }
  for(let i=0;i<Math.max(1,stroke.points.length-1);i++){const segment=clipSegment(stroke.points[i],stroke.points[Math.min(stroke.points.length-1,i+1)],region,radius);if(!segment)continue;const steps=Math.ceil(Math.hypot(segment[2]-segment[0],segment[3]-segment[1])/step);for(let at=0;at<=steps;at++){const t=steps?at/steps:0;stamp(segment[0]+(segment[2]-segment[0])*t,segment[1]+(segment[3]-segment[1])*t)}}
 }
 return result
}
