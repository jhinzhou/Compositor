/** Read-only decoder probe on the project's licensed fixture. Never changes product RAW settings. */
import {Worker} from 'node:worker_threads'
import {createRequire} from 'node:module'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {FOREIGN_WORKER_SOURCE} from '../src/core/foreign-worker-source'
import {DEFAULT_RAW_SETTINGS,FOREIGN_CODEC_LIMITS} from '../src/core/foreign-import'
const require=createRequire(import.meta.url),rawModule=join(dirname(require.resolve('libraw-wasm')),'libraw.js'),rawWasm=rawModule.replace(/\.js$/,'.wasm')
const bytes=new Uint8Array(await readFile(resolve('tests/fixtures/foreign-import/sample.dng'))),source=JSON.parse(await readFile(resolve('tests/fixtures/foreign-import/SOURCE.json'),'utf8'))
const workerSource=FOREIGN_WORKER_SOURCE.replace('highlight:opts.highlightMode,threshold:opts.noiseReductionThreshold,userQual:3','highlight:workerData.audit.highlight??opts.highlightMode,threshold:workerData.audit.threshold??0,userQual:3')
if(workerSource===FOREIGN_WORKER_SOURCE)throw Error('RAW probe injection point changed; review before running.')
async function probe(audit:{threshold?:number;highlight?:number}){return await new Promise<{width:number;height:number;rgba:Uint8Array;metadata:Record<string,unknown>}>((resolve,reject)=>{
 const input=new Uint8Array(bytes),worker=new Worker(workerSource,{eval:true,execArgv:[],workerData:{bytes:input,format:'raw',raw:{...DEFAULT_RAW_SETTINGS,halfSize:true},audit,color:{label:'sRGB',warnings:[]},rawModule,rawWasm,maxSide:30000,maxPixels:200000000,wasmBytes:FOREIGN_CODEC_LIMITS.wasmBytes,metadataOnly:false},transferList:[input.buffer],resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32}})
 let settled=false;const finish=(error?:unknown,value?:any)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value)}
 const timer=setTimeout(()=>finish(Error('RAW capability probe timed out')),60000)
 worker.on('message',message=>{if(message.type==='result')finish(undefined,message);if(message.type==='error')finish(Error(message.message))});worker.on('error',error=>finish(error));worker.on('exit',code=>{if(!settled)finish(Error(`RAW capability probe exited ${code}`))})
 })}
const baseline=await probe({threshold:0,highlight:0}),results=[]
for(const settings of [{threshold:1000,highlight:0},{threshold:0,highlight:3},{threshold:0,highlight:9}]){
 const result=await probe(settings);if(result.width!==baseline.width||result.height!==baseline.height||result.rgba.length!==baseline.rgba.length)throw Error('Probe changed dimensions unexpectedly.')
 let changedSamples=0,totalAbsoluteDelta=0;for(let i=0;i<result.rgba.length;i++){const delta=Math.abs(result.rgba[i]-baseline.rgba[i]);if(delta)changedSamples++;totalAbsoluteDelta+=delta}
 results.push({settings,width:result.width,height:result.height,rgbaSha256:createHash('sha256').update(result.rgba).digest('hex'),changedSamples,totalAbsoluteDelta})
}
const report={generatedAt:new Date().toISOString(),scope:'One licensed real DNG; option acceptance and sample differences, not CIRAWFilter equivalence or all-camera quality.',dependency:'libraw-wasm@1.6.0',source,sourceInputSha256:createHash('sha256').update(bytes).digest('hex'),baseline:{width:baseline.width,height:baseline.height,rgbaSha256:createHash('sha256').update(baseline.rgba).digest('hex')},results,lensCorrection:'No lens-profile correction option in shipped LibRawSettings. Lens metadata does not establish correction capability.',productChanged:false}
const directory=resolve('test-results/raw-capability-audit');await mkdir(directory,{recursive:true});await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:join(directory,'report.json'),baseline:report.baseline,results,lensCorrection:report.lensCorrection,productChanged:false},null,2))
