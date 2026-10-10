import test from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { colorRangeSelection, combineRasterSelections, featherRasterSelection, invertRasterSelection, magicWandSelection, morphRasterSelection, rasterSelectionSpans, refineRasterSelection, retouchRaster, selectionFromAlpha, type RasterSelection } from '../src/core/selection-retouch'

function image(width: number, height: number, color = [0, 0, 0, 255]): PNG {
  const png = new PNG({ width, height }); for (let index = 0; index < width * height; index++) png.data.set(color, index * 4); return png
}
function pixel(png: PNG, x: number, y: number): number[] { return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)] }
function set(png: PNG, x: number, y: number, color: number[]): void { png.data.set(color, (y * png.width + x) * 4) }

test('magic wand distinguishes contiguous islands, tolerance and transparent hidden RGB', () => {
  const png = image(5, 1, [255, 0, 0, 255]); set(png, 1, 0, [250, 5, 0, 255]); set(png, 2, 0, [0, 0, 255, 255]); set(png, 4, 0, [255, 0, 0, 0])
  assert.deepEqual([...magicWandSelection(png, [0, 0], { tolerance: 6 }).coverage], [255, 255, 0, 0, 0])
  assert.deepEqual([...magicWandSelection(png, [0, 0], { tolerance: 6, contiguous: false }).coverage], [255, 255, 0, 255, 0])
  assert.deepEqual([...magicWandSelection(png, [0, 0], { tolerance: 0, contiguous: false, alphaProtect: false }).coverage], [255, 0, 0, 255, 0])
  assert.deepEqual([...magicWandSelection(png, [4, 0]).coverage], [0, 0, 0, 0, 255])
  assert.deepEqual([...magicWandSelection(png, [3.5, .5], { tolerance: 0 }).coverage], [0, 0, 0, 255, 0])
})

test('color range soft coverage, alpha selections and set operations preserve partial masks', () => {
  const png = image(3, 1); set(png, 0, 0, [100, 0, 0, 255]); set(png, 1, 0, [115, 0, 0, 128]); set(png, 2, 0, [150, 0, 0, 0])
  const mask = colorRangeSelection(png, [[100, 0, 0]], 30, 1)
  assert.deepEqual([...mask.coverage], [255, 128, 0]); assert.deepEqual([...selectionFromAlpha(png).coverage], [255, 128, 0])
  assert.deepEqual([...invertRasterSelection(mask).coverage], [0, 127, 255])
  assert.deepEqual([...combineRasterSelections(mask, mask, 'subtract').coverage], [0, 64, 0])
  assert.deepEqual(rasterSelectionSpans(mask), [{ y: 0, x: 0, values: [255, 128] }])
})

test('separable morphology expands and contracts exact masks; feather creates soft edges', () => {
  const mask: RasterSelection = { width: 7, height: 7, coverage: new Uint8Array(49) }; mask.coverage[3 * 7 + 3] = 255
  const expanded = morphRasterSelection(mask, 'expand', 1)
  assert.equal([...expanded.coverage].filter(value => value === 255).length, 9)
  assert.deepEqual(morphRasterSelection(expanded, 'contract', 1).coverage, mask.coverage)
  const soft = featherRasterSelection(expanded, 2)
  assert.ok(soft.coverage[3 * 7 + 3] > soft.coverage[3 * 7]); assert.ok(soft.coverage.some(value => value > 0 && value < 255))
  const refined = refineRasterSelection(mask, { shiftEdge: 1 }); assert.deepEqual(refined.coverage, expanded.coverage)
})

test('rounded morphology matches independent point-to-pixel-path boundary distances', () => {
 const width=8,height=5,mask:RasterSelection={width,height,coverage:Uint8Array.from({length:40},(_,index)=>((index*47+31)%256)>=128?255:0)}
 const segments:number[][]=[],selected=(x:number,y:number)=>x>=0&&y>=0&&x<width&&y<height&&mask.coverage[y*width+x]!==0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(selected(x,y)){
  if(!selected(x,y-1))segments.push([x,y,x+1,y]);if(!selected(x,y+1))segments.push([x,y+1,x+1,y+1]);if(!selected(x-1,y))segments.push([x,y,x,y+1]);if(!selected(x+1,y))segments.push([x+1,y,x+1,y+1])
 }
 for(const operation of ['expand','contract'] as const)for(const radius of [1,2,3]){
  const expected=new Uint8Array(40)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const distance=Math.min(...segments.map(([x0,y0,x1,y1])=>{const t=Math.max(0,Math.min(1,((x+.5-x0)*(x1-x0)+(y+.5-y0)*(y1-y0))/((x1-x0)**2+(y1-y0)**2)));return Math.hypot(x+.5-x0-t*(x1-x0),y+.5-y0-t*(y1-y0))}))
   const signed=distance*(selected(x,y)?-1:1)+(operation==='expand'?-radius:radius);expected[y*width+x]=signed<0?255:0
  }
  assert.deepEqual(morphRasterSelection(mask,operation,radius).coverage,expected)
 }
})

