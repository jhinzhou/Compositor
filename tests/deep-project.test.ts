import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {deflateSync} from 'node:zlib'
import {makeAsset,loadProject,saveProject} from '../src/core/project-io'
import {decodeDeepPNG,encodeDeepPNG,assertDeepAssetBudget,countDeepAssetBytes,DEEP_ASSET_WORKING_BUDGET,pngChunkCRC} from '../src/core/deep-assets'
import {EditorError} from '../src/shared/contracts'
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected
const png16=(data:Uint16Array,width=data.length/4)=>PNG.sync.write({width,height:1,data} as unknown as PNG,{bitDepth:16,colorType:6,inputColorType:6,inputHasAlpha:true})
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function fixture(root:string,bytes:Buffer){const path=join(root,'source.comp'),id=randomUUID().toUpperCase(),file=`${id}.png`;await mkdir(join(path,'images'),{recursive:true});await writeFile(join(path,'images',file),bytes);const manifest={format:'com.compositor.project',version:12,colorSpace:'sRGB',documentID:randomUUID(),width:bytes.readUInt32BE(16),height:1,resolution:72,activeLayerID:id,layers:[{id,name:'Deep source',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',imageFile:file,transform:{origin:[0,0],size:[bytes.readUInt32BE(16),1],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]};await writeFile(join(path,'manifest.json'),JSON.stringify(manifest));return {path,id,file}}

test('PNG16 canonical encoded samples remain untouched even where premultiplication loses low-alpha precision',()=>{
 const straight=new Uint16Array([10001,20002,30003,65535,60006,50005,40004,32768,50005,30003,10001,1,60006,20002,10001,0]),bytes=png16(straight),asset=makeAsset('deep.png',bytes,{allow16:true})
 assert.deepEqual(asset.bytes,bytes);assert.notEqual(asset.bytes,bytes);assert.equal(asset.hash,hash(bytes));assert.deepEqual(PNG.sync.read(asset.bytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]).data,straight)
 assert.deepEqual(asset.deep,new Uint16Array([10001,20002,30003,65535,30003,25003,20002,32768,1,0,0,1,0,0,0,0]));assert.equal(asset.displayBytes![24],8);assert.equal(asset.displayHash,hash(asset.displayBytes!));assert.equal(asset.bitDepth,16)
 bytes.fill(0);assert.equal(asset.hash,hash(asset.bytes));assert.equal(asset.bytes[0],137)
})

test('new RGBA16 encoding is straight-alpha PNG16; opaque samples and premultiplied alpha round trip',()=>{
 const deep=new Uint16Array([10001,20002,30003,65535,10000,20000,30000,32768,0,0,0,0]),bytes=encodeDeepPNG(3,1,deep),decoded=decodeDeepPNG(bytes)
 assert.equal(bytes[24],16);assert.deepEqual(decoded.deep,deep);assert.deepEqual(PNG.sync.read(bytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]).data,new Uint16Array([10001,20002,30003,65535,20000,39999,59999,32768,0,0,0,0]))
 assert.throws(()=>encodeDeepPNG(1,1,new Uint16Array([2,0,0,1])),code('INVALID_ARGUMENT'))
})

test('PNG16 makeAsset requires explicit opt-in and validates full PNG CRC',()=>{
 const bytes=png16(new Uint16Array([12345,23456,34567,65535]));assert.throws(()=>makeAsset('deep.png',bytes),code('UNSUPPORTED_FEATURE'));const damaged=Buffer.from(bytes);damaged[damaged.length-1]^=1;assert.throws(()=>makeAsset('deep.png',damaged,{allow16:true}),code('INVALID_PROJECT'))
})

test('PNG16 preflights working byte budget before decoding declared dimensions',()=>{
 const bytes=png16(new Uint16Array([1,2,3,65535]));bytes.writeUInt32BE(4096,16);bytes.writeUInt32BE(4096,20)
 assert.ok(4096*4096*48>DEEP_ASSET_WORKING_BUDGET);assert.throws(()=>makeAsset('deep.png',bytes,{allow16:true}),code('RESOURCE_LIMIT'))
})

test('document byte budget includes canonical, high-depth and display backing buffers, de-duplicates immutable aliases',()=>{
 const asset={bytes:Buffer.alloc(20),deep:new Uint16Array(8),displayBytes:Buffer.alloc(10)};assert.equal(countDeepAssetBytes(asset),46)
 assert.doesNotThrow(()=>assertDeepAssetBudget([asset,asset],0,46));assert.throws(()=>assertDeepAssetBudget([asset],1,46),code('RESOURCE_LIMIT'));assert.throws(()=>assertDeepAssetBudget([asset,{bytes:Buffer.alloc(1)}],0,46),code('RESOURCE_LIMIT'))
})

test('saveProject emits native v12 and copies original encoded PNG16 byte for byte without source mutation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'deep-project-'));try{const bytes=png16(new Uint16Array([10001,20002,30003,65535,50005,30003,10001,1,60006,20002,10001,0])),input=await fixture(root,bytes),loaded=await loadProject(input.path),raw=await readFile(join(input.path,'manifest.json'))
 loaded.manifest.layers[0].name='Metadata only';loaded.manifest.layers[0].transform.origin=[10,-2]
 const saved=await saveProject(join(root,'copy.comp'),loaded.manifest,loaded.assets),reopened=await loadProject(saved)
 assert.equal(reopened.manifest.version,12);assert.equal(reopened.manifest.layers[0].name,'Metadata only');assert.deepEqual(reopened.manifest.layers[0].transform.origin,[10,-2]);assert.deepEqual(reopened.assets.get(input.file)!.bytes,bytes);assert.deepEqual(reopened.assets.get(input.file)!.deep,loaded.assets.get(input.file)!.deep);assert.deepEqual(await readFile(join(saved,'images',input.file)),bytes);assert.deepEqual(await readFile(join(input.path,'manifest.json')),raw)
 await assert.rejects(saveProject(saved,loaded.manifest,loaded.assets),code('DESTINATION_EXISTS'))
 }finally{await rm(root,{recursive:true,force:true})}
})

