import { z } from 'zod'
import {EditorError} from './errors'
import {LIMITS} from './limits'

const unit = z.number().finite().min(0).max(1)
const appearance = { enabled: z.boolean().optional(), red: unit, green: unit, blue: unit, opacity: unit }
const size = z.number().finite().min(0).max(500)
const shadow = z.object({ ...appearance, angle: z.number().finite().min(-360).max(360), distance: z.number().finite().min(0).max(5000), blur: size }).passthrough()
export const layerEffectsSchema = z.object({
  stroke: z.object({ ...appearance, size, inside: z.boolean() }).passthrough().optional(),
  shadow: shadow.optional(), colorOverlay: z.object(appearance).passthrough().optional(), innerShadow: shadow.optional(),
  outerGlow: z.object({ ...appearance, size }).passthrough().optional(), innerGlow: z.object({ ...appearance, size }).passthrough().optional()
}).passthrough()
export type LayerEffects = z.infer<typeof layerEffectsSchema>
export type EffectKind = 'stroke' | 'shadow' | 'colorOverlay' | 'innerShadow' | 'outerGlow' | 'innerGlow'
export const EFFECT_KINDS: EffectKind[] = ['stroke', 'shadow', 'colorOverlay', 'innerShadow', 'outerGlow', 'innerGlow']
export const EFFECT_NAMES: Record<EffectKind, string> = { stroke: 'Stroke', shadow: 'Drop Shadow', colorOverlay: 'Color Overlay', innerShadow: 'Inner Shadow', outerGlow: 'Outer Glow', innerGlow: 'Inner Glow' }
export const validateLayerEffects = (input: unknown): LayerEffects => layerEffectsSchema.parse(input)
export function hasVisibleEffects(input:unknown):boolean {
 const effects=validateLayerEffects(input)
 return EFFECT_KINDS.some(kind=>{const effect=effects[kind];if(!effect||effect.enabled===false||effect.opacity<=0)return false;return !['stroke','outerGlow','innerGlow'].includes(kind)||Number((effect as Record<string,unknown>).size)>0})
}
export function defaultEffect(kind: EffectKind): NonNullable<LayerEffects[EffectKind]> {
  const appearance = { red: 0, green: 0, blue: 0, opacity: 1 }
  if (kind === 'stroke') return { ...appearance, size: 4, inside: false }
  if (kind === 'shadow' || kind === 'innerShadow') return { ...appearance, angle: 90, distance: kind === 'shadow' ? 20 : 10, blur: kind === 'shadow' ? 20 : 10, opacity: .5 }
  if (kind === 'outerGlow' || kind === 'innerGlow') return { ...appearance, red: 1, green: 1, blue: 1, size: kind === 'outerGlow' ? 20 : 10, opacity: .75 }
  return appearance
}
function visible<T extends { enabled?: boolean; opacity: number }>(effect: T | undefined): T | undefined { return effect?.enabled !== false && (effect?.opacity ?? 0) > 0 ? effect : undefined }
export function shadowOffset(effect: { angle: number; distance: number }): [number, number] { const radians = effect.angle * Math.PI / 180; return [-Math.cos(radians) * effect.distance, Math.sin(radians) * effect.distance] }
export function effectsMargin(effects: LayerEffects): number {
  let margin = 0
  const stroke = visible(effects.stroke), shadow = visible(effects.shadow), glow = visible(effects.outerGlow)
  if (stroke && !stroke.inside) margin = Math.max(margin, stroke.size)
  if (shadow) margin = Math.max(margin, shadow.distance + shadow.blur * 3)
  if (glow) margin = Math.max(margin, glow.size * 3)
  return Math.ceil(margin) + 2
}
export interface EffectsImage { width: number; height: number; data: Uint8Array }
export interface RenderedEffects extends EffectsImage { inset: number; offset: [number, number] }

