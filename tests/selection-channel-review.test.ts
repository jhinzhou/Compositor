import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {blankPNG,encodeRaster} from '../src/core/raster-edit'
import {actionSchema} from '../src/shared/contracts'
import {selectionCoverage} from '../src/shared/selection-coverage'
const apply=(editor:Editor,action:unknown)=>editor.apply({...editor.identity(),action})
const stroke={type:'selection.paint',points:[[6.5,6.5]],size:4,hardness:1,opacity:1,value:0,initial:'all'}
function setup():Editor{
 const editor=new Editor();editor.create(16,12);const png=blankPNG(8,6)
 for(let i=0;i<8*6;i++)png.data.set([i*5%256,i*11%256,137,i%3?255:71],i*4)
 editor.contentRaster(editor.identity(),encodeRaster(png),{name:'Original pixels'})
 const layerId=editor.state().manifest.activeLayerID!;apply(editor,{type:'layer.mask',layerId,operation:'reveal'});apply(editor,{type:'layer.set_lock',layerId,lock:'all',locked:true});return editor
}
test('selection paint and fill preserve actual image/mask bytes and locked layer metadata through undo/redo',()=>{
 const editor=setup(),before=editor.snapshot();apply(editor,stroke);const painted=editor.state().selection
 apply(editor,{type:'selection.fill',value:.25,opacity:.5});assert.deepEqual(editor.snapshot(),before);assert.equal(Math.round(selectionCoverage(editor.state().selection,6.5,6.5)*255),32)
 editor.history({...editor.identity(),direction:'undo'});assert.deepEqual(editor.state().selection,painted);assert.deepEqual(editor.snapshot(),before)
 editor.history({...editor.identity(),direction:'undo'});assert.equal(editor.state().selection,null);assert.deepEqual(editor.snapshot(),before)
 editor.history({...editor.identity(),direction:'redo'});editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),before)
})
test('worker-style selection preview uses a read-only snapshot; stale commit cannot replace a newer selection',()=>{
 const editor=setup(),before=editor.state(),snapshot=editor.snapshot(),request={...editor.identity(),action:stroke};editor.inspectPrepared(request)
 const stage={...editor.snapshot(),selection:editor.state().selection??null};applyPixelAction(stage,actionSchema.parse(stroke));assert.equal(selectionCoverage(stage.selection,6.5,6.5),0)
 assert.deepEqual(editor.state(),before);assert.deepEqual(editor.snapshot(),snapshot)
 apply(editor,{type:'selection.fill',value:.5});const newer=editor.state();assert.throws(()=>editor.apply(request),/changed|revision/i);assert.deepEqual(editor.state(),newer)
})
test('paint/fill remain transient on a saved project; named-channel capture makes the project dirty without changing image assets',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'selection-channel-review-'));try{
  const editor=setup();await editor.saveAs(join(directory,'Original.comp'));const assets=editor.snapshot().assets;assert.equal(editor.state().modified,false)
  apply(editor,stroke);apply(editor,{type:'selection.fill',value:.5,opacity:.25});assert.equal(editor.state().modified,false);assert.deepEqual(editor.snapshot().assets,assets)
  const path=join(directory,'Transient.comp');await editor.saveCopy(path);const reopened=new Editor();await reopened.open(path);assert.equal(reopened.state().selection,null);assert.equal(reopened.state().manifest.namedSelections,undefined)
  apply(editor,{type:'selection.save_named',name:'Protected gray'});assert.equal(editor.state().modified,true);assert.deepEqual(editor.snapshot().assets,assets)
  await editor.saveAs(join(directory,'Named.comp'));await reopened.open(join(directory,'Named.comp'));apply(reopened,{type:'selection.load_named',name:'Protected gray'});const sourceSelection=editor.state().selection,reopenedSelection=reopened.state().selection;for(let y=0;y<12;y++)for(let x=0;x<16;x++)assert.equal(selectionCoverage(reopenedSelection,x+.5,y+.5),selectionCoverage(sourceSelection,x+.5,y+.5));assert.deepEqual(reopened.snapshot().assets,assets)
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('oversized selection channel operations reject without changing existing pixels, selection or revision',()=>{
 const editor=setup();apply(editor,{type:'document.canvas_size',width:10000,height:10000,anchor:'top-left'});const before=editor.state(),snapshot=editor.snapshot()
 for(const action of [stroke,{type:'selection.fill',value:0}])assert.throws(()=>apply(editor,action),/64 MP/)
 assert.deepEqual(editor.state(),before);assert.deepEqual(editor.snapshot(),snapshot)
})
