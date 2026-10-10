import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import { EditorError, LIMITS } from '../shared/contracts'
import type { RGBAImage, RasterSelection } from './selection-retouch'

export const SUBJECT_MODEL = {
  id: 'u2netp', file: 'u2netp.onnx', bytes: 4_574_861,
  sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  upstreamMD5: '8e83ca70e441ab06c318d82300c84806',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
  source: 'https://github.com/xuebinqin/U-2-Net', license: 'Apache-2.0',
  licenseURL: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE', inputSize: 320,
  description: 'Local CPU U²-NetP salient-object segmentation; cropped inference for Object Selection.'
} as const
export interface ModelProgress { phase: 'checking' | 'copying' | 'downloading' | 'loading' | 'inference' | 'ready'; received?: number; total?: number }
export interface ModelOptions { cacheDir: string; bundledModelPath?: string; signal?: AbortSignal; onProgress?: (progress: ModelProgress) => void; fetcher?: typeof fetch; timeoutMs?: number }
function canceled(signal?: AbortSignal): void { if (signal?.aborted) throw new EditorError('CANCELED', 'Subject selection was canceled.') }
function verify(bytes: Uint8Array): boolean { return bytes.byteLength === SUBJECT_MODEL.bytes && createHash('sha256').update(bytes).digest('hex') === SUBJECT_MODEL.sha256 }
async function verifiedFile(path: string): Promise<Buffer | undefined> {
  try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== SUBJECT_MODEL.bytes) return undefined; const bytes = await readFile(path); return verify(bytes) ? bytes : undefined }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
