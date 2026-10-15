import test from 'node:test'
import assert from 'node:assert/strict'
import {sampleCropBicubic,cropMitchell} from '../src/core/crop-sampling'

// The retained pre-optimization path is a differential oracle for accumulation
// order, including negative cubic lobes and samples straddling the image edge.
function previous(data:Uint8Array|Uint16Array|Float32Array,width:number,height:number,u:number,v:number,options:{premultiplied:boolean;mask?:boolean;background?:number}){
 const px=u-.5,py=v-.5,left=Math.floor(px),top=Math.floor(py),tx=px-left,ty=py-top,out=[0,0,0,0]
 for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){
  const sx=left+xx,sy=top+yy,inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,weight=cropMitchell(xx-tx)*cropMitchell(yy-ty),alpha=inside?data[at+3]:options.mask?255:0
  out[3]+=alpha*weight
  for(let c=0;c<3;c++){const color=inside?data[at+c]:options.background??0;out[c]+=color*(options.premultiplied?1:alpha/255)*weight}
 }
 return out
}

for(const depth of [8,16,32] as const)test(`cubic ${depth}-bit: cached weights retain every output bit across phases and boundaries`,()=>{
 const data=depth===8?new Uint8Array(7*6*4):depth===16?new Uint16Array(7*6*4):new Float32Array(7*6*4)
 for(let pixel=0;pixel<42;pixel++){
  const alpha=depth===8?(pixel*37)%256:depth===16?(pixel*1531)%65536:(pixel%13)/12
  data.set(depth===32?[alpha*(pixel%3?-.25:2.75),alpha*(pixel/17),alpha*.137,alpha]:[alpha*.137,alpha*.813,alpha*.431,alpha],pixel*4)
 }
 const before=data.slice()
 for(const u of [-2,-.5,0,.5,.501,1.17,3.234567,5.91,6.5,7,7.25,9])for(const v of [-2,-.37,0,.5,1.01,3.999,5.5,6.3,8]){
  const options={premultiplied:depth!==8}
  assert.deepEqual(sampleCropBicubic(data,7,6,u,v,options),previous(data,7,6,u,v,options),`${u},${v}`)
 }
 assert.deepEqual(data,before)
})

test('fully transparent hidden RGB cannot contaminate a neighboring stroke or alpha boundary',()=>{
 const width=8,height=8,a=new Uint8Array(width*height*4),b=a.slice()
 for(let i=0;i<width*height;i++)if(i%width<4){a.set([20,90,170,128],i*4);b.set([20,90,170,128],i*4)}else b.set([255,10,200,0],i*4)
 for(const u of [2.8,3.2,3.7,4.1,4.6,5.2])assert.deepEqual(sampleCropBicubic(a,width,height,u,3.37,{premultiplied:false}),sampleCropBicubic(b,width,height,u,3.37,{premultiplied:false}))
})

test('HDR interpolation retains negative values, values above white, and fractional alpha without 8-bit conversion',()=>{
 const data=new Float32Array(8*8*4)
 for(let i=0;i<64;i++)data.set([-0.3125,2.375,0.00390625,0.625],i*4)
 for(const [u,v] of [[3.1,3.9],[4.123,3.567],[2.51,4.25]]){
  const values=sampleCropBicubic(data,8,8,u,v,{premultiplied:true})
  for(const [channel,expected] of [-0.3125,2.375,0.00390625,0.625].entries())assert.ok(Math.abs(values[channel]-expected)<1e-12)
 }
})

test('outside-mask fill preserves opaque white or black over arbitrary subpixel edge phases',()=>{
 const data=new Uint8Array(3*3*4)
 for(const background of [0,255])for(const [u,v] of [[-3.2,-4.7],[8.9,9.1]]){
  const result=sampleCropBicubic(data,3,3,u,v,{premultiplied:false,mask:true,background})
  for(let c=0;c<4;c++)assert.ok(Math.abs(result[c]-(c===3?255:background))<1e-10)
 }
})
