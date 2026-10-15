import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {inspectRasterPSD} from '../scripts/psd-corpus/independent-raster-reader'
import {visibleMetrics} from '../scripts/psd-corpus/metrics'
import {checkCorpusRecord,type CorpusRecord} from '../scripts/psd-corpus/runner'

const directory=resolve('fixtures/photoshop-corpus/imageio')
const provenance=JSON.parse(await readFile(join(directory,'provenance.json'),'utf8')) as {records:CorpusRecord[]}
function specFixture(rle:boolean){
 const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b},i16=(n:number)=>{const b=Buffer.alloc(2);b.writeInt16BE(n);return b},u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b},i32=(n:number)=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b}
 const planes=[[20,40],[30,50],[60,70],[0,128]],ids=[0,1,2,-1],payloads=planes.map(plane=>Buffer.concat(rle?[u16(1),u16(3),Buffer.from([1,...plane])]:[u16(0),Buffer.from(plane)])),extra=Buffer.concat([u32(0),u32(0),Buffer.from([1,65,0,0])])
 const record=Buffer.concat([i32(0),i32(0),i32(1),i32(2),u16(4),...ids.flatMap((id,index)=>[i16(id),u32(payloads[index].length)]),Buffer.from('8BIMnorm'),Buffer.from([255,0,0,0]),u32(extra.length),extra]),info=Buffer.concat([i16(1),record,...payloads]),section=Buffer.concat([u32(info.length),info,Buffer.alloc(info.length%2),u32(0)])
 return Buffer.concat([Buffer.from('8BPS'),u16(1),Buffer.alloc(6),u16(3),u32(1),u32(2),u16(8),u16(3),u32(0),u32(0),u32(section.length),section,u16(0),Buffer.alloc(6)])
}
test('independent oracle accepts valid raw and PackBits rows with known straight RGB and alpha',()=>{
 for(const rle of [false,true]){const oracle=inspectRasterPSD(specFixture(rle));assert.deepEqual(oracle.layers[0].errors,[]);assert.deepEqual([...oracle.layers[0].pixels],[20,30,60,0,40,50,70,128])}
})
test('independent ImageIO files and synthetic sources have explicit rights and verified hashes',async()=>{
 assert.equal(provenance.records.length,4)
 for(const record of provenance.records){assert.match(record.license,/Original synthetic/);assert.equal(record.origin,'independent-application');for(const key of ['source','file','reference'] as const){const bytes=await readFile(join(directory,record[key]));assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256[key])}}
})
test('strict independent PackBits oracle distinguishes malformed layers from available composite previews',async()=>{
 for(const record of provenance.records){const oracle=inspectRasterPSD(await readFile(join(directory,record.file)));assert.equal(oracle.layers.length,1);assert.equal(oracle.width,8);assert.equal(oracle.height,6);assert.equal(oracle.layers.every(layer=>!layer.errors.length),record.layerValidation.valid);assert.deepEqual(oracle.layers.flatMap(layer=>layer.errors),record.layerValidation.errors);assert.ok(PNG.sync.read(await readFile(join(directory,record.reference))).data.length)}
})
test('strict PSD oracle rejects truncated input instead of inventing missing channel bytes',async()=>{
 const input=await readFile(join(directory,provenance.records[0].file))
 assert.throws(()=>inspectRasterPSD(input.subarray(0,80)),/file size|invalid layer section/)
})
test('visible comparison ignores hidden RGB but includes coverage and alpha errors',()=>{
 const a=new PNG({width:2,height:1}),b=new PNG({width:2,height:1});a.data.set([255,0,0,0,200,100,50,128]);b.data.set([0,255,255,0,200,100,50,128]);assert.equal(visibleMetrics(PNG.sync.write(a),PNG.sync.write(b)).maxPremultipliedRGBError,0);b.data[7]=64;const result=visibleMetrics(PNG.sync.write(a),PNG.sync.write(b));assert.equal(result.maxAlphaError,64);assert.ok(result.maxPremultipliedRGBError>49)
})
test('independent corpus rejects malformed source without pretending later roundtrip phases passed',async()=>{
 const output=await mkdtemp(join(tmpdir(),'compositor-corpus-'))
 try{const report=await checkCorpusRecord(provenance.records[2],directory,output);assert.equal(report.sourceIntegrity,'pass');assert.equal(report.independentLayerValidity.status,'malformed');assert.equal(report.projectRead.status,'rejected-malformed');assert.equal(report.projectRead.acceptedMalformedWithoutWarning,false);assert.equal(report.sourceReferenceRender.status,'not-run-malformed-source');assert.equal(report.unmodifiedRoundtrip.status,'not-run-rejected-input');assert.equal(report.modifiedRecompute.status,'not-run-rejected-input');assert.equal(report.photoshopVisualAcceptance,'not-run');assert.equal(report.independentModifiedOutput.status,'not-run-rejected-input')}
 finally{await rm(output,{recursive:true,force:true})}
})
