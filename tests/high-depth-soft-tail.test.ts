import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import type {EditAction,Manifest} from '../src/shared/contracts'

for(const hdr of [false,true])test(`${hdr?'HDR':'RGBA16'} Photoshop soft tail grows past nominal brush radius with precise preview/commit and source Undo`,()=>{
 const editor=new Editor(),id=randomUUID().toUpperCase(),width=8,height=8,file=`${id}.${hdr?'exr':'png'}`,pixels=hdr?new Float32Array(width*height*4):new Uint16Array(width*height*4)
 for(let at=0;at<pixels.length;at+=4)pixels.set(hdr?[2,-.25,.5,1]:[10001,20002,30003,65535],at)
 const original=pixels.slice(),asset=hdr?makeHDRAsset(file,width,height,pixels as Float32Array):makeDeepAsset(file,width,height,pixels as Uint16Array),manifest:Manifest={format:'com.compositor.project',version:hdr?13:12,colorSpace:'sRGB',documentID:randomUUID(),width:128,height:128,resolution:72,activeLayerID:id,layers:[{id,name:'Soft tail source',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[60,60],size:[8,8],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 editor.importDocument(manifest,new Map([[file,asset]]),'Soft tail source')
 const action:EditAction={type:'layer.paint',layerId:id,points:[[64.5,64.5],[64.51,64.5]],size:32,hardness:0,brushModel:'photoshop',spacing:.25,flow:1,color:[.9,.1,.3,.8],opacity:.1,erase:false,target:'image'},before=editor.snapshot(),draft={...before,manifest:structuredClone(before.manifest),assets:new Map(before.assets),selection:null}
 applyPixelAction(draft,action);editor.apply({...editor.identity(),action})
 const snapshot=editor.snapshot(),layer=snapshot.manifest.layers[0],actual=snapshot.assets.get(layer.imageFile!)!,preview=draft.assets.get(draft.manifest.layers[0].imageFile!)!,result=hdr?actual.hdr!:actual.deep!,x=85-layer.transform.origin[0],y=64-layer.transform.origin[1],at=(y*actual.width+x)*4
 assert.ok(x>=0&&y>=0&&x<actual.width&&y<actual.height,'tail outside nominal radius must remain inside grown source')
 const coverage=brushStrokeCoverage({width:128,height:128,transform:{origin:[0,0],size:[128,128],rotation:0,flipX:false,flipY:false,sampling:'High quality'}},action.points,32,0,{brushModel:'photoshop',spacing:.25,flow:1}),alpha=coverage[64*128+85]/255*.8*.1
 assert.ok(alpha>0&&alpha<1/255,'diagnostic tail is below an 8-bit alpha step but positive in source precision')
 const write=hdr?Math.fround:Math.round,scale=hdr?1:65535
 assert.deepEqual([...result.subarray(at,at+4)],[write(.9*alpha*scale),write(.1*alpha*scale),write(.3*alpha*scale),write(alpha*scale)])
 assert.deepEqual(actual.bytes,preview.bytes);assert.deepEqual(actual.deep,preview.deep);assert.deepEqual(actual.hdr,preview.hdr);assert.deepEqual(layer.transform,draft.manifest.layers[0].transform);assert.deepEqual(pixels,original)
 editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.snapshot().assets.get(file),asset);assert.deepEqual(editor.state().manifest,manifest)
 editor.history({...editor.identity(),direction:'redo'});assert.equal(editor.snapshot().assets.get(layer.imageFile!),actual)
})

for(const hdr of [false,true])for(const erase of [false,true])test(`${hdr?'HDR':'RGBA16'} subpixel-width Photoshop shoulder and compound Flow preserve source precision through preview and Undo (${erase?'erase':'paint'})`,()=>{
 const e=new Editor(),id=randomUUID().toUpperCase(),file=`${id}.${hdr?'exr':'png'}`,pixels=hdr?new Float32Array(8*8*4):new Uint16Array(8*8*4)
 for(let i=0;i<pixels.length;i+=4)pixels.set(hdr?[2,-.25,.5,1]:[10001,20002,30003,65535],i)
 const asset=hdr?makeHDRAsset(file,8,8,pixels as Float32Array):makeDeepAsset(file,8,8,pixels as Uint16Array),manifest:Manifest={format:'com.compositor.project',version:hdr?13:12,colorSpace:'sRGB',documentID:randomUUID(),width:128,height:128,resolution:72,activeLayerID:id,layers:[{id,name:'Pixel shoulder',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[60,60],size:[8,8],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 e.importDocument(manifest,new Map([[file,asset]]),'Pixel shoulder')
 const action:EditAction={type:'layer.paint',layerId:id,points:[[62,64],[67,64],[62,64]],size:8,hardness:.5,brushModel:'photoshop',spacing:.1,flow:.2,color:[.9,.1,.3,.7],opacity:.001,erase,target:'image'},before=e.snapshot(),draft={...e.snapshot(),selection:null}
 applyPixelAction(draft,action);e.apply({...e.identity(),action});const after=e.snapshot(),layer=after.manifest.layers[0],actual=after.assets.get(layer.imageFile!)!,preview=draft.assets.get(draft.manifest.layers[0].imageFile!)!,source=hdr?actual.hdr!:actual.deep!,index=((64-layer.transform.origin[1])*actual.width+64-layer.transform.origin[0])*4
 const coverage=brushStrokeCoverage({width:128,height:128,transform:{origin:[0,0],size:[128,128],rotation:0,flipX:false,flipY:false,sampling:'High quality'}},action.points,8,.5,{brushModel:'photoshop',spacing:.1,flow:.2}),alpha=coverage[64*128+64]/255*.7*.001,scale=hdr?1:65535,original=hdr?[2,-.25,.5,1]:[10001,20002,30003,65535],round=hdr?Math.fround:Math.round,color=[.9,.1,.3,1]
 const expected=original.map((value,i)=>round(value*(1-alpha)+(erase?0:color[i]*alpha*scale)))
 assert.deepEqual([...source.subarray(index,index+4)],expected);assert.notDeepEqual(expected,original,'Low-opacity source changes must survive beyond PNG8 precision')
 if(hdr)assert.ok(source[index+1]<0,'Signed float color remains signed')
 assert.deepEqual(actual.bytes,preview.bytes);assert.deepEqual(actual.deep,preview.deep);assert.deepEqual(actual.hdr,preview.hdr);assert.deepEqual(e.snapshot().manifest,draft.manifest)
 e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before);assert.equal(e.snapshot().assets.get(file),asset);e.history({...e.identity(),direction:'redo'});assert.deepEqual(e.snapshot(),after)
})
