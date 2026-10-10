import test from 'node:test'
import assert from 'node:assert/strict'
import {objectSelectionBounds} from '../src/shared/object-box'
test('object drag normalizes all directions, clips to document and preserves subpixel edge coverage',()=>{const doc={width:100,height:80};assert.deepEqual(objectSelectionBounds([50,40],[10,20],doc),[10,20,40,20]);assert.deepEqual(objectSelectionBounds([-10,-5],[200,90],doc),[0,0,100,80]);assert.deepEqual(objectSelectionBounds([2.5,3.2],[7.4,8.6],doc),[2,3,6,6])})
test('Shift object box uses square drag extent; empty/offscreen/nonfinite boxes never start inference',()=>{const doc={width:100,height:80};assert.deepEqual(objectSelectionBounds([50,40],[30,35],doc,true),[30,20,20,20]);assert.equal(objectSelectionBounds([1,1],[1,1],doc),undefined);assert.equal(objectSelectionBounds([110,1],[120,30],doc),undefined);assert.throws(()=>objectSelectionBounds([NaN,0],[1,1],doc),/Invalid/)})
