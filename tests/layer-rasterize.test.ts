import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {rasterizeLayer} from '../src/core/layer-rasterize'
import {applyPixelAction} from '../src/core/pixel-actions'
import {EditorError,actionSchema,batchSchema,type EditAction,type Layer} from '../src/shared/contracts'
const text={content:'Editable',fontName:'Arial',fontSize:16,red:0,green:0,blue:0,alignment:'Left',tracking:0,leading:0}
const shape={kind:'Rectangle',red:1,green:0,blue:0,cornerRadius:0}
function fixture(kind:'text'|'shape'='text',depth:8|16|32=8){
 const editor=new Editor();editor.create(48,32);editor.apply({...editor.identity(),action:{type:'layer.add_blank',name:'Editable source'}});const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],file=`${layer.id}.png`
 layer.imageFile=file;const png=new PNG({width:48,height:32});for(let i=0;i<png.data.length;i+=4)png.data.set([20,40,60,255],i);snapshot.assets.set(file,makeAsset(file,PNG.sync.write(png)))
 layer[kind]=kind==='text'?text:shape
 layer.maskFile=`${layer.id}.mask.png`;layer.maskDensity=.5;layer.maskFeather=2;layer.maskLinked=false
 layer.effects={stroke:{red:0,green:0,blue:1,opacity:1,size:1,inside:true}}
 layer.photoshop={text:{custom:'editable'},nativeTextSnapshot:'original',vectorFill:{custom:'shape'},nativeShapeSnapshot:'original',effects:{custom:'effect'},maskParameters:{custom:'mask'},protected:{custom:'lock'}}
 const mask=new PNG({width:48,height:32});mask.data.fill(255);snapshot.assets.set(layer.maskFile,makeAsset(layer.maskFile,PNG.sync.write(mask,{colorType:0})))
 if(depth===16){const source=new Uint16Array(48*32*4);for(let i=0;i<source.length;i+=4)source.set([10003,20307,30401,42001],i);snapshot.assets.set(file,makeDeepAsset(file,48,32,source))}
 if(depth===32){const source=new Float32Array(48*32*4);for(let i=0;i<source.length;i+=4)source.set([-.1,1.2,2.3,.9],i);snapshot.assets.set(file,makeHDRAsset(file,48,32,source))}
 if(depth!==8)delete layer.effects
 editor.importDocument(snapshot.manifest,snapshot.assets,'Editable fixture')
 return {editor,layerId:layer.id,file,source:snapshot.assets.get(file)!}
}
const apply=(editor:Editor,action:EditAction)=>editor.apply({...editor.identity(),action})
const code=(value:string)=>(error:unknown)=>error instanceof EditorError&&error.code===value
function paint(layerId:string,mask=false):EditAction{return {type:'layer.paint',layerId,points:[[24,16]],size:8,hardness:1,color:[1,0,0,1],opacity:1,erase:false,target:mask?'mask':'image'}}

test('text and shape rasterization keeps source bytes, mask, transform and effects and Undo restores editable PSD metadata',()=>{
 for(const kind of ['text','shape'] as const){const {editor,layerId,file,source}=fixture(kind),before=editor.state(),original=before.manifest.layers[0],request={...editor.identity(),action:{type:'layer.rasterize',layerId} as EditAction}
  const result=editor.apply(request);assert.equal(result.undoable,true);assert.deepEqual(editor.apply(request),result)
  const after=editor.state().manifest.layers[0];assert.equal(after[kind],undefined)
  for(const field of ['imageFile','transform','maskFile','maskDensity','maskFeather','maskLinked','effects'] as const)assert.deepEqual(after[field],original[field],field)
  assert.deepEqual((after.photoshop as Record<string,unknown>).effects,(original.photoshop as Record<string,unknown>).effects)
  assert.deepEqual(editor.state().assets,before.assets);assert.equal(editor.snapshot().assets.get(file),source)
  editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().manifest.layers[0],original);assert.equal(editor.snapshot().assets.get(file),source)
  editor.history({...editor.identity(),direction:'redo'});assert.equal(editor.state().manifest.layers[0][kind],undefined)
  apply(editor,paint(layerId));assert.notEqual(editor.snapshot().assets.get(file)?.hash,source.hash)
  editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().manifest.layers[0][kind],undefined)
  editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().manifest.layers[0],original)
 }
})

test('rasterization preserves exact 16-bit and HDR snapshots without a display-proxy roundtrip',()=>{
 for(const depth of [16] as const){const {editor,layerId,file,source}=fixture('text',depth);apply(editor,{type:'layer.rasterize',layerId});assert.equal(editor.snapshot().assets.get(file),source);assert.equal(editor.snapshot().assets.get(file)!.bitDepth,16)
  editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.snapshot().assets.get(file),source);assert.deepEqual(editor.state().manifest.layers[0].text,text)
 }
 const pixels=new Float32Array([-.1,1.2,2.3,.9]),file=`${randomUUID()}.exr`,source=makeHDRAsset(file,1,1,pixels),layer:Layer={id:randomUUID(),name:'HDR metadata',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',text,transform:{origin:[0,0],size:[1,1],rotation:0,flipX:false,flipY:false,sampling:'High quality'}};const assets=new Map([[file,source]]);rasterizeLayer(layer,assets);assert.equal(assets.get(file),source);assert.deepEqual(source.hdr,pixels);assert.equal(layer.text,undefined)
})

