import {performance} from 'node:perf_hooks'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeHDRAsset,makeAssetEXR} from '../src/core/project-io'
import {DeepPreviewService} from '../src/core/deep-preview'
import {compositeHDRDocument,inspectHDRComposite} from '../src/core/hdr-composite'
const output=process.argv[2]??'artifacts/hdr-real-source';await mkdir(output,{recursive:true})
const width=3840,height=2160,input=new Float32Array(width*height*4)
for(let i=0;i<input.length;i+=4)input.set([2.125,-.125,.8125,1],i)
const start=performance.now(),encoded=makeHDRAsset('SOURCE.exr',width,height,input),source=makeAssetEXR(encoded.file,encoded.bytes),sourceMs=performance.now()-start
const editor=new Editor();editor.importImageAsset(source,'Self-authored4K HDR')
const state=editor.state(),snapshot=editor.snapshot(),inspection=inspectHDRComposite(snapshot.manifest,snapshot.assets),compositionStart=performance.now(),image=compositeHDRDocument(snapshot.manifest,snapshot.assets),compositionMs=performance.now()-compositionStart
assert.deepEqual(image.data,source.hdr);assert.ok(image.data[0]>1);assert.ok(image.data[1]<0)
const service=new DeepPreviewService(),previewStart=performance.now(),preview=service.render({sessionId:state.sessionId,expectedRevision:state.revision,manifest:state.manifest,width:512,height:288,region:{x:0,y:0,width,height}},state,snapshot),previewMs=performance.now()-previewStart
assert.equal(preview.isHDR,true);assert.equal(editor.state().revision,state.revision);assert.deepEqual(editor.snapshot().assets.get(state.manifest.layers.find(layer=>layer.id===state.manifest.activeLayerID)!.imageFile!)!.bytes,source.bytes)
await writeFile(output+'/preview.png',PNG.sync.write({width:preview.width,height:preview.height,data:Buffer.from(preview.data)} as PNG))
await writeFile(output+'/results.json',JSON.stringify({status:'PASS',scope:'Real FLOAT ZIP EXR encode/decode, Editor immutable import and4K true-HDR compose to512×288 SDR proxy. Single run; no peak-memory or monitor-output claim.',width,height,node:process.version,sourceMs,compositionMs,previewMs,encodedBytes:source.bytes.byteLength,displayBytes:source.displayBytes?.byteLength,inspection,previewCacheBytes:service.retainedWorkingBytes(),memorySnapshot:process.memoryUsage()},null,2)+'\n')
console.log(JSON.stringify({status:'PASS',sourceMs,compositionMs,previewMs,estimatedMiB:inspection.estimatedWorkingBytes/1048576}))
