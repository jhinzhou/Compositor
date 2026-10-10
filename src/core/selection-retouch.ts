import {roundedMorphCoverage} from '../shared/selection-morphology'
import {gaussianSelectionCoverage} from '../shared/selection-gaussian'
import { PNG } from 'pngjs'
import { EditorError, LIMITS } from '../shared/contracts'

export interface RGBAImage { width: number; height: number; data: Uint8Array }
export interface RasterSelection { width: number; height: number; coverage: Uint8Array }
export type PixelPoint = [number, number]
const MAX_VISITS = 80_000_000
function finite(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new EditorError('INVALID_ARGUMENT', `${name} is outside its supported range.`)
  return value
}
function dimensions(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'The raster exceeds the image budget.')
  return width * height
}
function imageCheck(image: RGBAImage): number { const pixels = dimensions(image.width, image.height); if (image.data.length !== pixels * 4) throw new EditorError('INVALID_ARGUMENT', 'RGBA image data has the wrong length.'); return pixels }
function maskCheck(mask: RasterSelection): number { const pixels = dimensions(mask.width, mask.height); if (mask.coverage.length !== pixels) throw new EditorError('INVALID_ARGUMENT', 'Selection data has the wrong length.'); return pixels }
export function selectionFromAlpha(image: RGBAImage): RasterSelection {
  const pixels = imageCheck(image), coverage = new Uint8Array(pixels)
  for (let index = 0; index < pixels; index++) coverage[index] = image.data[index * 4 + 3]
  return { width: image.width, height: image.height, coverage }
}
export interface WandOptions { tolerance?: number; contiguous?: boolean; alphaProtect?: boolean; includeAlpha?: boolean; sampleSize?: 'point'|'3x3'|'5x5'; premultiplied?: boolean }
/** WandPixels.c matches the rounded mean of four premultiplied channels. PNG
 * decoding produces straight RGBA, so premultiply before sampling and matching. */
