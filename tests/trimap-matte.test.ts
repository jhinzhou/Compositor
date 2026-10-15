import test from 'node:test'
import assert from 'node:assert/strict'
import {refineTrimapMatte,TRIMAP_MATTE_MAX_PEAK_BYTES} from '../src/shared/trimap-matte'
import {trimapFixtures,trimapError} from '../scripts/fixtures/trimap-matte-fixtures'
import {EditorError} from '../src/shared/errors'
const fixtures=trimapFixtures()
test('constrained known-alpha fixtures recover fine strands, transparent edges, corners and equal-luminance colors',()=>{
 for(const fixture of fixtures.filter(item=>item.expected==='supported')){
  const before={image:fixture.guide.data.slice(),mask:fixture.mask.coverage.slice(),trimap:fixture.trimap.slice()},result=refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{sampleRadius:32}),error=trimapError(fixture,result.mask.coverage),baseline=trimapError(fixture,fixture.mask.coverage)
  assert.ok(error.alphaMAE<=.03,`${fixture.name} alpha MAE ${error.alphaMAE}`);assert.ok(error.alphaMAE<baseline.alphaMAE/2,`${fixture.name} must improve the coarse binary mask`);assert.equal(result.report.colorDomain,'encoded-sRGB');assert.equal(result.report.fallbackPixels,0)
  for(let i=0;i<fixture.trimap.length;i++)if(fixture.trimap[i]!==128)assert.equal(result.mask.coverage[i],fixture.trimap[i])
  assert.deepEqual(fixture.guide.data,before.image);assert.deepEqual(fixture.mask.coverage,before.mask);assert.deepEqual(fixture.trimap,before.trimap)
 }
})
test('low contrast and missing anchors preserve unknown coverage and explicitly report quality failure',()=>{
 for(const fixture of fixtures.filter(item=>item.name.startsWith('low-')||item.name.startsWith('missing-'))){
  const result=refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{sampleRadius:32});assert.equal(result.report.resolvedPixels,0);assert.equal(result.report.fallbackPixels,result.report.unknownPixels);assert.deepEqual(result.mask.coverage,fixture.mask.coverage);assert.ok(trimapError(fixture,result.mask.coverage).alphaMAE>.03)
  assert.ok(fixture.name.startsWith('low-')?result.report.lowContrastPixels>0:result.report.missingAnchorPixels>0)
 }
})
test('known foreground/background constraints override a contradictory prior but unknown fallback does not drift',()=>{
 const mask={width:3,height:1,coverage:new Uint8Array([19,240,77])},guide={width:3,height:1,data:new Uint8Array([100,100,100,255,100,100,100,255,100,100,100,255])},trimap=new Uint8Array([255,0,128]),result=refineTrimapMatte(mask,guide,trimap)
 assert.deepEqual(result.mask.coverage,new Uint8Array([255,0,77]));assert.deepEqual(mask.coverage,new Uint8Array([19,240,77]));assert.equal(result.report.lowContrastPixels,1)
})
test('spatially varying foreground violates the constant-color assumption and does not meet the alpha quality target',()=>{
 const fixture=fixtures.find(item=>item.name==='varying-foreground-color-unsupported')!,result=refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{sampleRadius:32})
 assert.ok(trimapError(fixture,result.mask.coverage).alphaMAE>.03);assert.ok(result.report.resolvedPixels>0)
})
test('a restricted region changes only constrained pixels inside it and handles local image boundaries',()=>{
 const fixture=fixtures[0],region={x:58,y:20,width:24,height:30},result=refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{region,sampleRadius:32})
 for(let y=0;y<fixture.mask.height;y++)for(let x=0;x<fixture.mask.width;x++)if(x<region.x||x>=region.x+region.width||y<region.y||y>=region.y+region.height)assert.equal(result.mask.coverage[y*fixture.mask.width+x],fixture.mask.coverage[y*fixture.mask.width+x])
 assert.ok(result.report.resolvedPixels>0);const full=refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{sampleRadius:32});for(let y=region.y;y<region.y+region.height;y++)for(let x=region.x;x<region.x+region.width;x++)assert.equal(result.mask.coverage[y*fixture.mask.width+x],full.mask.coverage[y*fixture.mask.width+x])
})
test('invalid NaN, shape, trimap values and regions fail atomically',()=>{
 const fixture=fixtures[0],before=fixture.mask.coverage.slice()
 for(const options of [{sampleRadius:NaN},{sampleRadius:0},{guidedRadius:Infinity},{guidedBlend:NaN},{minimumColorDistance:NaN},{region:{x:0,y:0,width:NaN,height:1}},{region:{x:127,y:0,width:2,height:1}}])assert.throws(()=>refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,options),(error:unknown)=>error instanceof EditorError&&error.code==='INVALID_ARGUMENT')
 const wrong=fixture.trimap.slice();wrong[50]=42;assert.throws(()=>refineTrimapMatte(fixture.mask,fixture.guide,wrong),/Trimap values/);assert.throws(()=>refineTrimapMatte(fixture.mask,{...fixture.guide,data:new Float32Array([NaN]) as unknown as Uint8Array},fixture.trimap),/byte-raster/);assert.deepEqual(fixture.mask.coverage,before)
})
test('working memory/operation and source dimensions reject before large allocations',()=>{
 const coverage=new Uint8Array(1),mask={width:4000,height:3000,coverage},guide={width:4000,height:3000,data:new Uint8Array(4)}
 // Correct lengths can be represented with read-only lookalikes but they are
 // deliberately rejected as non-byte input, so no source trust is assumed.
 assert.throws(()=>refineTrimapMatte(mask,guide,coverage),/byte-raster/)
 const width=2000,height=2000,count=width*height,source=new Uint8Array(count),image=new Uint8Array(count*4),before=source.slice();assert.throws(()=>refineTrimapMatte({width,height,coverage:source},{width,height,data:image},source),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.deepEqual(source,before)
 assert.throws(()=>refineTrimapMatte({width:8000,height:5000,coverage},{width:8000,height:5000,data:guide.data},coverage),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
})
test('cancellation before and during stages leaves every input untouched',()=>{
 const fixture=fixtures[0],before=fixture.mask.coverage.slice(),controller=new AbortController();controller.abort();assert.throws(()=>refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{signal:controller.signal}),(error:unknown)=>error instanceof EditorError&&error.code==='CANCELED')
 let checks=0;const signal={get aborted(){return ++checks>fixture.mask.height+8}} as AbortSignal;assert.throws(()=>refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{signal}),(error:unknown)=>error instanceof EditorError&&error.code==='CANCELED');assert.deepEqual(fixture.mask.coverage,before)
})
test('transparent guides are rejected before processing so hidden RGB cannot form false color anchors',()=>{
 const fixture=fixtures[0],image=fixture.guide.data.slice(),before=fixture.mask.coverage.slice();image[3]=0
 assert.throws(()=>refineTrimapMatte(fixture.mask,{...fixture.guide,data:image},fixture.trimap,{region:{x:60,y:30,width:10,height:10}}),(error:unknown)=>error instanceof EditorError&&error.code==='INVALID_ARGUMENT'&&error.message.includes('opaque RGB guide'))
 image[3]=254;assert.throws(()=>refineTrimapMatte(fixture.mask,{...fixture.guide,data:image},fixture.trimap),/opaque RGB guide/);assert.deepEqual(fixture.mask.coverage,before)
})
test('Buffer inputs return an independent coverage copy without changing source RGB or trimap',()=>{
 const coverage=Buffer.from([19,240,77]),image=Buffer.from([100,100,100,255,100,100,100,255,100,100,100,255]),trimap=Buffer.from([255,0,128]),before={coverage:Buffer.from(coverage),image:Buffer.from(image),trimap:Buffer.from(trimap)},result=refineTrimapMatte({width:3,height:1,coverage},{width:3,height:1,data:image},trimap)
 assert.deepEqual([...result.mask.coverage],[255,0,77]);assert.equal(Buffer.isBuffer(result.mask.coverage),false);assert.deepEqual(coverage,before.coverage);assert.deepEqual(image,before.image);assert.deepEqual(trimap,before.trimap)
 result.mask.coverage[0]=1;assert.equal(coverage[0],19)
})
test('cancellation after output processing never mutates a Buffer source view',()=>{
 const coverage=Buffer.from([19,240,77]),data=Buffer.from([100,100,100,255,100,100,100,255,100,100,100,255]),trimap=Buffer.from([255,0,128]),before=Buffer.from(coverage);let checks=0
 const signal={get aborted(){return ++checks===10}} as AbortSignal
 assert.throws(()=>refineTrimapMatte({width:3,height:1,coverage},{width:3,height:1,data},trimap,{guidedBlend:0,signal}),(error:unknown)=>error instanceof EditorError&&error.code==='CANCELED');assert.equal(checks,10);assert.deepEqual(coverage,before);assert.deepEqual(trimap,Buffer.from([255,0,128]))
})
test('a tiny ROI reports whole-source validation work and counts shared backing inputs only once',()=>{
 const width=128,height=96,count=width*height,backing=new ArrayBuffer(count*6+64),coverage=new Uint8Array(backing,0,count),data=new Uint8Array(backing,count,count*4),trimap=new Uint8Array(backing,count*5,count);data.fill(255);trimap.fill(128)
 const result=refineTrimapMatte({width,height,coverage},{width,height,data},trimap,{region:{x:0,y:0,width:1,height:1},sampleRadius:1,guidedRadius:1})
 assert.equal(result.report.estimatedInputBytes,backing.byteLength);assert.equal(result.report.estimatedPeakBytes,result.report.estimatedInputBytes+result.report.estimatedWorkingBytes);assert.ok(result.report.estimatedOperations>=2*count);assert.equal(result.report.unknownPixels,1);assert.deepEqual(coverage,new Uint8Array(count))
})
test('small input views retaining a huge shared backing are rejected atomically by total peak budget',()=>{
 // SharedArrayBuffer reserves the backing without touching hundreds of MiB;
 // only these six source bytes are initialized. This tests retained backing
 // size, rather than allocating a giant source image or relying on a mock.
 const backing=new SharedArrayBuffer(TRIMAP_MATTE_MAX_PEAK_BYTES),coverage=new Uint8Array(backing,0,1),data=new Uint8Array(backing,1,4),trimap=new Uint8Array(backing,5,1);coverage[0]=19;data.set([100,100,100,255]);trimap[0]=255
 assert.throws(()=>refineTrimapMatte({width:1,height:1,coverage},{width:1,height:1,data},trimap),(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT'&&(error.details as {estimatedInputBytes:number}).estimatedInputBytes===backing.byteLength);assert.equal(coverage[0],19);assert.deepEqual([...data],[100,100,100,255]);assert.equal(trimap[0],255)
})
