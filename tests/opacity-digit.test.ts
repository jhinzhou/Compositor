import test from 'node:test'
import assert from 'node:assert/strict'
import { opacityDigit } from '../src/shared/opacity-digit'

test('native opacity numbers combine two digits within 600ms and support leading zero and 100%', () => {
  const first=opacityDigit(2,1000);assert.equal(first.value,.2)
  const second=opacityDigit(5,1599,first.pending);assert.equal(second.value,.25);assert.equal(second.pending,undefined)
  assert.equal(opacityDigit(0,1600,second.pending).value,1)
  assert.equal(opacityDigit(5,1700,opacityDigit(0,1650).pending).value,.05)
  assert.equal(opacityDigit(0,1900,opacityDigit(0,1800).pending).value,.01)
  assert.equal(opacityDigit(5,1600,first.pending).value,.5)
  for(const invalid of [-1,10,1.5,NaN])assert.throws(()=>opacityDigit(invalid,0))
})
