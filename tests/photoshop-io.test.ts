import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { PNG } from 'pngjs'
import { readPsd, writePsdBuffer, type Psd, type PixelData } from 'ag-psd'
import { decodePhotoshop, encodePhotoshop, photoshopExportWarnings } from '../src/core/photoshop-io'
import { makeAsset } from '../src/core/project-io'
import { BLEND_MODES, type Manifest, type Layer } from '../src/shared/contracts'
const pixels = (width: number, height: number, color = [40, 90, 160, 128]): PixelData => ({ width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, () => color).flat()) })
function handcraftedPSD(): Buffer {
  // Independently written minimal Adobe 8BPS structure: raw planar channels, one layer, no library writer.
  const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b }, i16 = (value: number) => { const b = Buffer.alloc(2); b.writeInt16BE(value); return b }, u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b }, i32 = (value: number) => { const b = Buffer.alloc(4); b.writeInt32BE(value); return b }
  const name = Buffer.from([3, 82, 71, 66]), extra = Buffer.concat([u32(0), u32(0), name])
  const channels = [[0, [5, 6, 7, 8]], [1, [80, 81, 82, 83]], [2, [150, 151, 152, 153]], [-1, [1, 127, 255, 0]]] as [number, number[]][]
  const record = Buffer.concat([i32(1), i32(2), i32(3), i32(4), u16(4), ...channels.flatMap(([id]) => [i16(id), u32(6)]), Buffer.from('8BIMnorm'), Buffer.from([128, 0, 0, 0]), u32(extra.length), extra])
  const info = Buffer.concat([i16(1), record, ...channels.map(([, values]) => Buffer.concat([u16(0), Buffer.from(values)]))]), section = Buffer.concat([u32(info.length), info, u32(0)])
  const header = Buffer.concat([Buffer.from('8BPS'), u16(1), Buffer.alloc(6), u16(3), u32(4), u32(5), u16(8), u16(3)])
  return Buffer.concat([header, u32(0), u32(0), u32(section.length), section, u16(0), Buffer.alloc(5 * 4 * 3)])
}
test('independent raw Adobe PSD fixture preserves straight RGBA channels, origin and opacity', () => {
  const imported = decodePhotoshop(handcraftedPSD()), layer = imported.manifest.layers[0]!, png = PNG.sync.read(imported.assets.get(layer.imageFile!)!.bytes)
  assert.equal(imported.manifest.width, 5); assert.equal(imported.manifest.height, 4); assert.equal(layer.name, 'RGB'); assert.deepEqual(layer.transform.origin, [2, 1]); assert.equal(layer.opacity, 128 / 255)
  assert.deepEqual([...png.data], [5, 80, 150, 1, 6, 81, 151, 127, 7, 82, 152, 255, 8, 83, 153, 0])
})
test('PSD folders preserve bottom-to-top hierarchy, visibility, opacity and native blend mapping', () => {
  const psd: Psd = { width: 10, height: 8, children: [{ name: 'Folder', blendMode: 'pass through', opacity: .5, hidden: true, children: [{ name: 'Top', imageData: pixels(2, 2), left: 3, top: 4, blendMode: 'linear dodge' }, { name: 'Bottom', imageData: pixels(2, 2), left: 1, top: 2, blendMode: 'multiply' }] }, { name: 'Background', imageData: pixels(10, 8) }] }
  const imported = decodePhotoshop(writePsdBuffer(psd, { noBackground: true })), layers = imported.manifest.layers
  assert.deepEqual(layers.map(layer => layer.name), ['Background', 'Folder', 'Bottom', 'Top'])
  assert.equal(layers[1]!.isGroup, true); assert.equal(layers[1]!.isVisible, false); assert.ok(Math.abs(layers[1]!.opacity - .5) < .005)
  assert.equal(layers[2]!.parentID, layers[1]!.id); assert.equal(layers[3]!.blendMode, 'Linear Dodge (Add)')
})
test('PSB version 2 is actually decoded and emitted by the installed library', () => {
  const bytes = writePsdBuffer({ width: 8, height: 8, children: [{ name: 'PSB Layer', imageData: pixels(3, 2) }] }, { psb: true, noBackground: true })
  assert.equal(bytes.readUInt16BE(4), 2); const imported = decodePhotoshop(bytes)
  const encoded = encodePhotoshop(imported.manifest, imported.assets, { psb: true }); assert.equal(encoded.readUInt16BE(4), 2); assert.equal(decodePhotoshop(encoded).manifest.layers[0]!.name, 'PSB Layer')
})
test('mask patch is placed on layer grid with Photoshop outside default and link/disabled state', () => {
  const psd: Psd = { width: 8, height: 8, children: [{ name: 'Masked', left: 2, top: 3, imageData: pixels(3, 2), mask: { left: 3, top: 3, right: 4, bottom: 4, defaultColor: 255, disabled: true, positionRelativeToLayer: true, imageData: pixels(1, 1, [0, 0, 0, 255]) } }] }
  const imported = decodePhotoshop(writePsdBuffer(psd, { noBackground: true })), layer = imported.manifest.layers[0]!, mask = PNG.sync.read(imported.assets.get(layer.maskFile!)!.bytes)
  assert.equal(imported.assets.get(layer.maskFile!)!.bytes[25], 0); assert.equal(layer.maskEnabled, false); assert.equal(layer.maskLinked, false); assert.deepEqual(layer.maskPlacement?.origin, [2, 3]); assert.deepEqual([...mask.data].filter((_, index) => index % 4 === 0), [255, 0, 255, 255, 255, 255])
  const again = decodePhotoshop(encodePhotoshop(imported.manifest, imported.assets)), secondMask = PNG.sync.read(again.assets.get(again.manifest.layers[0]!.maskFile!)!.bytes)
  assert.deepEqual(secondMask.data, mask.data); assert.equal(again.manifest.layers[0]!.maskEnabled, false)
})
test('consecutive Photoshop clipping relationships retain their raster base', () => {
  const imported = decodePhotoshop(writePsdBuffer({ width: 4, height: 4, children: [{ name: 'Clipped', clipping: true, imageData: pixels(2, 2) }, { name: 'Base', imageData: pixels(2, 2) }] }, { noBackground: true }))
  assert.equal(imported.manifest.layers[1]!.maskSourceID, imported.manifest.layers[0]!.id)
  const again = decodePhotoshop(encodePhotoshop(imported.manifest, imported.assets)); assert.equal(again.manifest.layers[1]!.maskSourceID, again.manifest.layers[0]!.id)
})
test('horizontal text and basic shape metadata retain their unpremultiplied raster fallback', () => {
  const bytes = writePsdBuffer({ width: 40, height: 30, children: [{ name: 'Text', imageData: pixels(12, 5), text: { text: 'Hello', orientation: 'horizontal', transform: [1, 0, 0, 1, 0, 0], style: { font: { name: 'ArialMT' }, fontSize: 14, fillColor: { r: 100, g: 50, b: 20 } } } }, { name: 'Shape', imageData: pixels(10, 10), vectorFill: { type: 'color', color: { r: 255, g: 0, b: 0 } }, vectorOrigination: { keyDescriptorList: [{ keyOriginType: 5 }] } }] }, { noBackground: true })
  const imported = decodePhotoshop(bytes), text = imported.manifest.layers.find(layer => layer.name === 'Text')!, shape = imported.manifest.layers.find(layer => layer.name === 'Shape')!
  assert.equal((text.text as any).content, 'Hello'); assert.equal((text.text as any).fontName, 'ArialMT'); assert.equal((shape.shape as any).kind, 'Ellipse'); assert.ok(text.imageFile && shape.imageFile); assert.ok(imported.warnings.some(warning => warning.includes('font metrics')))
})
test('24 native blends survive PSD import/export without alias changes', () => {
  const original = decodePhotoshop(handcraftedPSD()), base = original.manifest.layers[0]!, layers: Layer[] = [], assets = new Map(original.assets)
  for (const mode of BLEND_MODES) { const id = randomUUID().toUpperCase(), file = `${id}.png`; layers.push({ ...structuredClone(base), id, name: mode, blendMode: mode, imageFile: file }); assets.set(file, makeAsset(file, original.assets.get(base.imageFile!)!.bytes)) }
  const manifest = { ...original.manifest, layers, activeLayerID: layers[0]!.id }, decoded = decodePhotoshop(encodePhotoshop(manifest, assets))
  assert.deepEqual(decoded.manifest.layers.map(layer => layer.blendMode), [...BLEND_MODES])
})
test('PSD export bakes transform flips and 90-degree rotation into positioned ordinary pixels', () => {
  const original = decodePhotoshop(handcraftedPSD()), layer = original.manifest.layers[0]!, source = PNG.sync.read(original.assets.get(layer.imageFile!)!.bytes)
  layer.transform.flipX = true; layer.transform.sampling = 'Nearest'
  const exported = readPsd(encodePhotoshop(original.manifest, original.assets), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true })
  assert.deepEqual([...exported.children![0]!.imageData!.data], [...source.data.subarray(4, 8), ...source.data.subarray(0, 4), ...source.data.subarray(12, 16), ...source.data.subarray(8, 12)])
  layer.transform.flipX = false; layer.transform.rotation = 90
  const rotated = readPsd(encodePhotoshop(original.manifest, original.assets), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true }); assert.equal(rotated.children![0]!.imageData!.width, 2); assert.equal(rotated.children![0]!.imageData!.height, 2)
  assert.ok(photoshopExportWarnings(original.manifest).some(warning => warning.includes('baked')))
})
test('provided composite pixels and document DPI are encoded for external viewers', () => {
  const original = decodePhotoshop(handcraftedPSD()), composite = new PNG({ width: 5, height: 4 }); composite.data.fill(255); original.manifest.resolution = 300
  const bytes = encodePhotoshop(original.manifest, original.assets, { compositePNG: PNG.sync.write(composite) }), psd = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  assert.equal(psd.imageResources!.resolutionInfo!.horizontalResolution, 300); assert.deepEqual([...psd.imageData!.data], [...composite.data])
})
test('invalid, CMYK, high-depth and excessive image headers fail before allocation', () => {
  assert.throws(() => decodePhotoshop(Buffer.from('not photoshop')), /valid PSD/)
  const cmyk = handcraftedPSD(); cmyk.writeUInt16BE(4, 24); assert.throws(() => decodePhotoshop(cmyk), /8-bit RGB/)
  const high = handcraftedPSD(); high.writeUInt16BE(16, 22); assert.throws(() => decodePhotoshop(high), /8-bit RGB/)
  const large = handcraftedPSD(); large.writeUInt32BE(30001, 18); assert.throws(() => decodePhotoshop(large), /resource limits/)
  const corrupt = handcraftedPSD().subarray(0, 45); assert.throws(() => decodePhotoshop(corrupt), /decode/)
})
test('layer and aggregate resource budgets reject excess structures', () => {
  const many = writePsdBuffer({ width: 2, height: 2, children: Array.from({ length: 10001 }, (_, index) => ({ name: `L${index}` })) }, { noBackground: true })
  assert.throws(() => decodePhotoshop(many), /layer count/)
  const original = decodePhotoshop(handcraftedPSD()), layer = original.manifest.layers[0]!; layer.transform.size = [30001, 30001]
  assert.throws(() => encodePhotoshop(original.manifest, original.assets), /resource limits/)
})
test('missing pixels on a special Photoshop layer are explicitly rejected', () => {
  const bytes = writePsdBuffer({ width: 30, height: 30, children: [{ name: 'Unrendered text', text: { text: 'Hello', style: { fontSize: 12 } } }] }, { noBackground: true })
  assert.throws(() => decodePhotoshop(bytes), /no raster fallback/)
})
test('identity export preserves color hidden under zero and low alpha without premultiplication', () => {
  const imported = decodePhotoshop(handcraftedPSD()), layer = imported.manifest.layers[0]!, expected = PNG.sync.read(imported.assets.get(layer.imageFile!)!.bytes)
  const psd = readPsd(encodePhotoshop(imported.manifest, imported.assets), { useImageData: true, skipThumbnail: true, skipCompositeImageData: true })
  assert.deepEqual([...psd.children![0]!.imageData!.data], [...expected.data])
})
test('fill opacity multiplies layer coverage when no Photoshop effect is present', () => {
  const decoded = decodePhotoshop(writePsdBuffer({ width: 4, height: 4, children: [{ name: 'Fill', imageData: pixels(2, 2), opacity: .8, fillOpacity: .5 }] }, { noBackground: true }))
  assert.ok(Math.abs(decoded.manifest.layers[0]!.opacity - .4) < .003)
})
