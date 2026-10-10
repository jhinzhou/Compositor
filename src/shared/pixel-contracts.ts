import {trimOptionsSchema} from './trim'
import {transformSchema} from './transform'
import {textStyleSchema,shapeStyleSchema} from './content-style'
import {LIMITS} from './limits'
import { z } from 'zod'
import {layerEffectsSchema} from './layer-effects'
import { imageFilterSchema } from './image-filters'
const number = z.number().finite()
export const pointSchema = z.tuple([number.min(-1_000_000).max(1_000_000), number.min(-1_000_000).max(1_000_000)])
export const colorSchema = z.tuple([number.min(0).max(1), number.min(0).max(1), number.min(0).max(1), number.min(0).max(1)])
export const selectionShapeSchema = z.object({
  kind: z.enum(['rectangle', 'ellipse', 'polygon','raster']), operation: z.enum(['replace', 'add', 'subtract', 'intersect']).default('replace'),
  bounds: z.tuple([number, number, number.min(0).max(1_000_000), number.min(0).max(1_000_000)]),
  raster:z.object({width:number.int().min(1).max(LIMITS.maxSide),height:number.int().min(1).max(LIMITS.maxSide),transform:z.object({origin:pointSchema,size:z.tuple([number.min(1),number.min(1)]),rotation:number,flipX:z.boolean(),flipY:z.boolean()}).strict(),runs:z.array(z.tuple([number.int().min(0),number.int().min(0),number.int().min(1),number.int().min(1).max(255)])).max(100_000)}).strict().optional(),
  points: z.array(pointSchema).min(3).max(100_000).optional(), feather: number.min(0).max(1000).default(0)
}).strict().refine(value => value.kind!=='raster'||!!value.raster,{message:'A raster selection requires coverage data.'}).refine(value => value.kind !== 'polygon' || !!value.points, { message: 'A polygon requires at least three points.' })
export const selectionSchema = z.object({ shapes: z.array(selectionShapeSchema).max(128), inverted: z.boolean().default(false), antialiased:z.boolean().optional(), feather:number.min(0).max(250).optional(), canvasSize:z.tuple([number.int().min(1).max(LIMITS.maxSide),number.int().min(1).max(LIMITS.maxSide)]).optional() }).strict()
export type Selection = z.infer<typeof selectionSchema>
export type RGBA = z.infer<typeof colorSchema>
export function pixelActionOptions<T extends z.ZodType>(target: T) { return [
  z.object({type:z.literal('document.trim'),options:trimOptionsSchema.default({basedOn:'transparent',top:true,bottom:true,left:true,right:true,tolerance:0})}).strict(),
  z.object({type:z.literal('layer.copy_mask'),layerId:target,sourceId:target}).strict(),
  z.object({type:z.literal('layer.copy_effect'),layerId:target,sourceId:target,kind:z.enum(['stroke','shadow','colorOverlay','innerShadow','outerGlow','innerGlow'])}).strict(),
  z.object({type:z.literal('layer.mask_set_placement'),layerId:target,transform:transformSchema}).strict(),
  z.object({type:z.literal('selection.from_mask'),layerId:target,operation:z.enum(['replace','add','subtract','intersect']).default('replace')}).strict(),
  z.object({type:z.literal('layer.mask_filter'),layerId:target,filter:z.enum(['gaussianBlur','feather']),radius:number.min(0).max(250)}).strict(),
  z.object({type:z.literal('layer.text'),layerId:target.optional(),name:z.string().trim().min(1).max(4096),style:textStyleSchema}).strict(),
  z.object({type:z.literal('layer.shape'),layerId:target.optional(),name:z.string().trim().min(1).max(4096),style:shapeStyleSchema,size:z.tuple([number.int().min(1).max(LIMITS.maxSide),number.int().min(1).max(LIMITS.maxSide)])}).strict(),
  z.object({type:z.literal('selection.subject'),layerId:target,point:pointSchema.optional(),box:z.tuple([number,number,number.positive(),number.positive()]).optional(),removeBackground:z.boolean().default(false),operation:z.enum(['replace','add','subtract','intersect']).default('replace'),sampleAllLayers:z.boolean().default(true),matteQuality:z.enum(['basic','advanced']).default('basic'),refineEdges:number.min(0).max(40).default(12),matteContrast:number.min(0).max(100).default(25),shiftEdge:number.min(-10).max(10).default(0)}).strict(),
  z.object({type:z.literal('layer.content_fill'),layerId:target}).strict(),
  z.object({type:z.literal('layer.clear_selected'),layerId:target,target:z.enum(['image','mask']).default('image')}).strict(),
  z.object({type:z.literal('selection.transform_pixels'),layerId:target,transform:transformSchema,corners:z.tuple([pointSchema,pointSchema,pointSchema,pointSchema]).optional()}).strict(),
  z.object({type:z.literal('selection.translate'),delta:pointSchema}).strict(),
  z.object({type:z.literal('layer.effects'),layerId:target,effects:layerEffectsSchema.nullable()}).strict(),
  z.object({type:z.literal('layer.distort'),layerId:target,corners:z.tuple([pointSchema,pointSchema,pointSchema,pointSchema]),trim:z.boolean().default(false),target:z.enum(['image','mask']).default('image')}).strict(),
  z.object({type:z.literal('selection.wand'),layerId:target,point:pointSchema,tolerance:number.min(0).max(255).default(32),contiguous:z.boolean().default(true),sampleSize:z.enum(['point','3x3','5x5']).default('point'),sampleAllLayers:z.boolean().default(false),antialiased:z.boolean().default(true),operation:z.enum(['replace','add','subtract','intersect']).default('replace')}).strict(),
  z.object({type:z.literal('selection.color_range'),layerId:target,colors:z.array(z.tuple([number.min(0).max(255),number.min(0).max(255),number.min(0).max(255)])).min(1).max(64),tolerance:number.min(0).max(255).default(32),softness:number.min(0).max(1).default(0),excludeColors:z.array(z.tuple([number.min(0).max(255),number.min(0).max(255),number.min(0).max(255)])).max(64).default([]),invert:z.boolean().default(false),sampleAllLayers:z.boolean().default(false),antialiased:z.boolean().default(true),operation:z.enum(['replace','add','subtract','intersect']).default('replace')}).strict(),
  z.object({type:z.literal('selection.from_alpha'),layerId:target}).strict(),
  z.object({type:z.literal('layer.retouch'),layerId:target,kind:z.enum(['clone','heal','spot-heal','smear','blur']),points:z.array(pointSchema).min(1).max(100_000),size:number.min(1).max(4096),hardness:number.min(0).max(1).default(1),opacity:number.min(0).max(1).default(1),sourceAnchor:pointSchema.optional(),protectAlpha:z.boolean().default(true),smoothing:number.min(0).max(5000).optional(),sourceMode:z.enum(['this-layer','all-layers']).optional(),aligned:z.boolean().optional(),sourceOffset:pointSchema.optional(),blurRadius:number.min(.5).max(50).optional(),healingMode:z.enum(['content-aware','create-texture','proximity-match']).optional(),smearMode:z.enum(['smudge','liquify']).optional(),target:z.enum(['image','mask']).optional(),seed:number.int().min(0).max(0xffffffff).optional()}).strict(),
  z.object({type:z.literal('layer.filter'),layerId:target,filter:imageFilterSchema}).strict(),
  z.object({type:z.literal('adjustment.add'),filter:imageFilterSchema,name:z.string().trim().min(1).max(4096)}).strict(),
  z.object({type:z.literal('adjustment.set'),layerId:target,filter:imageFilterSchema}).strict(),
  z.object({ type: z.literal('selection.set'), selection: selectionSchema.nullable() }).strict(),
  z.object({ type: z.literal('selection.invert') }).strict(),
  z.object({ type: z.literal('selection.modify'), operation: z.enum(['expand','contract','feather']), amount: number.min(0).max(1000) }).strict(),
  z.object({ type: z.literal('layer.paint'), layerId: target, points: z.array(pointSchema).min(1).max(100_000), color: colorSchema, size: number.min(1).max(4096), hardness: number.min(0).max(1).default(1), smoothing:number.min(0).max(5000).optional(), opacity: number.min(0).max(1).default(1), erase: z.boolean().default(false), target: z.enum(['image','mask']).default('image') }).strict(),
  z.object({ type: z.literal('layer.fill'), layerId: target, color: colorSchema, target: z.enum(['image','mask']).default('image') }).strict(),
  z.object({ type: z.literal('layer.gradient'), layerId: target, start: pointSchema, end: pointSchema, from: colorSchema, to: colorSchema, radial: z.boolean().default(false),opacity:number.min(0).max(1).optional(),target:z.enum(['image','mask']).optional() }).strict(),
  z.object({ type: z.literal('layer.mask'), layerId: target, operation: z.enum(['reveal','hide','remove','enable','disable','invert','link','unlink']) }).strict(),
  z.object({ type: z.literal('layer.set_clipping'), layerId: target, sourceId: target.nullable() }).strict(),
  z.object({ type: z.literal('document.canvas_size'), width: number.int().min(1).max(LIMITS.maxSide), height: number.int().min(1).max(LIMITS.maxSide), anchor: z.enum(['center','top-left','top','top-right','left','right','bottom-left','bottom','bottom-right']).default('center') }).strict(),
  z.object({ type: z.literal('document.crop'), x: number.int(), y: number.int(), width: number.int().min(1).max(LIMITS.maxSide), height: number.int().min(1).max(LIMITS.maxSide) }).strict(),
  z.object({ type: z.literal('document.image_size'), width: number.int().min(1).max(LIMITS.maxSide), height: number.int().min(1).max(LIMITS.maxSide), resolution: number.min(1).max(9600), resample: z.boolean().default(true), sampling: z.enum(['High quality', 'Smooth', 'Nearest']).default('High quality') }).strict(),
  z.object({ type: z.literal('document.flip'), axis: z.enum(['horizontal','vertical']) }).strict(),
  z.object({ type: z.literal('document.rotate'), clockwise: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal('document.guides'), guides: z.array(z.object({ id: z.string().uuid(), axis: z.enum(['horizontal','vertical']), position: number.min(-1_000_000).max(1_000_000) }).strict()).max(1000) }).strict()
] as const }
