import {EditorError} from './errors'
import {validateCameraImage,type CameraImage} from './camera-raw-kernels'
import {CAMERA_RAW_SHADOWS_RESOURCE_BASE64} from './camera-raw-shadows-data'

type ShadowsTables={normalFrom:number;amounts:number[];coefficients:Float32Array[][];xCount:number;kCount:number;xLow:number;xStep:number;kLow:number;kStep:number}
const F=Math.fround,clamp=(v:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v))
const decode=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4
const encode=(v:number)=>v<=0?0:v>=1?1:v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055
const decoded=Float64Array.from({length:256},(_,i)=>decode(i/255)),floorY=1/8192
let tables:ShadowsTables|undefined
/** Shared preflight before conversion or workspace allocation. */
export function assertCameraRawShadowsBudget(width:number,height:number):void{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new EditorError('INVALID_ARGUMENT','Invalid Camera Raw Shadows pixel source or scale.')
 const scale=Math.max(1,Math.floor(Math.min(width,height)/384)),cells=Math.ceil(width/scale)*Math.ceil(height/scale)
 if(width*height*16+cells*28+4_000_000>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Camera Raw Shadows exceeds its 512 MiB working budget.')
}
/** Strict CRS2 parser. Malformed fitted data fails rather than silently dropping Shadows. */
export function cameraRawShadowsTables(bytes?:Uint8Array):ShadowsTables{
 if(!bytes&&tables)return tables
 const bundled=!bytes
 if(!bytes){const raw=atob(CAMERA_RAW_SHADOWS_RESOURCE_BASE64);bytes=Uint8Array.from(raw,c=>c.charCodeAt(0))}
 const bad=()=>{throw new EditorError('INVALID_ARGUMENT','Invalid Camera Raw Shadows coefficient resource.')}
 if(bytes.length<34||String.fromCharCode(...bytes.subarray(0,4))!=='CRS2')return bad()
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),sets=view.getInt16(4,true),amountCount=view.getInt16(6,true),xCount=view.getInt16(8,true),kCount=view.getInt16(10,true),terms=view.getInt16(12,true)
 if(sets!==2||amountCount<1||amountCount>100||xCount<2||xCount>1000||kCount<1||kCount>1000||terms!==3||bytes.length!==34+amountCount*4+sets*amountCount*xCount*kCount*terms*4)return bad()
 const [normalFrom,xLow,xStep,kLow,kStep]=Array.from({length:5},(_,i)=>view.getFloat32(14+i*4,true))
 if(![normalFrom,xLow,xStep,kLow,kStep].every(Number.isFinite)||normalFrom<=0||xStep<=0||kStep<=0)return bad()
 const amounts=Array.from({length:amountCount},(_,i)=>view.getFloat32(34+i*4,true))
 if(amounts.some((v,i)=>!Number.isFinite(v)||v===0||Math.abs(v)>100||i>0&&v<=amounts[i-1]))return bad()
 const count=xCount*kCount*terms,offset=34+amountCount*4,coefficients=Array.from({length:sets},(_,s)=>Array.from({length:amountCount},(_,a)=>Float32Array.from({length:count},(_,i)=>view.getFloat32(offset+((s*amountCount+a)*count+i)*4,true))))
 if(coefficients.some(set=>set.some(values=>values.some(v=>!Number.isFinite(v)))))return bad()
 const result={normalFrom,amounts,coefficients,xCount,kCount,xLow,xStep,kLow,kStep}
 // Explicit buffers are validation inputs, never replacements for bundled data.
 if(bundled)tables=result
 return result
}
export function cameraRawShadowsCoefficients(amount:number,set:number,resource=cameraRawShadowsTables()):Float32Array{
 if(!Number.isFinite(amount)||!Number.isInteger(set)||set<0||set>=resource.coefficients.length)throw new EditorError('INVALID_ARGUMENT','Invalid Camera Raw Shadows amount or coefficient set.')
 const points:{value:number;coefficients?:Float32Array}[]=resource.amounts.map((value,i)=>({value,coefficients:resource.coefficients[set][i]}))
 points.push({value:0});points.sort((a,b)=>a.value-b.value)
 const value=clamp(amount,points[0].value,points.at(-1)!.value);let index=0
 while(index<points.length-2&&value>points[index+1].value)index++
 const low=points[index],high=points[index+1],t=F((value-low.value)/(high.value-low.value)),one=F(1-t)
 return Float32Array.from({length:resource.xCount*resource.kCount*3},(_,i)=>F(F((low.coefficients?.[i]??0)*one)+F((high.coefficients?.[i]??0)*t)))
}
/** Upstream's square means shrink at image edges, unlike the older effects box filter. */
export function cameraRawShadowsBoxMean(source:Float32Array,destination:Float32Array,width:number,height:number,radius:number,scratch:Float32Array):void{
 if(source.length!==width*height||destination.length!==source.length||scratch.length!==source.length||source===destination||source===scratch||destination===scratch||!Number.isInteger(radius)||radius<1)throw new EditorError('INVALID_ARGUMENT','Invalid Camera Raw Shadows box mean surface.')
 for(let y=0;y<height;y++){let sum=0,lo=0,hi=0;const row=y*width;for(let x=0;x<width;x++){const wantLo=Math.max(0,x-radius),wantHi=Math.min(width,x+radius+1);while(hi<wantHi)sum+=source[row+hi++];while(lo<wantLo)sum-=source[row+lo++];scratch[row+x]=sum/(hi-lo)}}
 for(let x=0;x<width;x++){let sum=0,lo=0,hi=0;for(let y=0;y<height;y++){const wantLo=Math.max(0,y-radius),wantHi=Math.min(height,y+radius+1);while(hi<wantHi)sum+=scratch[hi++*width+x];while(lo<wantLo)sum-=scratch[lo++*width+x];destination[y*width+x]=sum/(hi-lo)}}
}
/** Bounded portable 735c2cc C pass, on canonical premultiplied RGBA8.
 * No original RGB16/HDR source is converted here; their existing probe runner owns reconstruction. */
