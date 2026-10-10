import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { contentAwareFill } from '../src/core/content-fill'

test('patch search matches independent native Compositor 1.4.8 C reference bytes', async () => {
  const fixture = JSON.parse(await readFile('fixtures/parity/native-1.4.8-content-fill.json', 'utf8')) as { samples: { name: string; width: number; height: number; inputRGBA: string; selection: string; expectedRGBA: string; result: number }[] }
  for (const sample of fixture.samples) {
    const data = Buffer.from(sample.inputRGBA, 'base64'), before = Buffer.from(data), mask = Buffer.from(sample.selection, 'base64')
    const filled = contentAwareFill({ width: sample.width, height: sample.height, data }, { width: sample.width, height: sample.height, coverage: mask })
    assert.equal(sample.result, 1); assert.deepEqual(filled.png.data, Buffer.from(sample.expectedRGBA, 'base64'), sample.name); assert.deepEqual(data, before)
    assert.equal(filled.filledPixels, [...mask].filter(Boolean).length); assert.ok(filled.donorCount > 0)
    assert.deepEqual(PNG.sync.read(PNG.sync.write(filled.png)).data, filled.png.data)
  }
})

test('missing opaque donors, compute limits and cancellation reject without changing source pixels', () => {
  const png = new PNG({ width: 4, height: 4 }); png.data.fill(255); const before = Buffer.from(png.data), selection = { width: 4, height: 4, coverage: new Uint8Array(16).fill(255) }
  assert.throws(() => contentAwareFill(png, selection), /Not enough unselected/)
  assert.throws(() => contentAwareFill(png, selection, { maximumWork: 1 }), /budget/)
  assert.throws(() => contentAwareFill(png, selection, { signal: AbortSignal.abort() }), /canceled/)
  assert.deepEqual(png.data, before)
})
