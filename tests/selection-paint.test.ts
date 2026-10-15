import test from 'node:test'
import assert from 'node:assert/strict'
import {Editor} from '../src/core/editor'
import {paintSelection,type SelectionPaint} from '../src/shared/selection-paint'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {mutationSchema} from '../src/shared/contracts'
const stroke:SelectionPaint={points:[[8.5,8.5]],size:6,hardness:1,opacity:1,value:1,initial:'empty'}
test('Selection Brush adds from empty; Quick Mask protects from all without a layer',()=>{
 const added=paintSelection(null,20,20,stroke);assert.equal(selectionCoverage(added,8.5,8.5),1);assert.equal(selectionCoverage(added,.5,.5),0)
 const protectedArea=paintSelection(null,20,20,{...stroke,value:0,initial:'all'});assert.equal(selectionCoverage(protectedArea,8.5,8.5),0);assert.equal(selectionCoverage(protectedArea,.5,.5),1)
})
test('Repeated gray/opacity strokes preserve partial coverage and subtract smoothly',()=>{
 const first=paintSelection(null,20,20,{...stroke,opacity:.5}),second=paintSelection(first,20,20,{...stroke,opacity:.5}),third=paintSelection(second,20,20,{...stroke,value:0,opacity:.5})
 assert.equal(Math.round(selectionCoverage(first,8.5,8.5)*255),128);assert.equal(Math.round(selectionCoverage(second,8.5,8.5)*255),192);assert.equal(Math.round(selectionCoverage(third,8.5,8.5)*255),96)
 const gray=paintSelection(null,20,20,{...stroke,value:.25,initial:'all'});assert.equal(Math.round(selectionCoverage(gray,8.5,8.5)*255),64)
})
test('Outside a stroke, a feathered inverted selection keeps its actual gray coverage',()=>{
 const selection={shapes:[{kind:'rectangle' as const,operation:'replace' as const,bounds:[10,10,8,8] as [number,number,number,number],feather:0}],inverted:true,feather:2,canvasSize:[24,24] as [number,number]}
 const painted=paintSelection(selection,24,24,{...stroke,points:[[2.5,2.5]],value:0,size:2})
 for(const [x,y] of [[9.5,12.5],[10.5,12.5],[16.5,16.5],[23.5,23.5]])assert.ok(Math.abs(selectionCoverage(painted,x,y)-selectionCoverage(selection,x,y))<=1/255)
})
test('Selection painting is undoable/idempotent and leaves image assets unchanged',()=>{
 const e=new Editor();e.create(20,20);const before=e.snapshot(),request={...e.identity(),action:{type:'selection.paint',...stroke}},result=e.apply(request)
 assert.equal(e.state().revision,1);assert.equal(e.state().manifest.layers.length,before.manifest.layers.length);assert.deepEqual(e.snapshot().assets,before.assets);assert.deepEqual(e.apply(request),result)
 e.history({...e.identity(),direction:'undo',transactionId:e.state().undoTransactionId!});assert.equal(e.state().selection,null)
 e.history({...e.identity(),direction:'redo',transactionId:e.state().redoTransactionId!});assert.equal(selectionCoverage(e.state().selection,8.5,8.5),1)
})
test('Selection painting rejects mismatched pressure samples and excessive document budget',()=>{
 assert.equal(mutationSchema.safeParse({sessionId:'s',documentId:'d',expectedRevision:0,idempotencyKey:'k',action:{type:'selection.paint',...stroke,pressures:[.5,.4]}}).success,false)
 assert.throws(()=>paintSelection(null,10000,10000,stroke),/64 MP/)
})
