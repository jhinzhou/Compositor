import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {writePsdBuffer} from 'ag-psd'
import {parse} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import ts from 'typescript'
import {Editor} from '../src/core/editor'
import {makeAsset,makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {decodePhotoshop} from '../src/core/photoshop-io'
import {compositeDeepDocument} from '../src/core/deep-composite'
import {compositeHDRDocument} from '../src/core/hdr-composite'
import {actionSchema,layerSchema,type EditAction,type Layer} from '../src/shared/contracts'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask,maskPropertiesKey,maskPropertyGeometry} from '../src/shared/mask-properties'
import {photoshopMaskFeatherKernel,photoshopMaskFeatherSigma,photoshopMaskFeatherPixels,fullCanvasMaskEdgeMode} from '../src/shared/mask-feather'
import {kernelLineConvolver} from '../src/shared/image-filter-algorithms'
import {maskDisplayState} from '../src/renderer/mask-display'

const gray=(width:number,height:number,fn:(x:number,y:number)=>number)=>({width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:fn(Math.floor(i/4)%width,Math.floor(i/4/width)))})
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function setup(){const editor=new Editor(),source=gray(15,11,()=>255),png=new PNG({width:15,height:11});png.data.set(source.data);editor.importPNG(PNG.sync.write(png),'Mask source');const layerId=editor.state().manifest.activeLayerID!;apply(editor,{type:'selection.set',selection:{shapes:[{kind:'rectangle',operation:'replace',bounds:[4,3,7,5],feather:0}],feather:0,inverted:false,antialiased:false}});apply(editor,{type:'layer.mask',layerId,operation:'reveal'});return {editor,layerId}}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')

