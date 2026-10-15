import {posterizeChannel,thresholdWhite} from './tonal-discretization'
import {assertProgressiveBlurBudget,progressiveBlurPixels,type ProgressiveBlurPlacement} from './progressive-blur'
import {gaussianLineConvolver} from './image-filter-algorithms'
import { z } from 'zod'
import { LIMITS } from './limits'
import { cameraCalibration, cameraCalibrationSchema, cameraCurveColor, cameraCurveSchema, cameraDetailSchema, cameraGeometry, cameraGeometrySchema, cameraGradingSchema, cameraMixerSchema, cameraOptics, cameraOpticsSchema, cameraVignetteMask, cameraSharpenMask } from './camera-raw-kernels'
import {cameraRawLightColor,cameraRawAutoBalance,cameraRawBrightness,type CameraRawBrightness} from './camera-raw-adaptive'
import {cameraRawEffects,cameraRawDetail} from './camera-raw-adaptive-effects'
import { applyASCII, asciiGlyphSchema, ASCII_CHARACTERS } from './ascii-dither'

export type PixelImage = { width: number; height: number; data: Uint8ClampedArray }
const number = (min: number, max: number, fallback: number) => z.number().finite().min(min).max(max).default(fallback)
const percent = (fallback = 0) => number(-100, 100, fallback)
const unit = (fallback = 0) => number(0, 100, fallback)
const hex = z.string().regex(/^#[\da-f]{6}$/i)
const seed = z.number().int().min(0).max(0xffffffff).default(0)
const range = z.object({ black: number(0, 254, 0), white: number(1, 255, 255), gamma: number(.1, 9.99, 1), outputBlack: number(0, 255, 0), outputWhite: number(0, 255, 255) }).strict().refine(value => value.white > value.black, 'Input white must exceed input black.')
const curvePoint = z.object({ x: number(0, 255, 0), y: number(0, 255, 0) }).strict()
const curve = z.array(curvePoint).min(2).max(32).refine(points => points.every((point, index) => !index || point.x > points[index - 1].x), 'Curve inputs must strictly increase within 0 to 255.')
const identityCurve = () => [{ x: 0, y: 0 }, { x: 255, y: 255 }]
const triplet = z.tuple([percent(), percent(), percent()]).default([0, 0, 0])
export const HUE_RANGES = ['Master', 'Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'] as const
const hueRangeSchema = z.object({ range: z.enum(HUE_RANGES), hue: number(-360, 360, 0), saturation: percent(), lightness: percent(), band: z.tuple([number(0, 360, 0), number(0, 360, 0), number(0, 360, 0), number(0, 360, 0)]) }).strict()
export const imageFilterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('levels'), ranges: z.array(range).length(4).default(() => Array.from({ length: 4 }, () => range.parse({}))) }).strict(),
  z.object({ kind: z.literal('curves'), channels: z.array(curve).length(4).default(() => Array.from({ length: 4 }, identityCurve)) }).strict(),
  z.object({ kind: z.literal('hsl'), hue: number(-360, 360, 0), saturation: percent(), lightness: percent(), colorize: z.boolean().default(false), activeRange: z.enum(HUE_RANGES).default('Master'), invertRange: z.boolean().default(false), hueRanges: z.array(hueRangeSchema).max(6).refine(values => values.every(value => value.range !== 'Master') && new Set(values.map(value => value.range)).size === values.length, 'Color ranges must be unique.').default([]) }).strict(),
  z.object({ kind: z.literal('exposure'), exposure: number(-20, 20, 0), offset: number(-.5, .5, 0), gamma: number(.01, 9.99, 1) }).strict(),
  z.object({ kind: z.literal('gradientMap'), shadows: hex.default('#000000'), highlights: hex.default('#ffffff'), reversed: z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('grain'), amount: unit(25), size: number(.5, 20, 1.5), roughness: unit(50), seed }).strict(),
  z.object({ kind: z.literal('invert') }).strict(),
  z.object({ kind: z.literal('threshold'), level: z.number().int().min(1).max(255).default(128) }).strict(),
  z.object({ kind: z.literal('posterize'), levels: z.number().int().min(2).max(255).default(4) }).strict(),
  z.object({ kind: z.literal('blackWhite'), weights: z.tuple([number(-200, 300, 40), number(-200, 300, 60), number(-200, 300, 40), number(-200, 300, 60), number(-200, 300, 20), number(-200, 300, 80)]).default([40, 60, 40, 60, 20, 80]), tint: z.boolean().default(false), tintHue: number(0, 360, 40), tintSaturation: unit(20) }).strict(),
  z.object({ kind: z.literal('colorBalance'), shadows: triplet, midtones: triplet, highlights: triplet, preserveLuminosity: z.boolean().default(true) }).strict(),
  z.object({ kind: z.literal('gaussianBlur'), radius: number(.1, 250, 5), preserveTransparency:z.boolean().default(false) }).strict(),
  z.object({ kind:z.literal('progressiveBlur'),from:number(0,250,0),to:number(0,250,20),start:z.tuple([z.number().finite(),z.number().finite()]).optional(),end:z.tuple([z.number().finite(),z.number().finite()]).optional(),radial:z.boolean().default(false),inverted:z.boolean().default(false) }).strict(),
  z.object({ kind: z.literal('motionBlur'), distance: number(1, 2000, 10), angle: number(-90, 90, 0) }).strict(),
  z.object({ kind: z.literal('addNoise'), amount: number(.1, 400, 10), gaussian: z.boolean().default(false), monochromatic: z.boolean().default(false), seed }).strict(),
  z.object({ kind: z.literal('vignette'), amount: unit(35), color: hex.default('#000000'), midpoint: unit(50), roundness: percent(100), feather: unit(60), highlights: unit(25) }).strict(),
  z.object({ kind: z.literal('bloom'), amount: unit(40), radius: number(1, 150, 24) }).strict(),
  z.object({ kind: z.literal('tonalContrast'), amount: unit(50), radius: number(1, 100, 16), shadows: percent(40), midtones: percent(60), highlights: percent(30) }).strict(),
  z.object({ kind: z.literal('lensCorrection'), distortion: percent() }).strict(),
  z.object({ kind: z.literal('dither'), style: z.enum(['atkinson', 'floydSteinberg', 'bayer2', 'bayer4', 'bayer8', 'dots', 'lines', 'diamonds', 'patterns', 'ascii']).default('atkinson'), pixelSize: z.number().int().min(1).max(32).default(2), textSize: z.number().int().min(6).max(64).default(14), characters: z.string().max(64).refine(value => !/[\r\n]/.test(value)).default(ASCII_CHARACTERS), glyphs: z.array(asciiGlyphSchema).min(1).max(64).optional(), levels: z.number().int().min(2).max(8).default(2), cellSize: z.number().int().min(4).max(64).default(8), angle: number(-90, 90, 45), diffusion: unit(100), density: percent(), contrast: percent(), colors: z.enum(['blackWhite', 'twoColors', 'original']).default('blackWhite'), dark: hex.default('#000000'), light: hex.default('#ffffff'), lightOnDark: z.boolean().default(true), pixelShape: z.enum(['square', 'dot']).default('square') }).strict(),
  z.object({ kind: z.literal('scanlines'), lineSpacing: z.number().int().min(2).max(32).default(4), thickness: number(5, 100, 70), glow: unit(), dots: unit(), wobble: number(0, 64, 0), displace: percent(), smoothness: unit(50), threshold: unit(), split: number(0, 16, 0), density: percent(), contrast: percent(), blackLevel: unit(), colors: z.enum(['blackWhite', 'twoColors', 'original']).default('blackWhite'), dark: hex.default('#000000'), light: hex.default('#ffffff') }).strict(),
  z.object({ kind: z.literal('cameraRaw'), whiteBalance: z.enum(['Custom', 'Auto']).default('Custom'), temperature: percent(), tint: percent(), exposure: number(-5, 5, 0), contrast: percent(), highlights: percent(), shadows: percent(), whites: percent(), blacks: percent(), vibrance: percent(), saturation: percent(), texture: percent(), clarity: percent(), dehaze: percent(), glow: unit(), glowStyle: z.enum(['Diffusion', 'Bloom', 'Halation']).default('Diffusion'), glowRange: percent(), glowSpread: percent(), glowWarmth: percent(), vignetteAmount: percent(), vignetteStyle: z.enum(['Highlight Priority', 'Color Priority', 'Paint Overlay']).default('Highlight Priority'), vignetteMidpoint: unit(50), vignetteRoundness: percent(), vignetteFeather: unit(50), vignetteHighlights: unit(), grainAmount: unit(), grainSize: unit(25), grainRoughness: unit(50), curve: cameraCurveSchema, mixer: cameraMixerSchema, grading: cameraGradingSchema, detail: cameraDetailSchema, optics: cameraOpticsSchema, geometry: cameraGeometrySchema, calibration: cameraCalibrationSchema, seed }).strict()
])
export type ImageFilter = z.infer<typeof imageFilterSchema>
export type ImageFilterKind = ImageFilter['kind']
export const FILTER_NAMES: Record<ImageFilterKind, string> = {
  levels: 'Levels', curves: 'Curves', hsl: 'Hue/Saturation', exposure: 'Exposure', gradientMap: 'Gradient Map', grain: 'Grain', invert: 'Invert', threshold: 'Threshold', posterize: 'Posterize', blackWhite: 'Black & White', colorBalance: 'Color Balance', gaussianBlur: 'Gaussian Blur', motionBlur: 'Motion Blur', progressiveBlur:'Progressive Blur', addNoise: 'Add Noise', vignette: 'Vignette', bloom: 'Bloom / Glow', tonalContrast: 'Tonal Contrast', lensCorrection: 'Lens Correction', dither: 'Dither', scanlines: 'Scanlines', cameraRaw: 'Camera Raw Filter'
}
export const FILTER_PARITY_LIMITATIONS = ['Threshold uses native measured encoded RGB .30/.59/.11 luminance; Posterize uses equal-width channel bins with depth-specific output rounding. Native controls cover representative opaque ramps, not all precision and alpha cases. Both are limited to 8/16-bit sources; HDR is explicitly rejected.','Progressive Blur ports the native single-line/radial radius field with bounded Float32 Gaussian scale interpolation; CIMaskedVariableBlur private pixels are not verified identical. This is not Photoshop Field Blur with multiple pins.','Preserve Transparency matches the native destructive Gaussian filter. Adjustment blurPreserveTransparency is an Electron extension absent from native LayerAdjustment records; native Compositor may ignore it and render different edge colors.','Desktop and MCP ASCII rendering share the IBM Plex Mono Bold glyph atlas. Native Compositor uses Menlo/system fonts, so font pixels are not guaranteed to match.', 'Gaussian and Motion use the same integrated Gaussian kernel at every workload; large passes use FFT. Core Image internals and rotated resampling remain platform-dependent, and native references cover representative sizes, not all images.', 'Camera Raw geometry interpolation, Scanlines glow resampling and Dither block downsampling have not been compared against native reference pixels.'] as const
export function defaultFilter(kind: ImageFilterKind): ImageFilter { return imageFilterSchema.parse({ kind }) }
export const NATIVE_ADJUSTMENT_KINDS = { hsl: 'Hue/Saturation', levels: 'Levels', curves: 'Curves', exposure: 'Exposure', gradientMap: 'Gradient Map', grain: 'Grain', invert: 'Invert', blackWhite: 'Black & White', colorBalance: 'Color Balance', gaussianBlur: 'Gaussian Blur', motionBlur: 'Motion Blur', addNoise: 'Add Noise' } as const
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function nativeHex(value: unknown, fallback: string): string {
  if (value === undefined) return fallback
  const color = z.object({ red: z.number().finite().min(0).max(1), green: z.number().finite().min(0).max(1), blue: z.number().finite().min(0).max(1) }).parse(value)
  return '#' + [color.red, color.green, color.blue].map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')
}
/** Converts supported native v1.4.8 .comp adjustment records; unsupported settings fail explicitly. */
export function nativeAdjustmentToSpec(input: unknown): ImageFilter {
  const value = record(input), kind = Object.entries(NATIVE_ADJUSTMENT_KINDS).find(([, name]) => name === value.kind)?.[0] as keyof typeof NATIVE_ADJUSTMENT_KINDS | undefined
  if (!kind) return imageFilterSchema.parse(input)
  switch (kind) {
    case 'hsl': {
      const hsv = record(value.hsvSettings), raw = hsv.adjustments
      if (Array.isArray(raw) && raw.length % 2) throw new Error('Malformed native hue adjustment dictionary.')
      const adjustments = Array.isArray(raw) ? Object.fromEntries(Array.from({ length: Math.floor(raw.length / 2) }, (_, index) => [String(raw[index * 2]), raw[index * 2 + 1]])) : record(raw)
      const source = value.hsvSettings === undefined ? value : record(adjustments.Master ?? adjustments.master)
      const rawBands = hsv.bands, bands = Array.isArray(rawBands) ? Object.fromEntries(Array.from({ length: Math.floor(rawBands.length / 2) }, (_, index) => [String(rawBands[index * 2]), rawBands[index * 2 + 1]])) : record(rawBands)
      if (Array.isArray(rawBands) && rawBands.length % 2) throw new Error('Malformed native hue band dictionary.')
      const hueRanges = Object.entries(adjustments).filter(([name]) => name.toLowerCase() !== 'master').map(([name, setting]) => {
        const range = HUE_RANGES.find(range => range.toLowerCase() === name.toLowerCase()); if (!range) throw new Error(`Unknown native hue range ${name}.`)
        const band = record(bands[name] ?? bands[range]), handles = Object.keys(band).length ? ['falloffStart', 'rangeStart', 'rangeEnd', 'falloffEnd'].map(key => band[key]) : defaultHueBand(range)
        return { range, ...record(setting), band: handles }
      })
      const activeRange = typeof hsv.range === 'string' ? HUE_RANGES.find(range => range.toLowerCase() === String(hsv.range).toLowerCase()) : 'Master'
      if (!activeRange) throw new Error('Unknown native hue range.')
      return imageFilterSchema.parse({ kind, hue: source.hue, saturation: source.saturation, lightness: source.lightness, colorize: hsv.colorize ?? value.colorize, activeRange, invertRange: hsv.invertRange, hueRanges })
    }
    case 'levels': return imageFilterSchema.parse({ kind, ranges: record(value.levels).ranges })
    case 'curves': return imageFilterSchema.parse({ kind, channels: record(value.curves).channels })
    case 'exposure': return imageFilterSchema.parse({ kind, ...record(value.exposureSettings) })
    case 'gradientMap': { const settings = record(value.gradientMapSettings); return imageFilterSchema.parse({ kind, shadows: nativeHex(settings.shadows, '#000000'), highlights: nativeHex(settings.highlights, '#ffffff'), reversed: settings.reversed }) }
    case 'grain': return imageFilterSchema.parse({ kind, ...record(value.grainSettings) })
    case 'blackWhite': { const settings = record(value.blackWhiteSettings), defaults = [40, 60, 40, 60, 20, 80]; return imageFilterSchema.parse({ kind, weights: ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((key, index) => settings[key] ?? defaults[index]), tint: settings.tint, tintHue: settings.tintHue, tintSaturation: settings.tintSaturation }) }
    case 'colorBalance': { const settings = record(value.colorBalanceSettings), channels = ['CyanRed', 'MagentaGreen', 'YellowBlue']; return imageFilterSchema.parse({ kind, shadows: channels.map(key => settings['shadow' + key] ?? 0), midtones: channels.map(key => settings['mid' + key] ?? 0), highlights: channels.map(key => settings['highlight' + key] ?? 0), preserveLuminosity: settings.preserveLuminosity }) }
    case 'gaussianBlur': return imageFilterSchema.parse({ kind, radius: value.blurRadius ?? 10,preserveTransparency:value.blurPreserveTransparency??false })
    case 'motionBlur': return imageFilterSchema.parse({ kind, angle: value.motionAngle, distance: value.motionDistance })
    case 'addNoise': return imageFilterSchema.parse({ kind, amount: value.noiseAmount, gaussian: value.noiseGaussian, monochromatic: value.noiseMonochromatic, seed: value.noiseSeed })
    case 'invert': return imageFilterSchema.parse({ kind })
  }
}
/** Writes the required native base fields as well as the selected adjustment's optional settings. */
export function specToNativeAdjustment(input: unknown): Record<string, unknown> {
  const spec = imageFilterSchema.parse(input)
  if (!(spec.kind in NATIVE_ADJUSTMENT_KINDS)) throw new Error('This filter is not a native adjustment layer kind.')
  const base: Record<string, unknown> = { kind: NATIVE_ADJUSTMENT_KINDS[spec.kind as keyof typeof NATIVE_ADJUSTMENT_KINDS], hue: 0, saturation: 0, lightness: 0, colorize: false, levels: { channel: 'RGB', ranges: Array.from({ length: 4 }, () => range.parse({})) }, curves: { channel: 'RGB', channels: Array.from({ length: 4 }, identityCurve) } }
  switch (spec.kind) {
    case 'hsl': {
      Object.assign(base, { hue: spec.hue, saturation: spec.saturation, lightness: spec.lightness, colorize: spec.colorize })
      if (spec.hueRanges.length || spec.invertRange || spec.activeRange !== 'Master') {
        const adjustments: unknown[] = ['Master', { hue: spec.hue, saturation: spec.saturation, lightness: spec.lightness }], bands: unknown[] = []
        spec.hueRanges.forEach(range => { adjustments.push(range.range, { hue: range.hue, saturation: range.saturation, lightness: range.lightness }); bands.push(range.range, { falloffStart: range.band[0], rangeStart: range.band[1], rangeEnd: range.band[2], falloffEnd: range.band[3] }) })
        base.hsvSettings = { range: spec.activeRange, colorize: spec.colorize, invertRange: spec.invertRange, adjustments, bands }
      }
      break
    }
    case 'levels': base.levels = { channel: 'RGB', ranges: spec.ranges }; break
    case 'curves': base.curves = { channel: 'RGB', channels: spec.channels }; break
    case 'exposure': base.exposureSettings = { exposure: spec.exposure, offset: spec.offset, gamma: spec.gamma }; break
    case 'gradientMap': { const native = (value: string) => { const color = rgb(value); return { red: color[0], green: color[1], blue: color[2] } }; base.gradientMapSettings = { shadows: native(spec.shadows), highlights: native(spec.highlights), reversed: spec.reversed }; break }
    case 'grain': base.grainSettings = { amount: spec.amount, size: spec.size, roughness: spec.roughness, seed: spec.seed }; break
    case 'blackWhite': base.blackWhiteSettings = { ...Object.fromEntries(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'].map((key, index) => [key, spec.weights[index]])), tint: spec.tint, tintHue: spec.tintHue, tintSaturation: spec.tintSaturation }; break
    case 'colorBalance': { const settings: Record<string, unknown> = { preserveLuminosity: spec.preserveLuminosity }, channels = ['CyanRed', 'MagentaGreen', 'YellowBlue']; for (const [prefix, values] of [['shadow', spec.shadows], ['mid', spec.midtones], ['highlight', spec.highlights]] as const) channels.forEach((key, index) => { settings[prefix + key] = values[index] }); base.colorBalanceSettings = settings; break }
    case 'gaussianBlur': base.blurRadius = spec.radius;base.blurPreserveTransparency=spec.preserveTransparency; break
    case 'motionBlur': Object.assign(base, { motionAngle: spec.angle, motionDistance: spec.distance }); break
    case 'addNoise': Object.assign(base, { noiseAmount: spec.amount, noiseGaussian: spec.gaussian, noiseMonochromatic: spec.monochromatic, noiseSeed: spec.seed }); break
  }
  return base
}
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const byte = (value: number) => Math.round(clamp(value, 0, 255))
const rgb = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
const luminance = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
const encoded = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055
function validateImage(image: PixelImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > LIMITS.maxSide || image.height > LIMITS.maxSide || image.width * image.height > LIMITS.maxSurfacePixels || image.data.length !== image.width * image.height * 4) throw new Error('Expected a bounded straight RGBA8 image.')
}
function mapColors(image: PixelImage, operation: (r: number, g: number, b: number, x: number, y: number) => number[]): PixelImage {
  const result = { ...image, data: new Uint8ClampedArray(image.data) }
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (!image.data[offset + 3]) continue
    const pixel = offset / 4, color = operation(image.data[offset] / 255, image.data[offset + 1] / 255, image.data[offset + 2] / 255, pixel % image.width, Math.floor(pixel / image.width))
    for (let channel = 0; channel < 3; channel++) result.data[offset + channel] = byte(color[channel] * 255)
  }
  return result
}
export function curveValue(points: { x: number; y: number }[], x: number): number {
  // Horizontal input endpoints clip to their output values outside the active range.
  if (x <= points[0].x) return points[0].y
  if (x >= points.at(-1)!.x) return points.at(-1)!.y
  let index = 0; while (index < points.length - 2 && points[index + 1].x <= x) index++
  const deltas = points.slice(1).map((point, at) => (point.y - points[at].y) / (point.x - points[at].x))
  const slope = (at: number) => at === 0 ? deltas[0] : at === points.length - 1 ? deltas.at(-1)! : deltas[at - 1] * deltas[at] <= 0 ? 0 : 2 / (1 / deltas[at - 1] + 1 / deltas[at])
  const start = points[index], end = points[index + 1], h = end.x - start.x, t = clamp((x - start.x) / h)
  return clamp((2 * t ** 3 - 3 * t * t + 1) * start.y + (t ** 3 - 2 * t * t + t) * h * slope(index) + (-2 * t ** 3 + 3 * t * t) * end.y + (t ** 3 - t * t) * h * slope(index + 1), 0, 255)
}
function hsl(r: number, g: number, b: number): number[] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 2
  let hue = 0
  if (delta) hue = (max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6
  return [hue * 360, delta ? delta / (1 - Math.abs(2 * light - 1)) : 0, light]
}
function fromHSL(hue: number, saturation: number, lightness: number): number[] {
  hue = ((hue % 360) + 360) % 360 / 60
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = lightness - c / 2
  const color = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  return color.map(value => value + m)
}
export function defaultHueBand(range: typeof HUE_RANGES[number]): [number, number, number, number] {
  const bands: [number, number, number, number][] = [[0, 0, 360, 360], [315, 345, 15, 45], [15, 45, 75, 105], [75, 105, 135, 165], [135, 165, 195, 225], [195, 225, 255, 285], [255, 285, 315, 345]]
  return [...bands[HUE_RANGES.indexOf(range)]]
}
function hueSaturation(image: PixelImage, settings: Extract<ImageFilter, { kind: 'hsl' }>): PixelImage {
  if (!settings.colorize && settings.hue === 0 && settings.saturation === 0 && settings.lightness === 0 && settings.hueRanges.every(range => range.hue === 0 && range.saturation === 0 && range.lightness === 0)) return { ...image,data:new Uint8ClampedArray(image.data) }
  const forward = (from: number, to: number) => ((to - from) % 360 + 360) % 360
  const weight = (band: number[], hue: number) => { const span = forward(band[0], band[3]), position = forward(band[0], hue), rampIn = forward(band[0], band[1]), plateau = forward(band[0], band[2]); if (!span) return 1; if (position > span) return 0; return position < rampIn ? rampIn ? position / rampIn : 1 : position <= plateau ? 1 : span > plateau ? (span - position) / (span - plateau) : 1 }
  const transform = (r:number,g:number,b:number) => {
    let [hue, saturation, light] = hsl(r, g, b), shift = settings.hue, saturationShift = settings.saturation, lightShift = settings.lightness
    if (settings.colorize) {
      const selected = settings.hueRanges.find(range => range.range === settings.activeRange); hue = selected?.hue ?? settings.hue; saturation = clamp((selected?.saturation ?? settings.saturation) / 100); lightShift = selected?.lightness ?? settings.lightness
    } else {
      for (const range of settings.hueRanges) { let strength = weight(range.band, Math.round(hue)); if (settings.invertRange && settings.activeRange === range.range) strength = 1 - strength; shift += range.hue * strength; saturationShift += range.saturation * strength; lightShift += range.lightness * strength }
      // PS 27.11 cube references establish RGB Lightness before Saturation.
      // Preserve the original hue for range weighting; the RGB blend keeps hue.
      const lightAmount = clamp(lightShift / 100, -1, 1)
      const mixed = [r, g, b].map(value => lightAmount < 0 ? value * (1 + lightAmount) : value + (1 - value) * lightAmount)
      ;[, saturation, light] = hsl(mixed[0], mixed[1], mixed[2])
      hue += shift; const amount = clamp(saturationShift / 100, -1, 1); saturation = amount <= 0 ? saturation * (1 + amount) : amount >= 1 ? saturation > 0 ? 1 : 0 : clamp(saturation / (1 - amount))
      return fromHSL(hue, saturation, light)
    }
    // Colorize retains Compositor semantics until independently measured in PS.
    const amount = clamp(lightShift / 100, -1, 1)
    light = amount >= 0 ? light + (1 - light) * amount : light * (1 + amount)
    return fromHSL(hue, saturation, light)
  }
  const key=JSON.stringify(settings);let cube=hslCubes.get(key)
  if(!cube){ cube=new Float32Array(33**3*3);for(let blue=0;blue<33;blue++)for(let green=0;green<33;green++)for(let red=0;red<33;red++)cube.set(transform(red/32,green/32,blue/32),(red+green*33+blue*33*33)*3);if(hslCubes.size>=8)hslCubes.delete(hslCubes.keys().next().value!);hslCubes.set(key,cube) }
  const table=cube
  return mapColors(image,(r,g,b,x,y)=>{
    const alpha=image.data[(y*image.width+x)*4+3], position=[r,g,b].map(value=>Math.round(value*alpha)/alpha*32),low=position.map(value=>Math.min(31,Math.floor(value))),fraction=position.map((value,index)=>value-low[index]),base=(low[0]+low[1]*33+low[2]*33*33)*3
    return [0,1,2].map(channel=>{ const at=base+channel,sx=3,sy=33*3,sz=33*33*3,x00=table[at]+(table[at+sx]-table[at])*fraction[0],x10=table[at+sy]+(table[at+sy+sx]-table[at+sy])*fraction[0],x01=table[at+sz]+(table[at+sz+sx]-table[at+sz])*fraction[0],x11=table[at+sz+sy]+(table[at+sz+sy+sx]-table[at+sz+sy])*fraction[0],y0=x00+(x10-x00)*fraction[1],y1=x01+(x11-x01)*fraction[1];return y0+(y1-y0)*fraction[2] })
  })
}
const hslCubes=new Map<string,Float32Array>()
function mix32(value: number): number { value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); return (value ^ value >>> 16) >>> 0 }
const noiseUnit = (key: number) => (mix32(key) >>> 8) / 16777216
function grainField(u: number, v: number, scale: number, seed: number): number {
  const x = Math.floor(u / scale), y = Math.floor(v / scale), smooth = (t: number) => t * t * (3 - 2 * t), tx = smooth(u / scale - x), ty = smooth(v / scale - y)
  const lattice = (ix: number, iy: number) => { const hash = mix32(Math.imul(ix, 0x9e3779b1) ^ mix32(Math.imul(iy, 0x85ebca77) ^ seed)); return (hash & 65535) / 65535 + (hash >>> 16) / 65535 - 1 }
  const top = lattice(x, y) * (1 - tx) + lattice(x + 1, y) * tx, bottom = lattice(x, y + 1) * (1 - tx) + lattice(x + 1, y + 1) * tx
  return (top * (1 - ty) + bottom * ty) * 1.6
}
function premultiply(image: PixelImage): Uint8ClampedArray {
  const result = new Uint8ClampedArray(image.data)
  for (let at = 0; at < result.length; at += 4) for (let channel = 0; channel < 3; channel++) result[at + channel] = Math.round(result[at + channel] * result[at + 3] / 255)
  return result
}
function unpremultiply(image: PixelImage): PixelImage {
  for (let at = 0; at < image.data.length; at += 4) for (let channel = 0; channel < 3; channel++) image.data[at + channel] = image.data[at + 3] ? byte(image.data[at + channel] * 255 / image.data[at + 3]) : 0
  return image
}
// Gaussian weights integrate each pixel footprint, as Core Image does for small sigma.
function erf(value: number): number {
  const sign = value < 0 ? -1 : 1, x = Math.abs(value), t = 1 / (1 + .3275911 * x)
  return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x))
}
export interface GaussianClampSides {left?:boolean;right?:boolean;top?:boolean;bottom?:boolean}
export interface FilterRuntimeOptions {gaussianClampSides?:GaussianClampSides;progressivePlacement?:ProgressiveBlurPlacement}
function gaussianBlur(image: PixelImage, sigma: number, clampEdges:boolean|GaussianClampSides = false,preserveTransparency=false): PixelImage {
  const sides=typeof clampEdges==='boolean'?{left:clampEdges,right:clampEdges,top:clampEdges,bottom:clampEdges}:clampEdges
  const radius = Math.max(1, Math.ceil(sigma * 3)), source = preserveTransparency?Float32Array.from(image.data,(v,i)=>i%4===3?v:v*image.data[i-i%4+3]/255):premultiply(image), data = preserveTransparency?new Float32Array(source.length):new Uint8ClampedArray(source.length), temp = new Float32Array(image.width * image.height)
  if ((Math.min(image.width, radius*2+1) + Math.min(image.height, radius*2+1)) * image.width * image.height <= 80_000_000) {
    const weights = Array.from({ length: radius * 2 + 1 }, (_, index) => { const center = index-radius; return .5 * (erf((center+.5)/(sigma*Math.SQRT2)) - erf((center-.5)/(sigma*Math.SQRT2))) }), sum = weights.reduce((a,b) => a+b, 0)
    for (let index = 0; index < weights.length; index++) weights[index] /= sum
    for (let channel = 0; channel < 4; channel++) {
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { let value = 0; for (let tap = sides.left?-radius:Math.max(-radius,-x); tap <= (sides.right?radius:Math.min(radius,image.width-1-x)); tap++) value += source[(y * image.width + clamp(x + tap,0,image.width-1)) * 4 + channel] * weights[tap + radius]; temp[y * image.width + x] = value }
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { let value = 0; for (let tap = sides.top?-radius:Math.max(-radius,-y); tap <= (sides.bottom?radius:Math.min(radius,image.height-1-y)); tap++) value += temp[(clamp(y+tap,0,image.height-1) * image.width + x)] * weights[tap + radius]; data[(y * image.width + x) * 4 + channel] = preserveTransparency?value:Math.round(value) }
    }
  } else {
    const horizontal=gaussianLineConvolver(image.width,sigma,{start:sides.left,end:sides.right}),vertical=gaussianLineConvolver(image.height,sigma,{start:sides.top,end:sides.bottom})
    for(let channel=0;channel<4;channel++) {
      const row=new Float32Array(image.width),column=new Float32Array(image.height)
      for(let y=0;y<image.height;y++){for(let x=0;x<image.width;x++)row[x]=source[(y*image.width+x)*4+channel];temp.set(horizontal(row),y*image.width)}
      for(let x=0;x<image.width;x++){for(let y=0;y<image.height;y++)column[y]=temp[y*image.width+x];const result=vertical(column);for(let y=0;y<image.height;y++)data[(y*image.width+x)*4+channel]=preserveTransparency?result[y]:Math.round(result[y])}
    }
  }
  if(preserveTransparency){const straight=new Uint8ClampedArray(data.length);for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)straight[i+c]=image.data[i+3]&&data[i+3]?Math.round(data[i+c]*255/data[i+3]):0;straight[i+3]=image.data[i+3]}return {...image,data:straight}}
  return unpremultiply({ ...image, data:data as Uint8ClampedArray })
}
function sample(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, transparent = false): number[] {
  if (transparent) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, color = [0,0,0,0]
    for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) { const sx = x0 + column, sy = y0 + row; if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue; const weight = (column ? fx : 1-fx) * (row ? fy : 1-fy), at = (sy * width + sx)*4; for(let channel = 0; channel < 4; channel++) color[channel] += data[at+channel] * weight }
    return color
  }
  x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1)
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = x - x0, fy = y - y0
  return [0, 1, 2, 3].map(channel => data[(y0 * width + x0) * 4 + channel] * (1 - fx) * (1 - fy) + data[(y0 * width + x1) * 4 + channel] * fx * (1 - fy) + data[(y1 * width + x0) * 4 + channel] * (1 - fx) * fy + data[(y1 * width + x1) * 4 + channel] * fx * fy)
}
function motionBlur(image: PixelImage, distance: number, angle: number): PixelImage {
  if (Math.abs(angle % 90) > 1e-8) return rotatedMotionBlur(image,distance,angle)
  const source=premultiply(image),data=new Uint8ClampedArray(source.length),vertical=Math.abs(Math.sin(angle*Math.PI/180))>.5,length=vertical?image.height:image.width,lines=vertical?image.width:image.height,convolve=gaussianLineConvolver(length,distance/Math.sqrt(12)),line=new Float32Array(length)
  for(let channel=0;channel<4;channel++)for(let i=0;i<lines;i++){for(let j=0;j<length;j++)line[j]=source[((vertical?j:i)*image.width+(vertical?i:j))*4+channel];const result=convolve(line);for(let j=0;j<length;j++)data[((vertical?j:i)*image.width+(vertical?i:j))*4+channel]=Math.round(result[j])}
  return unpremultiply({...image,data})
}

