import test from 'node:test'
import assert from 'node:assert/strict'
import {cameraClipOverlay,cameraScopes,cameraSharpenMask,cameraDetailSchema,cameraSamplePoint} from '../src/shared/camera-raw-kernels'
import { readFile } from 'node:fs/promises'
import { applyImageFilter, curveValue, defaultFilter, defaultHueBand, applyCameraRawPreview, FILTER_NAMES, imageFilterSchema, NATIVE_ADJUSTMENT_KINDS, nativeAdjustmentToSpec, specToNativeAdjustment, type ImageFilterKind, type PixelImage } from '../src/shared/image-filters'
const image = (width: number, height: number, rgba: number[]): PixelImage => ({ width, height, data: Uint8ClampedArray.from(rgba) })
const ramp = image(32, 16, Array.from({ length: 32 * 16 }, (_, index) => [Math.round(index % 32 / 31 * 255), Math.round(Math.floor(index / 32) / 15 * 255), (index * 17) % 256, 255]).flat())

test('unchanged adjustments match independently compiled v1.4.8 native C pixels', async () => {
  const fixtures = JSON.parse(await readFile('fixtures/parity/native-1.4.8-adjustments.json', 'utf8')) as { commit: string; rows: { spec: unknown; width: number; height: number; rgba: number[]; expectedPremul: number[] }[] }
  assert.equal(fixtures.commit, '24ef2885daae750537ec8d094f33e8556a8dfc9a')
  const failures: string[] = []
  for (const row of fixtures.rows) {
    // Camera Raw changed after v1.4.8; its full pipeline uses the newer C oracle in camera-raw-upstream.test.ts.
    if (imageFilterSchema.parse(row.spec).kind === 'cameraRaw') continue
    const actual = applyImageFilter(image(row.width, row.height, row.rgba), row.spec)
    const differences = row.expectedPremul.map((value, index) => Math.abs(value - (index % 4 === 3 ? actual.data[index] : Math.round(actual.data[index] * actual.data[Math.floor(index / 4) * 4 + 3] / 255))))
    const maximum = Math.max(...differences)
    if (maximum > 2) failures.push(`${JSON.stringify(row.spec)} max premultiplied delta ${maximum}`)
  }
  assert.deepEqual(failures, [])
})
test('Levels/Curves/Exposure identity, channel composition and nonlinear exposure use real tone transforms', () => {
  for (const kind of ['levels', 'curves', 'exposure', 'hsl', 'colorBalance', 'cameraRaw'] as const) assert.deepEqual(applyImageFilter(ramp, { kind }).data, ramp.data, kind)
  const input = image(3, 1, [0, 0, 0, 255, 128, 128, 128, 128, 255, 255, 255, 255])
  const levels = defaultFilter('levels'); if (levels.kind !== 'levels') throw Error('Incorrect kind')
  levels.ranges[0].outputBlack = 10; levels.ranges[0].outputWhite = 210; levels.ranges[1].outputWhite = 128
  const result = applyImageFilter(input, levels)
  assert.deepEqual([...result.data.slice(0, 4)], [10, 10, 10, 255]); assert.deepEqual([...result.data.slice(8)], [110, 210, 210, 255])
  assert.ok(applyImageFilter(input, { kind: 'exposure', exposure: 1 }).data[4] > 128)
  const curves = defaultFilter('curves'); if (curves.kind !== 'curves') throw Error('Incorrect kind')
  curves.channels[0] = [{ x: 0, y: 0 }, { x: 128, y: 195 }, { x: 255, y: 255 }]
  assert.equal(curveValue(curves.channels[0], 128), 195); assert.equal(applyImageFilter(input, curves).data[4], 195)
})
test('HSL leaves gray neutral, rotates primary hue, desaturates and colorizes independently of alpha', () => {
  const source = image(3, 1, [255, 0, 0, 128, 128, 128, 128, 255, 0, 0, 255, 0])
  const shifted = applyImageFilter(source, { kind: 'hsl', hue: 120, saturation: 100 })
  assert.deepEqual([...shifted.data.slice(0, 4)], [0, 255, 0, 128]); assert.deepEqual([...shifted.data.slice(4, 8)], [122, 122, 122, 255])
  assert.deepEqual([...applyImageFilter(source, { kind: 'hsl', saturation: -100 }).data.slice(0, 4)], [128, 128, 128, 128])
  assert.deepEqual([...source.data.slice(8)], [...shifted.data.slice(8)])
})
test('selection coverage composites in premultiplied space and preserves input buffers', () => {
  const source = image(3, 1, [20, 40, 60, 128, 100, 110, 120, 255, 180, 170, 160, 255]), before = [...source.data]
  const filtered = applyImageFilter(source, { kind: 'invert' }, Uint8Array.from([0, 128, 255]))
  assert.deepEqual([...filtered.data.slice(0, 4)], before.slice(0, 4)); assert.deepEqual([...filtered.data.slice(8)], [75, 85, 95, 255]); assert.equal(filtered.data[4], 128)
  assert.deepEqual([...source.data], before)
  assert.throws(() => applyImageFilter(source, { kind: 'invert' }, new Uint8Array(1)))
})
test('Gaussian and directed motion blur spread light while excluding hidden transparent RGB', () => {
  const source = image(7, 7, Array.from({ length: 49 }, (_, index) => index === 24 ? [255, 0, 0, 255] : [0, 255, 0, 0]).flat())
  const blurred = applyImageFilter(source, { kind: 'gaussianBlur', radius: 1.5 })
  assert.ok(blurred.data[24 * 4 + 3] < 255); assert.ok(blurred.data[23 * 4 + 3] > 0); assert.equal(blurred.data[23 * 4 + 1], 0)
  const horizontal = applyImageFilter(source, { kind: 'motionBlur', distance: 5, angle: 0 }), vertical = applyImageFilter(source, { kind: 'motionBlur', distance: 5, angle: 90 })
  assert.ok(horizontal.data[23 * 4 + 3] > 0); assert.equal(horizontal.data[17 * 4 + 3], 0)
  assert.ok(vertical.data[17 * 4 + 3] > 0); assert.equal(vertical.data[23 * 4 + 3], 0)
})
test('all nine Dither styles produce quantized nontrivial patterns and retain alpha', () => {
  for (const style of ['atkinson', 'floydSteinberg', 'bayer2', 'bayer4', 'bayer8', 'dots', 'lines', 'diamonds', 'patterns']) {
    const result = applyImageFilter(ramp, { kind: 'dither', style, pixelSize: 1, levels: 2, cellSize: 4 })
    assert.ok(result.data.some((value, index) => index % 4 !== 3 && value === 0), style); assert.ok(result.data.some((value, index) => index % 4 !== 3 && value === 255), style)
    assert.ok(result.data.every((value, index) => index % 4 === 3 || value === 0 || value === 255), style)
  }
  const colors = applyImageFilter(ramp, { kind: 'dither', colors: 'twoColors', dark: '#ff0000', light: '#0000ff', pixelSize: 1 })
  assert.ok(colors.data.every((value, index) => index % 4 !== 1 || value === 0))
})
test('filters and their effect controls modify pixels, deterministic grain/noise can be repeated exactly', () => {
  const settings: Record<ImageFilterKind, unknown> = { levels: { kind: 'levels', ranges: [{ black: 30 }, {}, {}, {}] }, curves: { kind: 'curves', channels: [[{ x: 0, y: 255 }, { x: 255, y: 0 }], ...Array.from({ length: 3 }, () => [{ x: 0, y: 0 }, { x: 255, y: 255 }])] }, hsl: { kind: 'hsl', hue: 70 }, exposure: { kind: 'exposure', exposure: 1 }, gradientMap: { kind: 'gradientMap', shadows: '#ff0000', highlights: '#0000ff' }, grain: { kind: 'grain', amount: 50 }, invert: { kind: 'invert' }, blackWhite: { kind: 'blackWhite' }, colorBalance: { kind: 'colorBalance', midtones: [60, -20, 20] }, gaussianBlur: { kind: 'gaussianBlur', radius: 2 }, motionBlur: { kind: 'motionBlur', distance: 9 }, addNoise: { kind: 'addNoise', amount: 40, seed: 148 }, vignette: { kind: 'vignette', amount: 80 }, bloom: { kind: 'bloom', amount: 60 }, tonalContrast: { kind: 'tonalContrast', amount: 90 }, lensCorrection: { kind: 'lensCorrection', distortion: 80 }, dither: { kind: 'dither' }, scanlines: { kind: 'scanlines', split: 4, displace: 30 }, cameraRaw: { kind: 'cameraRaw', exposure: 1, clarity: 50 } }
  assert.deepEqual(Object.keys(settings).sort(), Object.keys(FILTER_NAMES).sort())
  for (const [kind, spec] of Object.entries(settings)) assert.notDeepEqual(applyImageFilter(ramp, spec).data, ramp.data, kind)
  for (const kind of ['grain', 'addNoise'] as const) {
    assert.deepEqual(applyImageFilter(ramp, { kind, seed: 148 }).data, applyImageFilter(ramp, { kind, seed: 148 }).data)
    assert.notDeepEqual(applyImageFilter(ramp, { kind, seed: 148 }).data, applyImageFilter(ramp, { kind, seed: 149 }).data)
  }
  assert.notDeepEqual(applyImageFilter(ramp, { kind: 'grain', size: 1 }).data, applyImageFilter(ramp, { kind: 'grain', size: 8 }).data)
})
test('Camera Raw Shadows and Highlights are monotonic across the full gray ramp', () => {
  const gray = image(256, 1, Array.from({ length: 256 }, (_, value) => [value, value, value, 255]).flat())
  for (const settings of [{ shadows: 100 }, { highlights: -100 }, { shadows: 80, highlights: -90 }, { blacks: 100, whites: -100 }]) {
    const result = applyImageFilter(gray, { kind: 'cameraRaw', ...settings })
    for (let value = 1; value < 256; value++) assert.ok(result.data[value * 4] >= result.data[(value - 1) * 4], `tone ${value}`)
  }
})
test('all twelve native adjustment layer metadata kinds round trip with their required Codable fields', () => {
  for (const kind of Object.keys(NATIVE_ADJUSTMENT_KINDS) as (keyof typeof NATIVE_ADJUSTMENT_KINDS)[]) {
    const source = defaultFilter(kind), metadata = specToNativeAdjustment(source)
    assert.ok(metadata.levels); assert.ok(metadata.curves); assert.equal(typeof metadata.hue, 'number')
    assert.deepEqual(nativeAdjustmentToSpec(metadata), source, kind)
  }
  assert.equal(nativeAdjustmentToSpec({ kind: 'Exposure', exposureSettings: { exposure: 2, gamma: 1, offset: 0 } }).kind, 'exposure')
  const range = nativeAdjustmentToSpec({ kind: 'Hue/Saturation', hsvSettings: { range: 'Reds', adjustments: ['Reds', { hue: 25, saturation: 0, lightness: 0 }] } })
  assert.equal(range.kind, 'hsl'); if (range.kind !== 'hsl') throw Error('Kind mismatch'); assert.equal(range.hueRanges[0].hue, 25)
  assert.deepEqual(nativeAdjustmentToSpec(specToNativeAdjustment(range)), range)
})
test('unsupported parameters and malformed raster/curves fail before mutation', () => {
  assert.equal(imageFilterSchema.safeParse({ kind: 'cameraRaw', optics: { vignette: 50 } }).success, false)
  assert.equal(imageFilterSchema.safeParse({ kind: 'dither', style: 'ascii', glyphs: [{ character: 'x', width: 5, height: 7, bitmap: 'AA==' }] }).success, false)
  for (const spec of [{ kind: 'exposure', gamma: 0 }, { kind: 'grain', seed: -1 }, { kind: 'scanlines', lineSpacing: 0 }, { kind: 'curves', channels: [] }, { kind: 'bloom', amount: Infinity }, { kind: 'levels', ranges: [{ black: 200, white: 100 }, {}, {}, {}] }]) assert.equal(imageFilterSchema.safeParse(spec).success, false)
  assert.throws(() => applyImageFilter({ width: 1, height: 1, data: new Uint8ClampedArray(3) }, { kind: 'invert' }))
})

