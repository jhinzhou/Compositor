import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from '../src/core/project-io'
import {applyHistoryBrushOperation,captureHistoryBrushSource,HistoryBrushSourceStore,type HistoryBrushSource,type HistoryBrushStroke} from '../src/core/history-brush'
import {restoreHistoryBrushPixels} from '../src/shared/history-brush'
import type {Layer,Manifest} from '../src/shared/contracts'
import type {Selection} from '../src/shared/pixel-contracts'
const id=randomUUID().toUpperCase(),session='history-test-session'
function fixture(depth:8|16|'hdr'=8){
 const width=10,height=8,file=id+(depth==='hdr'?'.exr':'.png'),layer:Layer={id,name:'Source',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}
 let asset:Asset,modified:Asset
 if(depth===8){const png=new PNG({width,height}),changed=new PNG({width,height});for(let i=0;i<width*height;i++){png.data.set([30+i%200,50+i%100,160-i,255],i*4);changed.data.set([220,10,30,255],i*4)}asset=makeAsset(file,PNG.sync.write(png));modified=makeAsset(file,PNG.sync.write(changed))}
 else{const values=depth==='hdr'?new Float32Array(width*height*4):new Uint16Array(width*height*4),next=depth==='hdr'?new Float32Array(values.length):new Uint16Array(values.length);for(let i=0;i<width*height;i++){values.set(depth==='hdr'?[-1.125-i/64,2.25+i/128,3.875,.75]:[1001+i*73,3007+i*37,12011-i*29,40009],i*4);next.set(depth==='hdr'?[.125,-.375,1.25,1]:[50001,10003,1001,65535],i*4)}asset=depth==='hdr'?makeHDRAsset(file,width,height,values as Float32Array):makeDeepAsset(file,width,height,values as Uint16Array);modified=depth==='hdr'?makeHDRAsset(file,width,height,next as Float32Array):makeDeepAsset(file,width,height,next as Uint16Array)}
 const manifest:Manifest={format:'com.compositor.project',version:depth==='hdr'?13:depth===16?12:11,colorSpace:'sRGB',documentID:randomUUID(),width,height,resolution:72,layers:[layer],activeLayerID:id},source=captureHistoryBrushSource({manifest,assets:new Map([[file,asset]])},{sessionId:session,revision:0,label:'Before filter'})
 const stage={manifest:structuredClone(manifest),assets:new Map([[file,modified]]),selection:null as Selection|null},action:HistoryBrushStroke={layerId:id,kind:'history',points:[[5,4]],size:40,hardness:1,opacity:1}
 return {asset,modified,source,stage,action}
}
const data=(asset:Asset)=>asset.hdr??asset.deep??PNG.sync.read(asset.bytes).data
for(const depth of [8,16,'hdr'] as const){
 test(`${depth}: whole covered raster restores the exact retained working source, including low bits/HDR, without touching source buffers`,()=>{
  const {asset,modified,source,stage,action}=fixture(depth),before=Buffer.from(asset.bytes),pixels=Array.from(data(asset)),current=Array.from(data(modified))
  applyHistoryBrushOperation(stage,action,source,session)
  assert.deepEqual(Array.from(data(stage.assets.get(stage.manifest.layers[0].imageFile!)!)),pixels)
  assert.deepEqual(asset.bytes,before);assert.deepEqual(Array.from(data(modified)),current)
  if(depth===16)assert.ok(pixels[0]%257!==0);if(depth==='hdr')assert.ok(pixels[0]<0&&pixels[1]>1)
 })
 test(`${depth}: current selection and local stroke restore only the selected region and preserve unrelated layer properties`,()=>{
  const {asset,modified,source,stage,action}=fixture(depth);stage.selection={inverted:false,antialiased:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,5,8],feather:0}]};stage.manifest.layers[0].name='Renamed';stage.manifest.layers[0].opacity=.4
  applyHistoryBrushOperation(stage,action,source,session);const result=data(stage.assets.get(stage.manifest.layers[0].imageFile!)!),old=data(asset),current=data(modified)
  for(let y=0;y<8;y++)for(let x=0;x<10;x++){const p=(y*10+x)*4;assert.deepEqual([...result.subarray(p,p+4)],[...(x<5?old:current).subarray(p,p+4)])}
  assert.equal(stage.manifest.layers[0].name,'Renamed');assert.equal(stage.manifest.layers[0].opacity,.4)
 })
 test(`${depth}: art mode performs distinct local stylized source restoration and leaves non-stroked pixels intact`,()=>{
  const {asset,modified,source,stage,action}=fixture(depth);action.kind='art-history';action.artSize=4;action.points=[[2.5,2.5]];action.size=3
  applyHistoryBrushOperation(stage,action,source,session);const result=data(stage.assets.get(stage.manifest.layers[0].imageFile!)!),old=data(asset),current=data(modified),p=(2*10+2)*4,far=(7*10+9)*4
  assert.notDeepEqual([...result.subarray(p,p+4)],[...old.subarray(p,p+4)]);assert.notDeepEqual([...result.subarray(p,p+4)],[...current.subarray(p,p+4)])
  assert.deepEqual([...result.subarray(far,far+4)],[...current.subarray(far,far+4)])
 })
}
test('partial RGBA8 restoration blends premultiplied colors and alpha without hidden RGB leaks',()=>{
 const current=Uint8Array.from([0,0,255,255,255,0,0,255]),source=Uint8Array.from([255,0,0,128,0,255,0,0]),result=restoreHistoryBrushPixels(current,source,Float32Array.from([1,1]),2,1,.5)
 assert.deepEqual([...result],[85,0,170,192,255,0,0,128]);assert.deepEqual([...current],[0,0,255,255,255,0,0,255])
 assert.deepEqual([...restoreHistoryBrushPixels(current,source,Float32Array.from([1,1]),2,1,1)],[...source])
 const hdr=restoreHistoryBrushPixels(Float32Array.from([1,-.5,0,.75]),Float32Array.from([-3.125,2.75,4.625,.625]),Float32Array.from([1]),1,1,.5)
 assert.deepEqual([...hdr],[-1.0625,1.125,2.3125,.6875])
})
test('source is a chosen retained snapshot, survives undo branch deletion, and clears for a new session',()=>{
 const {asset,stage}=fixture(),editor=new Editor(),store=new HistoryBrushSourceStore();editor.importDocument(stage.manifest,new Map([[asset.file,asset]]),'History source')
 const identity=editor.identity(),chosen=store.capture(editor.snapshot(),{sessionId:identity.sessionId,revision:editor.state().revision,label:'Original'})
 const paint=editor.apply({...editor.identity(),action:{type:'layer.fill',layerId:id,color:[0,0,1,1],target:'image'}})
 editor.history({...editor.identity(),direction:'undo',transactionId:paint.transactionId});editor.apply({...editor.identity(),action:{type:'layer.fill',layerId:id,color:[0,1,0,1],target:'image'}})
 assert.equal(editor.state().canRedo,false);assert.equal(store.selected(identity.sessionId)!.assets.get(asset.file)!.hash,asset.hash)
 assert.equal(store.state().sourceId,chosen.id);assert.equal(store.retainedAssets()[0],asset)
 editor.create(10,8);assert.throws(()=>store.selected(editor.identity().sessionId),/another document session/)
 store.clear();assert.deepEqual(store.state(),{sourceId:null,snapshots:[]});assert.deepEqual(store.retainedAssets(),[])
})
test('snapshot selection and retention preflight are independent from document mutations and reject atomically',()=>{
 const {source,stage}=fixture(),store=new HistoryBrushSourceStore(2),a=store.capture(stage,{sessionId:session,revision:1,label:'One'}),b=store.capture(stage,{sessionId:session,revision:2,label:'Two'})
 store.select(a.id);assert.equal(store.state().sourceId,a.id);const state=store.state()
 assert.throws(()=>store.capture(stage,{sessionId:session,revision:3,label:'Rejected'},()=>{throw Error('budget rejected')}),/budget rejected/);assert.deepEqual(store.state(),state)
 store.capture(stage,{sessionId:session,revision:3,label:'Three'});assert.throws(()=>store.select(a.id),/unavailable/);store.select(b.id)
 assert.equal(store.state().sourceId,b.id);assert.notEqual(source.manifest,stage.manifest)
 const separate=new HistoryBrushSourceStore();assert.deepEqual(separate.state(),{sourceId:null,snapshots:[]})
})
test('changed canvas, layer identity, transform, raster size, precision and stale sessions refuse without stage mutation',()=>{
 for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.stage.manifest.width++},(f:ReturnType<typeof fixture>)=>{f.stage.manifest.layers[0].id=randomUUID()},(f:ReturnType<typeof fixture>)=>{f.stage.manifest.layers[0].transform.origin[0]++},(f:ReturnType<typeof fixture>)=>{f.stage.manifest.layers[0].transform.rotation=90},(f:ReturnType<typeof fixture>)=>{const png=new PNG({width:11,height:8});f.stage.assets.set(f.modified.file,makeAsset(f.modified.file,PNG.sync.write(png)))},(f:ReturnType<typeof fixture>)=>{f.stage.assets.set(f.modified.file,makeDeepAsset(f.modified.file,10,8,new Uint16Array(320)))},(f:ReturnType<typeof fixture>)=>{f.stage.manifest.layers[0].locked=true},(f:ReturnType<typeof fixture>)=>{f.stage.manifest.layers[0].text={content:'Keep editable'} as Layer['text']}]){
  const f=fixture();mutate(f);const before=structuredClone(f.stage.manifest),versions=[...f.stage.assets]
  assert.throws(()=>applyHistoryBrushOperation(f.stage,f.action,f.source,session));assert.deepEqual(f.stage.manifest,before);assert.deepEqual([...f.stage.assets],versions)
 }
 const f=fixture();assert.throws(()=>applyHistoryBrushOperation(f.stage,f.action,f.source,'new-session'),/another document session/)
})
test('blank same-grid source restores transparency; zero opacity leaves the current asset version intact',()=>{
 const f=fixture(),blank=structuredClone(f.source.manifest);delete blank.layers[0].imageFile
 const source=captureHistoryBrushSource({manifest:blank,assets:new Map()},{sessionId:session,revision:0,label:'Blank'})
 const noChange=fixture();applyHistoryBrushOperation(noChange.stage,{...noChange.action,opacity:0},noChange.source,session);assert.equal(noChange.stage.assets.get(noChange.modified.file),noChange.modified)
 applyHistoryBrushOperation(f.stage,f.action,source,session);assert.ok(Array.from(data(f.stage.assets.get(f.stage.manifest.layers[0].imageFile!)!)).every(value=>value===0))
})
test('oversized metadata refuses before PNG decode or output allocation, preserving snapshots and source buffers',()=>{
 const f=fixture(),oversized={...f.modified,width:30_000,height:30_000,bytes:Buffer.from('not a PNG')};f.stage.assets.set(f.modified.file,oversized)
 const previous=f.source.manifest.layers[0];previous.transform.size=[30_000,30_000];f.stage.manifest.layers[0].transform.size=[30_000,30_000]
 const donor={...f.asset,width:30_000,height:30_000,bytes:Buffer.from('not a source PNG')};f.source.assets=new Map([[f.asset.file,donor]])
 assert.throws(()=>applyHistoryBrushOperation(f.stage,f.action,f.source,session),/working budget/);assert.equal(f.stage.assets.get(f.modified.file),oversized)
 for(const opacity of [NaN,-1,2])assert.throws(()=>restoreHistoryBrushPixels(new Uint8Array(4),new Uint8Array(4),Float32Array.from([1]),1,1,opacity),/opacity/)
})
