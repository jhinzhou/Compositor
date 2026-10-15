import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {makeAsset,makeDeepAsset,makeHDRAsset,loadProject} from '../src/core/project-io'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {imageFilterSchema} from '../src/shared/image-filters'
import type {EditAction,Manifest} from '../src/shared/contracts'
function fixture(depth:8|16|32){const editor=new Editor(),id=randomUUID().toUpperCase(),file=id+(depth===32?'.exr':'.png'),w=8,h=6,png=blankPNG(w,h),deep=new Uint16Array(w*h*4),hdr=new Float32Array(w*h*4)
 for(let p=0;p<w*h;p++){png.data.set([p%2?255:0,50,100,255],p*4);deep.set([p%2?41003:10001,22007,19003,50009],p*4);hdr.set([p%2?3:2,-.125,.5001,.8],p*4)}const asset=depth===32?makeHDRAsset(file,w,h,hdr):depth===16?makeDeepAsset(file,w,h,deep):makeAsset(file,encodeRaster(png)),maskFile=id+'.mask.png',mask=makeAsset(maskFile,encodeRaster(blankPNG(w,h,255),true)),manifest:Manifest={format:'com.compositor.project',version:depth===32?13:depth===16?12:11,colorSpace:'sRGB',documentID:randomUUID(),width:32,height:24,resolution:72,activeLayerID:id,layers:[{id,name:'Progressive',imageFile:file,maskFile,maskLinked:true,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[6,5],size:[8,6],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 editor.importDocument(manifest,new Map([[file,asset],[maskFile,mask]]),'Progressive fixture');return {editor,id,file,asset,maskFile,mask}}
for(const depth of [8,16,32] as const)test(`Progressive Blur ${depth} source preview/commit grown linked mask and exact Undo/Redo`,()=>{
 const {editor,id,file,asset,maskFile,mask}=fixture(depth),before=editor.snapshot(),action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind:'progressiveBlur',from:0,to:1.5,start:[10,5],end:[10,11]})},draft={...editor.snapshot(),selection:null}
 applyPixelAction(draft,action);assert.deepEqual(editor.snapshot(),before);editor.apply({...editor.identity(),action});const after=editor.snapshot(),layer=after.manifest.layers[0],next=after.assets.get(layer.imageFile!)!,carried=after.assets.get(maskFile)!
 assert.deepEqual(after.manifest,draft.manifest);assert.deepEqual(after.assets,draft.assets);assert.ok(next.width>8||next.height>6,'Native blur spreads beyond layer edge');assert.equal(carried.width,next.width);assert.equal(carried.height,next.height);assert.notEqual(carried,mask)
 assert.equal(next.bitDepth??8,depth===8?8:16);if(depth===16)assert.ok(next.deep!.some(v=>v%257!==0));if(depth===32){assert.ok(next.hdr!.some((v,i)=>i%4!==3&&v>1));assert.ok(next.hdr!.some(v=>v<0))}
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before);assert.equal(editor.snapshot().assets.get(file),asset);editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})
for(const depth of [16,32] as const)test(`Progressive Blur ${depth} selection protects source pixels and no-radius has no growth`,()=>{
 const {editor,id,asset}=fixture(depth),empty={...editor.snapshot(),selection:{shapes:[],inverted:false}},action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind:'progressiveBlur',to:2})};applyPixelAction(empty,action);assert.equal(empty.assets.get(empty.manifest.layers[0].imageFile!),asset)
 const before=editor.snapshot();editor.apply({...editor.identity(),action:{...action,filter:imageFilterSchema.parse({kind:'progressiveBlur',from:0,to:0})}});assert.deepEqual(editor.snapshot().manifest,before.manifest);assert.equal(editor.snapshot().assets.get(editor.snapshot().manifest.layers[0].imageFile!),asset)
})
test('Progressive Blur 16/HDR source and document placement survive save/reopen',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'progressive-filter-'));try{for(const depth of [16,32] as const){const {editor,id}=fixture(depth);editor.apply({...editor.identity(),action:{type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind:'progressiveBlur',from:.5,to:2,start:[10,5],end:[10,11],radial:true})}});const before=editor.snapshot(),path=join(dir,`${depth}.comp`);await editor.saveAs(path);const reopened=await loadProject(path),layer=before.manifest.layers[0],a=before.assets.get(layer.imageFile!)!,b=reopened.assets.get(layer.imageFile!)!;assert.deepEqual(reopened.manifest,editor.snapshot().manifest);assert.deepEqual(a.deep,b.deep);if(depth===32)for(let i=0;i<a.hdr!.length;i++)assert.ok(Math.abs(a.hdr![i]-b.hdr![i])<3e-6)}}finally{await rm(dir,{recursive:true,force:true})}
})
for(const depth of [8,16,32] as const)test(`Progressive Blur ${depth} explicit selection preserves outside source samples after growth`,()=>{
 const {editor,id,asset}=fixture(depth),selection={shapes:[{kind:'rectangle' as const,bounds:[6,5,4,6] as [number,number,number,number],feather:0,operation:'replace' as const}],inverted:false},draft={...editor.snapshot(),selection},action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind:'progressiveBlur',from:0,to:2,start:[10,5],end:[10,11]})}
 applyPixelAction(draft,action);const layer=draft.manifest.layers[0],next=draft.assets.get(layer.imageFile!)!,x=13-layer.transform.origin[0],y=8-layer.transform.origin[1],at=(y*next.width+x)*4,original=(3*8+7)*4
 if(depth===8){assert.deepEqual(PNG.sync.read(next.bytes).data.subarray(at,at+4),PNG.sync.read(asset.bytes).data.subarray(original,original+4))}
 else assert.deepEqual((depth===32?next.hdr!:next.deep!).subarray(at,at+4),(depth===32?asset.hdr!:asset.deep!).subarray(original,original+4))
})
