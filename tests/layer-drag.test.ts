import test from 'node:test'
import assert from 'node:assert/strict'
import {resizeLayer,resizeTogether,constrainMove} from '../src/shared/layer-drag'
const t={origin:[10,20],size:[100,50],rotation:0,flipX:false,flipY:false,sampling:'High quality'} as const
test('native resize anchors, centered Alt resize, and cross-anchor flip',()=>{
 const base=structuredClone(t) as any
 assert.deepEqual(resizeLayer(base,'e',[25,0],false,false).origin,[10,20])
 assert.deepEqual(resizeLayer(base,'e',[25,0],false,false,true).origin,[-15,20])
 const crossed=resizeLayer(base,'w',[120,0],false,false)
 assert.deepEqual(crossed.origin,[110,20]);assert.deepEqual(crossed.size,[20,50]);assert.equal(crossed.flipX,true)
 const projected=resizeLayer(base,'se',[20,50],true,false)
 assert.deepEqual(projected.size,[136,68])
 assert.deepEqual(constrainMove([3,-9],true),[0,-9])
})

test('shared resize reflects child position, rotation and pixels across a crossed anchor',()=>{
 const before={origin:[0,0],size:[200,100],rotation:0,flipX:false,flipY:false} as any,after={...before,origin:[200,0],size:[100,50],flipX:true}
 const child={...before,origin:[20,10],size:[40,30],rotation:25},result=resizeTogether(child,before,after)
 assert.deepEqual(result.origin,[270,5]);assert.deepEqual(result.size,[20,15]);assert.equal(result.rotation,-25);assert.equal(result.flipX,true);assert.equal(result.flipY,false)
})
