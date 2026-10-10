import { cameraBoxPlane, cameraMap, cameraVignetteMask, validateCameraImage, type CameraImage, type CameraDetail, type CameraEffects } from './camera-raw-kernels'
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const luma = (color: number[]) => .2126 * color[0] + .7152 * color[1] + .0722 * color[2]
const scaleLuminance = (color: number[], target: number) => { target = clamp(target); const value = luma(color); return value < 1e-8 ? [target, target, target] : color.map(channel => clamp(channel * target / value)) }
const lumaPlane = (image: CameraImage) => Float32Array.from({length: image.width * image.height}, (_, i) => image.data[i * 4 + 3] ? luma([image.data[i * 4] / 255, image.data[i * 4 + 1] / 255, image.data[i * 4 + 2] / 255]) : 0)
const edgeAt = (plane: Float32Array, width: number, height: number, x: number, y: number, radius: number) => { let sum = 0, count = 0; for (let dy = -radius; dy <= radius; dy += radius) for (let dx = -radius; dx <= radius; dx += radius) { if (!dx && !dy || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue; sum = Math.fround(sum + Math.abs(Math.fround(plane[(y + dy) * width + x + dx] - plane[y * width + x]))); count++ } return count ? Math.fround(sum / count) : 0 }
/** He's self-guided filter. Every plane assignment rounds to Float32 like upstream C. */
export function cameraRawGuidedPlane(source: Float32Array, width: number, height: number, radius: number): Float32Array {
  const mean = cameraBoxPlane(source, width, height, radius), square = cameraBoxPlane(Float32Array.from(source, value => Math.fround(value * value)), width, height, radius)
  const a = new Float32Array(source.length), b = new Float32Array(source.length), epsilon = Math.fround(.01)
  for (let i = 0; i < source.length; i++) { const variance = Math.fround(square[i] - Math.fround(mean[i] * mean[i])); a[i] = variance / Math.fround(variance + epsilon); b[i] = Math.fround(mean[i] - Math.fround(a[i] * mean[i])) }
  const aa = cameraBoxPlane(a, width, height, radius), bb = cameraBoxPlane(b, width, height, radius)
  return Float32Array.from(source, (value, index) => Math.fround(Math.fround(aa[index] * value) + bb[index]))
}
export function cameraRawHazeColor(image: CameraImage): number[] {
  validateCameraImage(image)
  const histogram = new Float64Array(256), sum = [0, 0, 0]; let total = 0
  for (let at = 0; at < image.data.length; at += 4) { const w = image.data[at + 3] / 255; if (!w) continue; const level = Math.round(luma([image.data[at] / 255, image.data[at + 1] / 255, image.data[at + 2] / 255]) * 255); histogram[level] += w; total += w }
  let threshold = 255, above = 0, weight = 0
  while (threshold > 0 && above + histogram[threshold] < total * .01) { above += histogram[threshold]; threshold-- }
  for (let at = 0; at < image.data.length; at += 4) { const alpha = image.data[at + 3]; if (!alpha) continue; const color = [image.data[at] / 255, image.data[at + 1] / 255, image.data[at + 2] / 255]; if (Math.round(luma(color) * 255) < threshold) continue; for (let c = 0; c < 3; c++) sum[c] += color[c] * alpha; weight += alpha }
  return weight ? sum.map(value => value / weight) : [1, 1, 1]
}
/** Upstream image-adaptive texture, clarity and dehaze, followed by glow and vignette. */
export function cameraRawEffects(image: CameraImage, settings: CameraEffects): CameraImage {
  validateCameraImage(image)
  if (![settings.texture, settings.clarity, settings.dehaze, settings.glow, settings.vignetteAmount].some(Boolean)) return image
  const plane = lumaPlane(image), side = Math.max(image.width, image.height)
  const fine = settings.texture ? cameraRawGuidedPlane(plane, image.width, image.height, Math.max(1, Math.round(side * 8 / 1456))) : null
  const coarse = settings.clarity ? cameraRawGuidedPlane(plane, image.width, image.height, Math.max(2, Math.round(side * 32 / 1456))) : null
  const threshold = Math.fround(.55 + .4 * settings.glowRange / 100), denom = Math.max(Math.fround(.05), Math.fround(1 - threshold))
  const glow = settings.glow ? cameraBoxPlane(Float32Array.from(plane, value => clamp(Math.fround(Math.fround(value - threshold) / denom))), image.width, image.height, Math.max(1, Math.min(64, Math.round((settings.glowStyle === 'Bloom' ? 2 : 5) * (1 + settings.glowSpread / 100))))) : null
  const haze = settings.dehaze ? cameraRawHazeColor(image) : [1, 1, 1], warmth = settings.glowWarmth / 100
  const glowColor = settings.glowStyle === 'Halation' ? [1, .35 - .3 * warmth, .2 - .2 * warmth] : [.75 + .25 * warmth, .6 + .2 * warmth, .75 - .6 * warmth], glowGain = settings.glowStyle === 'Bloom' ? 1.4 : 1
  return cameraMap(image, (source, x, y) => {
    const at = y * image.width + x; let color = source
    if (fine || coarse) { const tone = luma(color), detail = (fine ? settings.texture / 100 * (settings.texture > 0 ? .6 : .5) * (tone - fine[at]) : 0) + (coarse ? settings.clarity / 100 * (settings.clarity > 0 ? .85 : .5) * (tone - coarse[at]) : 0); if (detail) color = scaleLuminance(color, tone + detail) }
    if (settings.dehaze) { const d = settings.dehaze / 100; if (d < 0) { const veil = .3 * (-d) ** 1.3; color = color.map((value, c) => clamp(value * (1 - veil) + haze[c] * veil)) } else { let dark = 1; for (let c = 0; c < 3; c++) dark = Math.min(dark, color[c] / Math.max(haze[c], .001)); const transmission = Math.max(.5, 1 - .7 * d * dark); color = color.map((value, c) => clamp((value - haze[c]) / transmission + haze[c])) } }
    if (glow) color = color.map((value, channel) => clamp(value + glow[at] * settings.glow / 100 * glowGain * glowColor[channel]))
    if (settings.vignetteAmount) {
      const mask=cameraVignetteMask(x,y,image.width,image.height,settings.vignetteMidpoint+5.9,Math.min(100,100+settings.vignetteRoundness),settings.vignetteFeather),effect=settings.vignetteAmount/100*mask
      if(settings.vignetteStyle==='Highlight Priority'&&mask>0){
        const decode=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,encode=(v:number)=>v<=0?0:v>=1?1:v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055,bright=clamp((luma(color)-.45)/.55)
        let linear=color.map(decode)
        if(effect<0){const ease=(1-.3*bright)*(1-settings.vignetteHighlights/100*bright),gain=Math.exp(-5.8*(-settings.vignetteAmount/100)**1.43*mask*ease);linear=linear.map(v=>v*gain)}
        else{const a=settings.vignetteAmount/100,toward=a**.85*mask**(1+1.5*(1-a));linear=linear.map(v=>v+(1-v)*toward)}
        color=linear.map(encode)
      }else{color=effect<0?color.map(v=>v*(1+effect)):color.map(v=>v+(1-v)*effect);if(settings.vignetteStyle==='Color Priority'){const value=luma(color),saturation=1-.75*mask*Math.abs(settings.vignetteAmount/100);color=color.map(channel=>clamp(value+(channel-value)*saturation))}}
    }
    return color
  })
}
/** Ported from upstream AdjustPixels.c 75147a27: alpha-weighted chroma denoise and measured sharpening. */
export function cameraRawDetail(image: CameraImage, settings: CameraDetail): CameraImage {
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
    result = cameraMap(result, (color, x, y) => { const index = y * image.width + x, edge = edgeAt(plane, image.width, image.height, x, y, radius), mask = threshold > 0 ? clamp((edge * (.5 + settings.sharpenDetail / 100) - threshold) / Math.max(.04, .35 - threshold * .5)) : 1, target = clamp(plane[index] + (plane[index] - blurred[index]) * settings.sharpenAmount / 100 * mask * 1.9 * (.5 + settings.sharpenDetail / 100)); return scaleLuminance(color, target) })
  }
  return result
}

