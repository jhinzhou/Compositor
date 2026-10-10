import test from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { distortRaster, mapWarpPoint, validateWarpCorners, warpHomography, type WarpCorners } from '../src/core/distort-raster'

function source(): PNG { const png = new PNG({ width: 2, height: 2 }); png.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]); return png }
const square: WarpCorners = [[0, 0], [2, 0], [2, 2], [0, 2]]

test('identity perspective exactly preserves pixels and flipped sources mirror their corners', () => {
  const image = source(), result = distortRaster(image, square)
  assert.equal(result.method, 'projective'); assert.deepEqual(result.png.data, image.data); assert.deepEqual(result.bounds, [0, 0, 2, 2])
  assert.deepEqual(PNG.sync.read(result.bytes).data, image.data)
  const flipped = distortRaster(image, square, { flipX: true }); assert.deepEqual([...flipped.png.data.subarray(0, 4)], [0, 255, 0, 255])
})

test('homography sends unit-square corners to a trapezoid and inverse sampling keeps exterior transparent', () => {
  const corners: WarpCorners = [[2, 0], [6, 0], [8, 6], [0, 6]], map = warpHomography(corners)
  for (const [index, point] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) { const actual = mapWarpPoint(map, point as [number, number]); for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(actual[axis] - corners[index][axis]) < 1e-9) }
  const warped = distortRaster(source(), corners)
  assert.equal(warped.png.data[3], 0); assert.ok(warped.png.data[(3 * warped.png.width + 4) * 4 + 3] > 0)
})

test('bilinear interpolation ignores hidden RGB in fully transparent source pixels', () => {
  const image = new PNG({ width: 2, height: 1 }); image.data.set([255, 0, 0, 255, 0, 0, 255, 0])
  const warped = distortRaster(image, [[0, 0], [4, 0], [4, 1], [0, 1]])
  assert.equal(warped.png.data[4], 255); assert.equal(warped.png.data[6], 0); assert.ok(warped.png.data[7] > 0 && warped.png.data[7] < 255)
})

test('folded quadrilaterals use the native two-triangle fallback and never invent perspective', () => {
  const folded: WarpCorners = [[0, 0], [4, 0], [0, 4], [4, 4]]
  const result = distortRaster(source(), folded)
  assert.equal(result.method, 'triangles'); assert.ok(result.png.data.some((value, index) => index % 4 === 3 && value > 0))
})

test('visible trim changes document bounds while preview dimensions preserve document extent', () => {
  const image = new PNG({ width: 4, height: 4 }); image.data.set([255, 0, 0, 255], (1 * 4 + 1) * 4)
  const result = distortRaster(image, [[10, 20], [14, 20], [14, 24], [10, 24]], { trim: true })
  assert.deepEqual(result.bounds, [11, 21, 1, 1]); assert.deepEqual(result.crop, [1, 1, 1, 1]); assert.deepEqual(result.transform.origin, [11, 21]); assert.equal(result.transform.rotation, 0)
  const preview = distortRaster(source(), [[10, 20], [30, 20], [30, 40], [10, 40]], { maxDimension: 4 }); assert.equal(preview.png.width, 4); assert.deepEqual(preview.bounds, [10, 20, 20, 20])
})

test('mask warps use explicit outside background; invalid corners and oversized bounds fail clearly', () => {
  const image = new PNG({ width: 1, height: 1 }); image.data.set([128, 128, 128, 255])
  const result = distortRaster(image, [[2, 0], [4, 0], [6, 4], [0, 4]], { mask: true, maskBackground: 255 })
  assert.deepEqual([...result.png.data.subarray(0, 4)], [255, 255, 255, 255]); assert.equal(result.png.data[(2 * 6 + 3) * 4], 128)
  assert.throws(() => validateWarpCorners([[0, 0], [1, 0], [2, 0], [0, 1]]), /nonzero/)
  assert.throws(() => distortRaster(source(), [[0, 0], [30001, 0], [30001, 2], [0, 2]]), /budget/)
})
