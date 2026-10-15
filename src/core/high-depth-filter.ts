import {progressiveBlurPixels,type ProgressiveBlurPlacement} from '../shared/progressive-blur'
import {PNG} from 'pngjs'
import {actionSchema,EditorError,LIMITS,type EditAction,type Layer,type Transform} from '../shared/contracts'
import {imageFilterSchema,type ImageFilter,type GaussianClampSides} from '../shared/image-filters'
import {applyDeepColorFilter,supportsDeepColorFilter} from '../shared/deep-color-filters'
import {runDeepFilter} from '../shared/deep-filter-run'
import {applyHDRColorFilter,normalizeHDR,restoreHDR,validateHDRPixels} from '../shared/hdr-pixels'
import {MAX_DEEP_PIXELS,MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {gaussianLineConvolver} from '../shared/image-filter-algorithms'
import {sampleHDRBilinear} from './hdr-resample'
import {filterMargin,gaussianCanvasSides,carryFilterMask} from './filter-edit'
import {placedRasterRect} from './stroke-raster'
import {documentPoint,selectionCoverage,encodeRaster} from './raster-edit'
import type {PixelStage} from './pixel-actions'
export type HighDepthFilterAction=Extract<EditAction,{type:'layer.filter'}>
export interface HighDepthFilterPrepared {deep?:Uint16Array;hdr?:Float32Array;width:number;height:number;transform:Transform;maskPNG?:Buffer}
const spatialKinds=new Set(['gaussianBlur','motionBlur','progressiveBlur','bloom'])
/** HDR geometric remapping must carry the original extended values; normalizing
 * a warped byte image and restoring destination scales cannot do that. */
export function assertHighDepthFilterSupported(input:unknown,hdr=false):ImageFilter {
 const filter=imageFilterSchema.parse(input)
 if(hdr&&(filter.kind==='threshold'||filter.kind==='posterize'))throw new EditorError('UNSUPPORTED_FEATURE','Threshold and Posterize support only 8/16-bit images. HDR source values are kept unchanged.')
 if(hdr&&filter.kind==='cameraRaw'){
  const g=filter.geometry,o=filter.optics
  if(['vertical','horizontal','rotate','aspect','scale','offsetX','offsetY'].some(k=>g[k as 'vertical']!==0)||g.upright==='Guided'&&g.guides.length||o.distortion||o.enableLensProfile&&o.profileDistortion||o.removeChromaticAberration)throw new EditorError('UNSUPPORTED_FEATURE','HDR Camera Raw geometry and optical distortion require an ordered floating-point pipeline. Use HDR Lens Correction separately.')
 }
 return filter
}
function checkSize(width:number,height:number,bytes=0):void {
 const count=width*height
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||count>MAX_DEEP_PIXELS||!Number.isSafeInteger(count)||bytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','High-depth filter exceeds its raster or 512 MiB working budget.',{width,height,estimatedBytes:bytes})
}
function convolutionBudget(width:number,height:number,sigma:number,axis:'both'|'x'|'y'='both'):void {
 const radius=Math.max(1,Math.ceil(sigma*3)),kernel=radius*2+1,pass=(n:number)=>{let padded=1;while(padded<n+radius*4)padded*=2;return {ops:kernel>33?3*padded*Math.log2(padded):n*kernel,bytes:kernel>33?padded*32:0}},x=pass(width),y=pass(height),work=4*((axis!=='y'?height*x.ops:0)+(axis!=='x'?width*y.ops:0)),bytes=width*height*68+x.bytes+y.bytes+kernel*16+(width+height)*16
 if(work>500_000_000||bytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','High-depth filter convolution exceeds its bounded work.',{estimatedWork:work,estimatedBytes:bytes})
}
function clean(output:Float32Array):Float32Array {
 for(let at=0;at<output.length;at+=4){output[at+3]=Math.max(0,Math.min(1,output[at+3]));if(!output[at+3])output.fill(0,at,at+3);for(let c=0;c<4;c++)if(!Number.isFinite(output[at+c]))throw new EditorError('RESOURCE_LIMIT','High-depth filter produced a non-finite working value.')}
 return output
}
/** Integrated Gaussian footprints with Float32 planes; no UNORM8 intermediate. */
function gaussian(source:Float32Array,width:number,height:number,sigma:number,sides:GaussianClampSides={},axis:'both'|'x'|'y'='both'):Float32Array {
 convolutionBudget(width,height,sigma,axis)
 const output=new Float32Array(source.length),temp=new Float32Array(width*height),row=new Float32Array(width),column=new Float32Array(height),horizontal=axis!=='y'?gaussianLineConvolver(width,sigma,{start:sides.left,end:sides.right}):undefined,vertical=axis!=='x'?gaussianLineConvolver(height,sigma,{start:sides.top,end:sides.bottom}):undefined
 for(let c=0;c<4;c++){
  for(let y=0;y<height;y++){for(let x=0;x<width;x++)row[x]=source[(y*width+x)*4+c];temp.set(horizontal?horizontal(row):row,y*width)}
  for(let x=0;x<width;x++){for(let y=0;y<height;y++)column[y]=temp[y*width+x];const result=vertical?vertical(column):column;for(let y=0;y<height;y++)output[(y*width+x)*4+c]=result[y]}
 }
 return clean(output)
}
function motion(source:Float32Array,width:number,height:number,distance:number,angle:number,sides:GaussianClampSides={}):Float32Array {
 const sigma=distance/Math.sqrt(12)
 if(Math.abs(angle%90)<1e-8)return gaussian(source,width,height,sigma,sides,Math.abs(Math.sin(angle*Math.PI/180))>.5?'y':'x')
 const r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r),corners=[[0,0],[width,0],[0,height],[width,height]],u=corners.map(([x,y])=>x*c+(height-y)*s),v=corners.map(([x,y])=>-x*s+(height-y)*c),padding=Object.values(sides).some(Boolean)?Math.ceil(sigma*3)+1:1,left=Math.floor(Math.min(...u))-padding,top=Math.floor(Math.min(...v))-padding,w=Math.ceil(Math.max(...u))-left+padding,h=Math.ceil(Math.max(...v))-top+padding
 checkSize(w,h,source.byteLength*2+w*h*68);convolutionBudget(w,h,sigma,'x')
 const transformed=new Float32Array(w*h*4)
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=x+left+.5,b=y+top+.5;let sx=a*c-b*s,sy=height-(a*s+b*c);if(sides.left&&sx<.5)sx=.5;if(sides.right&&sx>width-.5)sx=width-.5;if(sides.top&&sy<.5)sy=.5;if(sides.bottom&&sy>height-.5)sy=height-.5;transformed.set(sampleHDRBilinear(source,width,height,sx,sy),(y*w+x)*4)}
 const soft=gaussian(transformed,w,h,sigma,{},'x'),out=new Float32Array(source.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=(x+.5)*c+(height-y-.5)*s,b=-(x+.5)*s+(height-y-.5)*c;out.set(sampleHDRBilinear(soft,w,h,a-left,b-top),(y*width+x)*4)}
 return clean(out)
}
function lens(source:Float32Array,width:number,height:number,distortion:number):Float32Array {
 if(!distortion)return source.slice()
 const out=new Float32Array(source.length),cx=width/2,cy=height/2,diag=cx*cx+cy*cy
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=x+.5-cx,dy=y+.5-cy,factor=1-distortion/100*.35*(dx*dx+dy*dy)/diag;out.set(sampleHDRBilinear(source,width,height,cx+dx*factor,cy+dy*factor),(y*width+x)*4)}
 return clean(out)
}
function spatial(source:Float32Array,width:number,height:number,filter:ImageFilter,sides:GaussianClampSides,placement?:ProgressiveBlurPlacement):Float32Array {
 if(filter.kind==='gaussianBlur'){
  const out=gaussian(source,width,height,filter.radius,sides)
  if(filter.preserveTransparency)for(let at=0;at<out.length;at+=4){const a=source[at+3],softAlpha=out[at+3];for(let c=0;c<3;c++)out[at+c]=a&&softAlpha?out[at+c]*a/softAlpha:0;out[at+3]=a}
  return clean(out)
 }
 if(filter.kind==='progressiveBlur')return clean(progressiveBlurPixels(source,width,height,filter,sides,placement))
 if(filter.kind==='motionBlur')return motion(source,width,height,filter.distance,filter.angle,sides)
 if(filter.kind==='bloom'){
  if(!filter.amount)return source.slice()
  // Portable Bloom's established color behavior; Core Image CIBloom internals
  // are private and this is not an assertion of native GPU pixel identity.
  const soft=gaussian(source,width,height,filter.radius),out=new Float32Array(source.length)
  for(let at=0;at<out.length;at++)out[at]=Math.max(source[at],source[at]+(soft[at]-source[at])*filter.amount/50)
  return clean(out)
 }
 throw new EditorError('UNSUPPORTED_FEATURE','Unsupported floating-point spatial filter.')
}
/** Same-grid spatial kernel shared with adjustment compositing. The caller owns
 * geometry and alpha restoration; this never expands or byte-normalizes pixels. */
