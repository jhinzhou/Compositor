import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask} from '../src/shared/mask-properties'
import type {Layer} from '../src/shared/contracts'
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-mask-properties.json',import.meta.url),'utf8')) as {provenance:{scriptSHA256:string};rows:{name:string;width:number;height:number;layer:Layer;maskWidth:number;maskHeight:number;maskRGBAZlib:string;alphaZlib:string;alphaSHA256:string}[]}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
test('native mask controls preserve verified script and explicitly exclude failed feather captures',()=>{assert.equal(fixture.rows.length,2);assert.equal(hash(readFileSync(new URL('../scripts/native-reference/photoshop-mask-properties-study-v2.jsx',import.meta.url))),fixture.provenance.scriptSHA256);assert.ok(fixture.rows.every(row=>(row.layer.maskFeather??0)===0))})
for(const row of fixture.rows)test(`Actual Photoshop non-destructive mask density: ${row.name}`,()=>{const raw=inflateSync(Buffer.from(row.maskRGBAZlib,'base64')),alpha=inflateSync(Buffer.from(row.alphaZlib,'base64'));assert.equal(hash(alpha),row.alphaSHA256);const source={width:row.maskWidth,height:row.maskHeight,data:new Uint8ClampedArray(raw)},effective=effectiveMaskPixels(source,row.layer),placement=effectiveMaskTransform(row.layer.maskPlacement??row.layer.transform,source,effective.inset);let max=0;for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)max=Math.max(max,Math.abs(sampleEffectiveMask(effective,placement,x+.5,y+.5)-alpha[y*row.width+x]));assert.equal(max,0);assert.deepEqual(new Uint8ClampedArray(raw),source.data)})
