import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyDeepColorCube, quantizeDeep16ToPremultipliedRGBA8, quantizeDeep16ToRGBA8 } from '../src/shared/deep-pixels';

type Row = {name:string; operation:string; width:number; height:number; inputRGBA16LE:string; expectedPremultipliedRGBA8?:string; dimension?:number; cubeFloat32LE?:string; expectedRGBA16LE?:string};
const fixture = JSON.parse(readFileSync(new URL('../fixtures/parity/native-f01e298-deep.json', import.meta.url), 'utf8')) as {rows:Row[]};
function u16(encoded:string):Uint16Array { const b=Buffer.from(encoded,'base64'); return Uint16Array.from({length:b.length/2},(_,i)=>b.readUInt16LE(i*2)); }
function f32(encoded:string):Float32Array { const b=Buffer.from(encoded,'base64'); return Float32Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4)); }
for (const row of fixture.rows) test(`independent native deep ${row.operation}: ${row.name}`, () => {
  const input=u16(row.inputRGBA16LE), original=input.slice();
  if (row.operation==='quantize') {
    const actual=quantizeDeep16ToPremultipliedRGBA8(input,row.width,row.height);
    assert.deepEqual(actual,new Uint8Array(Buffer.from(row.expectedPremultipliedRGBA8!,'base64')));
    assert.deepEqual(quantizeDeep16ToPremultipliedRGBA8(input,row.width,row.height),actual);
    const straight=quantizeDeep16ToRGBA8(input,row.width,row.height);
    for(let at=0;at<actual.length;at+=4) {
      assert.equal(straight[at+3],actual[at+3]);
      for(let c=0;c<3;c++) assert.equal(straight[at+c],actual[at+3]?Math.min(255,Math.floor((actual[at+c]*255+Math.floor(actual[at+3]/2))/actual[at+3])):0);
    }
  } else {
    const actual=applyDeepColorCube(input,row.width,row.height,f32(row.cubeFloat32LE!),row.dimension!);
    assert.deepEqual(actual,u16(row.expectedRGBA16LE!));
    for(let at=0;at<input.length;at+=4) assert.equal(actual[at+3],input[at+3]);
  }
  assert.deepEqual(input,original);
});
test('deep kernels reject invalid geometry, premultiplication and cube before output',()=>{
  const pixel=new Uint16Array([101,0,0,100]);
  assert.throws(()=>quantizeDeep16ToRGBA8(pixel,1,1),/premultiplied/);
  assert.throws(()=>quantizeDeep16ToRGBA8(new Uint16Array(4),1.5,1),/dimensions/);
  assert.throws(()=>quantizeDeep16ToRGBA8(new Uint16Array(4),0,1),/dimensions/);
  assert.throws(()=>quantizeDeep16ToRGBA8(new Uint16Array(4),32_000_001,1),/budget/);
  assert.throws(()=>quantizeDeep16ToRGBA8(new Uint16Array(3),1,1),/sample count/);
  assert.throws(()=>applyDeepColorCube(new Uint16Array(4),1,1,new Float32Array(4),2),/cube/);
  assert.throws(()=>applyDeepColorCube(new Uint16Array(4),1,1,new Float32Array(32).fill(NaN),2),/finite/);
  assert.throws(()=>applyDeepColorCube(new Uint16Array(4),1,1,new Float32Array(32).fill(Infinity),2),/finite/);
  assert.throws(()=>applyDeepColorCube(new Uint16Array(4),1,1,new Float32Array(4),66),/cube/);
});
