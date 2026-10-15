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
import {EditorError,type EditAction,type Manifest} from '../src/shared/contracts'
function fixture(depth:8|16|32){
 const editor=new Editor(),id=randomUUID().toUpperCase(),file=id+(depth===32?'.exr':'.png'),width=4,height=2,png=blankPNG(width,height),deep=new Uint16Array(width*height*4),hdr=new Float32Array(width*height*4)
 for(let p=0;p<width*height;p++){png.data.set([40+p*25,180-p*12,80+p*7,199],p*4);deep.set([12502+p*7,25103+p*9,37507-p*11,50009],p*4);hdr.set([3.125,-.125,.5001,.8],p*4)}
 const asset=depth===32?makeHDRAsset(file,width,height,hdr):depth===16?makeDeepAsset(file,width,height,deep):makeAsset(file,encodeRaster(png)),maskFile=id+'.mask.png',mask=makeAsset(maskFile,encodeRaster(blankPNG(width,height,255),true)),manifest:Manifest={format:'com.compositor.project',version:depth===32?13:depth===16?12:11,colorSpace:'sRGB',documentID:randomUUID(),width:12,height:10,resolution:72,activeLayerID:id,layers:[{id,name:'Discrete adjustment',imageFile:file,maskFile,maskLinked:true,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[3,2],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 editor.importDocument(manifest,new Map([[file,asset],[maskFile,mask]]),'Discrete adjustment fixture');return {editor,id,file,asset,maskFile,mask}
}
for(const depth of [8,16] as const)for(const kind of ['threshold','posterize'] as const)test(`${kind} ${depth} preview/commit agreement, source/mask retention and exact Undo/Redo`,()=>{
 const {editor,id,file,asset,maskFile,mask}=fixture(depth),before=editor.snapshot(),draft={...editor.snapshot(),selection:null},action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind})}
 applyPixelAction(draft,action);assert.deepEqual(editor.snapshot(),before)
 editor.apply({...editor.identity(),action});const after=editor.snapshot(),next=after.assets.get(after.manifest.layers[0].imageFile!)!
 assert.deepEqual(after.manifest,draft.manifest);assert.deepEqual(after.assets,draft.assets);assert.notDeepEqual(next.bytes,asset.bytes);assert.equal(after.assets.get(maskFile),mask);assert.deepEqual(after.manifest.layers[0].transform,before.manifest.layers[0].transform)
 if(depth===16){for(let p=0;p<8;p++)assert.equal(next.deep![p*4+3],50009);assert.equal(next.bitDepth,16)}
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.snapshot(),before);assert.equal(editor.snapshot().assets.get(file),asset)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})
for(const depth of [8,16] as const)for(const kind of ['threshold','posterize'] as const)test(`${kind} ${depth} selected half protects all outside samples`,()=>{
 const {editor,id,asset}=fixture(depth),draft={...editor.snapshot(),selection:{shapes:[{kind:'rectangle' as const,bounds:[3,2,2,2] as [number,number,number,number],feather:0,operation:'replace' as const}],inverted:false}},action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind})}
 applyPixelAction(draft,action);const next=draft.assets.get(draft.manifest.layers[0].imageFile!)!,original=depth===16?asset.deep!:PNG.sync.read(asset.bytes).data,output=depth===16?next.deep!:PNG.sync.read(next.bytes).data
 for(let y=0;y<2;y++)for(let x=2;x<4;x++){const at=(y*4+x)*4;assert.deepEqual(output.subarray(at,at+4),original.subarray(at,at+4))}
})
for(const kind of ['threshold','posterize'] as const)test(`HDR ${kind} preview/commit/batch refusal is atomic`,()=>{
 const {editor,id,asset}=fixture(32),before=editor.state(),copy=asset.hdr!.slice(),action:EditAction={type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind})}
 for(const run of [()=>applyPixelAction({...editor.snapshot(),selection:null},action),()=>editor.apply({...editor.identity(),action}),()=>editor.applyBatch({...editor.identity(),actions:[{type:'layer.set_opacity',layerId:id,opacity:.5},action],label:'Unsupported HDR adjustment'})])assert.throws(run,e=>e instanceof EditorError&&e.code==='UNSUPPORTED_FEATURE')
 assert.deepEqual(editor.state(),before);assert.deepEqual(asset.hdr,copy);assert.equal(editor.snapshot().assets.get(editor.snapshot().manifest.layers[0].imageFile!),asset)
})
test('discretized RGB16 source preserves exact alpha and values across project save/reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'discrete-adjustments-'));try{for(const kind of ['threshold','posterize'] as const){const {editor,id}=fixture(16);editor.apply({...editor.identity(),action:{type:'layer.filter',layerId:id,filter:imageFilterSchema.parse({kind, ...(kind==='posterize'?{levels:3}:{})})}});const path=join(directory,kind+'.comp');await editor.saveAs(path);const before=editor.snapshot(),loaded=await loadProject(path),file=before.manifest.layers[0].imageFile!;assert.deepEqual(loaded.assets.get(file)!.deep,before.assets.get(file)!.deep);assert.deepEqual(loaded.manifest,before.manifest)}}finally{await rm(directory,{recursive:true,force:true})}
})
