import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {loadProject,fingerprintProject} from '../src/core/project-io'
import {EditorError} from '../src/shared/contracts'
const code=(value:string)=>(error:unknown)=>error instanceof EditorError&&error.code===value
/** Persisted native v12 layout derived from upstream ProjectLayerRecord/ProjectManifest, not external-app quality evidence. */
async function packageAt(root:string,{version=12,deep=false,deepMask=false,corrupt=false,foreignFormat=false}={}){
 const path=join(root,`${randomUUID()}.comp`),id=randomUUID().toUpperCase(),file=`${id}.png`,maskFile=`${id}.mask.png`;await mkdir(join(path,'images'),{recursive:true})
 const png=deep?PNG.sync.write({width:2,height:1,data:new Uint16Array([10001,20002,30003,65535,40004,50005,60006,65535])} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true}):encodeRaster(blankPNG(2,1,255)),mask=deepMask?PNG.sync.write({width:2,height:1,data:new Uint16Array([12345,65535])} as unknown as PNG,{bitDepth:16,colorType:0,inputColorType:0,inputHasAlpha:false}):encodeRaster(blankPNG(2,1,128),true)
 if(corrupt)png[png.length-1]^=1
 const manifest={format:foreignFormat?'wrong-format':'com.compositor.project',version,colorSpace:'sRGB',documentID:randomUUID().toUpperCase(),width:2,height:1,resolution:72,activeLayerID:id,layers:[{id,name:'Upstream v12 format',isVisible:true,transform:{origin:[0,0],size:[2,1],rotation:0,flipX:false,flipY:false,sampling:'High quality'},imageFile:file,isGroup:false,opacity:1,blendMode:'Normal',maskFile,maskEnabled:true,maskLinked:true}],guides:[{id:randomUUID().toUpperCase(),axis:'vertical',position:1}]}
 await writeFile(join(path,'manifest.json'),JSON.stringify(manifest));await writeFile(join(path,'images',file),png);await writeFile(join(path,'images',maskFile),mask)
 return {path,id,file,maskFile,png,mask,manifest,raw:await readFile(join(path,'manifest.json'))}
}
test('v12 all-8bit package opens without source mutation, saves v11 copy and preserves mask/image bytes and external conflict protection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-v12-'));try{const input=await packageAt(root),loaded=await loadProject(input.path);assert.equal(loaded.manifest.version,11);assert.match(loaded.warnings.join(' '),/Version 12.*only 8-bit.*version 11/);assert.deepEqual(loaded.assets.get(input.file)!.bytes,input.png);assert.deepEqual(loaded.assets.get(input.maskFile)!.bytes,input.mask);assert.deepEqual(await readFile(join(input.path,'manifest.json')),input.raw)
 const fingerprint=await fingerprintProject(input.path),editor=new Editor({journalDirectory:join(root,'journals')});await editor.open(input.path);assert.equal(editor.state().modified,false);assert.equal(editor.state().manifest.version,11);assert.equal(await fingerprintProject(input.path),fingerprint)
 const copy=join(root,'Saved.comp');await editor.saveCopy(copy);assert.equal(JSON.parse(await readFile(join(copy,'manifest.json'),'utf8')).version,11);const reopened=new Editor();await reopened.open(copy);assert.deepEqual(reopened.snapshot(),editor.snapshot());assert.deepEqual(await readFile(join(input.path,'manifest.json')),input.raw)
 await writeFile(join(input.path,'manifest.json'),JSON.stringify({...input.manifest,resolution:144}));editor.apply({...editor.identity(),action:{type:'layer.rename',layerId:input.id,name:'Local change'}});await assert.rejects(editor.save(),code('SAVE_CONFLICT'))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('v12 actual 16bit source loads as preserved high-depth image with a separate display proxy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-v12-16-'));try{const input=await packageAt(root,{deep:true}),loaded=await loadProject(input.path),asset=loaded.assets.get(input.file)!;assert.equal(input.png[24],16);assert.equal(loaded.manifest.version,12);assert.equal(asset.bitDepth,16);assert.equal(asset.pixelFormat,'rgba16-premultiplied-srgb');assert.deepEqual(asset.bytes,input.png);assert.deepEqual(asset.deep,new Uint16Array([10001,20002,30003,65535,40004,50005,60006,65535]));assert.equal(asset.displayBytes![24],8);assert.notEqual(asset.hash,asset.displayHash);assert.deepEqual(await readFile(join(input.path,'manifest.json')),input.raw);assert.deepEqual(await readFile(join(input.path,'images',input.file)),input.png)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('v12 is narrow compatibility: future versions, malformed PNG, wrong format and high-depth masks remain rejected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'project-v12-invalid-'));try{for(const config of [{version:14},{corrupt:true},{foreignFormat:true},{deepMask:true}]){const input=await packageAt(root,config);await assert.rejects(loadProject(input.path))}const legacy=await packageAt(root,{version:11,deep:true});await assert.rejects(loadProject(legacy.path),code('UNSUPPORTED_FEATURE'))}finally{await rm(root,{recursive:true,force:true})}
})
