import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {Editor} from '../src/core/editor'
import {makeHDRAsset,makeAssetEXR,fingerprintProject} from '../src/core/project-io'
import {encodeEXR,decodeEXR,inspectEXR} from '../src/core/hdr-codecs'
import {DeepPreviewService} from '../src/core/deep-preview'
import {replaceProject} from '../src/core/save-journal'
import {projectAssetByteBudget} from '../src/core/deep-assets'
import {encodeDeepExport} from '../src/core/deep-export'
import {encodeExport} from '../src/core/export-codecs'
import {inspectDeepComposite} from '../src/core/deep-composite'
import {applyPixelAction} from '../src/core/pixel-actions'
import {EditorError,type EditAction} from '../src/shared/contracts'
const apply=(editor:Editor,action:EditAction)=>editor.apply({...editor.identity(),action})
function fixture(){const editor=new Editor(),asset=makeHDRAsset('SOURCE.exr',2,1,new Float32Array([2.345,.12,.24,1,.3,.2,.1,.5]));editor.importImageAsset(asset,'Review source');return {editor,id:editor.state().manifest.activeLayerID!}}

test('HDR→16 plus SDR Overlay in one batch inspects only referenced source assets',()=>{
 const {editor,id}=fixture();apply(editor,{type:'adjustment.add',name:'Exposure',filter:{kind:'exposure',exposure:0,offset:0,gamma:1}})
 const before=editor.snapshot(),stage={...editor.snapshot(),selection:null},actions:EditAction[]=[{type:'layer.convert_depth',layerId:id,bitDepth:16},{type:'layer.set_blend',layerId:id,blendMode:'Overlay'}]
 for(const action of actions)applyPixelAction(stage,action)
 stage.manifest.layers.find(l=>l.id===id)!.blendMode='Overlay';stage.manifest.version=12
 assert.equal(inspectDeepComposite(stage.manifest,new Map([...stage.assets].filter(([file])=>stage.manifest.layers.some(layer=>layer.imageFile===file||layer.maskFile===file)))).supported,true)
 editor.applyBatch({...editor.identity(),actions})
 assert.equal(editor.state().manifest.version,12);assert.ok(editor.state().assets.every(asset=>!asset.isHDR));assert.equal(editor.state().manifest.layers.find(l=>l.id===id)!.blendMode,'Overlay')
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before)
})
test('PNG export keeps alpha independently of choosing 8 or 16 output bits under default options',async()=>{
 const {editor}=fixture(),options={format:'png' as const,width:2,height:1},deep=encodeDeepExport(editor.snapshot(),{...options,bitDepth:16}),eight=await encodeExport(deep.previewPNG,{...options,bitDepth:8}),deepData=PNG.sync.read(deep.data,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]).data,eightData=PNG.sync.read(eight.data).data
 assert.equal(deepData[7],32768);assert.equal(eightData[7],128)
})
test('FLOAT scene-linear storage measures actual encoded Float32 ULP drift instead of claiming bit identity',()=>{
 const width=4096,hdr=new Float32Array(width*4),scratch=new Float32Array(1),bits=new Uint32Array(scratch.buffer);let seed=0x73981
 const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return (seed>>>0)/4294967296}
 for(let p=0;p<hdr.length;p+=4){const alpha=[1,.25,1e-7,.0037][p/4%4];hdr[p+3]=alpha;for(let c=0;c<3;c++)hdr[p+c]=(random()<.2?-1:1)*10**(random()*5-3)*alpha}
 const original=hdr.slice(),encoded=encodeEXR(width,1,hdr,{pixelType:'float',compression:'zip'}),decoded=decodeEXR(encoded).hdr;let changed=0,maxAbsolute=0,maxULP=0
 for(let i=0;i<hdr.length;i++){assert.equal(decoded[i+3-i%4],hdr[i+3-i%4]);if(decoded[i]===hdr[i])continue;changed++;const delta=Math.abs(decoded[i]-hdr[i]);maxAbsolute=Math.max(maxAbsolute,delta);scratch[0]=Math.abs(hdr[i]);const value=scratch[0],current=bits[0];bits[0]=current+1;maxULP=Math.max(maxULP,delta/(scratch[0]-value))}
 assert.deepEqual(hdr,original);assert.ok(changed>0);assert.ok(maxULP<=2,{maxULP,maxAbsolute}.toString())
 const directory=join(process.cwd(),'test-results','hdr-codec');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'float-transfer-roundtrip.json'),JSON.stringify({pixels:width,samples:hdr.length,changedSamples:changed,maxAbsoluteDelta:maxAbsolute,maxFloat32ULP:maxULP,storage:'FLOAT+ZIP scene-linear RGBA',working:'premultiplied encoded extended sRGB'},null,2)+'\n')
})
test('deep export refuses combined composition/output/retained preview work before allocating large output',()=>{
 const {editor}=fixture(),snapshot=editor.snapshot(),before=editor.state();snapshot.manifest.width=4096;snapshot.manifest.height=2048;snapshot.manifest.layers[0].transform.size=[4096,2048]
 // Streaming composition uses less scratch than the former 96-byte/pixel
 // path. This output still exceeds the combined export budget without relying
 // on that obsolete estimate, and must fail before allocating its surface.
 assert.throws(()=>encodeDeepExport(snapshot,{format:'exr',width:4096,height:2048,background:null}),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT'&&Number((error.details as Record<string,unknown>|undefined)?.estimatedWorkingBytes)>512*1024*1024)
 assert.throws(()=>encodeDeepExport(editor.snapshot(),{format:'exr',width:2,height:1,background:null},{retainedWorkingBytes:512*1024*1024}),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
 assert.throws(()=>encodeDeepExport(editor.snapshot(),{format:'exr',width:2,height:1},{retainedWorkingBytes:NaN}),error=>error instanceof EditorError&&error.code==='INVALID_ARGUMENT');assert.deepEqual(editor.state(),before)
})
test('deep export includes retained assets from other documents in its workspace budget without clearing previews',()=>{
 const {editor}=fixture(),snapshot=editor.snapshot(),source=snapshot.assets.values().next().value!,service=new DeepPreviewService(),url=service.remember(editor.state(),source),retained=service.retainedWorkingBytes()
 // A virtual backing-store accounting fixture avoids allocating several GiB
 // merely to exercise the workspace preflight. The Buffer itself is real.
 const backing=new ArrayBuffer(1),bytes=Buffer.from(backing);Object.defineProperty(backing,'byteLength',{value:projectAssetByteBudget()})
 const other={...source,bytes},options={format:'exr',width:2,height:1,background:null}
 assert.throws(()=>encodeDeepExport(snapshot,options,{retainedAssets:[other],retainedWorkingBytes:retained}),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT')
 assert.equal(service.retainedWorkingBytes(),retained);assert.ok(encodeDeepExport(snapshot,options,{retainedAssets:[source,source],retainedWorkingBytes:retained}).data.length>0)
 const manifest=structuredClone(editor.state().manifest);manifest.layers[0].imageFile=url;assert.equal(service.render({sessionId:editor.state().sessionId,expectedRevision:editor.state().revision,manifest,width:2,height:1,region:{x:0,y:0,width:2,height:1}},editor.state(),snapshot).isHDR,true)
})
test('draft cache bounds real uncompressed EXR source plus Float32/display/URL storage and expires evicted drafts',()=>{
 const width=1024,height=1024,hdr=new Float32Array(width*height*4);for(let at=3;at<hdr.length;at+=4)hdr[at]=1
 const bytes=encodeEXR(width,height,hdr,{pixelType:'float',compression:'none'}),editor=new Editor(),first=makeAssetEXR('SOURCE.exr',bytes);editor.importImageAsset(first,'Cache source');const state=editor.state(),file=state.manifest.layers[0].imageFile!,service=new DeepPreviewService(),url=service.remember(state,{...first,file})
 const changed=Buffer.from(bytes),header=inspectEXR(changed),chunk=Number(changed.readBigUInt64LE(header.headerBytes));changed.writeFloatLE(.5,chunk+8+3*width*4);const second=makeAssetEXR(file,changed),secondURL=service.remember(state,second)
 assert.notEqual(url,secondURL);assert.ok(service.retainedWorkingBytes()<=64*1024*1024);assert.ok(service.retainedWorkingBytes()>first.hdr!.byteLength)
 const manifest=structuredClone(state.manifest);manifest.layers[0].imageFile=url
 assert.throws(()=>service.render({sessionId:state.sessionId,expectedRevision:state.revision,manifest,width:1,height:1,region:{x:0,y:0,width,height}},state,editor.snapshot()),error=>error instanceof EditorError&&error.code==='SNAPSHOT_EXPIRED')
})
test('orphan HDR assets do not alter PNG16 export or preview compositor selection',()=>{
 const {editor,id}=fixture(),original=editor.snapshot().assets.values().next().value!;apply(editor,{type:'layer.convert_depth',layerId:id,bitDepth:16});apply(editor,{type:'layer.set_blend',layerId:id,blendMode:'Overlay'});const state=editor.state(),snapshot=editor.snapshot();snapshot.assets.set(original.file,original)
 const service=new DeepPreviewService(),preview=service.render({sessionId:state.sessionId,expectedRevision:state.revision,manifest:state.manifest,width:2,height:1,region:{x:0,y:0,width:2,height:1}},state,snapshot);assert.equal(preview.isHDR,false);assert.equal(encodeDeepExport(snapshot,{format:'png',bitDepth:16,width:2,height:1}).isHDR,false)
 const cached=service.retainedWorkingBytes();assert.ok(cached>0);assert.throws(()=>encodeDeepExport(snapshot,{format:'png',bitDepth:16,width:2,height:1},{retainedWorkingBytes:512*1024*1024}),EditorError);assert.equal(service.retainedWorkingBytes(),cached)
})
test('live save journal threads retained asset baselines through each validated fingerprint phase',async()=>{
 const {editor,id}=fixture(),directory=await mkdtemp(join(tmpdir(),'hdr-save-baseline-'));try{
  await editor.saveAs(join(directory,'Source.comp'));const path=editor.state().projectPath!,expected=await fingerprintProject(path),source=editor.snapshot().assets.values().next().value!,before=await readFile(join(path,'images',source.file));apply(editor,{type:'layer.rename',layerId:id,name:'Metadata save'})
  let reads=0;const baseline={...source,get bytes(){reads++;return source.bytes}},snapshot=editor.snapshot(),observed:number[]=[]
  await replaceProject(path,snapshot.manifest,snapshot.assets,expected,join(directory,'journals'),async()=>{observed.push(reads)},undefined,[baseline]);assert.equal(observed.length,3);assert.ok(observed[0]>=2);assert.ok(observed[1]>observed[0]);assert.ok(reads>observed[2]);assert.deepEqual(await readFile(join(path,'images',source.file)),before)
  const saved=await fingerprintProject(path),refusal={...source,get bytes():Buffer{throw new EditorError('RESOURCE_LIMIT','Injected retained-budget refusal')}}
  await assert.rejects(replaceProject(path,snapshot.manifest,snapshot.assets,saved,join(directory,'journals'),undefined,undefined,[refusal]),error=>error instanceof EditorError&&error.code==='RESOURCE_LIMIT');assert.equal(await fingerprintProject(path),saved)
 }finally{await rm(directory,{recursive:true,force:true})}
})
