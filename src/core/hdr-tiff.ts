import {inflateSync} from 'node:zlib'
import {EditorError,LIMITS} from '../shared/contracts'
import {inspectICC} from './foreign-color'
import {extendedSRGBFromLinear,exrHalfToFloat,HDR_CODEC_BUDGET,type HDRRaster} from './hdr-codecs'

function invalid(message:string):never{throw new EditorError('INVALID_ARGUMENT',message)}
function unsupported(message:string):never{throw new EditorError('UNSUPPORTED_FEATURE',message)}
interface TIFFHeader {width:number;height:number;depth:number;samples:number;compression:number;orientation:number;predictor:number;planar:number;rows:number;offsets:number[];lengths:number[];little:boolean;associated:boolean;matrix?:number[];warnings:string[];estimatedBytes:number}
/** First classic-TIFF image only. Ordinary integer TIFF returns undefined. */
export function inspectFloatTIFF(bytes:Buffer):TIFFHeader|undefined {
 if(bytes.length>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','TIFF exceeds encoded asset limits.')
 const signature=bytes.toString('ascii',0,2),little=signature==='II'
 if(!['II','MM'].includes(signature))return
 const bounds=(at:number,size:number)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(size)||at<0||size<0||at+size>bytes.length)invalid('Truncated TIFF range.')}
 const u16=(at:number)=>{bounds(at,2);return little?bytes.readUInt16LE(at):bytes.readUInt16BE(at)},u32=(at:number)=>{bounds(at,4);return little?bytes.readUInt32LE(at):bytes.readUInt32BE(at)}
 if(u16(2)!==42)unsupported('Float BigTIFF requires explicit conversion to classic TIFF or EXR.')
 const ifd=u32(4),count=u16(ifd);if(count>4096)invalid('Excessive TIFF directory.');bounds(ifd+2,count*12+4)
 const tags=new Map<number,number[]>();let profile:Buffer|undefined,colorimetry=false
 for(let i=0;i<count;i++){
  const at=ifd+2+i*12,id=u16(at),type=u16(at+2),n=u32(at+4)
  if(![256,257,258,259,262,266,273,274,277,278,279,284,301,317,318,319,322,323,324,325,338,339,34675].includes(id))continue
  if([301,318,319].includes(id)){colorimetry=true;continue}
  if(id===34675){if(profile||![1,7].includes(type)||n<132||n>1024*1024)invalid('Invalid TIFF ICC tag.');const start=u32(at+8);bounds(start,n);profile=bytes.subarray(start,start+n);continue}
  const maximumCount=[273,279,324,325].includes(id)?120_000:[258,338,339].includes(id)?4:1
  if(![1,3,4].includes(type)||n<1||n>maximumCount||tags.has(id))invalid('Invalid or duplicate TIFF metadata tag.')
  const size=type===1?1:type===3?2:4,start=n*size<=4?at+8:u32(at+8);bounds(start,n*size)
  tags.set(id,Array.from({length:n},(_,p)=>type===1?bytes[start+p]:type===3?u16(start+p*2):u32(start+p*4)))
 }
 const formats=tags.get(339)??[1];if(!formats.includes(3))return
 const get=(id:number,fallback?:number)=>tags.get(id)?.[0]??fallback,width=get(256)!,height=get(257)!,samples=get(277,1)!,depth=(tags.get(258)??[1])[0],bits=tags.get(258)??[1]
 if(![16,32,64].includes(depth)||bits.some(v=>v!==depth)||![1,samples].includes(bits.length)||formats.some(v=>v!==3)||![1,samples].includes(formats.length))unsupported('Float TIFF requires uniform IEEE half, float or double RGB(A) samples.')
 if(get(262)!==2||![3,4].includes(samples))unsupported('Only RGB or RGBA float TIFF is supported; grayscale/CMYK require conversion.')
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>32_000_000)throw new EditorError('RESOURCE_LIMIT','Float TIFF dimensions exceed codec limits.')
 const compression=get(259,1)!,orientation=get(274,1)!,predictor=get(317,1)!,planar=get(284,1)!,rows=Math.min(get(278,height)!,height),extra=tags.get(338)??[]
 if(![1,5,8,32946].includes(compression)||![1,3].includes(predictor)||predictor===3&&compression===1)unsupported('Float TIFF supports NONE/LZW/Deflate with predictor 1 or floating predictor 3.')
 if(![1,2].includes(planar)||get(266,1)!==1||orientation<1||orientation>8)unsupported('Unsupported TIFF planar/fill/orientation settings.')
 if([322,323,324,325].some(id=>tags.has(id)))unsupported('Tiled float TIFF requires explicit strip conversion.')
 if(!Number.isSafeInteger(rows)||rows<1||rows>height)invalid('Invalid TIFF rows per strip.')
 if(samples===4&&(extra.length!==1||![1,2].includes(extra[0]))||samples===3&&extra.length)unsupported('Float RGBA TIFF must declare associated or unassociated alpha.')
 if(colorimetry)unsupported('Float TIFF colorimetry/transfer tags require explicit color-managed conversion.')
 let matrix:number[]|undefined;const warnings=['Untagged floating TIFF is interpreted as scene-linear Rec.709/D65 RGB. Float samples are converted to extended sRGB and persisted in a FLOAT+ZIP EXR asset.']
 if(profile){let plan;try{plan=inspectICC(profile)}catch{unsupported('Float TIFF ICC requires a supported linear RGB matrix profile.')}
  if(!plan.matrix||!plan.curves||plan.curves.some(curve=>curve.some((v,i)=>Math.abs(v-i/255)>.00005)))unsupported('Nonlinear or LUT float TIFF ICC requires explicit color-managed conversion.')
  matrix=plan.matrix;warnings[0]='Floating TIFF linear RGB matrix ICC colors were converted through its actual primaries to extended sRGB; signed and out-of-gamut values are retained.'
 }
 if(depth===64)warnings.push('Float64 TIFF samples are rounded once to the Float32 editor representation; original TIFF is not persisted as the project asset.')
 const strips=Math.ceil(height/rows)*(planar===2?samples:1),offsets=tags.get(273),lengths=tags.get(279)
 if(!offsets||!lengths||offsets.length!==strips||lengths.length!==strips||strips>1_000_000)invalid('Missing or inconsistent float TIFF strips.')
 const channels=planar===2?1:samples,rowBytes=width*channels*depth/8;let largest=0,total=0
 for(let i=0;i<strips;i++){bounds(offsets[i],lengths[i]);if(!lengths[i])invalid('Empty float TIFF strip.');const n=Math.min(rows,height-i%Math.ceil(height/rows)*rows)*rowBytes;largest=Math.max(largest,n);total+=lengths[i]}
 const estimatedBytes=bytes.length+width*height*(samples*4+16)+largest*3+20*1024*1024
 if(estimatedBytes>HDR_CODEC_BUDGET||total>HDR_CODEC_BUDGET)throw new EditorError('RESOURCE_LIMIT','Float TIFF exceeds its 512 MiB working budget.')
 return {width,height,depth,samples,compression,orientation,predictor,planar,rows,offsets,lengths,little,associated:extra[0]===1,matrix,warnings,estimatedBytes}
}
/** Early-change TIFF LZW; dictionary and output are bounded independently. */
function lzw(source:Buffer,maximum:number):Buffer {
 const out=Buffer.allocUnsafe(maximum),prefix=new Int16Array(4096),suffix=new Uint8Array(4096),stack=new Uint8Array(4097);let bit=0,written=0,width=9,next=258,previous=-1,first=0
 const code=()=>{if(bit+width>source.length*8)invalid('Truncated TIFF LZW.');let value=0;for(let i=0;i<width;i++){value=value*2+(source[bit>>3]>>(7-(bit&7))&1);bit++}return value}
 while(true){const value=code();if(value===256){width=9;next=258;previous=-1;continue}if(value===257)break;if(value>next||value===next&&previous<0)invalid('Invalid TIFF LZW dictionary code.')
  let cursor=value,top=0;if(cursor===next){stack[top++]=first;cursor=previous}
  while(cursor>=258){if(cursor>=next||top>=4096)invalid('Invalid cyclic TIFF LZW entry.');stack[top++]=suffix[cursor];cursor=prefix[cursor]}
  if(cursor>=256||cursor<0)invalid('Invalid TIFF LZW literal.');first=cursor;stack[top++]=first
  if(written+top>maximum)invalid('TIFF LZW output exceeds strip geometry.');while(top)out[written++]=stack[--top]
  if(previous>=0&&next<4096){prefix[next]=previous;suffix[next]=first;next++;if(width<12&&next===(1<<width)-1)width++}previous=value
 }
 if(written!==maximum)invalid('Incomplete TIFF LZW output.');return out
}
export function decodeFloatTIFF(bytes:Buffer):HDRRaster&{warnings:string[]} {
 const h=inspectFloatTIFF(bytes);if(!h)invalid('An IEEE floating TIFF image is required.')
 const {width,height,depth,samples,compression,orientation,predictor,planar,rows,little}=h,bps=depth/8,channels=planar===2?1:samples,stripsPerPlane=Math.ceil(height/rows),decoded=new Float32Array(width*height*samples)
 for(let i=0;i<h.offsets.length;i++){
  const y0=i%stripsPerPlane*rows,plane=Math.floor(i/stripsPerPlane),lines=Math.min(rows,height-y0),rowBytes=width*channels*bps,expected=lines*rowBytes,packed=bytes.subarray(h.offsets[i],h.offsets[i]+h.lengths[i]);let raw:Buffer
  try{raw=compression===1?Buffer.from(packed):compression===5?lzw(packed,expected):inflateSync(packed,{maxOutputLength:expected})}catch(error){if(error instanceof EditorError)throw error;invalid('Invalid float TIFF compressed strip.')}
  if(raw.length!==expected)invalid('Float TIFF strip size differs from geometry.')
  if(predictor===3){const temp=Buffer.allocUnsafe(rowBytes),sampleCount=width*channels;for(let y=0;y<lines;y++){const row=raw.subarray(y*rowBytes,(y+1)*rowBytes);for(let at=channels;at<rowBytes;at++)row[at]=(row[at]+row[at-channels])&255;row.copy(temp);for(let p=0;p<sampleCount;p++)for(let b=0;b<bps;b++)row[p*bps+(little?bps-b-1:b)]=temp[b*sampleCount+p]}}
  for(let y=0;y<lines;y++)for(let x=0;x<width;x++)for(let c=0;c<channels;c++){
   const at=((y*width+x)*channels+c)*bps,value=depth===16?exrHalfToFloat(little?raw.readUInt16LE(at):raw.readUInt16BE(at)):depth===32?little?raw.readFloatLE(at):raw.readFloatBE(at):little?raw.readDoubleLE(at):raw.readDoubleBE(at)
   if(!Number.isFinite(value)||Math.abs(value)>3.4028234663852886e38)invalid('Float TIFF contains non-finite or out-of-range samples.')
   decoded[((y0+y)*width+x)*samples+(planar===2?plane:c)]=value
  }
 }
 const outputWidth=orientation>=5?height:width,outputHeight=orientation>=5?width:height,hdr=new Float32Array(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=(y*width+x)*samples,alpha=samples===4?decoded[at+3]:1;if(alpha<0||alpha>1)invalid('Float TIFF alpha is outside [0,1].')
  let linear=[decoded[at],decoded[at+1],decoded[at+2]];if(h.associated){if(!alpha&&linear.some(v=>v!==0))unsupported('Zero-alpha emissive float TIFF requires a separate linear representation.');linear=linear.map(v=>alpha?v/alpha:0)}
  if(h.matrix){const m=h.matrix;linear=[0,1,2].map(r=>m[r*3]*linear[0]+m[r*3+1]*linear[1]+m[r*3+2]*linear[2])}
  const rgb=linear.map(v=>extendedSRGBFromLinear(v)*alpha);if(rgb.some(v=>!Number.isFinite(v)||Math.abs(v)>65504))throw new EditorError('RESOURCE_LIMIT','Float TIFF exceeds the supported extended-sRGB range.')
  const [xx,yy]=[[x,y],[width-1-x,y],[width-1-x,height-1-y],[x,height-1-y],[y,x],[height-1-y,x],[height-1-y,width-1-x],[y,width-1-x]][orientation-1];hdr.set([...rgb,alpha],(yy*outputWidth+xx)*4)
 }
 return {width:outputWidth,height:outputHeight,hdr,warnings:h.warnings}
}
