import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {PNG} from 'pngjs'
import {decodePhotoshop} from '../src/core/photoshop-io'
import {photoshopChannelFixture} from '../scripts/fixtures/photoshop-channel-fixtures'
import {DocumentManager} from '../src/core/document-manager'
import {PhotoshopController} from '../src/main/photoshop-controller'
import {EditorError} from '../src/shared/contracts'

const nativeRoot=new URL('../fixtures/photoshop-corpus/photoshop-27.11.0-rgb16/',import.meta.url)
const native=(name:string)=>readFileSync(new URL(name,nativeRoot))
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const code=(expected:string)=>(e:unknown)=>e instanceof EditorError&&e.code===expected
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b}
function resourceRange(bytes:Buffer){const offset=30+bytes.readUInt32BE(26),start=offset+4;return {offset,start,end:start+bytes.readUInt32BE(offset)}}
function resource(id:number,payload:Buffer){const header=Buffer.alloc(12);header.write('8BIM');header.writeUInt16BE(id,4);header.writeUInt32BE(payload.length,8);return Buffer.concat([header,payload,...(payload.length%2?[Buffer.alloc(1)]:[])])}
function resources(input:Buffer,records:Buffer[]){const range=resourceRange(input),body=Buffer.concat(records);return Buffer.concat([input.subarray(0,range.offset),u32(body.length),body,input.subarray(range.end)])}
function embedded(input:Buffer){const range=resourceRange(input);for(let at=range.start;at<range.end;){const id=input.readUInt16BE(at+4),name=input[at+6];at+=6+((name+2)&~1);const size=input.readUInt32BE(at);at+=4;if(id===1039)return Buffer.from(input.subarray(at,at+size));at+=size+(size%2)}throw new Error('Independent Photoshop fixture has no embedded ICC')}
const srgb=embedded(native('rgb8-layered.psd'))
function foreignProfile(){const profile=Buffer.from(srgb),count=profile.readUInt32BE(128);for(let i=0;i<count;i++){const entry=132+i*12;if(profile.toString('ascii',entry,entry+4)==='rXYZ'){const start=profile.readUInt32BE(entry+4);profile.writeInt32BE(profile.readInt32BE(start+8)+16384,start+8);return profile}}throw new Error('Native sRGB ICC has no matrix red tag')}
const pixels=(document:ReturnType<typeof decodePhotoshop>)=>[...document.assets.values()].map(a=>PNG.sync.read(a.bytes,{skipRescale:true}).data)

