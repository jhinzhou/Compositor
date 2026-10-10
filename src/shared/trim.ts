import {z} from 'zod'
export const trimOptionsSchema=z.object({basedOn:z.enum(['transparent','top-left','bottom-right']).default('transparent'),top:z.boolean().default(true),bottom:z.boolean().default(true),left:z.boolean().default(true),right:z.boolean().default(true),tolerance:z.number().int().min(0).max(255).default(0)}).strict()
export type TrimOptions=z.infer<typeof trimOptionsSchema>
export function calculateTrimBounds(image:{width:number;height:number;data:Uint8Array},input:TrimOptions):{x:number;y:number;width:number;height:number}|undefined{
 const options=trimOptionsSchema.parse(input),{width,height,data}=image
 if(!options.top&&!options.bottom&&!options.left&&!options.right)return {x:0,y:0,width,height}
 const sample=options.basedOn==='bottom-right'?(width*height-1)*4:0
 const color=(offset:number,channel:number)=>channel===3?data[offset+3]:Math.round(data[offset+channel]*data[offset+3]/255)
 let left=width,top=height,right=0,bottom=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4,keep=options.basedOn==='transparent'?data[at+3]>0:[0,1,2,3].some(channel=>Math.abs(color(at,channel)-color(sample,channel))>options.tolerance);if(keep){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}}
 if(!right)return
 const x=options.left?left:0,y=options.top?top:0;return {x,y,width:(options.right?right:width)-x,height:(options.bottom?bottom:height)-y}
}
