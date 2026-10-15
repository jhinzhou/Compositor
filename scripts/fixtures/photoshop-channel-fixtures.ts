/** Tiny Adobe-spec fixtures authored as bytes. No ag-psd writer or user image.
 * The pixels deliberately include RGB hidden under alpha=0 and low alpha.
 */
export function photoshopChannelFixture(options:{depth?:8|16;width?:number;height?:number;mode?:'raw'|'raw-row-pad'|'rle'|'rle-row-pad'|'rle-nop';psb?:boolean}={}):Buffer{
 const {depth=16,width=2,height=1,mode='raw',psb=false}=options
 if(width<1||height<1||width>32||height>32)throw new Error('Tiny channel fixture supports dimensions1..32 only')
 const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b},i16=(n:number)=>{const b=Buffer.alloc(2);b.writeInt16BE(n);return b},u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b},i32=(n:number)=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b},length=(n:number)=>psb?Buffer.concat([u32(0),u32(n)]):u32(n)
 const values=[[65535,257,32768,65535,0,32896],[32768,65535,0,257,32896,65535],[0,32896,65535,32768,257,65535],[0,65535,32896,65535,257,0]],ids=[0,1,2,-1],rle=mode.startsWith('rle')
 const payloads=values.map(samples=>{
  const rows=Array.from({length:height},(_,y)=>{
   let row=Buffer.concat(Array.from({length:width},(_,x)=>{const sample=samples[(y*width+x)%samples.length];return depth===16?u16(sample):Buffer.from([Math.round(sample/257)])}))
   if(row.length%2&&mode.endsWith('row-pad'))row=Buffer.concat([row,Buffer.alloc(1)])
   if(rle)row=Buffer.concat([...(mode==='rle-nop'?[Buffer.from([128])]:[]),Buffer.from([row.length-1]),row,...(mode==='rle-nop'?[Buffer.from([128])]:[])])
   return row
  })
  return Buffer.concat([u16(rle?1:0),...(rle?rows.map(row=>psb?u32(row.length):u16(row.length)):[]),...rows])
 })
 const extra=Buffer.concat([u32(0),u32(0),Buffer.from([3,82,71,66])]),record=Buffer.concat([i32(0),i32(0),i32(height),i32(width),u16(4),...ids.flatMap((id,index)=>[i16(id),length(payloads[index].length)]),Buffer.from('8BIMnorm'),Buffer.from([255,0,0,0]),u32(extra.length),extra]),info=Buffer.concat([i16(1),record,...payloads]),section=Buffer.concat([length(info.length),info,Buffer.alloc(info.length%2),u32(0)])
 return Buffer.concat([Buffer.from('8BPS'),u16(psb?2:1),Buffer.alloc(6),u16(3),u32(height),u32(width),u16(depth),u16(3),u32(0),u32(0),length(section.length),section,u16(0),Buffer.alloc(width*height*3*(depth/8))])
}