function rotatedMotionBlur(image:PixelImage,distance:number,angle:number):PixelImage {
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),sigma=distance/Math.sqrt(12),radius=Math.max(1,Math.ceil(sigma*3)),source=premultiply(image),corners=[[0,0],[image.width,0],[0,image.height],[image.width,image.height]],u=corners.map(([x,y])=>x*c+(image.height-y)*s),v=corners.map(([x,y])=>-x*s+(image.height-y)*c),left=Math.floor(Math.min(...u))-1,top=Math.floor(Math.min(...v))-1,width=Math.ceil(Math.max(...u))-left+1,height=Math.ceil(Math.max(...v))-top+1
  if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new Error('Rotated motion intermediate exceeds working-surface limits.')
  const transformed=new Uint8ClampedArray(width*height*4),blurred=new Uint8ClampedArray(transformed.length),weights=Array.from({length:radius*2+1},(_,i)=>.5*(erf((i-radius+.5)/(sigma*Math.SQRT2))-erf((i-radius-.5)/(sigma*Math.SQRT2)))),sum=weights.reduce((a,b)=>a+b,0)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=x+left+.5,v=y+top+.5;transformed.set(sample(source,image.width,image.height,u*c-v*s-.5,image.height-(u*s+v*c)-.5,true).map(Math.round),(y*width+x)*4)}
  if(width*height*Math.min(width,2*radius+1)<=20_000_000){
   for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let channel=0;channel<4;channel++){let value=0;for(let tap=Math.max(-radius,-x);tap<=Math.min(radius,width-1-x);tap++)value+=transformed[(y*width+x+tap)*4+channel]*weights[tap+radius];blurred[(y*width+x)*4+channel]=Math.round(value/sum)}
  }else {const convolve=gaussianLineConvolver(width,sigma),line=new Float32Array(width);for(let y=0;y<height;y++)for(let channel=0;channel<4;channel++){for(let x=0;x<width;x++)line[x]=transformed[(y*width+x)*4+channel];const output=convolve(line);for(let x=0;x<width;x++)blurred[(y*width+x)*4+channel]=Math.round(output[x])}}
  const data=new Uint8ClampedArray(source.length)
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const u=(x+.5)*c+(image.height-y-.5)*s,v=-(x+.5)*s+(image.height-y-.5)*c;data.set(sample(blurred,width,height,u-left-.5,v-top-.5,true).map(Math.round),(y*image.width+x)*4)}
  return unpremultiply({...image,data})
}
function toneContrast(image: PixelImage, settings: Extract<ImageFilter, { kind: 'tonalContrast' }>): PixelImage {
  const blurred = gaussianBlur(image, settings.radius)
  return mapColors(image, (r, g, b, x, y) => {
    const at = (y * image.width + x) * 4, value = luminance(r, g, b), low = luminance(blurred.data[at], blurred.data[at + 1], blurred.data[at + 2]) / 255
    const smooth = (low: number, high: number, value: number) => { const t = clamp((value-low)/(high-low)); return t*t*(3-2*t) }, shadowWeight = 1-smooth(.15,.5,low), highlightWeight=smooth(.5,.85,low), midtoneWeight=1-shadowWeight-highlightWeight
    const strength = (settings.shadows*shadowWeight + settings.midtones*midtoneWeight + settings.highlights*highlightWeight)/100
    const delta = .18*Math.tanh((value-low)*6)*strength*settings.amount/50*(4*value*(1-value))
    return [r + delta, g + delta, b + delta]
  })
}
function bloom(image: PixelImage, amount: number, radius: number): PixelImage {
  const blurred = gaussianBlur(image, radius), source = premultiply(image), glow = premultiply(blurred), data = new Uint8ClampedArray(source.length)
  for(let at=0;at<data.length;at++) data[at] = Math.max(source[at],Math.round(source[at]+(glow[at]-source[at])*amount/50))
  return unpremultiply({...image,data})
}
function vignette(image: PixelImage, settings: Extract<ImageFilter, { kind: 'vignette' }>): PixelImage {
  const color = rgb(settings.color)
  return mapColors(image, (r, g, b, x, y) => {
    const mask = cameraVignetteMask(x, y, image.width, image.height, settings.midpoint, settings.roundness, settings.feather), protect = 1 - settings.highlights / 100 * clamp((luminance(r, g, b) - .45) / .55), amount = mask * settings.amount / 100 * protect
    return [r, g, b].map((value, channel) => value * (1 - amount) + color[channel] * amount)
  })
}
function lensCorrection(image: PixelImage, distortion: number): PixelImage {
  if (!distortion) return { ...image, data: new Uint8ClampedArray(image.data) }
  const data = new Uint8ClampedArray(image.data.length), source = premultiply(image), centerX = image.width / 2, centerY = image.height / 2, diagonal = centerX * centerX + centerY * centerY
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const dx = x + .5 - centerX, dy = y + .5 - centerY, factor = 1 - distortion / 100 * .35 * (dx * dx + dy * dy) / diagonal, sx = centerX + dx * factor - .5, sy = centerY + dy * factor - .5, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0, sums = [0, 0, 0, 0]
    for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
      const ix = x0 + column, iy = y0 + row
      if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue
      const weight = (column ? fx : 1 - fx) * (row ? fy : 1 - fy), at = (iy * image.width + ix) * 4
      for (let channel = 0; channel < 4; channel++) sums[channel] += source[at + channel] * weight
    }
    const at = (y * image.width + x) * 4; for (let channel = 0; channel < 4; channel++) data[at + channel] = Math.round(sums[channel])
  }
  return unpremultiply({ ...image, data })
}
function cameraRaw(image: PixelImage, settings: Extract<ImageFilter, { kind: 'cameraRaw' }>, preview: CameraRawPreviewOptions = {}): PixelImage {
  if (!preview.clipping && !preview.sharpenMask && !(preview.visualizePointColor! >= 0)) image = cameraGeometry(image, settings.geometry)
  const brightness=preview.brightness??((settings.contrast||settings.highlights)?cameraRawBrightness(image):undefined)
  if (!preview.clipping && !preview.sharpenMask) image = cameraCalibration(image, settings.calibration)
  const foldsColor=!preview.clipping&&!preview.sharpenMask&&!(preview.visualizePointColor!>=0)&&!settings.mixer.points.length&&settings.curve.refineSaturation===0
  if (settings.whiteBalance === 'Auto') settings = { ...settings, ...cameraRawAutoBalance(image) }
  let result = cameraRawLightColor(image,settings,preview.clipping,foldsColor,brightness,preview.samplingScale)
  if (preview.clipping) return result
  if (preview.sharpenMask) return cameraSharpenMask(result, settings.detail)
  if (!foldsColor&&(preview.visualizePointColor! >= 0 || JSON.stringify(settings.curve) !== JSON.stringify(cameraCurveSchema.parse({})) || JSON.stringify(settings.mixer) !== JSON.stringify(cameraMixerSchema.parse({})) || JSON.stringify(settings.grading) !== JSON.stringify(cameraGradingSchema.parse({})))) result = cameraCurveColor(result, settings.curve, settings.mixer, settings.grading, preview.visualizePointColor ?? -1)
  if ([settings.texture, settings.clarity, settings.dehaze, settings.glow, settings.vignetteAmount].some(value => value !== 0)) result = cameraRawEffects(result, settings)
  if (settings.grainAmount) result = applyImageFilter(result, { kind: 'grain', amount: settings.grainAmount, size: .5 + settings.grainSize / 100 * 19.5, roughness: settings.grainRoughness, seed: settings.seed })
  result = cameraRawDetail(cameraOptics(result, settings.optics, lensCorrection), settings.detail)
  return result
}

