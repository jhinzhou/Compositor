import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {imageFilterSchema} from '../src/shared/image-filters';
import { applyDeepColorFilter, deepColorFilterCube, supportsDeepColorFilter, DEEP_COLOR_FILTER_KINDS } from '../src/shared/deep-color-filters';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/native-f01e298-deep-color.json',import.meta.url),'utf8')) as {rows:{name:string;settings:unknown;width:number;height:number;inputRGBA16LE:string;expectedRGBA16LE:string;cubeSHA256:string}[]};
function u16(b64:string):Uint16Array{const bytes=Buffer.from(b64,'base64');return Uint16Array.from({length:bytes.length/2},(_,i)=>bytes.readUInt16LE(i*2));}
// Normal HSL Lightness intentionally follows real PS references now. The frozen
// native Swift fixture remains historical; Colorize and other cubes still apply.
for(const row of fixture.rows){const spec=imageFilterSchema.parse(row.settings);if(spec.kind==='hsl'&&!spec.colorize&&(spec.lightness!==0||spec.hueRanges.some(v=>v.lightness!==0)))continue;
test(`unchanged native C / Swift deep color: ${row.name}`,()=>{
 const input=u16(row.inputRGBA16LE),copy=input.slice(),cube=deepColorFilterCube(row.settings),bytes=Buffer.alloc(cube.byteLength);for(let i=0;i<cube.length;i++)bytes.writeFloatLE(cube[i],i*4);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.cubeSHA256);
 assert.deepEqual(applyDeepColorFilter(input,row.width,row.height,row.settings),u16(row.expectedRGBA16LE));assert.deepEqual(input,copy);
 cube.fill(99);assert.notEqual(deepColorFilterCube(row.settings)[0],99);
});}
const pixel=new Uint16Array([1001,2347,4001,65535,451,222,33,1234,0,0,0,0]);
for(const kind of ['levels','curves','exposure','hsl','colorBalance'])test(`deep ${kind} identity retains exact samples`,()=>{const result=applyDeepColorFilter(pixel,3,1,{kind});assert.deepEqual(result,pixel);assert.notEqual(result,pixel);});
for(const kind of DEEP_COLOR_FILTER_KINDS)test(`deep ${kind} keeps alpha and premultiplication`,()=>{
 const spec=kind==='levels'?{kind,ranges:Array.from({length:4},()=>({gamma:1.2}))}:kind==='curves'?{kind,channels:Array.from({length:4},()=>[{x:0,y:0},{x:128,y:170},{x:255,y:255}])}:kind==='exposure'?{kind,exposure:.35}:kind==='hsl'?{kind,hue:25,saturation:20}:kind==='colorBalance'?{kind,midtones:[12,-9,2]}:{kind};
 const result=applyDeepColorFilter(pixel,3,1,spec);for(let at=0;at<pixel.length;at+=4){assert.equal(result[at+3],pixel[at+3]);for(let c=0;c<3;c++)assert.ok(result[at+c]<=result[at+3]);}if(kind!=='threshold'&&kind!=='posterize')assert.ok([...result.slice(0,3)].some(v=>v%257!==0));
});
test('invert uses alpha minus channel without losing any bit',()=>{assert.deepEqual(applyDeepColorFilter(pixel,3,1,{kind:'invert'}),new Uint16Array([64534,63188,61534,65535,783,1012,1201,1234,0,0,0,0]));});
test('direct levels preserves between-byte positions',()=>{const p=new Uint16Array([1001,1002,1003,65535]);const ranges=Array.from({length:4},()=>({}));ranges[0]={outputBlack:0,outputWhite:127.5} as {};assert.deepEqual(applyDeepColorFilter(p,1,1,{kind:'levels',ranges}),new Uint16Array([501,501,502,65535]));});
test('direct curve reaches endpoints and local maximum without overshoot',()=>{const points=[{x:0,y:0},{x:128,y:240},{x:255,y:100}],channels=[points,...Array.from({length:3},()=>[{x:0,y:0},{x:255,y:255}])];const input=new Uint16Array([0,128*257,65535,65535]);assert.deepEqual(applyDeepColorFilter(input,1,1,{kind:'curves',channels}),new Uint16Array([0,240*257,100*257,65535]));});
test('exposure evaluates the full source precision in linear light',()=>{const p=new Uint16Array([1001,1002,1003,65535]);assert.deepEqual(applyDeepColorFilter(p,1,1,{kind:'exposure',exposure:1}),new Uint16Array([2002,2004,2006,65535]));});
test('deep filter support rejects invalid settings and unsupported kinds',()=>{for(const kind of DEEP_COLOR_FILTER_KINDS)assert.equal(supportsDeepColorFilter({kind}),true);assert.equal(supportsDeepColorFilter({kind:'gaussianBlur'}),false);assert.equal(supportsDeepColorFilter({kind:'hsl',hue:Infinity}),false);assert.throws(()=>applyDeepColorFilter(pixel,3,1,{kind:'grain'}),/no supported/);assert.throws(()=>applyDeepColorFilter(pixel,3,1,{kind:'levels',ranges:[{}]}));assert.throws(()=>applyDeepColorFilter(pixel,3,1,{kind:'curves',channels:Array.from({length:4},()=>[{x:0,y:0},{x:0,y:255}])}));assert.throws(()=>applyDeepColorFilter(pixel,3,1,{kind:'exposure',gamma:NaN}));});
test('deep color geometry and premultiply rejection are atomic',()=>{const copy=pixel.slice();assert.throws(()=>applyDeepColorFilter(pixel,1,1,{kind:'invert'}),/bounded/);assert.throws(()=>applyDeepColorFilter(pixel,32_000_001,1,{kind:'invert'}),/bounded/);assert.throws(()=>applyDeepColorFilter(new Uint16Array([2,0,0,1]),1,1,{kind:'invert'}),/alpha/);assert.deepEqual(pixel,copy);});