function extrema(input: Float32Array, width: number, height: number, radius: number, maximum: boolean, horizontal: boolean): Float32Array {
  const output = new Float32Array(input.length), length = horizontal ? width : height, count = horizontal ? height : width, indexes = new Int32Array(length + radius * 2), values = new Float32Array(length + radius * 2)
  for (let line = 0; line < count; line++) {
    let head = 0, tail = 0
    for (let position = -radius; position < length + radius; position++) {
      const value = position < 0 || position >= length ? 0 : input[horizontal ? line * width + position : position * width + line]
      while (tail > head && (maximum ? values[tail - 1] <= value : values[tail - 1] >= value)) tail--
      indexes[tail] = position; values[tail++] = value
      const center = position - radius
      while (head < tail && indexes[head] < center - radius) head++
      if (center >= 0 && center < length) output[horizontal ? line * width + center : center * width + line] = values[head]
    }
  }
  return output
}
function boxBlur(input: Float32Array, width: number, height: number, radius: number, horizontal: boolean): Float32Array {
  if (!radius) return input
  const output = new Float32Array(input.length), length = horizontal ? width : height, count = horizontal ? height : width, diameter = radius * 2 + 1
  for (let line = 0; line < count; line++) {
    const at = (position: number): number => input[horizontal ? line * width + Math.min(length - 1, Math.max(0, position)) : Math.min(length - 1, Math.max(0, position)) * width + line]
    let sum = 0; for (let index = -radius; index <= radius; index++) sum += at(index)
    for (let position = 0; position < length; position++) { output[horizontal ? line * width + position : position * width + line] = sum / diameter; sum += at(position + radius + 1) - at(position - radius) }
  }
  return output
}
function gaussianApproximation(input: Float32Array, width: number, height: number, blur: number): Float32Array {
  if (blur <= 0) return input
  const sigma = blur / 2, ideal = Math.sqrt(4 * sigma * sigma + 1)
  let lower = Math.floor(ideal); if (lower % 2 === 0) lower--; lower = Math.max(1, lower)
  const larger = lower + 2, smallCount = Math.max(0, Math.min(3, Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4))))
  let output: Float32Array = input.slice()
  for (let pass = 0; pass < 3; pass++) { const radius = ((pass < smallCount ? lower : larger) - 1) / 2; output = boxBlur(boxBlur(output, width, height, radius, true), width, height, radius, false) }
  return output
}
function shifted(input: Float32Array, width: number, height: number, offset: [number, number]): Float32Array {
  const result = new Float32Array(input.length), [dx, dy] = offset
  const at = (x: number, y: number): number => x < 0 || y < 0 || x >= width || y >= height ? 0 : input[y * width + x]
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = x - dx, sy = y - dy, x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0
    result[y * width + x] = at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty
  }
  return result
}
export function renderLayerEffects(image: EffectsImage, input: LayerEffects, mask?: Uint8Array, rasterScale = 1): RenderedEffects {
  const effects = validateLayerEffects(input)
  if(!Number.isFinite(rasterScale)||rasterScale<=0||rasterScale>128)throw new EditorError('RESOURCE_LIMIT','Invalid layer effect raster scale.')
  // Document metadata remains in world pixels. A viewport may magnify the
  // same valid 500px effect; validate before converting into display pixels.
  for(const effect of Object.values(effects))if(effect&&typeof effect==='object')for(const key of ['size','blur','distance'])if(typeof (effect as Record<string,unknown>)[key]==='number')(effect as Record<string,unknown>)[key]=Number((effect as Record<string,unknown>)[key])*rasterScale
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) throw new EditorError('INVALID_ARGUMENT', 'Invalid effect source raster.')
  if (mask && mask.length !== image.width * image.height && mask.length !== 1) throw new EditorError('INVALID_ARGUMENT', 'The effect mask must match the source raster or be uniform.')
  const inset = effectsMargin(effects), width = image.width + inset * 2, height = image.height + inset * 2, pixels = width * height
  if (width > LIMITS.maxSide || height > LIMITS.maxSide || pixels > LIMITS.maxPixels) throw new EditorError('RESOURCE_LIMIT', 'The expanded effect raster exceeds the image budget.')
  // Several float planes plus output are retained; cap the live planes to a
  // bounded working budget before allocating any expanded resources.
  if (pixels * 40 > 512 * 1024 * 1024) throw new EditorError('RESOURCE_LIMIT', 'The effects working surfaces exceed 512 MiB.')
  const alpha = new Float32Array(pixels), data = new Uint8Array(pixels * 4)
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const source = y * image.width + x, destination = (y + inset) * width + x + inset; alpha[destination] = image.data[source * 4 + 3] / 255 * (mask ? mask[mask.length === 1 ? 0 : source] / 255 : 1) }
  const over = (pixel: number, red: number, green: number, blue: number, a: number): void => {
    a = Math.max(0, Math.min(1, a)); if (!a) return
    const at = pixel * 4, old = data[at + 3] / 255, next = a + old * (1 - a), color = [red, green, blue]
    for (let channel = 0; channel < 3; channel++) data[at + channel] = Math.round((color[channel] * a + data[at + channel] / 255 * old * (1 - a)) / next * 255)
    data[at + 3] = Math.round(next * 255)
  }
  const fill = (effect: { red: number; green: number; blue: number; opacity: number }, coverage: Float32Array): void => { for (let pixel = 0; pixel < pixels; pixel++) over(pixel, effect.red, effect.green, effect.blue, coverage[pixel] * effect.opacity) }
  const shadow = visible(effects.shadow), outer = visible(effects.outerGlow), stroke = visible(effects.stroke), overlay = visible(effects.colorOverlay), innerGlow = visible(effects.innerGlow), innerShadow = visible(effects.innerShadow)
  if (shadow) fill(shadow, gaussianApproximation(shifted(alpha, width, height, shadowOffset(shadow)), width, height, shadow.blur))
  if (outer && outer.size > 0) { const glow = gaussianApproximation(alpha, width, height, outer.size); for (let index = 0; index < pixels; index++) glow[index] *= 1 - alpha[index]; fill(outer, glow) }
  let ring: Float32Array | undefined
  if (stroke && stroke.size > 0) {
    const radius = Math.max(1, Math.round(stroke.size)), moved = extrema(extrema(alpha, width, height, radius, !stroke.inside, true), width, height, radius, !stroke.inside, false)
    ring = new Float32Array(pixels); for (let index = 0; index < pixels; index++) ring[index] = Math.max(0, stroke.inside ? alpha[index] - moved[index] : moved[index] - alpha[index])
    if (!stroke.inside) fill(stroke, ring)
  }
  const glowInside = innerGlow && innerGlow.size > 0 ? gaussianApproximation(alpha, width, height, innerGlow.size) : undefined
  const shadowInside = innerShadow ? gaussianApproximation(shifted(alpha, width, height, shadowOffset(innerShadow)), width, height, innerShadow.blur) : undefined
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const source = (y * image.width + x) * 4, pixel = (y + inset) * width + x + inset, color = [image.data[source] / 255, image.data[source + 1] / 255, image.data[source + 2] / 255]
    const recolor = (effect: { red: number; green: number; blue: number; opacity: number }, amount: number): void => { const strength = Math.max(0, Math.min(1, amount * effect.opacity)), target = [effect.red, effect.green, effect.blue]; for (let channel = 0; channel < 3; channel++) color[channel] = color[channel] * (1 - strength) + target[channel] * strength }
    if (overlay) recolor(overlay, 1)
    if (innerGlow && glowInside) recolor(innerGlow, 1 - glowInside[pixel])
    if (innerShadow && shadowInside) recolor(innerShadow, 1 - shadowInside[pixel])
    over(pixel, color[0], color[1], color[2], alpha[pixel])
  }
  if (stroke?.inside && ring) fill(stroke, ring)
  return { width, height, data, inset, offset: [-inset, -inset] }
}
