import {EditorError,LIMITS,type Layer,type Transform} from '../shared/contracts'
import {transformSchema} from '../shared/transform'
import {MAX_DEEP_PIXELS as MAX_HDR_PIXELS} from '../shared/deep-pixels'
import {validateHDRPixels} from '../shared/hdr-pixels'
import {sourcePoint} from './raster-edit'
import {imageSizePlacement} from './image-size-raster'

export interface HDRRaster {width:number;height:number;hdr:Float32Array}
export const HDR_RESAMPLE_WORKING_BUDGET=512*1024*1024
export const HDR_RESAMPLE_COMPUTE_BUDGET=500_000_000
const clamp=(value:number,maximum=1)=>Math.max(0,Math.min(maximum,value))
function checkSource(source:HDRRaster):void {validateHDRPixels(source.hdr,source.width,source.height,0);if(source.width>LIMITS.maxSide||source.height>LIMITS.maxSide)throw new EditorError('RESOURCE_LIMIT','HDR source exceeds its maximum side budget.');}
/** Source x/y count from the top-left edge; first pixel center is (.5,.5).
 * Returns floating premultiplied Float32 extended-sRGB HDR, without premature integer quantization.
 */
export function sampleHDRBilinear(data:Float32Array,width:number,height:number,x:number,y:number,options:{edgeClamp?:boolean}={}):[number,number,number,number] {
 if(!Number.isFinite(x)||!Number.isFinite(y)||width<1||height<1||data.length!==width*height*4)throw new EditorError('INVALID_ARGUMENT','Invalid high-depth sample dimensions or coordinates.')
 const px=options.edgeClamp?Math.max(0,Math.min(width-1,x-.5)):x-.5,py=options.edgeClamp?Math.max(0,Math.min(height-1,y-.5)):y-.5,ix=Math.floor(px),iy=Math.floor(py),tx=px-ix,ty=py-iy,result:[number,number,number,number]=[0,0,0,0]
 for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){let sx=ix+xx,sy=iy+yy;if(options.edgeClamp){sx=Math.max(0,Math.min(width-1,sx));sy=Math.max(0,Math.min(height-1,sy))}else if(sx<0||sy<0||sx>=width||sy>=height)continue;const at=(sy*width+sx)*4,weight=(xx?tx:1-tx)*(yy?ty:1-ty);for(let c=0;c<4;c++)result[c]+=data[at+c]*weight}
 return result
}
function lanczos(x:number):number {const a=Math.abs(x);return a<1e-12?1:a>=3?0:Math.sin(Math.PI*a)*Math.sin(Math.PI*a/3)/(Math.PI*Math.PI*a*a/3)}
const HALVE_WEIGHTS=Float64Array.from({length:12},(_,i)=>lanczos((i-5.5)/2)),HALVE_TOTAL=HALVE_WEIGHTS.reduce((a,b)=>a+b,0)
/** True Float32 extended-sRGB HDR 2x Lanczos reduction; transparent padding and exact 2^level phase.
 * Unlike upstream DownsampleCache.halve's ARGB8888 allocation, no stage goes through 8 bits.
 */
