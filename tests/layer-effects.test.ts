import test from 'node:test'
import assert from 'node:assert/strict'
import { effectsMargin, renderLayerEffects, shadowOffset, validateLayerEffects, type EffectsImage, type RenderedEffects } from '../src/shared/layer-effects'

function source(width: number, height: number): EffectsImage { return { width, height, data: new Uint8Array(width * height * 4) } }
function set(image: EffectsImage, x: number, y: number, color: number[]): void { image.data.set(color, (y * image.width + x) * 4) }
function pixel(image: RenderedEffects, x: number, y: number): number[] { const at = ((y + image.inset) * image.width + x + image.inset) * 4; return [...image.data.subarray(at, at + 4)] }
const red = { red: 1, green: 0, blue: 0, opacity: 1 }
const blue = { red: 0, green: 0, blue: 1, opacity: 1 }

test('native effect schema validates limits and omitted enabled remains visible', () => {
  assert.equal(validateLayerEffects({ stroke: { ...red, size: 4, inside: false } }).stroke?.enabled, undefined)
  assert.throws(() => validateLayerEffects({ shadow: { ...red, distance: 5001, angle: 90, blur: 10 } }))
  assert.throws(() => validateLayerEffects({ innerGlow: { ...blue, size: -1 } }))
  assert.equal(effectsMargin({ shadow: { ...red, distance: 20, angle: 90, blur: 10, enabled: false } }), 2)
})

test('90 degree light casts a downward shadow on an expanded surface without clipping', () => {
  const image = source(3, 3); set(image, 1, 1, [0, 0, 255, 255])
  const rendered = renderLayerEffects(image, { shadow: { ...red, angle: 90, distance: 5, blur: 0 } })
  assert.deepEqual(pixel(rendered, 1, 1), [0, 0, 255, 255]); assert.deepEqual(pixel(rendered, 1, 6), [255, 0, 0, 255]); assert.deepEqual(rendered.offset, [-7, -7])
  assert.ok(Math.abs(shadowOffset({ angle: 0, distance: 5 })[0] + 5) < 1e-9)
})

test('outside stroke surrounds pixels and mask coverage changes the shape before effects', () => {
  const image = source(3, 3); set(image, 1, 1, [0, 0, 255, 255])
  const rendered = renderLayerEffects(image, { stroke: { ...red, size: 1, inside: false } })
  assert.deepEqual(pixel(rendered, 0, 0), [255, 0, 0, 255]); assert.deepEqual(pixel(rendered, 1, 1), [0, 0, 255, 255]); assert.equal(pixel(rendered, -1, -1)[3], 0)
  const hidden = renderLayerEffects(image, { stroke: { ...red, size: 1, inside: false } }, new Uint8Array(9))
  assert.ok(hidden.data.every(value => value === 0))
})

test('color overlay and inner effects recolor without inflating translucent source alpha', () => {
  const image = source(1, 1); set(image, 0, 0, [0, 0, 255, 128])
  const overlay = renderLayerEffects(image, { colorOverlay: red }); assert.deepEqual(pixel(overlay, 0, 0), [255, 0, 0, 128])
  const inner = renderLayerEffects(image, { colorOverlay: red, innerShadow: { ...blue, angle: 90, distance: 2, blur: 0 } }); assert.deepEqual(pixel(inner, 0, 0), [0, 0, 255, 128])
})

test('inside stroke covers edges; outer and inner glow affect opposite sides', () => {
  const image = source(9, 9); for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) set(image, x, y, [0, 0, 255, 255])
  const inside = renderLayerEffects(image, { stroke: { ...red, size: 1, inside: true } }); assert.deepEqual(pixel(inside, 1, 1), [255, 0, 0, 255]); assert.deepEqual(pixel(inside, 4, 4), [0, 0, 255, 255])
  const outer = renderLayerEffects(image, { outerGlow: { ...red, size: 4 } }); assert.ok(pixel(outer, 0, 4)[3] > 0); assert.deepEqual(pixel(outer, 4, 4), [0, 0, 255, 255])
  const glow = renderLayerEffects(image, { innerGlow: { ...red, size: 4 } }); assert.ok(pixel(glow, 1, 4)[0] > pixel(glow, 4, 4)[0]); assert.equal(pixel(glow, 0, 4)[3], 0)
})

test('disabled effects preserve metadata and have no visual influence; resource failure precedes allocation', () => {
  const image = source(1, 1); set(image, 0, 0, [20, 30, 40, 255])
  const rendered = renderLayerEffects(image, { colorOverlay: { ...red, enabled: false } }); assert.deepEqual(pixel(rendered, 0, 0), [20, 30, 40, 255])
  assert.throws(() => renderLayerEffects(image, { shadow: { ...red, angle: 90, distance: 5000, blur: 500 } }), /working surfaces|budget/)
})

test('viewport raster scale magnifies valid world effects after public validation',()=>{
 const image=source(1,1);set(image,0,0,[0,0,255,255]);const spec={stroke:{...red,size:64,inside:false}}
 const rendered=renderLayerEffects(image,spec,undefined,8)
 assert.equal(rendered.inset,514);assert.equal(pixel(rendered,-511,0)[3],255);assert.equal(spec.stroke.size,64)
 assert.throws(()=>validateLayerEffects({stroke:{...red,size:512,inside:false}}))
})
