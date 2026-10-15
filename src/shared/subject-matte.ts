import {EditorError} from './contracts'
import {gaussianSelectionCoverage} from './selection-gaussian'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'
export interface SubjectMatteSettings {quality?:'basic'|'advanced';refineEdges?:number;matteContrast?:number;shiftEdge?:number;edgeMode?:'native'|'color';feather?:number}
/** GuidedMatte.box: clamped-edge separable running sums, O(pixels), independent
 * of radius. Floats are retained between every stage; mask bytes round once. */
export function matteBox(source:Float32Array,width:number,height:number,radius:number):Float32Array {
 const span=radius*2+1,pass=new Float32Array(source.length),result=new Float32Array(source.length)
 for(let y=0;y<height;y++){const row=y*width;let sum=0;for(let x=-radius;x<=radius;x++)sum+=source[row+Math.min(width-1,Math.max(0,x))];for(let x=0;x<width;x++){pass[row+x]=sum/span;sum-=source[row+Math.min(width-1,Math.max(0,x-radius))];sum+=source[row+Math.min(width-1,Math.max(0,x+radius+1))]}}
 for(let x=0;x<width;x++){let sum=0;for(let y=-radius;y<=radius;y++)sum+=pass[Math.min(height-1,Math.max(0,y))*width+x];for(let y=0;y<height;y++){result[y*width+x]=sum/span;sum-=pass[Math.min(height-1,Math.max(0,y-radius))*width+x];sum+=pass[Math.min(height-1,Math.max(0,y+radius+1))*width+x]}}
 return result
}
/** He/Sun/Tang guided-filter equations ported directly from GuidedMatte.swift. */
export function guidedMatteFilter(mask:Float32Array,guide:Float32Array,width:number,height:number,radius:number,epsilon=1e-4):Float32Array {
 const count=width*height
 if(mask.length!==count||guide.length!==count||!Number.isInteger(radius)||radius<1||radius>40||!Number.isFinite(epsilon)||epsilon<=0)throw new EditorError('INVALID_ARGUMENT','Invalid guided matte dimensions or radius.')
 const meanGuide=matteBox(guide,width,height,radius),meanMask=matteBox(mask,width,height,radius),squares=new Float32Array(count),products=new Float32Array(count)
 for(let i=0;i<count;i++){squares[i]=guide[i]*guide[i];products[i]=guide[i]*mask[i]}
 const meanSquares=matteBox(squares,width,height,radius),meanProducts=matteBox(products,width,height,radius),slope=new Float32Array(count),offset=new Float32Array(count)
 for(let i=0;i<count;i++){const variance=meanSquares[i]-meanGuide[i]*meanGuide[i],covariance=meanProducts[i]-meanGuide[i]*meanMask[i];slope[i]=covariance/(variance+epsilon);offset[i]=meanMask[i]-slope[i]*meanGuide[i]}
 const meanSlope=matteBox(slope,width,height,radius),meanOffset=matteBox(offset,width,height,radius),result=new Float32Array(count)
 for(let i=0;i<count;i++)result[i]=Math.min(1,Math.max(0,meanSlope[i]*guide[i]+meanOffset[i]))
 return result
}
/** Use the strongest local RGB guide instead of luminance alone. Equal-luminance
 * red/green edges otherwise disappear from the native gray guide. This is a
 * local edge-aware filter, not a hair-generation or semantic matting model.
 * Channel passes run sequentially and only refine the coarse boundary band.
 * Large inputs use two-radius overlap (both box-filter stages), so tile seams
 * have the same neighbourhood as full-frame filtering without 3 full RGB passes. */