export function applyHighDepthSpatialPixels(source:Float32Array,width:number,height:number,input:unknown):Float32Array {
 const filter=imageFilterSchema.parse(input)
 if(!spatialKinds.has(filter.kind))throw new EditorError('UNSUPPORTED_FEATURE','Expected a floating-point spatial filter.')
 checkSize(width,height,source.byteLength+width*height*64);validateHDRPixels(source,width,height,0)
 return spatial(source,width,height,filter,{})
}
/** Source stays canonical16/HDR until the resulting asset is encoded by caller. */
export function prepareHighDepthFilter(stage:PixelStage,input:HighDepthFilterAction):HighDepthFilterPrepared {
 const action=actionSchema.parse(input) as HighDepthFilterAction
 if(action.type!=='layer.filter')throw new EditorError('INVALID_ARGUMENT','Expected a destructive image filter.')
 const layer=stage.manifest.layers.find(v=>v.id===action.layerId),asset=layer?.imageFile?stage.assets.get(layer.imageFile):undefined
 if(!layer||!asset||asset.bitDepth!==16||!(asset.hdr||asset.deep)||layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a high-depth image layer for this filter.')
 const hdr=asset.hdr,deep=asset.deep,isHDR=!!hdr,w=asset.width,h=asset.height,original=hdr??deep!,filter=assertHighDepthFilterSupported(action.filter,isHDR)
 checkSize(w,h,original.byteLength+asset.bytes.length+(asset.displayBytes?.length??0)+w*h*(filter.kind==='cameraRaw'?360:160))
 if(hdr)validateHDRPixels(hdr,w,h,0)
 else {if(!(deep instanceof Uint16Array)||deep.length!==w*h*4)throw new EditorError('INVALID_PROJECT','Invalid high-depth filter source.');for(let at=0;at<deep.length;at+=4)if(deep[at]>deep[at+3]||deep[at+1]>deep[at+3]||deep[at+2]>deep[at+3])throw new EditorError('INVALID_PROJECT','Expected premultiplied high-depth source.')}
 const unchanged=():HighDepthFilterPrepared=>({...(hdr?{hdr}:{deep}),width:w,height:h,transform:structuredClone(layer.transform)})
 if(stage.selection&&!stage.selection.shapes.length&&!stage.selection.inverted)return unchanged()
 if(filter.kind==='progressiveBlur'&&!filter.from&&!filter.to||filter.kind==='bloom'&&!filter.amount||filter.kind==='lensCorrection'&&!filter.distortion)return unchanged()
 const margin=filterMargin(filter),sides=(filter.kind==='gaussianBlur'&&!filter.preserveTransparency||filter.kind==='motionBlur'||filter.kind==='progressiveBlur')?gaussianCanvasSides(layer.transform,w,h,[stage.manifest.width,stage.manifest.height]):{},left=sides.left?0:margin,top=sides.top?0:margin,right=sides.right?0:margin,bottom=sides.bottom?0:margin,width=w+left+right,height=h+top+bottom,count=width*height,mask=layer.maskFile?stage.assets.get(layer.maskFile):undefined
 checkSize(width,height,original.byteLength+asset.bytes.length+(asset.displayBytes?.length??0)+count*(filter.kind==='cameraRaw'?420:180)+(mask?mask.bytes.length+mask.width*mask.height*12:0))
 let transform=margin?placedRasterRect(layer.transform,w,h,-left,-top,width,height):structuredClone(layer.transform)
 let base:Float32Array|Uint16Array=original
 if(margin){base=hdr?new Float32Array(count*4):new Uint16Array(count*4);for(let y=0;y<h;y++)base.set(original.subarray(y*w*4,(y+1)*w*4),((y+top)*width+left)*4)}
 let output:Float32Array|Uint16Array
 if(spatialKinds.has(filter.kind)){
  const floating=base instanceof Float32Array?base:Float32Array.from(base,v=>v/65535),result=spatial(floating,width,height,filter,sides,transform)
  output=isHDR?result:Uint16Array.from(result,(v,i)=>Math.round(Math.max(0,Math.min(i%4===3?65535:result[i-i%4+3]*65535,v*65535))))
 }else if(hdr){
  if(supportsDeepColorFilter(filter))output=applyHDRColorFilter(base as Float32Array,width,height,filter)
  else if(filter.kind==='lensCorrection')output=lens(base as Float32Array,width,height,filter.distortion)
  else {const normalized=normalizeHDR(base as Float32Array,width,height);output=restoreHDR(runDeepFilter(normalized.normal,width,height,filter),normalized.scales,width,height)}
 }else output=supportsDeepColorFilter(filter)?applyDeepColorFilter(base as Uint16Array,width,height,filter):runDeepFilter(base as Uint16Array,width,height,filter)
 if(stage.selection)for(let y=0;y<height;y++)for(let x=0;x<width;x++){const point=documentPoint({transform} as Layer,x+.5,y+.5,width,height),amount=selectionCoverage(stage.selection,...point),at=(y*width+x)*4;for(let c=0;c<4;c++)output[at+c]=amount===0?base[at+c]:amount===1?output[at+c]:isHDR?base[at+c]+(output[at+c]-base[at+c])*amount:Math.round(base[at+c]+(output[at+c]-base[at+c])*amount)}
 let resultWidth=width,resultHeight=height
 if(margin){let x0=width,y0=height,x1=0,y1=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(output[(y*width+x)*4+3]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1)}
  if(x1&&(x0||y0||x1!==width||y1!==height)){resultWidth=x1-x0;resultHeight=y1-y0;const trimmed=isHDR?new Float32Array(resultWidth*resultHeight*4):new Uint16Array(resultWidth*resultHeight*4);for(let y=0;y<resultHeight;y++)trimmed.set(output.subarray(((y+y0)*width+x0)*4,((y+y0)*width+x1)*4),y*resultWidth*4);transform=placedRasterRect(transform,width,height,x0,y0,resultWidth,resultHeight);output=trimmed}
 }
 if(hdr)validateHDRPixels(output as Float32Array,resultWidth,resultHeight,0)
 if(resultWidth===w&&resultHeight===h&&JSON.stringify(transform)===JSON.stringify(layer.transform)&&output.every((v,i)=>v===original[i]))return unchanged()
 let maskPNG:Buffer|undefined
 if(layer.maskFile&&layer.maskLinked!==false&&!layer.maskPlacement&&(resultWidth!==w||resultHeight!==h||JSON.stringify(transform)!==JSON.stringify(layer.transform))){if(!mask)throw new EditorError('ASSET_NOT_FOUND','The linked filter mask is missing.');if(mask.bytes[24]!==8||mask.bytes[25]!==0)throw new EditorError('INVALID_PROJECT','Expected a PNG8 grayscale layer mask.');const old=PNG.sync.read(mask.bytes,{checkCRC:true});maskPNG=encodeRaster(carryFilterMask(old,layer.transform,{png:{width:resultWidth,height:resultHeight} as PNG,transform,grew:true}),true)}
 return {...(isHDR?{hdr:output as Float32Array}:{deep:output as Uint16Array}),width:resultWidth,height:resultHeight,transform,...(maskPNG?{maskPNG}:{})}
}
