import {performance} from 'node:perf_hooks'
import {mkdir,writeFile} from 'node:fs/promises'
import {sampleCropBicubic,cropMitchell} from '../src/core/crop-sampling'

// Retain the previous implementation here so this is a reproducible comparison
// of kernel evaluation reuse, independent of UI and PNG encoder timings.
function previous(data:Uint8Array|Uint16Array|Float32Array,width:number,height:number,u:number,v:number,options:{premultiplied:boolean}){
 const px=u-.5,py=v-.5,left=Math.floor(px),top=Math.floor(py),tx=px-left,ty=py-top,out=[0,0,0,0]
 for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){
  const sx=left+xx,sy=top+yy,inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,weight=cropMitchell(xx-tx)*cropMitchell(yy-ty),alpha=inside?data[at+3]:0
  out[3]+=alpha*weight
  for(let c=0;c<3;c++)out[c]+=(inside?data[at+c]:0)*(options.premultiplied?1:alpha/255)*weight
 }
 return out
}
const samples=400_000,repetitions=7,results=[]
for(const depth of [8,16,32]){
 const data=depth===8?new Uint8Array(128*128*4):depth===16?new Uint16Array(128*128*4):new Float32Array(128*128*4)
 for(let n=0;n<data.length;n++)data[n]=depth===32?((n*131%65536)/4096)-1:depth===16?(n*131)%65536:(n*131)%256
 const options={premultiplied:depth!==8},run=(fn:typeof previous)=>{let checksum=0;const start=performance.now();for(let i=0;i<samples;i++){const values=fn(data,128,128,2.123+(i*17%124),2.567+(i*29%124),options);checksum+=values[0]+values[3]}return {ms:performance.now()-start,checksum}}
 run(previous);run(sampleCropBicubic)
 const before=[],after=[]
 for(let iteration=0;iteration<repetitions;iteration++){
  const a=iteration%2?run(sampleCropBicubic):run(previous),b=iteration%2?run(previous):run(sampleCropBicubic),old=iteration%2?b:a,current=iteration%2?a:b
  if(old.checksum!==current.checksum)throw new Error('Kernel optimization changed sampled values')
  before.push(old.ms);after.push(current.ms)
 }
 const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
 results.push({depth,samples,repetitions,oldMilliseconds:before,newMilliseconds:after,medianBefore:median(before),medianAfter:median(after),speedup:median(before)/median(after),exactChecksumMatch:true})
}
await mkdir('artifacts/alpha26-sampling',{recursive:true});await writeFile('artifacts/alpha26-sampling/benchmark.json',JSON.stringify({kernelEvaluationsBefore:32,kernelEvaluationsAfter:{straightRGBA8:8,premultipliedRGB16HDR:32},premultipliedOptimization:'Hoist format branch outside channel/tap loops.',limits:'Sampler-only local benchmark. Not an end-to-end Photoshop or renderer speed claim.',results},null,2)+'\n');console.log(JSON.stringify(results,null,2))
