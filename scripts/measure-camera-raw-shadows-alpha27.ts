/** Recompute actual C fixture deltas; no GUI, source edits or fitted thresholds. */
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {cameraRawShadowsPremultiplied} from '../src/shared/camera-raw-shadows'
import {applyImageFilter} from '../src/shared/image-filters'
import assert from 'node:assert/strict'

const input=process.argv[2]??'fixtures/parity/native-735c2cc-camera-raw-shadows-alpha27.json',output=process.argv[3]??'artifacts/alpha27-camera-raw-shadows',fixture=JSON.parse(await readFile(input,'utf8'))
const decode=(entry:{rgbaZlib:string;sha256:string})=>{const value=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(createHash('sha256').update(value).digest('hex'),entry.sha256);return new Uint8Array(value)}
function stats(actual:Uint8Array|Uint8ClampedArray,native:Uint8Array){let sum=0,squares=0,max=0,alphaMax=0,different=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-native[i]);if(i%4===3)alphaMax=Math.max(alphaMax,delta);else{sum+=delta;squares+=delta*delta;max=Math.max(max,delta);if(delta)different++}}const count=actual.length/4*3;return {rgbMAE:sum/count,rgbRMSE:Math.sqrt(squares/count),rgbMax:max,alphaMax,rgbDifferentChannels:different}}
const rows=[]
for(const item of fixture.cases){const source=decode(item.source),native=decode(item.expected),start=performance.now(),actual=cameraRawShadowsPremultiplied(source,item.width,item.height,item.amount,item.samplingScale);rows.push({name:item.name,width:item.width,height:item.height,amount:item.amount,samplingScale:item.samplingScale,durationMs:performance.now()-start,...stats(actual,native)})}
const pipeline=[]
for(const item of fixture.pipelineCases){const source=decode(item.source),native=decode(item.expected),actual=applyImageFilter({width:item.width,height:item.height,data:Uint8ClampedArray.from(source)},{kind:'cameraRaw',...item.settings}),falls=[];for(let x=1;x<item.width;x++)if(actual.data[x*4]<actual.data[(x-1)*4])falls.push([x,actual.data[(x-1)*4],actual.data[x*4]]);pipeline.push({name:item.name,settings:item.settings,...stats(actual.data,native),nativeFalls:item.nativeFalls,actualFalls:falls})}
await mkdir(output,{recursive:true});await writeFile(join(output,'comparison.json'),JSON.stringify({referenceKind:fixture.referenceKind,upstream:fixture.upstream,resourceSHA256:fixture.resourceSHA256,scope:'Actual upstream C transfer, not independent Photoshop equality. Combined-ramp native quantization drops explicitly retained.',productionChangedByMeasurement:false,rows,pipeline},null,2));console.log(JSON.stringify({output,cases:rows.length,max:Math.max(...rows.map(row=>row.rgbMax)),pipelineCases:pipeline.length}))
