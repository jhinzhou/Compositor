import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import {mapCropPoint,perspectiveCropMatrix,photoshopPerspectiveCropCorners,type CropCorners} from '../src/shared/crop-projective'
const close=(actual:number[],expected:number[])=>actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-8,`${actual} != ${expected}`))
test('Photoshop center-point input is explicitly converted to public edge coordinates',()=>{
 const raw:CropCorners=[[0,0],[3,0],[3,3],[0,3]]
 const converted=photoshopPerspectiveCropCorners(raw,4,4)
 converted.forEach((p,i)=>close(p,[[0,0],[4,0],[4,4],[0,4]][i]))
 assert.deepEqual(raw,[[0,0],[3,0],[3,3],[0,3]])
 const legacy=perspectiveCropMatrix(raw,4,4);close(mapCropPoint(legacy,.125,.125),[.375,.375])
})
test('all output centers follow endpoint-to-endpoint projective sampling, including single-pixel axes',()=>{
 const raw:CropCorners=[[90,30],[470,80],[410,290],[40,240]],center=perspectiveCropMatrix(raw.map(([x,y])=>[x+.5,y+.5]) as CropCorners,384,219)
 for(const [width,height]of [[384,219],[1,219],[384,1],[1,1],[83,51]]){
  const matrix=perspectiveCropMatrix(photoshopPerspectiveCropCorners(raw,width,height),width,height)
  for(const [x,y]of [[0,0],[width-1,height-1],[Math.floor(width/2),Math.floor(height/2)]])close(mapCropPoint(matrix,(x+.5)/width,(y+.5)/height),mapCropPoint(center,width===1?.5:x/(width-1),height===1?.5:y/(height-1)))
 }
})
test('interactive conversion retains invalid-geometry and allocation guards',()=>{
 assert.throws(()=>photoshopPerspectiveCropCorners([[0,0],[4,4],[4,0],[0,4]],4,4),/convex/)
 assert.throws(()=>photoshopPerspectiveCropCorners([[0,0],[4,0],[4,4],[0,4]],0,4),/canvas size/)
})
test('two independent actual Photoshop crops improve with UI convention while public edge mapping remains unchanged',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-alpha24.json',import.meta.url),'utf8'))
 const source=inflateSync(Buffer.from(fixture.source.rgbaZlib,'base64')),sha=(a:Uint8Array)=>createHash('sha256').update(a).digest('hex');assert.equal(sha(source),fixture.source.sha256)
 const png=new PNG({width:fixture.source.width,height:fixture.source.height});png.data.set(source);const asset=makeAsset('reference.png',PNG.sync.write(png)),transform={origin:[0,0] as [number,number],size:[png.width,png.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}
 for(const reference of fixture.cases){const native=inflateSync(Buffer.from(reference.rgbaZlib,'base64'));assert.equal(sha(native),reference.sha256)
  const measure=(corners:CropCorners)=>{const result=PNG.sync.read(perspectiveCropRaster(asset,transform,corners,reference.width,reference.height,'High quality').bytes);let sum=0;for(let i=0;i<native.length;i++)if(i%4!==3)sum+=Math.abs(native[i]-result.data[i]);return sum/(reference.width*reference.height*3)}
  const before=measure(reference.corners),after=measure(photoshopPerspectiveCropCorners(reference.corners,reference.width,reference.height));assert.ok(after<before*.5,`${reference.name}: ${before} -> ${after}`);assert.ok(after<reference.maximumRGBMAE,`${reference.name}: ${after}`)
 }
})
