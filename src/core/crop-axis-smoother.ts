/** Photoshop's RGB8 Perspective axis enlargement path, recovered with REA.
 * Keep the qualification narrow: half-phase, ambiguous bounds and textured
 * hidden RGB continue through the established general crop sampler. */
import type {Layer} from '../shared/contracts'
import type {CropCorners} from '../shared/crop-projective'
type Source={width:number;height:number;data:Uint8Array}
export type CropAxisSmootherPlan={
 sourceWidth:number;sourceHeight:number;width:number;height:number
 left:number;top:number;right:number;bottom:number
 outputLeft:number;outputTop:number;outputRight:number;outputBottom:number
 constantRGB:readonly [number,number,number]|null
 samples:number;scratchBytes:number
}
const round=(value:number)=>Math.floor(value+.5)
const quantize=(value:number)=>Math.max(0,Math.min(255,round(value)))
function keys(value:number):number{
 const x=Math.abs(value),a=-.625
 return x<1?1-(a+3)*x*x+(a+2)*x*x*x:x<2?a*x*x*x-5*a*x*x+8*a*x-4*a:0
}
// Native enum3: width1.15, 128 phases, six taps and a normalized 14bit table.
// Truncate first, then put the remainder in the largest weight (first on ties).
const weights=Array.from({length:128},(_,phase)=>{
 const values=Array.from({length:6},(_,tap)=>keys((tap-2-phase/128)/1.15)),sum=values.reduce((a,b)=>a+b,0)
 for(let tap=0;tap<6;tap++)values[tap]=Math.trunc(values[tap]/sum*16384)
 let largest=0
 for(let tap=1;tap<6;tap++)if(values[tap]>values[largest])largest=tap
 values[largest]+=16384-values.reduce((a,b)=>a+b,0)
 return Int16Array.from(values)
})
export function cropAxisSmootherGeometry(source:{width:number;height:number},placement:Layer['transform'],corners:CropCorners,width:number,height:number):boolean{
 return source.width%2===0&&source.height%2===0&&width>source.width&&height>source.height&&placement.origin[0]===0&&placement.origin[1]===0&&placement.size[0]===source.width&&placement.size[1]===source.height&&placement.rotation===0&&!placement.flipX&&!placement.flipY&&corners[0][0]===0&&corners[0][1]===0&&corners[1][0]===source.width&&corners[1][1]===0&&corners[2][0]===source.width&&corners[2][1]===source.height&&corners[3][0]===0&&corners[3][1]===source.height
}
function coordinate(value:number,size:number):readonly [number,number]{
 const index=Math.max(0,Math.min((size-1)*128,round((value-.5)*128)))
 return [Math.floor(index/128),index%128]
}
/** Caller charges the source scan even when qualification declines. */
export function planCropAxisSmoother(source:Source,width:number,height:number):CropAxisSmootherPlan|null{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=source.width||height<=source.height||source.width%2||source.height%2)return null
 let left=source.width,top=source.height,right=0,bottom=0,visible=0,constant=true,color:readonly [number,number,number]|null=null
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
  const at=(y*source.width+x)*4
  if(!source.data[at+3])continue
  visible++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)
  if(!color)color=[source.data[at],source.data[at+1],source.data[at+2]]
  else if(constant&&(source.data[at]!==color[0]||source.data[at+1]!==color[1]||source.data[at+2]!==color[2]))constant=false
 }
 if(!visible)return null
 const projected=[left*width/source.width,right*width/source.width,top*height/source.height,bottom*height/source.height]
 if(projected.some(value=>Math.abs(value-Math.floor(value)-.5)<1e-7))return null
 // Invisible source RGB is not a reliable Photoshop input. Only a constant
 // visible color has a proved extension across internal zero-alpha pixels.
 if(visible<(right-left)*(bottom-top)&&!constant)return null
 const [outputLeft,outputRight,outputTop,outputBottom]=projected.map(round),outputWidth=outputRight-outputLeft,outputHeight=outputBottom-outputTop
 return {sourceWidth:source.width,sourceHeight:source.height,width,height,left,top,right,bottom,outputLeft,outputTop,outputRight,outputBottom,constantRGB:constant?color:null,
  samples:width*height+6*(outputWidth*(bottom-top)+outputWidth*outputHeight),
  scratchBytes:width*(bottom-top)*4+width*5}
}
/** H then V is the native Perspective plan order, including unequal scales.
 * RGB and alpha are independent channels; integer rounding/clipping happens
 * after each pass. A0 constant-color extension happens on read, without a copy
 * or a write to the immutable source. Output may alias no source storage. */
export function renderCropAxisSmoother(source:Source,plan:CropAxisSmootherPlan,output:Uint8Array):void{
 const {width,height,left,top,right,bottom,outputLeft,outputTop,outputRight,outputBottom}=plan,contentWidth=right-left,contentHeight=bottom-top
 const intermediate=new Uint8Array(width*contentHeight*4),indices=new Int32Array(width),phases=new Uint8Array(width)
 for(let at=0;at<output.length;at+=4)output.set([255,255,255,0],at)
 for(let x=outputLeft;x<outputRight;x++){
  const [index,phase]=coordinate((x+.5)*source.width/width-left,contentWidth)
  indices[x]=index;phases[x]=phase
 }
 for(let y=0;y<contentHeight;y++)for(let x=outputLeft;x<outputRight;x++){
  const taps=weights[phases[x]],index=indices[x],out=(y*width+x)*4
  for(let channel=0;channel<4;channel++){
   let sum=0
   for(let tap=0;tap<6;tap++){
    let sx=index+tap-2
    if(channel<3)sx=Math.max(0,Math.min(contentWidth-1,sx))
    if(sx<0||sx>=contentWidth)continue
    const at=((y+top)*source.width+sx+left)*4
    const value=channel<3&&plan.constantRGB&&source.data[at+3]===0?plan.constantRGB[channel]:source.data[at+channel]
    sum+=value*taps[tap]
   }
   intermediate[out+channel]=quantize(sum/16384)
  }
 }
 for(let y=outputTop;y<outputBottom;y++){
  const [index,phase]=coordinate((y+.5)*source.height/height-top,contentHeight),taps=weights[phase]
  for(let x=outputLeft;x<outputRight;x++)for(let channel=0;channel<4;channel++){
   let sum=0
   for(let tap=0;tap<6;tap++){
    let sy=index+tap-2
    if(channel<3)sy=Math.max(0,Math.min(contentHeight-1,sy))
    if(sy>=0&&sy<contentHeight)sum+=intermediate[(sy*width+x)*4+channel]*taps[tap]
   }
   output[(y*width+x)*4+channel]=quantize(sum/16384)
  }
 }
}