export function colorGuidedMatteFilter(mask:Float32Array,image:RGBAImage,radius:number):Float32Array {
 const {width,height,data}=image,count=width*height
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||mask.length!==count||data.length!==count*4)throw new EditorError('INVALID_ARGUMENT','Matte and guide must have equal dimensions.')
 if(!Number.isInteger(radius)||radius<1||radius>40)throw new EditorError('INVALID_ARGUMENT','Invalid guided matte dimensions or radius.')
 if(count>32_000_000)throw new EditorError('RESOURCE_LIMIT','Advanced matte refinement is limited to 32 megapixels.')
 if(count<=1_048_576)return colorGuidedMatteTile(mask,image,radius)
 const result=new Float32Array(count),tileSize=1024,halo=radius*2,capacity=Math.min(width,tileSize+halo*2)*Math.min(height,tileSize+halo*2),workspace=colorMatteWorkspace(capacity),tileMaskBuffer=new Float32Array(capacity),tileImageBuffer=new Uint8Array(capacity*4)
 for(let top=0;top<height;top+=tileSize)for(let left=0;left<width;left+=tileSize){
  const right=Math.min(width,left+tileSize),bottom=Math.min(height,top+tileSize),x0=Math.max(0,left-halo),y0=Math.max(0,top-halo),x1=Math.min(width,right+halo),y1=Math.min(height,bottom+halo),tileWidth=x1-x0,tileHeight=y1-y0
  const tileMask=tileMaskBuffer.subarray(0,tileWidth*tileHeight),tileImage=tileImageBuffer.subarray(0,tileWidth*tileHeight*4)
  for(let y=y0;y<y1;y++){const at=(y-y0)*tileWidth;tileMask.set(mask.subarray(y*width+x0,y*width+x1),at);tileImage.set(data.subarray((y*width+x0)*4,(y*width+x1)*4),at*4)}
  const refined=colorGuidedMatteTile(tileMask,{width:tileWidth,height:tileHeight,data:tileImage},radius,workspace)
  for(let y=top;y<bottom;y++)result.set(refined.subarray((y-y0)*tileWidth+left-x0,(y-y0)*tileWidth+right-x0),y*width+left)
 }
 return result
}
function colorMatteWorkspace(count:number):Float32Array[]{return Array.from({length:13},()=>new Float32Array(count))}
function matteBoxInto(source:Float32Array,width:number,height:number,radius:number,result:Float32Array,pass:Float32Array):void {
 const span=radius*2+1
 for(let y=0;y<height;y++){const row=y*width;let sum=0;for(let x=-radius;x<=radius;x++)sum+=source[row+Math.min(width-1,Math.max(0,x))];for(let x=0;x<width;x++){pass[row+x]=sum/span;sum-=source[row+Math.min(width-1,Math.max(0,x-radius))];sum+=source[row+Math.min(width-1,Math.max(0,x+radius+1))]}}
 for(let x=0;x<width;x++){let sum=0;for(let y=-radius;y<=radius;y++)sum+=pass[Math.min(height-1,Math.max(0,y))*width+x];for(let y=0;y<height;y++){result[y*width+x]=sum/span;sum-=pass[Math.min(height-1,Math.max(0,y-radius))*width+x];sum+=pass[Math.min(height-1,Math.max(0,y+radius+1))*width+x]}}
}
function colorGuidedMatteTile(mask:Float32Array,image:RGBAImage,radius:number,workspace=colorMatteWorkspace(mask.length)):Float32Array {
 const {width,height,data}=image,count=width*height
 const [prior,result,bestVariance,guide,products,mean,meanSquares,meanProducts,slope,offset,meanSlope,meanOffset,scratch]=workspace
 matteBoxInto(mask,width,height,radius,prior,scratch);result.set(prior.subarray(0,count));bestVariance.fill(0,0,count)
 for(let channel=0;channel<3;channel++){
  for(let i=0;i<count;i++){guide[i]=data[i*4+channel]/255;products[i]=guide[i]*guide[i]}
  matteBoxInto(guide,width,height,radius,mean,scratch);matteBoxInto(products,width,height,radius,meanSquares,scratch)
  for(let i=0;i<count;i++)products[i]=guide[i]*mask[i]
  matteBoxInto(products,width,height,radius,meanProducts,scratch)
  for(let i=0;i<count;i++){const variance=meanSquares[i]-mean[i]*mean[i],covariance=meanProducts[i]-mean[i]*prior[i];slope[i]=covariance/(variance+1e-4);offset[i]=prior[i]-slope[i]*mean[i]}
  matteBoxInto(slope,width,height,radius,meanSlope,scratch);matteBoxInto(offset,width,height,radius,meanOffset,scratch)
  for(let i=0;i<count;i++){
   const variance=Math.max(0,meanSquares[i]-mean[i]*mean[i])
   if(prior[i]<=.01||prior[i]>=.99){result[i]=mask[i];continue}
   if(variance>bestVariance[i]){bestVariance[i]=variance;result[i]=Math.min(1,Math.max(0,meanSlope[i]*guide[i]+meanOffset[i]))}
  }
 }
 return result.subarray(0,count)
}
/** Refine -> Shift Edge -> Contrast, matching SubjectRemoval.refined ordering.
 * Image-to-gray uses explicit sRGB luminance for portability. Core Graphics's
 * DeviceGray conversion can differ, so model/color-conversion pixel equality
 * must be measured separately from the shared filter equations. */
