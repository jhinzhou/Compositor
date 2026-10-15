import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {cropAxisSmootherGeometry,planCropAxisSmoother} from '../src/core/crop-axis-smoother'
import {applyPerspectiveCrop,perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import {EditorError,type Layer} from '../src/shared/contracts'
import type {CropCorners} from '../src/shared/crop-projective'
import type {PixelStage} from '../src/core/pixel-actions'
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
type RecordSource={width:number;height:number;sha256:string;rgbaZlib:string}
type NativeCase={name:string;sourceVariant:string;width:number;height:number;corners:CropCorners;accepted:boolean;declineReason:string|null;nativeRGBA_SHA256:string;nativeRGBAZlib:string;baselineRGBA_SHA256:string;baselineRGBAZlib?:string}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-axis-rea-alpha30.json',import.meta.url),'utf8')) as {frozenCandidateSHA256:string;counts:{accepted:number;declined:number};sources:Record<string,RecordSource>;cases:NativeCase[]}
function sourceRecord(record:RecordSource){const data=inflateSync(Buffer.from(record.rgbaZlib,'base64'));assert.equal(sha(data),record.sha256);return {width:record.width,height:record.height,data}}
const placement=(width:number,height:number):Layer['transform']=>({origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'})
const corners=(width:number,height:number):CropCorners=>[[0,0],[width,0],[width,height],[0,height]]
function assetFor(source:{width:number;height:number;data:Uint8Array}){const png=new PNG({width:source.width,height:source.height});png.data.set(source.data);return makeAsset('owned.png',PNG.sync.write(png))}
for(const reference of fixture.cases)test(`post-freeze Photoshop axis sample: ${reference.name} (${reference.accepted?'RGBA exact':'unchanged fallback'})`,()=>{
 const source=sourceRecord(fixture.sources[reference.sourceVariant]),before=Buffer.from(source.data),native=inflateSync(Buffer.from(reference.nativeRGBAZlib,'base64')),asset=assetFor(source),assetBefore=Buffer.from(asset.bytes)
 assert.equal(sha(native),reference.nativeRGBA_SHA256)
 const plan=planCropAxisSmoother(source,reference.width,reference.height)
 assert.equal(!!plan,reference.accepted)
 const output=PNG.sync.read(perspectiveCropRaster(asset,placement(source.width,source.height),reference.corners,reference.width,reference.height,'High quality').bytes)
 if(reference.accepted)assert.deepEqual(output.data,native)
 else{assert.ok(reference.baselineRGBAZlib);const previous=inflateSync(Buffer.from(reference.baselineRGBAZlib,'base64'));assert.equal(sha(previous),reference.baselineRGBA_SHA256);assert.deepEqual(output.data,previous)}
 assert.deepEqual(source.data,before);assert.deepEqual(asset.bytes,assetBefore)
})
test('the frozen fixture contains six independent exact gates and four explicit declines',()=>{
 assert.equal(fixture.frozenCandidateSHA256,'46241bed8604c76269682a06b35dd8e3eb9e1860c4fa99ebbba6eb0660a94e27')
 assert.equal(fixture.counts.accepted,6);assert.equal(fixture.counts.declined,4)
 assert.equal(fixture.cases.filter(c=>c.accepted).length,6)
})
test('internal hidden RGB cannot alter the proved constant-visible-color path or its immutable source',()=>{
 const source={width:8,height:8,data:Buffer.alloc(8*8*4)},other={width:8,height:8,data:Buffer.alloc(8*8*4)}
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){const hidden=x>=3&&x<5&&y>=3&&y<5,at=(y*8+x)*4;source.data.set(hidden?[0,0,0,0]:[20,90,170,128],at);other.data.set(hidden?[240,20,230,0]:[20,90,170,128],at)}
 const aBefore=Buffer.from(source.data),bBefore=Buffer.from(other.data),render=(s:typeof source)=>PNG.sync.read(perspectiveCropRaster(assetFor(s),placement(8,8),corners(8,8),12,14,'High quality').bytes).data
 assert.ok(planCropAxisSmoother(source,12,14));assert.deepEqual(render(source),render(other));assert.deepEqual(source.data,aBefore);assert.deepEqual(other.data,bBefore)
})
test('noninteger layer bounds, unknown colored transparency, odd centers and nonidentity placements decline before changing their old sampler',()=>{
 const source={width:8,height:8,data:Buffer.alloc(8*8*4)}
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)source.data.set(x>=3?[20,90,170,255]:[240,20,230,0],(y*8+x)*4)
 assert.equal(planCropAxisSmoother(source,12,12),null,'projected left4.5 is a native floating-bounds uncertainty')
 source.data.fill(255);source.data.set([12,34,56,0],(4*8+4)*4);source.data.set([10,20,30,255],(3*8+3)*4)
 assert.equal(planCropAxisSmoother(source,12,12),null,'internal A0 with nonconstant visible RGB')
 const full=corners(8,8),p=placement(8,8)
 for(const changed of [{...p,origin:[.5,0] as [number,number]},{...p,size:[9,8] as [number,number]},{...p,rotation:90},{...p,flipX:true},{...p,flipY:true}])assert.equal(cropAxisSmootherGeometry(source,changed,full,12,12),false)
 assert.equal(cropAxisSmootherGeometry({width:7,height:8},placement(7,8),corners(7,8),12,12),false)
 assert.equal(cropAxisSmootherGeometry(source,p,[[.125,0],[8.125,0],[8.125,8],[.125,8]],12,12),false)
 assert.equal(cropAxisSmootherGeometry(source,p,full,8,12),false)
})
test('the real separable path charges source scan, output initialization and both passes cumulatively without resetting the 120M budget',()=>{
 const png=new PNG({width:8,height:8});png.data.fill(255);const asset=makeAsset('work.png',PNG.sync.write(png)),work={samples:0},before=Buffer.from(asset.bytes)
 const once=8*8+12*12+6*(12*8+12*12)
 perspectiveCropRaster(asset,placement(8,8),corners(8,8),12,12,'High quality',false,0,work);assert.equal(work.samples,once)
 perspectiveCropRaster(asset,placement(8,8),corners(8,8),12,12,'High quality',false,0,work);assert.equal(work.samples,2*once)
 assert.throws(()=>perspectiveCropRaster(asset,placement(8,8),corners(8,8),12,12,'High quality',false,0,{samples:120_000_000-once+1}),(e:unknown)=>e instanceof EditorError&&e.code==='RESOURCE_LIMIT')
 assert.deepEqual(asset.bytes,before)
})
test('global crop memory includes separable scratch alongside retained unrelated assets before any document mutation',()=>{
 const png=new PNG({width:8,height:8});png.data.fill(255);const asset=makeAsset('pixels.png',PNG.sync.write(png)),outputBytes=12*12*20,decodedBytes=8*8*4,limit=512*1024*1024,retainedBytes=limit-asset.bytes.byteLength-outputBytes-decodedBytes-200
 const retained={...asset,file:'retained.png',width:1,height:1,bytes:{byteLength:retainedBytes} as Buffer},stage:PixelStage={manifest:{format:'com.compositor.project',version:11,colorSpace:'sRGB',documentID:'scratch-budget',width:8,height:8,resolution:72,layers:[{id:'LAYER',name:'Pixels',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:placement(8,8),imageFile:asset.file}],activeLayerID:'LAYER'},assets:new Map([[asset.file,asset],[retained.file,retained]]),selection:null},before=structuredClone(stage.manifest),assets=new Map(stage.assets)
 assert.ok(asset.bytes.byteLength+retainedBytes+outputBytes+decodedBytes<limit,'previous preflight alone is below its limit')
 assert.throws(()=>applyPerspectiveCrop(stage,{type:'document.perspective_crop',corners:corners(8,8),width:12,height:12,sampling:'High quality'}),(e:unknown)=>e instanceof EditorError&&e.code==='RESOURCE_LIMIT')
 assert.deepEqual(stage.manifest,before);assert.deepEqual(stage.assets,assets)
})
