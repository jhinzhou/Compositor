import type {Layer as PhotoshopLayer} from 'ag-psd'
import {EditorError,LIMITS} from '../shared/contracts'
import {inflateSync} from 'node:zlib'

/** Validate only payloads the bridge actually consumes. ZIP decoding remains
 * the pinned library's responsibility. This guard does not decode/correct RGB.
 * Adobe's Channel image data permits a pad byte for odd-sized layer rows.
 */
export function validatePhotoshopChannels(layer:PhotoshopLayer):void{
 const raw=layer.rawData
 if(!raw||raw.colorMode!==3||![8,16].includes(raw.bitsPerChannel))return
 for(const channel of raw.channels){
  const mask=channel.id===-2?layer.mask:channel.id===-3?layer.realMask:undefined
  if(channel.id<-3||channel.id>2)continue // Auxiliary channels are not consumed.
  if(channel.id<=-2&&!mask)continue // Existing missing-mask handling remains authoritative.
  if(channel.id>=-1&&(layer.children!==undefined||layer.adjustment))continue // Adjustment color data is undefined by the PSD spec.
  const box=mask??layer,width=Math.max(0,(box.right??0)-(box.left??0)),height=Math.max(0,(box.bottom??0)-(box.top??0)),data=channel.data
  // Empty/header-only channel records are legitimate for empty/fallback layers.
  // Presence of a raster is still decided by the existing bridge/library.
  if(!width||!height||!data?.length||channel.compression>1)continue
  const rowBytes=width*(raw.bitsPerChannel/8),expected=rowBytes*height,odd=rowBytes%2===1
  const fail=(reason:string,row?:number):never=>{throw new EditorError('INVALID_IMAGE',`Unable to decode Photoshop pixels: ${layer.name??'Layer'}: malformed ${channel.compression===0?'raw':'RLE'} channel ${channel.id}${row===undefined?'':` row ${row}`} (${reason}).`)}
  if(channel.compression===0){
   // Accept exact raw pixels, explicit per-row odd padding, or final alignment
   // padding. We do not infer a new pixel layout or modify the raw descriptor.
   if(data.length!==expected&&!(odd&&data.length===(rowBytes+1)*height)&&!(expected%2===1&&data.length===expected+1))fail('pixel byte length does not match dimensions')
   continue
  }
  const entryBytes=raw.large?4:2,tableBytes=height*entryBytes
  if(data.length<tableBytes)fail('truncated row length table')
  let at=tableBytes
  for(let row=0;row<height;row++){
   const table=row*entryBytes,length=entryBytes===2?data[table]*256+data[table+1]:data[table]*0x1000000+data[table+1]*0x10000+data[table+2]*256+data[table+3],end=at+length
   if(end>data.length)fail('row exceeds channel payload',row)
   let expanded=0
   while(at<end){
    // A single byte after a complete odd-width row can be its alignment pad.
    if(odd&&expanded===rowBytes&&end-at===1){at++;break}
    const byte=data[at++],signed=byte<128?byte:byte-256
    if(signed===-128)continue // PackBits no-op, including after a full row.
    const count=signed>=0?signed+1:1-signed,input=signed>=0?count:1
    if(at+input>end)fail('truncated PackBits packet',row)
    expanded+=count;at+=input
    if(expanded>rowBytes+(odd?1:0))fail('expanded row exceeds dimensions',row)
   }
   if(expanded!==rowBytes&&!(odd&&expanded===rowBytes+1))fail('expanded row is shorter than dimensions',row)
  }
  // An odd channel payload can also include its final alignment byte.
  if(at!==data.length&&!(at%2===1&&data.length===at+1))fail('unexpected trailing channel data')
 }
}

/** The pinned decoder treats 16bpc RLE bytes as Uint16 samples and ignores raw
 * odd-row padding. Normalize those proven layouts into its working raw path.
 * The parsed node is shallow-cloned, input file/payload buffers stay immutable.
 */
