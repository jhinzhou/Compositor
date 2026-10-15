import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {actionSchema,type Layer} from '../src/shared/contracts'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {blankPNG,encodeRaster,documentPoint} from '../src/core/raster-edit'
import {prepareRetouch,type RetouchAction} from '../src/core/retouch-edit'
import {preparePatch,applyPatchOperation,type PatchAction} from '../src/core/patch-edit'
import {sampleHealingDonor,blendSampledHealing} from '../src/shared/sampled-healing'

function setup(){const editor=new Editor(),png=blankPNG(32,20);for(let y=0;y<20;y++)for(let x=0;x<32;x++){const texture=(x+y)%2?12:-12;png.data.set([40+x*4+texture,80+y*3+texture,100+texture,255],(y*32+x)*4)}editor.importPNG(encodeRaster(png),'Patch fixture');const snapshot=editor.snapshot();return {editor,png,stage:{...snapshot,selection:{inverted:false,antialiased:false,shapes:[{kind:'rectangle' as const,bounds:[20,6,6,6] as [number,number,number,number],feather:0,operation:'replace' as const}]}},id:snapshot.manifest.layers[0].id}}
function patch(id:string,other:Partial<PatchAction>={}):PatchAction{return {type:'layer.patch',layerId:id,offset:[-16,0],mode:'source',adaptation:0,...other}}
function donor(image:Uint8Array,w:number,h:number,dx:number,dy:number){const result=new Float32Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)result.set(sampleHealingDonor(image,w,h,x+.5+dx,y+.5+dy),(y*w+x)*4);return result}

