import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {makeAsset,makeAssetEXR,makeHDRAsset,loadProject,saveProject,projectFingerprint} from '../src/core/project-io'
import {assertDeepAssetBudget,countDeepAssetBytes,pngHash} from '../src/core/deep-assets'
import {encodeEXR,decodeEXR} from '../src/core/hdr-codecs'
import {prepareWideImport} from '../src/core/wide-import'
import {EditorError,type Manifest} from '../src/shared/contracts'
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
const source=()=>new Float32Array([2.345,.123,-.02,1,.55,.1,.3,.25,0,0,0,0,.003,.004,.002,.01])
const manifest=(file:string,version=13):Manifest=>{const id=file.split('.')[0];return {format:'com.compositor.project',version,colorSpace:'sRGB',documentID:randomUUID(),width:4,height:1,resolution:72,activeLayerID:id,layers:[{id,name:'Floating source',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[4,1],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}}
async function packageAt(root:string,bytes:Buffer,version=13){const file=`${randomUUID().toUpperCase()}.exr`,path=join(root,`${randomUUID()}.comp`),record=manifest(file,version);await mkdir(join(path,'images'),{recursive:true});await writeFile(join(path,'manifest.json'),JSON.stringify(record));await writeFile(join(path,'images',file),bytes);return {path,file,record}}

test('EXR asset retains independent source encoding and separates floating pixels from clipped SDR proxy',async()=>{
 const bytes=await readFile(new URL('../fixtures/hdr-codec/openexr-float-zip.exr',import.meta.url)),original=Buffer.from(bytes),asset=makeAssetEXR('source.exr',bytes)
 assert.deepEqual(asset.bytes,original);assert.notEqual(asset.bytes,bytes);assert.equal(asset.hash,pngHash(original));assert.equal(asset.bitDepth,16);assert.equal(asset.isHDR,true);assert.equal(asset.pixelFormat,'rgba32f-premultiplied-extended-srgb');assert.ok(asset.hdr!.some(v=>v>1));assert.equal(asset.deep,undefined)
 assert.equal(asset.displayHash,pngHash(asset.displayBytes!));assert.equal(asset.displayBytes![24],8);assert.equal(PNG.sync.read(asset.displayBytes!).width,asset.width);assert.notEqual(asset.hash,asset.displayHash);bytes.fill(0);assert.deepEqual(asset.bytes,original)
 assert.throws(()=>makeAsset('source.exr',original),code('UNSUPPORTED_FEATURE'));assert.deepEqual(makeAsset('source.exr',original,{allowHDR:true}).hdr,asset.hdr)
})
test('new HDR asset stores FLOAT+ZIP without HALF clipping and sub-white sources remain explicitly HDR',()=>{
 const pixels=source(),original=new Float32Array(pixels),asset=makeHDRAsset('new.exr',4,1,pixels),roundtrip=decodeEXR(asset.bytes)
 assert.equal(asset.hdr,pixels);assert.deepEqual(pixels,original);for(let i=0;i<pixels.length;i++)assert.ok(Math.abs(roundtrip.hdr[i]-pixels[i])<1e-6)
 const low=makeAssetEXR('low.exr',encodeEXR(1,1,new Float32Array([.1,.2,.3,1])));assert.equal(low.isHDR,true);assert.ok(low.hdr);assert.throws(()=>makeHDRAsset('bad.png',4,1,pixels),code('INVALID_ARGUMENT'))
})
test('v13 open and metadata-only save preserve original EXR byte-for-byte, hash, pixels and source manifest',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hdr-project-'));try{const bytes=await readFile(new URL('../fixtures/hdr-codec/openexr-half-zip.exr',import.meta.url)),input=await packageAt(root,bytes),loaded=await loadProject(input.path),raw=await readFile(join(input.path,'manifest.json')),fingerprint=projectFingerprint(loaded.manifest,loaded.assets)
 assert.equal(loaded.manifest.version,13);assert.match(loaded.warnings.join(' '),/Sub-white EXR/);loaded.manifest.layers[0].name='HDR metadata';loaded.manifest.layers[0].transform.origin=[-4,2]
 const saved=await saveProject(join(root,'saved'),loaded.manifest,loaded.assets),reopened=await loadProject(saved)
 assert.equal(reopened.manifest.version,13);assert.equal(reopened.manifest.layers[0].name,'HDR metadata');assert.deepEqual(reopened.assets.get(input.file)!.bytes,bytes);assert.deepEqual(reopened.assets.get(input.file)!.hdr,loaded.assets.get(input.file)!.hdr);assert.deepEqual(await readFile(join(saved,'images',input.file)),bytes);assert.deepEqual(await readFile(join(input.path,'manifest.json')),raw);assert.equal(projectFingerprint((await loadProject(input.path)).manifest,loaded.assets),fingerprint)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('v13 mixed EXR, PNG16 and gray masks save with each canonical format retained',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hdr-mixed-'));try{const id=randomUUID().toUpperCase(),file=`${id}.exr`,asset=makeHDRAsset(file,4,1,source()),record=manifest(file),pngId=randomUUID().toUpperCase(),pngFile=`${pngId}.png`,maskFile=`${id}.mask.png`,pngBytes=PNG.sync.write({width:4,height:1,data:new Uint16Array(Array.from({length:16},(_,i)=>i%4===3?65535:12345+i))} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6}),maskBytes=PNG.sync.write({width:4,height:1,data:Buffer.alloc(16,255)} as PNG,{colorType:0,inputColorType:6})
 record.layers[0].maskFile=maskFile;record.layers[0].maskLinked=true;record.layers.push({...record.layers[0],id:pngId,imageFile:pngFile,maskFile:undefined,maskLinked:undefined})
 const assets=new Map([[file,asset],[pngFile,makeAsset(pngFile,pngBytes,{allow16:true})],[maskFile,makeAsset(maskFile,maskBytes)]]),path=await saveProject(join(root,'mixed'),record,assets),loaded=await loadProject(path)
 assert.equal(loaded.manifest.version,13);assert.deepEqual(loaded.assets.get(file)!.bytes,asset.bytes);assert.deepEqual(loaded.assets.get(pngFile)!.bytes,pngBytes);assert.deepEqual(loaded.assets.get(maskFile)!.bytes,maskBytes);assert.equal(loaded.assets.get(maskFile)!.hdr,undefined)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('EXR requires v13 and image-only canonical naming; damaged and future packages are refused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hdr-invalid-'));try{const bytes=encodeEXR(4,1,source());for(const version of [11,12,14]){const input=await packageAt(root,bytes,version);await assert.rejects(loadProject(input.path))}
 const input=await packageAt(root,bytes);input.record.layers[0].maskFile=input.file;await writeFile(join(input.path,'manifest.json'),JSON.stringify(input.record));await assert.rejects(loadProject(input.path))
 const bad=Buffer.from(bytes);bad.writeUInt32LE(0,0);const damaged=await packageAt(root,bad);await assert.rejects(loadProject(damaged.path))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('HDR budgets count Float32 and proxy backing stores and deduplicate aliases',()=>{
 const asset={bytes:Buffer.alloc(20),hdr:new Float32Array(8),displayBytes:Buffer.alloc(10)};assert.equal(countDeepAssetBytes(asset),62);assert.doesNotThrow(()=>assertDeepAssetBudget([asset,asset],0,62));assert.throws(()=>assertDeepAssetBudget([asset],1,62),code('RESOURCE_LIMIT'))
})
test('standalone wide imports preserve EXR/PNG16, convert Radiance to EXR and leave ordinary images on existing route',()=>{
 const bytes=encodeEXR(4,1,source()),imported=prepareWideImport(bytes,'.exr','TARGET.png')!;assert.equal(imported.asset.file,'TARGET.exr');assert.deepEqual(imported.asset.bytes,bytes)
 const hdr=Buffer.concat([Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n'),Buffer.from([128,64,32,131])]),radiance=prepareWideImport(hdr,'example.hdr')!;assert.ok(radiance.asset.file.endsWith('.exr'));assert.ok(radiance.asset.hdr!.some(v=>v>1));assert.equal(radiance.asset.isHDR,true)
 const png=PNG.sync.write({width:1,height:1,data:new Uint16Array([12345,23456,34567,65535])} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6});assert.deepEqual(prepareWideImport(png,'source.png','TARGET.exr')!.asset.bytes,png);assert.equal(prepareWideImport(png,'source.png','TARGET.exr')!.asset.file,'TARGET.png')
 const ordinary=PNG.sync.write({width:1,height:1,data:Buffer.alloc(4,255)} as PNG);assert.equal(prepareWideImport(ordinary,'ordinary.png'),undefined);assert.equal(prepareWideImport(Buffer.from('ordinary'),'ordinary.jpg'),undefined);assert.throws(()=>prepareWideImport(Buffer.from('broken-exr'),'.exr'))
})
