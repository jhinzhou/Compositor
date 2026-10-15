import test from 'node:test'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {applyPixelAction} from '../src/core/pixel-actions'
import {actionSchema,type EditAction,type Layer,type Transform} from '../src/shared/contracts'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
import {BRUSH_PRESETS,brushPointerPressure,prepareBrushStroke} from '../src/shared/brush-dynamics'
import {blankPNG,encodeRaster,paintRaster} from '../src/core/raster-edit'
const transform:Transform={origin:[0,0],size:[64,32],rotation:0,flipX:false,flipY:false,sampling:'High quality'}
const grid={width:64,height:32,transform}
const line:[number,number][]=[[10.5,16.5],[50.5,16.5]],returning:[number,number][]=[...line,line[0]]
function setup(){const editor=new Editor();editor.importPNG(encodeRaster(blankPNG(64,32)),'brush');return {editor,id:editor.state().manifest.activeLayerID!}}
function paint(id:string,overrides:Record<string,unknown>={}):EditAction{return actionSchema.parse({type:'layer.paint',layerId:id,points:line,color:[.2,.5,1,1],size:8,hardness:1,opacity:.5,flow:.08,...overrides})}

test('explicit 100% Flow and disabled pen dynamics preserve the legacy coverage byte for byte',()=>{
 for(const hardness of [0,.4,1]){
  const expected=brushStrokeCoverage(grid,returning,12,hardness)
  assert.deepEqual(brushStrokeCoverage(grid,returning,12,hardness,{flow:1}),expected)
  assert.deepEqual(brushStrokeCoverage(grid,returning,12,hardness,{flow:1,pressures:[.1,.5,.9],pressureSize:false,pressureOpacity:false}),expected)
 }
})

test('low Flow builds on return travel while whole-stroke opacity caps paint and erase',()=>{
 const single=brushStrokeCoverage(grid,line,8,1,{flow:.04}),double=brushStrokeCoverage(grid,returning,8,1,{flow:.04}),at=16*64+30
 assert.ok(single[at]>0&&single[at]<double[at]&&double[at]<255)
 const layer={transform} as Layer,png=blankPNG(64,32)
 paintRaster(png,layer,returning,[0,0,0,1],8,1,.3,false,null,false,undefined,{flow:.4})
 assert.ok(png.data[at*4+3]>0);assert.ok(png.data.every((value,index)=>index%4!==3||value<=77))
 const erased=blankPNG(64,32,255)
 paintRaster(erased,layer,returning,[0,0,0,1],8,1,.3,true,null,false,undefined,{flow:.4})
 assert.ok(erased.data[at*4+3]<255);assert.ok(erased.data.every((value,index)=>index%4!==3||value>=178))
})

test('arc-length Flow sampling is invariant to dense pointer events and linear pressure interpolation',()=>{
 const dense:[number,number][]=Array.from({length:1001},(_,index)=>[10.5+40*index/1000,16.5]),pressures=dense.map((_,index)=>.2+.8*index/1000)
 assert.deepEqual(brushStrokeCoverage(grid,dense,10,.4,{flow:.05}),brushStrokeCoverage(grid,line,10,.4,{flow:.05}))
 assert.deepEqual(brushStrokeCoverage(grid,dense,10,1,{flow:.2,pressures}),brushStrokeCoverage(grid,line,10,1,{flow:.2,pressures:[.2,1]}))
})

test('pen pressure tapers diameter and ink buildup without applying the mouse default half-pressure',()=>{
 assert.equal(brushPointerPressure({pointerType:'mouse',pressure:.5}),undefined)
 assert.equal(brushPointerPressure({pointerType:'touch',pressure:.5}),undefined)
 assert.equal(brushPointerPressure({pointerType:'pen',pressure:.25}),.25)
 const tapered=brushStrokeCoverage(grid,line,16,1,{pressures:[.1,1]})
 assert.equal(tapered[10*64+11],0);assert.ok(tapered[10*64+48]>0)
 const lighter=brushStrokeCoverage(grid,[[30.5,16.5]],8,1,{pressures:[.25],pressureSize:false,pressureOpacity:true})
 assert.equal(lighter[16*64+30],64)
 const pressureCapped=brushStrokeCoverage(grid,returning,8,1,{flow:.4,pressures:[.25,.25,.25],pressureSize:false,pressureOpacity:true})
 assert.ok(pressureCapped.every(value=>value<=64),'pressure opacity sets a per-pixel ceiling as Flow builds')
 assert.ok(brushStrokeCoverage(grid,line,8,1,{flow:0,pressures:[.2,1]}).every(value=>value===0))
})

