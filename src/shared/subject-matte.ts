import {EditorError} from './contracts'
import {gaussianSelectionCoverage} from './selection-gaussian'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'
export interface SubjectMatteSettings {quality?:'basic'|'advanced';refineEdges?:number;matteContrast?:number;shiftEdge?:number}
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
/** Refine -> Shift Edge -> Contrast, matching SubjectRemoval.refined ordering.
 * Image-to-gray uses explicit sRGB luminance for portability. Core Graphics's
 * DeviceGray conversion can differ, so model/color-conversion pixel equality
 * must be measured separately from the shared filter equations. */
export function refineSubjectMatte(mask:RasterSelection,guide:RGBAImage,settings:SubjectMatteSettings={}):RasterSelection {
 const count=mask.width*mask.height
 if(count!==mask.coverage.length||guide.width!==mask.width||guide.height!==mask.height||guide.data.length!==count*4)throw new EditorError('INVALID_ARGUMENT','Matte and guide must have equal dimensions.')
 const refine=settings.refineEdges??12,contrast=settings.matteContrast??25,shift=settings.shiftEdge??0
 if(!Number.isFinite(refine)||refine<0||refine>40||!Number.isFinite(contrast)||contrast<0||contrast>100||!Number.isFinite(shift)||Math.abs(shift)>10)throw new EditorError('INVALID_ARGUMENT','Matte refinement settings are outside native ranges.')
 let coverage=mask.coverage.slice()
 if(settings.quality!=='advanced')return {...mask,coverage}
 if(count>32_000_000)throw new EditorError('RESOURCE_LIMIT','Advanced matte refinement is limited to 32 megapixels.')
 if(refine>0){const levels=new Float32Array(count),gray=new Float32Array(count);for(let i=0;i<count;i++){levels[i]=coverage[i]/255;const at=i*4;gray[i]=(.2126*guide.data[at]+.7152*guide.data[at+1]+.0722*guide.data[at+2])/255*guide.data[at+3]/255}
  const refined=guidedMatteFilter(levels,gray,mask.width,mask.height,Math.max(1,Math.round(refine)))
  coverage=Uint8Array.from(refined,value=>Math.round(value*255))
 }
 if(shift){const blurred=gaussianSelectionCoverage(coverage,mask.width,mask.height,Math.abs(shift)),level=shift<0?.75:.25;coverage=Uint8Array.from(blurred,value=>Math.round(255*Math.max(0,Math.min(1,(value/255-level)/.001))))}
 if(contrast>0){const slope=Math.fround(1/Math.max(.02,1-contrast/100*.98)),bias=Math.fround((1-slope)/2);coverage=Uint8Array.from(coverage,value=>Math.round(255*Math.max(0,Math.min(1,Math.fround(Math.fround(value/255)*slope)+bias))))}
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
