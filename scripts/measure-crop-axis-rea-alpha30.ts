import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {makeAsset} from '../src/core/project-io'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {planCropAxisSmoother} from '../src/core/crop-axis-smoother'
import type {CropCorners} from '../src/shared/crop-projective'
const fixturePath=process.argv[2]??'fixtures/parity/photoshop-27.11-perspective-axis-rea-alpha30.json',out=process.argv[3]??'artifacts/alpha30-axis-rea',bytes=await readFile(fixturePath),fixture=JSON.parse(bytes.toString()),sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
await mkdir(out,{recursive:true})
function compare(a:Uint8Array,b:Uint8Array){let rgb=0,max=0,alpha=0,alphaMax=0,pm=0,pmMax=0,visible=0,visibleMax=0,visibleCount=0;for(let at=0;at<a.length;at+=4){const ad=Math.abs(a[at+3]-b[at+3]);alpha+=ad;alphaMax=Math.max(alphaMax,ad);for(let c=0;c<3;c++){const d=Math.abs(a[at+c]-b[at+c]),pd=Math.abs(a[at+c]*a[at+3]/255-b[at+c]*b[at+3]/255);rgb+=d;max=Math.max(max,d);pm+=pd;pmMax=Math.max(pmMax,pd);if(b[at+3]){visible+=d;visibleMax=Math.max(visibleMax,d);visibleCount++}}}const pixels=a.length/4;return {rgbMAE:rgb/(pixels*3),rgbMax:max,alphaMAE:alpha/pixels,alphaMax,premultMAE:pm/(pixels*3),premultMax:pmMax,visibleRGBMAE:visible/Math.max(1,visibleCount),visibleRGBMax:visibleMax}}
const measurements=[]
for(const reference of fixture.cases){
 const record=fixture.sources[reference.sourceVariant],source=inflateSync(Buffer.from(record.rgbaZlib,'base64')),native=inflateSync(Buffer.from(reference.nativeRGBAZlib,'base64'));assert.equal(sha(source),record.sha256);assert.equal(sha(native),reference.nativeRGBA_SHA256)
 const input=new PNG({width:record.width,height:record.height});input.data.set(source);const asset=makeAsset('owned.png',PNG.sync.write(input)),sourceBefore=sha(asset.bytes),work={samples:0},plan=planCropAxisSmoother({width:record.width,height:record.height,data:source},reference.width,reference.height),output=perspectiveCropRaster(asset,{origin:[0,0],size:[record.width,record.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'},reference.corners as CropCorners,reference.width,reference.height,'High quality',false,0,work),actual=PNG.sync.read(output.bytes).data
 assert.equal(!!plan,reference.accepted);assert.equal(sha(asset.bytes),sourceBefore);assert.equal(sha(source),record.sha256)
 const expectedSHA=reference.accepted?reference.nativeRGBA_SHA256:reference.baselineRGBA_SHA256;assert.equal(sha(actual),expectedSHA)
 const metrics=compare(actual,native),regressions=Object.keys(metrics).filter(key=>(metrics as Record<string,number>)[key]>reference.baseline[key]+1e-12);assert.deepEqual(regressions,[])
 await writeFile(`${out}/${reference.name}.png`,output.bytes)
 measurements.push({name:reference.name,status:reference.accepted?'NATIVE_RGBA_EXACT':'DECLINED_BASELINE_IDENTICAL',declineReason:reference.declineReason,baseline:reference.baseline,actual:metrics,actualRGBA_SHA256:sha(actual),nativeRGBA_SHA256:reference.nativeRGBA_SHA256,workSamples:work.samples,scratchBytes:plan?.scratchBytes??0,sourceUnchanged:true})
}
const report={status:'PASS',fixturePath,fixtureSHA256:sha(bytes),frozenCandidateSHA256:fixture.frozenCandidateSHA256,node:process.versions.node,sourceSHA256:{axis:sha(await readFile('src/core/crop-axis-smoother.ts')),cropActions:sha(await readFile('src/core/crop-actions.ts'))},counts:{nativeExact:measurements.filter(m=>m.status==='NATIVE_RGBA_EXACT').length,declinedUnchanged:measurements.filter(m=>m.status==='DECLINED_BASELINE_IDENTICAL').length},limits:['Actual core/source measurement only; no new Photoshop execution or GUI/package gate.','Fixed independent native/source fixture is a production regression after research freeze.','General perspective, minification, odd centers, fractional crop, masks and high depth retain their previous path.'],measurements}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,counts:report.counts,sourceSHA256:report.sourceSHA256,measurements:measurements.map(m=>({name:m.name,status:m.status,workSamples:m.workSamples,...m.actual}))},null,2))
