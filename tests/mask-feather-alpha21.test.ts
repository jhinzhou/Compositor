import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {photoshopMaskFeatherKernel,photoshopMaskFeatherPixels} from '../src/shared/mask-feather'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask} from '../src/shared/mask-properties'
import type {Layer} from '../src/shared/contracts'
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
// An independent frozen alpha20 branch, not a call to the production sigma/kernel.
function originalBox4(f:number){const sigma=Math.sqrt(f*f+Math.min(1/6,2*f*f/3));if(!sigma)return Float64Array.of(1);const a=sigma*Math.sqrt(.75),radius=Math.ceil(sigma*Math.sqrt(12)+.5),cdf=(x:number):number=>{const t=(x+4*a)/(2*a);if(t<=0)return 0;if(t>=4)return 1;if(t>2)return 1-cdf(-x);return Math.max(0,Math.min(1,(t**4-4*Math.max(0,t-1)**4+6*Math.max(0,t-2)**4)/24))},out=Float64Array.from({length:2*radius+1},(_,i)=>Math.max(0,cdf(i-radius+.5)-cdf(i-radius-.5))),sum=out.reduce((a,b)=>a+b,0);return out.map(v=>v/sum)}
function distance(a:Float64Array,b:Float64Array){const radius=Math.max(a.length,b.length)>>1,ar=a.length>>1,br=b.length>>1;let d=0;for(let k=-radius;k<=radius;k++)d+=Math.abs((a[k+ar]??0)-(b[k+br]??0));return d}
test('small-kernel zero limit, symmetry, unit mass and continuous support do not create discontinuities at precision/variance transitions',()=>{
 for(const f of [0,1e-250,1e-150,1e-5,.1,.2,.25,.3,.5,.6,.9,1,1.2,1.5,2,3,50,250]){const k=photoshopMaskFeatherKernel(f);assert.ok(k.every(v=>Number.isFinite(v)&&v>=0));assert.ok(Math.abs(k.reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(k.every((v,i)=>Math.abs(v-k[k.length-1-i])<1e-14))}
 assert.equal(distance(photoshopMaskFeatherKernel(0),photoshopMaskFeatherKernel(1e-5)),0)
 // Include the continuous zero/nonzero support boundaries and f=.25,1,2.
 for(const f of [.08,.12,.2,.25,.3,.5,.6,.9,1,1.2,1.5,2])assert.ok(distance(photoshopMaskFeatherKernel(f-1e-8),photoshopMaskFeatherKernel(f+1e-8))<2e-6,`Discontinuity at${f}`)
})
test('f>=2 retains exact alpha20 box4 coefficients; invalid/raster-budget requests are still rejected',()=>{
 for(const f of [2,2.1,3,4,6,10,20,50,250])assert.deepEqual(photoshopMaskFeatherKernel(f),originalBox4(f))
 for(const f of [-1,NaN,Infinity,250.1])assert.throws(()=>photoshopMaskFeatherKernel(f))
 assert.throws(()=>photoshopMaskFeatherPixels({width:30_000,height:30_000,data:new Uint8ClampedArray(0)},.3,0));assert.throws(()=>photoshopMaskFeatherPixels({width:1,height:1,data:new Uint8ClampedArray(4)},.3,NaN))
})
test('new small kernels preserve source bytes, density and default versus clamped boundaries',()=>{
 const image={width:13,height:9,data:Uint8ClampedArray.from({length:13*9*4},(_,i)=>i%4===3?255:Math.floor(i/4)%13<7?255:0)},before=image.data.slice()
 for(const f of [.2,.3,.6,1,1.5]){const layer={maskFeather:f,maskFeatherModel:'photoshop' as const,photoshopMaskDefault:0},finite=effectiveMaskPixels(image,{...layer,maskFeatherEdgeMode:'default'}),clamped=effectiveMaskPixels(image,{...layer,maskFeatherEdgeMode:'clamp'}),dense=effectiveMaskPixels(image,{...layer,maskDensity:.5,maskFeatherEdgeMode:'clamp'});assert.deepEqual(image.data,before);const i=((4+clamped.inset)*clamped.image.width+clamped.inset)*4,j=((4+finite.inset)*finite.image.width+finite.inset)*4;assert.ok(clamped.image.data[i]>=finite.image.data[j]);assert.equal(dense.image.data[i],Math.round(255+(clamped.image.data[i]-255)*.5));assert.equal(clamped.background,0);assert.equal(dense.background,128)}
})
type NativeRow={name:string;width:number;height:number;maskWidth:number;maskHeight:number;maskRGBAZlib:string;alphaZlib:string;alphaSHA256:string;layer:Layer;alpha20Baseline?:{max:number}}
const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-mask-feather-ui-alpha21.json',import.meta.url),'utf8')) as {rows:NativeRow[]}
// Fifteen separate actual UI readbacks; stricter values reflect actual new
// product residuals, never tune the kernel by this list or relax old16 gates.
const maxima:Record<string,number>={'0':0,'0.1':0,'0.2':3,'0.3':0,'0.4':1,'0.5':3,'0.6':6,'0.7':5,'0.8':3,'0.9':1,'1':2,'1.2':2,'1.5':2,'2':2,'3':3}
assert.equal(fixture.rows.length,15)
for(const row of fixture.rows)test(`actual native independent fractional mask alpha21: ${row.name}`,()=>{
 const alpha=new Uint8Array(inflateSync(Buffer.from(row.alphaZlib,'base64'))),raw=new Uint8ClampedArray(inflateSync(Buffer.from(row.maskRGBAZlib,'base64'))),before=raw.slice();assert.equal(hash(alpha),row.alphaSHA256);const source={width:row.maskWidth,height:row.maskHeight,data:raw},layer={...row.layer,maskFeatherModel:'photoshop' as const,maskFeatherEdgeMode:'clamp' as const},mask=effectiveMaskPixels(source,layer),placement=effectiveMaskTransform(layer.maskPlacement??layer.transform,source,mask.inset);let max=0;for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++)max=Math.max(max,Math.abs(sampleEffectiveMask(mask,placement,x+.5,y+.5)-alpha[y*row.width+x]));assert.ok(max<=maxima[String(layer.maskFeather??0)],`actual${max} exceeds measured max${maxima[String(layer.maskFeather??0)]}`);assert.ok(max<=row.alpha20Baseline!.max,'No native sample may regress against the frozen alpha20 product');assert.deepEqual(raw,before)
})