test('Hue/Saturation subranges honor wrapping bands, inverse range, and native dictionary pairs', () => {
  const source = image(3, 1, [255,0,0,255,0,255,0,255,0,0,255,255])
  const range = { range: 'Reds', hue: 120, saturation: 0, lightness: 0, band: defaultHueBand('Reds') }
  const adjusted = applyImageFilter(source, { kind:'hsl', hueRanges:[range] })
  assert.deepEqual([...adjusted.data], [0,255,0,255,0,255,0,255,0,0,255,255])
  const inverse = applyImageFilter(source, { kind:'hsl', hueRanges:[range], activeRange:'Reds', invertRange:true })
  assert.deepEqual([...inverse.data], [255,0,0,255,0,0,255,255,255,0,0,255])
  assert.throws(() => nativeAdjustmentToSpec({kind:'Hue/Saturation',hsvSettings:{adjustments:['Unknown',{hue:10}]}}), /Unknown/)
})
test('ASCII draws cells chosen by ink coverage, supports desktop glyph maps and preserves source alpha', () => {
  const glyphs = [{character:' ',width:2,height:2,bitmap:'AAAAAA=='},{character:'#',width:2,height:2,bitmap:'/////w=='}]
  const source = image(4,2,[0,0,0,255,0,0,0,255,255,255,255,128,255,255,255,255,0,0,0,255,0,0,0,255,255,255,255,255,255,255,255,255])
  const result = applyImageFilter(source,{kind:'dither',style:'ascii',characters:' #',glyphs})
  assert.deepEqual([...result.data], [...source.data])
  const pattern = applyImageFilter(ramp,{kind:'dither',style:'ascii',textSize:6})
  assert.notDeepEqual(pattern.data,ramp.data)
  assert.throws(() => applyImageFilter(ramp,{kind:'dither',style:'ascii',characters:'中文'}),/glyph maps/)
})
test('Camera Raw advanced groups, guided geometry and auto white balance are functional and bounded', () => {
  const specs = [
    {curve:{darks:50,red:[{x:0,y:0},{x:1,y:.7}]}},
    {mixer:{hue:[50,0,0,0,0,0,0,0],points:[{hue:120,saturation:.6,luminance:.5,hueShift:80}]}},
    {grading:{shadows:{hue:240,saturation:60},global:{hue:30,saturation:25}}},
    {detail:{sharpenAmount:110,noiseColor:60,noiseLuminance:40}},
    {optics:{removeChromaticAberration:true,purpleAmount:70,greenAmount:60}},
    {geometry:{rotate:15,vertical:30,constrainCrop:true}},
    {geometry:{upright:'Guided',guides:[{startX:.1,startY:.1,endX:.8,endY:.2}]}},
    {calibration:{redHue:70,blueSaturation:-60}},
    {whiteBalance:'Auto'},
    {glow:80,glowStyle:'Halation',glowRange:-50,glowSpread:70,vignetteAmount:-80,vignetteStyle:'Color Priority'}
  ]
  for (const fields of specs) { const result = applyImageFilter(ramp,{kind:'cameraRaw',...fields}); assert.equal(result.width,ramp.width);assert.equal(result.height,ramp.height);assert.notDeepEqual(result.data,ramp.data,JSON.stringify(fields)) }
  assert.throws(()=>applyImageFilter(ramp,{kind:'cameraRaw',geometry:{scale:-100}}),/degenerate/)
  assert.equal(imageFilterSchema.safeParse({kind:'cameraRaw',curve:{shadowSplit:75,darkSplit:50}}).success,false)
})

