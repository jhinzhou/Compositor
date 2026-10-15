import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {EdgeRefinementPreviews,edgeRefinementImages} from '../src/main/edge-refinement-preview'

test('superseded previews abort; stale cancellation and completion cannot cancel or publish the latest draft',()=>{
  const previews=new EdgeRefinementPreviews(),first=previews.begin('document',1),second=previews.begin('document',2)
  assert.equal(first.signal.aborted,true);assert.throws(()=>previews.assertCurrent('document',first),{code:'CANCELED'})
  assert.equal(previews.cancel('document',1),false);previews.finish('document',first);previews.assertCurrent('document',second)
  assert.equal(previews.cancel('document',2),true);assert.equal(second.signal.aborted,true)
  const third=previews.begin('document',3);previews.dispose();assert.equal(third.signal.aborted,true)
})
test('preview capacity rejects a ninth document without canceling the first eight',()=>{
  const previews=new EdgeRefinementPreviews(),controllers=Array.from({length:8},(_,i)=>previews.begin(String(i),1))
  assert.throws(()=>previews.begin('ninth',1),{code:'RESOURCE_LIMIT'})
  assert.ok(controllers.every(controller=>!controller.signal.aborted));previews.dispose()
})
test('preview PNG retains exact source RGB and gray constraints at native small dimensions without modifying inputs',()=>{
  const image={width:2,height:1,data:Uint8Array.from([100,30,10,255,30,80,200,255])},coverage={width:2,height:1,coverage:Uint8Array.from([128,255])},trimap=Uint8Array.from([128,255]),before=structuredClone({image,coverage,trimap})
  const result=edgeRefinementImages(image,coverage,trimap),decode=(url:string)=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64'))
  assert.deepEqual([...decode(result.sourceURL).data],[...image.data]);assert.deepEqual([...decode(result.coverageURL).data],[128,128,128,255,255,255,255,255])
  assert.deepEqual([...decode(result.trimapURL!).data],[128,128,128,255,255,255,255,255]);assert.deepEqual({image,coverage,trimap},before)
})
test('large thumbnails stay within 1024 while retaining full-resolution coordinate dimensions',()=>{
  const image={width:2048,height:2,data:new Uint8Array(2048*2*4)},coverage={width:2048,height:2,coverage:new Uint8Array(4096)}
  for(let i=0;i<4096;i++){image.data.set([i%256,0,0,255],i*4);coverage.coverage[i]=i%256}
  const result=edgeRefinementImages(image,coverage),png=PNG.sync.read(Buffer.from(result.coverageURL.split(',')[1],'base64'))
  assert.equal(result.width,2048);assert.equal(result.height,2);assert.equal(result.previewWidth,1024);assert.equal(result.previewHeight,1)
  assert.equal(png.data[0],1);assert.equal(png.data[(1023)*4],255)
})
test('inconsistent preview dimensions fail before creating a PNG',()=>{
  assert.throws(()=>edgeRefinementImages({width:2,height:1,data:new Uint8Array(8)},{width:1,height:1,coverage:new Uint8Array(1)}),{code:'INVALID_ARGUMENT'})
})