export function magicWandSelection(image: RGBAImage, point: PixelPoint, options: WandOptions = {}): RasterSelection {
  const pixels = imageCheck(image), tolerance = Math.round(finite(options.tolerance ?? 32, 0, 255, 'Tolerance'))
  finite(point[0], 0, image.width, 'Seed X'); finite(point[1], 0, image.height, 'Seed Y')
  if (point[0] >= image.width || point[1] >= image.height) throw new EditorError('INVALID_ARGUMENT', 'The seed point must be inside the image.')
  const sx=Math.floor(point[0]),sy=Math.floor(point[1]), seed = sy*image.width+sx, coverage = new Uint8Array(pixels)
  const radius=options.sampleSize==='5x5'?2:options.sampleSize==='3x3'?1:0,reference=[0,0,0,0]
  const channel=(index:number,c:number):number=>c===3?image.data[index*4+3]:options.premultiplied?image.data[index*4+c]:Math.round(image.data[index*4+c]*image.data[index*4+3]/255)
  let samples=0
  for(let y=Math.max(0,sy-radius);y<=Math.min(image.height-1,sy+radius);y++)for(let x=Math.max(0,sx-radius);x<=Math.min(image.width-1,sx+radius);x++){samples++;for(let c=0;c<4;c++)reference[c]+=channel(y*image.width+x,c)}
  for(let c=0;c<4;c++)reference[c]=Math.floor((reference[c]+Math.floor(samples/2))/samples)
  const matches=(index:number):boolean=>{
    if(options.alphaProtect&&!image.data[index*4+3])return false
    for(let c=0;c<(options.includeAlpha===false?3:4);c++)if(Math.abs(channel(index,c)-reference[c])>tolerance)return false
    return true
  }
  if(options.contiguous===false){for(let index=0;index<pixels;index++)if(matches(index))coverage[index]=255}
  else if(matches(seed)){
    // Port the native scanline fill: one queued seed per matching neighbour run,
    // rather than retaining a four-byte queue for every document pixel.
    const stack:number[]=[sx,sy]
    while(stack.length){const y=stack.pop()!,x=stack.pop()!,row=y*image.width;if(coverage[row+x]||!matches(row+x))continue
      let left=x,right=x;while(left>0&&!coverage[row+left-1]&&matches(row+left-1))left--;while(right+1<image.width&&!coverage[row+right+1]&&matches(row+right+1))right++
      coverage.fill(255,row+left,row+right+1)
      for(const ny of [y-1,y+1]){if(ny<0||ny>=image.height)continue;let inRun=false;for(let nx=left;nx<=right;nx++){const candidate=!coverage[ny*image.width+nx]&&matches(ny*image.width+nx);if(candidate&&!inRun)stack.push(nx,ny);inRun=candidate}}
      if(stack.length>MAX_VISITS)throw new EditorError('RESOURCE_LIMIT','Wand flood exceeds the queue budget.')
    }
  }
  return {width:image.width,height:image.height,coverage}
}
export interface ColorRangeOptions {excludeColors?:[number,number,number][];invert?:boolean;premultiplied?:boolean}
export function colorRangeSelection(image: RGBAImage, colors: [number, number, number][], tolerance = 32, softness = 0, alphaProtect = true, options:ColorRangeOptions={}): RasterSelection {
  const pixels=imageCheck(image);finite(tolerance,0,255,'Tolerance');finite(softness,0,1,'Softness')
  const excluded=options.excludeColors??[]
  if(!colors.length||colors.length>64||excluded.length>64)throw new EditorError('INVALID_ARGUMENT','Select between 1 and 64 reference colors.')
  for(const color of [...colors,...excluded])for(const value of color)finite(value,0,255,'Reference color')
  if(pixels*(colors.length+excluded.length)>MAX_VISITS)throw new EditorError('RESOURCE_LIMIT','Color range exceeds the compute budget; use fewer reference colors.')
  const coverage=new Uint8Array(pixels)
  for(let index=0;index<pixels;index++){
    const at=index*4,alpha=image.data[at+3],rgb=[0,1,2].map(c=>options.premultiplied&&alpha?Math.floor((image.data[at+c]*255+Math.floor(alpha/2))/alpha):image.data[at+c])
    const distance=(list:[number,number,number][])=>list.reduce((best,color)=>Math.min(best,Math.max(...color.map((value,c)=>Math.abs(rgb[c]-value)))),Infinity)
    const included=distance(colors),exclude=distance(excluded)<=tolerance
    let value=(!alphaProtect||alpha)&&!exclude&&included<=tolerance?softness&&tolerance?Math.round(255*Math.min(1,(tolerance-included)/(tolerance*softness))):255:0
    if(options.invert)value=255-value
    coverage[index]=value
  }
  return {width:image.width,height:image.height,coverage}
}
export function combineRasterSelections(left: RasterSelection, right: RasterSelection, operation: 'replace' | 'add' | 'subtract' | 'intersect'): RasterSelection {
  maskCheck(left); maskCheck(right)
  if (left.width !== right.width || left.height !== right.height) throw new EditorError('INVALID_ARGUMENT', 'Selections must have equal dimensions.')
  const coverage = new Uint8Array(left.coverage.length)
  for (let index = 0; index < coverage.length; index++) {
    const a = left.coverage[index], b = right.coverage[index]
    coverage[index] = operation === 'replace' ? b : operation === 'add' ? Math.max(a, b) : operation === 'subtract' ? Math.round(a * (1 - b / 255)) : Math.min(a, b)
  }
  return { width: left.width, height: left.height, coverage }
}
export function invertRasterSelection(mask: RasterSelection): RasterSelection { maskCheck(mask); return { ...mask, coverage: mask.coverage.map(value => 255 - value) } }