/** Immutable straight-RGBA pipeline. Coverage is a layer-pixel selection mask, not canvas coordinates. */
export function applyImageFilter(image: PixelImage, input: unknown, coverage?: Uint8Array, samplingScale = 1,knownBrightness?:CameraRawBrightness,runtime:FilterRuntimeOptions={}): PixelImage {
  validateImage(image); const settings = imageFilterSchema.parse(input)
  if(!Number.isFinite(samplingScale)||samplingScale<=0||samplingScale>128)throw new Error('Runtime filter sampling scale must be finite and in (0, 128].')
  // Persisted document parameters are validated before converting to viewport pixels.
  // Running the scaled values through the persistence schema would reject valid zoom/HiDPI.
  if(settings.kind==='gaussianBlur')settings.radius*=samplingScale
  if(settings.kind==='motionBlur')settings.distance*=samplingScale
  if(settings.kind==='progressiveBlur'){settings.from*=samplingScale;settings.to*=samplingScale;if(!runtime.progressivePlacement){if(settings.start)settings.start=settings.start.map(v=>v*samplingScale) as [number,number];if(settings.end)settings.end=settings.end.map(v=>v*samplingScale) as [number,number]}}
  if (coverage && coverage.length !== image.width * image.height) throw new Error('Filter selection dimensions do not match the image.')
  const output = settings.kind==='cameraRaw'?cameraRaw(image,settings,{brightness:knownBrightness,samplingScale}):run(image, settings,runtime)
  if (!coverage) return output
  for (let pixel = 0; pixel < coverage.length; pixel++) {
    const at = pixel * 4, amount = coverage[pixel] / 255, oldAlpha = image.data[at + 3], newAlpha = output.data[at + 3], alpha = oldAlpha * (1 - amount) + newAlpha * amount
    for (let channel = 0; channel < 3; channel++) output.data[at + channel] = alpha ? byte((image.data[at + channel] * oldAlpha * (1 - amount) + output.data[at + channel] * newAlpha * amount) / alpha) : 0
    output.data[at + 3] = byte(alpha)
  }
  return output
}
function run(image: PixelImage, settings: ImageFilter,runtime:FilterRuntimeOptions={}): PixelImage {
  switch (settings.kind) {
    case 'invert': return mapColors(image, (r, g, b) => [1 - r, 1 - g, 1 - b])
    case 'threshold': return mapColors(image,(r,g,b)=>{const value=thresholdWhite(Math.round(r*255),Math.round(g*255),Math.round(b*255),255,settings.level,8)?1:0;return [value,value,value]})
    case 'posterize': return mapColors(image,(r,g,b)=>[r,g,b].map(value=>posterizeChannel(value,settings.levels,8)))
    case 'levels': {
      const level = (value: number, levelRange: z.infer<typeof range>) => (levelRange.outputBlack + clamp((value * 255 - levelRange.black) / (levelRange.white - levelRange.black)) ** (1 / levelRange.gamma) * (levelRange.outputWhite - levelRange.outputBlack)) / 255
      return mapColors(image, (r, g, b) => [r, g, b].map((value, channel) => level(level(value, settings.ranges[channel + 1]), settings.ranges[0])))
    }
    case 'curves': return mapColors(image, (r, g, b) => [r, g, b].map((value, channel) => curveValue(settings.channels[0], curveValue(settings.channels[channel + 1], value * 255)) / 255))
    case 'hsl': return hueSaturation(image, settings)
    case 'exposure': return mapColors(image, (r, g, b) => [r, g, b].map(value => encoded(Math.max(0, linear(value) * 2 ** settings.exposure + settings.offset) ** (1 / settings.gamma))))
    case 'gradientMap': { const dark = rgb(settings.reversed ? settings.highlights : settings.shadows), light = rgb(settings.reversed ? settings.shadows : settings.highlights); return mapColors(image, (r, g, b) => { const value = Math.round(luminance(r, g, b) * 255) / 255; return dark.map((channel, i) => channel + (light[i] - channel) * value) }) }
    case 'grain': return mapColors(image, (r, g, b, x, y) => { const smooth = grainField(x + .5, y + .5, settings.size, settings.seed), fine = grainField(x + .5, y + .5, Math.max(.5, settings.size * .35), mix32(settings.seed ^ 0xa511e9b3)), value = luminance(r, g, b), delta = (smooth + (fine - smooth) * settings.roughness / 100) * settings.amount / 100 * .35 * (.4 + 2.4 * value * (1 - value)); return [r + delta, g + delta, b + delta] })
    case 'blackWhite': return mapColors(image, (r, g, b) => { const max = Math.max(r, g, b), min = Math.min(r, g, b), mid = r + g + b - max - min, primary = max === r ? 0 : max === g ? 2 : 4, secondary = max === r ? g >= b ? 1 : 5 : max === g ? r >= b ? 1 : 3 : g >= r ? 3 : 5, gray = clamp(min + (mid - min) * settings.weights[secondary] / 100 + (max - mid) * settings.weights[primary] / 100); return settings.tint ? fromHSL(settings.tintHue, settings.tintSaturation / 100, gray) : [gray, gray, gray] })
    case 'colorBalance': return mapColors(image, (r, g, b) => { const before = .299 * r + .587 * g + .114 * b, color = [r, g, b].map((value, channel) => { const shadow = clamp((value - .333) / -.25 + .5) * .7, mid = clamp((value - .333) / .25 + .5) * clamp((value + .333 - 1) / -.25 + .5) * .7, high = clamp((value + .333 - 1) / .25 + .5) * .7; return clamp(value + (settings.shadows[channel] * shadow + settings.midtones[channel] * mid + settings.highlights[channel] * high) / 100) }); const after = .299 * color[0] + .587 * color[1] + .114 * color[2]; return settings.preserveLuminosity && after > .0001 ? color.map(value => value * before / after) : color })
    case 'gaussianBlur': return gaussianBlur(image,settings.radius,settings.preserveTransparency?false:runtime.gaussianClampSides??false,settings.preserveTransparency)
    case 'progressiveBlur': {if(!settings.from&&!settings.to)return {...image,data:image.data.slice()};assertProgressiveBlurBudget(image.width,image.height,settings);const source=new Float32Array(image.data.length);for(let at=0;at<source.length;at+=4){const a=image.data[at+3]/255;for(let c=0;c<3;c++)source[at+c]=image.data[at+c]/255*a;source[at+3]=a}const result=progressiveBlurPixels(source,image.width,image.height,settings,runtime.gaussianClampSides,runtime.progressivePlacement),data=new Uint8ClampedArray(result.length);for(let at=0;at<data.length;at+=4){const a=Math.max(0,Math.min(1,result[at+3]));for(let c=0;c<3;c++)data[at+c]=a?Math.round(result[at+c]/a*255):0;data[at+3]=Math.round(a*255)}return {...image,data}}
    case 'motionBlur': return motionBlur(image, settings.distance, settings.angle)
    case 'addNoise': return mapColors(image, (r, g, b, x, y) => { const base = mix32(settings.seed ^ mix32(Math.imul(x, 0x9e3779b9) ^ mix32(Math.imul(y, 0x85ebca6b)))); return [r, g, b].map((value, channel) => { const key = settings.monochromatic ? base : (base + Math.imul(channel, 0x9e3779b9)) >>> 0, spread = settings.amount / 100 * .5, noise = settings.gaussian ? Math.sqrt(-2 * Math.log(1 - noiseUnit(key))) * Math.cos(2 * Math.PI * noiseUnit(key ^ 0x68e31da4)) * spread * 2 / 3 : (noiseUnit(key) * 2 - 1) * spread; return value + noise }) })
    case 'vignette': return vignette(image, settings)
    case 'bloom': return bloom(image, settings.amount, settings.radius)
    case 'tonalContrast': return toneContrast(image, settings)
    case 'lensCorrection': return lensCorrection(image, settings.distortion)
    case 'cameraRaw': return cameraRaw(image, settings)
    case 'dither': return dither(image, settings)
    case 'scanlines': return scanlines(image, settings)
  }
}

