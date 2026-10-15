import {createHash} from 'node:crypto'
import {totalmem} from 'node:os'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {EditorError,LIMITS} from '../shared/contracts'
import {documentPixelBudget} from '../shared/limits'
import {quantizeDeep16ToRGBA8} from '../shared/deep-pixels'
import {inspectICC} from './foreign-color'

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10])
/** Conservative bound includes PNG parser/filter buffers, RGBA16, display RGBA8 and encoder copies. */
export const DEEP_ASSET_WORKING_BUDGET=512*1024*1024
export interface PNGHeader {width:number;height:number;bitDepth:number;colorType:number;interlace:number}
export function inspectPNG(bytes:Buffer):PNGHeader {
 if(bytes.length>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','The encoded image exceeds the encoded asset budget.')
 if(bytes.length<33||!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')throw new EditorError('INVALID_PROJECT','The image asset has no valid PNG header.')
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),bitDepth=bytes[24],colorType=bytes[25],interlace=bytes[28]
 if(width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The image exceeds this build’s image size limit.')
 if(bytes[26]!==0||bytes[27]!==0||interlace>1)throw new EditorError('INVALID_PROJECT','The PNG header contains unsupported compression, filter or interlace settings.')
 if(![0,2,3,4,6].includes(colorType)||![1,2,4,8,16].includes(bitDepth)||(colorType===3&&bitDepth===16)||([2,4,6].includes(colorType)&&bitDepth<8))throw new EditorError('INVALID_PROJECT','The PNG header contains an invalid depth or color type.')
 return {width,height,bitDepth,colorType,interlace}
}
export function deepAssetWorkingBytes(bytes:Buffer,header=inspectPNG(bytes)):number{return bytes.length*2+header.width*header.height*48+header.height*7}
export function assertPNGWorkingBudget(bytes:Buffer,header=inspectPNG(bytes)):void {
 // RGBA8 is also bounded, including decoding of palette and grayscale images.
 if(header.bitDepth!==16)return
 const estimate=deepAssetWorkingBytes(bytes,header)
 if(estimate>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','The image exceeds the 512 MiB PNG decoding and display working budget.',{estimatedWorkingBytes:estimate,maximumWorkingBytes:DEEP_ASSET_WORKING_BUDGET})
}
const CRC_TABLE=Uint32Array.from({length:256},(_,i)=>{let value=i;for(let k=0;k<8;k++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0})
export function pngChunkCRC(bytes:Uint8Array):number {let crc=0xffffffff;for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
/** Project metadata declares sRGB. Reject contradictory embedded profiles instead of relabeling samples. */
export function assertDeepPNGColorProfile(bytes:Buffer):void {
 let position=8,ended=false,srgbCount=0,iccCount=0
 const unsupported=()=>new EditorError('UNSUPPORTED_FEATURE','This high-depth PNG declares a non-sRGB or unsupported color profile. Convert a separate copy to 16-bit sRGB before opening it.',{conversionPerformed:false})
 while(position+12<=bytes.length){
  const length=bytes.readUInt32BE(position),end=position+12+length
  if(end>bytes.length)throw new EditorError('INVALID_PROJECT','The PNG image is damaged.')
  const name=bytes.toString('ascii',position+4,position+8),data=bytes.subarray(position+8,position+8+length)
  if(pngChunkCRC(bytes.subarray(position+4,end-4))!==bytes.readUInt32BE(end-4))throw new EditorError('INVALID_PROJECT','The PNG image contains a damaged chunk checksum.')
  if(name==='sRGB'){if(++srgbCount>1||data.length!==1||data[0]>3)throw new EditorError('INVALID_PROJECT','Invalid PNG sRGB declaration.')}
  if(name==='gAMA'&&(data.length!==4||Math.abs(data.readUInt32BE(0)-45455)>1))throw unsupported()
  if(name==='cHRM'){const standard=[31270,32900,64000,33000,30000,60000,15000,6000];if(data.length!==32||standard.some((value,i)=>Math.abs(data.readUInt32BE(i*4)-value)>20))throw unsupported()}
  if(name==='cICP'&&(data.length!==4||data[0]!==1||data[1]!==13||data[2]!==0||data[3]!==1))throw unsupported()
  if(name==='iCCP'){
   if(++iccCount>1)throw new EditorError('INVALID_PROJECT','Duplicate PNG ICC declarations.')
   const separator=data.indexOf(0);if(separator<1||separator>79||separator+2>=data.length||data[separator+1]!==0)throw new EditorError('INVALID_PROJECT','Invalid PNG ICC declaration.')
   try{
    const profile=inflateSync(data.subarray(separator+2),{maxOutputLength:1024*1024}),plan=inspectICC(profile)
    if(!plan.matrix||!plan.curves||plan.matrix.some((value,i)=>Math.abs(value-(i%4===0?1:0))>.002)||plan.curves.some(curve=>curve.some((value,i)=>{const x=i/255,expected=x<=.04045?x/12.92:((x+.055)/1.055)**2.4;return Math.abs(value-expected)>.0002})))throw unsupported()
   }catch(error){if(error instanceof EditorError)throw error;throw unsupported()}
  }
  position=end;if(name==='IEND'){if(length!==0)throw new EditorError('INVALID_PROJECT','Invalid PNG end chunk.');ended=true;break}
 }
 if(!ended||position!==bytes.length)throw new EditorError('INVALID_PROJECT','The PNG image has a truncated or trailing chunk stream.')
 if(srgbCount&&iccCount)throw new EditorError('INVALID_PROJECT','The PNG image has conflicting sRGB and ICC declarations.')
}
/** pngjs bounds noninterlaced inflate itself. Its Adam7 path does not; preflight that stream explicitly. */
export function boundInterlacedPNG(bytes:Buffer,header:PNGHeader):void {
 if(!header.interlace)return
 const chunks:Buffer[]=[];let position=8,ended=false
 while(position+12<=bytes.length){const length=bytes.readUInt32BE(position),end=position+12+length;if(end>bytes.length)throw new EditorError('INVALID_PROJECT','The PNG image is damaged.');const type=bytes.toString('ascii',position+4,position+8);if(type==='IDAT')chunks.push(bytes.subarray(position+8,position+8+length));position=end;if(type==='IEND'){ended=true;break}}
 if(!ended||chunks.length===0)throw new EditorError('INVALID_PROJECT','The PNG image is damaged.')
 const maximum=header.width*header.height*(header.bitDepth===16?8:4)+header.height*7+64
 try{inflateSync(Buffer.concat(chunks),{maxOutputLength:maximum})}catch{throw new EditorError('INVALID_PROJECT','The PNG image is damaged or exceeds its declared dimensions.')}
}
/** PNG samples are straight alpha. Working RGBA16 samples are native-endian, dense, premultiplied sRGB. */
export function decodeDeepPNG(bytes:Buffer):{width:number;height:number;deep:Uint16Array} {
 const header=inspectPNG(bytes);if(header.bitDepth!==16)throw new EditorError('INVALID_ARGUMENT','A 16-bit PNG is required.');assertPNGWorkingBudget(bytes,header);assertDeepPNGColorProfile(bytes);boundInterlacedPNG(bytes,header)
 let decoded:PNG
 try{decoded=PNG.sync.read(bytes,{checkCRC:true,skipRescale:true} as Parameters<typeof PNG.sync.read>[1])}catch{throw new EditorError('INVALID_PROJECT','The PNG image is damaged.')}
 const samples=decoded.data as unknown as Uint16Array
 if(!(samples instanceof Uint16Array)||samples.length!==header.width*header.height*4)throw new EditorError('INVALID_PROJECT','The 16-bit PNG samples could not be decoded.')
 // Own the decoder allocation, premultiply in place to avoid a second full high-depth buffer.
 for(let p=0;p<samples.length;p+=4){const alpha=samples[p+3];for(let c=0;c<3;c++)samples[p+c]=Math.round(samples[p+c]*alpha/65535)}
 return {width:header.width,height:header.height,deep:samples}
}
export function encodeDeepPNG(width:number,height:number,deep:Uint16Array):Buffer {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||deep.length!==width*height*4)throw new EditorError('INVALID_ARGUMENT','Invalid RGBA16 pixel dimensions.')
 if(width*height*48+height*7>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','The RGBA16 image exceeds the encoding working budget.')
 const straight=new Uint16Array(deep.length)
 for(let p=0;p<deep.length;p+=4){const alpha=deep[p+3];straight[p+3]=alpha;for(let c=0;c<3;c++){if(deep[p+c]>alpha)throw new EditorError('INVALID_ARGUMENT','RGBA16 colors must be premultiplied by alpha.');straight[p+c]=alpha?Math.min(65535,Math.round(deep[p+c]*65535/alpha)):0}}
 return PNG.sync.write({width,height,data:straight} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true})
}
export function deepDisplayPNG(width:number,height:number,deep:Uint16Array):Buffer {
 const rgba=quantizeDeep16ToRGBA8(deep,width,height)
 return PNG.sync.write({width,height,data:Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)} as PNG)
}
export interface AssetBuffers {bytes:Buffer;deep?:Uint16Array;hdr?:Float32Array;displayBytes?:Buffer}
export function countDeepAssetBytes(asset:AssetBuffers):number{return asset.bytes.byteLength+(asset.deep?.byteLength??0)+(asset.hdr?.byteLength??0)+(asset.displayBytes?.byteLength??0)}
export const countAssetBytes=countDeepAssetBytes
export function projectAssetByteBudget(physicalMemory=totalmem()):number{return documentPixelBudget(physicalMemory)*4}
/** Shared immutable versions may reuse buffers; count backing stores once, including their full byte length. */
export function countAssetBackingBytes(assets:Iterable<AssetBuffers>):number {
 const backing=new Set<ArrayBufferLike>();let bytes=0
 for(const asset of assets)for(const value of [asset.bytes,asset.deep,asset.hdr,asset.displayBytes])if(value&&!backing.has(value.buffer)){backing.add(value.buffer);bytes+=value.buffer.byteLength}
 return bytes
}
export function assertDeepAssetBudget(assets:Iterable<AssetBuffers>,additionalWorkingBytes=0,byteBudget=projectAssetByteBudget()):void {
 const bytes=additionalWorkingBytes+countAssetBackingBytes(assets)
 if(bytes>byteBudget)throw new EditorError('RESOURCE_LIMIT','The project’s retained image assets and decoding buffers exceed the document byte budget.',{estimatedBytes:bytes,maximumBytes:byteBudget})
}
export function pngHash(bytes:Buffer):string{return createHash('sha256').update(bytes).digest('hex')}
