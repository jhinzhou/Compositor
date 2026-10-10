import test from 'node:test'
import assert from 'node:assert/strict'
import { planViewportRender } from '../src/renderer/viewport-render'
test('800% large document allocates only the visible area at native display resolution',()=>{
 const plan=planViewportRender({document:{width:10000,height:10000},viewport:{width:1200,height:800},origin:{x:-32000,y:-24000},zoom:8,deviceScale:2})
 assert.equal(plan.fullDocument,false);assert.ok(plan.width*plan.height<6_000_000);assert.equal(plan.width/plan.region.width,16);assert.ok(plan.region.x<=4000&&plan.region.x+plan.region.width>=4150);assert.equal(plan.css.left,`${plan.region.x*8}px`)
})
test('small document stays whole and high DPI still resolves each magnified source pixel',()=>{
 const plan=planViewportRender({document:{width:96,height:96},viewport:{width:1000,height:800},origin:{x:50,y:20},zoom:8,deviceScale:1})
 assert.equal(plan.fullDocument,true);assert.deepEqual(plan.region,{x:0,y:0,width:96,height:96});assert.equal(plan.width,768)
})
test('offscreen world geometry cannot allocate outside bounds or exceed viewport raster budget',()=>{
 const plan=planViewportRender({document:{width:30000,height:6000},viewport:{width:30000,height:30000},origin:{x:99999,y:99999},zoom:32,deviceScale:4})
 assert.ok(plan.width*plan.height<=16_010_000);assert.ok(plan.region.x>=0&&plan.region.y>=0);assert.ok(plan.region.x+plan.region.width<=30000)
})