test('untagged masks keep legacy Gaussian exactly; tagged Photoshop has distinct coverage/cache without source mutation',()=>{
 const source=gray(15,11,(x,y)=>x>=4&&x<11&&y>=3&&y<8?255:0),copy=source.data.slice(),implicit=effectiveMaskPixels(source,{maskFeather:.5}),legacy=effectiveMaskPixels(source,{maskFeather:.5,maskFeatherModel:'compositor'}),ps=effectiveMaskPixels(source,{maskFeather:.5,maskFeatherModel:'photoshop'})
 assert.deepEqual(implicit,legacy);assert.notDeepEqual(ps.image.data,implicit.image.data);assert.deepEqual(source.data,copy)
 assert.equal(maskPropertiesKey('bytes',{maskFeather:.5}),maskPropertiesKey('bytes',{maskFeather:.5,maskFeatherModel:'compositor'}));assert.notEqual(maskPropertiesKey('bytes',{maskFeather:.5}),maskPropertiesKey('bytes',{maskFeather:.5,maskFeatherModel:'photoshop'}))
 for(const feather of [0,.00001,.1,.3,.5,1,2,3,4,6,10,50,250]){const k=photoshopMaskFeatherKernel(feather);assert.ok(Math.abs(k.reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(k.every(v=>v>=0&&Number.isFinite(v)));assert.ok(k.every((v,i)=>Math.abs(v-k[k.length-1-i])<1e-14))}
 assert.equal(photoshopMaskFeatherSigma(0),0);assert.ok(photoshopMaskFeatherSigma(.00001)<.00002)
})
test('generic direct/FFT kernel convolution keeps source immutable and agrees with an independent scalar sum',()=>{
 for(const feather of [1,6,50]){const kernel=photoshopMaskFeatherKernel(feather),radius=(kernel.length-1)/2,input=Float32Array.from({length:123},(_,i)=>i%7-3),before=input.slice(),actual=kernelLineConvolver(input.length,kernel)(input)
  for(let x=0;x<input.length;x++){let expected=0;for(let k=-radius;k<=radius;k++)expected+=(input[x+k]??0)*kernel[k+radius];assert.ok(Math.abs(actual[x]-expected)<2e-7)}assert.deepEqual(input,before)
 }
})
test('mask model is undoable, omission preserves an existing model, and source PNG survives save/reopen',async()=>{
  const {editor,layerId}=setup(),before=editor.snapshot(),file=before.manifest.layers[0].maskFile!,result=apply(editor,{type:'layer.mask_properties',layerId,density:.7,feather:.5,featherModel:'photoshop'}),after=editor.snapshot();assert.equal(after.manifest.layers[0].maskFeatherModel,'photoshop');assert.equal(after.manifest.layers[0].maskFeatherEdgeMode,'clamp');assert.deepEqual(after.assets.get(file),before.assets.get(file))
 editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
 apply(editor,{type:'layer.mask_properties',layerId,density:.6,feather:3});assert.equal(editor.state().manifest.layers[0].maskFeatherModel,'photoshop')
 apply(editor,{type:'document.crop',x:3,y:2,width:7,height:5,deleteCroppedPixels:false});apply(editor,{type:'layer.mask_properties',layerId,density:.6,feather:3,featherModel:'photoshop'});assert.equal(editor.state().manifest.layers[0].maskFeatherEdgeMode,'clamp','An existing full-canvas source boundary must survive crop without reinference')
 const dir=await mkdtemp(join(tmpdir(),'mask-feather-model-'));try{await editor.saveAs(join(dir,'Mask.comp'));const reopened=new Editor();await reopened.open(join(dir,'Mask.comp'));assert.equal(reopened.state().manifest.layers[0].maskFeatherModel,'photoshop');assert.equal(reopened.state().manifest.layers[0].maskFeatherEdgeMode,'clamp');assert.deepEqual(reopened.snapshot().assets.get(file),before.assets.get(file))}finally{await rm(dir,{recursive:true,force:true})}
})
test('copy preserves mask model; removal and recreated masks reset it; transient composite/gray previews carry it',()=>{
 const {editor,layerId}=setup();apply(editor,{type:'layer.mask_properties',layerId,density:.7,feather:3,featherModel:'photoshop'});const state=editor.state(),source=structuredClone(state),draft={density:.3,feather:.5,featherModel:'compositor' as const},preview=maskDisplayState(state,layerId,undefined,undefined,true,'background',draft)
 assert.equal(preview.manifest.layers[1].maskFeatherModel,'compositor');assert.deepEqual(state,source)
 apply(editor,{type:'layer.add_blank',name:'Target'});const target=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.copy_mask',sourceId:layerId,layerId:target});assert.equal(editor.state().manifest.layers.find(l=>l.id===target)!.maskFeatherModel,'photoshop');assert.equal(editor.state().manifest.layers.find(l=>l.id===target)!.maskFeatherEdgeMode,'clamp')
 apply(editor,{type:'layer.mask',layerId:target,operation:'remove'});apply(editor,{type:'layer.mask',layerId:target,operation:'hide'});const recreated=editor.state().manifest.layers.find(l=>l.id===target)!;assert.equal(recreated.maskFeatherModel,undefined);assert.equal(recreated.maskFeatherEdgeMode,undefined);assert.equal(recreated.maskFeather,undefined)
})
test('PSD imports explicitly identify Photoshop mask semantics without retroactively changing untagged project layers',()=>{
 const image=gray(15,11,()=>255),mask=gray(15,11,(x,y)=>x>3&&x<11&&y>2&&y<8?255:0),input=writePsdBuffer({width:15,height:11,children:[{name:'Native PSD',imageData:image,mask:{left:0,top:0,right:15,bottom:11,defaultColor:0,imageData:mask,userMaskFeather:.5}}]},{noBackground:true}),decoded=decodePhotoshop(input)
 assert.equal(decoded.manifest.layers[0].maskFeatherModel,'photoshop');assert.equal(decoded.manifest.layers[0].maskFeatherEdgeMode,'clamp');assert.equal(setup().editor.state().manifest.layers[0].maskFeatherModel,undefined)
})
test('PSD masks smaller than the original document keep finite default boundaries',()=>{
 const image=gray(15,11,()=>255),mask=gray(7,5,(x,y)=>x<4?255:0),input=writePsdBuffer({width:15,height:11,children:[{name:'Finite native mask',imageData:image,mask:{left:2,top:3,right:9,bottom:8,defaultColor:255,imageData:mask,userMaskFeather:3}}]},{noBackground:true}),decoded=decodePhotoshop(input),layer=decoded.manifest.layers[0]
 assert.equal(layer.maskFeatherModel,'photoshop');assert.equal(layer.maskFeatherEdgeMode,'default');assert.equal(layer.photoshopMaskDefault,255);assert.equal(decoded.assets.get(layer.maskFile!)!.width,15,'The importer expands a finite patch; that must not be mistaken for the original full-canvas boundary')
})
// Exercise actual panel handlers with renderer dependencies supplied; no DOM/GUI.
function propertyHandlers(environment:Record<string,unknown>){
 const filename='src/renderer/MaskPanel.vue',{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),source=ts.createSourceFile(filename,descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),names=['propertyDraft','previewProperties','applyProperties'],functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text??''));assert.equal(functions.length,3)
 const code=transformSync(functions.map(node=>node.getText(source)).join('\n'),{loader:'ts',format:'cjs'}).code
 return new Function(...Object.keys(environment),`${code};return {propertyDraft,previewProperties,applyProperties}`)(...Object.values(environment)) as {propertyDraft:()=>unknown;previewProperties:()=>void;applyProperties:()=>void}
}
test('actual mask property panel preview and commit carry the same persisted boundary and model',()=>{
 for(const explicit of [undefined,'default'] as const){const {editor,layerId}=setup(),layer=structuredClone(editor.state().manifest.layers[0]);if(explicit)layer.maskFeatherEdgeMode=explicit
  const events:{name:string;value:any}[]=[],panel=propertyHandlers({props:{layer,featherModel:'photoshop',documentWidth:15,documentHeight:11},density:{value:70},feather:{value:.5},source:gray(15,11,()=>255),fullCanvasMaskEdgeMode,emit:(name:string,value:any)=>events.push({name,value})})
  panel.previewProperties();panel.applyProperties();const preview=events[0].value,action=events[2].value;assert.deepEqual(preview,{density:.7,feather:.5,featherModel:'photoshop',featherEdgeMode:explicit??'clamp'});assert.deepEqual(action,{type:'layer.mask_properties',layerId,...preview});apply(editor,actionSchema.parse(action));const committed=editor.state().manifest.layers[0]
  assert.equal(committed.maskFeatherModel,preview.featherModel);assert.equal(committed.maskFeatherEdgeMode,preview.featherEdgeMode);assert.equal(committed.maskFeather,preview.feather);assert.equal(committed.maskDensity,preview.density)
 }
})
test('full-canvas clamp is explicitly persisted, smaller masks retain default padding, and legacy Gaussian ignores a clamp marker',()=>{
 const placement={origin:[0,0] as [number,number],size:[15,11] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'Nearest' as const}
 assert.equal(fullCanvasMaskEdgeMode({width:15,height:11},placement,{width:15,height:11}),'clamp');assert.equal(fullCanvasMaskEdgeMode({width:15,height:11},{...placement,origin:[2,0]},{width:15,height:11}),'default');assert.equal(fullCanvasMaskEdgeMode({width:7,height:5},placement,{width:15,height:11}),'default')
 const source=gray(15,11,(x,y)=>x<8&&y>1&&y<9?255:0),legacy=effectiveMaskPixels(source,{maskFeather:2,photoshopMaskDefault:0}),legacyMarked=effectiveMaskPixels(source,{maskFeather:2,maskFeatherEdgeMode:'clamp',photoshopMaskDefault:0}),ps=effectiveMaskPixels(source,{maskFeather:2,maskFeatherModel:'photoshop',maskFeatherEdgeMode:'clamp',photoshopMaskDefault:0}),psDefault=effectiveMaskPixels(source,{maskFeather:2,maskFeatherModel:'photoshop',maskFeatherEdgeMode:'default',photoshopMaskDefault:0})
 assert.deepEqual(legacy,legacyMarked);const read=(mask:ReturnType<typeof effectiveMaskPixels>)=>mask.image.data[((5+mask.inset)*mask.image.width+mask.inset)*4];assert.ok(read(ps)>read(psDefault)+70);assert.equal(ps.background,0);assert.equal(sampleEffectiveMask(ps,effectiveMaskTransform(placement,source,ps.inset),-1000,-1000),0)
 const {editor,layerId}=setup();apply(editor,{type:'layer.mask_set_placement',layerId,transform:{...placement,origin:[2,0]}});apply(editor,{type:'layer.mask_properties',layerId,density:1,feather:2,featherModel:'photoshop'});assert.equal(editor.state().manifest.layers[0].maskFeatherEdgeMode,'default')
})
for(const kind of [16,'hdr'] as const)test(`${kind}: composition uses shared Photoshop gray coverage and preserves high-depth source`,()=>{
 const {editor}=setup(),snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],oldFile=layer.imageFile!,file=layer.id+(kind==='hdr'?'.exr':'.png'),data=kind==='hdr'?Float32Array.from({length:15*11*4},(_,i)=>[2.125,-.125,.75,1][i%4]):Uint16Array.from({length:15*11*4},(_,i)=>[1001,2303,4007,65535][i%4]);snapshot.assets.delete(oldFile);layer.imageFile=file;layer.maskFeather=.5;layer.maskFeatherModel='photoshop';layer.maskDensity=.7;snapshot.manifest.version=kind==='hdr'?13:12;const asset=kind==='hdr'?makeHDRAsset(file,15,11,data as Float32Array):makeDeepAsset(file,15,11,data as Uint16Array);snapshot.assets.set(file,asset);editor.importDocument(snapshot.manifest,snapshot.assets,'High-depth mask')
 const raw=PNG.sync.read(snapshot.assets.get(layer.maskFile!)!.bytes),effective=effectiveMaskPixels({width:raw.width,height:raw.height,data:new Uint8ClampedArray(raw.data)},layer),placement=effectiveMaskTransform(layer.maskPlacement??layer.transform,raw,effective.inset),current=editor.snapshot(),out=kind==='hdr'?compositeHDRDocument(current.manifest,current.assets).data:compositeDeepDocument(current.manifest,current.assets).data
 for(let y=0;y<11;y++)for(let x=0;x<15;x++){const coverage=sampleEffectiveMask(effective,placement,x+.5,y+.5)/255;for(let c=0;c<4;c++)assert.equal(out[(y*15+x)*4+c],kind==='hdr'?Math.fround(data[(y*15+x)*4+c]*coverage):Math.round(data[(y*15+x)*4+c]*coverage))}
 assert.deepEqual(editor.snapshot().assets.get(file),asset)
})
test('Photoshop mask uses a true outside tone, graded density, unchanged uniform1px, and resource limits',()=>{
 const white=gray(7,5,()=>255),output=effectiveMaskPixels(white,{maskFeather:10,maskFeatherModel:'photoshop',photoshopMaskDefault:255});assert.ok(output.image.data.every(v=>v===255));assert.equal(output.background,255)
 const plane=effectiveMaskPixels(gray(1,1,()=>64),{maskDensity:.5,maskFeather:250,maskFeatherModel:'photoshop'});assert.equal(plane.inset,0);assert.equal(plane.image.data[0],160)
 assert.throws(()=>maskPropertyGeometry(30_000,30_000,{maskFeather:250,maskFeatherModel:'photoshop'}));assert.throws(()=>photoshopMaskFeatherPixels({width:30_000,height:30_000,data:new Uint8ClampedArray(0)},10,0));assert.equal(actionSchema.safeParse({type:'layer.mask_properties',layerId:setup().layerId,density:1,feather:1,featherModel:'unknown'}).success,false);assert.equal(layerSchema.safeParse({...setup().editor.state().manifest.layers[0],maskFeatherModel:'unknown'}).success,false)
})

