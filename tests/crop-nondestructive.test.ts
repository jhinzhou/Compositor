import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {compositeDeepDocument} from '../src/core/deep-composite'
import {compositeHDRDocument} from '../src/core/hdr-composite'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from '../src/core/project-io'
import {EditorError,LIMITS,type EditAction,type Layer,type Manifest} from '../src/shared/contracts'

type Precision=8|16|'hdr'
const width=18,height=14,crop={x:4,y:3,width:9,height:7}
const transform=(w=width,h=height):Layer['transform']=>({origin:[0,0],size:[w,h],rotation:0,flipX:false,flipY:false,sampling:'Nearest'})
function layer(extra:Partial<Layer>={}):Layer{return {id:randomUUID().toUpperCase(),name:'Source',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:transform(),...extra}}
// Small self-authored grids: codec and Photoshop appearance parity are separate gates.
function assetFor(l:Layer,precision:Precision,w=width,h=height):Asset{
 l.imageFile=l.id+(precision==='hdr'?'.exr':'.png')
 if(precision==='hdr'){
  const pixels=new Float32Array(w*h*4)
  for(let i=0;i<w*h;i++)pixels.set([1.125+i*.03125,-.125+i*.00390625,.25+(i%11)*.03125,1],i*4)
  return makeHDRAsset(l.imageFile,w,h,pixels)
 }
 if(precision===16){
  const pixels=new Uint16Array(w*h*4)
  for(let i=0;i<w*h;i++)pixels.set([1001+i*71,2303+i*47,4007+i*29,65535],i*4)
  return makeDeepAsset(l.imageFile,w,h,pixels)
 }
 const png=new PNG({width:w,height:h})
 for(let i=0;i<w*h;i++)png.data.set([13+i%211,29+i%173,47+i%139,255],i*4)
 return makeAsset(l.imageFile,PNG.sync.write(png))
}
function fixture(precision:Precision){
 const base=layer({name:'Background'}),group=layer({name:'Group',isGroup:true,opacity:.75}),upper=layer({name:'Rotated and flipped',parentID:group.id,transform:{...transform(8,6),origin:[5,4],rotation:19,flipX:true}}),hidden=layer({name:'Hidden editable metadata',parentID:group.id,isVisible:false,text:{content:'Retained text',fontName:'Arial',fontSize:12},shape:{kind:'rectangle'},effects:{stroke:{size:2,red:1,green:0,blue:0,opacity:1,inside:false}},photoshop:{text:'retained',nativeRasterHash:'reference'},customData:{retained:true}})
 upper.maskFile=upper.id+'.mask.png';upper.maskLinked=false;upper.maskPlacement={...transform(8,6),origin:[4,3],rotation:-11,flipY:true};upper.maskDensity=.83
 const mask=new PNG({width:8,height:6});for(let i=0;i<48;i++)mask.data.set([i%5?255:80,i%5?255:80,i%5?255:80,255],i*4)
 const assets=new Map<string,Asset>();for(const value of [assetFor(base,precision),assetFor(upper,precision,8,6),assetFor(hidden,precision==='hdr'?8:precision),makeAsset(upper.maskFile,PNG.sync.write(mask,{colorType:0}))])assets.set(value.file,value)
 const manifest:Manifest={format:'com.compositor.project',version:precision==='hdr'?13:precision===16?12:11,colorSpace:'sRGB',documentID:randomUUID(),resolution:72,width,height,activeLayerID:upper.id,layers:[base,group,upper,hidden],guides:[{id:randomUUID(),axis:'vertical',position:2},{id:randomUUID(),axis:'horizontal',position:12}]}
 const editor=new Editor();editor.importDocument(manifest,assets,'Non-destructive crop fixture')
 return {editor,hidden,assets}
}
function pixels(editor:Editor,precision:Precision){const {manifest,assets}=editor.snapshot();return precision==='hdr'?compositeHDRDocument(manifest,assets).data:compositeDeepDocument(manifest,assets).data}
function apply(editor:Editor,action:EditAction){return editor.apply({...editor.identity(),action})}
function cropAction(extra:Partial<Extract<EditAction,{type:'document.crop'}>>={}):Extract<EditAction,{type:'document.crop'}>{return {type:'document.crop',...crop,deleteCroppedPixels:false,...extra}}
function retained(editor:Editor,before:Map<string,Asset>):void{
 const after=editor.snapshot().assets;assert.equal(after.size,before.size)
 for(const [file,source] of before){const current=after.get(file)!;assert.equal(current.hash,source.hash,file);assert.deepEqual(current.bytes,source.bytes,file);assert.deepEqual(current.deep,source.deep,file);assert.deepEqual(current.hdr,source.hdr,file)}
}
const unsupported=(error:unknown)=>error instanceof EditorError&&error.code==='UNSUPPORTED_FEATURE'

