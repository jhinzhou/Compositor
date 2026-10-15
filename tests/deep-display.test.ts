import test from 'node:test'
import assert from 'node:assert/strict'
import {assetDisplayKey,assetRepresentationURL,type AssetRepresentationInfo} from '../src/shared/asset-representation'

function state(asset:AssetRepresentationInfo) { return {sessionId:'session-1',assets:[{width:2,height:1,...asset}]} }

test('source URLs keep the preserved PNG identity and representation default',()=>{
  const asset={file:'Layers/高位深 image.png',hash:'source-sha',bitDepth:16 as const,displayHash:'proxy-sha'}
  const url=new URL(assetRepresentationURL(state(asset),asset.file))
  assert.equal(decodeURIComponent(url.pathname.slice(1)),asset.file)
  assert.equal(url.searchParams.get('hash'),'source-sha')
  assert.equal(url.searchParams.has('representation'),false)
  assert.equal(url.searchParams.has('displayHash'),false)
})

test('deep display URLs explicitly request the proxy while preserving the source hash',()=>{
  const asset={file:'Layers/source.png',hash:'source-sha',bitDepth:16 as const,displayHash:'proxy-sha'}
  const url=new URL(assetRepresentationURL(state(asset),asset.file,'display'))
  assert.equal(url.searchParams.get('hash'),'source-sha')
  assert.equal(url.searchParams.get('representation'),'display')
  assert.equal(url.searchParams.get('displayHash'),'proxy-sha')
  assert.equal(asset.hash,'source-sha')
})

test('display identity invalidates cached image and mask data when either representation changes',()=>{
  const asset={file:'Layers/source.png',hash:'source-sha',bitDepth:16 as const,displayHash:'proxy-1'}
  assert.notEqual(assetDisplayKey(asset),assetDisplayKey({...asset,displayHash:'proxy-2'}))
  assert.notEqual(assetDisplayKey(asset),assetDisplayKey({...asset,hash:'source-2'}))
  assert.equal(assetDisplayKey(asset),assetDisplayKey({...asset}))
})

test('8-bit assets preserve existing cache identity and source URLs, with explicit renderer display request',()=>{
  const asset={file:'Layers/source.png',hash:'source-sha'}
  assert.equal(assetDisplayKey(asset),'source-sha')
  assert.equal(assetRepresentationURL(state(asset),asset.file),'compositor-asset://session-1/Layers%2Fsource.png?hash=source-sha')
  assert.equal(assetRepresentationURL(state(asset),asset.file,'display'),'compositor-asset://session-1/Layers%2Fsource.png?hash=source-sha&representation=display')
})

test('a deep asset without a display proxy fails instead of falling back to browser quantization',()=>{
  const asset={file:'Layers/source.png',hash:'source-sha',bitDepth:16 as const}
  assert.throws(()=>assetDisplayKey(asset),{code:'RENDER_FAILED'})
  assert.throws(()=>assetRepresentationURL(state(asset),asset.file,'display'),{code:'RENDER_FAILED'})
  assert.doesNotThrow(()=>assetRepresentationURL(state(asset),asset.file,'source'))
})

test('transient generated PNG8 previews remain inline, and missing persistent assets fail',()=>{
  const state={sessionId:'session-1',assets:[]}
  const inline='data:image/png;base64,generated-preview'
  assert.equal(assetRepresentationURL(state,inline,'display'),inline)
  assert.throws(()=>assetRepresentationURL(state,'Layers/missing.png','display'),{code:'ASSET_NOT_FOUND'})
})
