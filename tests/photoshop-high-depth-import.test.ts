import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {inflateSync,deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {readPsd,type Layer as PhotoshopLayer} from 'ag-psd'
import {decodePhotoshop,encodePhotoshop} from '../src/core/photoshop-io'
import {decodeOriginalPhotoshop16Pixels} from '../src/core/photoshop-channel-validation'
import {photoshopChannelFixture} from '../scripts/fixtures/photoshop-channel-fixtures'
import {Editor} from '../src/core/editor'
import {DocumentManager} from '../src/core/document-manager'
import {EditorError} from '../src/shared/contracts'

const fixtureRoot=new URL('../fixtures/photoshop-corpus/photoshop-27.11.0-rgb16/',import.meta.url)
const file=(name:string)=>readFileSync(new URL(name,fixtureRoot)),hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
const provenance=JSON.parse(file('provenance.json').toString()) as {records:{file:string;sha256:string}[];producer:string;source:{file:string;sha256:string};log:{file:string;sha256:string};supplement:{log:{file:string;sha256:string};execution:string}}
const png16=(bytes:Buffer)=>PNG.sync.read(bytes,{skipRescale:true}) as unknown as {width:number;height:number;depth:number;data:Uint16Array}
const pixelSource=(document:ReturnType<typeof decodePhotoshop>,index=0)=>document.assets.get(document.manifest.layers[index].imageFile!)!
const code=(expected:string)=>(error:unknown)=>error instanceof EditorError&&error.code===expected

test('actual Photoshop27.11 author outputs have recorded source rights, hashes and real header depth/compression',()=>{
 assert.equal(provenance.producer,'Adobe Photoshop27.11.0');assert.equal(hash(file(provenance.source.file)),provenance.source.sha256);assert.equal(hash(file(provenance.log.file)),provenance.log.sha256)
 assert.equal(hash(file(provenance.supplement.log.file)),provenance.supplement.log.sha256);assert.match(provenance.supplement.execution,/Manual UI save is the provenance for PSB/);assert.match(file(provenance.supplement.log.file).toString(),/LargeDocumentFormatSaveOptions/)
 for(const record of provenance.records)assert.equal(hash(file(record.file)),record.sha256,record.file)
 for(const name of ['rgb16-layered.psd','rgb16-layered-rle.psd']){
  const bytes=file(name);assert.equal(bytes.readUInt16BE(22),16)
  const psd=readPsd(bytes,{useRawData:true,skipCompositeImageData:true,skipThumbnail:true,skipLinkedFilesData:true});assert.equal(psd.children!.length,2)
  // The author's filename is not used as an oracle: these two actual files use ZIP prediction.
  for(const layer of psd.children!)assert.deepEqual(layer.rawData!.channels.map(c=>c.compression),[3,3,3,3])
 }
})

test('real Photoshop ZIP-predicted16 channel numbers equal its PNG16 reference without an extra32768-range scale',()=>{
 const reference=png16(file('rgb16-identity.png'));assert.equal(reference.depth,16);assert.ok(reference.data instanceof Uint16Array)
 assert.ok(reference.data.some(value=>value%257!==0));assert.equal(reference.data.reduce((m,v)=>Math.max(m,v),0),65535)
 for(const name of ['rgb16-layered.psd','rgb16-layered-rle.psd']){
  const bytes=file(name),before=hash(bytes),parsed=readPsd(bytes,{useRawData:true,skipCompositeImageData:true,skipThumbnail:true,skipLinkedFilesData:true})
  // Numeric oracle uses node:zlib + explicitly big-endian scalar prediction,
  // independently of ag-psd's pixel decoder and our product channel helper.
  for(const layer of parsed.children!)for(const channel of layer.rawData!.channels){
   const plane=inflateSync(channel.data!,{maxOutputLength:reference.width*reference.height*2});let previous=0;const component=channel.id===-1?3:channel.id
   for(let i=0;i<reference.width*reference.height;i++){if(i%reference.width===0)previous=0;previous=(previous+plane.readUInt16BE(i*2))&65535;assert.equal(previous,reference.data[i*4+component],`${name} channel${channel.id} sample${i}`)}
  }
  const imported=decodePhotoshop(bytes);assert.equal(hash(bytes),before);assert.equal(imported.manifest.version,12);assert.equal(imported.assets.size,2)
  for(const asset of imported.assets.values()){
   assert.equal(asset.bitDepth,16);assert.equal(asset.bytes[24],16);assert.equal(asset.displayBytes![24],8);assert.equal(asset.hash,hash(asset.bytes));assert.equal(asset.displayHash,hash(asset.displayBytes!));assert.deepEqual(png16(asset.bytes).data,reference.data)
   for(let i=0;i<reference.data.length;i++){const alpha=reference.data[i-i%4+3],expected=i%4===3?alpha:Math.round(reference.data[i]*alpha/65535);assert.equal(asset.deep![i],expected)}
  }
  assert.match(imported.warnings.join(' '),/ICC was verified as sRGB-equivalent/);assert.match(imported.warnings.join(' '),/masks remain 8-bit/);assert.match(imported.warnings.join(' '),/export remains 8-bit/)
 }
})

test('real Photoshop RGB8 remains ordinary assets and still uses the unchanged8-bit writer',()=>{
 const bytes=file('rgb8-layered.psd'),before=hash(bytes),imported=decodePhotoshop(bytes),reference=PNG.sync.read(file('rgb8-identity.png'))
 assert.equal(imported.manifest.version,11);for(const asset of imported.assets.values()){assert.equal(asset.bitDepth,undefined);assert.deepEqual(PNG.sync.read(asset.bytes).data,reference.data)}
 const encoded=encodePhotoshop(imported.manifest,imported.assets);assert.equal(encoded.readUInt16BE(22),8);assert.equal(decodePhotoshop(encoded).manifest.layers.length,2);assert.equal(hash(bytes),before)
})

test('real Photoshop manual Save As PSB retains full-range16 straight samples including transparent edges',()=>{
 const reference=png16(file('precision-rgb16-identity.png')),source=png16(file('precision-rgba16.png'))
 assert.equal(reference.depth,16);assert.equal(reference.width,65);assert.equal(reference.height,33)
 assert.ok(source.data.some(value=>value%257!==0));assert.ok(reference.data.some(value=>value%257!==0))
 assert.ok(reference.data.some((value,i)=>i%4===3&&value>0&&value<65535))
 for(const name of ['precision-rgb16-native.psb','precision-rgb16-layered.psd']){
  const bytes=file(name),before=hash(bytes),parsed=readPsd(bytes,{useRawData:true,skipCompositeImageData:true,skipThumbnail:true,skipLinkedFilesData:true})
  assert.equal(bytes.readUInt16BE(4),name.endsWith('.psb')?2:1);assert.equal(bytes.readUInt16BE(22),16)
  assert.equal(parsed.children!.length,name.endsWith('.psb')?1:2)
  for(const layer of parsed.children!)for(const channel of layer.rawData!.channels){
   assert.equal(channel.compression,3);const plane=inflateSync(channel.data!,{maxOutputLength:reference.width*reference.height*2}),component=channel.id===-1?3:channel.id;let previous=0
   for(let i=0;i<reference.width*reference.height;i++){if(i%reference.width===0)previous=0;previous=(previous+plane.readUInt16BE(i*2))&65535;assert.equal(previous,reference.data[i*4+component],`${name} channel ${channel.id} sample ${i}`)}
  }
  const imported=decodePhotoshop(bytes);assert.equal(imported.manifest.version,12)
  for(const asset of imported.assets.values()){
   assert.equal(asset.bitDepth,16);assert.deepEqual(png16(asset.bytes).data,reference.data)
   for(let i=0;i<reference.data.length;i++){const alpha=reference.data[i-i%4+3];assert.equal(asset.deep![i],i%4===3?alpha:Math.round(reference.data[i]*alpha/65535))}
  }
  assert.equal(hash(bytes),before)
 }
 // Photoshop's own open/save can round or clear hidden source values. Its
 // independently produced PNG16 is the author reference, not the input PNG.
 let changed=0,maxDifference=0;for(let i=0;i<source.data.length;i++){const difference=Math.abs(source.data[i]-reference.data[i]);if(difference)changed++;maxDifference=Math.max(maxDifference,difference)}
 assert.equal(changed,6530);assert.equal(maxDifference,2)
})

test('16-bit import hidden/low-alpha straight sources survive metadata Undo/Redo, Save Copy and project reopen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'compositor-psd16-'))
 try{
  const imported=decodePhotoshop(photoshopChannelFixture({width:3,height:2,mode:'rle'})),editor=new Editor({journalDirectory:join(root,'journals')});editor.importDocument(imported.manifest,imported.assets,'Source16',imported.warnings)
  const source=pixelSource(imported),original=pixelSource(imported).bytes,id=imported.manifest.layers[0].id,initial=editor.snapshot()
  assert.equal(png16(original).data[0],65535);assert.equal(png16(original).data[3],0);assert.equal(source.deep![0],0)
  editor.apply({...editor.identity(),action:{type:'layer.rename',layerId:id,name:'Metadata only'}});editor.history({...editor.identity(),direction:'undo',transactionId:editor.state().undoTransactionId});assert.deepEqual(editor.snapshot().manifest,initial.manifest);assert.equal(editor.snapshot().assets.get(source.file)!.deep,source.deep)
  editor.history({...editor.identity(),direction:'redo',transactionId:editor.state().redoTransactionId});await editor.saveAs(join(root,'source.comp'));await editor.saveCopy(join(root,'copy.comp'));await editor.save()
  for(const destination of ['source.comp','copy.comp']){const reopened=new Editor();await reopened.open(join(root,destination));const asset=reopened.snapshot().assets.get(source.file)!;assert.equal(reopened.state().manifest.version,12);assert.equal(asset.bitDepth,16);assert.deepEqual(asset.bytes,original);assert.deepEqual(asset.deep,source.deep);assert.equal(reopened.state().manifest.layers[0].name,'Metadata only');assert.equal((await readFile(join(root,destination,'images',source.file)))[24],16)}
  for(const asset of editor.state().assets){assert.equal('deep'in asset,false);assert.equal('bytes'in asset,false)}
  assert.throws(()=>encodePhotoshop(editor.snapshot().manifest,editor.snapshot().assets),code('UNSUPPORTED_FEATURE'))
  editor.apply({...editor.identity(),action:{type:'layer.convert_depth',layerId:id,bitDepth:8}});const exported=encodePhotoshop(editor.snapshot().manifest,editor.snapshot().assets);assert.equal(exported.readUInt16BE(22),8)
  editor.history({...editor.identity(),direction:'undo',transactionId:editor.state().undoTransactionId});assert.deepEqual(editor.snapshot().assets.get(source.file)!.bytes,original)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('actual Photoshop16 snapshot crosses manager import, keeps depth and is saved as v12',async()=>{
 const imported=decodePhotoshop(file('rgb16-layered.psd')),manager=new DocumentManager(),state=manager.importPhotoshopSnapshot({manifest:imported.manifest,assets:[...imported.assets],warnings:imported.warnings},'PS native16')
 assert.equal(state.manifest.version,12);assert.equal(state.assets.filter(a=>a.bitDepth===16).length,2)
 const editor=manager.get(state.sessionId),original=editor.snapshot();editor.apply({...editor.identity(),action:{type:'layer.set_opacity',layerId:state.manifest.layers[0].id,opacity:.25}});editor.history({...editor.identity(),direction:'undo',transactionId:editor.state().undoTransactionId})
 assert.deepEqual(editor.snapshot().manifest,original.manifest);for(const [name,asset]of original.assets)assert.equal(editor.snapshot().assets.get(name)!.deep,asset.deep)
 const root=await mkdtemp(join(tmpdir(),'compositor-psnative16-'));try{await editor.saveAs(join(root,'native.comp'));const reopened=new Editor();await reopened.open(join(root,'native.comp'));for(const [name,asset]of original.assets){assert.deepEqual(reopened.snapshot().assets.get(name)!.bytes,asset.bytes);assert.deepEqual(reopened.snapshot().assets.get(name)!.deep,asset.deep)}}finally{await rm(root,{recursive:true,force:true})}
})

function channelLayer(compression:number,payload:Buffer,width=2,height=2):PhotoshopLayer{return {name:'Independent channel',left:0,top:0,right:width,bottom:height,rawData:{colorMode:3,bitsPerChannel:16,large:false,channels:[{id:0,compression,data:payload}]}}}
test('scalar raw/ZIP/prediction16 rows retain non257 samples and reject oversized/truncated streams without mutation',()=>{
 const values=[1,511,12345,65535],raw=Buffer.alloc(8);values.forEach((v,i)=>raw.writeUInt16BE(v,i*2));const predicted=Buffer.alloc(8);values.forEach((v,i)=>predicted.writeUInt16BE((v-(i%2?values[i-1]:0)+65536)%65536,i*2))
 for(const [compression,bytes]of [[0,raw],[2,deflateSync(raw)],[3,deflateSync(predicted)]] as const){const before=Buffer.from(bytes),layer=channelLayer(compression,bytes),out=decodeOriginalPhotoshop16Pixels(layer)!;assert.deepEqual([...out.data].filter((_,i)=>i%4===0),values);assert.deepEqual(bytes,before);assert.equal(layer.rawData!.channels[0].data,bytes)}
 for(const bytes of [deflateSync(Buffer.alloc(9)),deflateSync(Buffer.alloc(7)),Buffer.from([1,2,3]),Buffer.concat([deflateSync(raw),Buffer.from([1,2])])])assert.throws(()=>decodeOriginalPhotoshop16Pixels(channelLayer(2,bytes)),code('INVALID_IMAGE'))
 assert.throws(()=>decodeOriginalPhotoshop16Pixels(channelLayer(2,deflateSync(raw),10000,10000)),code('RESOURCE_LIMIT'))
 const duplicate=channelLayer(0,raw);duplicate.rawData!.channels.push({...duplicate.rawData!.channels[0]});assert.throws(()=>decodeOriginalPhotoshop16Pixels(duplicate),code('INVALID_IMAGE'))
})

test('16-bit parser refuses truncated channel declarations before its permissive padded-allocation path',()=>{
 for(const psb of [false,true]){
  const bytes=photoshopChannelFixture({psb}),before=Buffer.from(bytes),lengthOffset=psb?76:64
  // An oversized declared channel is fully within the tiny record table, but
  // its claimed bytes do not exist in the file. No giant fixture is allocated.
  bytes.writeUInt32BE(90_000_000,lengthOffset);const malformed=Buffer.from(bytes)
  assert.throws(()=>decodePhotoshop(bytes),code('INVALID_IMAGE'));assert.deepEqual(bytes,malformed)
  assert.doesNotThrow(()=>decodePhotoshop(before))
 }
})

test('a sparse16-bit group mask budgets its full-document expansion before constructing that surface',()=>{
 const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b},i16=(n:number)=>{const b=Buffer.alloc(2);b.writeInt16BE(n);return b},u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b}
 // Independent Adobe-spec group with a one-pixel RGB16 mask patch. Its layer
 // bbox is tiny, but an enabled group mask fills the whole document surface.
 const box=Buffer.concat([u32(0),u32(0),u32(1),u32(1)]),mask=Buffer.concat([box,Buffer.from([255,0,0,0])]),extra=Buffer.concat([u32(mask.length),mask,u32(0),Buffer.from([1,71,0,0]),Buffer.from('8BIMlsct'),u32(4),u32(1)]),channel=Buffer.concat([u16(0),u16(32768)]),record=Buffer.concat([box,u16(1),i16(-2),u32(channel.length),Buffer.from('8BIMnorm'),Buffer.from([255,0,0,0]),u32(extra.length),extra]),info=Buffer.concat([i16(1),record,channel]),section=Buffer.concat([u32(info.length),info,...(info.length%2?[Buffer.alloc(1)]:[]),u32(0)])
 const bytes=Buffer.concat([Buffer.from('8BPS'),u16(1),Buffer.alloc(6),u16(3),u32(1024),u32(8192),u16(16),u16(3),u32(0),u32(0),u32(section.length),section,u16(0)]),before=Buffer.from(bytes)
 assert.throws(()=>decodePhotoshop(bytes),code('RESOURCE_LIMIT'));assert.deepEqual(bytes,before)
})

function matrixProfile(linear=false):Buffer{
 const xyz=[[.4360747,.2225045,.0139322],[.3850649,.7168786,.0971045],[.1430804,.0606169,.7141733]],tags: [string,Buffer][]=[]
 for(const [i,name]of ['rXYZ','gXYZ','bXYZ'].entries()){const bytes=Buffer.alloc(20);bytes.write('XYZ ');xyz[i].forEach((v,j)=>bytes.writeInt32BE(Math.round(v*65536),8+j*4));tags.push([name,bytes])}
 for(const name of ['rTRC','gTRC','bTRC']){const bytes=Buffer.alloc(12+512);bytes.write('curv');bytes.writeUInt32BE(256,8);for(let i=0;i<256;i++){const x=i/255,value=linear?x:x<=.04045?x/12.92:((x+.055)/1.055)**2.4;bytes.writeUInt16BE(Math.round(value*65535),12+i*2)}tags.push([name,bytes])}
 const header=Buffer.alloc(132+tags.length*12),body:Buffer[]=[];let at=header.length;header.write('RGB ',16);header.write('XYZ ',20);header.write('acsp',36);header.writeUInt32BE(tags.length,128)
 tags.forEach(([name,bytes],i)=>{header.write(name,132+i*12);header.writeUInt32BE(at,136+i*12);header.writeUInt32BE(bytes.length,140+i*12);body.push(bytes);at+=bytes.length});header.writeUInt32BE(at,0);return Buffer.concat([header,...body])
}
function withResource(input:Buffer,id:number,payload:Buffer):Buffer{const u16=(n:number)=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b},u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b};const resource=Buffer.concat([Buffer.from('8BIM'),u16(id),Buffer.alloc(2),u32(payload.length),payload,...(payload.length%2?[Buffer.alloc(1)]:[])]);return Buffer.concat([input.subarray(0,30),u32(resource.length),resource,input.subarray(34)])}
test('16-bit ICC resource accepts verified sRGB-equivalent numbers and explicitly rejects unsupported/bad profile',()=>{
 const plain=photoshopChannelFixture(),expected=png16(pixelSource(decodePhotoshop(plain)).bytes).data
 assert.match(decodePhotoshop(plain).warnings.join(' '),/no embedded ICC.*interpreted as sRGB/)
 const accepted=decodePhotoshop(withResource(plain,1039,matrixProfile()));assert.deepEqual(png16(pixelSource(accepted).bytes).data,expected);assert.match(accepted.warnings.join(' '),/ICC was verified as sRGB-equivalent/)
 assert.throws(()=>decodePhotoshop(withResource(plain,1039,matrixProfile(true))),code('UNSUPPORTED_FEATURE'));assert.throws(()=>decodePhotoshop(withResource(plain,1039,Buffer.alloc(150))),code('UNSUPPORTED_FEATURE'));assert.throws(()=>decodePhotoshop(withResource(plain,1039,Buffer.alloc(2))),code('INVALID_IMAGE'))
 // RGB8 now obeys the same no-silent-relabeling policy as source-preserving16.
 assert.throws(()=>decodePhotoshop(withResource(photoshopChannelFixture({depth:8}),1039,matrixProfile(true))),code('UNSUPPORTED_FEATURE'))
})
