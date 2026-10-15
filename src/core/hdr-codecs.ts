import {deflateSync,inflateSync} from 'node:zlib'
import {EditorError,LIMITS} from '../shared/contracts'

export interface HDRRaster {width:number;height:number;hdr:Float32Array}
export interface HDRCodecOptions {maximumBytes?:number;maximumPixels?:number}
export const HDR_CODEC_BUDGET=512*1024*1024
const MAX_PIXELS=32_000_000,MAGIC=20000630
const SRGB=[.64,.33,.30,.60,.15,.06,.3127,.3290]
type Channel={name:string;type:1|2;bytes:2|4}
export interface EXRHeader {width:number;height:number;channels:Channel[];compression:number;dataWindow:[number,number,number,number];headerBytes:number;chunkCount:number;linesPerChunk:number;rowBytes:number;estimatedBytes:number;chromaticities:number[]}
function invalid(message:string):never {throw new EditorError('INVALID_ARGUMENT',message)}
function unsupported(message:string):never {throw new EditorError('UNSUPPORTED_FEATURE',message)}
function resource(message:string):never {throw new EditorError('RESOURCE_LIMIT',message)}
function budget(width:number,height:number,inputBytes:number,extraBytes:number,options:HDRCodecOptions={}):number {
 const max=options.maximumBytes??HDR_CODEC_BUDGET,pixels=options.maximumPixels??MAX_PIXELS
 if(!Number.isSafeInteger(max)||max<1||max>HDR_CODEC_BUDGET||!Number.isSafeInteger(pixels)||pixels<1||pixels>MAX_PIXELS)invalid('Invalid HDR codec resource limits.')
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>pixels)resource('HDR raster exceeds its dimension or pixel budget.')
 const bytes=inputBytes+width*height*16+extraBytes
 if(!Number.isSafeInteger(bytes)||bytes>max)resource('HDR codec exceeds its working memory budget.')
 return bytes
}
function input(value:Buffer|Uint8Array):Buffer {
 if(!(value instanceof Uint8Array)||value.byteLength<8)invalid('Truncated HDR input.')
 if(value.byteLength>HDR_CODEC_BUDGET)resource('HDR input exceeds its byte budget.')
 return Buffer.isBuffer(value)?value:Buffer.from(value.buffer,value.byteOffset,value.byteLength)
}
export function extendedSRGBFromLinear(value:number):number {const a=Math.abs(value);return Math.sign(value)*(a<=.0031308?12.92*a:1.055*a**(1/2.4)-.055)}
export function linearFromExtendedSRGB(value:number):number {const a=Math.abs(value);return Math.sign(value)*(a<=.04045?a/12.92:((a+.055)/1.055)**2.4)}
export function exrHalfToFloat(bits:number):number {const sign=bits&0x8000?-1:1,e=(bits>>10)&31,m=bits&1023;return e===0?sign*m*2**-24:e===31?m?NaN:sign*Infinity:sign*(1+m/1024)*2**(e-15)}
const floatScratch=new Float32Array(1),bitsScratch=new Uint32Array(floatScratch.buffer)
export function floatToEXRHalf(value:number):number {
 if(!Number.isFinite(value)||Math.abs(value)>65504)invalid('EXR HALF cannot preserve this finite scene-linear sample; use FLOAT.')
 floatScratch[0]=value;const bits=bitsScratch[0],sign=(bits>>>16)&0x8000,e=((bits>>>23)&255)-112,m=bits&0x7fffff
 if(e<=0){if(e< -10)return sign;const full=m|0x800000,shift=14-e,half=full>>>shift,rest=full&((1<<shift)-1),middle=1<<(shift-1);return sign|half+(rest>middle||rest===middle&&(half&1)?1:0)}
 const half=sign|(e<<10)|(m>>>13),rest=m&8191;return half+(rest>4096||rest===4096&&(half&1)?1:0)
}
function cstring(bytes:Buffer,cursor:{at:number},limit:number):string {
 const end=bytes.indexOf(0,cursor.at);if(end<cursor.at||end-cursor.at>limit||end<0)invalid('Invalid EXR header string.')
 const name=bytes.toString('utf8',cursor.at,end);if(!/^[\x20-\x7e]*$/.test(name))invalid('EXR header names must be ASCII.');cursor.at=end+1;return name
}
function attribute(attrs:Map<string,{type:string;data:Buffer}>,name:string,type:string,size?:number):Buffer {
 const attr=attrs.get(name);if(!attr||attr.type!==type||size!==undefined&&attr.data.length!==size)invalid(`Invalid EXR ${name} attribute.`);return attr.data
}
export function inspectEXR(value:Buffer|Uint8Array,options:HDRCodecOptions={}):EXRHeader {
 const bytes=input(value);if(bytes.readUInt32LE(0)!==MAGIC)invalid('Invalid OpenEXR magic number.')
 const version=bytes.readUInt32LE(4);if((version&255)!==2)unsupported('Unsupported OpenEXR version.');if(version&~(255|1024))unsupported('Multipart, tiled and deep OpenEXR require conversion.')
 const cursor={at:8},attrs=new Map<string,{type:string;data:Buffer}>(),maxName=version&1024?255:31
 while(true){if(cursor.at>=bytes.length||cursor.at>1024*1024)invalid('Truncated or oversized EXR header.');const name=cstring(bytes,cursor,maxName);if(!name)break;const type=cstring(bytes,cursor,maxName);if(!type||attrs.has(name)||cursor.at+4>bytes.length)invalid('Duplicate or malformed EXR attribute.');const size=bytes.readInt32LE(cursor.at);cursor.at+=4;if(size<0||cursor.at+size>bytes.length||cursor.at+size>1024*1024)invalid('Invalid EXR attribute size.');attrs.set(name,{type,data:bytes.subarray(cursor.at,cursor.at+size)});cursor.at+=size}
 if(attrs.has('tiles')||attrs.has('multiView')||attrs.has('acesImageContainerFlag')||attrs.has('colorInteropID'))unsupported('This EXR color/view/tile declaration requires explicit conversion.')
 if(attrs.has('type')&&attribute(attrs,'type','string').toString()!=='scanlineimage')unsupported('Only flat scanline EXR images are supported.')
 const dw=attribute(attrs,'dataWindow','box2i',16),display=attribute(attrs,'displayWindow','box2i',16),dataWindow:[number,number,number,number]=[0,4,8,12].map(at=>dw.readInt32LE(at)) as [number,number,number,number]
 if(!display.equals(dw))unsupported('EXR display and data windows differ; crop or flatten before importing.')
 const width=dataWindow[2]-dataWindow[0]+1,height=dataWindow[3]-dataWindow[1]+1,compression=attribute(attrs,'compression','compression',1)[0],lineOrder=attribute(attrs,'lineOrder','lineOrder',1)[0]
 if(compression>3)unsupported('EXR compression is unsupported; use NONE, RLE, ZIPS or ZIP.');if(lineOrder>1)unsupported('Random scanline EXR order is unsupported.')
 const aspect=attribute(attrs,'pixelAspectRatio','float',4).readFloatLE(0);if(!Number.isFinite(aspect)||Math.abs(aspect-1)>1e-5)unsupported('Non-square EXR pixels require explicit resampling.')
 const center=attribute(attrs,'screenWindowCenter','v2f',8),screen=attribute(attrs,'screenWindowWidth','float',4);if(![center.readFloatLE(0),center.readFloatLE(4),screen.readFloatLE(0)].every(Number.isFinite))invalid('Invalid EXR projection header.')
 const list=attribute(attrs,'channels','chlist'),ci={at:0},channels:Channel[]=[],names=new Set<string>()
 while(ci.at<list.length){const name=cstring(list,ci,maxName);if(!name)break;if(ci.at+16>list.length||names.has(name))invalid('Invalid EXR channel list.');const type=list.readInt32LE(ci.at),x=list.readInt32LE(ci.at+8),y=list.readInt32LE(ci.at+12),linear=list[ci.at+4];if(!['R','G','B','A'].includes(name)||![1,2].includes(type)||x!==1||y!==1)unsupported('Only full-resolution HALF/FLOAT RGB or RGBA EXR channels are supported.');if(linear>1||list[ci.at+5]||list[ci.at+6]||list[ci.at+7])invalid('Invalid EXR channel flags.');channels.push({name,type:type as 1|2,bytes:type===1?2:4});names.add(name);ci.at+=16}
 if(ci.at!==list.length||!['R','G','B'].every(name=>names.has(name))||channels.map(c=>c.name).join()!==channels.map(c=>c.name).sort().join())invalid('EXR channels must contain sorted RGB or RGBA channels.')
 let chromaticities=SRGB.slice();if(attrs.has('chromaticities')){const chroma=attribute(attrs,'chromaticities','chromaticities',32);chromaticities=Array.from({length:8},(_,i)=>chroma.readFloatLE(i*4));colorMatrix(chromaticities)}
 const rowBytes=width*channels.reduce((sum,c)=>sum+c.bytes,0),linesPerChunk=compression===3?16:1,chunkCount=Math.ceil(height/linesPerChunk),estimatedBytes=budget(width,height,bytes.length,rowBytes*Math.min(linesPerChunk,height)*4+chunkCount*40+512*1024,options)
 if(cursor.at+chunkCount*8>bytes.length)invalid('Truncated EXR chunk offset table.')
 return {width,height,channels,compression,dataWindow,headerBytes:cursor.at,chunkCount,linesPerChunk,rowBytes,estimatedBytes,chromaticities}
}
type Matrix=number[]
const identity=[1,0,0,0,1,0,0,0,1]
function mul(a:Matrix,b:Matrix):Matrix {return Array.from({length:9},(_,p)=>{const r=Math.floor(p/3),c=p%3;return a[r*3]*b[c]+a[r*3+1]*b[3+c]+a[r*3+2]*b[6+c]})}
function vector(m:Matrix,v:number[]):number[] {return [0,1,2].map(r=>m[r*3]*v[0]+m[r*3+1]*v[1]+m[r*3+2]*v[2])}
function inverse(m:Matrix):Matrix {const [a,b,c,d,e,f,g,h,i]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(!Number.isFinite(det)||Math.abs(det)<1e-10)invalid('Singular HDR chromaticities.');return [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(v=>v/det)}
function primaries(chroma:number[]):{matrix:Matrix;white:number[]} {
 if(chroma.length!==8||chroma.some(v=>!Number.isFinite(v)||Math.abs(v)>2)||[1,3,5,7].some(i=>Math.abs(chroma[i])<1e-8))invalid('Invalid HDR chromaticities.')
 const columns=[0,2,4].map(at=>[chroma[at]/chroma[at+1],1,(1-chroma[at]-chroma[at+1])/chroma[at+1]]),matrix=[0,1,2].flatMap(r=>columns.map(column=>column[r])),white=[chroma[6]/chroma[7],1,(1-chroma[6]-chroma[7])/chroma[7]],scale=vector(inverse(matrix),white)
 return {matrix:matrix.map((value,i)=>value*scale[i%3]),white}
}
function colorMatrix(chroma:number[]):Matrix {
 if(chroma.every((v,i)=>Math.abs(v-SRGB[i])<1e-6))return identity
 const src=primaries(chroma),dst=primaries(SRGB),bradford=[.8951,.2664,-.1614,-.7502,1.7135,.0367,.0389,-.0685,1.0296],from=vector(bradford,src.white),to=vector(bradford,dst.white)
 if(from.some(v=>Math.abs(v)<1e-8))invalid('Invalid HDR white point.')
 const adaptation=mul(inverse(bradford),bradford.map((v,i)=>v*to[Math.floor(i/3)]/from[Math.floor(i/3)]))
 return mul(inverse(dst.matrix),mul(adaptation,src.matrix))
}
function undoPrediction(packed:Buffer):Buffer {for(let i=1;i<packed.length;i++)packed[i]=(packed[i-1]+packed[i]-128)&255;const raw=Buffer.allocUnsafe(packed.length),mid=Math.ceil(packed.length/2);for(let i=0;i<raw.length;i++)raw[i]=packed[(i>>1)+(i&1?mid:0)];return raw}
function prediction(raw:Buffer):Buffer {const out=Buffer.allocUnsafe(raw.length),mid=Math.ceil(raw.length/2);for(let i=0;i<raw.length;i++)out[(i>>1)+(i&1?mid:0)]=raw[i];let previous=out[0];for(let i=1;i<out.length;i++){const current=out[i];out[i]=(current-previous+128)&255;previous=current}return out}
function unpackRLE(data:Buffer,size:number):Buffer {const out=Buffer.allocUnsafe(size);let at=0,pos=0;while(at<data.length){const count=data.readInt8(at++);if(count<0){const n=-count;if(at+n>data.length||pos+n>size)invalid('Malformed EXR RLE literals.');data.copy(out,pos,at,at+n);at+=n;pos+=n}else{const n=count+1;if(at>=data.length||pos+n>size)invalid('Malformed EXR RLE repeat.');out.fill(data[at++],pos,pos+n);pos+=n}}if(pos!==size)invalid('Incomplete EXR RLE chunk.');return out}
function packRLE(data:Buffer):Buffer {const out=Buffer.allocUnsafe(data.length*2);let at=0,pos=0;while(at<data.length){let run=1;while(at+run<data.length&&data[at+run]===data[at]&&run<128)run++;if(run>=3){out[pos++]=run-1;out[pos++]=data[at];at+=run;continue}const start=at;at+=run;while(at<data.length&&at-start<127){let next=1;while(at+next<data.length&&data[at+next]===data[at]&&next<3)next++;if(next>=3)break;at+=Math.min(next,127-(at-start))}out[pos++]=(256-(at-start))&255;data.copy(out,pos,start,at);pos+=at-start}return out.subarray(0,pos)}
function convertedPixel(out:Float32Array,at:number,color:number[],alpha:number,matrix:Matrix):void {
 if(!Number.isFinite(alpha)||alpha<0||alpha>1||color.some(value=>!Number.isFinite(value)))invalid('Non-finite or invalid HDR pixel sample.')
 if(!alpha&&color.some(value=>value!==0))unsupported('Zero-alpha emissive EXR pixels require a separate linear-light representation.')
 const linear=vector(matrix,color),encoded=linear.map(value=>alpha?extendedSRGBFromLinear(value/alpha)*alpha:0)
 if(encoded.some(value=>!Number.isFinite(value)||Math.abs(value)>65504))resource('HDR sample exceeds the supported extended-sRGB range.')
 out.set([...encoded,alpha],at)
}
export function decodeEXR(value:Buffer|Uint8Array,options:HDRCodecOptions={}):HDRRaster {
 const bytes=input(value),header=inspectEXR(bytes,options),{width,height,channels,compression,dataWindow,headerBytes,chunkCount,linesPerChunk,rowBytes}=header,hdr=new Float32Array(width*height*4),seen=new Set<number>(),ranges:{start:number;end:number}[]=[],matrix=colorMatrix(header.chromaticities),payloadStart=headerBytes+chunkCount*8
 for(let chunk=0;chunk<chunkCount;chunk++){
  const offsetBig=bytes.readBigUInt64LE(headerBytes+chunk*8);if(offsetBig>BigInt(Number.MAX_SAFE_INTEGER))invalid('Invalid EXR chunk offset.');const offset=Number(offsetBig);if(offset<payloadStart||offset+8>bytes.length)invalid('EXR chunk offset is out of bounds.')
  const y=bytes.readInt32LE(offset),size=bytes.readInt32LE(offset+4),row=y-dataWindow[1];if(size<1||offset+8+size>bytes.length||row<0||row>=height||row%linesPerChunk||seen.has(row))invalid('Invalid, duplicate or truncated EXR scanline chunk.');seen.add(row);ranges.push({start:offset,end:offset+8+size})
  const count=Math.min(linesPerChunk,height-row),rawSize=count*rowBytes;let raw=bytes.subarray(offset+8,offset+8+size)
  if(size!==rawSize){if(size>rawSize||compression===0)invalid('Incorrect EXR raw chunk size.');try{const packed=compression===1?unpackRLE(raw,rawSize):inflateSync(raw,{maxOutputLength:rawSize});if(packed.length!==rawSize)invalid('Incorrect decompressed EXR chunk size.');raw=undoPrediction(packed)}catch(error){if(error instanceof EditorError)throw error;invalid('EXR compressed chunk is invalid.')}}
  let cursor=0
  for(let line=0;line<count;line++){
   const channelOffsets=new Map<string,{channel:Channel;at:number}>();for(const channel of channels){channelOffsets.set(channel.name,{channel,at:cursor});cursor+=width*channel.bytes}
   for(let x=0;x<width;x++){const read=(name:string)=>{const c=channelOffsets.get(name);if(!c)return 1;return c.channel.type===1?exrHalfToFloat(raw.readUInt16LE(c.at+x*2)):raw.readFloatLE(c.at+x*4)};convertedPixel(hdr,((row+line)*width+x)*4,[read('R'),read('G'),read('B')],read('A'),matrix)}
  }
 }
 ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)invalid('Overlapping EXR chunks.')
 return {width,height,hdr}
}
function attr(name:string,type:string,data:Buffer):Buffer {const size=Buffer.alloc(4);size.writeInt32LE(data.length);return Buffer.concat([Buffer.from(name+'\0'+type+'\0'),size,data])}
function floatBuffer(values:number[]):Buffer {const data=Buffer.alloc(values.length*4);values.forEach((v,i)=>data.writeFloatLE(v,i*4));return data}
export interface EXREncodeOptions extends HDRCodecOptions {pixelType?:'half'|'float';compression?:'none'|'rle'|'zips'|'zip'}
export function encodeEXR(width:number,height:number,hdr:Float32Array,options:EXREncodeOptions={}):Buffer {
 const type=options.pixelType??'half',compressions=['none','rle','zips','zip'],compression=compressions.indexOf(options.compression??'zip');if(!['half','float'].includes(type)||compression<0)invalid('Invalid EXR encoding options.')
 const bytesPerSample=type==='half'?2:4,lineCount=compression===3?16:1,rowBytes=width*bytesPerSample*4
 budget(width,height,0,width*height*bytesPerSample*8+rowBytes*Math.min(lineCount,height)*5+height*16+512*1024,options)
 if(!(hdr instanceof Float32Array)||hdr.length!==width*height*4)invalid('Invalid HDR encoding source.')
 // Validate every source and its scene-linear representation before constructing output chunks.
 for(let at=0;at<hdr.length;at+=4){const alpha=hdr[at+3];if(!Number.isFinite(alpha)||alpha<0||alpha>1)invalid('Invalid HDR alpha.');const halfAlpha=type==='half'?floatToEXRHalf(alpha):undefined;for(let c=0;c<3;c++){const value=hdr[at+c];if(!Number.isFinite(value)||Math.abs(value)>65504)invalid('Invalid HDR color sample.');if(!alpha&&value)unsupported('Zero-alpha emissive HDR pixels require a separate linear-light representation.');const scene=alpha?linearFromExtendedSRGB(value/alpha)*alpha:0;if(!Number.isFinite(scene)||Math.abs(scene)>3.4028234663852886e38)invalid('HDR scene-linear sample exceeds FLOAT range.');if(type==='half'){const halfColor=floatToEXRHalf(scene);if(!halfAlpha&&halfColor)invalid('EXR HALF alpha underflow cannot preserve this HDR pixel; use FLOAT.')}}}
 const channels=Buffer.concat(['A','B','G','R'].map(name=>{const values=Buffer.alloc(16);values.writeInt32LE(type==='half'?1:2,0);values.writeInt32LE(1,8);values.writeInt32LE(1,12);return Buffer.concat([Buffer.from(name+'\0'),values])}).concat(Buffer.from([0]))),window=Buffer.alloc(16);window.writeInt32LE(width-1,8);window.writeInt32LE(height-1,12)
 const magic=Buffer.alloc(8);magic.writeUInt32LE(MAGIC);magic.writeUInt32LE(2,4)
 const header=Buffer.concat([magic,attr('channels','chlist',channels),attr('compression','compression',Buffer.from([compression])),attr('dataWindow','box2i',window),attr('displayWindow','box2i',window),attr('lineOrder','lineOrder',Buffer.from([0])),attr('pixelAspectRatio','float',floatBuffer([1])),attr('screenWindowCenter','v2f',floatBuffer([0,0])),attr('screenWindowWidth','float',floatBuffer([1])),attr('chromaticities','chromaticities',floatBuffer(SRGB)),Buffer.from([0])]),chunks:Buffer[]=[],chunkCount=Math.ceil(height/lineCount),offsets=Buffer.alloc(chunkCount*8);let position=header.length+offsets.length
 for(let y=0;y<height;y+=lineCount){const count=Math.min(lineCount,height-y),raw=Buffer.allocUnsafe(count*rowBytes);let at=0;for(let line=0;line<count;line++)for(const c of [3,2,1,0])for(let x=0;x<width;x++){const p=((y+line)*width+x)*4,alpha=hdr[p+3],sample=c===3?alpha:alpha?linearFromExtendedSRGB(hdr[p+c]/alpha)*alpha:0;if(type==='half')raw.writeUInt16LE(floatToEXRHalf(sample),at);else raw.writeFloatLE(sample,at);at+=bytesPerSample}
  let data:Buffer=raw;if(compression){const predicted=prediction(raw),packed=compression===1?packRLE(predicted):deflateSync(predicted);if(packed.length<raw.length)data=packed}const meta=Buffer.alloc(8);meta.writeInt32LE(y);meta.writeInt32LE(data.length,4);const chunk=Buffer.concat([meta,data]);offsets.writeBigUInt64LE(BigInt(position),(y/lineCount)*8);position+=chunk.length;chunks.push(chunk)
 }
 return Buffer.concat([header,offsets,...chunks])
}