export function morphRasterSelection(mask: RasterSelection, operation: 'expand' | 'contract', amount: number): RasterSelection {
 maskCheck(mask);finite(amount,0,1000,'Morphology radius')
 return {...mask,coverage:roundedMorphCoverage(mask.coverage,mask.width,mask.height,operation,amount)}
}
export function featherRasterSelection(mask: RasterSelection, amount: number): RasterSelection {
  maskCheck(mask);finite(amount,0,1000,'Feather radius')
  return {...mask,coverage:gaussianSelectionCoverage(mask.coverage,mask.width,mask.height,amount)}
}
export function smoothRasterSelection(mask: RasterSelection, radius: number): RasterSelection {
  const blurred = featherRasterSelection(mask, finite(radius, 0, 1000, 'Smooth radius'))
  return { ...blurred, coverage: blurred.coverage.map(value => value >= 128 ? 255 : 0) }
}
export function refineRasterSelection(mask: RasterSelection, options: { shiftEdge?: number; smooth?: number; feather?: number }): RasterSelection {
  let output: RasterSelection = { ...mask, coverage: mask.coverage.slice() }
  if (options.smooth) output = smoothRasterSelection(output, options.smooth)
  if (options.shiftEdge) { finite(options.shiftEdge, -1000, 1000, 'Edge shift'); output = morphRasterSelection(output, options.shiftEdge > 0 ? 'expand' : 'contract', Math.abs(options.shiftEdge)) }
  if (options.feather) output = featherRasterSelection(output, options.feather)
  return output
}
export function rasterSelectionSpans(mask: RasterSelection): { y: number; x: number; values: number[] }[] {
  maskCheck(mask); const spans: { y: number; x: number; values: number[] }[] = []
  for (let y = 0; y < mask.height; y++) {
    let x = 0
    while (x < mask.width) {
      if (!mask.coverage[y * mask.width + x]) { x++; continue }
      const start = x, values: number[] = []
      while (x < mask.width && mask.coverage[y * mask.width + x]) values.push(mask.coverage[y * mask.width + x++])
      spans.push({ y, x: start, values })
    }
  }
  return spans
}

