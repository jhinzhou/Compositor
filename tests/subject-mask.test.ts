import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {prepareSubjectMask} from '../src/core/subject-mask'
import {refineSubjectMatte} from '../src/shared/subject-matte'
import {actionSchema} from '../src/shared/contracts'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {makeAsset} from '../src/core/project-io'
import type {EditAction,Layer} from '../src/shared/contracts'
const apply=(editor:Editor,action:EditAction)=>editor.apply({...editor.identity(),action})
function layer():Layer {return {id:'7AC00889-AAB5-411C-8307-3111408EDD56',name:'source',isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[1,1],size:[4,2],rotation:0,flipX:true,flipY:false,sampling:'Nearest'}}}
test('subject mask maps document pixels through flipped placement and modifies only the selected coverage of an existing source-grid mask',()=>{
 const input={...layer(),maskFile:'old.mask.png',maskLinked:false,maskEnabled:false},original=structuredClone(input),old=blankPNG(2,1);old.data.set([128,128,128,255,200,200,200,255]);const oldAsset=makeAsset(input.maskFile,encodeRaster(old,true)),coverage=new Uint8Array(5*4);coverage[2*5+4]=128
 const result=prepareSubjectMask(input,{width:2,height:1},{width:5,height:4,coverage},{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,3,4],feather:0}]},'document',oldAsset),png=PNG.sync.read(result.bytes)
 assert.deepEqual([png.data[0],png.data[4]],[128,0]);assert.equal(result.layer.maskEnabled,true);assert.equal(result.layer.maskLinked,false);assert.equal(result.layer.maskPlacement,undefined);assert.equal(result.bytes[25],0);assert.deepEqual(input,original);assert.deepEqual(PNG.sync.read(oldAsset.bytes).data,old.data)
})
test('independent placed masks retain their link and transform metadata while source-grid matte replaces incompatible old samples',()=>{
 const input={...layer(),maskFile:'old.mask.png',maskLinked:false,maskPlacement:{...layer().transform,origin:[8,9] as [number,number]}},old=makeAsset(input.maskFile,encodeRaster(blankPNG(2,1,64),true))
 const result=prepareSubjectMask(input,{width:2,height:1},{width:2,height:1,coverage:new Uint8Array([128,255])},null,'source',old),png=PNG.sync.read(result.bytes)
 assert.deepEqual([png.data[0],png.data[4]],[128,255]);assert.deepEqual(result.layer.maskPlacement,input.maskPlacement);assert.equal(result.layer.maskLinked,false);assert.notEqual(result.layer.maskPlacement,input.maskPlacement)
 const uniform=makeAsset(input.maskFile,encodeRaster(blankPNG(1,1,64),true)),unplaced={...input};delete (unplaced as Layer).maskPlacement
 assert.deepEqual([...PNG.sync.read(prepareSubjectMask(unplaced,{width:2,height:1},{width:2,height:1,coverage:new Uint8Array([128,255])},null,'source',uniform).bytes).data].filter((_,i)=>i%4===0),[128,255])
})
test('new subject masks link to the layer, feathered selection blends the matte, and invalid existing mask references fail',()=>{
 const input=layer(),selection={inverted:false,shapes:[{kind:'rectangle' as const,operation:'replace' as const,bounds:[1,1,2,2] as [number,number,number,number],feather:1}]},result=prepareSubjectMask(input,{width:2,height:1},{width:2,height:1,coverage:new Uint8Array([0,0])},selection),png=PNG.sync.read(result.bytes)
 assert.equal(result.layer.maskLinked,true);assert.equal(result.layer.maskPlacement,undefined);assert.ok(png.data[4]>0&&png.data[4]<255);assert.ok(png.data[0]>png.data[4]);assert.equal(input.maskFile,undefined)
 assert.throws(()=>prepareSubjectMask({...input,maskFile:'missing'},{width:2,height:1},{width:2,height:1,coverage:new Uint8Array(2)},null),/mask is missing/)
 assert.throws(()=>prepareSubjectMask(input,{width:2,height:1},{width:3,height:1,coverage:new Uint8Array(3)},null),/does not match/)
})
test('subject mask preview helper produces the exact committed asset and metadata, including selection and placement, then undo restores both',()=>{
 for(const independent of [false,true]){
  const editor=new Editor();editor.create(8,6);editor.importPNG(encodeRaster(blankPNG(2,1,255)),'source');const id=editor.state().manifest.activeLayerID!;apply(editor,{type:'document.canvas_size',width:8,height:6,anchor:'top-left'});apply(editor,{type:'layer.set_transform',layerId:id,transform:layer().transform});apply(editor,{type:'layer.mask',layerId:id,operation:'reveal'});if(independent){apply(editor,{type:'layer.mask',layerId:id,operation:'unlink'});apply(editor,{type:'layer.mask_set_placement',layerId:id,transform:{...layer().transform,origin:[2,3]}})}apply(editor,{type:'selection.set',selection:{inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[1,1,3,3],feather:1}]}})
  const before=editor.snapshot(),selected=before.manifest.layers[0],source=before.assets.get(selected.imageFile!)!,mask={width:2,height:1,coverage:new Uint8Array([51,204])},expected=prepareSubjectMask(selected,source,mask,editor.state().selection!,'source',before.assets.get(selected.maskFile!)),result=editor.commitPrepared({...editor.identity(),action:{type:'selection.subject',layerId:id,removeBackground:true}},{coverage:mask}),after=editor.snapshot()
  assert.deepEqual(after.manifest.layers[0],expected.layer);assert.deepEqual(after.assets.get(expected.file)!.bytes,expected.bytes);assert.deepEqual(after.assets.get(selected.imageFile!),source);editor.history({...editor.identity(),direction:'undo',transactionId:result.transactionId});assert.deepEqual(editor.snapshot(),before)
 }
})

