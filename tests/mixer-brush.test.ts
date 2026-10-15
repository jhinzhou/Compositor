import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PNG} from 'pngjs'
import {mixBrushStroke,cleanMixerBrushReservoir,loadMixerBrushReservoir,type MixerBrushStroke} from '../src/shared/mixer-brush'
import {prepareMixerBrush,applyMixerBrushOperation,type MixerBrushAction} from '../src/core/mixer-brush-edit'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {saveProject,loadProject} from '../src/core/project-io'
import type {PixelStage} from '../src/core/pixel-actions'
const W=48,H=24,transform={origin:[0,0] as [number,number],size:[W,H] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},grid={width:W,height:H,transform,canvasWidth:W,canvasHeight:H}
const settings:MixerBrushStroke={points:[[8,12],[40,12]],size:10,hardness:.75,opacity:1,spacing:.2,wet:.7,load:.8,mix:.7,flow:.55,color:[0,0,1,1],cleanAfterStroke:false,loadAfterStroke:false,colorPickup:'average',protectAlpha:true}
function source(){const rgba=new Uint8Array(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++)rgba.set(x<W/2?[220,30,10,255]:[20,190,70,255],(y*W+x)*4);return rgba}
test('Mixer independently deposits load and picks up canvas paint: Wet/Mix, Flow and load depletion affect real pixels',()=>{
 const rgba=source(),before=rgba.slice(),reservoir=loadMixerBrushReservoir(settings.color,.8),snapshot=structuredClone(reservoir),dry=mixBrushStroke(rgba,grid,{...settings,wet:0,mix:0},reservoir),wet=mixBrushStroke(rgba,grid,settings,reservoir),lowFlow=mixBrushStroke(rgba,grid,{...settings,flow:.1},reservoir)
 assert.ok(dry.affectedPixels>0);assert.ok(wet.affectedPixels>0);assert.notDeepEqual(wet.pixels,dry.pixels);assert.notDeepEqual(lowFlow.pixels,wet.pixels);assert.notDeepEqual(mixBrushStroke(rgba,grid,{...settings,wet:0,mix:0,load:.1},reservoir).pixels,dry.pixels);assert.ok(dry.reservoir.paintRemaining<reservoir.paintRemaining);assert.notDeepEqual(wet.reservoir.premultipliedColor,reservoir.premultipliedColor);assert.deepEqual(rgba,before);assert.deepEqual(reservoir,snapshot)
 const empty=mixBrushStroke(rgba,grid,{...settings,wet:0,mix:0},cleanMixerBrushReservoir());assert.equal(empty.affectedPixels,0);const pickup=mixBrushStroke(rgba,grid,{...settings,wet:1,mix:1},cleanMixerBrushReservoir());assert.ok(pickup.affectedPixels>0);assert.ok(pickup.reservoir.paintRemaining>0)
})
test('Average/tip pickup, clean-after, load-after and fixed arc-length dabs have distinct deterministic semantics',()=>{
 const rgba=source(),dot={...settings,points:[[24.5,12]] as [number,number][]},average=mixBrushStroke(rgba,grid,dot),tip=mixBrushStroke(rgba,grid,{...dot,colorPickup:'tip'});assert.notDeepEqual(average.pixels,tip.pixels)
 assert.deepEqual(mixBrushStroke(rgba,grid,{...settings,cleanAfterStroke:true}).reservoir,cleanMixerBrushReservoir());assert.deepEqual(mixBrushStroke(rgba,grid,{...settings,cleanAfterStroke:true,loadAfterStroke:true}).reservoir,loadMixerBrushReservoir(settings.color,settings.load))
 assert.deepEqual(mixBrushStroke(rgba,grid,settings),mixBrushStroke(rgba,grid,{...settings,points:[[8,12],[16,12],[24,12],[32,12],[40,12]]}))
})
test('Mixer single opacity ceiling, selection exterior, locked alpha and invisible RGB survive private processing',()=>{
 const rgba=source(),p=12*W+16;rgba.set([233,17,61,0],p*4);const coverage=new Uint8Array(W*H);for(let y=8;y<17;y++)for(let x=12;x<37;x++)coverage[y*W+x]=x<20?128:255
 const full=mixBrushStroke(rgba,grid,settings,undefined,{selectionCoverage:coverage}),half=mixBrushStroke(rgba,grid,{...settings,opacity:.5},undefined,{selectionCoverage:coverage});assert.deepEqual(half.reservoir,full.reservoir)
 for(let q=0;q<coverage.length;q++){assert.equal(full.pixels[q*4+3],rgba[q*4+3]);if(!coverage[q]||q===p)assert.deepEqual(full.pixels.subarray(q*4,q*4+4),rgba.subarray(q*4,q*4+4));if(q!==p)for(let c=0;c<3;c++)assert.ok(Math.abs(half.pixels[q*4+c]-(rgba[q*4+c]+full.pixels[q*4+c])/2)<=1)}
 const zero=mixBrushStroke(rgba,grid,{...settings,opacity:0});assert.deepEqual(zero.pixels,rgba);assert.equal(zero.affectedPixels,0)
 const transparent=Buffer.alloc(W*H*4);for(let at=0;at<transparent.length;at+=4)transparent.set([249,199,119,0],at);const immutable=Buffer.from(transparent),paint=mixBrushStroke(transparent,grid,{...settings,protectAlpha:false,wet:1,mix:0});assert.ok(paint.affectedPixels>0);assert.deepEqual(transparent,immutable);assert.ok(paint.pixels[(12*W+12)*4+3]>0)
})
test('Mixer refuses malformed snapshots and cancels/budgets atomically without advancing input paint',()=>{
 const rgba=source(),before=rgba.slice(),reservoir=loadMixerBrushReservoir(settings.color,.7),snapshot=structuredClone(reservoir);assert.throws(()=>mixBrushStroke(rgba,grid,settings,reservoir,{maximumWork:50}),/budget/)
 const signal=new AbortController().signal;let checks=0;Object.defineProperty(signal,'aborted',{get:()=>++checks>8});assert.throws(()=>mixBrushStroke(rgba,grid,settings,reservoir,{signal}),/canceled/)
 for(const value of [-.1,1.1,NaN])assert.throws(()=>mixBrushStroke(rgba,grid,{...settings,wet:value},reservoir),/settings/);assert.throws(()=>mixBrushStroke(rgba,grid,settings,{premultipliedColor:[1,1,1,0],paintRemaining:1}),/snapshot/);assert.deepEqual(rgba,before);assert.deepEqual(reservoir,snapshot)
})
test('Mixer supports original premultiplied 16-bit precision and extended Float32 values without an RGB8 proxy',()=>{
 const deep=new Uint16Array(W*H*4),hdr=new Float32Array(W*H*4);for(let y=0;y<H;y++)for(let x=0;x<W;x++){deep.set([30001+x,10003+y,4001,65535],(y*W+x)*4);hdr.set([x<W/2?3.5:.25,-.2,.5,1],(y*W+x)*4)}
 const d=mixBrushStroke(deep,grid,settings),f=mixBrushStroke(hdr,grid,{...settings,wet:1,mix:1}),at=(12*W+12)*4;assert.ok(d.pixels instanceof Uint16Array);assert.ok(f.pixels instanceof Float32Array);assert.ok(d.affectedPixels>0);assert.ok(d.pixels.some((v,i)=>i%4!==3&&v%257!==0));assert.ok(f.pixels[at]>1);assert.ok(f.pixels[at+1]<0);for(let p=0;p<W*H;p++){assert.equal(d.pixels[p*4+3],65535);assert.equal(f.pixels[p*4+3],1);for(let c=0;c<3;c++)assert.ok(d.pixels[p*4+c]<=d.pixels[p*4+3])}assert.deepEqual(d.pixels.subarray(0,4),deep.subarray(0,4));assert.deepEqual(f.pixels.subarray(0,4),hdr.subarray(0,4))
})
function editorStage(){const rgba=source(),png=new PNG({width:W,height:H});png.data=Buffer.from(rgba);const editor=new Editor();editor.importPNG(PNG.sync.write(png),'Mixer independent input');const snapshot=editor.snapshot();return {editor,stage:{...snapshot,selection:null} as PixelStage,layerId:snapshot.manifest.layers[0].id}}
test('Mixer core speculative preview and commit agree, cancellation is atomic, and deep/HDR saved storage stays native',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mixer-native-depth-'));try{for(const depth of ['8','16','hdr'] as const){const s=editorStage(),layer=s.stage.manifest.layers[0],file=layer.imageFile!,action:MixerBrushAction={...settings,type:'layer.mixer_brush',layerId:s.layerId,reservoir:loadMixerBrushReservoir(settings.color,.8)}
  if(depth==='16'){const deep=new Uint16Array(W*H*4);for(let p=0;p<W*H;p++)deep.set([30001+p%100,16003,7001,65535],p*4);s.stage.assets.set(file,makeDeepAsset(file,W,H,deep));s.stage.manifest.version=12}
  if(depth==='hdr'){const hdr=new Float32Array(W*H*4);for(let p=0;p<W*H;p++)hdr.set([2.5,-.1,.7,1],p*4);const hdrFile=file.replace(/\.png$/,'.exr');s.stage.assets.delete(file);s.stage.assets.set(hdrFile,makeHDRAsset(hdrFile,W,H,hdr));layer.imageFile=hdrFile;s.stage.manifest.version=13}
  const snapshot=structuredClone(s.stage),preview=prepareMixerBrush(s.stage,action),repeat=prepareMixerBrush(s.stage,action);assert.deepEqual(preview,repeat);assert.deepEqual(structuredClone(s.stage),snapshot);const c=new AbortController();c.abort();assert.throws(()=>prepareMixerBrush(s.stage,action,{signal:c.signal}),/canceled/);assert.deepEqual(structuredClone(s.stage),snapshot)
  applyMixerBrushOperation(s.stage,action);const committed=s.stage.assets.get(layer.imageFile!)!;if(depth==='8')assert.deepEqual(committed.bytes,preview.png);else if(depth==='16')assert.deepEqual(committed.deep,preview.deep);else assert.deepEqual(committed.hdr,preview.hdr)
  const path=join(folder,depth+'.comp');await saveProject(path,s.stage.manifest,s.stage.assets);const reopened=await loadProject(path);const saved=reopened.assets.get(layer.imageFile!)!;if(depth==='16')assert.deepEqual(saved.deep,committed.deep);if(depth==='hdr')assert.deepEqual(saved.hdr,committed.hdr);if(depth==='8')assert.deepEqual(saved.bytes,committed.bytes)
 }}finally{await rm(folder,{recursive:true,force:true})}
})
test('Mixer core grows raster safely, preserves linked mask placement, and refuses locks, missing depth and shape pixels',()=>{
 const s=editorStage(),layer=s.stage.manifest.layers[0],mask=new PNG({width:W,height:H});mask.data.fill(255);layer.maskFile=layer.id+'.mask.png';s.stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,PNG.sync.write(mask)));const maskBefore=s.stage.assets.get(layer.maskFile)!.bytes,action:MixerBrushAction={...settings,type:'layer.mixer_brush',layerId:s.layerId,protectAlpha:false,points:[[2,2],[4,4]],size:18},grown=prepareMixerBrush(s.stage,action);assert.ok(grown.width>W&&grown.height>H);assert.ok(grown.transform.origin[0]<0);assert.ok(grown.maskPNG);assert.equal(PNG.sync.read(grown.maskPNG!).width,grown.width);assert.strictEqual(s.stage.assets.get(layer.maskFile)!.bytes,maskBefore)
 layer.locked=true;assert.throws(()=>prepareMixerBrush(s.stage,action),/Unlock/);layer.locked=false;layer.shape={};assert.throws(()=>prepareMixerBrush(s.stage,action),/raster/);delete layer.shape
 const asset=s.stage.assets.get(layer.imageFile!)!;asset.bitDepth=16;assert.throws(()=>prepareMixerBrush(s.stage,action),/retained high-depth/)
})
test('Integrated Mixer Editor returns one prepared reservoir, caches retry, protects cancel preview and round-trips Undo/Redo/save at every depth',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mixer-editor-integration-'));try{for(const depth of ['8','16','hdr'] as const){const s=editorStage(),layer=s.stage.manifest.layers[0],file=layer.imageFile!
  if(depth==='16'){const deep=new Uint16Array(W*H*4);for(let p=0;p<W*H;p++)deep.set([30001+p%100,16003,7001,65535],p*4);s.stage.assets.set(file,makeDeepAsset(file,W,H,deep));s.stage.manifest.version=12}
  if(depth==='hdr'){const hdr=new Float32Array(W*H*4);for(let p=0;p<W*H;p++)hdr.set([2.5,-.1,.7,1],p*4);const hdrFile=file.replace(/\.png$/,'.exr');s.stage.assets.delete(file);s.stage.assets.set(hdrFile,makeHDRAsset(hdrFile,W,H,hdr));layer.imageFile=hdrFile;s.stage.manifest.version=13}
  const path=join(folder,depth+'.comp');await saveProject(path,s.stage.manifest,s.stage.assets);const editor=new Editor();await editor.open(path);const before=editor.snapshot(),layerId=before.manifest.layers[0].id,action:MixerBrushAction={...settings,type:'layer.mixer_brush',layerId,reservoir:loadMixerBrushReservoir(settings.color,.8)},request={...editor.identity(),action};editor.inspectPrepared(request)
  const prepared=prepareMixerBrush({...before,selection:null},action);assert.deepEqual(editor.snapshot(),before);const result=editor.apply(request),after=editor.snapshot();assert.equal(result.status,'applied');assert.deepEqual(result.mixerReservoir,prepared.reservoir);assert.deepEqual(editor.apply(request),result);assert.deepEqual(editor.snapshot(),after)
  const asset=after.assets.get(after.manifest.layers[0].imageFile!)!;if(depth==='8')assert.deepEqual(asset.bytes,prepared.png);else if(depth==='16')assert.deepEqual(asset.deep,prepared.deep);else assert.deepEqual(asset.hdr,prepared.hdr)
  editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before);assert.equal(editor.state().canRedo,true);const zero=editor.apply({...editor.identity(),action:{...action,opacity:0}});assert.equal(zero.status,'no_change');assert.equal(editor.state().canRedo,true);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after);const savedPath=join(folder,depth+'-committed.comp');await editor.saveAs(savedPath);const reopened=new Editor();await reopened.open(savedPath);assert.deepEqual(reopened.snapshot().assets,editor.snapshot().assets)
 }}finally{await rm(folder,{recursive:true,force:true})}
})
test('Mixer paints a new blank layer through its own action and alpha lock leaves transparent blank paint unchanged',()=>{
 const s=editorStage();s.editor.apply({...s.editor.identity(),action:{type:'layer.add_blank',name:'Fresh Mixer canvas'}});const before=s.editor.snapshot(),layerId=before.manifest.layers.at(-1)!.id,action:MixerBrushAction={...settings,type:'layer.mixer_brush',layerId,protectAlpha:false,wet:0,mix:0},prepared=prepareMixerBrush({...before,selection:null},action);assert.ok(prepared.affectedPixels>0);assert.equal(before.manifest.layers.at(-1)!.imageFile,undefined)
 assert.equal(prepareMixerBrush({...before,selection:null},{...action,protectAlpha:true}).affectedPixels,0);const result=s.editor.apply({...s.editor.identity(),action});assert.equal(result.status,'applied');const after=s.editor.snapshot(),asset=after.assets.get(after.manifest.layers.at(-1)!.imageFile!)!;assert.deepEqual(asset.bytes,prepared.png);s.editor.history({...s.editor.identity(),direction:'undo'});assert.deepEqual(s.editor.snapshot(),before)
})