/** Radiance RGBE is scene-linear. PRIMARIES is honored; absent primaries use
 * Radiance's standard RGB/equal-energy white, adapted to sRGB D65 (not guessed encoded sRGB).
 */
export function inspectRadianceHDR(value:Buffer|Uint8Array,options:HDRCodecOptions={}) {
 const bytes=input(value);let at=0;const line=()=>{const end=bytes.indexOf(10,at);if(end<0||end>1024*1024)invalid('Truncated or oversized Radiance header.');const result=bytes.toString('ascii',at,end).replace(/\r$/,'');at=end+1;return result}
 if(!['#?RADIANCE','#?RGBE'].includes(line()))invalid('Invalid Radiance signature.')
 let format='',exposure=1,color=[1,1,1],chroma=[.64,.33,.29,.60,.15,.06,1/3,1/3]
 while(true){const item=line();if(!item)break;if(item.startsWith('FORMAT=')){if(format)invalid('Duplicate Radiance FORMAT.');format=item.slice(7)}else if(item.startsWith('EXPOSURE=')){const v=Number(item.slice(9));if(!Number.isFinite(v)||v<=0)invalid('Invalid Radiance exposure.');exposure*=v}else if(item.startsWith('COLORCORR=')){const v=item.slice(10).trim().split(/\s+/).map(Number);if(v.length!==3||v.some(n=>!Number.isFinite(n)||n<=0))invalid('Invalid Radiance color correction.');color=color.map((n,i)=>n*v[i])}else if(item.startsWith('PRIMARIES=')){chroma=item.slice(10).trim().split(/\s+/).map(Number);colorMatrix(chroma)}}
 if(format!=='32-bit_rle_rgbe')unsupported('Only Radiance RGBE is supported; XYZE requires conversion.')
 const resolution=line().match(/^([+-])([XY])\s+(\d+)\s+([+-])([XY])\s+(\d+)$/);if(!resolution||resolution[2]===resolution[5])invalid('Invalid Radiance resolution.')
 const major=Number(resolution[3]),minor=Number(resolution[6]),width=resolution[2]==='X'?major:minor,height=resolution[2]==='Y'?major:minor
 const estimatedBytes=budget(width,height,bytes.length,minor*4,options);if(!Number.isFinite(exposure)||!color.every(Number.isFinite))invalid('Radiance exposure exceeds finite range.')
 return {width,height,major,minor,resolution,exposure,color,chroma,headerBytes:at,estimatedBytes}
}
export function decodeRadianceHDR(value:Buffer|Uint8Array,options:HDRCodecOptions={}):HDRRaster {
 const bytes=input(value),{width,height,major,minor,resolution,exposure,color,chroma,headerBytes}=inspectRadianceHDR(bytes,options);let at=headerBytes
 const hdr=new Float32Array(width*height*4),matrix=colorMatrix(chroma),take=(count:number)=>{if(at+count>bytes.length)invalid('Truncated Radiance pixel data.');const data=bytes.subarray(at,at+count);at+=count;return data}
 for(let row=0;row<major;row++){
  const scan=Buffer.allocUnsafe(minor*4),first=take(4)
  if(first[0]===2&&first[1]===2&&!(first[2]&128)){if((first[2]<<8|first[3])!==minor)invalid('Radiance RLE scanline length mismatch.');for(let c=0;c<4;c++){let x=0;while(x<minor){const count=take(1)[0];if(!count)invalid('Zero-length Radiance RLE packet.');const n=count>128?count-128:count;if(x+n>minor)invalid('Radiance RLE scanline overrun.');if(count>128){const v=take(1)[0];for(let i=0;i<n;i++)scan[(x+i)*4+c]=v}else{const values=take(n);for(let i=0;i<n;i++)scan[(x+i)*4+c]=values[i]}x+=n}}}
  else{let x=0,shift=0,pixel=first;while(x<minor){if(pixel[0]===1&&pixel[1]===1&&pixel[2]===1){if(!x||shift>24)invalid('Invalid old Radiance repeat.');const n=pixel[3]*2**shift;if(!n||x+n>minor)invalid('Old Radiance repeat exceeds scanline.');for(let i=0;i<n;i++)scan.copy(scan,(x+i)*4,(x-1)*4,x*4);x+=n;shift+=8}else{pixel.copy(scan,x*4);x++;shift=0}if(x<minor)pixel=take(4)}}
  for(let x=0;x<minor;x++){const p=x*4,e=scan[p+3],scale=e?2**(e-136):0,linear=[0,1,2].map(c=>(scan[p+c]+.5)*scale/exposure/color[c]),coords=[row,x],axis=[resolution[2],resolution[5]],sign=[resolution[1],resolution[4]];let xx=0,yy=0;for(let i=0;i<2;i++){const size=axis[i]==='X'?width:height,index=axis[i]==='X'?(sign[i]==='+'?coords[i]:size-1-coords[i]):sign[i]==='-'?coords[i]:size-1-coords[i];if(axis[i]==='X')xx=index;else yy=index}convertedPixel(hdr,(yy*width+xx)*4,linear,1,matrix)}
 }
 if(at!==bytes.length)invalid('Trailing Radiance frames or pixel data are unsupported.')
 return {width,height,hdr}
}