test('actual Photoshop RGB8 sRGB profile is validated without changing PNG8 source channels',()=>{
 const bytes=native('rgb8-layered.psd'),original=sha(bytes),document=decodePhotoshop(bytes),reference=PNG.sync.read(native('rgb8-identity.png'))
 const provenance=JSON.parse(native('provenance.json').toString()) as {records:{file:string;sha256:string}[]}
 assert.equal(original,provenance.records.find(item=>item.file==='rgb8-layered.psd')!.sha256)
 assert.match(document.warnings.join(' '),/8-bit Photoshop embedded ICC was verified as sRGB-equivalent/)
 for(const asset of document.assets.values()){assert.equal(asset.bitDepth,undefined);assert.deepEqual(PNG.sync.read(asset.bytes).data,reference.data)}
 assert.equal(sha(bytes),original)
})
for(const psb of [false,true])for(const depth of [8,16] as const){
 test(`RGB${depth} ${psb?'PSB':'PSD'} preserves source numbers with verified ICC or explicit no-profile assumption`,()=>{
  const plain=photoshopChannelFixture({depth,psb}),before=Buffer.from(plain),expected=pixels(decodePhotoshop(plain)),accepted=decodePhotoshop(resources(plain,[resource(1039,srgb)]))
  assert.match(decodePhotoshop(plain).warnings.join(' '),new RegExp(`${depth}-bit Photoshop document has no embedded ICC.*interpreted as sRGB`))
  assert.match(accepted.warnings.join(' '),new RegExp(`${depth}-bit Photoshop embedded ICC was verified as sRGB-equivalent`))
  assert.deepEqual(pixels(accepted),expected);assert.deepEqual(plain,before)
  const untagged=decodePhotoshop(resources(plain,[resource(1041,Buffer.from([1]))]));assert.deepEqual(pixels(untagged),expected);assert.match(untagged.warnings.join(' '),/no embedded ICC/)
 })
 test(`RGB${depth} ${psb?'PSB':'PSD'} rejects non-sRGB, unsupported profile and ignored embedded-profile flag`,()=>{
  const plain=photoshopChannelFixture({depth,psb})
  for(const records of [[resource(1039,foreignProfile())],[resource(1039,Buffer.alloc(150))],[resource(1039,srgb),resource(1041,Buffer.from([1]))]]){
   const bytes=resources(plain,records),before=Buffer.from(bytes)
   assert.throws(()=>decodePhotoshop(bytes),e=>e instanceof EditorError&&e.code==='UNSUPPORTED_FEATURE'&&(e.details as any).conversionPerformed===false&&(e.details as any).sourceBitDepth===depth&&e.message.includes(`separate copy to ${depth}-bit sRGB`))
   assert.deepEqual(bytes,before)
  }
 })
 for(const [name,records] of [
  ['short ICC',[resource(1039,Buffer.alloc(131))]],
  ['oversized ICC',[resource(1039,Buffer.alloc(1024*1024+1))]],
  ['duplicate ICC',[resource(1039,srgb),resource(1039,srgb)]],
  ['duplicate untagged flag',[resource(1041,Buffer.from([0])),resource(1041,Buffer.from([1]))]],
  ['malformed untagged flag',[resource(1041,Buffer.from([0,0]))]]
 ] as const)test(`RGB${depth} ${psb?'PSB':'PSD'} rejects ${name} before channel allocation`,()=>{
  const bytes=resources(photoshopChannelFixture({depth,psb}),[...records]),before=Buffer.from(bytes)
  assert.throws(()=>decodePhotoshop(bytes),code('INVALID_IMAGE'));assert.deepEqual(bytes,before)
 })
 test(`RGB${depth} ${psb?'PSB':'PSD'} bounds resource/payload/name lengths and excessive record counts`,()=>{
  const plain=photoshopChannelFixture({depth,psb}),base=resources(plain,[resource(1039,srgb)]),range=resourceRange(base),malformed:Buffer[]=[]
  const modeLength=Buffer.from(base);modeLength.writeUInt32BE(0xffffffff,26);malformed.push(modeLength)
  const blockLength=Buffer.from(base);blockLength.writeUInt32BE(0xffffffff,range.offset);malformed.push(blockLength)
  const payloadLength=Buffer.from(base);payloadLength.writeUInt32BE(0xffffffff,range.start+8);malformed.push(payloadLength)
  const nameLength=Buffer.from(base);nameLength[range.start+6]=255;malformed.push(nameLength)
  malformed.push(resources(plain,Array.from({length:16385},()=>resource(999,Buffer.alloc(0)))))
  for(const bytes of malformed){const before=Buffer.from(bytes);assert.throws(()=>decodePhotoshop(bytes),code('INVALID_IMAGE'));assert.deepEqual(bytes,before)}
 })
}

let directory:string,workerPath:string
before(async()=>{directory=await mkdtemp(join(tmpdir(),'compositor-icc-worker-'));workerPath=join(directory,'photoshop.cjs');await build({entryPoints:['src/core/photoshop.worker.ts'],outfile:workerPath,platform:'node',target:'node24',format:'cjs',bundle:true})})
after(async()=>{await rm(directory,{recursive:true,force:true})})
async function until(check:()=>boolean){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('ICC import worker timeout');await new Promise(resolve=>setTimeout(resolve,10))}}
test('real Photoshop import worker reports incompatible RGB8 ICC and cancel preserves all existing documents',async()=>{
 const manager=new DocumentManager();await manager.open('fixtures/demo.comp');const original=manager.state(),workspace=manager.workspace(),source=manager.get(original.sessionId).snapshot();let imports=0
 const controller=new PhotoshopController(workerPath,()=>{},async(snapshot,title)=>{imports++;return manager.importPhotoshopSnapshot(snapshot,title)}),bytes=resources(photoshopChannelFixture({depth:8}),[resource(1039,foreignProfile())]),before=Buffer.from(bytes),pending=controller.start(bytes,'Non-sRGB.psd')
 await until(()=>controller.snapshot().status==='error');assert.match(controller.snapshot().error!,/8-bit.*non-sRGB.*separate copy/);assert.equal(imports,0);assert.throws(()=>controller.confirm(controller.snapshot().id!),code('INVALID_ARGUMENT'))
 assert.deepEqual(manager.workspace(),workspace);assert.deepEqual(manager.state(),original);assert.deepEqual(manager.get(original.sessionId).snapshot(),source)
 controller.cancel(controller.snapshot().id);assert.equal(await pending,null);assert.deepEqual(manager.workspace(),workspace);assert.deepEqual(manager.state(),original);assert.deepEqual(bytes,before)
})
