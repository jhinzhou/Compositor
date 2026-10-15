import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Editor} from '../src/core/editor'
import {appendSelectionShape,selectionOperationBase} from '../src/shared/selection-composition'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {selectionOutline} from '../src/shared/selection-outline'
import type {Selection} from '../src/shared/pixel-contracts'

const shape=(operation:Selection['shapes'][number]['operation'],feather:number):Selection['shapes'][number]=>({kind:'rectangle',operation,feather,bounds:[18,10,10,12]})
function values(selection:Selection|null|undefined,width=48,height=32):number[]{return Array.from({length:width*height},(_,at)=>Math.round(selectionCoverage(selection,at%width+.5,Math.floor(at/width)+.5)*255))}

test('selection creation retains toolbar feather and explicitly chosen antialias without mutating its input',()=>{
 const input=shape('replace',8),before=structuredClone(input),soft=appendSelectionShape(null,input,48,32,false),hard=appendSelectionShape(null,shape('replace',0),48,32,true)
 assert.equal(soft.feather,8);assert.equal(soft.antialiased,false)
 assert.equal(selectionCoverage(hard,16.5,16.5),0);assert.ok(selectionCoverage(soft,16.5,16.5)>0)
 assert.deepEqual(input,before);assert.doesNotThrow(()=>structuredClone(soft))
})

test('new feather applies to only the new shape and preserves existing soft coverage in each composition mode',()=>{
 const previous:Selection={inverted:false,antialiased:true,feather:6,canvasSize:[48,32],shapes:[{kind:'ellipse',operation:'replace',bounds:[6,5,20,18],feather:0}]}
 const previousBytes=values(previous),before=structuredClone(previous),newBytes=values(appendSelectionShape(null,shape('replace',4),48,32))
 const expected={add:(a:number,b:number)=>Math.max(a,b),subtract:(a:number,b:number)=>a*(1-b/255),intersect:(a:number,b:number)=>a*b/255}
 for(const operation of ['add','subtract','intersect'] as const){
  const combined=appendSelectionShape(previous,shape(operation,4),48,32),actual=values(combined)
  for(let at=0;at<actual.length;at++)assert.ok(Math.abs(actual[at]-Math.round(expected[operation](previousBytes[at],newBytes[at])))<=1,`${operation}/${at}`)
  assert.equal(combined.feather,0);assert.ok(actual.some(value=>value>0&&value<255))
 }
 assert.deepEqual(previous,before);assert.deepEqual(values(previous),previousBytes)
 assert.equal(selectionOperationBase(previous,48,32),selectionOperationBase(previous,48,32))
})

test('new hard geometry does not discard feather of the current selection',()=>{
 const previous=appendSelectionShape(null,shape('replace',12),48,32),before=values(previous)
 const combined=appendSelectionShape(previous,{kind:'rectangle',operation:'add',bounds:[0,0,2,2],feather:0},48,32)
 const after=values(combined)
 for(let y=3;y<32;y++)for(let x=3;x<48;x++)assert.equal(after[y*48+x],before[y*48+x])
})

test('small soft geometry remains bounded on large canvases and oversized materialization fails without mutation',()=>{
 const input=shape('add',40),selection=appendSelectionShape(null,input,10000,10000)
 assert.ok(selection.shapes[0].raster!.width<200);assert.ok(selection.shapes[0].raster!.height<200)
 assert.equal(selectionOutline(selection,10000,10000),'')
 const previous=appendSelectionShape(null,shape('replace',4),48,32),before=structuredClone(previous)
 assert.throws(()=>appendSelectionShape(previous,{kind:'rectangle',operation:'add',bounds:[0,0,9000,9000],feather:40},10000,10000),/coverage budget/)
 assert.deepEqual(previous,before)
 const full=selectionOperationBase({shapes:[],inverted:true},10000,10000)
 assert.equal(full.shapes[0].kind,'rectangle');assert.equal(selectionCoverage(full,9999.5,9999.5),1)
})

test('created and combined feather supports one undo step and named-channel save/reopen without image changes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'created-feather-'))
 try{
  const editor=new Editor();editor.create(48,32)
  const originalAssets=editor.state().assets.map(asset=>[asset.file,asset.hash])
  const first=appendSelectionShape(null,shape('replace',8),48,32)
  editor.apply({...editor.identity(),action:{type:'selection.set',selection:first}})
  const prior=structuredClone(editor.state().selection),second=appendSelectionShape(prior,shape('subtract',4),48,32)
  editor.apply({...editor.identity(),action:{type:'selection.set',selection:second}})
  const coverage=values(editor.state().selection)
  editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().selection,prior)
  editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(values(editor.state().selection),coverage)
  editor.apply({...editor.identity(),action:{type:'selection.save_named',name:'Created feather'}})
  const path=join(directory,'Created.comp');await editor.saveAs(path)
  const reopened=new Editor();await reopened.open(path)
  reopened.apply({...reopened.identity(),action:{type:'selection.load_named',name:'Created feather'}})
  assert.deepEqual(values(reopened.state().selection),coverage)
  assert.deepEqual(reopened.state().assets.map(asset=>[asset.file,asset.hash]),originalAssets)
 }finally{await rm(directory,{recursive:true,force:true})}
})
