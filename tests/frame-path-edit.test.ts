import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PNG} from 'pngjs'
import {applyFrameOperation} from '../src/core/frame-edit'
import {applyPathOperation,documentVectorPaths} from '../src/core/path-edit'
import {frameImagePlacement,validateFrame} from '../src/shared/frame'
import type {VectorPath} from '../src/shared/vector-path'
import type {Manifest,Layer} from '../src/shared/contracts'
import type {Selection} from '../src/shared/pixel-contracts'
import {makeAsset,makeDeepAsset,makeHDRAsset,saveProject,loadProject,type Asset} from '../src/core/project-io'
import {compositeDeepDocument} from '../src/core/deep-composite'
import {effectiveMaskPixels,sampleEffectiveMask} from '../src/shared/mask-properties'
function stage(depth:8|16|'hdr'=8){const id=randomUUID().toUpperCase(),width=20,height=16,file=id+(depth==='hdr'?'.exr':'.png'),layer:Layer={id,name:'Image',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'},imageFile:file};let asset:Asset
 if(depth===8){const png=new PNG({width,height});for(let i=0;i<width*height;i++)png.data.set([100+i%100,60,200,255],i*4);asset=makeAsset(file,PNG.sync.write(png))}
 else{const data=depth==='hdr'?new Float32Array(width*height*4):new Uint16Array(width*height*4);for(let i=0;i<width*height;i++)data.set(depth==='hdr'?[-.125,2.25,1.75,1]:[13001,24003,35007,65535],i*4);asset=depth==='hdr'?makeHDRAsset(file,width,height,data as Float32Array):makeDeepAsset(file,width,height,data as Uint16Array)}
 const manifest:Manifest={format:'com.compositor.project',version:depth==='hdr'?13:depth===16?12:11,colorSpace:'sRGB',documentID:randomUUID(),width:40,height:30,resolution:72,layers:[layer],activeLayerID:id}
 return {manifest,assets:new Map([[file,asset]]),selection:null as Selection|null,asset,id}
}
const path=():VectorPath=>({fillRule:'nonzero',subpaths:[{id:'outline',closed:true,knots:[{id:'p1',point:[4,3]},{id:'p2',point:[12,3]},{id:'p3',point:[12,9]},{id:'p4',point:[4,9]}]}]})
test('frame cover and contain retain the full source image and separate clip bounds from content placement',()=>{
 const frame=validateFrame({kind:'rectangle',bounds:[10,6,8,10]});assert.deepEqual(frameImagePlacement(frame,20,10),{origin:[4,6],size:[20,10],rotation:0,flipX:false,flipY:false,sampling:'High quality'})
 assert.deepEqual(frameImagePlacement(frame,20,10,'contain'),{origin:[10,9],size:[8,4],rotation:0,flipX:false,flipY:false,sampling:'High quality'})
 const s=stage(),created=applyFrameOperation(s,{type:'frame.create',name:'Frame',kind:'rectangle',bounds:[10,6,8,10]}),id=created.createdLayerId!,original=Buffer.from(s.asset.bytes)
 applyFrameOperation(s,{type:'frame.place',layerId:id,sourceId:s.id});const layer=s.manifest.layers.find(layer=>layer.id===id)!,mask=PNG.sync.read(s.assets.get(layer.maskFile!)!.bytes),effective=effectiveMaskPixels({...mask,data:new Uint8ClampedArray(mask.data)},layer)
 assert.equal(layer.maskLinked,false);assert.equal(sampleEffectiveMask(effective,layer.maskPlacement!,13,10),255);assert.equal(sampleEffectiveMask(effective,layer.maskPlacement!,30,10),0)
 const oldClip=structuredClone(layer.maskPlacement),oldAsset=s.assets.get(layer.imageFile!)!;applyFrameOperation(s,{type:'frame.set_content_transform',layerId:id,transform:{...layer.transform,origin:[-5,8]}})
 assert.deepEqual(layer.maskPlacement,oldClip);assert.equal(s.assets.get(layer.imageFile!),oldAsset);assert.deepEqual(s.asset.bytes,original)
 applyFrameOperation(s,{type:'frame.set_bounds',layerId:id,bounds:[12,7,10,12]});assert.deepEqual(layer.transform.origin,[-5,8]);assert.deepEqual((layer.frame as {bounds:number[]}).bounds,[12,7,10,12])
})
for(const depth of [8,16,'hdr'] as const)test(`${depth}: frame ellipse retains source precision and persistent mask geometry through save/reopen`,async()=>{
 const s=stage(depth),created=applyFrameOperation(s,{type:'frame.create',name:'Ellipse frame',kind:'ellipse',bounds:[5,4,10,8]}),id=created.createdLayerId!;applyFrameOperation(s,{type:'frame.place',layerId:id,sourceId:s.id})
 const layer=s.manifest.layers.find(layer=>layer.id===id)!,frameAsset=s.assets.get(layer.imageFile!)!;assert.equal(frameAsset.deep,s.asset.deep);assert.equal(frameAsset.hdr,s.asset.hdr);assert.equal(frameAsset.bytes,s.asset.bytes)
 const mask=PNG.sync.read(s.assets.get(layer.maskFile!)!.bytes);assert.equal(mask.data[0],0);assert.equal(mask.data[(4*10+5)*4],255)
 s.manifest.layers[0].isVisible=false;const dir=await mkdtemp(join(tmpdir(),'frame-'));try{const saved=await saveProject(join(dir,'frame.comp'),s.manifest,s.assets),loaded=await loadProject(saved);assert.deepEqual(loaded.manifest.layers[1].frame,layer.frame);assert.deepEqual(loaded.manifest.layers[1].maskPlacement,layer.maskPlacement);assert.equal(loaded.assets.get(layer.imageFile!)!.hash,frameAsset.hash)}finally{await rm(dir,{recursive:true,force:true})}
 if(depth===16){const out=compositeDeepDocument(s.manifest,s.assets);assert.equal(out.data[(8*40+10)*4+3],65535);assert.equal(out.data[(1*40+1)*4+3],0);assert.equal(out.data[(4*40+5)*4+3],0)}
})
test('frame rejects locked content, reduction of precision and excessive clip masks before changing layer/assets',()=>{
 const s=stage(),id=applyFrameOperation(s,{type:'frame.create',name:'Frame',kind:'rectangle',bounds:[1,1,5,5]}).createdLayerId!,layer=s.manifest.layers.find(layer=>layer.id===id)!;layer.positionLocked=true;const before=structuredClone(s.manifest),assets=[...s.assets]
 assert.throws(()=>applyFrameOperation(s,{type:'frame.place',layerId:id,sourceId:s.id}),/locked/);assert.deepEqual(s.manifest,before);assert.deepEqual([...s.assets],assets)
 assert.throws(()=>applyFrameOperation(s,{type:'frame.create',name:'Huge',kind:'ellipse',bounds:[0,0,20_000,10_000]}),/working budget/)
 const deep=stage(16),frameId=applyFrameOperation(deep,{type:'frame.create',name:'Deep',kind:'rectangle',bounds:[0,0,5,5]}).createdLayerId!;applyFrameOperation(deep,{type:'frame.place',layerId:frameId,sourceId:deep.id});const shallow=stage();deep.manifest.layers.push(shallow.manifest.layers[0]);deep.assets.set(shallow.asset.file,shallow.asset);assert.throws(()=>applyFrameOperation(deep,{type:'frame.place',layerId:frameId,sourceId:shallow.id}),/precision/)
})
test('stored cubic paths create actual selections/fills and live editable vector masks without losing original pixels',()=>{
 const s=stage(),result=applyPathOperation(s,{type:'document.path_set',name:'Outline',path:path()}),id=result.pathId!;applyPathOperation(s,{type:'selection.from_path',pathId:id,antialiased:false});assert.equal(s.selection!.shapes[0].raster!.runs.length,6)
 const selection=structuredClone(s.selection);applyPathOperation(s,{type:'layer.path_fill',layerId:s.id,pathId:id,color:[1,0,0,1]});assert.deepEqual(s.selection,selection)
 const image=PNG.sync.read(s.assets.get(s.manifest.layers[0].imageFile!)!.bytes);assert.deepEqual([...image.data.subarray((5*20+6)*4,(5*20+6)*4+4)],[255,0,0,255]);assert.deepEqual([...image.data.subarray(0,4)],[100,60,200,255])
 applyPathOperation(s,{type:'layer.path_mask',layerId:s.id,pathId:id});const layer=s.manifest.layers[0],before=s.assets.get(layer.maskFile!)!.hash,p=path();p.subpaths[0].knots[1].point=[16,3];p.subpaths[0].knots[2].point=[16,9]
 applyPathOperation(s,{type:'document.path_set',pathId:id,path:p});assert.notEqual(s.assets.get(layer.maskFile!)!.hash,before);assert.deepEqual((layer.vectorMask as {path:VectorPath}).path,p)
 assert.equal(documentVectorPaths(s.manifest)[0].id,id);assert.equal(s.asset.bytes.equals(s.assets.get(s.asset.file)!.bytes),false,'New fill is a new version; retained donor still exists separately')
 const pixels=PNG.sync.read(s.assets.get(layer.maskFile!)!.bytes);assert.equal(pixels.data[(5*40+14)*4],255);assert.equal(pixels.data[(5*40+18)*4],0)
})
test('vector path persistence and raster fallback survive .comp save/reopen; invalid path and locked linked mask refuse atomically',async()=>{
 const s=stage(),id=applyPathOperation(s,{type:'document.path_set',path:path()}).pathId!;applyPathOperation(s,{type:'layer.path_mask',layerId:s.id,pathId:id});const layer=s.manifest.layers[0];layer.locked=true;const before=structuredClone(s.manifest),versions=[...s.assets]
 assert.throws(()=>applyPathOperation(s,{type:'document.path_set',pathId:id,path:path()}),/locked/);assert.deepEqual(s.manifest,before);assert.deepEqual([...s.assets],versions)
 const dir=await mkdtemp(join(tmpdir(),'vector-path-'));try{const saved=await saveProject(join(dir,'path.comp'),s.manifest,s.assets),loaded=await loadProject(saved);assert.deepEqual(documentVectorPaths(loaded.manifest),documentVectorPaths(s.manifest));assert.deepEqual(loaded.manifest.layers[0].vectorMask,layer.vectorMask)}finally{await rm(dir,{recursive:true,force:true})}
 assert.throws(()=>applyPathOperation(s,{type:'document.path_set',path:{fillRule:'nonzero',subpaths:[{id:'invalid',closed:true,knots:[]}]}}));assert.deepEqual(s.manifest,before)
})
for(const depth of [16,'hdr'] as const)test(`${depth}: path fill uses current high-depth kernel and preserves untouched source precision`,()=>{
 const s=stage(depth),pathId=applyPathOperation(s,{type:'document.path_set',path:path()}).pathId!,old=s.asset.deep??s.asset.hdr!
 applyPathOperation(s,{type:'layer.path_fill',layerId:s.id,pathId,color:[1,0,0,1]});const asset=s.assets.get(s.manifest.layers[0].imageFile!)!,data=asset.deep??asset.hdr!,p=(5*20+6)*4
 assert.deepEqual([...data.subarray(p,p+4)],depth===16?[65535,0,0,65535]:[1,0,0,1]);assert.deepEqual([...data.subarray(0,4)],[...old.subarray(0,4)])
 assert.equal(s.asset.deep??s.asset.hdr,old)
})
