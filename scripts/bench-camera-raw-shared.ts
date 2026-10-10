import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {imageFilterSchema,applyImageFilter} from '../src/shared/image-filters'
import {cameraRawTables,cameraRawBrightness,cameraRawLightColor} from '../src/shared/camera-raw-adaptive'
import {cameraCurveColor} from '../src/shared/camera-raw-kernels'
const start=performance.now();cameraRawTables();const atlasDecodeMs=performance.now()-start
const width=1024,height=768,image={width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:(Math.floor(i/4)*[37,17,53][i%4])%256)},sourceHash=createHash('sha256').update(image.data).digest('hex')
const settings=imageFilterSchema.parse({kind:'cameraRaw',exposure:.61,temperature:33,tint:-14,contrast:27,highlights:-41,shadows:39,curve:{darks:-31,rgb:[{x:0,y:0},{x:.25,y:.2},{x:.75,y:.81},{x:1,y:1}]},mixer:{hue:[31,0,-19,0,0,21,0,0],saturation:[0,-26,0,13,0,0,0,0]},grading:{shadows:{hue:353,saturation:17},midtones:{hue:71,saturation:47},highlights:{hue:192,saturation:61},global:{hue:245,saturation:31},blending:17,balance:50}})
if(settings.kind!=='cameraRaw')throw new Error('Invalid benchmark settings')
const measured=performance.now(),brightness=cameraRawBrightness(image),brightnessMs=performance.now()-measured
const fused=()=>applyImageFilter(image,settings,undefined,1,brightness),separate=()=>cameraCurveColor(cameraRawLightColor(image,settings,undefined,false,brightness),settings.curve,settings.mixer,settings.grading)
const coldStart=performance.now(),cold=fused(),coldFoldedMs=performance.now()-coldStart
separate() // Both strategies now share the atlas and composed stage caches.
const folded:number[]=[],threePass:number[]=[]
let last=cold,other=cold
for(let i=0;i<5;i++){let at=performance.now();last=fused();folded.push(performance.now()-at);at=performance.now();other=separate();threePass.push(performance.now()-at)}
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
const differences=last.data.map((v,i)=>Math.abs(v-other.data[i]));let maximum=0;for(const v of differences)maximum=Math.max(maximum,v)
const report={scope:'Node shared kernel timing for identical synthetic 1024×768 RGB source. Not an Electron end-to-end or native C 5–20× benchmark. The folded native path and three-pass reference round/interpolate at different points.',atlasDecodeMs,brightnessMs,coldFoldedMs,warmFoldedMs:folded,warmThreePassMs:threePass,warmMedianSpeedup:median(threePass)/median(folded),maxFoldVsThreePassChannelDelta:maximum,sourceUnchanged:sourceHash===createHash('sha256').update(image.data).digest('hex'),outputHash:createHash('sha256').update(last.data).digest('hex')}
await mkdir('artifacts/parity-camera-raw',{recursive:true});await writeFile('artifacts/parity-camera-raw/shared-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