test('color/feather action parameters survive schema and give identical preview and committed masks',()=>{
 const width=25,height=3,png=blankPNG(width,height,255),coarse={width,height,coverage:new Uint8Array(width*height)}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;png.data.set(x<12?[255,0,0,255]:[0,76,0,255],i*4);coarse.coverage[i]=x<8?0:x>16?255:Math.round((x-8)/8*255)}
 const editor=new Editor();editor.create(width,height);editor.importPNG(encodeRaster(png),'colored edge');const layerId=editor.state().manifest.activeLayerID!
 const action=actionSchema.parse({type:'selection.subject',layerId,removeBackground:true,matteQuality:'advanced',edgeMode:'color',refineEdges:4,matteContrast:0,shiftEdge:0,feather:1.5})
 assert.equal(action.type,'selection.subject');if(action.type!=='selection.subject')throw new Error('Wrong action')
 assert.equal(action.edgeMode,'color');assert.equal(action.feather,1.5)
 const refined=refineSubjectMatte(coarse,{width,height,data:png.data},{quality:action.matteQuality,edgeMode:action.edgeMode,refineEdges:action.refineEdges,matteContrast:action.matteContrast,shiftEdge:action.shiftEdge,feather:action.feather})
 const before=editor.snapshot(),selected=before.manifest.layers[0],source=before.assets.get(selected.imageFile!)!,preview=prepareSubjectMask(selected,source,refined,null)
 const committed=editor.commitPrepared({...editor.identity(),action},{coverage:refined}),after=editor.snapshot()
 assert.deepEqual(after.assets.get(preview.file)!.bytes,preview.bytes);assert.deepEqual(after.assets.get(selected.imageFile!),source)
 editor.history({...editor.identity(),direction:'undo',transactionId:committed.transactionId});assert.deepEqual(editor.snapshot(),before)
 assert.throws(()=>actionSchema.parse({...action,feather:21}));assert.throws(()=>actionSchema.parse({...action,edgeMode:'invented'}))
})