test('paint, eraser, gradient and retouch reject editable image targets at mutation, preview and direct raster entrypoints',()=>{
 const {editor,layerId}=fixture(),actions:EditAction[]=[paint(layerId),{...paint(layerId),erase:true} as EditAction,{type:'layer.gradient',layerId,start:[0,0],end:[48,0],from:[0,0,0,1],to:[1,1,1,1],radial:false},{type:'layer.retouch',layerId,kind:'blur',points:[[24,16]],size:8,hardness:1,opacity:1,protectAlpha:true}]
 const before=editor.state()
 for(const action of actions){assert.throws(()=>apply(editor,action),code('RASTERIZATION_REQUIRED'));assert.throws(()=>editor.inspectPrepared({...editor.identity(),action}),code('RASTERIZATION_REQUIRED'));const stage={...editor.snapshot(),selection:null};assert.throws(()=>applyPixelAction(stage,action),code('RASTERIZATION_REQUIRED'));assert.deepEqual(stage.manifest,before.manifest);assert.deepEqual(editor.state(),before)}
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'layer.rename',layerId,name:'Should roll back'},paint(layerId)]}),code('RASTERIZATION_REQUIRED'));assert.deepEqual(editor.state(),before)
})

test('explicit rasterize plus paint can share one atomic MCP batch and support client refs',()=>{
 const {editor,layerId}=fixture(),before=editor.state();assert.equal(actionSchema.parse({type:'layer.rasterize',layerId}).type,'layer.rasterize')
 const input=batchSchema.parse({...editor.identity(),actions:[{type:'layer.duplicate',layerId,clientRef:'copy'},{type:'layer.rasterize',layerId:{ref:'copy'}},{...paint(layerId),layerId:{ref:'copy'}}]})
 const result=editor.applyBatch(input),copy=editor.state().manifest.layers.find(layer=>layer.id===result.createdIds?.copy)!
 assert.equal(copy.text,undefined);assert.deepEqual(editor.state().manifest.layers.find(layer=>layer.id===layerId)?.text,text)
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().manifest,before.manifest)
})

test('painting masks and Quick Mask coverage bypass conversion and retain editable text',()=>{
 const {editor,layerId,file,source}=fixture();apply(editor,paint(layerId,true));assert.deepEqual(editor.state().manifest.layers[0].text,text);assert.equal(editor.snapshot().assets.get(file),source)
 apply(editor,{type:'selection.paint',points:[[24,16]],size:8,hardness:1,opacity:1,value:1,initial:'empty'});assert.deepEqual(editor.state().manifest.layers[0].text,text);assert.equal(editor.snapshot().assets.get(file),source)
})

test('locked, stale and missing-snapshot conversions fail without removing editable content or consuming undo history',()=>{
 const {editor,layerId}=fixture();const stale={...editor.identity(),action:{type:'layer.rasterize',layerId} as EditAction};apply(editor,{type:'layer.rename',layerId,name:'Changed'});assert.throws(()=>editor.apply(stale),code('REVISION_CONFLICT'))
 apply(editor,{type:'layer.set_lock',layerId,lock:'all',locked:true});const locked=editor.state();assert.throws(()=>apply(editor,{type:'layer.rasterize',layerId}),code('INVALID_ARGUMENT'));assert.deepEqual(editor.state(),locked)
 const layer:Layer={...locked.manifest.layers[0]};delete layer.imageFile;const before=structuredClone(layer);assert.throws(()=>rasterizeLayer(layer,new Map()),code('ASSET_NOT_FOUND'));assert.deepEqual(layer,before)
})

test('converted snapshot saves and reopens as raster, while unconverted layer retains its editable metadata',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'rasterize-roundtrip-'))
 try{const {editor,layerId,source}=fixture(),request={...editor.identity(),action:{type:'layer.duplicate',layerId} as EditAction};editor.apply(request);apply(editor,{type:'layer.rasterize',layerId});const path=join(directory,'raster.comp');await editor.saveAs(path);const reopened=new Editor();await reopened.open(path);const layer=reopened.state().manifest.layers.find(layer=>layer.id===layerId)!;assert.equal(layer.text,undefined);assert.equal(reopened.state().assets.find(asset=>asset.file===layer.imageFile)?.hash,source.hash);assert.equal(reopened.state().manifest.layers.filter(layer=>layer.text).length,1)}finally{await rm(directory,{recursive:true,force:true})}
})