for(const precision of [8,16,'hdr'] as const){
 test(`${precision}: crop hides pixels, preserves sources/masks/hidden metadata, and extending the canvas reveals identical full pixels`,()=>{
  const {editor,assets}=fixture(precision),before=editor.snapshot(),rendered=pixels(editor,precision)
  assert.ok(rendered[3]>0&&rendered.at(-1)!>0,'Opaque original corners must be restored, not only a transparent grid')
  if(precision===16)assert.ok([...assets.values()].some(asset=>asset.deep?.some((sample,i)=>i%4!==3&&sample%257!==0)))
  if(precision==='hdr')assert.ok([...assets.values()].some(asset=>asset.hdr?.some(sample=>sample<0||sample>1)))
  const result=apply(editor,cropAction()),cropped=editor.snapshot().manifest
  assert.equal(result.status,'applied');assert.equal(cropped.width,crop.width);assert.equal(cropped.height,crop.height);retained(editor,assets)
  for(let i=0;i<before.manifest.layers.length;i++){
   const original=before.manifest.layers[i],actual=cropped.layers[i]
   assert.deepEqual(actual,{...original,transform:{...original.transform,origin:[original.transform.origin[0]-crop.x,original.transform.origin[1]-crop.y]},...(original.maskPlacement?{maskPlacement:{...original.maskPlacement,origin:[original.maskPlacement.origin[0]-crop.x,original.maskPlacement.origin[1]-crop.y]}}:{})})
  }
  assert.deepEqual(cropped.guides,before.manifest.guides!.map(guide=>({...guide,position:guide.position-(guide.axis==='vertical'?crop.x:crop.y)})))
  // An inverse canvas extent operation exercises actual rendering, not just source hashes.
  apply(editor,cropAction({x:-crop.x,y:-crop.y,width,height}));assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.deepEqual(pixels(editor,precision),rendered);retained(editor,assets)
  for(let cycle=0;cycle<3;cycle++){apply(editor,cropAction());apply(editor,cropAction({x:-crop.x,y:-crop.y,width,height}))}
  assert.deepEqual(pixels(editor,precision),rendered,'Repeated crops and extensions must not accumulate transform drift')
 })
 test(`${precision}: crop Undo/Redo and cropped save/reopen retain precision and outside-canvas recovery`,async()=>{
  const {editor,assets}=fixture(precision),original=editor.snapshot().manifest,rendered=pixels(editor,precision),result=apply(editor,cropAction()),cropped=editor.snapshot().manifest
  editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot().manifest,original);assert.deepEqual(pixels(editor,precision),rendered);retained(editor,assets)
  editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot().manifest,cropped);retained(editor,assets)
  const dir=await mkdtemp(join(tmpdir(),'crop-nondestructive-'))
  try{
   await editor.saveAs(join(dir,'Cropped.comp'));const reopened=new Editor();await reopened.open(join(dir,'Cropped.comp'));assert.deepEqual(reopened.snapshot().manifest,cropped);retained(reopened,assets)
   apply(reopened,cropAction({x:-crop.x,y:-crop.y,width,height}));assert.deepEqual(reopened.snapshot().manifest,original);assert.deepEqual(pixels(reopened,precision),rendered);retained(reopened,assets)
  }finally{await rm(dir,{recursive:true,force:true})}
 })
}
test('omitted crop flag keeps legacy non-destructive semantics; true is rejected before any staged mutation or history',()=>{
 const {editor,assets}=fixture(16),initial=editor.snapshot().manifest
 apply(editor,cropAction({deleteCroppedPixels:undefined}));const legacy=editor.snapshot().manifest;editor.history({...editor.identity(),direction:'undo'});apply(editor,cropAction());assert.deepEqual(editor.snapshot().manifest,legacy)
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot().manifest,initial)
 const before=editor.state()
 assert.throws(()=>apply(editor,cropAction({deleteCroppedPixels:true})),unsupported);assert.deepEqual(editor.state(),before);retained(editor,assets)
 assert.throws(()=>editor.applyBatch({...editor.identity(),actions:[{type:'layer.rename',layerId:initial.layers[0].id,name:'Must roll back'},cropAction({deleteCroppedPixels:true})]}),unsupported);assert.deepEqual(editor.state(),before);retained(editor,assets)
 assert.throws(()=>apply(editor,cropAction({width:LIMITS.maxSide+1})));assert.deepEqual(editor.state(),before)
})
