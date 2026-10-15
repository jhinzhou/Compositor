import {z} from 'zod'
import {LIMITS} from './limits'
const number=z.number().finite()
const point=z.tuple([number.min(-1_000_000).max(1_000_000),number.min(-1_000_000).max(1_000_000)])
/** Experimental opaque-source trimap refinement, separate from semantic subject detection. */
export function edgeRefinementActionSchema<T extends z.ZodType>(target:T){return z.object({
 type:z.literal('selection.refine_edges'),layerId:target,
 output:z.enum(['selection','mask','new-layer']).default('mask'),
 boundaryRadius:number.int().min(1).max(40).default(4),
 sampleRadius:number.int().min(1).max(64).default(16),
 guidedRadius:number.int().min(1).max(40).default(2),
 region:z.tuple([number.int().min(0).max(LIMITS.maxSide),number.int().min(0).max(LIMITS.maxSide),number.int().min(1).max(LIMITS.maxSide),number.int().min(1).max(LIMITS.maxSide)]).optional(),
 strokes:z.array(z.object({value:z.union([z.literal(0),z.literal(128),z.literal(255)]),size:number.min(1).max(512),points:z.array(point).min(1).max(10_000)}).strict()).max(256).default([])
}).strict().refine(action=>action.strokes.reduce((total,stroke)=>total+stroke.points.length,0)<=10_000,{message:'Trimap strokes exceed the 10000 point budget.',path:['strokes']})}
