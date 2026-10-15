import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import { decodeForeign, safeSourceName, normalizeRawSettings } from '../src/core/foreign-import'
import { inspectHeif, inspectICC } from '../src/core/foreign-color'
const fixture = (name: string) => readFile(new URL(`./fixtures/foreign-import/${name}`, import.meta.url))
const stats = (rgba: Uint8Array) => { let min = 255, max = 0, opaque = 0; for (let i = 0; i < rgba.length; i += 4) { min = Math.min(min, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!); max = Math.max(max, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!); if (rgba[i + 3] === 255) opaque++ } return { min, max, opaque } }
test('real public CC0 RAW decodes full and half-size linear sRGB into opaque RGBA8', async () => {
  const bytes = await fixture('sample.dng'), source = JSON.parse(await readFile(new URL('./fixtures/foreign-import/SOURCE.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.raw.row[7].match(/Checksum'>([a-f0-9]{64})/)[1])
  const metadata: unknown[] = [], result = await decodeForeign(bytes, '../Camera/sample.dng', { onMetadata: value => metadata.push(value) })
  assert.equal(result.width, 1920); assert.equal(result.height, 818); assert.equal(result.rgba.length, 1920 * 818 * 4); assert.equal(result.sourceName, 'sample.dng'); assert.equal(result.metadata.camera_model, 'EOS 5D Mark III'); assert.equal(metadata.length, 1); assert.match(result.colorProfile, /sRGB/)
  const s = stats(result.rgba); assert.ok(s.max - s.min > 150); assert.equal(s.opaque, 1920 * 818)
  const half = await decodeForeign(bytes, 'sample.dng', { raw: { halfSize: true, exposureEV: -1 } }); assert.equal(half.width, 960); assert.equal(half.height, 409); assert.notEqual(half.rgba[5000], result.rgba[5000]); assert.equal(bytes.byteLength, 1538165)
  await mkdir('artifacts/foreign-import', { recursive: true }); const png = new PNG({ width: result.width, height: result.height }); png.data = Buffer.from(result.rgba); await writeFile('artifacts/foreign-import/raw-srgb.png', PNG.sync.write(png)); await writeFile('artifacts/foreign-import/raw.json', JSON.stringify({ width: result.width, height: result.height, source: source.raw, colorProfile: result.colorProfile, orientationApplied: result.orientationApplied, stats: s, warnings: result.warnings }, null, 2))
})
test('real HEIC ICC profile is converted and container orientation stays applied once', async () => {
  const bytes = await fixture('still-tiny.heic'), result = await decodeForeign(bytes, 'tiny.heic'); assert.equal(result.width, 320); assert.equal(result.height, 427); assert.equal(result.rgba.length, 320 * 427 * 4); assert.match(result.colorProfile, /ICC.*sRGB/); assert.ok(stats(result.rgba).max - stats(result.rgba).min > 150)
  const rotated = await decodeForeign(await fixture('rotated-cw90.heic'), 'rotated.heic'); assert.equal(rotated.width, 800); assert.equal(rotated.height, 600); assert.equal(rotated.orientationApplied, true)
  for (const [name, image] of [['heic-srgb', result], ['heic-rotated', rotated]] as const) { await mkdir('artifacts/foreign-import', { recursive: true }); const png = new PNG({ width: image.width, height: image.height }); png.data = Buffer.from(image.rgba); await writeFile(`artifacts/foreign-import/${name}.png`, PNG.sync.write(png)) }
})
test('RAW metadata budget rejects before unpack and HEIC size budget rejects before WASM', async () => {
  await assert.rejects(decodeForeign(await fixture('sample.dng'), 'sample.dng', { maxPixels: 100 }), /resource limits/)
  await assert.rejects(decodeForeign(await fixture('still-tiny.heic'), 'tiny.heic', { maxSide: 100 }), /resource limits/)
  const bytes = await fixture('still-tiny.heic'), header = inspectHeif(bytes); assert.ok(header.sizes.length); assert.throws(() => inspectHeif(bytes.subarray(0, 35)), /Invalid/)
})
test('timeout, abort before startup and abort during CPU processing terminate workers', async () => {
  const bytes = await fixture('sample.dng'); await assert.rejects(decodeForeign(bytes, 'sample.dng', { timeoutMs: 1 }), /timed out/)
  const early = new AbortController(); early.abort(); await assert.rejects(decodeForeign(bytes, 'sample.dng', { signal: early.signal }), error => (error as Error).name === 'AbortError')
  const live = new AbortController(); let ticked = false; const timer = setTimeout(() => { ticked = true }, 20)
  await assert.rejects(decodeForeign(bytes, 'sample.dng', { signal: live.signal, onMetadata: () => { setTimeout(() => live.abort(), 5) } }), error => (error as Error).name === 'AbortError'); clearTimeout(timer); assert.equal(ticked, true)
})
test('untrusted bytes, extension, settings, limits and filenames are bounded', async () => {
  await assert.rejects(decodeForeign(new Uint8Array(15), 'a.dng'), /16 bytes/); await assert.rejects(decodeForeign(new Uint8Array(16), 'a.png'), /extension/); await assert.rejects(decodeForeign(new Uint8Array(16), 'a.dng'), /decode failed/)
  await assert.rejects(decodeForeign(new Uint8Array(16), 'a.dng', { maxSide: 30001 }), /resource limits/); assert.throws(() => normalizeRawSettings({ exposureEV: NaN }), /settings/); assert.throws(() => normalizeRawSettings({ highlightMode: 10 as 0 }), /settings/)
  assert.equal(safeSourceName('C:\\private\\photo:*?\x00.dng'), 'photo____.dng'); assert.equal(safeSourceName(''), 'Imported image'); assert.throws(() => inspectICC(new Uint8Array(132)), /ICC/)
})
test('RAW TIFF orientation 6 rotates actual decoded pixels and swaps metadata dimensions', async () => {
  const bytes = await fixture('sample.dng'), oriented = Buffer.from(bytes); assert.equal(oriented.readUInt16LE(130), 274); oriented.writeUInt16LE(6, 138)
  const original = await decodeForeign(bytes, 'original.dng'), rotated = await decodeForeign(oriented, 'rotated.dng'); assert.equal(rotated.width, 818); assert.equal(rotated.height, 1920); assert.equal(rotated.metadata.flip, 6)
  const x = 200, y = 100, originalOffset = (y * original.width + x) * 4, rotatedOffset = (x * rotated.width + (original.height - 1 - y)) * 4
  assert.deepEqual(rotated.rgba.subarray(rotatedOffset, rotatedOffset + 4), original.rgba.subarray(originalOffset, originalOffset + 4))
})
function heifHeader(width: number, height: number, primaries = 1, transfer = 13): Buffer {
  const box = (type: string, payload: Buffer) => { const b = Buffer.alloc(8); b.writeUInt32BE(8 + payload.length); b.write(type, 4); return Buffer.concat([b, payload]) }
  const ispe = Buffer.alloc(12); ispe.writeUInt32BE(width, 4); ispe.writeUInt32BE(height, 8); const nclx = Buffer.alloc(11); nclx.write('nclx'); nclx.writeUInt16BE(primaries, 4); nclx.writeUInt16BE(transfer, 6)
  return Buffer.concat([box('ftyp', Buffer.from('heic\0\0\0\0')), box('meta', Buffer.concat([Buffer.alloc(4), box('iprp', box('ipco', Buffer.concat([box('ispe', ispe), box('colr', nclx)])))]))])
}
test('HEIF preflight accepts engine capacity separately from bounded codec and rejects HDR gamma', async () => {
  assert.equal(inspectHeif(heifHeader(30000, 1)).sizes[0]!.width, 30000); assert.throws(() => inspectHeif(heifHeader(30001, 1)), /resource limits/); assert.throws(() => inspectHeif(heifHeader(20000, 20000)), /resource limits/)
  assert.throws(() => inspectHeif(heifHeader(10, 10, 9, 16)), /HDR/); assert.throws(() => inspectHeif(heifHeader(10, 10, 1, 18)), /HDR/); assert.equal(inspectHeif(heifHeader(10, 10, 12, 13)).color.label, 'Display P3 → sRGB')
})
test('malformed ICC parametric curves and LUT profiles fail explicitly', () => {
  const profile = Buffer.alloc(132); profile.writeUInt32BE(132); profile.write('RGB ', 16); profile.write('XYZ ', 20); profile.write('acsp', 36)
  assert.throws(() => inspectICC(profile), /LUT/); profile.writeUInt32BE(129, 128); assert.throws(() => inspectICC(profile), /tag table/)
})
