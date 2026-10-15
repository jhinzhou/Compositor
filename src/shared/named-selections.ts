import {z} from 'zod'
import {LIMITS} from './limits'

/** Inline grayscale channels share the project manifest budget; no bitmap assets. */
export const NAMED_SELECTION_LIMITS={maxCount:32,maxRuns:100_000,maxPixels:64_000_000,maxBytes:2*1024*1024} as const
export const namedSelectionNameSchema=z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/)
export const selectionCombineSchema=z.enum(['replace','add','subtract','intersect'])
const integer=z.number().int().nonnegative()
export const namedSelectionSchema=z.object({
 name:namedSelectionNameSchema,
 width:integer.min(1).max(LIMITS.maxSide),height:integer.min(1).max(LIMITS.maxSide),
 runs:z.array(z.tuple([integer,integer,integer.min(1),integer.min(1).max(255)])).max(NAMED_SELECTION_LIMITS.maxRuns)
}).strict().superRefine((channel,ctx)=>{
 if(channel.width*channel.height>NAMED_SELECTION_LIMITS.maxPixels)ctx.addIssue({code:'custom',message:'Named selection exceeds the coverage pixel budget.'})
 let row=-1,end=0
 for(let index=0;index<channel.runs.length;index++){
  const [y,x,length]=channel.runs[index]
  if(y>=channel.height||x+length>channel.width||y<row||y===row&&x<end){ctx.addIssue({code:'custom',message:'Named selection runs must be ordered, non-overlapping and inside the canvas.',path:['runs',index]});break}
  row=y;end=x+length
 }
})
export const namedSelectionsSchema=z.array(namedSelectionSchema).max(NAMED_SELECTION_LIMITS.maxCount).superRefine((channels,ctx)=>{
 const names=new Set<string>();let runs=0,pixels=0
 for(const channel of channels){if(names.has(channel.name))ctx.addIssue({code:'custom',message:'Named selection names must be unique.'});names.add(channel.name);runs+=channel.runs.length;pixels+=channel.width*channel.height}
 if(runs>NAMED_SELECTION_LIMITS.maxRuns||pixels>NAMED_SELECTION_LIMITS.maxPixels||new TextEncoder().encode(JSON.stringify(channels)).length>NAMED_SELECTION_LIMITS.maxBytes)ctx.addIssue({code:'custom',message:'Named selections exceed the project coverage budget.'})
})
export type NamedSelection=z.infer<typeof namedSelectionSchema>
export type SelectionCombine=z.infer<typeof selectionCombineSchema>