/** RGBE has no alpha or negative colors. Refuse those sources rather than silently flattening them. */
export function encodeRadianceHDR(width:number,height:number,hdr:Float32Array,options:HDRCodecOptions={}):Buffer {
 budget(width,height,0,width*height*8+width*8+height*8+4096,options)
 if(!(hdr instanceof Float32Array)||hdr.length!==width*height*4)invalid('Invalid Radiance encoding source.')
 for(let at=0;at<hdr.length;at+=4){if(hdr[at+3]!==1)unsupported('Radiance RGBE cannot preserve transparency; use OpenEXR.');for(let c=0;c<3;c++)if(!Number.isFinite(hdr[at+c])||hdr[at+c]<0||hdr[at+c]>65504)unsupported('Radiance RGBE cannot preserve negative or non-finite colors.')}
 const header=Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nPRIMARIES='+SRGB.join(' ')+'\n\n-Y '+height+' +X '+width+'\n'),rows:Buffer[]=[]
 for(let y=0;y<height;y++){
  const scan=Buffer.alloc(width*4)
  for(let x=0;x<width;x++){const at=(y*width+x)*4,linear=[0,1,2].map(c=>linearFromExtendedSRGB(hdr[at+c])),peak=Math.max(...linear);if(peak<=1e-32)continue;const e=Math.floor(Math.log2(peak))+1,scale=2**(8-e);if(e+128>255||e+128<1)resource('Radiance exponent exceeds RGBE range.');for(let c=0;c<3;c++)scan[x*4+c]=Math.min(255,Math.floor(linear[c]*scale));scan[x*4+3]=e+128}
  if(width<8||width>32767){rows.push(scan);continue}
  const encoded=Buffer.allocUnsafe(width*4+Math.ceil(width/128)*4+4);encoded.set([2,2,width>>8,width&255]);let pos=4
  for(let c=0;c<4;c++)for(let x=0;x<width;){let run=1;while(x+run<width&&run<127&&scan[(x+run)*4+c]===scan[x*4+c])run++;if(run>=4){encoded[pos++]=128+run;encoded[pos++]=scan[x*4+c];x+=run}else{const count=Math.min(128,width-x);encoded[pos++]=count;for(let i=0;i<count;i++)encoded[pos++]=scan[(x+i)*4+c];x+=count}}
  rows.push(encoded.subarray(0,pos))
 }
 return Buffer.concat([header,...rows])
}
