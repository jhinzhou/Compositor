import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writePsdBuffer} from 'ag-psd'
import {imageFilterSchema,curveValue,applyImageFilter,nativeAdjustmentToSpec,specToNativeAdjustment} from '../src/shared/image-filters'
import {applyDeepColorFilter} from '../src/shared/deep-color-filters'
import {applyHDRColorFilter} from '../src/shared/hdr-pixels'
import {photoshopAdjustment,exportPhotoshopAdjustment} from '../src/core/photoshop-adjustments'
import {decodePhotoshop} from '../src/core/photoshop-io'
import {makeDeepAsset,makeHDRAsset} from '../src/core/project-io'
import {Editor} from '../src/core/editor'
import type {Manifest,EditAction} from '../src/shared/contracts'

const identity=()=>[{x:0,y:0},{x:255,y:255}]
const endpoints=[{x:16,y:0},{x:239,y:255}]
const filter=imageFilterSchema.parse({kind:'curves',channels:[endpoints,identity(),identity(),identity()]})
test('horizontal black and white inputs clip beyond endpoints and preserve linear interior',()=>{
 for(const [x,expected] of [[0,0],[16,0],[127.5,127.5],[239,255],[255,255]])assert.equal(curveValue(endpoints,x),expected)
 const source={width:4,height:1,data:Uint8ClampedArray.from([0,16,239,255,255,127,128,255,32,32,32,127,0,0,0,0])},before=source.data.slice(),output=applyImageFilter(source,filter)
 assert.deepEqual([...output.data.slice(0,8)],[0,0,255,255,255,127,128,255]);assert.equal(output.data[11],127);assert.deepEqual(source.data,before)
})
test('endpoint outputs can lift black/lower white while reversed output curves still work',()=>{
 const points=[{x:32,y:220},{x:224,y:35}]
 assert.equal(curveValue(points,0),220);assert.equal(curveValue(points,255),35);assert.equal(curveValue(points,128),127.5)
 for(let x=0;x<=255;x++)assert.ok(curveValue(points,x)>=35&&curveValue(points,x)<=220)
 for(const bad of [[{x:32,y:0},{x:32,y:255}],[{x:239,y:255},{x:16,y:0}],[{x:-1,y:0},{x:239,y:255}]])assert.equal(imageFilterSchema.safeParse({kind:'curves',channels:[bad,identity(),identity(),identity()]}).success,false)
})
test('a diagonal with horizontal endpoints is not mistaken for full-range identity in source16',()=>{
 const source=Uint16Array.from([1001,50000,65535,65535]),before=source.slice(),result=applyDeepColorFilter(source,1,1,{kind:'curves',channels:[[{x:32,y:32},{x:224,y:224}],identity(),identity(),identity()]})
 assert.deepEqual(result,Uint16Array.from([32*257,50000,224*257,65535]));assert.deepEqual(source,before)
})
test('source16 endpoint mapping preserves between-byte values and original premultiplied alpha',()=>{
 const source=Uint16Array.from([1001,30001,60003,65535,0,8192,16000,16384]),copy=source.slice(),out=applyDeepColorFilter(source,2,1,filter)
 assert.equal(out[0],0);assert.equal(out[3],65535);assert.equal(out[7],16384);assert.equal(out[4],0);assert.ok(out[1]%257!==0)
 for(let at=0;at<source.length;at+=4)for(let c=0;c<3;c++){const v=source[at+c]/source[at+3]*255,expected=v<=16?0:v>=239?source[at+3]:(v-16)/(239-16)*source[at+3];assert.equal(out[at+c],Math.round(expected))}
 assert.deepEqual(source,copy)
})
test('HDR endpoint curves retain highlight scale through the existing normalized16 bridge',()=>{
 const source=Float32Array.from([4,2,0,1]),copy=source.slice(),out=applyHDRColorFilter(source,1,1,filter)
 assert.equal(out[0],4);assert.equal(out[2],0);assert.equal(out[3],1);assert.ok(Math.abs(out[1]-2)<.0002);assert.deepEqual(source,copy)
})
test('PSD editable curves preserve the exact horizontal endpoints through adapter and binary records',()=>{
 const record={type:'curves' as const,rgb:endpoints.map(p=>({input:p.x,output:p.y}))},native=photoshopAdjustment(record)!,spec=nativeAdjustmentToSpec(native)
 assert.equal(spec.kind,'curves');if(spec.kind==='curves')assert.deepEqual(spec.channels[0],endpoints)
 assert.deepEqual((exportPhotoshopAdjustment(native) as typeof record).rgb,record.rgb)
 const bytes=writePsdBuffer({width:4,height:2,children:[{name:'Horizontal endpoints',adjustment:exportPhotoshopAdjustment(native)}]},{noBackground:true}),decoded=decodePhotoshop(bytes),reopened=nativeAdjustmentToSpec(decoded.manifest.layers[0].adjustment)
 assert.equal(reopened.kind,'curves');if(reopened.kind==='curves')assert.deepEqual(reopened.channels[0],endpoints)
})
for(const depth of ['16','HDR'] as const)test(`${depth} horizontal curves command Undo/Redo restores exact original source and adjustment settings`,()=>{
 const editor=new Editor(),id=randomUUID().toUpperCase(),file=`${id}.${depth==='HDR'?'exr':'png'}`,asset=depth==='HDR'?makeHDRAsset(file,2,1,Float32Array.from([4,2,0,1,.5,.2,.1,.5])):makeDeepAsset(file,2,1,Uint16Array.from([1001,30001,60003,65535,0,8192,16000,16384])),manifest:Manifest={format:'com.compositor.project',version:depth==='HDR'?13:12,colorSpace:'sRGB',documentID:randomUUID(),width:2,height:1,resolution:72,activeLayerID:id,layers:[{id,name:'Input',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[2,1],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}}]}
 editor.importDocument(manifest,new Map([[file,asset]]),'Curves endpoint test')
 const image=()=>{const snapshot=editor.snapshot();return snapshot.assets.get(snapshot.manifest.layers[0].imageFile!)!},apply=(action:EditAction)=>editor.apply({...editor.identity(),action}),history=(direction:'undo'|'redo')=>editor.history({...editor.identity(),direction})
 apply({type:'layer.filter',layerId:id,filter});const changed=image();assert.notEqual(changed,asset);assert.notDeepEqual(changed.hdr??changed.deep,asset.hdr??asset.deep)
 history('undo');assert.equal(image(),asset);history('redo');assert.equal(image(),changed)
 apply({type:'adjustment.add',name:'Endpoint curves',filter});assert.deepEqual(editor.state().manifest.layers.at(-1)!.adjustment,specToNativeAdjustment(filter))
 history('undo');assert.equal(editor.state().manifest.layers.length,1);history('redo');assert.deepEqual(editor.state().manifest.layers.at(-1)!.adjustment,specToNativeAdjustment(filter))
})
