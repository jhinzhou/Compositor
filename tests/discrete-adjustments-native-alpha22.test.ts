import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {applyImageFilter,type ImageFilter} from '../src/shared/image-filters'
import {applyDeepColorFilter} from '../src/shared/deep-color-filters'
import {posterizeChannel,thresholdWhite} from '../src/shared/tonal-discretization'
type Raster={path:string;sha256:string;pngBase64:string;rawSHA256:string;width:number;height:number;bitDepth:8|16;rgbaZlibLE:string}
type Provenance={script:{path:string;sha256:string;sourceText:string};log:{path:string;sha256:string;text:string}}
type Fixture=Provenance&{source:Raster;rows:{name:string;spec:ImageFilter;inputDepth:8|16;native:Raster;changedFromInput:number}[]}
const fixture=JSON.parse(readFileSync('fixtures/parity/photoshop-27.11-discrete-adjustments-v2.json','utf8')) as Fixture
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
function samples(raster:Raster):Uint8Array|Uint16Array{const bytes=inflateSync(Buffer.from(raster.rgbaZlibLE,'base64'));assert.equal(sha(bytes),raster.rawSHA256);return raster.bitDepth===8?Uint8Array.from(bytes):Uint16Array.from({length:bytes.length/2},(_,i)=>bytes.readUInt16LE(i*2))}
test('Photoshop DOM adjustment evidence preserves source/script/log/output SHA and real changed pixels',()=>{
 assert.equal(sha(Buffer.from(fixture.script.sourceText)),fixture.script.sha256);assert.equal(sha(Buffer.from(fixture.log.text)),fixture.log.sha256)
 for(const item of [fixture.source,...fixture.rows.map(row=>row.native)])assert.equal(sha(Buffer.from(item.pngBase64,'base64')),item.sha256)
 for(const row of fixture.rows){assert.ok(row.changedFromInput>0);assert.equal(row.native.bitDepth,row.inputDepth)}
})
for(const row of fixture.rows)test(`Photoshop native opaque RGB controls exact match: ${row.name}`,()=>{
 const source=samples(fixture.source),actual=row.inputDepth===8?applyImageFilter({width:fixture.source.width,height:fixture.source.height,data:Uint8ClampedArray.from(source)},row.spec).data:applyDeepColorFilter(Uint16Array.from(source,value=>value*257),fixture.source.width,fixture.source.height,row.spec)
 assert.deepEqual([...actual],[...samples(row.native)])
})
type HoldoutRow={name:string;family:string;spec:ImageFilter;depth:8|16;native:Raster}
const holdout=JSON.parse(readFileSync('fixtures/parity/photoshop-27.11-discrete-adjustments-v3.json','utf8')) as Provenance&{inputs:Record<string,Raster>;controls:Record<string,Raster>;rows:HoldoutRow[]}
test('native holdout source/no-op/script/log/output hashes remain immutable',()=>{
 assert.equal(sha(Buffer.from(holdout.script.sourceText)),holdout.script.sha256);assert.equal(sha(Buffer.from(holdout.log.text)),holdout.log.sha256)
 for(const item of [...Object.values(holdout.inputs),...Object.values(holdout.controls),...holdout.rows.map(row=>row.native)])assert.equal(sha(Buffer.from(item.pngBase64,'base64')),item.sha256)
})
for(const row of holdout.rows)test(`native discrete kernel holdout, calibrated to PS source roundtrip: ${row.name}`,()=>{
 const noop=holdout.controls[`${row.family}-noop-${row.depth}`],input=samples(noop),expected=samples(row.native),actual=Array.from(input),max=row.depth===8?255:65535
 for(let at=0;at<input.length;at+=4){if(!input[at+3])continue;if(row.spec.kind==='threshold'){const white=thresholdWhite(input[at],input[at+1],input[at+2],max,row.spec.level,row.depth);actual.fill(white?max:0,at,at+3)}else if(row.spec.kind==='posterize')for(let c=0;c<3;c++)actual[at+c]=Math.round(posterizeChannel(input[at+c]/max,row.spec.levels,row.depth)*max);for(let c=0;c<4;c++)assert.equal(actual[at+c],expected[at+c],`pixel ${at/4}, channel ${c}`)}
})
test('premultiplied product source has exact opaque holdouts and one explicitly tracked alpha threshold boundary',()=>{
 for(const row of holdout.rows){if(row.depth!==16)continue;const noop=holdout.controls[`${row.family}-noop-16`],input=samples(noop),premul=Uint16Array.from(input,(v,i)=>i%4===3?v:Math.round(v*input[i-i%4+3]/65535)),copy=premul.slice(),actual=applyDeepColorFilter(premul,noop.width,noop.height,row.spec),native=samples(row.native);const mismatchedPixels:number[]=[]
  for(let at=0;at<input.length;at+=4){assert.equal(actual[at+3],input[at+3]);if(!input[at+3])continue;let different=false;for(let c=0;c<3;c++){const expected=Math.round(native[at+c]*native[at+3]/65535);if(input[at+3]===65535)assert.equal(actual[at+c],expected);if(actual[at+c]!==expected)different=true}if(different)mismatchedPixels.push(at/4)}
  if(row.spec.kind==='threshold')assert.deepEqual(mismatchedPixels,row.name==='alpha-threshold-128-16.png'?[535]:[])
  assert.deepEqual(premul,copy)
 }
})