test('Gaussian, rotated Motion and Bloom match native Core Image references across small/large radii and transparent impulses', async () => {
  const fixtures=JSON.parse(await readFile('fixtures/parity/native-1.4.8-core-image-filters.json','utf8')) as { rows: { spec:unknown;width:number;height:number;rgba:number[];expectedPremul:number[] }[] }
  const failures:string[]=[]
  for(const row of fixtures.rows){const actual=applyImageFilter(image(row.width,row.height,row.rgba),row.spec),difference=row.expectedPremul.map((value,index)=>Math.abs(value-(index%4===3?actual.data[index]:Math.round(actual.data[index]*actual.data[index-index%4+3]/255)))),maximum=Math.max(...difference);if(maximum>2)failures.push(`${JSON.stringify(row.spec)} ${row.width}x${row.height}: max premul delta ${maximum}`)}
  assert.equal(fixtures.rows.length,45);assert.deepEqual(failures,[])
})

test('Camera Raw preview views are transient; scope is alpha weighted and clipped colors retain alpha',()=>{
 const source=image(4,1,[0,0,0,255,255,255,255,128,255,0,0,255,0,255,0,0]),before=[...source.data]
 const scopes=cameraScopes(source);assert.equal(scopes.red[255],1);assert.equal(scopes.green[255],0);assert.equal(scopes.vectorscope.reduce((a,b)=>a+b,0),1)
 const overlay=cameraClipOverlay(source,true,true);assert.deepEqual([...overlay.data.slice(0,4)],[0,0,166,255]);assert.deepEqual([...overlay.data.slice(4,8)],[255,89,89,128])
 const clipped=applyCameraRawPreview(source,{kind:'cameraRaw'},{clipping:'highlights'});assert.deepEqual([...clipped.data.slice(4,8)],[255,255,255,128]);assert.deepEqual([...clipped.data.slice(8,12)],[255,0,0,255]);assert.deepEqual([...source.data],before)
 const mask=cameraSharpenMask(ramp,cameraDetailSchema.parse({sharpenMasking:40}));assert.ok(mask.data.every((value,index)=>index%4===3||value===mask.data[index-index%4]));assert.notDeepEqual(mask.data,ramp.data)
 const red=cameraSamplePoint([255,0,0]);assert.equal(red.hue,0);assert.equal(red.saturation,1);assert.equal(red.luminance,.5)
 assert.throws(()=>applyCameraRawPreview(source,{kind:'invert'},{}));assert.throws(()=>applyCameraRawPreview(source,{kind:'cameraRaw'},{visualizePointColor:8}));assert.throws(()=>cameraScopes(source,1000))
})