export function normalizePhotoshopChannels(layer:PhotoshopLayer):PhotoshopLayer{
 const raw=layer.rawData
 if(!raw||raw.colorMode!==3||![8,16].includes(raw.bitsPerChannel))return layer
 let normalizedBytes=0,changed=false,checked=false
 const area=(box:{left?:number;right?:number;top?:number;bottom?:number}|undefined)=>box?Math.max(0,(box.right??0)-(box.left??0))*Math.max(0,(box.bottom??0)-(box.top??0)):0
 // A conservative node-local peak: decompressed channels plus decoder RGBA,
 // quantization copy and PNG buffers. Already processed nodes' normalized
 // buffers are not retained; document/asset budgets remain the preflight's job.
 const decodedPixels=(layer.children!==undefined||layer.adjustment?0:area(layer))+area(layer.mask)+area(layer.realMask)
 const decodedWorkingBytes=decodedPixels*(raw.bitsPerChannel===16?24:12)
 const channels=raw.channels.map(channel=>{
  const mask=channel.id===-2?layer.mask:channel.id===-3?layer.realMask:undefined
  if(channel.id<-3||channel.id>2||channel.id<=-2&&!mask||channel.id>=-1&&(layer.children!==undefined||layer.adjustment))return channel
  const box=mask??layer,width=Math.max(0,(box.right??0)-(box.left??0)),height=Math.max(0,(box.bottom??0)-(box.top??0)),data=channel.data,rowBytes=width*(raw.bitsPerChannel/8),expected=rowBytes*height
  if(!width||!height||!data?.length)return channel
  const rle16=raw.bitsPerChannel===16&&channel.compression===1,rawPadding=channel.compression===0&&data.length!==expected
  if(!rle16&&!rawPadding)return channel
  if(!checked){validatePhotoshopChannels(layer);checked=true}
  if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||normalizedBytes+expected+decodedWorkingBytes>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','Photoshop normalized channel pixels exceed the resource budget.')
  normalizedBytes+=expected;const output=new Uint8Array(expected)
  if(rawPadding){
   if(rowBytes%2===1&&data.length===(rowBytes+1)*height)for(let row=0;row<height;row++)output.set(data.subarray(row*(rowBytes+1),row*(rowBytes+1)+rowBytes),row*rowBytes)
   else output.set(data.subarray(0,expected))
  }else{
   const entryBytes=raw.large?4:2;let at=height*entryBytes
   for(let row=0;row<height;row++){
    const table=row*entryBytes,length=entryBytes===2?data[table]*256+data[table+1]:data[table]*0x1000000+data[table+1]*0x10000+data[table+2]*256+data[table+3],end=at+length;let x=0
    while(at<end){const byte=data[at++],signed=byte<128?byte:byte-256;if(signed===-128)continue;const count=signed>=0?signed+1:1-signed
     if(signed>=0){output.set(data.subarray(at,at+count),row*rowBytes+x);at+=count}else {output.fill(data[at++],row*rowBytes+x,row*rowBytes+x+count)}x+=count
    }
   }
  }
  changed=true;return {...channel,compression:0,data:output}
 })
 return changed?{...layer,rawData:{...raw,channels}}:layer
}

/** Decode source RGBA16 directly, without the pinned reader's in-place endian
 * swaps or its byte-only RLE path. File channels use the full unsigned16 range:
 * real Photoshop27.11 ZIP-predicted PSD samples match its PNG16 export exactly.
 * Photoshop's internal15+1 representation must not cause another ×2 here.
 */
export function decodeOriginalPhotoshop16Pixels(layer:PhotoshopLayer,target:'image'|'mask'='image'):{width:number;height:number;data:Uint16Array}|undefined{
 const raw=layer.rawData
 if(!raw||raw.colorMode!==3||raw.bitsPerChannel!==16)return
 const box=target==='mask'?layer.mask:layer,width=Math.max(0,(box?.right??0)-(box?.left??0)),height=Math.max(0,(box?.bottom??0)-(box?.top??0))
 if(!width||!height)return
 const channels=raw.channels.filter(channel=>target==='mask'?channel.id===-2:channel.id>=-1&&channel.id<=2)
 if(!channels.some(channel=>channel.data?.length))return
 if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||width*height*16>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','Photoshop RGBA16 decoding exceeds the working budget.')
 validatePhotoshopChannels(layer)
 const seen=new Set<number>(),data=new Uint16Array(width*height*4),expected=width*height*2,rowBytes=width*2
 for(let p=3;p<data.length;p+=4)data[p]=65535
 const fail=(reason:string):never=>{throw new EditorError('INVALID_IMAGE',`Unable to decode Photoshop pixels: ${layer.name??'Layer'}: malformed 16-bit channel (${reason}).`)}
 for(const channel of channels){
  if(seen.has(channel.id))fail('duplicate channel');seen.add(channel.id)
  if(!channel.data?.length)continue
  let bytes:Uint8Array=channel.data
  if(channel.compression===0)bytes=channel.data
  else if(channel.compression===1){
   bytes=new Uint8Array(expected);const entry=raw.large?4:2;let at=height*entry
   for(let y=0;y<height;y++){
    const offset=y*entry,length=entry===2?channel.data[offset]*256+channel.data[offset+1]:channel.data[offset]*0x1000000+channel.data[offset+1]*0x10000+channel.data[offset+2]*256+channel.data[offset+3],end=at+length;let x=0
    while(at<end){const signed=(channel.data[at++]<<24)>>24;if(signed===-128)continue;const n=signed>=0?signed+1:1-signed;if(signed>=0){bytes.set(channel.data.subarray(at,at+n),y*rowBytes+x);at+=n}else bytes.fill(channel.data[at++],y*rowBytes+x,y*rowBytes+x+n);x+=n}
   }
  }else if(channel.compression===2||channel.compression===3){
   try{
    const inflated=inflateSync(channel.data,{maxOutputLength:expected,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}}
    if(inflated.buffer.length!==expected)fail('ZIP expansion does not match dimensions')
    const consumed=inflated.engine.bytesWritten
    if(consumed!==channel.data.length&&!(consumed%2===1&&channel.data.length===consumed+1&&channel.data[consumed]===0))fail('trailing ZIP data')
    bytes=inflated.buffer
   }catch(error){if(error instanceof EditorError)throw error;fail('invalid or oversized ZIP expansion')}
  }else throw new EditorError('UNSUPPORTED_FEATURE','This Photoshop 16-bit channel uses unsupported compression.')
  if(bytes.length!==expected)fail('expanded pixel byte length does not match dimensions')
  const component=channel.id===-1?3:channel.id;let previous=0
  for(let i=0;i<width*height;i++){
   if(i%width===0)previous=0
   let value=bytes[i*2]*256+bytes[i*2+1]
   if(channel.compression===3)value=(value+previous)%65536
   previous=value
   if(target==='mask')data.set([value,value,value,65535],i*4)
   else data[i*4+component]=value
  }
 }
 return {width,height,data}
}