export interface RetouchOptions {
  kind: 'clone' | 'heal' | 'spot-heal' | 'smear' | 'blur'
  points: PixelPoint[]
  size: number
  hardness?: number
  opacity?: number
  sourceAnchor?: PixelPoint
  source?: RGBAImage
  selection?: RasterSelection
  protectAlpha?: boolean
}
function strokeStamps(points: PixelPoint[], radius: number): PixelPoint[] {
  if (!points.length || points.length > 100_000) throw new EditorError('INVALID_ARGUMENT', 'A stroke requires between 1 and 100000 points.')
  for (const point of points) for (const value of point) finite(value, -1_000_000, 1_000_000, 'Stroke coordinate')
  const stamps: PixelPoint[] = [points[0]]
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(.5, radius / 4)))
    if (stamps.length + steps > 100_000) throw new EditorError('RESOURCE_LIMIT', 'The stroke exceeds the sample budget.')
    for (let step = 1; step <= steps; step++) stamps.push(step === steps ? [b[0], b[1]] : [a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps])
  }
  return stamps
}
function boxAt(image: RGBAImage, point: PixelPoint, radius: number): [number, number, number, number] {
  return [Math.max(0, Math.floor(point[0] - radius)), Math.max(0, Math.floor(point[1] - radius)), Math.min(image.width - 1, Math.ceil(point[0] + radius)), Math.min(image.height - 1, Math.ceil(point[1] + radius))]
}
function meanColor(image: RGBAImage, point: PixelPoint, radius: number): number[] {
  const [x0, y0, x1, y1] = boxAt(image, point, radius), sums = [0, 0, 0]; let alpha = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const index = (y * image.width + x) * 4, a = image.data[index + 3] / 255; alpha += a
    for (let channel = 0; channel < 3; channel++) sums[channel] += image.data[index + channel] * a
  }
  return sums.map(value => alpha ? value / alpha : 0)
}
function sourceOver(output: Uint8Array, index: number, color: number[], coverage: number, protectAlpha: boolean): void {
  const sourceAlpha = color[3] / 255 * coverage, destinationAlpha = output[index + 3] / 255
  if (protectAlpha) { if (!destinationAlpha) return; for (let channel = 0; channel < 3; channel++) output[index + channel] = Math.round(output[index + channel] * (1 - sourceAlpha) + color[channel] * sourceAlpha); return }
  const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha)
  for (let channel = 0; channel < 3; channel++) output[index + channel] = alpha ? Math.round((color[channel] * sourceAlpha + output[index + channel] * destinationAlpha * (1 - sourceAlpha)) / alpha) : 0
  output[index + 3] = Math.round(alpha * 255)
}
export function retouchRaster(image: RGBAImage, options: RetouchOptions): PNG {
  const pixels = imageCheck(image), radius = finite(options.size, 1, 4096, 'Brush size') / 2, hardness = finite(options.hardness ?? 1, 0, 1, 'Hardness'), opacity = finite(options.opacity ?? 1, 0, 1, 'Opacity')
  const source = options.source ?? image; imageCheck(source)
  if (options.selection) { maskCheck(options.selection); if (options.selection.width !== image.width || options.selection.height !== image.height) throw new EditorError('INVALID_ARGUMENT', 'The retouch selection must match the layer raster.') }
  if ((options.kind === 'clone' || options.kind === 'heal') && !options.sourceAnchor) throw new EditorError('INVALID_ARGUMENT', 'Choose a source point before cloning or healing.')
  if (options.sourceAnchor) for (const value of options.sourceAnchor) finite(value, -1_000_000, 1_000_000, 'Source coordinate')
  const stamps = strokeStamps(options.points, radius)
  let visits = 0
  for (const stamp of stamps) {
    const [x0, y0, x1, y1] = boxAt(image, stamp, radius); visits += Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1)
    if (visits > MAX_VISITS) throw new EditorError('RESOURCE_LIMIT', 'The retouch stroke exceeds the compute budget.')
  }
  const output = new PNG({ width: image.width, height: image.height }); output.data.set(image.data)
  const coverage = new Float32Array(pixels), shift = options.sourceAnchor ? [options.sourceAnchor[0] - options.points[0][0], options.sourceAnchor[1] - options.points[0][1]] : [0, 0]
  const sourceMean = options.kind === 'heal' ? meanColor(source, options.sourceAnchor!, radius) : [0, 0, 0]
  const healOffset = options.kind === 'heal' ? meanColor(image, options.points[0], radius).map((value, channel) => value - sourceMean[channel]) : [0, 0, 0]
  let previous = stamps[0]
  for (const stamp of stamps) {
    const [x0, y0, x1, y1] = boxAt(image, stamp, radius)
    const shiftX = stamp[0] - previous[0], shiftY = stamp[1] - previous[1]
    const patchX = Math.max(0, Math.floor(Math.min(x0 - 1, x0 - shiftX))), patchY = Math.max(0, Math.floor(Math.min(y0 - 1, y0 - shiftY)))
    const patchRight = Math.min(image.width - 1, Math.ceil(Math.max(x1 + 1, x1 - shiftX))), patchBottom = Math.min(image.height - 1, Math.ceil(Math.max(y1 + 1, y1 - shiftY)))
    const patchWidth = Math.max(0, patchRight - patchX + 1), patchHeight = Math.max(0, patchBottom - patchY + 1)
    let patch: Uint8Array | undefined
    if (options.kind === 'blur' || options.kind === 'smear') {
      patch = new Uint8Array(patchWidth * patchHeight * 4)
      for (let row = 0; row < patchHeight; row++) { const at = ((patchY + row) * image.width + patchX) * 4; patch.set(output.data.subarray(at, at + patchWidth * 4), row * patchWidth * 4) }
    }
    const sample = (x: number, y: number, channel: number): number => patch![(y - patchY) * patchWidth * 4 + (x - patchX) * 4 + channel]
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const distance = Math.hypot(x + .5 - stamp[0], y + .5 - stamp[1])
      if (distance > radius) continue
      const pixel = y * image.width + x, falloff = distance <= radius * hardness ? 1 : (radius - distance) / Math.max(.0001, radius * (1 - hardness)), alpha = falloff * opacity * (options.selection ? options.selection.coverage[pixel] / 255 : 1)
      if (alpha <= 0) continue
      if (options.kind === 'clone' || options.kind === 'heal') {
        // Maximum stroke coverage avoids repeatedly applying an overlapping clone stamp.
        if (alpha <= coverage[pixel]) continue
        const sx = Math.floor(x + shift[0]), sy = Math.floor(y + shift[1])
        if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue
        const at = (sy * source.width + sx) * 4, color = [...source.data.subarray(at, at + 4)]
        for (let channel = 0; channel < 3; channel++) color[channel] = Math.max(0, Math.min(255, color[channel] + healOffset[channel]))
        output.data.set(image.data.subarray(pixel * 4, pixel * 4 + 4), pixel * 4)
        sourceOver(output.data, pixel * 4, color, alpha, options.protectAlpha ?? false); coverage[pixel] = alpha
      } else if (options.kind === 'spot-heal') coverage[pixel] = Math.max(coverage[pixel], alpha)
      else {
        let color: number[]
        if (options.kind === 'smear') {
          const sx = Math.max(0, Math.min(image.width - 1, x - shiftX)), sy = Math.max(0, Math.min(image.height - 1, y - shiftY))
          const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0
          color = [0, 0, 0, 0]
          for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
            const px = Math.min(image.width - 1, x0 + xx), py = Math.min(image.height - 1, y0 + yy), weight = (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty), alpha = sample(px, py, 3) / 255
            color[3] += weight * alpha; for (let channel = 0; channel < 3; channel++) color[channel] += sample(px, py, channel) * weight * alpha
          }
          for (let channel = 0; channel < 3; channel++) color[channel] = color[3] ? color[channel] / color[3] : 0
          color[3] *= 255
        } else {
          color = [0, 0, 0, 0]; let count = 0
          for (let yy = Math.max(0, y - 1); yy <= Math.min(image.height - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(image.width - 1, x + 1); xx++) { const alpha = sample(xx, yy, 3) / 255; for (let channel = 0; channel < 3; channel++) color[channel] += sample(xx, yy, channel) * alpha; color[3] += alpha; count++ }
          for (let channel = 0; channel < 3; channel++) color[channel] = color[3] ? color[channel] / color[3] : 0
          color[3] = color[3] / count * 255
        }
        sourceOver(output.data, pixel * 4, color, alpha, options.protectAlpha ?? true)
      }
    }
    previous = stamp
  }
  if (options.kind === 'spot-heal') {
    const affected: number[] = []
    for (let index = 0; index < pixels; index++) if (coverage[index] > 0) affected.push(index)
    if (affected.length * 64 > MAX_VISITS) throw new EditorError('RESOURCE_LIMIT', 'Spot healing exceeds the diffusion budget.')
    // Local harmonic inpainting fills from surrounding pixels. It is deterministic
    // retouching, not semantic/object segmentation or a learned content model.
    const mean = meanColor(image, options.points[0], radius * 1.5)
    for (const pixel of affected) for (let channel = 0; channel < 3; channel++) output.data[pixel * 4 + channel] = mean[channel]
    const neighbors = affected.map(pixel => {
      const x = pixel % image.width
      return [x > 0 ? pixel - 1 : -1, x + 1 < image.width ? pixel + 1 : -1, pixel >= image.width ? pixel - image.width : -1, pixel + image.width < pixels ? pixel + image.width : -1].filter(value => value >= 0)
    })
    const updated = new Uint8Array(affected.length * 3)
    for (let iteration = 0; iteration < 64; iteration++) {
      affected.forEach((pixel, index) => { for (let channel = 0; channel < 3; channel++) updated[index * 3 + channel] = neighbors[index].length ? Math.round(neighbors[index].reduce((sum, neighbor) => sum + output.data[neighbor * 4 + channel], 0) / neighbors[index].length) : output.data[pixel * 4 + channel] })
      affected.forEach((pixel, index) => { for (let channel = 0; channel < 3; channel++) output.data[pixel * 4 + channel] = updated[index * 3 + channel] })
    }
    for (const pixel of affected) for (let channel = 0; channel < 3; channel++) output.data[pixel * 4 + channel] = Math.round(image.data[pixel * 4 + channel] * (1 - coverage[pixel]) + output.data[pixel * 4 + channel] * coverage[pixel])
  }
  return output
}