function halveHDR(source:HDRRaster):HDRRaster {
 const width=Math.ceil(source.width/2),height=Math.ceil(source.height/2),horizontal=new Float32Array(width*source.height*4),hdr=new Float32Array(width*height*4)
 for(let y=0;y<source.height;y++)for(let x=0;x<width;x++)for(let k=0;k<12;k++){const sx=x*2+k-5;if(sx<0||sx>=source.width)continue;const weight=HALVE_WEIGHTS[k]/HALVE_TOTAL;for(let c=0;c<4;c++)horizontal[(y*width+x)*4+c]+=source.hdr[(y*source.width+sx)*4+c]*weight}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const values=[0,0,0,0];for(let k=0;k<12;k++){const sy=y*2+k-5;if(sy<0||sy>=source.height)continue;const weight=HALVE_WEIGHTS[k]/HALVE_TOTAL;for(let c=0;c<4;c++)values[c]+=horizontal[(sy*width+x)*4+c]*weight}const at=(y*width+x)*4,alpha=clamp(values[3]);hdr[at+3]=alpha;for(let c=0;c<3;c++)hdr[at+c]=alpha?values[c]:0}
 validateHDRPixels(hdr,width,height,0);return {width,height,hdr}
}
function levelFor(factor:number,sampling:Transform['sampling']):number {return sampling==='Nearest'||factor>=.5?0:Math.min(6,Math.floor(Math.log2(1/factor)))}
function preflight(source:HDRRaster,width:number,height:number,wanted:number):void {
 const count=width*height;if(!Number.isSafeInteger(count)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||count>MAX_HDR_PIXELS)throw new EditorError('RESOURCE_LIMIT','The high-depth resampling target exceeds its size budget.')
 let w=source.width,h=source.height,retained=0,temporary=0,work=count*32
 for(let level=0;level<wanted&&(w>1||h>1);level++){const nextW=Math.ceil(w/2),nextH=Math.ceil(h/2);temporary=Math.max(temporary,nextW*h*16);retained+=nextW*nextH*16;work+=(nextW*h+nextW*nextH)*48;w=nextW;h=nextH}
 const estimatedBytes=source.hdr.byteLength+count*16+retained+temporary
 if(estimatedBytes>HDR_RESAMPLE_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','High-depth resampling exceeds its 512 MiB working budget.',{estimatedBytes,maximumBytes:HDR_RESAMPLE_WORKING_BUDGET})
 if(work>HDR_RESAMPLE_COMPUTE_BUDGET)throw new EditorError('RESOURCE_LIMIT','High-depth resampling exceeds its compute budget.',{estimatedWork:work,maximumWork:HDR_RESAMPLE_COMPUTE_BUDGET})
}
function render(source:HDRRaster,placement:Transform,sx:number,sy:number,bounds:[number,number,number,number],sampling:Transform['sampling']):HDRRaster {
 checkSource(source);const transform=transformSchema.parse({...placement,sampling}),[left,top,width,height]=bounds,nearest=sampling==='Nearest',factor=transform.size[0]*sx/source.width,wanted=levelFor(factor,sampling)
 preflight(source,width,height,wanted)
 let sample=source,level=0
 while(level<wanted&&(sample.width>1||sample.height>1)){sample=halveHDR(sample);level++}
 const scale=2**level,extentW=sample.width*scale,extentH=sample.height*scale,hdr=new Float32Array(width*height*4),layer={transform} as Layer,angle=transform.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),uHalo=(Math.abs(c/sx)+Math.abs(s/sy))*source.width/transform.size[0]/2,vHalo=(Math.abs(s/sx)+Math.abs(c/sy))*source.height/transform.size[1]/2,copyFinal=transform.rotation===0&&Math.abs(factor*scale-1)<.001
 const uv=(x:number,y:number)=>sourcePoint(layer,x/sx,y/sy,source.width,source.height)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const [u,v]=uv(left+x+.5,top+y+.5),inside=nearest?u>=-uHalo-1e-9&&v>=-vHalo-1e-9&&u<=source.width+uHalo+1e-9&&v<=source.height+vHalo+1e-9:u>=0&&v>=0&&u<extentW&&v<extentH
  let coverage=inside?1:0
  if(!nearest&&!(inside&&u>=uHalo&&v>=vHalo&&u<extentW-uHalo&&v<extentH-vHalo)){coverage=0;for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++){const [a,b]=uv(left+x+(xx+.5)/4,top+y+(yy+.5)/4);if(a>=0&&b>=0&&a<extentW&&b<extentH)coverage+=1/16}}
  if(!coverage)continue
  const at=(y*width+x)*4
  if(nearest||copyFinal){const ix=Math.max(0,Math.min(sample.width-1,Math.floor(u/scale+1e-9))),iy=Math.max(0,Math.min(sample.height-1,Math.floor(v/scale+1e-9))),sampleAt=(iy*sample.width+ix)*4;const alpha=sample.hdr[sampleAt+3]*coverage;hdr[at+3]=alpha;for(let channel=0;channel<3;channel++)hdr[at+channel]=sample.hdr[sampleAt+channel]*coverage;continue}
  const values=sampleHDRBilinear(sample.hdr,sample.width,sample.height,u/scale,v/scale,{edgeClamp:true}),alpha=clamp(values[3]*coverage);hdr[at+3]=alpha;for(let channel=0;channel<3;channel++)hdr[at+channel]=alpha?values[channel]*coverage:0
 }
 validateHDRPixels(hdr,width,height,0);return {hdr,width,height}
}
/** Native ImageResizer placement geometry, portable Float32 sampling. Selection is
 * deliberately not an input: Image Size resamples whole layers and transforms
 * named selection channels separately; Root keeps that document transaction atomic.
 */
export function bakeHDRImageSizeRaster(source:HDRRaster,placement:Transform,sx:number,sy:number,sampling:Transform['sampling']='High quality'):HDRRaster&{transform:Transform} {
 const target=imageSizePlacement(transformSchema.parse({...placement,sampling}),sx,sy,sampling),output=render(source,placement,sx,sy,target.bounds,sampling)
 return {...output,transform:target.transform}
}
/** Document-space Float32 extended-sRGB HDR work canvas shared with Smudge/Liquify.
 * The existing retouch work grid samples directly with transparent-edge bilinear
 * interpolation irrespective of layer sampling; keep that geometry in Float32.
 */
export function sampleHDRLayerInDocument(source:HDRRaster,placement:Transform,canvasWidth:number,canvasHeight:number):HDRRaster {
 checkSource(source);const transform=transformSchema.parse(placement)
 preflight(source,canvasWidth,canvasHeight,0)
 const hdr=new Float32Array(canvasWidth*canvasHeight*4)
 for(let y=0;y<canvasHeight;y++)for(let x=0;x<canvasWidth;x++){
  const [u,v]=sourcePoint({transform},x+.5,y+.5,source.width,source.height),values=sampleHDRBilinear(source.hdr,source.width,source.height,u,v),at=(y*canvasWidth+x)*4,alpha=clamp(values[3])
  hdr[at+3]=alpha;for(let c=0;c<3;c++)hdr[at+c]=alpha?values[c]:0
 }
 validateHDRPixels(hdr,canvasWidth,canvasHeight,0);return {hdr,width:canvasWidth,height:canvasHeight}
}
