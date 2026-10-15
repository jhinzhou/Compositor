import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {validateManifest} from '../src/core/manifest'
import {transformVectorFrameMetadata} from '../src/core/vector-frame-metadata'
import {mapVectorPath,type VectorPath} from '../src/shared/vector-path'
import type {Manifest} from '../src/shared/contracts'
function fixture(){
 const id=randomUUID().toUpperCase(),pathId='WORK_PATH',path:VectorPath={fillRule:'nonzero',subpaths:[{id:'open',closed:false,knots:[{id:'a',point:[4,3],outHandle:[8,4]},{id:'b',point:[12,9],inHandle:[10,7]}]}]}
 const manifest:Manifest={format:'com.compositor.project',version:11,colorSpace:'sRGB',documentID:randomUUID(),width:40,height:30,resolution:72,vectorPaths:[{id:pathId,name:'Curve',path}],layers:[{id,name:'Frame',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',maskFile:id+'.mask.png',maskLinked:false,maskEnabled:true,frame:{kind:'ellipse',bounds:[5,4,10,8]},transform:{origin:[5,4],size:[10,8],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 const other=randomUUID().toUpperCase();manifest.layers.push({id:other,name:'Vector Mask',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',maskFile:other+'.mask.png',maskLinked:false,vectorMask:{pathId,path:structuredClone(path)},transform:{origin:[0,0],size:[20,16],rotation:0,flipX:false,flipY:false,sampling:'High quality'}})
 return {manifest,path}
}
test('affine coordinate maps translate/control knots and synchronize path, vector-mask geometry and independent frame envelope',()=>{
 const {manifest,path}=fixture(),before=structuredClone(path);transformVectorFrameMetadata({manifest},([x,y])=>[x*2+3,y*.5+5])
 assert.deepEqual(manifest.vectorPaths![0].path.subpaths[0].knots[0],{id:'a',point:[11,6.5],outHandle:[19,7]});assert.deepEqual(manifest.layers[1].vectorMask!.path,manifest.vectorPaths![0].path);assert.deepEqual(manifest.layers[0].frame!.bounds,[13,7,20,4]);assert.deepEqual(path,before)
 const rotated=fixture().manifest;transformVectorFrameMetadata({manifest:rotated},([x,y])=>[30-y,x]);assert.deepEqual(rotated.layers[0].frame!.bounds,[18,5,8,10]);assert.deepEqual(rotated.vectorPaths![0].path.subpaths[0].knots[0].point,[27,4])
})
test('double flips preserve metadata; non-axis frame rotation and nonfinite control results reject without partial mutation',()=>{
 const s=fixture(),before=structuredClone(s.manifest);for(let i=0;i<2;i++)transformVectorFrameMetadata(s,([x,y])=>[40-x,30-y]);assert.deepEqual(s.manifest,before)
 assert.throws(()=>transformVectorFrameMetadata(s,([x,y])=>[(x-y)/Math.SQRT2,(x+y)/Math.SQRT2]),/rotated or sheared clip/);assert.deepEqual(s.manifest,before)
 assert.throws(()=>transformVectorFrameMetadata(s,([x,y])=>[NaN,y]));assert.deepEqual(s.manifest,before)
 const pathsOnly=fixture();pathsOnly.manifest.layers=[];transformVectorFrameMetadata(pathsOnly,([x,y])=>[(x-y)/Math.SQRT2,(x+y)/Math.SQRT2]);assert.equal(pathsOnly.manifest.vectorPaths![0].path.subpaths[0].knots.length,2)
})
test('manifest semantic validation requires persistent frame clip and vector mask fallback; old unrelated layers remain valid',()=>{
 const s=fixture();assert.ok(validateManifest(s.manifest).manifest.layers[0].frame)
 for(const change of [(m:Manifest)=>{m.layers[0].maskLinked=true},(m:Manifest)=>{m.layers[0].maskEnabled=false},(m:Manifest)=>{m.layers[0].maskDensity=.5},(m:Manifest)=>{delete m.layers[1].maskFile;delete m.layers[1].maskLinked}]){const next=structuredClone(s.manifest);change(next);assert.throws(()=>validateManifest(next))}
 const old=structuredClone(s.manifest);delete old.vectorPaths;old.layers=[];assert.equal(validateManifest(old).manifest.layers.length,0)
 assert.deepEqual(mapVectorPath(s.path,([x,y])=>[x+7,y-2]).subpaths[0].knots[0].outHandle,[15,2])
})