export function cameraRawShadowsPremultiplied(source:Uint8Array,width:number,height:number,amount:number,samplingScale=1):Uint8Array{
 if(!(source instanceof Uint8Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||source.length!==width*height*4||!Number.isFinite(amount)||Math.abs(amount)>100||!Number.isFinite(samplingScale)||samplingScale<=0||samplingScale>128)throw new EditorError('INVALID_ARGUMENT','Invalid Camera Raw Shadows pixel source or scale.')
 if(!amount)return source.slice()
 assertCameraRawShadowsBudget(width,height)
 const resource=cameraRawShadowsTables(),coefficients=cameraRawShadowsCoefficients(amount,Math.max(width,height)/samplingScale>=resource.normalFrom?1:0,resource),scale=Math.max(1,Math.floor(Math.min(width,height)/384)),lw=Math.ceil(width/scale),lh=Math.ceil(height/scale),cells=lw*lh
 const luminanceAt=(at:number)=>{const alpha=source[at+3];return .2126*(alpha===255?decoded[source[at]]:decode(Math.min(1,source[at]/alpha)))+.7152*(alpha===255?decoded[source[at+1]]:decode(Math.min(1,source[at+1]/alpha)))+.0722*(alpha===255?decoded[source[at+2]]:decode(Math.min(1,source[at+2]/alpha)))}
 // Preserve the native 32-band summation order for the reference brightness.
 const rows=Math.ceil(height/32);let total=0,count=0,all=0,allCount=0
 for(let band=0;band<32;band++){let bandTotal=0,bandCount=0,bandAll=0,bandAllCount=0;for(let y=band*rows;y<Math.min(height,(band+1)*rows);y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;if(!source[at+3])continue;const luminance=luminanceAt(at),v=source[at+1];bandAll+=luminance;bandAllCount++;if(x>0&&source[at-3]!==v||x+1<width&&source[at+5]!==v||y>0&&source[at-width*4+1]!==v||y+1<height&&source[at+width*4+1]!==v){bandTotal+=luminance;bandCount++}}total+=bandTotal;count+=bandCount;all+=bandAll;allCount+=bandAllCount}
 const key=Math.log2(Math.max(floorY,count?total/count:allCount?all/allCount:.18)),low=new Float32Array(cells),weight=new Float32Array(cells),mean=new Float32Array(cells),square=new Float32Array(cells),a=new Float32Array(cells),b=new Float32Array(cells),scratch=weight
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=(y*width+x)*4;if(!source[at+3])continue;const index=Math.floor(y/scale)*lw+Math.floor(x/scale);low[index]=F(low[index]+F(Math.log2(Math.max(floorY,luminanceAt(at)))));weight[index]++}
 for(let i=0;i<cells;i++)low[i]=weight[i]?low[i]/weight[i]:key
 const radius=Math.max(1,Math.round(.25*Math.min(lw,lh))),box=(src:Float32Array,dst:Float32Array)=>cameraRawShadowsBoxMean(src,dst,lw,lh,radius,scratch)
 box(low,mean);for(let i=0;i<cells;i++)a[i]=F(low[i]*low[i]);box(a,square)
 for(let i=0;i<cells;i++){const variance=F(Math.max(0,F(square[i]-F(mean[i]*mean[i]))));a[i]=F(variance/F(variance+1.5));b[i]=F(mean[i]-F(a[i]*mean[i]))}
 box(a,mean);box(b,square)
 const output=source.slice(),plane=resource.xCount*resource.kCount,kp=clamp((key-resource.kLow)/resource.kStep,0,resource.kCount-1),k0=Math.min(resource.kCount-1,Math.floor(kp)),k1=Math.min(resource.kCount-1,k0+1),kt=kp-k0
 for(let y=0;y<height;y++){const fy=clamp((y+.5)/scale-.5,0,lh-1),y0=Math.floor(fy),y1=Math.min(lh-1,y0+1),ty=fy-y0;for(let x=0;x<width;x++){const at=(y*width+x)*4,alpha=source[at+3];if(!alpha)continue;const luminance=luminanceAt(at);if(luminance<=floorY)continue;const fx=clamp((x+.5)/scale-.5,0,lw-1),x0=Math.floor(fx),x1=Math.min(lw-1,x0+1),tx=fx-x0
  const sa=(mean[y0*lw+x0]*(1-tx)+mean[y0*lw+x1]*tx)*(1-ty)+(mean[y1*lw+x0]*(1-tx)+mean[y1*lw+x1]*tx)*ty,sb=(square[y0*lw+x0]*(1-tx)+square[y0*lw+x1]*tx)*(1-ty)+(square[y1*lw+x0]*(1-tx)+square[y1*lw+x1]*tx)*ty
  const level=Math.log2(luminance),region=sa*level+sb,detail=level-region,xp=clamp((region-key-resource.xLow)/resource.xStep,0,resource.xCount-1),xc=Math.min(resource.xCount-2,Math.floor(xp)),xt=xp-xc
  // No closure or terms array per full-size pixel; preserve native term order.
  let lift=0
  for(let t=0;t<3;t++){const base=t*plane,row0=coefficients[base+k0*resource.xCount+xc]*(1-xt)+coefficients[base+k0*resource.xCount+xc+1]*xt,row1=coefficients[base+k1*resource.xCount+xc]*(1-xt)+coefficients[base+k1*resource.xCount+xc+1]*xt,term=row0*(1-kt)+row1*kt;lift+=term*(t===0?1:t===1?Math.max(detail,0):Math.min(detail,0))}
  const gain=2**lift
  for(let c=0;c<3;c++){const color=alpha===255?decoded[source[at+c]]:decode(Math.min(1,source[at+c]/alpha));output[at+c]=Math.round(encode(color*gain)*alpha)}
 }}
 return output
}
export function cameraRawShadows(image:CameraImage,amount:number,samplingScale=1):CameraImage{
 validateCameraImage(image);if(!amount)return image
 assertCameraRawShadowsBudget(image.width,image.height)
 const premultiplied=new Uint8Array(image.data.length)
 for(let at=0;at<premultiplied.length;at+=4){const alpha=image.data[at+3];for(let c=0;c<3;c++)premultiplied[at+c]=Math.round(image.data[at+c]*alpha/255);premultiplied[at+3]=alpha}
 const output=cameraRawShadowsPremultiplied(premultiplied,image.width,image.height,amount,samplingScale),data=new Uint8ClampedArray(image.data)
 for(let at=0;at<data.length;at+=4){const alpha=data[at+3];if(alpha)for(let c=0;c<3;c++)data[at+c]=Math.min(255,Math.round(output[at+c]*255/alpha))}
 return {...image,data}
}
