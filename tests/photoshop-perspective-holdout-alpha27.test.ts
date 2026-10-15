import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import {photoshopPerspectiveCropSize} from '../src/shared/crop-projective'
const load=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/parity/'+name,import.meta.url),'utf8'))
const decode=(entry:any)=>{const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);return bytes}
function compare(fixture:any,reference:any){const source=decode(fixture.source),png=new PNG({width:fixture.source.width,height:fixture.source.height});png.data.set(source);const asset=makeAsset('holdout.png',PNG.sync.write(png)),placement={origin:[0,0] as [number,number],size:[png.width,png.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},actual=PNG.sync.read(perspectiveCropRaster(asset,placement,reference.corners,reference.width,reference.height,'High quality').bytes).data,native=decode(reference);let rgbSum=0,rgbMax=0,alphaSum=0,alphaMax=0;for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-native[i]);if(i%4===3){alphaSum+=delta;alphaMax=Math.max(alphaMax,delta)}else{rgbSum+=delta;rgbMax=Math.max(rgbMax,delta)}}return {source,actual,rgbMAE:rgbSum/(actual.length/4*3),rgbMax,alphaMAE:alphaSum/(actual.length/4),alphaMax}}
test('actual Photoshop mouse event is independent from AM replay: exact292163 size and explicitly partial RGB effect',()=>{
 const fixture=load('photoshop-27.11-perspective-gui-alpha27.json'),reference=fixture.cases[0];assert.equal(reference.referenceKind,'native-gui-event');assert.deepEqual(reference.corners,[[45,39],[337,51],[317,210],[55,202]]);assert.equal(reference.actualDescriptor.width,undefined);assert.equal(reference.actualDescriptor.height,undefined);assert.deepEqual(photoshopPerspectiveCropSize(reference.corners,384,256),{width:292,height:163});const result=compare(fixture,reference);assert.ok(result.rgbMAE<=5.485);assert.equal(result.rgbMax,80);assert.equal(result.alphaMax,0);assert.ok(result.rgbMAE>5,'Do not mislabel engineering regression guard as Photoshop pixel equivalence')
})
test('new projective alpha down holdouts retain previous output; frozen quadrature was rejected instead of tuning after holdout',()=>{
 const fixture=load('photoshop-27.11-perspective-projective-holdout-alpha27.json');assert.equal(fixture.cases.length,2);for(const reference of fixture.cases){const result=compare(fixture,reference);if(reference.width===180){assert.ok(result.rgbMAE<=31.546);assert.equal(result.rgbMax,181);assert.equal(result.alphaMax,0)}else{assert.ok(result.rgbMAE<=14.701);assert.equal(result.rgbMax,112);assert.equal(result.alphaMax,5)}
  const comparison=reference.sourceComparison;assert.equal(comparison.rgbaExact,false);assert.equal(comparison.hiddenRGBDifferences,2550);const canonical=result.source.slice();for(let i=0;i<canonical.length;i+=4)if(canonical[i+3]===0)canonical[i]=canonical[i+1]=canonical[i+2]=255;assert.equal(createHash('sha256').update(canonical).digest('hex'),comparison.nativeBeforeRGBA_SHA256,'Native source changes exactly correspond to alpha-zero RGB being filled white by Photoshop PNG export, not a visible or premultiplied change')
 }
})
test('independent alpha magnification preserves frozen path and documents remaining native RGB/alpha errors',()=>{
 const fixture=load('photoshop-27.11-perspective-alpha-up-holdout-alpha27.json'),reference=fixture.cases[0],result=compare(fixture,reference);assert.deepEqual([reference.width,reference.height],[500,320]);assert.ok(result.rgbMAE<=11.411);assert.equal(result.rgbMax,78);assert.equal(result.alphaMax,6);assert.ok(result.alphaMAE>0,'Retain the unresolved native edge-alpha evidence')
})