function withChunk(png:Buffer,name:string,data:Buffer):Buffer {const type=Buffer.from(name),chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);type.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE(pngChunkCRC(Buffer.concat([type,data])),chunk.length-4);return Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)])}
function srgbICC():Buffer {
 const xyz=[[.4360747,.2225045,.0139322],[.3850649,.7168786,.0971045],[.1430804,.0606169,.7141733]],names=['rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC'],tags=names.map((name,i)=>{const tag=Buffer.alloc(i<3?20:524);tag.write(i<3?'XYZ ':'curv');if(i<3)xyz[i].forEach((value,k)=>tag.writeInt32BE(Math.round(value*65536),8+k*4));else{tag.writeUInt32BE(256,8);for(let k=0;k<256;k++){const x=k/255,y=x<=.04045?x/12.92:((x+.055)/1.055)**2.4;tag.writeUInt16BE(Math.round(y*65535),12+k*2)}}return tag}),profile=Buffer.alloc(132+names.length*12+tags.reduce((n,tag)=>n+tag.length,0));profile.writeUInt32BE(profile.length);profile.write('RGB ',16);profile.write('XYZ ',20);profile.write('acsp',36);profile.writeUInt32BE(names.length,128);let offset=132+names.length*12;tags.forEach((tag,i)=>{const table=132+i*12;profile.write(names[i],table);profile.writeUInt32BE(offset,table+4);profile.writeUInt32BE(tag.length,table+8);tag.copy(profile,offset);offset+=tag.length});return profile
}
test('PNG16 accepts declared sRGB and verified sRGB matrix/TRC ICC; rejects contradictory gamma, chromaticities, HDR and damaged ancillary chunks',()=>{
 const base=png16(new Uint16Array([12345,23456,34567,65535])),gamma=Buffer.alloc(4);gamma.writeUInt32BE(45455)
 for(const bytes of [withChunk(base,'sRGB',Buffer.from([0])),withChunk(base,'gAMA',gamma),withChunk(base,'iCCP',Buffer.concat([Buffer.from('sRGB\0\0'),deflateSync(srgbICC())]))])assert.deepEqual(makeAsset('deep.png',bytes,{allow16:true}).bytes,bytes)
 const linear=Buffer.alloc(4);linear.writeUInt32BE(100000)
 for(const bytes of [withChunk(base,'gAMA',linear),withChunk(base,'cHRM',Buffer.alloc(32)),withChunk(base,'cICP',Buffer.from([9,16,0,1])),withChunk(base,'iCCP',Buffer.concat([Buffer.from('broken\0\0'),deflateSync(Buffer.alloc(132))]))])assert.throws(()=>makeAsset('deep.png',bytes,{allow16:true}),code('UNSUPPORTED_FEATURE'))
 const bad=withChunk(base,'tEXt',Buffer.from('key\0value'));bad[33+8]^=1;assert.throws(()=>makeAsset('deep.png',bad,{allow16:true}),code('INVALID_PROJECT'))
 const eight=PNG.sync.write({width:1,height:1,data:Buffer.from([1,2,3,255])} as PNG),legacy=makeAsset('eight.png',withChunk(eight,'gAMA',linear));assert.equal(legacy.bitDepth,undefined)
})