test('bilinear donor interpolates premultiplied alpha, excludes invisible RGB and never clamps off-raster',()=>{
 const source=Uint8Array.from([255,0,0,255,0,255,0,0]);assert.deepEqual(sampleHealingDonor(source,2,1,1,.5),[127.5,0,0,127.5]);assert.deepEqual(sampleHealingDonor(source,2,1,-.5,.5),[0,0,0,0]);assert.deepEqual(source,Uint8Array.from([255,0,0,255,0,255,0,0]))
})
test('harmonic adaptation retains donor texture while matching destination constant brightness and leaves uncovered bytes exact',()=>{
 const w=16,h=16,image=new Uint8Array(w*h*4),source=new Float32Array(image.length),coverage=new Uint8Array(w*h)
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x;image.set([150,150,150,255],p*4);const detail=x>=5&&x<11&&y>=5&&y<11?(x+y)%2?20:-20:0;source.set([60+detail,60+detail,60+detail,255],p*4);if(x>=5&&x<11&&y>=5&&y<11)coverage[p]=255}
 const actual=blendSampledHealing(image,source,coverage,w,h),raw=blendSampledHealing(image,source,coverage,w,h,{adaptation:0});assert.equal(actual[(7*w+7)*4],130);assert.equal(actual[(7*w+8)*4],170);assert.equal(raw[(7*w+7)*4],40)
 for(let p=0;p<coverage.length;p++)if(!coverage[p])assert.deepEqual(actual.subarray(p*4,p*4+4),image.subarray(p*4,p*4+4));assert.deepEqual(image.subarray(0,4),Uint8Array.from([150,150,150,255]))
})
test('soft coverage is applied once; alpha lock and transparent donors retain target alpha and invisible bytes',()=>{
 const image=Uint8Array.from([10,30,50,127,20,40,60,0,77,88,99,255]),source=Float32Array.from([100,100,100,255,255,255,255,255,0,0,0,0]),coverage=Uint8Array.from([128,255,255]);const out=blendSampledHealing(image,source,coverage,3,1,{adaptation:0});assert.deepEqual([...out],[55,65,75,127,20,40,60,0,77,88,99,255])
})
test('Source patch repairs selection from donor; Destination pastes selected donor with blending, moves only selection and keeps original pixels',()=>{
 const {stage,id,png}=setup(),before=structuredClone(stage.manifest),beforeSelection=structuredClone(stage.selection),source=preparePatch(stage,patch(id)),src=PNG.sync.read(source.png);assert.equal(source.affectedPixels,36);assert.deepEqual(src.data.subarray((8*32+22)*4,(8*32+22)*4+4),png.data.subarray((8*32+6)*4,(8*32+6)*4+4));assert.deepEqual(src.data.subarray((8*32+6)*4,(8*32+6)*4+4),png.data.subarray((8*32+6)*4,(8*32+6)*4+4));assert.deepEqual(source.selection,beforeSelection)
 const dest=preparePatch(stage,patch(id,{mode:'destination'})),dst=PNG.sync.read(dest.png);assert.deepEqual(dst.data.subarray((8*32+6)*4,(8*32+6)*4+4),png.data.subarray((8*32+22)*4,(8*32+22)*4+4));assert.deepEqual(dst.data.subarray((8*32+22)*4,(8*32+22)*4+4),png.data.subarray((8*32+22)*4,(8*32+22)*4+4));assert.deepEqual(dest.selection!.shapes[0].bounds,[4,6,6,6]);assert.deepEqual(stage.manifest,before);assert.deepEqual(stage.selection,beforeSelection)
})
test('fractional document patch offsets and rotated/flipped layer mapping match frozen original donors',()=>{
 const {stage,id,png}=setup(),layer=stage.manifest.layers[0];layer.transform={origin:[10,10],size:[64,40],rotation:27,flipX:true,flipY:false,sampling:'High quality'};stage.manifest.width=100;stage.manifest.height=100
 const center=documentPoint(layer,20.5,8.5,32,20);stage.selection={inverted:false,antialiased:false,shapes:[{kind:'rectangle',bounds:[center[0]-3,center[1]-3,6,6],feather:0,operation:'replace'}]}
 const a=27*Math.PI/180,offset:[number,number]=[-1*Math.cos(a),-1*Math.sin(a)],result=preparePatch(stage,patch(id,{offset})),out=PNG.sync.read(result.png),expected=sampleHealingDonor(png.data,32,20,21,8.5);assert.equal(out.data[(8*32+20)*4],Math.round(expected[0]));assert.deepEqual(result.transform,layer.transform)
})
test('Patch preparation matches stored core mutation, remains atomic on cancel/invalid depth/budget, and does not edit masks',()=>{
 const {stage,id}=setup(),maskFile='patch.mask.png',mask=blankPNG(32,20,127);stage.manifest.layers[0].maskFile=maskFile;stage.assets.set(maskFile,{...stage.assets.values().next().value!,file:maskFile,bytes:encodeRaster(mask,true)});const maskBefore=stage.assets.get(maskFile),expected=preparePatch(stage,patch(id));const snapshot={manifest:structuredClone(stage.manifest),selection:structuredClone(stage.selection),assets:new Map(stage.assets)};assert.equal(applyPatchOperation(stage,patch(id)),'Patch selection');assert.deepEqual(stage.assets.get(stage.manifest.layers[0].imageFile!)!.bytes,expected.png);assert.deepEqual(stage.assets.get(maskFile),maskBefore)
 const controller=new AbortController();controller.abort();assert.throws(()=>preparePatch(snapshot,patch(id),{signal:controller.signal}),/canceled/);assert.deepEqual(snapshot.assets,new Map(snapshot.assets));assert.throws(()=>preparePatch({...snapshot,selection:null},patch(id)),/selection/)
 const file=snapshot.manifest.layers[0].imageFile!,deep=new Uint16Array(32*20*4).fill(32768);for(let p=0;p<32*20;p++)deep[p*4+3]=65535;for(const asset of [makeDeepAsset(file,32,20,deep),makeHDRAsset('hdr.exr',32,20,Float32Array.from(deep,v=>v/65535))]){const staged={...snapshot,manifest:structuredClone(snapshot.manifest),assets:new Map(snapshot.assets)};staged.assets.set(file,asset);assert.throws(()=>preparePatch(staged,patch(id)),/RGB8/);assert.deepEqual(staged.assets.get(file),asset)}
 const huge={...snapshot,assets:new Map(snapshot.assets)};huge.assets.set(file,{...huge.assets.get(file)!,width:5000,height:4000});assert.throws(()=>preparePatch(huge,patch(id)),/budget/)
})
test('Patch refuses protected ancestors and malformed donors before mutating anything',()=>{
 const {stage,id}=setup(),group={...stage.manifest.layers[0],id:'locked-group',isGroup:true,locked:true,imageFile:undefined};stage.manifest.layers.push(group);stage.manifest.layers[0].parentID=group.id;assert.throws(()=>preparePatch(stage,patch(id)),/Unlock/)
 assert.throws(()=>blendSampledHealing(Uint8Array.from([0,0,0,255]),Float32Array.from([NaN,0,0,255]),Uint8Array.from([255]),1,1),/donor/)
})
test('Photoshop-profile Spot Healing honors alpha lock without changing the upstream healing kernel',()=>{
 const {stage,id,png}=setup();const at=(8*32+22)*4;png.data[at+3]=127;const file=stage.manifest.layers[0].imageFile!;stage.assets.set(file,{...stage.assets.get(file)!,bytes:encodeRaster(png)});const action=actionSchema.parse({type:'layer.retouch',kind:'spot-heal',healingMode:'create-texture',layerId:id,points:[[22.5,8.5]],size:4,hardness:1,opacity:1,protectAlpha:true}) as RetouchAction,result=prepareRetouch({...stage,selection:null},{...action,healingModel:'photoshop'}),out=PNG.sync.read(result.png);assert.equal(out.data[at+3],127)
})
test('zero-opacity retouch keeps exact source PNG bytes, hidden RGB and placement without raster growth',()=>{
 const {stage,id,png}=setup();png.data.set([17,39,61,127],0);png.data.set([91,37,24,0],4);const file=stage.manifest.layers[0].imageFile!,bytes=encodeRaster(png);stage.assets.set(file,{...stage.assets.get(file)!,bytes})
 for(const kind of ['clone','heal','spot-heal','smear','blur'] as const){const action=actionSchema.parse({type:'layer.retouch',kind,layerId:id,points:[[-10,4],[20,8]],sourceAnchor:[4,4],size:24,hardness:1,opacity:0,protectAlpha:false}) as RetouchAction;for(const healingModel of ['compositor','photoshop'] as const){const result=prepareRetouch({...stage,selection:null},{...action,healingModel});assert.strictEqual(result.png,bytes);assert.deepEqual(result.transform,stage.manifest.layers[0].transform)}}
})
test('alpha-locked Photoshop Spot Healing retains all hidden RGB bytes inside its painted transparent pixel',()=>{
 const {stage,id,png}=setup(),at=(8*32+22)*4;png.data.set([29,73,121,0],at);const file=stage.manifest.layers[0].imageFile!;stage.assets.set(file,{...stage.assets.get(file)!,bytes:encodeRaster(png)});const action=actionSchema.parse({type:'layer.retouch',kind:'spot-heal',healingMode:'create-texture',layerId:id,points:[[22.5,8.5]],size:4,hardness:1,opacity:1,protectAlpha:true}) as RetouchAction,out=PNG.sync.read(prepareRetouch({...stage,selection:null},{...action,healingModel:'photoshop'}).png);assert.deepEqual([...out.data.subarray(at,at+4)],[29,73,121,0])
})
test('Editor Patch commits pixels and destination selection as one undoable revision; retries cannot duplicate it and stale revisions reject',()=>{
 const {editor,stage,id}=setup();editor.apply({...editor.identity(),action:{type:'selection.set',selection:stage.selection}});const before=editor.snapshot(),selectedBefore=editor.state().selection,identity=editor.identity(),action=actionSchema.parse(patch(id,{mode:'destination',adaptation:.4})),result=editor.apply({...identity,action}),after=editor.snapshot(),selectedAfter=editor.state().selection
 assert.equal(result.status,'applied');assert.equal(editor.state().revision,identity.expectedRevision+1);assert.deepEqual(editor.apply({...identity,action}),result);assert.equal(editor.state().revision,identity.expectedRevision+1);assert.deepEqual(selectedAfter!.shapes[0].bounds,[4,6,6,6]);assert.notDeepEqual(after.assets,before.assets)
 editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before);assert.deepEqual(editor.state().selection,selectedBefore)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after);assert.deepEqual(editor.state().selection,selectedAfter)
 assert.throws(()=>editor.apply({...editor.identity(),expectedRevision:identity.expectedRevision,action}),/changed/)
})
test('sampled blending cancellation/work budget reject without mutating arrays and overlap donors remain frozen',()=>{
 const {png}=setup(),before=Buffer.from(png.data),coverage=new Uint8Array(32*20).fill(255),source=donor(png.data,32,20,-1,0);assert.throws(()=>blendSampledHealing(png.data,source,coverage,32,20,{maximumWork:0}),/budget/);assert.deepEqual(png.data,before)
 const out=blendSampledHealing(png.data,source,coverage,32,20,{adaptation:0});for(let x=1;x<32;x++)assert.deepEqual([...out.subarray(x*4,x*4+4)],[...before.subarray((x-1)*4,(x-1)*4+4)])
})
test('Photoshop-profile Healing Brush preserves fractional offset, single coverage and every unpainted semi-transparent byte; default stays legacy',()=>{
 const {stage,id,png}=setup();for(let p=0;p<32*20;p++)if(p%7===0)png.data[p*4+3]=127;const file=stage.manifest.layers[0].imageFile!;stage.assets.set(file,{...stage.assets.get(file)!,bytes:encodeRaster(png)});const action=actionSchema.parse({type:'layer.retouch',kind:'heal',layerId:id,points:[[22.5,8.5]],sourceAnchor:[6,8.5],size:4,hardness:0,opacity:1,protectAlpha:true}) as RetouchAction
 const result=prepareRetouch({...stage,selection:null},{...action,healingModel:'photoshop'}),out=PNG.sync.read(result.png),legacy=prepareRetouch({...stage,selection:null},action);assert.notDeepEqual(result.png,legacy.png);for(let y=0;y<20;y++)for(let x=0;x<32;x++)if(Math.hypot(x+.5-22.5,y+.5-8.5)>2){const at=(y*32+x)*4;assert.deepEqual(out.data.subarray(at,at+4),png.data.subarray(at,at+4))}
 const repeated=prepareRetouch({...stage,selection:null},{...action,points:[[22.5,8.5],[22.5,8.5]],healingModel:'photoshop'});assert.deepEqual(repeated.png,result.png)
})

