/** Offline diagnosis of the first GUI smoke failure; never launches Electron. */
import {readFileSync,writeFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {makeHDRAsset,makeAsset} from '../src/core/project-io'
import {decodeEXR} from '../src/core/hdr-codecs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
const fixture=JSON.parse(readFileSync('fixtures/parity/photoshop-27.11-perspective-gui-alpha27.json','utf8')),reference=fixture.cases.find((c:any)=>c.name==='actual-mouse-auto-292163'),source=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64')),width=fixture.source.width,height=fixture.source.height
const data=new Float32Array(width*height*4);for(let i=0;i<data.length;i++)data[i]=i%4===3?source[i]/255:i%4===0?1.25+source[i]/255:i%4===1?-.5+source[i]/1020:source[i]/255
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),difference=(a:Float32Array,b:Float32Array)=>{let count=0,max=0;const channels=[0,0,0,0];for(let i=0;i<a.length;i++){if(a[i]!==b[i]){count++;channels[i%4]++}max=Math.max(max,Math.abs(a[i]-b[i]))}return {count,max,channels}}
const authored=makeHDRAsset('probe.exr',width,height,data),canonical=makeAsset(authored.file,authored.bytes,{allowHDR:true}),placement={origin:[0,0] as [number,number],size:[width,height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
const originalExpected=perspectiveCropRaster(authored,placement,reference.corners,292,163,'High quality'),loadedExpected=perspectiveCropRaster(canonical,placement,reference.corners,292,163,'High quality'),loadedDecoded=decodeEXR(loadedExpected.bytes).hdr
const failureBytes=readFileSync('artifacts/alpha27-development-final/perspective-alpha27/first-failure.json'),failure=JSON.parse(failureBytes.toString('utf8')),actualHash=failure.measurements.failurePublicState.value.assets[0].hash
assert.equal(sha(loadedExpected.bytes),actualHash,'Canonical loaded-source core EXR bytes must reproduce the actual GUI output hash')
const report={status:'OFFLINE_DIAGNOSED',firstFailureFile:'artifacts/alpha27-development-final/perspective-alpha27/first-failure.json',firstFailureSHA256:sha(failureBytes),sourceEncodedSHA256:sha(authored.bytes),actualGUIOutputSHA256:actualHash,authoredExpectedEncodedSHA256:sha(originalExpected.bytes),loadedExpectedEncodedSHA256:sha(loadedExpected.bytes),sourceWorkingRoundtrip:difference(authored.hdr!,canonical.hdr!),outputWorkingVsEncodedRoundtrip:difference(loadedExpected.hdr!,loadedDecoded),firstFailureComparison:difference(originalExpected.hdr!,loadedDecoded),explanation:'The actual GUI output bytes exactly equal core sampling from the saved/loaded canonical EXR source. EXR stores scene-linear FLOAT; encoded output decoded back into working extended-sRGB has a Float32 transfer roundtrip, so decoded output must be compared with decoded expected bytes, never with the pre-encoding in-memory working array. No tolerance or native threshold change.'}
writeFileSync('artifacts/alpha27-perspective/hdr-smoke-first-failure-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
