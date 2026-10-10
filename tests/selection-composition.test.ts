import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {appendSelectionShape,selectionOperationBase} from '../src/shared/selection-composition'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {selectionSchema,type Selection} from '../src/shared/pixel-contracts'
import {LIMITS} from '../src/shared/limits'
import {ref} from 'vue'

function inverse(feather=0):Selection{return {inverted:true,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,1,1],feather}]}}
const outline:Selection['shapes'][number]={kind:'rectangle',operation:'add',bounds:[0,0,2,1],feather:0}

test('add, subtract and intersect combine with the visible inverse selection, not its original outlines',()=>{
  const previous=inverse(),before=structuredClone(previous)
  const expected={add:[1,1,1,1],subtract:[0,0,1,1],intersect:[0,1,0,0],replace:[1,1,0,0]}
  for(const operation of ['add','subtract','intersect','replace'] as const){
    const selection=appendSelectionShape(previous,{...outline,operation},4,1)
    assert.deepEqual([0,1,2,3].map(x=>selectionCoverage(selection,x+.5,.5)),expected[operation])
    selectionSchema.parse(selection)
  }
  assert.deepEqual(previous,before)
})

test('inverse base preserves feathered coverage within one byte and is reused for pointer previews',()=>{
  const previous=inverse(2),base=selectionOperationBase(previous,4,3)
  assert.equal(selectionOperationBase(previous,4,3),base)
  assert.notEqual(selectionOperationBase(previous,5,3),base)
  for(let y=0;y<3;y++)for(let x=0;x<4;x++)assert.ok(Math.abs(selectionCoverage(base,x+.5,y+.5)-selectionCoverage(previous,x+.5,y+.5))<=1/255)
  const first=appendSelectionShape(previous,outline,4,3);first.shapes[0].raster!.runs.length=0
  assert.equal(selectionOperationBase(previous,4,3).shapes[0].raster!.runs.length>0,true)
})

test('full inverse and resource limits are explicit without allocating an oversized surface',()=>{
  const full:Selection={shapes:[],inverted:true}
  assert.equal(selectionCoverage(appendSelectionShape(full,{...outline,operation:'subtract'},4,1),3.5,.5),1)
  assert.throws(()=>selectionOperationBase(full,LIMITS.maxSide+1,1),/budget/)
  assert.throws(()=>selectionOperationBase(full,LIMITS.maxSide,LIMITS.maxSide),/budget/)
  const crowded:Selection={inverted:false,shapes:Array.from({length:128},()=>structuredClone(outline))}
  assert.throws(()=>appendSelectionShape(crowded,outline,4,1),/too many/)
  assert.equal(appendSelectionShape(crowded,{...outline,operation:'replace'},4,1).shapes.length,1)
})

test('magic wand and color range preserve inverse selection through actual editor commands',()=>{
  for(const kind of ['selection.wand','selection.color_range'] as const)for(const operation of ['add','subtract','intersect'] as const){
    const editor=new Editor();editor.create(4,1)
    const png=new PNG({width:4,height:1});for(let x=0;x<4;x++)png.data.set(x<2?[255,0,0,255]:[0,0,255,255],x*4)
    editor.importPNG(PNG.sync.write(png),'Colors');const layerId=editor.state().manifest.activeLayerID!
    editor.apply({...editor.identity(),action:{type:'selection.set',selection:inverse()}})
    if(kind==='selection.wand')editor.apply({...editor.identity(),action:{type:kind,layerId,point:[.5,.5],operation,tolerance:0,contiguous:true}})
    else editor.apply({...editor.identity(),action:{type:kind,layerId,colors:[[255,0,0]],operation,tolerance:0,softness:0,sampleAllLayers:false}})
    const expected=operation==='add'?[1,1,1,1]:operation==='subtract'?[0,0,1,1]:[0,1,0,0]
    assert.deepEqual([0,1,2,3].map(x=>selectionCoverage(editor.state().selection,x+.5,.5)),expected,`${kind}/${operation}`)
  }
})

test('freehand pointer drafts copy reactive point arrays into plain IPC-safe selection data',()=>{
 const points=ref<[number,number][]>([[0,0],[3,0],[3,3]])
 const selection=appendSelectionShape(null,{kind:'polygon',operation:'replace',bounds:[0,0,3,3],feather:0,points:points.value},4,4)
 assert.doesNotThrow(()=>structuredClone(selection))
 points.value[0][0]=99
 assert.deepEqual(selection.shapes[0].points,[[0,0],[3,0],[3,3]])
 assert.equal(selectionCoverage(selection,2.5,.5),1)
})
