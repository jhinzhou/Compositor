import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import type {EditAction,Manifest} from '../src/shared/contracts'
for(const hdr of [false,true])for(const erase of [false,true])test(`alpha21 near-hard ring ${hdr?'HDR':'RGB16'} ${erase?'erase':'paint'} retains precision, preview and full Undo`,()=>{
 const e=new Editor(),id=randomUUID().toUpperCase(),file=`${id}.${hdr?'exr':'png'}`,pixels=hdr?new Float32Array(64*64*4):new Uint16Array(64*64*4),original=hdr?[2,-.25,.5,1]:[10001,20002,30003,65535]
 for(let i=0;i<pixels.length;i+=4)pixels.set(original,i)
 const asset=hdr?makeHDRAsset(file,64,64,pixels as Float32Array):makeDeepAsset(file,64,64,pixels as Uint16Array),manifest:Manifest={format:'com.compositor.project',version:hdr?13:12,colorSpace:'sRGB',documentID:randomUUID(),width:128,height:128,resolution:72,activeLayerID:id,layers:[{id,name:'Near-hard precision',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[32,32],size:[64,64],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}]}
 e.importDocument(manifest,new Map([[file,asset]]),'Near-hard precision')
 const action:EditAction={type:'layer.paint',layerId:id,points:[[48,64],[80,64],[48,64]],size:64,hardness:.95,brushModel:'photoshop',spacing:.2,flow:.2,color:[.9,.1,.3,.7],opacity:.001,erase,target:'image'},before=e.snapshot(),draft={...e.snapshot(),selection:null}
 applyPixelAction(draft,action);e.apply({...e.identity(),action});const after=e.snapshot(),layer=after.manifest.layers[0],actual=after.assets.get(layer.imageFile!)!,preview=draft.assets.get(draft.manifest.layers[0].imageFile!)!,source=hdr?actual.hdr!:actual.deep!,index=((95-layer.transform.origin[1])*actual.width+64-layer.transform.origin[0])*4
 const coverage=brushStrokeCoverage({width:128,height:128,transform:{origin:[0,0],size:[128,128],rotation:0,flipX:false,flipY:false,sampling:'High quality'}},action.points,64,.95,{brushModel:'photoshop',spacing:.2,flow:.2}),alpha=coverage[95*128+64]/255*.7*.001,scale=hdr?1:65535,round=hdr?Math.fround:Math.round,color=[.9,.1,.3,1]
 assert.ok(alpha>0&&alpha<1/255,'Ring coverage survives below PNG8 precision')
 const expected=original.map((value,i)=>round(value*(1-alpha)+(erase?0:color[i]*alpha*scale)))
 assert.deepEqual([...source.subarray(index,index+4)],expected);assert.notDeepEqual(expected,original)
 assert.deepEqual(actual.deep,preview.deep);assert.deepEqual(actual.hdr,preview.hdr);assert.deepEqual(actual.bytes,preview.bytes)
 if(hdr)assert.ok(source[index+1]<0)
 e.history({...e.identity(),direction:'undo'});assert.deepEqual(e.snapshot(),before);assert.equal(e.snapshot().assets.get(file),asset);e.history({...e.identity(),direction:'redo'});assert.deepEqual(e.snapshot(),after)
})
