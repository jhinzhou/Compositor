import {z} from 'zod'

export const SAMPLE_SIZES=[1,3,5,11,31,51,101] as const
export const INFO_UNITS=['px','mm','cm','in'] as const
export type InfoPoint=[number,number]
const point=z.tuple([z.number().finite().min(-1_000_000).max(1_000_000),z.number().finite().min(-1_000_000).max(1_000_000)])
export const colorSampleSchema=z.object({id:z.number().int().min(1).max(10),position:point}).strict()
export const rulerSchema=z.object({start:point,end:point,third:point.optional()}).strict()
export const documentInfoSchema=z.object({
 samples:z.array(colorSampleSchema).max(10).default([]),
 sampleSize:z.union(SAMPLE_SIZES.map(size=>z.literal(size)) as [z.ZodLiteral<1>,z.ZodLiteral<3>,z.ZodLiteral<5>,z.ZodLiteral<11>,z.ZodLiteral<31>,z.ZodLiteral<51>,z.ZodLiteral<101>]).default(1),
 sampleTarget:z.enum(['merged','current']).default('merged'),unit:z.enum(INFO_UNITS).default('px'),ruler:rulerSchema.optional()
}).strict().refine(info=>new Set(info.samples.map(sample=>sample.id)).size===info.samples.length,{message:'Color sample numbers must be unique.'})
export type DocumentInfo=z.infer<typeof documentInfoSchema>
export type ColorSample=z.infer<typeof colorSampleSchema>
export type InfoUnit=typeof INFO_UNITS[number]
export const emptyDocumentInfo=():DocumentInfo=>({samples:[],sampleSize:1,sampleTarget:'merged',unit:'px'})
export function nextSampleId(info:DocumentInfo):number|undefined {return Array.from({length:10},(_,i)=>i+1).find(id=>!info.samples.some(sample=>sample.id===id))}
/** Use the document's own geometry mapping for every persisted point. The map
 * must receive/return document coordinates; never pass screen coordinates. */
export function mapDocumentInfoPoints(info:DocumentInfo,map:(point:InfoPoint)=>InfoPoint):DocumentInfo {
 return documentInfoSchema.parse({...info,samples:info.samples.map(sample=>({...sample,position:map([...sample.position])})),ruler:info.ruler?{start:map([...info.ruler.start]),end:map([...info.ruler.end]),...(info.ruler.third?{third:map([...info.ruler.third])}:{})}:undefined})
}
/** Constrain in document coordinates, independently of zoom, pan or view rotation. */
export function constrainRulerEnd(start:InfoPoint,end:InfoPoint,shift:boolean):InfoPoint {
 if(!shift)return [...end]
 const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4
 return [start[0]+length*Math.cos(angle),start[1]+length*Math.sin(angle)]
}
export function rulerMeasurement(ruler:z.infer<typeof rulerSchema>,resolution:number,unit:InfoUnit) {
 rulerSchema.parse(ruler);if(!Number.isFinite(resolution)||resolution<=0)throw Error('Document resolution must be positive.')
 const scale=unit==='px'?1:unit==='in'?1/resolution:unit==='cm'?2.54/resolution:25.4/resolution
 const dx=ruler.end[0]-ruler.start[0],dy=ruler.end[1]-ruler.start[1]
 const third=ruler.third,tx=third?third[0]-ruler.start[0]:0,ty=third?third[1]-ruler.start[1]:0,firstAngle=Math.atan2(dy,dx),secondAngle=Math.atan2(ty,tx),difference=Math.abs(((secondAngle-firstAngle)*180/Math.PI+540)%360-180)
 return {x:ruler.start[0]*scale,y:ruler.start[1]*scale,width:dx*scale,height:dy*scale,length:Math.hypot(dx,dy)*scale,angle:dx||dy?-firstAngle*180/Math.PI:0,unit,...(third?{secondLength:Math.hypot(tx,ty)*scale,includedAngle:Math.hypot(dx,dy)&&Math.hypot(tx,ty)?difference:0}:{})}
}
export interface InfoRaster {width:number;height:number;data:Uint8Array|Uint8ClampedArray|Uint16Array|Float32Array;precision:'uint8'|'uint16'|'float32';premultiplied:boolean}
export interface ColorReading {rgb:[number,number,number];alpha:number;precision:InfoRaster['precision'];pixelCount:number;transparent:boolean}
/** Average canonical samples: alpha-weighted straight RGB and mean alpha.
 * Edge areas are clipped to the raster, never padded with display/background pixels.
 * Float32 extended RGB remains unclamped; UNORM16 values retain the full 65535 scale.
 */
export function sampleRaster(raster:InfoRaster,position:InfoPoint,size:typeof SAMPLE_SIZES[number],mapPoint?:(point:InfoPoint)=>InfoPoint):ColorReading|null {
 if(!Number.isInteger(raster.width)||!Number.isInteger(raster.height)||raster.width<1||raster.height<1||raster.data.length!==raster.width*raster.height*4)throw Error('The sample raster dimensions are invalid.')
 if(!SAMPLE_SIZES.includes(size)||!position.every(Number.isFinite))throw Error('The sample position or size is invalid.')
 const center=mapPoint?mapPoint([Math.floor(position[0])+.5,Math.floor(position[1])+.5]):position
 if(center[0]<0||center[1]<0||center[0]>=raster.width||center[1]>=raster.height)return null
 const expected=raster.precision==='uint16'?Uint16Array:raster.precision==='float32'?Float32Array:undefined
 if(expected?!(raster.data instanceof expected):!(raster.data instanceof Uint8Array)&&!(raster.data instanceof Uint8ClampedArray))throw Error('The sample precision does not match its source raster.')
 const maximum=raster.precision==='uint8'?255:raster.precision==='uint16'?65535:1,half=(size-1)/2,cx=Math.floor(position[0]),cy=Math.floor(position[1])
 const left=mapPoint?cx-half:Math.max(0,cx-half),right=mapPoint?cx+half:Math.min(raster.width-1,cx+half),top=mapPoint?cy-half:Math.max(0,cy-half),bottom=mapPoint?cy+half:Math.min(raster.height-1,cy+half)
 let alpha=0,count=0;const sum=[0,0,0]
 for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
  const mapped=mapPoint?mapPoint([x+.5,y+.5]):[x,y],sx=Math.floor(mapped[0]),sy=Math.floor(mapped[1])
  if(sx<0||sy<0||sx>=raster.width||sy>=raster.height)continue
  const at=(sy*raster.width+sx)*4,a=raster.data[at+3]/maximum
  if(!Number.isFinite(a)||a<0||a>1)throw Error('The sample alpha is invalid.')
  for(let c=0;c<3;c++){const value=raster.data[at+c];if(!Number.isFinite(value))throw Error('The sample color is invalid.');sum[c]+=raster.premultiplied?value:value*a}
  alpha+=a;count++
 }
 return count?{rgb:sum.map(value=>alpha?value/alpha:0) as [number,number,number],alpha:alpha/count,precision:raster.precision,pixelCount:count,transparent:alpha===0}:null
}