const native=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-mask-feather-ui.json',import.meta.url),'utf8')) as {rows:{name:string;width:number;height:number;maskWidth:number;maskHeight:number;layer:Layer;maskRGBAZlib:string;alphaZlib:string;alphaSHA256:string}[]}
// Limits are measured residuals, not per-radius kernel coefficients. New rows
// outside this explicit corpus require separate native boundary investigation.
const residuals:Record<string,number>={'center-densityByte255-feather0':0,'center-densityByte255-feather0.1':0,'center-densityByte255-feather0.3':19,'center-densityByte255-feather0.5':3,'center-densityByte255-feather1':5,'center-densityByte255-feather2':2,'center-densityByte255-feather3':3,'center-densityByte255-feather4':1,'center-densityByte255-feather6':1,'center-densityByte255-feather10':1,'center-densityByte255-feather20':1,'center-densityByte255-feather50':2,'center-densityByte128-feather10':1,'inverse-densityByte255-feather10':1,'hole-densityByte255-feather10':1,'edge-densityByte255-feather10':1}
for(const row of native.rows.filter(row=>row.name in residuals))test(`native source-grid mask feather approximation retains measured residual: ${row.name}`,()=>{
 const raw=new Uint8ClampedArray(inflateSync(Buffer.from(row.maskRGBAZlib,'base64'))),alpha=new Uint8Array(inflateSync(Buffer.from(row.alphaZlib,'base64')));assert.equal(hash(alpha),row.alphaSHA256);const source={width:row.maskWidth,height:row.maskHeight,data:raw},copy=raw.slice(),layer={...row.layer,maskFeatherModel:'photoshop' as const,maskFeatherEdgeMode:'clamp' as const},effective=effectiveMaskPixels(source,layer),placement=effectiveMaskTransform(layer.maskPlacement??layer.transform,source,effective.inset);let max=0
 for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)max=Math.max(max,Math.abs(sampleEffectiveMask(effective,placement,x+.5,y+.5)-alpha[y*row.width+x]));assert.ok(max<=residuals[row.name],`max${max} exceeds measured${residuals[row.name]}`);assert.deepEqual(raw,copy)
})
