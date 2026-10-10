import {cameraRawMeasuredDividers,cameraRawMixerStages,cameraRawGradingStages,cameraRawCompose,cameraRawLookup,cameraRawLensVignette} from './camera-raw-adaptive'
import { z } from 'zod'
import { LIMITS } from './limits'
export function validateCameraImage(image: CameraImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > LIMITS.maxSide || image.height > LIMITS.maxSide || image.width*image.height > LIMITS.maxSurfacePixels || image.data.length !== image.width*image.height*4) throw new Error('Camera Raw image exceeds surface limits or has invalid RGBA dimensions.')
}
export type CameraImage = { width: number; height: number; data: Uint8ClampedArray }
const n = (min: number, max: number, fallback = 0) => z.number().finite().min(min).max(max).default(fallback)
const tone = (fallback = 0) => n(-100, 100, fallback), unit = (fallback = 0) => n(0, 100, fallback)
const point = z.object({ x: n(0, 1), y: n(0, 1) }).strict()
const points = z.array(point).min(2).max(32).refine(value => value[0].x === 0 && value.at(-1)!.x === 1 && value.every((point, index) => !index || point.x > value[index - 1].x)).default(() => [{ x: 0, y: 0 }, { x: 1, y: 1 }])
export const cameraCurveSchema = z.object({ shadows: tone(), darks: tone(), lights: tone(), highlights: tone(), shadowSplit: n(5, 90, 25), darkSplit: n(7, 95, 50), lightSplit: n(9, 98, 75), rgb: points, red: points, green: points, blue: points, refineSaturation: tone() }).strict().refine(value => value.darkSplit >= value.shadowSplit + 2 && value.lightSplit >= value.darkSplit + 2, 'Curve dividers must increase by at least two.').prefault({})
const eight = z.array(tone()).length(8).default(() => Array(8).fill(0))
const pointColorSchema = z.object({ hue: n(0, 360), saturation: n(0, 1), luminance: n(0, 1), hueShift: tone(), saturationShift: tone(), luminanceShift: tone(), hueRange: n(5, 180, 30), saturationRange: n(.05, 1, .4), luminanceRange: n(.05, 1, .4) }).strict()
export const cameraMixerSchema = z.object({ hue: eight, saturation: eight, luminance: eight, points: z.array(pointColorSchema).max(8).default([]) }).strict().prefault({})
const wheel = z.object({ hue: n(0, 360), saturation: unit(), luminance: tone() }).strict().prefault({})
export const cameraGradingSchema = z.object({ shadows: wheel, midtones: wheel, highlights: wheel, global: wheel, blending: unit(50), balance: tone() }).strict().prefault({})
export const cameraDetailSchema = z.object({ sharpenAmount: n(0, 150), sharpenRadius: unit(10), sharpenDetail: unit(25), sharpenMasking: unit(), noiseLuminance: unit(), noiseLuminanceDetail: unit(50), noiseLuminanceContrast: unit(), noiseColor: unit(), noiseColorDetail: unit(50), noiseColorSmoothness: unit(50) }).strict().prefault({})
export const cameraOpticsSchema = z.object({ removeChromaticAberration: z.boolean().default(false), enableLensProfile: z.boolean().default(false), profileDistortion: unit(100), profileVignetting: unit(100), distortion: tone(), purpleAmount: unit(), purpleHueLow: n(0, 360, 270), purpleHueHigh: n(0, 360, 310), greenAmount: unit(), greenHueLow: n(0, 360, 60), greenHueHigh: n(0, 360, 120), vignetteAmount: tone(), vignetteMidpoint: unit(50) }).strict().refine(value => value.purpleHueLow <= value.purpleHueHigh && value.greenHueLow <= value.greenHueHigh, 'Defringe hue limits must be ordered.').prefault({})
export const cameraGeometrySchema = z.object({ upright: z.enum(['Off', 'Guided']).default('Off'), projection: z.enum(['Perspective', 'Rectilinear']).default('Perspective'), vertical: tone(), horizontal: tone(), rotate: n(-45, 45), aspect: tone(), scale: tone(), offsetX: tone(), offsetY: tone(), constrainCrop: z.boolean().default(false), guides: z.array(z.object({ startX: n(0, 1), startY: n(0, 1), endX: n(0, 1), endY: n(0, 1) }).strict()).max(4).default([]) }).strict().prefault({})
export const cameraCalibrationSchema = z.object({ process: z.enum(['Version 1', 'Version 2', 'Version 3', 'Version 4', 'Version 5', 'Version 6']).default('Version 6'), shadowTint: tone(), redHue: tone(), redSaturation: tone(), greenHue: tone(), greenSaturation: tone(), blueHue: tone(), blueSaturation: tone() }).strict().prefault({})
export type CameraCurve = z.infer<typeof cameraCurveSchema>
export type CameraMixer = z.infer<typeof cameraMixerSchema>
export type CameraGrading = z.infer<typeof cameraGradingSchema>
export type CameraDetail = z.infer<typeof cameraDetailSchema>
export type CameraOptics = z.infer<typeof cameraOpticsSchema>
export type CameraGeometry = z.infer<typeof cameraGeometrySchema>
export type CameraCalibration = z.infer<typeof cameraCalibrationSchema>
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const luma = (color: number[]) => .2126 * color[0] + .7152 * color[1] + .0722 * color[2]
const wrap = (value: number) => (value % 1 + 1) % 1
const distance = (a: number, b: number) => { const delta = Math.abs(a - b); return delta > .5 ? 1 - delta : delta }
const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
export function cameraMap(image: CameraImage, operation: (color: number[], x: number, y: number) => number[]): CameraImage {
  validateCameraImage(image)
  const data = new Uint8ClampedArray(image.data)
  for (let at = 0; at < data.length; at += 4) { if (!data[at + 3]) continue; const index = at / 4, color = operation([data[at] / 255, data[at + 1] / 255, data[at + 2] / 255], index % image.width, Math.floor(index / image.width)); for (let channel = 0; channel < 3; channel++) data[at + channel] = Math.round(clamp(color[channel]) * 255) }
  return { ...image, data }
}
function scaleLuminance(color: number[], target: number): number[] { const value = luma(color); target = clamp(target); return value < 1e-8 ? [target, target, target] : color.map(channel => clamp(channel * target / value)) }
function toHSL(color: number[]): number[] {
  const [r, g, b] = color, max = Math.max(...color), min = Math.min(...color), delta = max - min, light = (max + min) / 2
  if (delta < 1e-6) return [0, 0, light]
  return [wrap((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6), delta / (1 - Math.abs(2 * light - 1)), light]
}
function fromHSL(hue: number, saturation: number, lightness: number): number[] {
  hue = wrap(hue) * 6; const c = (1 - Math.abs(2 * lightness - 1)) * saturation, x = c * (1 - Math.abs(hue % 2 - 1)), m = lightness - c / 2
  return (hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]).map(value => value + m)
}
function interpolate(points: { x: number; y: number }[], x: number): number {
  let index = 0; while (index < points.length - 2 && points[index + 1].x <= x) index++
  const deltas = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x)), slope = (i: number): number => i === 0 ? deltas[0] : i === points.length - 1 ? deltas.at(-1)! : deltas[i - 1] * deltas[i] <= 0 ? 0 : 2 / (1 / deltas[i - 1] + 1 / deltas[i])
  const h = points[index + 1].x - points[index].x, t = clamp((x - points[index].x) / h)
  return clamp((2 * t ** 3 - 3 * t * t + 1) * points[index].y + (t ** 3 - 2 * t * t + t) * h * slope(index) + (-2 * t ** 3 + 3 * t * t) * points[index + 1].y + (t ** 3 - t * t) * h * slope(index + 1))
}
function sampleLUT(table: Float32Array, value: number): number { const x = clamp(value) * 255, low = Math.floor(x), high = Math.min(255, low + 1); return table[low] + (table[high] - table[low]) * (x - low) }
export function cameraCurveTables(curve:CameraCurve):{tone:Float32Array;channels:Float32Array[]}{
  const bend = (tone: number, lower: number, low: number, upper: number, high: number) => tone < lower && lower > 0 ? lower * (tone / lower) ** (2 ** (-low / 100 * 1.66)) : tone > upper && upper < 1 ? 1 - (1 - upper) * ((1 - tone) / (1 - upper)) ** (2 ** (high / 100 * 1.66)) : tone
  const anchors = Array.from({ length: 33 }, (_, index) => ({ x: index / 32, y: bend(bend(index / 32, curve.shadowSplit / 100, curve.shadows, curve.lightSplit / 100, curve.highlights), curve.darkSplit / 100, curve.darks, curve.darkSplit / 100, curve.lights) }))
  const tone = Float32Array.from({ length: 256 }, (_, value) => interpolate(curve.rgb, cameraRawMeasuredDividers(curve)?value/255:interpolate(anchors, value / 255))), channelTables = [curve.red, curve.green, curve.blue].map(points => Float32Array.from({ length: 256 }, (_, value) => interpolate(points, value / 255)))
  return {tone,channels:channelTables}
}
export function cameraCurveColor(image: CameraImage, curve: CameraCurve, mixer: CameraMixer, grading: CameraGrading, visualize = -1): CameraImage {
  const {tone,channels:channelTables}=cameraCurveTables(curve),mixerTable=cameraRawCompose(cameraRawMixerStages(mixer)),gradeTable=cameraRawCompose(cameraRawGradingStages(grading))
  return cameraMap(image, original => {
    let color = original.map(value => sampleLUT(tone, value))
    if (curve.refineSaturation < 0) { const pure = scaleLuminance(original, sampleLUT(tone, luma(original))); color = color.map((value, i) => value + (pure[i] - value) * -curve.refineSaturation / 100) }
    else if (curve.refineSaturation > 0) { const value = luma(color); color = color.map(channel => clamp(value + (channel - value) * (1 + curve.refineSaturation / 100))) }
    color = color.map((value, i) => sampleLUT(channelTables[i], value))
    if(mixerTable)color=cameraRawLookup(mixerTable,0,33,color,1)
    const sourceHSL = toHSL(color)
    let [hue, saturation, light] = sourceHSL, hueDelta = 0, satDelta = 0, lumDelta = 0, total = 0
    for (const point of mixer.points) {
      const weight = Math.max(0, 1 - distance(hue, point.hue / 360) / (point.hueRange / 360)) * Math.max(0, 1 - Math.abs(saturation - point.saturation) / point.saturationRange) * Math.max(0, 1 - Math.abs(light - point.luminance) / point.luminanceRange)
      hue += point.hueShift / 100 * weight * (30 / 360); saturation = clamp(saturation * (1 + point.saturationShift / 100 * weight)); light = clamp(light + point.luminanceShift / 100 * weight * .25)
    }
    color = fromHSL(hue, saturation, light)
    if(gradeTable)color=cameraRawLookup(gradeTable,0,33,color,1)
    if (visualize >= 0 && visualize < mixer.points.length && cameraPointWeight(sourceHSL, mixer.points[visualize]) <= .05) color = color.map(value=>value*.35)
    return color
  })
}
export function cameraCalibration(image: CameraImage, settings: CameraCalibration): CameraImage {
  validateCameraImage(image)
  if (!settings.shadowTint) return image
  const version = Number(settings.process.slice(-1)), strength = [.55, .65, .75, .85, .92, 1][version - 1]
  return cameraMap(image, color => {
    let [h, s, l] = toHSL(color)
    if (l < .35) h = wrap(h + settings.shadowTint / 100 * strength * .06)
    return fromHSL(h, s, l)
  })
}
/** Native gray-world WB counts nontransparent pixels equally and solves its two gain axes. */
export function cameraAutoWhiteBalance(image: CameraImage): { temperature: number; tint: number } {
  validateCameraImage(image)
  const sum = [0, 0, 0]; let total = 0
  for (let at = 0; at < image.data.length; at += 4) { if (!image.data[at + 3]) continue; total++; for (let channel = 0; channel < 3; channel++) sum[channel] += linear(image.data[at + channel] / 255) }
  if (!total || sum.some(value => value < 1e-8)) return { temperature: 0, tint: 0 }
  const [red, green, blue] = sum.map(value => value / total), a1 = .35 * red, b1 = .15 * red + .3 * green, c1 = green - red, a2 = -.35 * blue, b2 = .15 * blue + .3 * green, c2 = green - blue, determinant = a1 * b2 - a2 * b1
  if (Math.abs(determinant) < 1e-8) return { temperature: 0, tint: 0 }
  return { temperature: clamp((c1 * b2 - c2 * b1) / determinant * 100, -100, 100), tint: clamp((a1 * c2 - a2 * c1) / determinant * 100, -100, 100) }
}
export function cameraBoxPlane(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const temp = new Float32Array(source.length), result = new Float32Array(source.length), span = radius * 2 + 1
  for (let y = 0; y < height; y++) { let sum = 0; for (let x = -radius; x <= radius; x++) sum += source[y * width + clamp(x, 0, width - 1)]; for (let x = 0; x < width; x++) { temp[y * width + x] = sum / span; sum += source[y * width + clamp(x + radius + 1, 0, width - 1)] - source[y * width + clamp(x - radius, 0, width - 1)] } }
  for (let x = 0; x < width; x++) { let sum = 0; for (let y = -radius; y <= radius; y++) sum += temp[clamp(y, 0, height - 1) * width + x]; for (let y = 0; y < height; y++) { result[y * width + x] = sum / span; sum += temp[clamp(y + radius + 1, 0, height - 1) * width + x] - temp[clamp(y - radius, 0, height - 1) * width + x] } }
  return result
}
const lumaPlane = (image: CameraImage) => Float32Array.from({ length: image.width * image.height }, (_, index) => image.data[index * 4 + 3] ? luma([...image.data.subarray(index * 4, index * 4 + 3)].map(value => value / 255)) : 0)
const edgeAt = (plane: Float32Array, width: number, height: number, x: number, y: number, radius: number) => { let sum = 0, count = 0; for (let dy = -radius; dy <= radius; dy += radius) for (let dx = -radius; dx <= radius; dx += radius) { if (!dx && !dy || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue; sum += Math.abs(plane[(y + dy) * width + x + dx] - plane[y * width + x]); count++ } return count ? sum / count : 0 }
export function cameraDetail(image: CameraImage, settings: CameraDetail): CameraImage {
  validateCameraImage(image)
  if (!settings.noiseLuminance && !settings.noiseColor && !settings.sharpenAmount) return image
  let result = image, plane = lumaPlane(image)
  if (settings.noiseLuminance) {
    const blurred = cameraBoxPlane(plane, image.width, image.height, Math.round(1 + settings.noiseLuminance / 50))
    result = cameraMap(result, (color, x, y) => { const index = y * image.width + x, edge = edgeAt(plane, image.width, image.height, x, y, 1), local = settings.noiseLuminance / 100 * (1 - settings.noiseLuminanceDetail / 100 * Math.min(1, edge * 6)), target = plane[index] * (1 - local) + blurred[index] * local + settings.noiseLuminanceContrast / 100 * .25 * (plane[index] - blurred[index]); plane[index] = target; return scaleLuminance(color, target) })
  }
  if (settings.noiseColor) {
    const count = image.width * image.height, red = new Float32Array(count), blue = new Float32Array(count), alpha = new Float32Array(count), radius = Math.round(1.5 + settings.noiseColor / 100 * 4 * (.5 + settings.noiseColorSmoothness / 100))
    for (let index = 0; index < count; index++) { const at = index * 4, color = [result.data[at], result.data[at + 1], result.data[at + 2]].map(value => value / 255), brightness = luma(color), coverage = result.data[at + 3] / 255; red[index] = (color[0] - brightness) * coverage; blue[index] = (color[2] - brightness) * coverage; alpha[index] = coverage }
    const redBlur = cameraBoxPlane(red, image.width, image.height, radius), blueBlur = cameraBoxPlane(blue, image.width, image.height, radius), alphaBlur = cameraBoxPlane(alpha, image.width, image.height, radius)
    for (let index = 0; index < count; index++) if (alphaBlur[index] > .000001) { redBlur[index] /= alphaBlur[index]; blueBlur[index] /= alphaBlur[index] }
    result = cameraMap(result, (color, x, y) => { const index = y * image.width + x, left = Math.max(0, x - radius), right = Math.min(image.width - 1, x + radius), top = Math.max(0, y - radius), bottom = Math.min(image.height - 1, y + radius), edge = Math.abs(redBlur[y * image.width + right] - redBlur[y * image.width + left]) + Math.abs(blueBlur[y * image.width + right] - blueBlur[y * image.width + left]) + Math.abs(redBlur[bottom * image.width + x] - redBlur[top * image.width + x]) + Math.abs(blueBlur[bottom * image.width + x] - blueBlur[top * image.width + x]), local = settings.noiseColor / 100 * (1 - settings.noiseColorDetail / 100 * Math.min(1, edge * 3)), brightness = luma(color), r = color[0] + (redBlur[index] - (color[0] - brightness)) * local, b = color[2] + (blueBlur[index] - (color[2] - brightness)) * local; return [r, (brightness - .2126 * r - .0722 * b) / .7152, b] })
  }
  if (settings.sharpenAmount) {
    plane = lumaPlane(result); const radius = Math.max(1, Math.round(.5 + settings.sharpenRadius / 100 * 2.5)), blurred = cameraBoxPlane(plane, image.width, image.height, radius), threshold = settings.sharpenMasking / 100 * .35
    result = cameraMap(result, (color, x, y) => { const index = y * image.width + x, edge = edgeAt(plane, image.width, image.height, x, y, radius), mask = clamp((edge * (.5 + settings.sharpenDetail / 100) - threshold) / Math.max(.04, .35 - threshold * .5)), target = clamp(plane[index] + (plane[index] - blurred[index]) * settings.sharpenAmount / 100 * mask * (.5 + settings.sharpenDetail / 100)); return scaleLuminance(color, target) })
  }
  return result
}

export function cameraVignetteMask(x: number, y: number, width: number, height: number, midpoint: number, roundness: number, feather: number): number {
  const nx = (x + .5) / width * 2 - 1, ny = (y + .5) / height * 2 - 1, square = Math.max(Math.abs(nx), Math.abs(ny)), circle = Math.hypot(nx, ny) / Math.sqrt(2), shape = (1 - roundness / 100) * .5, distance = circle + (square - circle) * shape, t = clamp((distance - midpoint / 100 * .85) / Math.max(.05, feather / 100))
  return t * t * (3 - 2 * t)
}
export type CameraEffects = { texture: number; clarity: number; dehaze: number; glow: number; glowStyle: 'Diffusion' | 'Bloom' | 'Halation'; glowRange: number; glowSpread: number; glowWarmth: number; vignetteAmount: number; vignetteMidpoint: number; vignetteRoundness: number; vignetteFeather: number; vignetteHighlights: number; vignetteStyle: 'Highlight Priority' | 'Color Priority' | 'Paint Overlay' }
export function cameraEffects(image: CameraImage, settings: CameraEffects): CameraImage {
  validateCameraImage(image)
  const plane = lumaPlane(image), fine = settings.texture ? cameraBoxPlane(plane, image.width, image.height, 1) : null, coarse = settings.clarity ? cameraBoxPlane(plane, image.width, image.height, 4) : null
  const threshold = .55 + .4 * settings.glowRange / 100, glow = settings.glow ? cameraBoxPlane(Float32Array.from(plane, value => clamp((value - threshold) / Math.max(.05, 1 - threshold))), image.width, image.height, Math.max(1, Math.min(64, Math.round((settings.glowStyle === 'Bloom' ? 2 : 5) * (1 + settings.glowSpread / 100))))) : null
  const warmth = settings.glowWarmth / 100, glowColor = settings.glowStyle === 'Halation' ? [1, .35 - .3 * warmth, .2 - .2 * warmth] : [.75 + .25 * warmth, .6 + .2 * warmth, .75 - .6 * warmth], glowGain = settings.glowStyle === 'Bloom' ? 1.4 : 1
  return cameraMap(image, (source, x, y) => {
    const at = y * image.width + x; let color = source
    if (fine || coarse) { const value = luma(color), detail = (fine ? settings.texture / 100 * (value - fine[at]) : 0) + (coarse ? settings.clarity / 100 * (value - coarse[at]) : 0); if (detail) color = scaleLuminance(color, value + detail) }
    if (settings.dehaze) {
      const d = settings.dehaze / 100, value = luma(color), pivot = .45 - .1 * Math.max(0, d); let next = clamp(pivot + (value - .45) * (1 + .8 * d))
      next = d < 0 ? clamp(next + -d * (1 - next) * .45) : clamp(next - d * Math.max(0, .4 - next)); color = scaleLuminance(color, next)
      const brightness = luma(color); color = color.map(value => clamp(brightness + (value - brightness) * (1 + .7 * d)))
    }
    if (glow) color = color.map((value, channel) => clamp(value + glow[at] * settings.glow / 100 * glowGain * glowColor[channel]))
    if (settings.vignetteAmount) {
      const mask = cameraVignetteMask(x, y, image.width, image.height, settings.vignetteMidpoint, settings.vignetteRoundness, settings.vignetteFeather); let effect = settings.vignetteAmount / 100 * mask
      if (effect < 0 && settings.vignetteStyle === 'Highlight Priority') effect *= 1 - settings.vignetteHighlights / 100 * clamp((luma(color) - .45) / .55)
      color = effect < 0 ? color.map(value => value * (1 + effect)) : color.map(value => value + (1 - value) * effect)
      if (settings.vignetteStyle === 'Color Priority') { const value = luma(color), saturation = 1 - .75 * mask * Math.abs(settings.vignetteAmount / 100); color = color.map(channel => clamp(value + (channel - value) * saturation)) }
    }
    return color
  })
}
export function cameraOptics(image: CameraImage, settings: CameraOptics, distort: (image: CameraImage, distortion: number) => CameraImage): CameraImage {
  validateCameraImage(image)
  const distortion = settings.distortion + (settings.enableLensProfile ? settings.profileDistortion : 0)
  let result = distortion ? distort(image, distortion) : image
  if (settings.removeChromaticAberration) {
    const source = result.data, cx = image.width / 2, cy = image.height / 2, maximum = Math.hypot(cx, cy)
    result = cameraMap(result, (color, x, y) => { const shift = .45 * (Math.hypot(x + .5 - cx, y + .5 - cy) / maximum) ** 2 * 2.5, rx = clamp(Math.round(x - shift), 0, image.width - 1), bx = clamp(Math.round(x + shift), 0, image.width - 1), red = (y*image.width+rx)*4, blue=(y*image.width+bx)*4; return [source[red+3] ? source[red]/255 : 0, color[1], source[blue+3] ? source[blue+2]/255 : 0] })
  }
  const vignette = settings.vignetteAmount + (settings.enableLensProfile ? settings.profileVignetting / 100 * 35 : 0)
  if (!vignette && !settings.purpleAmount && !settings.greenAmount) return result
  return cameraMap(result, (original, x, y) => {
    let color = original; const hue = toHSL(color)[0] * 360, max = Math.max(...color), min = Math.min(...color), chroma = max - min
    let reduce = 0
    if (settings.purpleAmount && hue >= settings.purpleHueLow && hue <= settings.purpleHueHigh) reduce = Math.max(reduce, settings.purpleAmount / 100)
    if (settings.greenAmount && hue >= settings.greenHueLow && hue <= settings.greenHueHigh) reduce = Math.max(reduce, settings.greenAmount / 100)
    if (reduce && chroma >= .000001) { const value = luma(color), factor = 1 - reduce * chroma / max; color = color.map(channel => clamp(value + (channel - value) * factor)) }
    if (vignette) {
      color = cameraRawLensVignette(color,x,y,image.width,image.height,vignette,settings.vignetteMidpoint)
    }
    return color
  })
}
function geometryCorners(width: number, height: number, settings: CameraGeometry): number[][] {
  let rotation = settings.rotate, vertical = settings.vertical, horizontal = settings.horizontal
  const guides = settings.guides.filter(guide => Math.hypot(guide.endX - guide.startX, guide.endY - guide.startY) > .01)
  if (settings.upright === 'Guided' && guides.length) {
    const first = guides[0], angle = Math.atan2(first.endY - first.startY, first.endX - first.startX) * 180 / Math.PI; let correction = -angle
    if (correction > 45) correction -= 90; else if (correction < -45) correction += 90
    rotation += correction
    if (guides.length > 1) { const second = guides[1], a2 = Math.atan2(second.endY - second.startY, second.endX - second.startX) * 180 / Math.PI; if (Math.abs(a2) > 45) vertical += a2 > 0 ? 25 : -25; else horizontal += a2 > 0 ? 25 : -25 }
  }
  const strength = settings.projection === 'Perspective' ? 1 : .55, v = vertical / 100 * width * .18 * strength, hz = horizontal / 100 * height * .18 * strength, aspect = 1 + settings.aspect / 200, zoom = 1 + settings.scale / 100, shiftX = settings.offsetX / 100 * width * .15, shiftY = settings.offsetY / 100 * height * .15, cx = width / 2 + shiftX, cy = height / 2 + shiftY, angle = rotation * Math.PI / 180
  return [[-v + shiftX, height + shiftY], [width + v + shiftX, height + shiftY], [width + hz + shiftX, -shiftY], [-hz + shiftX, -shiftY]].map(([x, y]) => { const dx = x - cx, dy = y - cy, rx = dx * Math.cos(angle) - dy * Math.sin(angle), ry = dx * Math.sin(angle) + dy * Math.cos(angle); return [cx + rx * aspect * zoom, height - (cy + ry / aspect * zoom)] })
}
function solve(matrix: number[][]): number[] {
  for (let column = 0; column < 8; column++) {
    let pivot = column; for (let row = column + 1; row < 8; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    if (Math.abs(matrix[pivot][column]) < 1e-10) throw new Error('Camera geometry is degenerate.')
    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
    const divisor = matrix[column][column]; for (let index = column; index < 9; index++) matrix[column][index] /= divisor
    for (let row = 0; row < 8; row++) if (row !== column) { const factor = matrix[row][column]; for (let index = column; index < 9; index++) matrix[row][index] -= factor * matrix[column][index] }
  }
  return matrix.map(row => row[8])
}
function rgbaSample(source: CameraImage, x: number, y: number): number[] {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, sum = [0, 0, 0, 0]
  for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
    const sx = x0 + column, sy = y0 + row; if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue
    const at = (sy * source.width + sx) * 4, weight = (column ? fx : 1 - fx) * (row ? fy : 1 - fy), alpha = source.data[at + 3] / 255
    for (let channel = 0; channel < 3; channel++) sum[channel] += source.data[at + channel] * alpha * weight
    sum[3] += source.data[at + 3] * weight
  }
  return [sum[3] ? sum[0] * 255 / sum[3] : 0, sum[3] ? sum[1] * 255 / sum[3] : 0, sum[3] ? sum[2] * 255 / sum[3] : 0, sum[3]].map(Math.round)
}
/** Geometry retains original pixel dimensions, matching native constrained crop's fitted result. */
export function cameraGeometry(image: CameraImage, settings: CameraGeometry): CameraImage {
  validateCameraImage(image)
  if (!['vertical', 'horizontal', 'rotate', 'aspect', 'scale', 'offsetX', 'offsetY'].some(key => settings[key as 'vertical'] !== 0) && !(settings.upright === 'Guided' && settings.guides.length)) return image
  const corners = geometryCorners(image.width, image.height, settings), original = [[0, 0], [image.width, 0], [image.width, image.height], [0, image.height]], matrix: number[][] = []
  corners.forEach(([x, y], index) => { const [u, v] = original[index]; matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]) })
  const h = solve(matrix), data = new Uint8ClampedArray(image.data.length)
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const px = x + .5, py = y + .5, denominator = h[6] * px + h[7] * py + 1; if (Math.abs(denominator) < 1e-8) continue; data.set(rgbaSample(image, (h[0] * px + h[1] * py + h[2]) / denominator - .5, (h[3] * px + h[4] * py + h[5]) / denominator - .5), (y * image.width + x) * 4) }
  let result = { ...image, data }
  if (settings.constrainCrop) {
    let left = image.width, top = image.height, right = 0, bottom = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (data[(y * image.width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1) }
    if (right > left && bottom > top && (right - left < image.width || bottom - top < image.height)) {
      const width = right - left, height = bottom - top, scale = Math.min(image.width / width, image.height / height), dx = (image.width - width * scale) / 2, dy = (image.height - height * scale) / 2, fitted = new Uint8ClampedArray(data.length)
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const sx = (x + .5 - dx) / scale + left - .5, sy = (y + .5 - dy) / scale + top - .5; if (sx >= left - .5 && sx <= right - .5 && sy >= top - .5 && sy <= bottom - .5) fitted.set(rgbaSample(result, sx, sy), (y * image.width + x) * 4) }
      result = { ...image, data: fitted }
    }
  }
  return result
}

