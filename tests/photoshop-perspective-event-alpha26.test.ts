import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {makeAsset} from '../src/core/project-io'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import type {CropCorners} from '../src/shared/crop-projective'

test('native crop-event edge coordinates retain independent natural-frequency sampling baseline without inclusive-center conversion',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-sampling-alpha26-oldquad-diagnostic.json',import.meta.url),'utf8'))
 const decode=(entry:{rgbaZlib:string;sha256:string;width:number;height:number})=>{const bytes=inflateSync(Buffer.from(entry.rgbaZlib,'base64'));assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(bytes.length,entry.width*entry.height*4);return bytes}
 const source=decode(fixture.source),reference=fixture.cases[0],native=decode(reference),event=reference.nativeDescriptor
 assert.equal(reference.geometryVerified,true);assert.equal(event.event,'perspectiveCrop');assert.equal(event.width,reference.width);assert.equal(event.height,reference.height)
 const quad=event.descriptor.to.value,corners=[0,1,2,3].map(index=>{const point=quad[`quadCorner${index}`].value;assert.equal(point.horizontal.unit,'pixelsUnit');assert.equal(point.vertical.unit,'pixelsUnit');return [point.horizontal.value,point.vertical.value]}) as CropCorners
 assert.deepEqual(corners,reference.corners)
 const png=new PNG({width:fixture.source.width,height:fixture.source.height});png.data.set(source)
 const asset=makeAsset('native-event-source.png',PNG.sync.write(png)),before=Buffer.from(asset.bytes),result=perspectiveCropRaster(asset,{origin:[0,0],size:[png.width,png.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'},corners,reference.width,reference.height,'High quality'),actual=PNG.sync.read(result.bytes)
 let sum=0,max=0
 for(let i=0;i<native.length;i++){const delta=Math.abs(actual.data[i]-native[i]);if(i%4===3)assert.equal(delta,0);else{sum+=delta;max=Math.max(max,delta)}}
 // Regression limits preserve today's independently captured baseline. This
 // natural-frequency fixture alone does not close the separate dense-checker
 // or alpha-boundary differences described in the research report.
 assert.ok(sum/(actual.width*actual.height*3)<=.35);assert.ok(max<=30)
 assert.deepEqual(asset.bytes,before)
})
