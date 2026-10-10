import test from 'node:test'
import assert from 'node:assert/strict'
import { cloneStrokeOffset, cloneSamplePoint } from '../src/shared/clone-source'

test('keeps aligned source offset between strokes and resets on a new sample', () => {
    const source: [number,number] = [8.5, 8.5]
    const first = cloneStrokeOffset(source, [40.5,20.5], true)
    assert.deepEqual(first, [-32,-12])
    assert.deepEqual(cloneSamplePoint(source, [44.5,24.5], true, undefined, first), [12.5,12.5])
    const second = cloneStrokeOffset(source, [48.5,20.5], true, first)
    assert.deepEqual(second, first)
    assert.deepEqual(cloneSamplePoint(source, [48.5,20.5], true, second), [16.5,8.5])
    assert.deepEqual(cloneSamplePoint([70,60], [48.5,20.5], true), [70,60])
  })
test('moves unaligned source only during a stroke and rounds negative half pixels away from zero', () => {
    const source: [number,number] = [8,8]
    const offset = cloneStrokeOffset(source, [40.5,20.5], false, [-1,-1])
    assert.deepEqual(offset, [-33,-13])
    assert.deepEqual(cloneSamplePoint(source, [42.5,22.5], false, [-1,-1], offset), [9.5,9.5])
    assert.deepEqual(cloneSamplePoint(source, [42.5,22.5], false, offset), source)
    assert.equal(cloneSamplePoint(source, undefined, true, offset), undefined)
    assert.equal(cloneStrokeOffset(undefined, [1,1], true), undefined)
  })
