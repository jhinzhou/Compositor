import test from 'node:test'
import assert from 'node:assert/strict'
import {reactive} from 'vue'
import {rpcValue} from '../src/renderer/rpc-value'
test('nested Vue draft transforms and binary content survive Electron structured clone',()=>{
 const origin=reactive([3,5]),transform={origin,size:reactive([10,20]),rotation:0},bytes=new Uint8Array([1,2,3])
 const outgoing={action:{transform:{...transform}},bytes}
 assert.throws(()=>structuredClone(outgoing))
 const clone=structuredClone(rpcValue(outgoing));assert.deepEqual(clone.action.transform.origin,[3,5]);assert.ok(clone.bytes instanceof Uint8Array);assert.deepEqual(clone.bytes,bytes)
})
