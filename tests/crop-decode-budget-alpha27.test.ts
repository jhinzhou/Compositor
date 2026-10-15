import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {applyPerspectiveCrop,perspectiveCropRaster,perspectiveCropDecodedSourceBytes} from '../src/core/crop-actions'
import {makeAsset,type Asset} from '../src/core/project-io'
import {countAssetBytes} from '../src/core/deep-assets'
import type {PixelStage} from '../src/core/pixel-actions'
import {EditorError,type Layer} from '../src/shared/contracts'
import {cropCorners} from '../src/shared/crop-projective'

const placement:Layer['transform']={origin:[0,0],size:[4,4],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}
const corners=cropCorners({x:0,y:0,width:4,height:4}),action={type:'document.perspective_crop' as const,corners,width:1,height:1,sampling:'Nearest' as const}
// These metadata-only assets deliberately contain no large raster allocation.
// A RESOURCE_LIMIT must win before the invalid encoded bytes can be decoded.
const virtual=(width:number,height:number):Asset=>({file:'virtual.png',width,height,bytes:Buffer.from('not PNG'),hash:'budget-only'})
const resource=(error:unknown)=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT'
function stageFor(asset:Asset):PixelStage{return {manifest:{format:'com.compositor.project',version:11,colorSpace:'sRGB',documentID:'budget-only',width:4,height:4,resolution:72,layers:[{id:'FIRST',name:'Retained',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:structuredClone(placement),imageFile:asset.file}],activeLayerID:'FIRST',namedSelections:[{name:'Retained',width:4,height:4,runs:[[0,0,2,255]]}]},assets:new Map([[asset.file,asset]]),selection:null}}

test('decoded RGB8 memory is dimension based; retained RGB16/HDR arrays are not counted twice, while their PNG mask path is counted',()=>{
 const rgb=virtual(14000,10000),deep={...rgb,deep:new Uint16Array(4)},hdr={...rgb,hdr:new Float32Array(4)}
 assert.equal(perspectiveCropDecodedSourceBytes(rgb),560_000_000)
 for(const asset of [deep,hdr]){assert.equal(perspectiveCropDecodedSourceBytes(asset),0);assert.equal(perspectiveCropDecodedSourceBytes(asset,true),560_000_000);assert.equal(countAssetBytes(asset),asset.bytes.byteLength+(asset.deep?.byteLength??0)+(asset.hdr?.byteLength??0))}
})
test('tiny nearest output cannot bypass an oversized RGB8 source decode; source and work remain intact before PNG parsing',()=>{
 const asset=virtual(14000,10000),before=asset.bytes.slice(),work={samples:19}
 assert.throws(()=>perspectiveCropRaster(asset,placement,corners,1,1,'Nearest',false,0,work),resource)
 assert.deepEqual(asset.bytes,before);assert.equal(work.samples,19)
})
test('global crop preflight includes source decode before changing named selections, layer geometry or asset map',()=>{
 const stage=stageFor(virtual(14000,10000)),before=structuredClone(stage.manifest),assets=new Map(stage.assets)
 assert.throws(()=>applyPerspectiveCrop(stage,action),resource)
 assert.deepEqual(stage.manifest,before);assert.deepEqual(stage.assets,assets);assert.equal(stage.selection,null)
 // A decode below 512 MiB still exceeds the global budget in combination with
 // a retained source. This byteLength-only stub exercises the sum without
 // allocating the declared 64 MiB buffer or reaching its decode path.
 const combined=stageFor(virtual(12000,10000)),retained={...virtual(1,1),file:'retained.png',bytes:{byteLength:64*1024*1024} as Buffer}
 combined.assets.set(retained.file,retained);const snapshot=structuredClone(combined.manifest)
 assert.throws(()=>applyPerspectiveCrop(combined,action),resource);assert.deepEqual(combined.manifest,snapshot);assert.equal(combined.assets.size,2)
})
test('serial layer placements share the peak decoded source estimate rather than summing repeated source surfaces',()=>{
 const png=new PNG({width:1,height:1});png.data.set([20,40,60,255])
 // A tiny real PNG plus synthetic dimensions exercises accounting only, with
 // no large native allocation. The two crop calls still perform real decoding.
 const asset={...makeAsset('small.png',PNG.sync.write(png)),width:12000,height:10000},stage=stageFor(asset),second={...structuredClone(stage.manifest.layers[0]),id:'SECOND'}
 stage.manifest.layers.push(second)
 assert.equal(perspectiveCropDecodedSourceBytes(asset)*2>512*1024*1024,true)
 assert.equal(applyPerspectiveCrop(stage,action),'Perspective Crop');assert.equal(stage.manifest.width,1);assert.equal(stage.manifest.height,1);assert.equal(stage.manifest.layers.length,2)
})
