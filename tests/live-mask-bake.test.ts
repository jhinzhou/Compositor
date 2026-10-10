import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PNG} from 'pngjs'
import {bakeExternalClipping} from '../src/core/live-mask-bake'
import {captureLayerClipboard} from '../src/core/layer-operations'
import {makeAsset,type Asset} from '../src/core/project-io'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {Editor} from '../src/core/editor'
import type {Layer,Manifest} from '../src/shared/contracts'
const targetID='00000000-0000-4000-8000-000000000001',sourceID='00000000-0000-4000-8000-000000000002',baseID='00000000-0000-4000-8000-000000000003',folderID='00000000-0000-4000-8000-000000000004'
const transform:Layer['transform']={origin:[0,0],size:[8,6],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}
function layer(id:string):Layer{return {id,name:id,imageFile:`${id.toUpperCase()}.png`,transform:structuredClone(transform),isGroup:false,isVisible:true,opacity:1,blendMode:'Normal'}}
function scene(){const target=layer(targetID),source=layer(sourceID),base=layer(baseID),folder={...layer(folderID),isGroup:true,imageFile:undefined};target.maskSourceID=sourceID
 const manifest:Manifest={format:'com.compositor.project',version:11,documentID:'00000000-0000-4000-8000-000000000005',width:8,height:6,resolution:72,colorSpace:'sRGB',activeLayerID:targetID,layers:[target,source,base,folder]},assets=new Map<string,Asset>()
 const add=(layer:Layer,data:number[])=>{const png=blankPNG(8,6);png.data.set(data);assets.set(layer.imageFile!,makeAsset(layer.imageFile!,PNG.sync.write(png)))}
 return {manifest,assets,target,source,base,folder,add}
}
test('external live clipping alpha matches ten independent original LiveMaskBaker/Core Graphics references',async()=>{
 const fixture=JSON.parse(await readFile('fixtures/parity/native-1.4.8-live-mask.json','utf8'));assert.equal(fixture.rows.length,10)
 for(const row of fixture.rows){const s=scene();s.target.transform=row.targetTransform;s.target.opacity=.2;s.source.transform=row.sourceTransform;s.source.opacity=row.mode===1?.5:1;s.base.opacity=.6;s.folder.opacity=.5;if(row.mode===2)s.source.maskSourceID=baseID;if(row.mode===5)s.source.parentID=folderID;s.source.isVisible=false
 s.add(s.target,row.target);s.add(s.source,row.source);s.add(s.base,row.base)
 const masked=row.mode===3||row.mode===4?s.source:row.mode===6?s.target:undefined;if(masked){masked.maskFile=`${masked.id.toUpperCase()}.mask.png`;masked.maskEnabled=row.mode!==4;masked.maskLinked=true;s.assets.set(masked.maskFile,makeAsset(masked.maskFile,encodeRaster(blankPNG(1,1,row.mode===6?0:128),true)))}
 const clipboard=captureLayerClipboard(s.manifest,[targetID]),before=structuredClone(clipboard),oldHash=s.assets.get(s.target.imageFile!)!.hash,result=bakeExternalClipping(s.manifest,s.assets,clipboard),png=PNG.sync.read(result.assets.get(s.target.imageFile!)!.bytes)
 let maximum=0;for(let i=0;i<row.expectedAlpha.length;i++)maximum=Math.max(maximum,Math.abs(png.data[i*4+3]-row.expectedAlpha[i]));assert.ok(maximum<=1,`mode ${row.mode} max delta ${maximum}`)
 assert.equal(result.metadata.layers[0].maskSourceID,undefined);assert.deepEqual({...result.metadata.layers[0],maskSourceID:sourceID},before.layers[0]);assert.deepEqual(clipboard,before);assert.equal(s.assets.get(s.target.imageFile!)!.hash,oldHash);if(masked===s.target)assert.equal(result.assets.get(masked.maskFile!),s.assets.get(masked.maskFile!))
 }
})
test('copied internal links retain editable dependency graph while only missing outside roots are baked',()=>{
 const s=scene();s.source.maskSourceID=baseID;for(const l of [s.target,s.source,s.base])s.add(l,Array.from({length:48},()=>[255,0,0,128]).flat())
 const metadata=captureLayerClipboard(s.manifest,[targetID,sourceID]),result=bakeExternalClipping(s.manifest,s.assets,metadata)
 assert.equal(result.metadata.layers.find(l=>l.id===targetID)!.maskSourceID,sourceID);assert.equal(result.metadata.layers.find(l=>l.id===sourceID)!.maskSourceID,undefined);assert.equal(result.assets.get(s.target.imageFile!),s.assets.get(s.target.imageFile!));assert.notEqual(result.assets.get(s.source.imageFile!)!.hash,s.assets.get(s.source.imageFile!)!.hash)
 const all=bakeExternalClipping(s.manifest,s.assets,captureLayerClipboard(s.manifest,[targetID,sourceID,baseID]));assert.deepEqual(all.metadata.layers,s.manifest.layers.slice(0,3));assert.equal(all.assets.get(s.source.imageFile!),s.assets.get(s.source.imageFile!))
})
test('independent source masks use document placement, dominant outside tone and source visibility is ignored',()=>{
 const s=scene();for(const l of [s.target,s.source,s.base])s.add(l,Array.from({length:48},()=>[255,0,0,255]).flat());s.source.isVisible=false;s.source.maskFile=`${sourceID.toUpperCase()}.mask.png`;s.source.maskEnabled=true;s.source.maskPlacement={...transform,origin:[2,1],size:[2,2]};const mask=blankPNG(2,2,0);mask.data.set([255,255,255,255],0);s.assets.set(s.source.maskFile,makeAsset(s.source.maskFile,encodeRaster(mask,true)))
 const result=bakeExternalClipping(s.manifest,s.assets,captureLayerClipboard(s.manifest,[targetID])),png=PNG.sync.read(result.assets.get(s.target.imageFile!)!.bytes);assert.equal(png.data[(1*8+2)*4+3],255);assert.equal(png.data[(0*8+0)*4+3],0);assert.equal(png.data[(1*8+3)*4+3],0)
 s.base.maskSourceID=sourceID;s.source.maskSourceID=baseID;assert.throws(()=>bakeExternalClipping(s.manifest,s.assets,captureLayerClipboard(s.manifest,[targetID])),/Cyclic/);s.source.maskSourceID=undefined;s.assets.delete(s.source.imageFile!);assert.throws(()=>bakeExternalClipping(s.manifest,s.assets,captureLayerClipboard(s.manifest,[targetID])),/Missing/)
})
test('baked pixels paste through a genuine cross-document editor transaction with exact undo/redo assets',()=>{
 const source=new Editor();source.importPNG(PNG.sync.write(blankPNG(8,6,128)),'Base');const base=source.state().manifest.activeLayerID!;source.importPNG(PNG.sync.write(blankPNG(8,6,255)),'Target');const target=source.state().manifest.activeLayerID!;source.apply({...source.identity(),action:{type:'layer.set_clipping',layerId:target,sourceId:base}});source.apply({...source.identity(),action:{type:'layer.set_opacity',layerId:base,opacity:.5}})
 const snapshot=source.snapshot(),prepared=bakeExternalClipping(snapshot.manifest,snapshot.assets,captureLayerClipboard(snapshot.manifest,[target])),destination=new Editor();destination.create(16,12);const before=destination.snapshot(),transaction=destination.paste(destination.identity(),prepared.metadata,prepared.assets),after=destination.snapshot();assert.equal(after.manifest.layers.length,1);const pasted=after.manifest.layers[0];assert.equal(pasted.maskSourceID,undefined);assert.equal(PNG.sync.read(after.assets.get(pasted.imageFile!)!.bytes).data[3],128)
 destination.history({...destination.identity(),direction:'undo',transactionId:transaction.transactionId});assert.deepEqual(destination.snapshot().manifest,before.manifest);assert.equal(destination.snapshot().assets.size,0);destination.history({...destination.identity(),direction:'redo'});assert.deepEqual(destination.snapshot().manifest,after.manifest);assert.deepEqual(destination.snapshot().assets,after.assets)
})
