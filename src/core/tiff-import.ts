import {LIMITS} from '../shared/limits'
import { inflateSync } from 'node:zlib'
import { encodePNG, type ExportRaster } from './export-codecs'
import {inspectICC,type ColorPlan} from './foreign-color'

export interface TIFFRaster extends ExportRaster { colorProfile:string; warnings:string[] }
const workingBudget=512*1024*1024
/** Classic TIFF, strips/tiles, chunky/planar, unsigned 1/2/4/8/16-bit samples.
 * Like the native RGBA8 working surface, 16-bit integers are quantized to 8-bit.
 * Matrix/TRC ICC is converted to sRGB; unsupported profiles/codecs fail explicitly.
 * First IFD only, matching native still-image import. */
export function decodeTIFF(input: Uint8Array): TIFFRaster {
  if(input.byteLength>LIMITS.maxAssetBytes)throw new Error('TIFF asset exceeds import byte limits.')
  const bytes = Buffer.from(input.buffer,input.byteOffset,input.byteLength), little = bytes.toString('ascii', 0, 2) === 'II'
  const bounds = (offset: number, size: number) => { if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) throw new Error('Truncated TIFF data.') }
  const u16 = (offset: number) => { bounds(offset, 2); return little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset) }
  const u32 = (offset: number) => { bounds(offset, 4); return little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset) }
  if (bytes.length < 8 || !['II', 'MM'].includes(bytes.toString('ascii', 0, 2)) || u16(2) !== 42) throw new Error('Expected a classic TIFF image; BigTIFF is not supported.')
  const ifd = u32(4), count = u16(ifd); if (count > 4096) throw new Error('TIFF directory is too large.')
  bounds(ifd + 2, count * 12 + 4)
  const tags = new Map<number, number[]>();let profile:Uint8Array|undefined
  for (let index = 0; index < count; index++) {
    const offset = ifd + 2 + index * 12, tag = u16(offset), type = u16(offset + 2), length = u32(offset + 4)
    if (![256,257,258,259,262,266,273,274,277,278,279,284,301,317,318,319,320,322,323,324,325,338,339,34675].includes(tag)) continue
    if(tag===34675){if(profile||![1,7].includes(type)||length<132||length>1024*1024)throw new Error('Unsupported TIFF ICC profile tag.');const start=u32(offset+8);bounds(start,length);profile=bytes.subarray(start,start+length);continue}
    if([301,318,319].includes(tag))throw new Error('TIFF colorimetry/transfer tags require an explicit color-managed conversion.')
    if (![1, 3, 4].includes(type) || length < 1 || length > 1_000_000) throw new Error(`Unsupported TIFF tag ${tag}.`)
    const size = type === 1 ? 1 : type === 3 ? 2 : 4, start = length * size <= 4 ? offset + 8 : u32(offset + 8)
    bounds(start, length * size)
    if (tags.has(tag)) throw new Error(`Duplicate TIFF tag ${tag}.`)
    tags.set(tag, Array.from({ length }, (_, element) => type === 1 ? bytes[start + element] : type === 3 ? u16(start + element * size) : u32(start + element * size)))
  }
  const tag = (id: number, fallback?: number) => tags.get(id)?.[0] ?? fallback
  const width = tag(256)!, height = tag(257)!, samples = tag(277, 1)!, photo = tag(262)!, compression = tag(259, 1)!, orientation = tag(274, 1)!, predictor = tag(317, 1)!, planar=tag(284,1)!,fillOrder=tag(266,1)!
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new Error('TIFF dimensions exceed import limits.')
  if(![1,2].includes(planar)||![1,2].includes(fillOrder))throw new Error('Unsupported TIFF planar configuration or fill order.')
  const bits = tags.get(258) ?? [1],depth=bits[0]!,sampleFormat=tags.get(339)??[1]
  if(sampleFormat.some(value=>value!==1)||![1,samples].includes(sampleFormat.length))throw new Error('TIFF signed/floating point HDR samples require explicit tone mapping.')
  if(![1,2,4,8,16].includes(depth)||bits.some(value=>value!==depth)||![1,samples].includes(bits.length))throw new Error('Only uniform unsigned 1/2/4/8/16-bit TIFF samples are supported.')
  if (![0,1,2,3].includes(photo) || !(photo===2?[3,4].includes(samples):photo===3?samples===1:[1,2].includes(samples))) throw new Error('Only RGB, grayscale, and indexed TIFF are supported; CMYK/YCbCr require color conversion.')
  if(photo===3&&depth>8)throw new Error('TIFF indexed samples above 8 bits are not supported.')
  if (![1,5,8,32946,32773].includes(compression)) throw new Error(`TIFF compression ${compression} is not supported; JPEG/CCITT requires an external conversion.`)
  if (![1,2].includes(predictor)||predictor===2&&depth<8||orientation<1||orientation>8)throw new Error('Unsupported TIFF predictor or orientation.')
  const tile=tags.has(322)||tags.has(323)||tags.has(324)||tags.has(325),blockWidth=tile?tag(322)!:width,blockHeight=tile?tag(323)!:tag(278,height)!
  if(!Number.isSafeInteger(blockWidth)||!Number.isSafeInteger(blockHeight)||blockWidth<1||blockHeight<1||tile&&(blockWidth%16!==0||blockHeight%16!==0||blockWidth>LIMITS.maxSide||blockHeight>LIMITS.maxSide))throw new Error('Invalid TIFF strip/tile geometry.')
  const across=tile?Math.ceil(width/blockWidth):1,down=Math.ceil(height/blockHeight),perPlane=across*down,planes=planar===2?samples:1,blockCount=perPlane*planes
  const offsets=tags.get(tile?324:273),lengths=tags.get(tile?325:279)
  if(!offsets||!lengths||offsets.length!==blockCount||lengths.length!==blockCount||blockCount>1_000_000)throw new Error('Missing or inconsistent TIFF strips/tiles.')
  const max=(1<<depth)-1,entries=1<<depth,colorMap=tags.get(320)
  if(photo===3&&colorMap?.length!==entries*3)throw new Error('Missing TIFF indexed color map.')
  const extra=tags.get(338)??[],hasAlpha=samples===(photo===2?4:2)&&[1,2].includes(extra[0]??0)
  if(extra.length>1||extra.some(x=>![0,1,2].includes(x)))throw new Error('Unsupported TIFF extra samples.')
  let color:ColorPlan={label:'Assumed sRGB (untagged)',warnings:[]}
  if(profile){if(![2,3].includes(photo))throw new Error('TIFF grayscale ICC requires an explicit color-managed conversion.');try{color=inspectICC(profile);color.warnings=color.warnings.map(x=>x.replaceAll('HEIF','TIFF'))}catch(cause){throw new Error(`TIFF ICC conversion failed: ${cause instanceof Error?cause.message:String(cause)}`)}}
  const channels=planar===2?1:samples,rowBytes=Math.ceil(blockWidth*channels*depth/8),maxBlockPixels=blockWidth*Math.min(blockHeight,tile?blockHeight:height),maxBlockBytes=rowBytes*Math.min(blockHeight,tile?blockHeight:height)
  const working=width*height*(samples*2+(orientation===1?4:8))+maxBlockBytes+maxBlockPixels*channels*2
  if(!Number.isSafeInteger(working)||working>workingBudget)throw new Error('TIFF decoding working memory exceeds the 512 MiB codec budget.')
  // Validate all ranges and expected output allocations before any decompression.
  let totalDecodeBytes=0,totalCompressedBytes=0
  for(let i=0;i<blockCount;i++){bounds(offsets[i]!,lengths[i]!);totalCompressedBytes+=lengths[i]!;const local=i%perPlane,by=Math.floor(local/across)*blockHeight;totalDecodeBytes+=rowBytes*(tile?blockHeight:Math.min(blockHeight,height-by))}
  if(totalDecodeBytes>workingBudget)throw new Error('TIFF padded strip/tile decoding exceeds the codec work budget.')
  if(totalCompressedBytes>Math.min(workingBudget,totalDecodeBytes*4+65536))throw new Error('TIFF compressed strip/tile input exceeds the codec work budget.')
  const decoded=new Uint16Array(width*height*samples)
  for(let block=0;block<blockCount;block++){
    const local=block%perPlane,plane=Math.floor(block/perPlane),bx=(local%across)*blockWidth,by=Math.floor(local/across)*blockHeight,rows=tile?blockHeight:Math.min(blockHeight,height-by),expected=rowBytes*rows,source=bytes.subarray(offsets[block],offsets[block]!+lengths[block]!)
    let packed:Uint8Array
    if(compression===1)packed=source
    else if(compression===5)packed=lzw(source,expected)
    else if(compression===32773)packed=packBits(source,expected)
    else packed=inflateSync(source,{maxOutputLength:expected})
    if(packed.length!==expected)throw new Error('TIFF strip/tile pixel count does not match its geometry.')
    if(fillOrder===2){packed=Uint8Array.from(packed,value=>{value=(value>>>4)|(value<<4);value=((value&0xcc)>>>2)|((value&0x33)<<2);return ((value&0xaa)>>>1)|((value&0x55)<<1)})}
    const values=new Uint16Array(blockWidth*rows*channels)
    for(let y=0;y<rows;y++)for(let x=0;x<blockWidth*channels;x++){
      const bit=x*depth,at=y*rowBytes+(bit>>>3),index=y*blockWidth*channels+x
      let value=depth===16?(little?packed[at]!|packed[at+1]!<<8:packed[at]!<<8|packed[at+1]!):depth===8?packed[at]!:(packed[at]!>>>(8-depth-(bit&7)))&max
      if(predictor===2&&x>=channels)value=(value+values[index-channels]!)&max
      values[index]=value
    }
    for(let y=0;y<Math.min(rows,height-by);y++)for(let x=0;x<Math.min(blockWidth,width-bx);x++)for(let c=0;c<channels;c++)decoded[((by+y)*width+bx+x)*samples+(planar===2?plane:c)]=values[(y*blockWidth+x)*channels+c]!
  }
  const result=new Uint8Array(width*height*4),srgb=(v:number)=>v<=.0031308?12.92*v:1.055*Math.max(0,v)**(1/2.4)-.055
  const tone=(channel:number,value:number)=>{const p=value*255,n=Math.floor(p),curve=color.curves![channel]!;return curve[n]!+(curve[Math.min(255,n+1)]!-curve[n]!)*(p-n)},quantize=(v:number)=>Math.round(Math.min(1,Math.max(0,v))*255)
  for(let i=0;i<width*height;i++){
    const at=i*samples,to=i*4,alpha=hasAlpha?decoded[at+samples-1]!/max:1
    let r:number,g:number,b:number
    if(photo===2){r=decoded[at]!/max;g=decoded[at+1]!/max;b=decoded[at+2]!/max}
    else if(photo===3){const index=decoded[at]!;r=(colorMap![index]!>>>8)/255;g=(colorMap![index+entries]!>>>8)/255;b=(colorMap![index+entries*2]!>>>8)/255}
    else {r=photo===0?1-decoded[at]!/max:decoded[at]!/max;g=b=r}
    if(hasAlpha&&extra[0]===1){r=alpha?Math.min(1,r/alpha):0;g=alpha?Math.min(1,g/alpha):0;b=alpha?Math.min(1,b/alpha):0}
    if(color.matrix&&color.curves){const rr=tone(0,r),gg=tone(1,g),bb=tone(2,b),m=color.matrix;r=srgb(m[0]!*rr+m[1]!*gg+m[2]!*bb);g=srgb(m[3]!*rr+m[4]!*gg+m[5]!*bb);b=srgb(m[6]!*rr+m[7]!*gg+m[8]!*bb)}
    result[to]=quantize(r);result[to+1]=quantize(g);result[to+2]=quantize(b);result[to+3]=quantize(alpha)
  }
  const warnings=[...color.warnings];if(depth===16)warnings.push('TIFF unsigned 16-bit samples were quantized to the RGBA8 working surface.')
  if (orientation === 1) return { width, height, data: result,colorProfile:color.label,warnings }
  const swap=orientation>=5,outputWidth=swap?height:width,outputHeight=swap?width:height,output=new Uint8Array(result.length)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const coordinates=[[x,y],[width-1-x,y],[width-1-x,height-1-y],[x,height-1-y],[y,x],[height-1-y,x],[height-1-y,width-1-x],[y,width-1-x]][orientation-1]!
    output.set(result.subarray((y*width+x)*4,(y*width+x)*4+4),(coordinates[1]!*outputWidth+coordinates[0]!)*4)
  }
  return {width:outputWidth,height:outputHeight,data:output,colorProfile:color.label,warnings}
}
function packBits(source: Uint8Array, maximum: number): Uint8Array {
  const result = new Uint8Array(maximum); let read = 0, written = 0
  while (read < source.length) {
    const count = source[read++]
    if (count === 128) continue
    const length = count < 128 ? count + 1 : 257 - count
    if (written + length > maximum || read + (count < 128 ? length : 1) > source.length) throw new Error('Invalid TIFF PackBits strip.')
    if (count < 128) { result.set(source.subarray(read, read + length), written); read += length }
    else result.fill(source[read++], written, written + length)
    written += length
  }
  if (written !== maximum) throw new Error('Truncated TIFF PackBits strip.')
  return result
}
function lzw(source: Uint8Array, maximum: number): Uint8Array {
  const result = new Uint8Array(maximum); let position = 0, written = 0, width = 9, next = 258, previous: Uint8Array | undefined, table: Uint8Array[] = []
  const literals=Array.from({length:256},(_,i)=>Uint8Array.of(i))
  const reset = () => { table = literals.slice(); width = 9; next = 258; previous = undefined }
  reset()
  const code = () => { if (position + width > source.length * 8) throw new Error('Truncated TIFF LZW strip.'); let value = 0; for (let bit = 0; bit < width; bit++) { value = value * 2 + ((source[position >>> 3] >>> (7 - (position & 7))) & 1); position++ } return value }
  while (true) {
    const value = code()
    if (value === 256) { reset(); continue }
    if (value === 257) break
    let entry = table[value]
    if (!entry && previous && value === next) { entry = new Uint8Array(previous.length + 1); entry.set(previous); entry[previous.length] = previous[0] }
    if (!entry || written + entry.length > maximum) throw new Error('Invalid TIFF LZW strip.')
    result.set(entry, written); written += entry.length
    if (previous && next < 4096) { const added = new Uint8Array(previous.length + 1); added.set(previous); added[previous.length] = entry[0]; table[next++] = added; if (width < 12 && next === (1 << width) - 1) width++ }
    previous = entry
  }
  if (written !== maximum) throw new Error('Truncated TIFF LZW pixels.')
  return result
}
export function tiffToPNG(source: Uint8Array): Buffer { return encodePNG(decodeTIFF(source)) }
