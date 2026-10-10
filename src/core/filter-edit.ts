import { PNG } from 'pngjs'
import { applyImageFilter, imageFilterSchema, type ImageFilter } from '../shared/image-filters'
import { EditorError, type Layer } from '../shared/contracts'
import { LIMITS } from '../shared/limits'
import { blankPNG, documentPoint, selectionCoverage, sourcePoint } from './raster-edit'
import type { Selection } from '../shared/pixel-contracts'
import type {CameraRawBrightness} from '../shared/camera-raw-adaptive'
export type FilterTransform=Layer['transform']
export type FilterRasterResult={png:PNG;transform:FilterTransform;grew:boolean}
/** Native FilterEdit.blurMargin / growForBlur. Values are in source-layer pixels. */
export function filterMargin(filter:ImageFilter):number{return filter.kind==='gaussianBlur'?Math.ceil(filter.radius*3+2):filter.kind==='motionBlur'?Math.ceil(filter.distance/2+2):filter.kind==='bloom'&&filter.amount>0?Math.ceil(filter.radius*3+2):0}
function checkedDimensions(width:number,height:number):void{if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The expanded filter raster exceeds working-surface limits.')}
function placedRect(transform:FilterTransform,width:number,height:number,x:number,y:number,w:number,h:number):FilterTransform{
 const size:[number,number]=[transform.size[0]*w/width,transform.size[1]*h/height],middle=documentPoint({transform} as Layer,x+w/2,y+h/2,width,height)
 return {...structuredClone(transform),size,origin:[middle[0]-size[0]/2,middle[1]-size[1]/2]}
}
function copyRect(source:PNG,x:number,y:number,width:number,height:number):PNG{const result=blankPNG(width,height);for(let row=0;row<height;row++)source.data.copy(result.data,row*width*4,((row+y)*source.width+x)*4,((row+y)*source.width+x+width)*4);return result}
/** Shared by committed edits and previews: grow, filter in document-space selection,
 * then trim transparent bounds while preserving placement through rotation/flips. */
export function filterRaster(source:PNG,placement:FilterTransform,selection:Selection|null|undefined,input:unknown,previewOptions:{knownBrightness?:CameraRawBrightness}={}):FilterRasterResult{
 const filter=imageFilterSchema.parse(input),margin=filterMargin(filter),width=source.width+margin*2,height=source.height+margin*2
 checkedDimensions(width,height)
 const transform=margin?placedRect(placement,source.width,source.height,-margin,-margin,width,height):structuredClone(placement),png=margin?blankPNG(width,height):copyRect(source,0,0,width,height)
 if(margin)for(let y=0;y<source.height;y++)source.data.copy(png.data,((y+margin)*width+margin)*4,y*source.width*4,(y+1)*source.width*4)
 let coverage:Uint8Array|undefined
 if(selection){coverage=new Uint8Array(width*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const point=documentPoint({transform} as Layer,x+.5,y+.5,width,height);coverage[y*width+x]=Math.round(selectionCoverage(selection,...point)*255)}}
 const result=applyImageFilter({width,height,data:new Uint8ClampedArray(png.data)},filter,coverage,1,previewOptions.knownBrightness);png.data=Buffer.from(result.data)
 if(!margin)return {png,transform,grew:false}
 let left=width,top=height,right=0,bottom=0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(png.data[(y*width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}
 if(left>=right||top>=bottom)return {png,transform,grew:true}
 const croppedWidth=right-left,croppedHeight=bottom-top,trimmed=left||top||croppedWidth!==width||croppedHeight!==height
 return {png:trimmed?copyRect(png,left,top,croppedWidth,croppedHeight):png,transform:trimmed?placedRect(transform,width,height,left,top,croppedWidth,croppedHeight):transform,grew:croppedWidth!==source.width||croppedHeight!==source.height||left!==margin||top!==margin}
}
/** Original LayerMask.background uses the majority edge tone. Out-of-grid pixels
 * use that tone unless an edit supplies its outside fill (gradient image growth
 * reveals new area). Linked masks retain their old document coverage. */
export function carryFilterMask(mask:PNG,oldTransform:FilterTransform,result:FilterRasterResult,outside?:0|255):PNG{
 checkedDimensions(result.png.width,result.png.height)
 if(mask.width===1&&mask.height===1&&outside===undefined)return mask
 let sum=0,count=0
 for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)if(!x||!y||x===mask.width-1||y===mask.height-1){sum+=mask.data[(y*mask.width+x)*4];count++}
 const background=outside??(sum*2>=count*255?255:0),output=blankPNG(result.png.width,result.png.height,background)
 for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){
  const point=documentPoint({transform:result.transform} as Layer,x+.5,y+.5,output.width,output.height),[sx,sy]=sourcePoint({transform:oldTransform},...point,mask.width,mask.height)
  if(sx<0||sy<0||sx>=mask.width||sy>=mask.height)continue
  const px=sx-.5,py=sy-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0,read=(a:number,b:number)=>mask.data[(Math.max(0,Math.min(mask.height-1,b))*mask.width+Math.max(0,Math.min(mask.width-1,a)))*4],value=Math.round(read(x0,y0)*(1-fx)*(1-fy)+read(x0+1,y0)*fx*(1-fy)+read(x0,y0+1)*(1-fx)*fy+read(x0+1,y0+1)*fx*fy)
  output.data.set([value,value,value,255],(y*output.width+x)*4)
 }
 return output
}