test('runtime sampling scale handles valid zoomed blur parameters without weakening persistent limits',()=>{
 const source=image(17,11,Array.from({length:187},(_,i)=>i===93?[255,0,0,255]:[0,0,0,0]).flat()),spec={kind:'gaussianBlur',radius:200};assert.equal(imageFilterSchema.safeParse({...spec,radius:800}).success,false);const result=applyImageFilter(source,spec,undefined,4);assert.equal(result.data.length,source.data.length);assert.equal(spec.radius,200)
 assert.equal(imageFilterSchema.safeParse({kind:'motionBlur',distance:3000}).success,false);assert.equal(applyImageFilter(source,{kind:'motionBlur',distance:1000},undefined,3).data.length,source.data.length)
 const baseline=applyImageFilter(source,{kind:'gaussianBlur',radius:2}),scaled=applyImageFilter(source,{kind:'gaussianBlur',radius:1},undefined,2);assert.deepEqual(scaled.data,baseline.data)
 for(const samplingScale of [0,-1,Infinity,NaN,129])assert.throws(()=>applyImageFilter(source,{kind:'invert'},undefined,samplingScale))
})


test('native C Dither nine algorithms and Scanlines geometry match independent RGBA references',async()=>{
 for(const [name,count] of [['dither',27],['scanlines',12]] as const){
 const fixture=JSON.parse(await readFile(`fixtures/parity/native-1.4.8-${name}.json`,'utf8')) as {rows:{spec:unknown;width:number;height:number;rgba:number[];expectedPremul:number[]}[]}
 assert.equal(fixture.rows.length,count)
 for(const row of fixture.rows){const actual=applyImageFilter(image(row.width,row.height,row.rgba),row.spec);let maximum=0;for(let i=0;i<actual.data.length;i++)maximum=Math.max(maximum,Math.abs(row.expectedPremul[i]-(i%4===3?actual.data[i]:Math.round(actual.data[i]*actual.data[i-i%4+3]/255))));assert.ok(maximum<=1,`${name} ${JSON.stringify(row.spec)}: ${maximum}`)}
 }
})

test('large motion workloads retain transparent halos, symmetric spread and premultiplied color without quadratic convolution',()=>{
 const width=512,height=256,data=new Uint8ClampedArray(width*height*4);for(let y=80;y<176;y++)for(let x=160;x<352;x++)data.set([255,0,0,255],(y*width+x)*4);for(let i=0;i<data.length;i+=4)if(!data[i+3])data[i+2]=255
 const source={width,height,data},before=new Uint8ClampedArray(data)
 for(const angle of [0,45,90]){const result=applyImageFilter(source,{kind:'motionBlur',distance:300,angle});assert.equal(result.data.length,data.length);assert.ok(result.data.some((value,index)=>index%4===3&&value>0&&value<255));for(let i=0;i<result.data.length;i+=4){assert.equal(result.data[i+1],0);assert.equal(result.data[i+2],0);if(result.data[i+3])assert.equal(result.data[i],255)}const center=(128*width+256)*4;assert.ok(result.data[center+3]>0)}
 assert.deepEqual(data,before)
})
