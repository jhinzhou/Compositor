// Minimal Adobe-spec oracle, independent of ag-psd. Deliberately only reads
// ordinary RGB8 PSD layer channels with raw or PackBits compression.
export function inspectRasterPSD(bytes:Buffer){
 let at=0
 const take=(n:number)=>{if(n<0||at+n>bytes.length)throw new Error('PSD oracle: section exceeds file size');const out=bytes.subarray(at,at+n);at+=n;return out}
 const u16=()=>take(2).readUInt16BE(),i16=()=>take(2).readInt16BE(),u32=()=>take(4).readUInt32BE(),i32=()=>take(4).readInt32BE()
 if(take(4).toString()!=='8BPS'||u16()!==1)throw new Error('PSD oracle supports version1 only')
 take(6);const documentChannels=u16(),height=u32(),width=u32(),depth=u16(),mode=u16()
 if(depth!==8||mode!==3)throw new Error('PSD oracle supports RGB8 only')
 take(u32());take(u32());const layerSectionLength=u32(),layerSectionEnd=at+layerSectionLength
 if(layerSectionEnd>bytes.length)throw new Error('PSD oracle: invalid layer section')
 const layerInfoLength=u32(),layerInfoEnd=at+layerInfoLength,count=Math.abs(i16())
 if(count>128)throw new Error('PSD oracle limited to128 raster records')
 const records=[]
 for(let i=0;i<count;i++){
  const top=i32(),left=i32(),bottom=i32(),right=i32(),channels=[]
  for(let c=0,n=u16();c<n;c++)channels.push({id:i16(),length:u32()})
  take(12);const extraLength=u32();take(extraLength)
  records.push({top,left,bottom,right,channels})
 }
 const layers=records.map(record=>{
  const w=record.right-record.left,h=record.bottom-record.top,pixels=new Uint8Array(w*h*4),errors:string[]=[]
  for(let i=3;i<pixels.length;i+=4)pixels[i]=255
  const channels=record.channels.map(channel=>{
   const compression=u16(),payload=take(channel.length-2),plane=new Uint8Array(w*h)
   if(channel.id < -1||channel.id>2)throw new Error('PSD oracle has no mask/auxiliary channel support')
   if(compression===0){if(payload.length!==plane.length)errors.push(`channel${channel.id}: raw length mismatch`);plane.set(payload.subarray(0,plane.length))}
   else if(compression===1){
    let p=h*2
    for(let y=0;y<h;y++){
     const length=payload.readUInt16BE(y*2),end=p+length;let x=0
     if(end>payload.length)throw new Error('PSD oracle: RLE row exceeds channel')
     while(p<end){const signed=payload.readInt8(p++)
      if(signed===-128)continue
      const n=signed>=0?signed+1:1-signed
      if(p+(signed>=0?n:1)>end){errors.push(`channel${channel.id} row${y}: truncated PackBits packet`);p=end;break}
      if(x+n>w)errors.push(`channel${channel.id} row${y}: expanded row exceeds width`)
      if(signed>=0){for(let j=0;j<n;j++){const value=payload[p++];if(x<w)plane[y*w+x]=value;x++}}
      else {const value=payload[p++];for(let j=0;j<n;j++){if(x<w)plane[y*w+x]=value;x++}}
     }
     if(x!==w)errors.push(`channel${channel.id} row${y}: expanded width${x}, expected${w}`)
    }
    if(p!==payload.length)errors.push(`channel${channel.id}: trailing channel bytes`)
   }else throw new Error(`PSD oracle: unsupported compression${compression}`)
   const offset=channel.id===-1?3:channel.id;for(let i=0;i<plane.length;i++)pixels[i*4+offset]=plane[i]
   return {id:channel.id,compression,length:channel.length,shaPlane:plane}
  })
  return {width:w,height:h,left:record.left,top:record.top,pixels,errors,channels}
 })
 if(at>layerInfoEnd)throw new Error('PSD oracle: layer records overrun section')
 return {width,height,depth,documentChannels,layers}
}