export function refineSubjectMatte(mask:RasterSelection,guide:RGBAImage,settings:SubjectMatteSettings={}):RasterSelection {
 const count=mask.width*mask.height
 if(!Number.isInteger(mask.width)||!Number.isInteger(mask.height)||mask.width<1||mask.height<1||count!==mask.coverage.length||guide.width!==mask.width||guide.height!==mask.height||guide.data.length!==count*4)throw new EditorError('INVALID_ARGUMENT','Matte and guide must have equal dimensions.')
 const refine=settings.refineEdges??12,contrast=settings.matteContrast??25,shift=settings.shiftEdge??0,feather=settings.feather??0,edgeMode=settings.edgeMode??'native'
 if(!Number.isFinite(refine)||refine<0||refine>40||!Number.isFinite(contrast)||contrast<0||contrast>100||!Number.isFinite(shift)||Math.abs(shift)>10||!Number.isFinite(feather)||feather<0||feather>20||!['native','color'].includes(edgeMode))throw new EditorError('INVALID_ARGUMENT','Matte refinement settings are outside supported ranges.')
 let coverage:Uint8Array=mask.coverage.slice()
 if(settings.quality!=='advanced')return {...mask,coverage}
 if(count>32_000_000)throw new EditorError('RESOURCE_LIMIT','Advanced matte refinement is limited to 32 megapixels.')
 if(refine>0){const levels=new Float32Array(count),radius=Math.max(1,Math.round(refine));for(let i=0;i<count;i++)levels[i]=coverage[i]/255;let refined:Float32Array
  if(edgeMode==='color')refined=colorGuidedMatteFilter(levels,guide,radius)
  else{const gray=new Float32Array(count);for(let i=0;i<count;i++){const at=i*4;gray[i]=(.2126*guide.data[at]+.7152*guide.data[at+1]+.0722*guide.data[at+2])/255*guide.data[at+3]/255}refined=guidedMatteFilter(levels,gray,mask.width,mask.height,radius)}
  for(let i=0;i<count;i++)coverage[i]=Math.round(refined[i]*255)
 }
 if(shift){coverage=gaussianSelectionCoverage(coverage,mask.width,mask.height,Math.abs(shift));const level=shift<0?.75:.25;for(let i=0;i<count;i++)coverage[i]=Math.round(255*Math.max(0,Math.min(1,(coverage[i]/255-level)/.001)))}
 if(contrast>0){const slope=Math.fround(1/Math.max(.02,1-contrast/100*.98)),bias=Math.fround((1-slope)/2);for(let i=0;i<count;i++)coverage[i]=Math.round(255*Math.max(0,Math.min(1,Math.fround(Math.fround(coverage[i]/255)*slope)+bias)))}
 if(feather>0)coverage=gaussianSelectionCoverage(coverage,mask.width,mask.height,feather)
 // Refinement and feather cannot reveal pixels that do not exist in the source.
 for(let i=0;i<count;i++)coverage[i]=Math.min(coverage[i],guide.data[i*4+3])
 return {...mask,coverage}
}

/** Point-select one connected foreground component of the coarse local mask.
 * A background click returns an explicit empty mask. This does not substitute
 * an instance-segmentation model: touching subjects can still form one island. */
export function pickSubjectComponent(mask:RasterSelection,point:[number,number]):RasterSelection {
 const {width,height}=mask,count=width*height
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||count>32_000_000)throw new EditorError('RESOURCE_LIMIT','Object point selection exceeds the mask budget.')
 const coverage=new Uint8Array(count)
 if(count!==mask.coverage.length||!Number.isFinite(point[0])||!Number.isFinite(point[1]))throw new EditorError('INVALID_ARGUMENT','Invalid object point or coverage dimensions.')
 const sx=Math.floor(point[0]),sy=Math.floor(point[1])
 if(sx<0||sy<0||sx>=width||sy>=height||mask.coverage[sy*width+sx]<128)return {...mask,coverage}
 const stack=[sx,sy]
 while(stack.length){const y=stack.pop()!,x=stack.pop()!,row=y*width;if(coverage[row+x]||mask.coverage[row+x]<128)continue
  let left=x,right=x;while(left>0&&!coverage[row+left-1]&&mask.coverage[row+left-1]>=128)left--;while(right+1<width&&!coverage[row+right+1]&&mask.coverage[row+right+1]>=128)right++
  coverage.set(mask.coverage.subarray(row+left,row+right+1),row+left)
  for(const ny of [y-1,y+1]){if(ny<0||ny>=height)continue;let inRun=false;for(let nx=left;nx<=right;nx++){const candidate=!coverage[ny*width+nx]&&mask.coverage[ny*width+nx]>=128;if(candidate&&!inRun)stack.push(nx,ny);inRun=candidate}}
 }
 // Keep a soft one-pixel fringe of the selected island without using low model
 // noise to flood through the background into a second foreground component.
 const hard=coverage.slice()
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(hard[i]||!mask.coverage[i]||mask.coverage[i]>=128)continue;if(x>0&&hard[i-1]||x+1<width&&hard[i+1]||y>0&&hard[i-width]||y+1<height&&hard[i+width])coverage[i]=mask.coverage[i]}
 return {...mask,coverage}
}