test('zero-opacity and zero-offset Patch preserve original PNG bytes, selection and redo history',()=>{
 const {editor,stage,id}=setup();editor.apply({...editor.identity(),action:{type:'selection.set',selection:stage.selection}})
 editor.apply({...editor.identity(),action:{type:'layer.rename',layerId:id,name:'Changed'}});editor.history({...editor.identity(),direction:'undo'})
 const before=editor.snapshot(),selection=editor.state().selection,file=before.manifest.layers[0].imageFile!
 for(const a of [patch(id,{opacity:0,mode:'destination'}),patch(id,{offset:[0,0],mode:'destination'})]){const result=preparePatch({...before,selection:selection??null},a);assert.strictEqual(result.png,before.assets.get(file)!.bytes);assert.equal(result.affectedPixels,0);assert.deepEqual(result.selection,selection);const applied=editor.apply({...editor.identity(),action:actionSchema.parse(a)});assert.equal(applied.status,'no_change');assert.equal(editor.state().canRedo,true);assert.deepEqual(editor.snapshot(),before)}
})
test('Committed Photoshop Patch fixture verifies known residual without pretending pixel equality',async()=>{
 const {readFile}=await import('node:fs/promises'),{inflateSync}=await import('node:zlib'),{createHash}=await import('node:crypto'),reference=JSON.parse(await readFile(new URL('../fixtures/parity/photoshop-27.11-patch-alpha24.json',import.meta.url),'utf8')),source=inflateSync(Buffer.from(reference.sourceRGBA,'base64')),native=inflateSync(Buffer.from(reference.nativeRGBA,'base64')),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
 assert.equal(sha(source),reference.sourceSha);assert.equal(sha(native),reference.nativeSha);assert.equal(reference.nativeEffectValid,true);assert.deepEqual(reference.operation.offset,[-160,0])
 const png=new PNG({width:reference.width,height:reference.height});png.data=source;const editor=new Editor();editor.importPNG(encodeRaster(png),'Photoshop Patch reference');const snapshot=editor.snapshot(),stage={...snapshot,selection:{inverted:false,antialiased:false,shapes:[{kind:'rectangle' as const,bounds:[335,135,50,50] as[number,number,number,number],operation:'replace' as const,feather:0}]}},result=PNG.sync.read(preparePatch(stage,{type:'layer.patch',layerId:snapshot.manifest.layers[0].id,offset:[-160,0],mode:'source',adaptation:1}).png)
 let total=0,channels=0;for(let y=0;y<reference.height;y++)for(let x=0;x<reference.width;x++){const at=(y*reference.width+x)*4;if(x>=335&&x<385&&y>=135&&y<185){for(let c=0;c<3;c++){total+=Math.abs(result.data[at+c]-native[at+c]);channels++}}else assert.deepEqual(result.data.subarray(at,at+4),source.subarray(at,at+4))}
 assert.ok(total/channels<8);assert.ok(total/channels>0);assert.deepEqual(stage.assets,snapshot.assets)
})