test('pressure-aware smoothing retains straight-line pressure changes and ends at the pointer tip',()=>{
 const prepared=prepareBrushStroke([[0,0],[1,0],[2,0],[10,0]],8,3,[.8,.1,.9,.4])
 assert.deepEqual(prepared.pressures,[.8,.1,.9,.4,.4]);assert.equal(prepared.points.length,prepared.pressures!.length)
 assert.deepEqual(prepared.points.at(-1),[10,0])
 assert.deepEqual(prepareBrushStroke(line,8,0,[.2,.8]).pressures,[.2,.8])
 const increased=brushStrokeCoverage(grid,[[30.5,16.5],[30.5,16.5]],16,1,{pressures:[.1,1]})
 assert.equal(increased[16*64+35],255,'pressing harder at the same point expands its footprint')
 const same=brushStrokeCoverage(grid,[[30.5,16.5],[30.5,16.5]],16,1,{flow:.1,pressures:[.5,.5]})
 assert.deepEqual(same,brushStrokeCoverage(grid,[[30.5,16.5]],16,1,{flow:.1,pressures:[.5]}),'identical stationary events do not invent airbrush accumulation')
})

test('pressure/Flow preview uses the same core action as commit; a stroke is one exact undo/redo transaction',()=>{
 const {editor,id}=setup(),before=editor.snapshot(),beforeState=editor.state(),action=paint(id,{pressures:[.2,1],smoothing:2,pressureOpacity:true})
 const draft={...editor.snapshot(),selection:null};applyPixelAction(draft,action)
 assert.deepEqual(editor.snapshot(),before);assert.deepEqual(editor.state(),beforeState)
 const transaction=editor.apply({...editor.identity(),action}),after=editor.snapshot(),actual=after.assets.get(after.manifest.layers[0].imageFile!)!.bytes,preview=draft.assets.get(draft.manifest.layers[0].imageFile!)!.bytes
 assert.deepEqual(actual,preview);assert.deepEqual(after.manifest.layers,draft.manifest.layers);assert.equal(editor.state().revision,beforeState.revision+1)
 editor.history({...editor.identity(),direction:'undo',transactionId:transaction.transactionId});assert.deepEqual(editor.snapshot(),before)
 editor.history({...editor.identity(),direction:'redo'});assert.deepEqual(editor.snapshot(),after)
})

test('Flow paints gray masks with the same preview bytes and respects an active document selection',()=>{
 const {editor,id}=setup();editor.apply({...editor.identity(),action:{type:'layer.mask',layerId:id,operation:'reveal'}})
 editor.apply({...editor.identity(),action:{type:'selection.set',selection:{shapes:[{kind:'rectangle',bounds:[0,0,32,32],operation:'replace',feather:0}],inverted:false}}})
 const before=editor.snapshot(),action=paint(id,{target:'mask',color:[0,0,0,1],pressures:[.5,1]}),draft={...before,selection:editor.state().selection??null};applyPixelAction(draft,action)
 editor.apply({...editor.identity(),action});const after=editor.snapshot(),file=after.manifest.layers[0].maskFile!,png=PNG.sync.read(after.assets.get(file)!.bytes)
 assert.deepEqual(after.assets.get(file)!.bytes,draft.assets.get(file)!.bytes)
 assert.ok(png.data[(16*64+20)*4]<255);assert.equal(png.data[(16*64+40)*4],255)
 assert.equal(after.assets.get(file)!.bytes[25],0,'stored mask is grayscale PNG')
})

test('the public action schema rejects mismatched pressure samples and invalid Flow before document mutation',()=>{
 const {editor,id}=setup(),before=editor.snapshot(),state=editor.state()
 for(const fields of [{pressures:[.5]},{pressures:[.5,NaN]},{pressures:[-.2,1]},{flow:1.1},{flow:-.1}]){
  assert.throws(()=>editor.apply({...editor.identity(),action:{...paint(id),...fields} as EditAction}))
  assert.deepEqual(editor.snapshot(),before);assert.deepEqual(editor.state(),state)
 }
 assert.deepEqual(BRUSH_PRESETS.map(item=>item.id),['hard-round','soft-round','pressure-round'])
})

test('dynamic brush source coordinates respect flips and document clipping',()=>{
 const original=brushStrokeCoverage(grid,line,8,.3,{flow:.12,pressures:[.2,1]})
 const flipped=brushStrokeCoverage({...grid,transform:{...transform,flipX:true}},line,8,.3,{flow:.12,pressures:[.2,1]})
 for(let y=0;y<32;y++)for(let x=0;x<64;x++)assert.equal(flipped[y*64+x],original[y*64+63-x])
 const clipped=brushStrokeCoverage({...grid,canvasWidth:32,canvasHeight:16},line,16,.3,{flow:.12,pressures:[.2,1]})
 for(let y=0;y<32;y++)for(let x=0;x<64;x++)if(x>=32||y>=16)assert.equal(clipped[y*64+x],0)
})

test('zero Flow changes neither pixels nor the document revision, and malformed pressure arrays are rejected by coverage',()=>{
 const {editor,id}=setup(),before=editor.snapshot(),state=editor.state(),result=editor.apply({...editor.identity(),action:paint(id,{flow:0})})
 assert.equal(result.status,'no_change');assert.deepEqual(editor.snapshot(),before);assert.deepEqual(editor.state(),state)
 assert.throws(()=>brushStrokeCoverage(grid,line,8,1,{pressures:[1]}),/pressure/)
 assert.throws(()=>brushStrokeCoverage(grid,line,8,1,{flow:NaN}),/flow/)
})
