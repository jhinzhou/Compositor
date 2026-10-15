import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
type Encoded={width:number;height:number;sha256:string;rgbaZlib:string}
type Reference=Encoded&{name:string;sourceVariant:string;corners:[[number,number],[number,number],[number,number],[number,number]];baselineRGBAZlib:string;baselineRGBA_SHA256:string;gate:{maximumRGBMAE:number;maximumRGBMax:number;maximumAlphaMAE:number;maximumAlphaMax:number;maximumPremultRGBMAE:number;maximumPremultRGBMax:number}}
// First9 were independent for the superseded local-profile model; now regression only.
// The fresh5 were independent after the alpha28 whole-map freeze. Both cohorts
// are disclosed regressions for today's REA work; the axis control is now exact.
const fixtures=['photoshop-27.11-perspective-sampling-independent-alpha28.json','photoshop-27.11-perspective-sampling-whole-map-independent-alpha28.json'].map(name=>JSON.parse(readFileSync(new URL('../fixtures/parity/'+name,import.meta.url),'utf8')) as {sources:Record<string,Encoded>;cases:Reference[]}),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),decode=(v:Encoded)=>{const b=inflateSync(Buffer.from(v.rgbaZlib,'base64'));assert.equal(sha(b),v.sha256);return b}
for(const [cohort,fixture] of fixtures.entries())for(const reference of fixture.cases)test(`${cohort?'whole-map model regression':'previous-model regression'} alpha28 native ${reference.name}: legacy mean/max not worsened, source retained`,()=>{
 const source=fixture.sources[reference.sourceVariant],bytes=decode(source),native=decode(reference),baseline=inflateSync(Buffer.from(reference.baselineRGBAZlib,'base64'));assert.equal(sha(baseline),reference.baselineRGBA_SHA256)
 const input=new PNG({width:source.width,height:source.height});input.data.set(bytes);const asset=makeAsset('independent.png',PNG.sync.write(input)),before=Buffer.from(asset.bytes),placement={origin:[0,0] as [number,number],size:[source.width,source.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},actual=PNG.sync.read(perspectiveCropRaster(asset,placement,reference.corners,reference.width,reference.height,'High quality').bytes).data
 let rgb=0,max=0,alpha=0,alphaMax=0,pm=0,pmMax=0
 const recoveredAxisControl=cohort===0&&reference.name==='opaque-holdout-axis-up'
 if(recoveredAxisControl)assert.deepEqual(actual,native,'Recovered full-source RGB8 axis control must now be native RGBA exact.')
 for(let p=0;p<reference.width*reference.height;p++){
  if(!recoveredAxisControl)assert.equal(actual[p*4+3],baseline[p*4+3],`alpha changed at pixel${p}`)
  const a=Math.abs(actual[p*4+3]-native[p*4+3]);alpha+=a;alphaMax=Math.max(alphaMax,a)
  for(let c=0;c<3;c++){const d=Math.abs(actual[p*4+c]-native[p*4+c]);rgb+=d;max=Math.max(max,d);const premult=Math.abs(actual[p*4+c]*actual[p*4+3]/255-native[p*4+c]*native[p*4+3]/255);pm+=premult;pmMax=Math.max(pmMax,premult)}
 }
 const pixels=reference.width*reference.height,gate=reference.gate
 assert.ok(rgb/(pixels*3)<=gate.maximumRGBMAE+1e-12,`RGB MAE ${rgb/(pixels*3)} > frozen legacy ${gate.maximumRGBMAE}`);assert.ok(max<=gate.maximumRGBMax,`RGB max ${max}`)
 assert.ok(alpha/pixels<=gate.maximumAlphaMAE);assert.ok(alphaMax<=gate.maximumAlphaMax)
 assert.ok(pm/(pixels*3)<=gate.maximumPremultRGBMAE+1e-12);assert.ok(pmMax<=gate.maximumPremultRGBMax+1e-12)
 assert.deepEqual(asset.bytes,before);assert.equal(sha(PNG.sync.read(asset.bytes).data),source.sha256)
})