const bayer2 = [0, 2, 3, 1], bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], bayer8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21]
const patterns = [[0, 0, 0, 0, 0, 0, 0, 0], [128, 0, 0, 0, 8, 0, 0, 0], [136, 0, 34, 0, 136, 0, 34, 0], [128, 64, 32, 16, 8, 4, 2, 1], [136, 34, 136, 34, 136, 34, 136, 34], [0, 255, 0, 0, 0, 255, 0, 0], [17, 34, 68, 136, 17, 34, 68, 136], [170, 0, 170, 0, 170, 0, 170, 0], [136, 85, 34, 85, 136, 85, 34, 85], [255, 128, 128, 128, 255, 8, 8, 8], [170, 85, 170, 85, 170, 85, 170, 85], [129, 66, 36, 24, 24, 36, 66, 129], [119, 170, 221, 170, 119, 170, 221, 170], [238, 221, 187, 119, 238, 221, 187, 119], [119, 255, 221, 255, 119, 255, 221, 255], [127, 255, 255, 255, 247, 255, 255, 255], [255, 255, 255, 255, 255, 255, 255, 255]]
function adjustedTone(value: number, density: number, contrast: number): number { return clamp((clamp(value) ** (2 ** (density / 100 * 1.5)) - .5) * (contrast >= 0 ? 1 / (1 - .95 * contrast / 100) : 1 + contrast / 100) + .5) }
function dither(image: PixelImage, settings: Extract<ImageFilter, { kind: 'dither' }>): PixelImage {
  if (settings.style === 'ascii') return applyASCII(image, settings)
  const block = settings.pixelSize, width = Math.ceil(image.width / block), height = Math.ceil(image.height / block), planes = settings.colors === 'original' ? 3 : 1, values = Array.from({ length: planes }, () => new Float32Array(width * height)), alphas = new Uint8Array(width * height), original=new Float32Array(width*height*3),source=premultiply(image)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sums = [0, 0, 0], at = y * width + x; let total = 0,n=0
    for (let by = 0; by < block && y * block + by < image.height; by++) for (let bx = 0; bx < block && x * block + bx < image.width; bx++) {
      const offset = ((y * block + by) * image.width + x * block + bx) * 4, alpha = source[offset + 3]; total += alpha;n++
      for (let channel = 0; channel < 3; channel++) sums[channel] += source[offset + channel]
    }
    alphas[at] = Math.round(total/n)
    const color = sums.map(value => total ? value / total : 0);original.set(color,at*3)
    for (let plane = 0; plane < planes; plane++) values[plane][at] = adjustedTone(planes === 1 ? luminance(color[0], color[1], color[2]) : color[plane], settings.density, settings.contrast)
  }
  const steps = settings.levels - 1, diffuse = settings.style === 'atkinson' || settings.style === 'floydSteinberg'
  if (diffuse) for (const plane of values) for (let y = 0; y < height; y++) for (let index = 0; index < width; index++) {
    const reverse = y % 2, x = reverse ? width - 1 - index : index, at = y * width + x
    if (!alphas[at]) continue
    const old = plane[at], quantized = Math.round(clamp(old) * steps) / steps, divisor = settings.style === 'atkinson' ? 8 : 16, error = (old - quantized) * settings.diffusion / 100 / divisor
    plane[at] = quantized
    const taps = settings.style === 'atkinson' ? [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] : [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]
    for (const [dx, dy, weight] of taps) { const nx = x + (reverse ? -dx : dx), ny = y + dy; if (nx >= 0 && nx < width && ny < height) plane[ny * width + nx] += error * weight }
  }
  const dark = settings.colors==='twoColors'?rgb(settings.dark):[0,0,0], light = settings.colors==='twoColors'?rgb(settings.light):[1,1,1], angle = settings.angle * Math.PI / 180,data=new Uint8ClampedArray(image.data.length),marks=!diffuse&&!settings.style.startsWith('bayer')
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const bx=Math.floor(x/block),by=Math.floor(y/block),at=by*width+bx,offset=(y*image.width+x)*4,color=values.map(plane=>plane[at]);let output:number[]
    if(marks){const tone=planes===3?luminance(color[0],color[1],color[2]):color[0],wanted=settings.lightOnDark?tone:1-tone;let amount:number
      if(settings.style==='patterns'){const pattern=patterns[Math.round(clamp(wanted)*16)];amount=pattern[by&7]&(128>>>(bx&7))?1:0}
      else{let u=((bx+.5)*Math.cos(angle)+(by+.5)*Math.sin(angle))/settings.cellSize,v=(-(bx+.5)*Math.sin(angle)+(by+.5)*Math.cos(angle))/settings.cellSize;u-=Math.floor(u)+.5;v-=Math.floor(v)+.5;const spot=settings.style==='dots'?Math.PI*(u*u+v*v):settings.style==='lines'?Math.abs(v)*2:Math.abs(u)+Math.abs(v);amount=wanted>spot?1:0}
      if(planes===3){const paper=settings.lightOnDark?0:1;output=[0,1,2].map(c=>paper+(original[at*3+c]-paper)*amount)}else{const ink=settings.lightOnDark?light:dark,paper=settings.lightOnDark?dark:light;output=paper.map((value,c)=>value+(ink[c]-value)*amount)}
    }else{
      if(!diffuse){const size=settings.style==='bayer2'?2:settings.style==='bayer4'?4:8,matrix=size===2?bayer2:size===4?bayer4:bayer8;for(let plane=0;plane<planes;plane++)color[plane]=Math.min(steps,Math.floor(clamp(color[plane])*steps+(matrix[(by%size)*size+bx%size]+.5)/(size*size)))/steps}
      output=planes===3?color:dark.map((value,c)=>value+(light[c]-value)*color[0])
    }
    if(settings.pixelShape==='dot'&&block>1){const distance=Math.hypot(x%block+.5-block/2,y%block+.5-block/2),cover=clamp(block*.42-distance+.5);output=output.map((value,c)=>value*cover+dark[c]*(1-cover))}
    data[offset+3]=alphas[at];for(let c=0;c<3;c++)data[offset+c]=Math.round(clamp(output[c])*255)
  }
  return {...image,data}
}
// Original DitherPixels.c scanlines_apply / draw_lines: sampled CRT rows,
// Rutt-Etra displacement with front-to-back occlusion, and a post-render RGB split.
function scanlines(image: PixelImage, settings: Extract<ImageFilter, { kind: 'scanlines' }>): PixelImage {
 const width=image.width,height=image.height,count=width*height,spacing=settings.lineSpacing,lines=Math.ceil(height/spacing),planes=settings.colors==='original'?3:1,plane=lines*width,source=premultiply(image),tones=Array.from({length:planes},()=>new Float32Array(count)),scan=Array.from({length:planes},()=>new Float32Array(plane)),dark=settings.colors==='twoColors'?rgb(settings.dark):[0,0,0],light=settings.colors==='twoColors'?rgb(settings.light):[1,1,1],round=(value:number)=>value<0?-Math.round(-value):Math.round(value)
 for(let i=0;i<count;i++){const a=source[i*4+3],color=a?[source[i*4]/a,source[i*4+1]/a,source[i*4+2]/a]:[0,0,0];for(let c=0;c<planes;c++)tones[c][i]=adjustedTone(planes===3?color[c]:luminance(...color as [number,number,number]),settings.density,settings.contrast)}
 for(let line=0;line<lines;line++){const top=line*spacing,bottom=Math.min(height,top+spacing),wave=Math.sin(line*.45)*.7+Math.sin(line*1.7+1.3)*.3,shift=round(settings.wobble*wave);for(let x=0;x<width;x++){const sx=x-shift,sums=[0,0,0];let n=0;if(sx>=0&&sx<width)for(let y=top;y<bottom;y++){const i=y*width+sx;if(!source[i*4+3])continue;for(let c=0;c<planes;c++)sums[c]+=tones[c][i];n++}for(let c=0;c<planes;c++)scan[c][line*width+x]=n?sums[c]/n:0}}
 const tone=Float32Array.from({length:plane},(_,i)=>planes===3?luminance(scan[0][i],scan[1][i],scan[2][i]):scan[0][i]);let lift=new Float32Array(tone)
 const radius=round(settings.smoothness/100*spacing*2)
 if(radius>0&&settings.displace){for(let line=0;line<lines;line++)for(let pass=0;pass<3;pass++){const copy=lift.slice(line*width,(line+1)*width);let sum=0;for(let x=-radius;x<=radius;x++)sum+=copy[clamp(x,0,width-1)];for(let x=0;x<width;x++){lift[line*width+x]=sum/(radius*2+1);sum+=copy[clamp(x+radius+1,0,width-1)]-copy[clamp(x-radius,0,width-1)]}}
  for(let pass=0;pass<round(settings.smoothness/100*2);pass++){const next=new Float32Array(plane);for(let line=0;line<lines;line++)for(let x=0;x<width;x++)next[line*width+x]=(lift[Math.max(0,line-1)*width+x]+2*lift[line*width+x]+lift[Math.min(lines-1,line+1)*width+x])/4;lift=next}}
 const data=new Uint8ClampedArray(source),middle=spacing/2,rising=settings.displace>=0,black=settings.blackLevel/100
 for(let x=0;x<width;x++){const cover=new Float32Array(height),colors=new Float32Array(height*3),along=(x+.5)%spacing-middle;let horizon=rising?Infinity:-Infinity
  for(let step=0;step<lines;step++){const line=rising?lines-1-step:step,beading=settings.dots>0?clamp((settings.dots/100-tone[line*width+x])/.2):0,across=along*beading,at=clamp(round(x-across),0,width-1),i=line*width+at,t=tone[i],lit=settings.threshold>0?clamp((t-settings.threshold/100)/.04):1;if(lit<=0)continue;const base=line*spacing+middle,here=base-settings.displace*lift[i],before=at>0?base-settings.displace*lift[i-1]:here,lo=Math.min(here,before),hi=Math.max(here,before),level=black+(1-black)*t,color=[0,1,2].map(c=>planes===3?black+(1-black)*scan[c][i]:dark[c]+(light[c]-dark[c])*level),beam=middle*settings.thickness/100*(.29+.71*Math.sqrt(clamp(level))),top=Math.max(0,Math.floor(rising?lo-beam-1:Math.max(lo-beam-1,horizon-1))),bottom=Math.min(height,Math.ceil(rising?Math.min(hi+beam+1,horizon+1):hi+beam+1))
   for(let y=top;y<bottom;y++){const yy=y+.5,off=yy<lo?lo-yy:yy>hi?yy-hi:0,distance=Math.hypot(off,across),hidden=rising?clamp(horizon-yy+.5):clamp(yy-horizon+.5),shown=clamp(beam-distance+.5)*lit*hidden;if(shown>cover[y]){cover[y]=shown;colors.set(color,y*3)}}
   if(lit>.5)horizon=rising?Math.min(horizon,lo-beam):Math.max(horizon,hi+beam)
  }
  for(let y=0;y<height;y++){const at=(y*width+x)*4,a=source[at+3];if(!a)continue;for(let c=0;c<3;c++)data[at+c]=Math.round(clamp(dark[c]+(colors[y*3+c]*1.35-dark[c])*cover[y])*a)}
 }
 const split=round(settings.split)
 if(split>0)for(let y=0;y<height;y++){const row=data.slice(y*width*4,(y+1)*width*4);for(let x=0;x<width;x++){const at=(y*width+x)*4,a=data[at+3];data[at]=Math.min(a,x>=split?row[(x-split)*4]:0);data[at+2]=Math.min(a,x+split<width?row[(x+split)*4+2]:0)}}
 let result=unpremultiply({...image,data})
 if(settings.glow){const blurred=gaussianBlur(result,spacing*3+3,true),glow=premultiply(blurred),output=premultiply(result);for(let at=0;at<output.length;at+=4)for(let c=0;c<3;c++){const a=output[at+3],value=output[at+c],added=glow[at+c]*settings.glow/100*2.5*a/255,room=(a-value)*.7;output[at+c]=Math.round(Math.min(a,room>0?value+room*(1-Math.exp(-added/room)):value))}result=unpremultiply({...image,data:output})}
 return result
}

export type CameraRawPreviewOptions = { clipping?: 'shadows' | 'highlights'; sharpenMask?: boolean; visualizePointColor?: number;brightness?:CameraRawBrightness;samplingScale?:number }
/** Transient views are separate from ImageFilter: they can never be persisted or applied by accident. */
export function applyCameraRawPreview(image: PixelImage, input: unknown, options: CameraRawPreviewOptions): PixelImage {
  validateImage(image)
  const settings = imageFilterSchema.parse(input), view = z.object({clipping:z.enum(['shadows','highlights']).optional(),sharpenMask:z.boolean().optional(),visualizePointColor:z.number().int().min(-1).max(7).optional(),brightness:z.object({brightest:z.number().finite().min(0).max(255),luminance:z.number().finite().min(0).max(255),logBrightest:z.number().finite().min(0).max(255)}).strict().optional(),samplingScale:z.number().finite().positive().max(128).optional()}).strict().parse(options)
  if(settings.kind !== 'cameraRaw') throw new Error('Camera Raw preview requires Camera Raw settings.')
  return cameraRaw(image,settings,view)
}
