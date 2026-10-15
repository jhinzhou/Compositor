import test from 'node:test'
import assert from 'node:assert/strict'
import {DocumentManager} from '../src/core/document-manager'
import {Editor} from '../src/core/editor'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {EditorError} from '../src/shared/contracts'
import {assertDeepAssetBudget,countAssetBackingBytes} from '../src/core/deep-assets'
import type {Asset} from '../src/core/project-io'

function imported(hdr=false){
 const editor=new Editor(),asset=hdr
  ?makeHDRAsset('source.exr',2,1,Float32Array.from([2,-.1,.25,1,.1,.2,.3,.5]))
  :makeDeepAsset('source.png',2,1,Uint16Array.from([10001,20002,30003,65535,2,3,4,32768]))
 editor.importImageAsset(asset,'Transferred original')
 return {manifest:editor.snapshot().manifest,assets:[...editor.snapshot().assets]}
}

test('worker import counts transferred buffers and decoder scratch before changing workspace',()=>{
 const manager=new DocumentManager({pixelBudget:80}),input=imported(),before=manager.state(),bytes=Buffer.from(input.assets[0][1].bytes)
 assert.throws(()=>manager.importPhotoshopSnapshot(input,'Refused'),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
 assert.deepEqual(manager.state(),before);assert.deepEqual(input.assets[0][1].bytes,bytes)
 assert.equal(manager.workspace().documents.length,1)
})

test('worker import retains real16/HDR sources with independent display and no byte-depth fallback',()=>{
 for(const hdr of [false,true]){
  const manager=new DocumentManager(),input=imported(hdr),source=input.assets[0][1],state=manager.importPhotoshopSnapshot(input,'Transferred')
  const importedAsset=manager.get().snapshot().assets.get(source.file)!
  assert.equal(state.manifest.version,hdr?13:12);assert.deepEqual(importedAsset.bytes,source.bytes)
  assert.notEqual(importedAsset.bytes,source.bytes);assert.equal(importedAsset.bitDepth,16)
  if(hdr)assert.deepEqual(importedAsset.hdr,source.hdr);else assert.deepEqual(importedAsset.deep,source.deep)
  assert.equal(importedAsset.displayBytes![24],8)
 }
})

test('backing counter counts complete stores once across slices, repeated assets and clipboard aliases',()=>{
 const backing=new ArrayBuffer(4096),second=new ArrayBuffer(2048),asset={bytes:Buffer.from(backing,16,8),deep:new Uint16Array(backing,128,4),hdr:new Float32Array(backing,256,4),displayBytes:Buffer.from(second,64,16)},alias={bytes:Buffer.from(backing,300,2),displayBytes:Buffer.from(second,128,4)}
 assert.equal(countAssetBackingBytes([asset,asset,alias]),6144)
 assert.doesNotThrow(()=>assertDeepAssetBudget([asset,alias,asset],128,6272))
 assert.throws(()=>assertDeepAssetBudget([asset,alias],129,6272),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
 // A structured clone's separate backing is retained in the sending process,
 // so it is an additive context byte count rather than another source alias.
 assert.throws(()=>assertDeepAssetBudget([asset,alias],6144,10000),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
})

test('main clone and worker preview context rejects atomically before malformed canonical bytes can decode',()=>{
 const manager=new DocumentManager({pixelBudget:10000}),input=imported(),before=manager.state(),source=input.assets[0][1]
 const valid=Buffer.from(source.bytes);source.bytes=Buffer.from([1,2,3])
 // An exhausted external context has precedence over decoder failure. This
 // demonstrates pre-allocation rejection, not a post-import attach check.
 assert.throws(()=>manager.importPhotoshopSnapshot(input,'Refused',{retainedWorkingBytes:40000}),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
 assert.deepEqual(manager.state(),before);assert.deepEqual(source.bytes,Buffer.from([1,2,3]))
 source.bytes=valid;assert.equal(manager.importPhotoshopSnapshot(input,'Following normal import').manifest.version,12)
})

test('non-document clipboard buffers count against the same import budget with shared aliases deduplicated',()=>{
 const input=imported(),source=input.assets[0][1],extraBacking=new ArrayBuffer(128*1024),clipboard={...source,file:'clipboard.png',bytes:Buffer.from(extraBacking),deep:undefined,hdr:undefined,displayBytes:undefined} as Asset,manager=new DocumentManager({pixelBudget:20000}),before=manager.state()
 assert.throws(()=>manager.importPhotoshopSnapshot(input,'Refused',{retainedAssets:[clipboard,clipboard]}),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
 assert.deepEqual(manager.state(),before)
 // Existing incoming versions repeated in primary/external clipboard maps
 // share stores, and must remain permitted by the same affordable budget.
 const state=manager.importPhotoshopSnapshot(input,'Shared',{retainedAssets:[source,source]});assert.equal(state.manifest.version,12)
})

test('invalid retained contexts reject before workspace mutation or source decode',()=>{
 const manager=new DocumentManager(),input=imported(),before=manager.state()
 for(const retainedWorkingBytes of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>manager.importPhotoshopSnapshot(input,'Invalid',{retainedWorkingBytes}),error=>error instanceof EditorError&&error.code==='INVALID_ARGUMENT');assert.deepEqual(manager.state(),before)
 }
})