export async function ensureSubjectModel(options: ModelOptions): Promise<string> {
  canceled(options.signal); options.onProgress?.({ phase: 'checking' })
  await mkdir(options.cacheDir, { recursive: true })
  const path = join(options.cacheDir, SUBJECT_MODEL.file)
  if (await verifiedFile(path)) return path
  let bytes: Buffer | undefined
  if (options.bundledModelPath) { options.onProgress?.({ phase: 'copying' }); bytes = await verifiedFile(options.bundledModelPath) }
  if (!bytes) {
    options.onProgress?.({ phase: 'downloading', received: 0, total: SUBJECT_MODEL.bytes })
    const timeoutMs = options.timeoutMs ?? 60_000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new EditorError('INVALID_ARGUMENT', 'Invalid model download timeout.')
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    try {
      const response = await (options.fetcher ?? fetch)(SUBJECT_MODEL.url, { signal, redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const chunks: Uint8Array[] = [], reader = response.body.getReader(); let received = 0
      try {
        for (;;) { canceled(options.signal); const { done, value } = await reader.read(); if (done) break; received += value.byteLength; if (received > SUBJECT_MODEL.bytes) throw new EditorError('MODEL_CHECKSUM_FAILED', 'The model download exceeds its pinned size.'); chunks.push(value); options.onProgress?.({ phase: 'downloading', received, total: SUBJECT_MODEL.bytes }) }
      } finally { await reader.cancel().catch(() => {}) }
      bytes = Buffer.concat(chunks)
    } catch (error) {
      canceled(options.signal)
      if (error instanceof EditorError) throw error
      throw new EditorError('MODEL_DOWNLOAD_FAILED', `The subject model could not be downloaded: ${error instanceof Error ? error.message : String(error)}. Retry with a working connection or install the bundled model.`)
    }
  }
  canceled(options.signal)
  if (!verify(bytes)) throw new EditorError('MODEL_CHECKSUM_FAILED', 'The subject model failed its pinned SHA-256 verification; no model was installed.')
  const temporary = join(options.cacheDir, `.${SUBJECT_MODEL.file}.${randomUUID()}.tmp`)
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); canceled(options.signal); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
  return path
}
export type ObjectBounds = [number, number, number, number]
function checkImage(image: RGBAImage): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > LIMITS.maxSide || image.height > LIMITS.maxSide || image.width * image.height > LIMITS.maxSurfacePixels || image.data.length !== image.width * image.height * 4) throw new EditorError('INVALID_ARGUMENT', 'Subject selection requires a valid RGBA image.')
  if (image.width * image.height > 32_000_000) throw new EditorError('RESOURCE_LIMIT', 'This CPU subject-selection job is limited to 32 megapixels; use a smaller preview or image.')
}
function boundsFor(image: RGBAImage, box?: ObjectBounds): ObjectBounds {
  if (!box) return [0, 0, image.width, image.height]
  if (box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0) throw new EditorError('INVALID_ARGUMENT', 'Object Selection requires a nonempty box.')
  const x = Math.max(0, Math.floor(box[0])), y = Math.max(0, Math.floor(box[1])), right = Math.min(image.width, Math.ceil(box[0] + box[2])), bottom = Math.min(image.height, Math.ceil(box[1] + box[3]))
  if (right <= x || bottom <= y) throw new EditorError('INVALID_ARGUMENT', 'The Object Selection box is outside the image.')
  return [x, y, right - x, bottom - y]
}
export function preprocessSubjectRGB(image: RGBAImage, box?: ObjectBounds): { data: Float32Array; bounds: ObjectBounds } {
  checkImage(image); const bounds = boundsFor(image, box), [left, top, width, height] = bounds, size = SUBJECT_MODEL.inputSize, plane = size * size, resized = new Float32Array(plane * 3)
  let maximum = 1e-6
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.max(0, Math.min(width - 1, (x + .5) * width / size - .5)), sy = Math.max(0, Math.min(height - 1, (y + .5) * height / size - .5)), x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0
    for (let channel = 0; channel < 3; channel++) {
      let value = 0
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) { const at = ((top + Math.min(height - 1, y0 + yy)) * image.width + left + Math.min(width - 1, x0 + xx)) * 4; value += image.data[at + channel] * (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty) }
      resized[channel * plane + y * size + x] = value; maximum = Math.max(maximum, value)
    }
  }
  const mean = [.485, .456, .406], standardDeviation = [.229, .224, .225]
  for (let channel = 0; channel < 3; channel++) for (let index = 0; index < plane; index++) resized[channel * plane + index] = (resized[channel * plane + index] / maximum - mean[channel]) / standardDeviation[channel]
  return { data: resized, bounds }
}
export function subjectOutputCoverage(image: RGBAImage, output: Float32Array, outputWidth: number, outputHeight: number, bounds: ObjectBounds): RasterSelection {
  checkImage(image)
  if (!Number.isInteger(outputWidth) || !Number.isInteger(outputHeight) || outputWidth < 1 || outputHeight < 1 || outputWidth > 4096 || outputHeight > 4096 || output.length !== outputWidth * outputHeight) throw new EditorError('MODEL_OUTPUT_INVALID', 'The subject model returned an invalid mask shape.')
  let minimum = Infinity, maximum = -Infinity
  for (const value of output) { if (!Number.isFinite(value)) throw new EditorError('MODEL_OUTPUT_INVALID', 'The subject model returned nonfinite coverage.'); minimum = Math.min(minimum, value); maximum = Math.max(maximum, value) }
  const [left, top, width, height] = boundsFor(image, bounds), coverage = new Uint8Array(image.width * image.height), span = maximum - minimum
  if (span <= 1e-6) return { width: image.width, height: image.height, coverage }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.max(0, Math.min(outputWidth - 1, (x + .5) * outputWidth / width - .5)), sy = Math.max(0, Math.min(outputHeight - 1, (y + .5) * outputHeight / height - .5)), x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0
    let value = 0
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) value += output[Math.min(outputHeight - 1, y0 + yy) * outputWidth + Math.min(outputWidth - 1, x0 + xx)] * (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty)
    const at = (top + y) * image.width + left + x
    coverage[at] = Math.round(Math.max(0, Math.min(1, (value - minimum) / span)) * image.data[at * 4 + 3])
  }
  return { width: image.width, height: image.height, coverage }
}
export interface SubjectResult extends RasterSelection { modelId: 'u2netp'; provider: 'cpu'; bounds: ObjectBounds; elapsedMs: number; local: true }
export class SubjectSegmenter {
  private session?: ort.InferenceSession
  private loading?: Promise<void>
  private running = false
  constructor(private readonly options: Omit<ModelOptions, 'signal'>) {}
  async prepare(signal?: AbortSignal): Promise<void> {
    canceled(signal)
    if (!this.session) {
      this.loading ??= (async () => {
        const path = await ensureSubjectModel({ ...this.options, signal }); this.options.onProgress?.({ phase: 'loading' })
        try { this.session = await ort.InferenceSession.create(path, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all' }) }
        catch (error) { throw new EditorError('MODEL_RUNTIME_FAILED', `The local subject runtime could not load: ${error instanceof Error ? error.message : String(error)}`) }
      })().finally(() => { this.loading = undefined })
      await this.loading
    }
    canceled(signal); this.options.onProgress?.({ phase: 'ready' })
  }
  async select(image: RGBAImage, options: { box?: ObjectBounds; signal?: AbortSignal } = {}): Promise<SubjectResult> {
    if (this.running) throw new EditorError('MODEL_BUSY', 'A subject inference is already running.')
    this.running = true
    try {
      const start = performance.now(); await this.prepare(options.signal); canceled(options.signal)
      const input = preprocessSubjectRGB(image, options.box), session = this.session!; this.options.onProgress?.({ phase: 'inference' })
      let outputs: ort.InferenceSession.ReturnType
      try { outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input.data, [1, 3, SUBJECT_MODEL.inputSize, SUBJECT_MODEL.inputSize]) }) }
      catch (error) { throw new EditorError('MODEL_RUNTIME_FAILED', `Subject inference failed: ${error instanceof Error ? error.message : String(error)}`) }
      canceled(options.signal)
      const output = outputs[session.outputNames[0]]
      if (!output || output.type !== 'float32' || output.dims.length !== 4 || output.dims[0] !== 1 || output.dims[1] !== 1) throw new EditorError('MODEL_OUTPUT_INVALID', 'The subject model returned an unexpected tensor.')
      const result = subjectOutputCoverage(image, output.data as Float32Array, output.dims[3], output.dims[2], input.bounds)
      this.options.onProgress?.({ phase: 'ready' })
      return { ...result, modelId: SUBJECT_MODEL.id, provider: 'cpu', bounds: input.bounds, elapsedMs: performance.now() - start, local: true }
    } finally { this.running = false }
  }
  async dispose(): Promise<void> { if (this.running) throw new EditorError('MODEL_BUSY', 'Wait for subject inference to finish before releasing its session.'); await this.session?.release(); this.session = undefined }
}
