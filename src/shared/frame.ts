import {z} from 'zod'
import {EditorError} from './errors'
import {LIMITS} from './limits'
import {transformSchema} from './transform'
export const frameSchema=z.object({kind:z.enum(['rectangle','ellipse']),bounds:z.tuple([z.number().finite().min(-1_000_000).max(1_000_000),z.number().finite().min(-1_000_000).max(1_000_000),z.number().finite().min(1).max(LIMITS.maxSide),z.number().finite().min(1).max(LIMITS.maxSide)])}).strict().refine(frame=>frame.bounds[2]*frame.bounds[3]<=LIMITS.maxSurfacePixels,{message:'Frame exceeds the canvas surface budget.'})
export type FrameMetadata=z.infer<typeof frameSchema>
export function validateFrame(input:unknown):FrameMetadata{return frameSchema.parse(input)}
/** Clip-frame geometry and content placement are separate. Cover retains the
 * full immutable source raster; moving it reveals previously clipped pixels. */
export function frameImagePlacement(frame:FrameMetadata,width:number,height:number,fit:'cover'|'contain'='cover'):z.infer<typeof transformSchema> {
 const {bounds:[x,y,w,h]}=validateFrame(frame)
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||!['cover','contain'].includes(fit))throw new EditorError('INVALID_ARGUMENT','Frame content requires valid source dimensions and fit mode.')
 const scale=fit==='cover'?Math.max(w/width,h/height):Math.min(w/width,h/height),size:[number,number]=[width*scale,height*scale]
 if(size.some(value=>value<1||value>300_000))throw new EditorError('RESOURCE_LIMIT','Frame content placement exceeds the supported transform range.')
 return transformSchema.parse({origin:[x+(w-size[0])/2,y+(h-size[1])/2],size,rotation:0,flipX:false,flipY:false,sampling:'High quality'})
}
