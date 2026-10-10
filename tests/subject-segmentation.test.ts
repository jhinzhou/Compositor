import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { ensureSubjectModel, preprocessSubjectRGB, SUBJECT_MODEL, SubjectSegmenter, subjectOutputCoverage } from '../src/core/subject-segmentation'

function image(): PNG {
  const png = new PNG({ width: 96, height: 96 })
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) { const circle = (x - 48) ** 2 + (y - 48) ** 2 < 28 ** 2; png.data.set(circle ? [210, 30, 30, 255] : [240, 240, 240, 255], (y * 96 + x) * 4) }
  return png
}
test('U2NetP preprocessing uses NCHW RGB normalization and finite black input', () => {
  const png = image(), input = preprocessSubjectRGB(png, [10, 20, 30, 40])
  assert.equal(input.data.length, 3 * 320 * 320); assert.deepEqual(input.bounds, [10, 20, 30, 40]); assert.ok(input.data.every(Number.isFinite))
  const black = new PNG({ width: 1, height: 1 }); assert.ok(preprocessSubjectRGB(black).data.every(Number.isFinite))
})
test('predicted masks normalize and resize only inside the object box, preserving image alpha', () => {
  const png = new PNG({ width: 4, height: 4 }); png.data.fill(255); png.data[(1 * 4 + 1) * 4 + 3] = 128
  const result = subjectOutputCoverage(png, new Float32Array([1, 0, 0, 0]), 2, 2, [1, 1, 2, 2])
  assert.equal(result.coverage[5], 128); assert.equal(result.coverage[0], 0); assert.equal(result.coverage[15], 0)
  assert.ok(subjectOutputCoverage(png, new Float32Array(4).fill(1), 2, 2, [0, 0, 4, 4]).coverage.every(value => value === 0))
  assert.throws(() => subjectOutputCoverage(png, new Float32Array([Number.NaN]), 1, 1, [0, 0, 4, 4]), /nonfinite/)
})
test('bundled model is pinned by size/SHA-256 and installs into a reusable verified cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subject-cache-'))
  try {
    const source = join(process.cwd(), 'fixtures/models/u2netp.onnx'), bytes = await readFile(source)
    assert.equal(bytes.length, SUBJECT_MODEL.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), SUBJECT_MODEL.sha256)
    const path = await ensureSubjectModel({ cacheDir: directory, bundledModelPath: source, fetcher: async () => { throw new Error('Network should not be used') } })
    assert.equal(path, join(directory, SUBJECT_MODEL.file)); assert.deepEqual(await readFile(path), bytes)
    await ensureSubjectModel({ cacheDir: directory, fetcher: async () => { throw new Error('Cache must be reused') } })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('download corruption, HTTP failure and cancellation have explicit errors without publishing a model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subject-failed-'))
  try {
    await assert.rejects(ensureSubjectModel({ cacheDir: directory, fetcher: async () => new Response(new Uint8Array([1, 2, 3])) }), /SHA-256/)
    await assert.rejects(ensureSubjectModel({ cacheDir: directory, fetcher: async () => new Response(null, { status: 503 }) }), /HTTP 503/)
    await assert.rejects(ensureSubjectModel({ cacheDir: directory, signal: AbortSignal.abort() }), /canceled/)
    await assert.rejects(readFile(join(directory, SUBJECT_MODEL.file)))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('actual ONNX Runtime CPU inference produces nonuniform subject and cropped object masks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subject-inference-')), segmenter = new SubjectSegmenter({ cacheDir: directory, bundledModelPath: join(process.cwd(), 'fixtures/models/u2netp.onnx') })
  try {
    const png = image(), result = await segmenter.select(png)
    assert.equal(result.modelId, 'u2netp'); assert.equal(result.provider, 'cpu'); assert.equal(result.local, true)
    assert.ok(result.coverage[48 * 96 + 48] > result.coverage[0] + 50); assert.ok(result.elapsedMs > 0)
    const object = await segmenter.select(png, { box: [15, 15, 65, 65] }); assert.equal(object.coverage[0], 0); assert.ok(object.coverage.some(value => value > 128))
    await segmenter.dispose()
  } finally { await segmenter.dispose(); await rm(directory, { recursive: true, force: true }) }
})
