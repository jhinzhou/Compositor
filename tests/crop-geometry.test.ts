import test from 'node:test'
import assert from 'node:assert/strict'
import {CROP_HANDLES,createCropRectangle,cropDragRectangle,pixelCropRect,selectionBoundingBox,validCropRect} from '../src/renderer/crop-geometry'
import {DEFAULT_GRID,type SnapOptions} from '../src/renderer/view-geometry'
import type {Selection} from '../src/shared/pixel-contracts'

const rect={x:10,y:20,width:100,height:80}
const snap:SnapOptions={enabled:true,zoom:1,document:{width:100,height:100}}
test('all eight free crop handles preserve the opposite anchor and stay on the pixel grid',()=>{
 const expected={nw:{x:20,y:30,width:90,height:70},n:{x:10,y:30,width:100,height:70},ne:{x:10,y:30,width:110,height:70},e:{x:10,y:20,width:110,height:80},se:{x:10,y:20,width:110,height:90},s:{x:10,y:20,width:100,height:90},sw:{x:20,y:20,width:90,height:90},w:{x:20,y:20,width:90,height:80}}
 for(const handle of CROP_HANDLES)assert.deepEqual(cropDragRectangle(rect,handle,[10,10]),expected[handle],handle)
 assert.deepEqual(cropDragRectangle(rect,'w',[120,0]),{x:110,y:20,width:20,height:80},'crossing the anchor retains a positive rectangle')
 assert.deepEqual(pixelCropRect({x:10.4,y:20.4,width:4.2,height:5.2}),{x:10,y:20,width:5,height:6})
})
test('Alt retains the center, portrait/original ratios survive resizing, and negative crop origins are valid',()=>{
 assert.deepEqual(cropDragRectangle(rect,'e',[10,0],undefined,true),{x:0,y:20,width:120,height:80})
 assert.deepEqual(cropDragRectangle(rect,'nw',[-15,-25],undefined,true),{x:-5,y:-5,width:130,height:130})
 const portrait={x:0,y:0,width:90,height:160}
 assert.deepEqual(cropDragRectangle(portrait,'e',[9,0],9/16),{x:0,y:-8,width:99,height:176})
 const corner=cropDragRectangle(portrait,'se',[15,20],9/16)
 assert.ok(Math.abs(corner.width/corner.height-9/16)<.01)
 assert.equal(validCropRect({x:-200,y:-10,width:250,height:90}),true)
 assert.equal(validCropRect({x:0,y:0,width:30001,height:1}),false)
 assert.equal(validCropRect({x:0,y:0,width:30000,height:30000}),false)
})
test('crop edges snap to canvas, layers, guides and grid while centers and Ctrl do not snap',()=>{
 const small={x:10,y:10,width:20,height:20}
 assert.deepEqual(cropDragRectangle(small,'move',[67,0],undefined,false,snap),{x:80,y:10,width:20,height:20})
 assert.deepEqual(cropDragRectangle(small,'move',[67,0],undefined,false,snap,true),{x:77,y:10,width:20,height:20})
 assert.deepEqual(cropDragRectangle({x:0,y:10,width:8,height:8},'move',[41,0],undefined,false,snap),{x:41,y:10,width:8,height:8},'canvas center is not a target')
 assert.equal(cropDragRectangle(small,'move',[12,0],undefined,false,{...snap,canvas:false,layers:[{id:'edge',x:25,y:25,width:30,height:30}]}).x,25)
 assert.equal(cropDragRectangle(small,'move',[12,0],undefined,false,{...snap,canvas:false,layers:[{id:'hidden',x:25,y:25,width:30,height:30,visible:false}]}).x,22)
 assert.equal(cropDragRectangle(small,'move',[12,0],undefined,false,{...snap,canvas:false,guides:[{id:'g',axis:'vertical',position:25}]}).x,25)
 assert.equal(cropDragRectangle(small,'move',[12,0],undefined,false,{...snap,canvas:false,grid:{...DEFAULT_GRID,spacing:64,subdivisions:8},gridVisible:true}).x,24)
 const nearEdge={x:10,y:10,width:80,height:50}
 assert.equal(cropDragRectangle(nearEdge,'e',[7,0],undefined,false,snap).width,90)
 assert.equal(cropDragRectangle(nearEdge,'e',[7,0],undefined,false,snap,true).width,87)
 assert.equal(cropDragRectangle(nearEdge,'e',[7,0],80/50,false,snap).width,87,'fixed-ratio resize bypasses edge snapping')
})
test('new crop creation honors Alt symmetry, fixed ratios, screen snap tolerance and Ctrl bypass',()=>{
 assert.deepEqual(createCropRectangle([50,50],[97,97],undefined,true,snap),{x:0,y:0,width:100,height:100})
 assert.deepEqual(createCropRectangle([50,50],[97,97],undefined,true,snap,true),{x:3,y:3,width:94,height:94})
 assert.deepEqual(createCropRectangle([10,10],[19,26],9/16,false,snap),{x:10,y:10,width:9,height:16})
 assert.deepEqual(createCropRectangle([10,10],[96,50],undefined,false,{...snap,zoom:4}),{x:10,y:10,width:86,height:40},'four document pixels is outside the 8-screen-pixel tolerance at 400%')
})
test('initial crop uses actual selection coverage, including subtraction, inversion, off-canvas and empty selections',()=>{
 const selection:Selection={inverted:false,shapes:[{kind:'rectangle',operation:'replace',bounds:[-5,-5,9,9],feather:0},{kind:'rectangle',operation:'subtract',bounds:[0,0,2,4],feather:0}]}
 assert.deepEqual(selectionBoundingBox(selection,8,8),{x:2,y:0,width:2,height:4})
 assert.deepEqual(selectionBoundingBox({inverted:true,shapes:[{kind:'rectangle',operation:'replace',bounds:[0,0,2,8],feather:0}]},8,8),{x:2,y:0,width:6,height:8})
 assert.equal(selectionBoundingBox({inverted:false,shapes:[]},8,8),undefined)
 assert.equal(selectionBoundingBox(undefined,8,8),undefined)
 assert.throws(()=>selectionBoundingBox(selection,30000,30000),/budget/)
})
