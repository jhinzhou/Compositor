import test from 'node:test'
import assert from 'node:assert/strict'
import {backgroundErasePixels,magicErasePixels,colorEraseWorkingBytes,COLOR_ERASE_LIMITS,type ColorEraseImage,type ColorEraseContext,type BackgroundEraseParams,type MagicEraseParams} from '../src/core/color-erase'
import type {Selection} from '../src/shared/pixel-contracts'
import {EditorError} from '../src/shared/errors'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
const ctx=(w:number,h:number):ColorEraseContext=>({transform:{origin:[0,0],size:[w,h],rotation:0,flipX:false,flipY:false,sampling:'Nearest'},canvasSize:[w,h]})
function raster(w:number,h:number,color:(x:number,y:number)=>number[]):ColorEraseImage<Uint8Array>{const data=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(color(x,y),(y*w+x)*4);return {width:w,height:h,data}}
const magic=(point:[number,number],extra:Partial<MagicEraseParams>={}):MagicEraseParams=>({point,tolerance:0,contiguous:true,antialiased:false,opacity:1,...extra})
const bg=(points:[number,number][],extra:Partial<BackgroundEraseParams>={}):BackgroundEraseParams=>({points,size:3,hardness:1,opacity:1,tolerance:0,sampling:'once',limits:'discontiguous',protectForeground:false,foreground:[0,0,0,1],background:[1,1,1,1],brushModel:'compositor',...extra})
const code=(value:string)=>(e:unknown)=>e instanceof EditorError&&e.code===value
test('Magic Eraser has meaningful contiguous/discontiguous color regions and inclusive channel tolerance without mutating source',()=>{
 const image=raster(5,1,x=>[x===2?128:x===1?96:64,64,64,255]),before=image.data.slice()
 const local=magicErasePixels(image,ctx(5,1),magic([.5,.5],{tolerance:32}));assert.deepEqual([...local.data.filter((_v,i)=>i%4===3)],[0,0,255,255,255]);assert.equal(local.affectedPixels,2)
 const global=magicErasePixels(image,ctx(5,1),magic([.5,.5],{tolerance:32,contiguous:false}));assert.deepEqual([...global.data.filter((_v,i)=>i%4===3)],[0,0,255,0,0]);assert.deepEqual(image.data,before)
})
test('Magic opacity multiplies original alpha and selection once; straight RGB remains until alpha reaches zero',()=>{
 const image=raster(1,1,()=>[255,255,255,255]),selection:Selection={inverted:false,antialiased:false,shapes:[{kind:'raster',operation:'replace',bounds:[0,0,1,1],feather:0,raster:{width:1,height:1,transform:{origin:[0,0],size:[1,1],rotation:0,flipX:false,flipY:false},runs:[[0,0,1,128]]}}]}
 const result=magicErasePixels(image,{...ctx(1,1),selection},magic([.5,.5],{opacity:.5}));assert.deepEqual([...result.data],[255,255,255,191])
 const partial=raster(1,1,()=>[20,40,60,128]);assert.deepEqual([...magicErasePixels(partial,ctx(1,1),magic([.5,.5],{opacity:.5})).data],[20,40,60,64])
 const erased=magicErasePixels(partial,ctx(1,1),magic([.5,.5]));assert.deepEqual([...erased.data],[0,0,0,0]);assert.deepEqual([...partial.data],[20,40,60,128])
})
test('transparent clicks/zero opacity are exact no-ops and Node Buffer inputs are truly cloned',()=>{
 const bytes=Buffer.from([250,10,90,0,30,30,30,255]),image={width:2,height:1,data:bytes},before=Buffer.from(bytes)
 const hidden=magicErasePixels(image,ctx(2,1),magic([.5,.5],{contiguous:false,tolerance:255}));assert.equal(hidden.affectedPixels,0);assert.deepEqual([...hidden.data],[...before])
 assert.equal(magicErasePixels(image,ctx(2,1),magic([1.5,.5],{opacity:0})).affectedPixels,0)
 const result=magicErasePixels(image,ctx(2,1),magic([1.5,.5]));assert.deepEqual([...result.data],[250,10,90,0,0,0,0,0]);assert.deepEqual(bytes,before);assert.notEqual(result.data.buffer,bytes.buffer)
})
test('Background Once, Continuous and Background Swatch each select colors locally under shared continuous brush geometry',()=>{
 const image=raster(10,5,x=>x<5?[255,255,255,255]:[0,0,255,255]),points:[[number,number],[number,number]]=[[1.5,2.5],[8.5,2.5]],before=image.data.slice()
 const once=backgroundErasePixels(image,ctx(10,5),bg(points));assert.equal(once.data[(2*10+2)*4+3],0);assert.equal(once.data[(2*10+7)*4+3],255)
 const continuous=backgroundErasePixels(image,ctx(10,5),bg(points,{sampling:'continuous'}));assert.equal(continuous.data[(2*10+2)*4+3],0);assert.equal(continuous.data[(2*10+7)*4+3],0)
 const swatch=backgroundErasePixels(image,ctx(10,5),bg(points,{sampling:'background',background:[0,0,1,1]}));assert.equal(swatch.data[(2*10+2)*4+3],255);assert.equal(swatch.data[(2*10+7)*4+3],0);assert.deepEqual(image.data,before)
})
test('Background contiguous limits do not erase a separated same-color island; foreground protection has a real color decision',()=>{
 const separated=raster(10,3,x=>x===5?[0,0,0,255]:[255,255,255,255]),parameters=bg([[1.5,1.5]],{size:20,limits:'contiguous'}),local=backgroundErasePixels(separated,ctx(10,3),parameters)
 assert.equal(local.data[(1*10+2)*4+3],0);assert.equal(local.data[(1*10+7)*4+3],255);assert.equal(backgroundErasePixels(separated,ctx(10,3),{...parameters,limits:'discontiguous'}).data[(1*10+7)*4+3],0)
 const red=raster(7,5,x=>x===4?[255,0,0,255]:[255,255,255,255]),p=bg([[3.5,2.5]],{size:5,tolerance:255,protectForeground:true,foreground:[1,0,0,1]}),protectedResult=backgroundErasePixels(red,ctx(7,5),p)
 assert.equal(protectedResult.data[(2*7+3)*4+3],0);assert.equal(protectedResult.data[(2*7+4)*4+3],255);assert.equal(backgroundErasePixels(red,ctx(7,5),{...p,protectForeground:false}).data[(2*7+4)*4+3],0)
})
test('Background repeated pointer points do not apply opacity twice',()=>{
 const image=raster(5,5,()=>[255,255,255,200]),single=backgroundErasePixels(image,ctx(5,5),bg([[2.5,2.5]],{opacity:.5})),repeat=backgroundErasePixels(image,ctx(5,5),bg([[2.5,2.5],[2.5,2.5]],{opacity:.5}))
 assert.equal(single.data[(2*5+2)*4+3],100);assert.deepEqual(single.data,repeat.data)
})
test('Magic inward antialias performs fractional subpixel color coverage without bridging disconnected regions',()=>{
 const edge=raster(4,1,x=>x<2?[255,255,255,255]:[0,0,0,255]),hard=magicErasePixels(edge,ctx(4,1),magic([.5,.5],{tolerance:32})),aa=magicErasePixels(edge,ctx(4,1),magic([.5,.5],{tolerance:32,antialiased:true}))
 assert.equal(hard.data[7],0);assert.ok(aa.data[7]>0&&aa.data[7]<255);assert.equal(aa.data[11],255)
 const diagonal=raster(2,2,(x,y)=>x===y?[255,255,255,255]:[0,0,0,255]),connected=magicErasePixels(diagonal,ctx(2,2),magic([.5,.5],{antialiased:true}));assert.equal(connected.data[15],255)
})
test('merged document-grid sampling determines region while erasing only transformed target; returns coverage before opacity/selection',()=>{
 const target=raster(4,1,()=>[255,0,0,255]),merged=raster(4,1,x=>x<2?[0,0,255,255]:[0,255,0,255]),context={...ctx(4,1),transform:{...ctx(4,1).transform,flipX:true}},before=merged.data.slice()
 const result=magicErasePixels(target,context,magic([.5,.5],{sampleImage:merged}));assert.deepEqual([...result.data.filter((_v,i)=>i%4===3)],[255,255,0,0]);assert.deepEqual([...result.documentCoverage!.coverage],[1,1,0,0]);assert.deepEqual(merged.data,before)
 assert.throws(()=>magicErasePixels(target,context,magic([.5,.5],{sampleImage:raster(2,1,()=>[0,0,255,255])})),code('INVALID_ARGUMENT'))
})
test('RGB16 and HDR work directly on original premultiplied data without 8-bit projection or clipping negative/over-white samples',()=>{
 const deep={width:1,height:1,data:Uint16Array.from([1001,2003,3007,50001])},d=magicErasePixels(deep,ctx(1,1),magic([.5,.5],{opacity:.5}));assert.deepEqual([...d.data],[501,1002,1504,25001]);assert.deepEqual([...deep.data],[1001,2003,3007,50001]);assert.ok(d.data[0]%257!==0)
 const hdr={width:1,height:1,data:Float32Array.from([-.125,1.1875,.001953125,.5])},h=magicErasePixels(hdr,ctx(1,1),magic([.5,.5],{opacity:.5}));assert.deepEqual([...h.data],[-.0625,.59375,.0009765625,.25]);assert.ok(h.data[0]<0&&h.data[1]/h.data[3]>1&&h.data[2]<1/255);assert.deepEqual([...hdr.data],[-.125,1.1875,.001953125,.5])
})
test('cancellation/work limits leave original source unchanged, including cancellation after a partial internal erase',()=>{
 const image=raster(4,2,()=>[30,30,30,255]),before=image.data.slice(),abort=new AbortController();abort.abort()
 assert.throws(()=>magicErasePixels(image,ctx(4,2),magic([.5,.5]),{signal:abort.signal}),code('CANCELED'))
 let reads=0;const signal={get aborted(){return ++reads>22}} as AbortSignal
 assert.throws(()=>magicErasePixels(image,ctx(4,2),magic([.5,.5],{contiguous:false}),{signal}),code('CANCELED'));assert.ok(reads>22);assert.deepEqual(image.data,before)
 assert.throws(()=>magicErasePixels(image,ctx(4,2),magic([.5,.5]),{maximumWork:2}),code('RESOURCE_LIMIT'));assert.throws(()=>backgroundErasePixels(image,ctx(4,2),bg([[.5,.5]]),{maximumWork:2}),code('RESOURCE_LIMIT'));assert.deepEqual(image.data,before)
 assert.ok(colorEraseWorkingBytes(16_000_000,16_000_000,4,true)>COLOR_ERASE_LIMITS.workingBytes);assert.ok(colorEraseWorkingBytes(16_000_000,16_000_000,1)<COLOR_ERASE_LIMITS.workingBytes)
})
test('Find Edges and Background all-layers cannot silently masquerade as implemented; invalid inputs fail before writes',()=>{
 const image=raster(2,2,()=>[255,255,255,255]),before=image.data.slice()
 assert.throws(()=>backgroundErasePixels(image,ctx(2,2),bg([[.5,.5]],{limits:'find-edges'})),code('UNSUPPORTED_FEATURE'));assert.throws(()=>backgroundErasePixels(image,ctx(2,2),bg([[.5,.5]],{sampleAllLayers:true})),code('UNSUPPORTED_FEATURE'))
 for(const tolerance of [-1,NaN,256])assert.throws(()=>magicErasePixels(image,ctx(2,2),magic([.5,.5],{tolerance})),code('INVALID_ARGUMENT'))
 assert.throws(()=>magicErasePixels({...image,data:new Float64Array(16) as never},ctx(2,2),magic([.5,.5])),code('INVALID_ARGUMENT'));assert.deepEqual(image.data,before)
})
test('Background oversize geometry and preparation work fail atomically with the public resource error',()=>{
 const image=raster(2,2,()=>[255,255,255,255]),before=image.data.slice()
 assert.throws(()=>backgroundErasePixels(image,ctx(2,2),bg([[-1_000_000,-1_000_000],[1_000_000,1_000_000]],{size:1})),code('RESOURCE_LIMIT'))
 assert.throws(()=>backgroundErasePixels(image,ctx(2,2),bg([[.5,.5],[1,1],[1.5,.5]]),{maximumWork:3}),code('RESOURCE_LIMIT'))
 assert.deepEqual(image.data,before)
})
test('Magic source sampling and canvas clipping follow rotated placement instead of untransformed pixel coordinates',()=>{
 const image=raster(3,1,x=>x===0?[255,255,255,255]:[0,0,0,255]),context:ColorEraseContext={transform:{origin:[1,1],size:[3,1],rotation:90,flipX:false,flipY:false,sampling:'Nearest'},canvasSize:[4,4]},before=image.data.slice()
 // Source centers rotate to document (2.5,.5),(2.5,1.5),(2.5,2.5).
 const result=magicErasePixels(image,context,magic([2.5,.5]));assert.deepEqual([...result.data.filter((_v,i)=>i%4===3)],[0,255,255])
 const clipped=magicErasePixels(image,{...context,transform:{...context.transform,origin:[1,-1]}},magic([2.5,.5],{contiguous:false,tolerance:255}));assert.deepEqual([...clipped.data.filter((_v,i)=>i%4===3)],[255,255,0]);assert.deepEqual(image.data,before)
})
const native=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-color-erase-alpha28.json',import.meta.url),'utf8')) as {sources:Record<string,{width:number;height:number;rgbaZlib:string;rgbaSHA256:string}>;cases:{name:string;sourceVariant:string;params:MagicEraseParams;rgbaZlib:string;rgbaSHA256:string}[]}
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex')
for(const c of native.cases)test(`Photoshop 27.11 actual mouse ${c.name}: exact alpha/visible/premultiplied RGB with transparent hidden RGB excluded`,()=>{
 const frozen=native.sources[c.sourceVariant],data=inflateSync(Buffer.from(frozen.rgbaZlib,'base64')),reference=inflateSync(Buffer.from(c.rgbaZlib,'base64'))
 assert.equal(sha(data),frozen.rgbaSHA256);assert.equal(sha(reference),c.rgbaSHA256)
 const result=magicErasePixels({width:frozen.width,height:frozen.height,data},ctx(frozen.width,frozen.height),c.params)
 let hiddenRGBDifferences=0
 for(let i=0;i<reference.length;i+=4){assert.equal(result.data[i+3],reference[i+3],`alpha at pixel ${i/4}`);for(let channel=0;channel<3;channel++){assert.equal(result.data[i+channel]*result.data[i+3],reference[i+channel]*reference[i+3],`premultiplied channel ${channel} at pixel ${i/4}`);if(reference[i+3])assert.equal(result.data[i+channel],reference[i+channel]);else if(result.data[i+channel]!==reference[i+channel])hiddenRGBDifferences++}}
 assert.ok(hiddenRGBDifferences>0,'Native export keeps white hidden RGB, so this is deliberately not a complete straight RGBA byte assertion.')
 assert.equal(sha(data),frozen.rgbaSHA256,'original source must remain immutable')
})
