import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import { decodeExportPNG, encodeExport, encodePDF, encodePNG, flattenExportRaster, resizeExportRaster, setJPEGResolution, type ExportRaster } from '../src/core/export-codecs'
import { exportOptionsSchema } from '../src/shared/export-options'

const raster: ExportRaster = { width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 128, 0, 255, 0, 0]) }

test('PNG export preserves RGBA and writes physical resolution with valid CRC', () => {
  const data = encodePNG(raster, 300), png = PNG.sync.read(data, { checkCRC: true })
  assert.deepEqual([...png.data], [...raster.data])
  assert.equal(data.toString('ascii', 37, 41), 'pHYs')
  assert.equal(data.readUInt32BE(41), 11811); assert.equal(data.readUInt32BE(45), 11811); assert.equal(data[49], 1)
})
test('JPEG export flattens specified background before encoding and sets JFIF DPI', async () => {
  const original = encodePNG(raster)
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9])
  let called = false
  const result = await encodeExport(original, { format: 'jpeg', width: 2, height: 1, resolution: 240, quality: .6, background: '#0000ff' }, (png, quality) => {
    called = true; assert.equal(quality, .6)
    assert.deepEqual([...decodeExportPNG(png).data], [128, 0, 127, 255, 0, 0, 255, 255]); return jpeg
  })
  assert.ok(called); assert.equal(result.data[13], 1); assert.equal(result.data.readUInt16BE(14), 240); assert.equal(result.data.readUInt16BE(16), 240)
  assert.equal(result.data.toString('latin1').split('JFIF').length, 2)
  assert.deepEqual(result.data.subarray(-6), jpeg.subarray(-6))
  assert.throws(() => setJPEGResolution(Buffer.from('no'), 72)); assert.throws(() => setJPEGResolution(jpeg, Infinity))
})
test('premultiplied resize excludes hidden colors and does not mutate source', () => {
  const before = [...raster.data], resized = resizeExportRaster(raster, 1, 1)
  assert.deepEqual([...resized.data], [255, 0, 0, 64]); assert.deepEqual([...raster.data], before)
  assert.deepEqual([...flattenExportRaster(raster, '#ffffff').data], [255, 127, 127, 255, 255, 255, 255, 255])
})
test('PDF has exact printed page size, lossless RGB, transparency mask, and valid cross-reference offsets', () => {
  const data = encodePDF(raster, 144), text = data.toString('latin1')
  assert.match(text, /\/MediaBox \[0 0 1 0\.5\]/); assert.match(text, /\/Count 1/); assert.match(text, /\/SMask 6 0 R/)
  const xrefStart = Number(/startxref\n(\d+)/.exec(text)![1]); assert.equal(data.toString('ascii', xrefStart, xrefStart + 4), 'xref')
  const entries = text.slice(xrefStart).split('\n').slice(3, 9)
  entries.forEach((row, index) => { const offset = Number(row.slice(0, 10)); assert.equal(data.toString('ascii', offset, offset + 7), `${index + 1} 0 obj`) })
  const rgbObject = text.indexOf('5 0 obj'), streamStart = text.indexOf('stream\n', rgbObject) + 7, streamLength = Number(/\/Length (\d+)/.exec(text.slice(rgbObject))![1])
  assert.deepEqual([...inflateSync(data.subarray(streamStart, streamStart + streamLength))], [255, 0, 0, 0, 255, 0])
  assert.doesNotMatch(encodePDF(raster, 144, '#ffffff').toString('latin1'), /\/SMask/)
})
test('export validates dimensions, pixel budget, quality, background, DPI, and rejects truncated PNG headers before decoding', async () => {
  const valid = { format: 'png', width: 2, height: 1 }
  for (const invalid of [{ width: 0 }, { height: .5 }, { width: 30001 }, { width: 30000, height: 30000 }, { quality: 1.1 }, { background: '#fff' }, { resolution: NaN }, { extra: true }]) assert.equal(exportOptionsSchema.safeParse({ ...valid, ...invalid }).success, false)
  assert.equal(exportOptionsSchema.safeParse({ ...valid, width: 8193, height: 1 }).success, true)
  const source = encodePNG(raster), result = await encodeExport(source, { ...valid, width: 4, height: 2, resolution: 96 })
  assert.equal(decodeExportPNG(result.data).width, 4); assert.equal(decodeExportPNG(source).width, 2)
  assert.throws(() => decodeExportPNG(source.subarray(0, 20)))
  const bomb = Buffer.from(source); bomb.writeUInt32BE(1_000_000, 16); assert.throws(() => decodeExportPNG(bomb), /limits/)
  await assert.rejects(encodeExport(source, { ...valid, format: 'jpeg' }), /encoder/)
})