test('clone reads immutable source, respects raster selection and makes a real round-trip PNG', () => {
  const png = image(12, 5, [0, 0, 255, 255]); for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) set(png, x, y, [255, 0, 0, 255])
  const before = Buffer.from(png.data), selection: RasterSelection = { width: 12, height: 5, coverage: new Uint8Array(60) }; selection.coverage.fill(255); selection.coverage[2 * 12 + 8] = 0
  const cloned = retouchRaster(png, { kind: 'clone', points: [[8.5, 2.5]], sourceAnchor: [1.5, 2.5], size: 3, selection })
  assert.deepEqual(pixel(cloned, 7, 2), [255, 0, 0, 255]); assert.deepEqual(pixel(cloned, 8, 2), [0, 0, 255, 255]); assert.deepEqual(png.data, before)
  const decoded = PNG.sync.read(PNG.sync.write(cloned)); assert.deepEqual(decoded.data, cloned.data)
})

test('overlapping clone stamps apply maximum opacity instead of accumulating twice', () => {
  const png = image(10, 3, [0, 0, 255, 255]); for (let y = 0; y < 3; y++) set(png, 1, y, [255, 0, 0, 255])
  const cloned = retouchRaster(png, { kind: 'clone', points: [[7.5, 1.5], [7.5, 1.5]], sourceAnchor: [1.5, 1.5], size: 1, opacity: .5 })
  assert.deepEqual(pixel(cloned, 7, 1), [128, 0, 128, 255])
})

test('healing adapts source tone and spot healing removes a local blemish from its surroundings', () => {
  const png = image(11, 11, [90, 120, 160, 255]); set(png, 5, 5, [250, 0, 0, 255])
  const healed = retouchRaster(png, { kind: 'spot-heal', points: [[5.5, 5.5]], size: 3 })
  assert.ok(Math.abs(pixel(healed, 5, 5)[0] - 90) < 5); assert.ok(Math.abs(pixel(healed, 5, 5)[1] - 120) < 5); assert.equal(pixel(healed, 5, 5)[3], 255)
  const source = image(11, 11, [30, 40, 50, 255]), target = image(11, 11, [90, 120, 160, 255])
  const toneMatched = retouchRaster(target, { kind: 'heal', points: [[5.5, 5.5]], sourceAnchor: [5.5, 5.5], source, size: 3 })
  assert.deepEqual(pixel(toneMatched, 5, 5), [90, 120, 160, 255])
})

test('blur reduces a local impulse while preserving alpha and smear transports existing paint', () => {
  const png = image(9, 5, [0, 0, 0, 255]); set(png, 4, 2, [255, 255, 255, 255])
  const blurred = retouchRaster(png, { kind: 'blur', points: [[4.5, 2.5]], size: 3 })
  assert.ok(pixel(blurred, 4, 2)[0] < 100); assert.equal(pixel(blurred, 4, 2)[3], 255); assert.ok(pixel(blurred, 3, 2)[0] > 0)
  const paint = image(10, 3, [0, 0, 255, 255]); set(paint, 2, 1, [255, 0, 0, 255])
  const smeared = retouchRaster(paint, { kind: 'smear', points: [[2.5, 1.5], [5.5, 1.5]], size: 1 })
  assert.ok(pixel(smeared, 3, 1)[0] > 0)
})

test('invalid seeds, mismatched masks and excessive stroke budgets fail before changing input', () => {
  const png = image(3, 3), before = Buffer.from(png.data)
  assert.throws(() => magicWandSelection(png, [-1, 0]), /Seed X/)
  assert.throws(() => retouchRaster(png, { kind: 'clone', points: [[1, 1]], size: 2 }), /source point/)
  assert.throws(() => retouchRaster(png, { kind: 'blur', points: [[1, 1]], size: 2, selection: { width: 1, height: 1, coverage: new Uint8Array(1) } }), /match/)
  assert.throws(() => retouchRaster(png, { kind: 'blur', points: [[-1_000_000, 0], [1_000_000, 0]], size: 1 }), /sample budget/)
  assert.deepEqual(png.data, before)
})
