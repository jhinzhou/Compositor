import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { PNG } from 'pngjs'
import { SubjectWorker } from '../src/core/subject-worker'

const workerPath = join(process.cwd(), 'artifacts/subject-test.worker.cjs')
let built: Promise<void> | undefined
async function backend(): Promise<{ worker: SubjectWorker; directory: string }> {
  built ??= build({ entryPoints: ['src/core/subject-worker.ts'], outfile: workerPath, platform: 'node', target: 'node24', format: 'cjs', bundle: true, external: ['onnxruntime-node'] }).then(() => {})
  await built
  const directory = await mkdtemp(join(tmpdir(), 'subject-worker-'))
  return { directory, worker: new SubjectWorker({ workerPath, cacheDir: directory, bundledModelPath: join(process.cwd(), 'fixtures/models/u2netp.onnx') }) }
}
function picture(): PNG {
  const image = new PNG({ width: 96, height: 96 })
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) image.data.set((x - 48) ** 2 + (y - 48) ** 2 < 25 ** 2 ? [220, 20, 20, 255] : [240, 240, 240, 255], (y * 96 + x) * 4)
  return image
}
test('worker performs real ML inference off-thread with progress and immutable transferred snapshots', async () => {
  const { worker, directory } = await backend(), image = picture(), before = Buffer.from(image.data), phases: string[] = []
  try {
    const job = worker.segment(image, { onProgress: progress => phases.push(progress.phase) }); image.data.fill(0)
    const result = await job
    assert.ok(result.coverage[48 * 96 + 48] > result.coverage[0] + 50); assert.equal(result.local, true); assert.ok(phases.includes('inference')); assert.ok(phases.includes('loading'))
    assert.equal(image.data.length, before.length); assert.ok(image.data.every(value => value === 0))
  } finally { await worker.dispose(); await rm(directory, { recursive: true, force: true }) }
})
test('cancel terminates an active inference and the next operation recreates a working thread', async () => {
  const { worker, directory } = await backend(), controller = new AbortController()
  try {
    const canceled = worker.segment(picture(), { signal: controller.signal, jobId: 'cancel-native-inference', onProgress: progress => { if (progress.phase === 'inference') controller.abort() } })
    await assert.rejects(canceled, error => error instanceof Error && 'code' in error && error.code === 'CANCELED')
    const result = await worker.segment(picture()); assert.ok(result.coverage.some(value => value > 128))
  } finally { await worker.dispose(); await rm(directory, { recursive: true, force: true }) }
})
test('worker patch fill matches native C reference and returns a decodable PNG', async () => {
  const { worker, directory } = await backend()
  try {
    const fixture = JSON.parse(await readFile('fixtures/parity/native-1.4.8-content-fill.json', 'utf8')).samples[0]
    const input = Buffer.from(fixture.inputRGBA, 'base64'), mask = Buffer.from(fixture.selection, 'base64')
    const result = await worker.fill({ width: fixture.width, height: fixture.height, data: input }, { width: fixture.width, height: fixture.height, coverage: mask })
    assert.deepEqual(Buffer.from(result.data), Buffer.from(fixture.expectedRGBA, 'base64')); assert.deepEqual(PNG.sync.read(Buffer.from(result.bytes)).data, Buffer.from(result.data)); assert.deepEqual(input, Buffer.from(fixture.inputRGBA, 'base64'))
  } finally { await worker.dispose(); await rm(directory, { recursive: true, force: true }) }
})
