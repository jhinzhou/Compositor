import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import fixtures from './fixtures/camera-raw-upstream.json'
import { applyImageFilter, imageFilterSchema } from '../src/shared/image-filters'
import { cameraRawAutoBalance, cameraRawBrightness, cameraRawLightColor, cameraRawNeutralize, cameraRawTables } from '../src/shared/camera-raw-adaptive'
import {cameraOptics,cameraScopes} from '../src/shared/camera-raw-kernels'
import { cameraRawDetail, cameraRawEffects } from '../src/shared/camera-raw-adaptive-effects'
import shadowsAlpha27 from '../fixtures/parity/native-735c2cc-camera-raw-shadows-alpha27.json'

test('decoded measured atlas matches the complete upstream measured resource', () => {
  assert.equal(cameraRawTables().length, fixtures.tableCount * 17 ** 3 * 3)
  assert.equal(createHash('sha256').update(cameraRawTables()).digest('hex'), fixtures.decodedSha256)
})
for (const fixture of fixtures.cases) test(`upstream C Camera Raw pixels: ${fixture.name}`, () => {
  const input = { width: fixture.width, height: fixture.height, data: new Uint8ClampedArray(fixture.input) }
  const source = fixture.settings as Record<string, unknown>
  const settings = imageFilterSchema.parse({ kind: 'cameraRaw', ...(fixture.kind === 'detail' ? {} : source), ...(typeof source.glowStyle === 'number' ? { glowStyle: ['Diffusion', 'Bloom', 'Halation'][source.glowStyle] } : {}), ...(typeof source.vignetteStyle === 'number'?{vignetteStyle:['Highlight Priority','Color Priority','Paint Overlay'][source.vignetteStyle]}:{}), ...(fixture.kind === 'detail' ? { detail: source } : {}) })
  assert.equal(settings.kind, 'cameraRaw'); if (settings.kind !== 'cameraRaw') return
  const output = fixture.kind === 'pipeline' ? applyImageFilter(input,settings) : fixture.kind === 'optics' ? cameraOptics(input,settings.optics,()=>{throw new Error('Oracle optics cases must not require distortion')}) : fixture.kind === 'grade' ? cameraRawLightColor(input,settings,undefined,true) : fixture.kind === 'light' ? cameraRawLightColor(input, settings) : fixture.kind === 'effects' ? cameraRawEffects(input, settings) : cameraRawDetail(input, settings.detail)
  assert.deepEqual(applyImageFilter(input, settings).data, output.data, 'The application filter pipeline must execute the validated upstream kernels')
  // 735c2cc deliberately replaced the old global Shadows table. Keep the old
  // capture immutable and use a fresh native C result for the exact same input.
  const updated=(shadowsAlpha27.legacyCaseReplacements as Record<string,{inputSHA256:string;expected:number[];premultipliedExpected:boolean}>)[fixture.name]
  if(updated)assert.equal(createHash('sha256').update(Uint8Array.from(fixture.input)).digest('hex'),updated.inputSHA256)
  const premultiplied = updated?.premultipliedExpected??('premultipliedExpected' in fixture && fixture.premultipliedExpected)
  const errors = (updated?.expected??fixture.expected).map((value, index) => Math.abs(value - (premultiplied && index % 4 !== 3 ? Math.round(output.data[index] * output.data[index - index % 4 + 3] / 255) : output.data[index])))
  assert.ok(Math.max(...errors) <= 1, `max channel error ${Math.max(...errors)} for ${fixture.name}`)
  assert.deepEqual([...input.data], fixture.input, 'filter must not mutate its source')
})
test('adaptive brightness agrees with actual upstream linear-light statistics', () => {
  const fixture = fixtures.statistics, brightness = cameraRawBrightness({ width: fixture.width, height: fixture.height, data: new Uint8ClampedArray(fixture.input) })
  for (const [i, key] of ['brightest', 'luminance', 'logBrightest'].entries()) assert.ok(Math.abs(brightness[key as keyof typeof brightness] - fixture.expected[i]) < 1e-10)
})
test('white-balance searches match upstream C evaluation and reject missing channels', () => {
  for (const fixture of fixtures.neutralizations) assert.deepEqual(cameraRawNeutralize(fixture.rgb[0], fixture.rgb[1], fixture.rgb[2]), fixture.expected)
  assert.equal(cameraRawNeutralize(0, .3, .5), undefined)
  assert.deepEqual(cameraRawAutoBalance({ width: 1, height: 1, data: new Uint8ClampedArray([11, 15, 40, 0]) }), { temperature: 0, tint: 0 })
})
test('histogram and vectorscope reproduce upstream every-other-pixel band sampling and alpha weights',()=>{
 const fixture=fixtures.scope,result=cameraScopes({width:fixture.width,height:fixture.height,data:new Uint8ClampedArray(fixture.input)},16),bins=[...result.red,...result.green,...result.blue]
 fixture.bins.forEach((value,i)=>assert.ok(Math.abs(bins[i]-value)<1e-12,`histogram ${i}`));fixture.cells.forEach((value,i)=>assert.ok(Math.abs(result.vectorscope[i]-value)<1e-12,`scope ${i}`))
})
test('the six new upstream measured color references and both vignette corner references remain within native tolerance',()=>{
 const rows:[number[],unknown,number[]][]=[
  [[230,115,0],{mixer:{saturation:[0,-60,0,0,0,0,0,0]}},[189,130,107]],
  [[230,92,92],{mixer:{hue:[60,0,0,0,0,0,0,0]}},[227,125,83]],
  [[92,92,230],{mixer:{luminance:[0,0,0,0,0,60,0,0]}},[142,142,248]],
  [[92,92,230],{calibration:{blueSaturation:-60}},[149,149,226]],
  [[230,92,92],{calibration:{redHue:60}},[228,118,37]],
  [[130,130,130],{curve:{darks:-60}},[101,101,101]]
 ]
 for(const [color,fields,expected] of rows){const output=applyImageFilter({width:1,height:1,data:Uint8ClampedArray.from([...color,255])},{kind:'cameraRaw',...fields as object});expected.forEach((value,i)=>assert.ok(Math.abs(output.data[i]-value)<=4,`${JSON.stringify(fields)} channel ${i}: ${output.data[i]} vs ${value}`))}
 const gray={width:300,height:200,data:Uint8ClampedArray.from({length:300*200*4},(_,i)=>i%4===3?255:128)}
 for(const [fields,expected] of [[{optics:{vignetteAmount:100}},223],[{vignetteAmount:-60},30]] as const){const output=applyImageFilter(gray,{kind:'cameraRaw',...fields});assert.ok(Math.abs(output.data[0]-expected)<=6,`${JSON.stringify(fields)} corner ${output.data[0]} vs ${expected}`)}
})
