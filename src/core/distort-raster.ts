import { PNG } from 'pngjs'
import { EditorError, LIMITS, type Transform } from '../shared/contracts'

export type WarpPoint = [number, number]
export type WarpCorners = [WarpPoint, WarpPoint, WarpPoint, WarpPoint]
export interface WarpImage { width: number; height: number; data: Uint8Array }
export interface DistortedRaster { png: PNG; bytes: Buffer; bounds: [number, number, number, number]; transform: Transform; crop: [number, number, number, number]; method: 'projective' | 'triangles' }
export interface DistortOptions { flipX?: boolean; flipY?: boolean; sampling?: Transform['sampling']; trim?: boolean; mask?: boolean; maskBackground?: number; maxDimension?: number }
const cross = (a: WarpPoint, b: WarpPoint, c: WarpPoint): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
export function validateWarpCorners(input: readonly WarpPoint[]): WarpCorners {
  if (input.length !== 4 || input.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value) || Math.abs(value) > 1_000_000)) || Math.abs(cross(input[0], input[1], input[2])) <= .01 || Math.abs(cross(input[0], input[2], input[3])) <= .01) throw new EditorError('INVALID_ARGUMENT', 'Distortion requires four finite corners with two nonzero triangle areas.')
  return input.map(point => [...point]) as WarpCorners
}
export function isConvexWarp(corners: WarpCorners): boolean {
  let sign = 0
  for (let index = 0; index < 4; index++) { const value = cross(corners[index], corners[(index + 1) % 4], corners[(index + 2) % 4]); if (Math.abs(value) <= .01) return false; if (!sign) sign = Math.sign(value); else if (Math.sign(value) !== sign) return false }
  return true
}
export function warpHomography(corners: WarpCorners): number[] {
  const [a, b, c, d] = corners, sx = a[0] - b[0] + c[0] - d[0], sy = a[1] - b[1] + c[1] - d[1]
  let g = 0, h = 0
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = b[0] - c[0], dx2 = d[0] - c[0], dy1 = b[1] - c[1], dy2 = d[1] - c[1], determinant = dx1 * dy2 - dx2 * dy1
    if (Math.abs(determinant) < 1e-12) throw new EditorError('INVALID_ARGUMENT', 'The distortion perspective is singular.')
    g = (sx * dy2 - dx2 * sy) / determinant; h = (dx1 * sy - sx * dy1) / determinant
  }
  return [b[0] - a[0] + g * b[0], d[0] - a[0] + h * d[0], a[0], b[1] - a[1] + g * b[1], d[1] - a[1] + h * d[1], a[1], g, h, 1]
}
function inverse(matrix: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = matrix, A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, determinant = a * A + b * B + c * C
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new EditorError('INVALID_ARGUMENT', 'The distortion map cannot be inverted.')
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(value => value / determinant)
}
export function mapWarpPoint(matrix: number[], point: WarpPoint): WarpPoint { const [x, y] = point, w = matrix[6] * x + matrix[7] * y + matrix[8]; return [(matrix[0] * x + matrix[1] * y + matrix[2]) / w, (matrix[3] * x + matrix[4] * y + matrix[5]) / w] }
function triangleCoordinates(point: WarpPoint, a: WarpPoint, b: WarpPoint, c: WarpPoint): [number, number, number] | undefined {
  const area = cross(a, b, c), first = cross(point, b, c) / area, second = cross(a, point, c) / area, third = 1 - first - second
  return first >= -1e-9 && second >= -1e-9 && third >= -1e-9 ? [first, second, third] : undefined
}
function sample(image: WarpImage, u: number, v: number, nearest: boolean): number[] {
  const sx = Math.max(0, Math.min(image.width - 1, u * image.width - .5)), sy = Math.max(0, Math.min(image.height - 1, v * image.height - .5))
  if (nearest) { const index = (Math.round(sy) * image.width + Math.round(sx)) * 4; return [...image.data.subarray(index, index + 4)] }
  const x = Math.floor(sx), y = Math.floor(sy), tx = sx - x, ty = sy - y, color = [0, 0, 0, 0]
  for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
    const index = (Math.min(image.height - 1, y + yy) * image.width + Math.min(image.width - 1, x + xx)) * 4, weight = (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty), alpha = image.data[index + 3] / 255
    color[3] += alpha * weight; for (let channel = 0; channel < 3; channel++) color[channel] += image.data[index + channel] * alpha * weight
  }
  for (let channel = 0; channel < 3; channel++) color[channel] = color[3] ? Math.round(color[channel] / color[3]) : 0
  color[3] = Math.round(color[3] * 255); return color
}
export function distortRaster(image: WarpImage, input: readonly WarpPoint[], options: DistortOptions = {}): DistortedRaster {
  const corners = validateWarpCorners(input)
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > LIMITS.maxSide || image.height > LIMITS.maxSide || image.width * image.height > LIMITS.maxSurfacePixels || image.data.length !== image.width * image.height * 4) throw new EditorError('INVALID_ARGUMENT', 'Invalid distortion source raster.')
  if (options.maxDimension !== undefined && (!Number.isFinite(options.maxDimension) || options.maxDimension < 1 || options.maxDimension > LIMITS.maxSide)) throw new EditorError('INVALID_ARGUMENT', 'Invalid distortion preview dimension.')
  if (options.maskBackground !== undefined && (!Number.isFinite(options.maskBackground) || options.maskBackground < 0 || options.maskBackground > 255)) throw new EditorError('INVALID_ARGUMENT', 'Mask background must be between 0 and 255.')
  const minX = Math.floor(Math.min(...corners.map(point => point[0]))), minY = Math.floor(Math.min(...corners.map(point => point[1]))), boxWidth = Math.ceil(Math.max(...corners.map(point => point[0]))) - minX, boxHeight = Math.ceil(Math.max(...corners.map(point => point[1]))) - minY
  if (boxWidth < 1 || boxHeight < 1 || boxWidth > LIMITS.maxSide || boxHeight > LIMITS.maxSide || boxWidth * boxHeight > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'Distortion exceeds the image budget.')
  const factor = options.maxDimension ? Math.min(1, options.maxDimension / Math.max(boxWidth, boxHeight)) : 1, width = Math.max(1, Math.ceil(boxWidth * factor)), height = Math.max(1, Math.ceil(boxHeight * factor))
  const png = new PNG({ width, height }), method = isConvexWarp(corners) ? 'projective' : 'triangles', inverted = method === 'projective' ? inverse(warpHomography(corners)) : undefined
  let lowX = width, lowY = height, highX = 0, highY = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point: WarpPoint = [minX + (x + .5) * boxWidth / width, minY + (y + .5) * boxHeight / height]
    let uv: WarpPoint | undefined
    if (inverted) { const mapped = mapWarpPoint(inverted, point); if (mapped[0] >= 0 && mapped[0] <= 1 && mapped[1] >= 0 && mapped[1] <= 1) uv = mapped }
    else {
      const first = triangleCoordinates(point, corners[0], corners[1], corners[2]); if (first) uv = [first[1] + first[2], first[2]]
      const second = triangleCoordinates(point, corners[0], corners[2], corners[3]); if (second) uv = [second[1], second[1] + second[2]]
    }
    let color = options.mask ? [options.maskBackground ?? 0, options.maskBackground ?? 0, options.maskBackground ?? 0, 255] : [0, 0, 0, 0]
    if (uv) { if (options.flipX) uv[0] = 1 - uv[0]; if (options.flipY) uv[1] = 1 - uv[1]; color = sample(image, uv[0], uv[1], options.sampling === 'Nearest'); if (options.mask) color = [color[0], color[0], color[0], 255] }
    png.data.set(color, (y * width + x) * 4)
    if (color[3] && (!options.mask || color[0])) { lowX = Math.min(lowX, x); lowY = Math.min(lowY, y); highX = Math.max(highX, x + 1); highY = Math.max(highY, y + 1) }
  }
  let result = png, bounds: [number, number, number, number] = [minX, minY, boxWidth, boxHeight], crop: [number, number, number, number] = [0, 0, width, height]
  if (options.trim && !options.mask && highX > lowX && highY > lowY && (lowX || lowY || highX < width || highY < height)) {
    result = new PNG({ width: highX - lowX, height: highY - lowY })
    for (let row = 0; row < result.height; row++) { const at = ((row + lowY) * width + lowX) * 4; result.data.set(png.data.subarray(at, at + result.width * 4), row * result.width * 4) }
    bounds = [minX + lowX * boxWidth / width, minY + lowY * boxHeight / height, result.width * boxWidth / width, result.height * boxHeight / height]; crop = [lowX, lowY, result.width, result.height]
  }
  const transform: Transform = { origin: [bounds[0], bounds[1]], size: [bounds[2], bounds[3]], rotation: 0, flipX: false, flipY: false, sampling: options.sampling ?? 'High quality' }
  return { png: result, bytes: PNG.sync.write(result), bounds, transform, crop, method }
}