/** Native point-color visualization uses the pre-mixer HSL color, not the graded RGB. */
export function cameraPointWeight(hsl: number[], point: z.infer<typeof pointColorSchema>): number {
  return Math.max(0,1-distance(hsl[0],point.hue/360)/(point.hueRange/360))*Math.max(0,1-Math.abs(hsl[1]-point.saturation)/point.saturationRange)*Math.max(0,1-Math.abs(hsl[2]-point.luminance)/point.luminanceRange)
}
export function cameraSamplePoint(color: number[]): z.infer<typeof pointColorSchema> {
  const [hue,saturation,luminance]=toHSL(color.map(value=>clamp(value/255)))
  return pointColorSchema.parse({hue:hue*360,saturation,luminance})
}
export function cameraClipOverlay(image: CameraImage, shadows: boolean, highlights: boolean): CameraImage {
  return cameraMap(image,color=>{if(shadows&&color.some(value=>value<=.5/255))color=[color[0]*.35,color[1]*.35,color[2]*.35+.65];if(highlights&&color.some(value=>value>=254.5/255))color=[color[0]*.35+.65,color[1]*.35,color[2]*.35];return color})
}
export function cameraSharpenMask(image: CameraImage, settings: CameraDetail): CameraImage {
  validateCameraImage(image)
  const plane=lumaPlane(image),radius=Math.max(1,Math.round(.5+settings.sharpenRadius/100*2.5)),threshold=settings.sharpenMasking/100*.35
  return cameraMap(image,(_color,x,y)=>{const edge=edgeAt(plane,image.width,image.height,x,y,radius),value=clamp((edge*(.5+settings.sharpenDetail/100)-threshold)/Math.max(.04,.35-threshold*.5));return[value,value,value]})
}
export function cameraScopes(image: CameraImage, side=128): { red:Float64Array;green:Float64Array;blue:Float64Array;vectorscope:Float64Array;side:number } {
  validateCameraImage(image);if(!Number.isInteger(side)||side<8||side>512)throw new Error('Vectorscope side must be 8–512.')
  const bins=[new Float64Array(256),new Float64Array(256),new Float64Array(256)],vectorscope=new Float64Array(side*side)
  for(let band=0;band<16;band++)for(let py=band*Math.ceil(image.height/16);py<Math.min(image.height,(band+1)*Math.ceil(image.height/16));py+=2)for(let px=0;px<image.width;px+=2){const at=(py*image.width+px)*4;const alpha=image.data[at+3]/255;if(!alpha)continue;const color=[image.data[at],image.data[at+1],image.data[at+2]];color.forEach((value,i)=>bins[i][value]+=alpha);const high=Math.max(...color),low=Math.min(...color),chroma=high-low;if(chroma/255<=1e-4||high/255<=1e-4)continue;let hue=(high===color[0]?(color[1]-color[2])/chroma:high===color[1]?2+(color[2]-color[0])/chroma:4+(color[0]-color[1])/chroma)/6;if(hue<0)hue++;const saturation=chroma/high,x=Math.max(0,Math.min(side-1,Math.floor((.5+Math.cos(hue*Math.PI*2)*saturation*.48)*side))),y=Math.max(0,Math.min(side-1,Math.floor((.5+Math.sin(hue*Math.PI*2)*saturation*.48)*side)));vectorscope[y*side+x]+=alpha}
  return {red:bins[0],green:bins[1],blue:bins[2],vectorscope,side}
}
