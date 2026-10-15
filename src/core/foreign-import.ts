import {DEFAULT_RAW_SETTINGS,normalizeRawSettings,type RawImportSettings} from '../shared/raw-settings'
export {DEFAULT_RAW_SETTINGS,normalizeRawSettings,type RawImportSettings} from '../shared/raw-settings'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { FOREIGN_WORKER_SOURCE } from './foreign-worker-source'
import { inspectHeif } from './foreign-color'
import { LIMITS } from '../shared/limits'
export const FOREIGN_CODEC_LIMITS = { maxInputBytes: 64 * 1024 * 1024, wasmBytes: 512 * 1024 * 1024, maxDecodedPixels: Math.floor(512 * 1024 * 1024 / 16) } as const
export interface ForeignImage { width: number; height: number; rgba: Uint8Array; png: Uint8Array; sourceName: string; format: 'raw' | 'heif'; colorProfile: string; orientationApplied: true; metadata: Record<string, unknown>; warnings: string[] }
export interface ForeignMetadata { width: number; height: number; metadata: Record<string, unknown> }
export interface ForeignDecodeOptions { format?: 'raw' | 'heif'; raw?: Partial<RawImportSettings>; signal?: AbortSignal; timeoutMs?: number; maxSide?: number; maxPixels?: number; onMetadata?: (value: { width: number; height: number; metadata: Record<string, unknown> }) => void; codecPaths?: { rawModule?: string; rawWasm?: string; heifModule?: string; heifWasm?: string } }
export const RAW_EXTENSIONS = ['dng', 'arw', 'cr2', 'cr3', 'nef', 'nrw', 'orf', 'raf', 'rw2', 'rwl', 'pef', 'srw', 'erf', '3fr', 'fff', 'iiq', 'kdc', 'mrw', 'mos', 'x3f', 'raw', 'crw', 'mdc'] as const
export function safeSourceName(filename: string): string { return basename(filename.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f/:*?"<>|]/g, '_').trim().slice(0, 200) || 'Imported image' }
/** One isolated worker per import. Main thread never executes native/WASM decoding. */
export async function decodeForeign(bytes: Uint8Array, filename: string, options: ForeignDecodeOptions = {}): Promise<ForeignImage> { return await foreignWorker(bytes, filename, options, false) as ForeignImage }
export async function readRawMetadata(bytes: Uint8Array, filename: string, options: ForeignDecodeOptions = {}): Promise<ForeignMetadata> { return await foreignWorker(bytes, filename, { ...options, format: 'raw' }, true) as ForeignMetadata }
async function foreignWorker(bytes: Uint8Array, filename: string, options: ForeignDecodeOptions, metadataOnly: boolean): Promise<ForeignImage | ForeignMetadata> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 16 || bytes.byteLength > FOREIGN_CODEC_LIMITS.maxInputBytes) throw new Error('Foreign image must be between 16 bytes and 64 MiB')
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Import canceled', 'AbortError')
  const extension = filename.split('.').pop()?.toLowerCase(), format = options.format ?? (extension === 'heic' || extension === 'heif' || extension === 'hif' ? 'heif' : RAW_EXTENSIONS.includes(extension as typeof RAW_EXTENSIONS[number]) ? 'raw' : undefined)
  if (!format) throw new Error('Unsupported RAW/HEIF file extension')
  const maxSide = options.maxSide ?? LIMITS.maxSide, maxPixels = options.maxPixels ?? LIMITS.maxSurfacePixels, timeoutMs = options.timeoutMs ?? 60_000
  if (!Number.isInteger(maxSide) || maxSide < 1 || maxSide > LIMITS.maxSide || !Number.isInteger(maxPixels) || maxPixels < 1 || maxPixels > LIMITS.maxSurfacePixels || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid foreign import resource limits')
  const color = format === 'heif' ? inspectHeif(bytes, maxSide, maxPixels).color : { label: 'sRGB', warnings: [] }
  const raw = normalizeRawSettings(options.raw), require = createRequire(import.meta.url), paths = options.codecPaths ?? {}
  const rawModule = paths.rawModule ?? join(dirname(require.resolve('libraw-wasm')), 'libraw.js'), rawWasm = paths.rawWasm ?? rawModule.replace(/\.js$/, '.wasm')
  const heifModule = paths.heifModule ?? require.resolve('libheif-js/libheif-wasm/libheif.js'), heifWasm = paths.heifWasm ?? require.resolve('libheif-js/libheif-wasm/libheif.wasm')
  // Copy rather than detach caller-owned file bytes. Worker input and decoded pixels are transferred.
  const input = new Uint8Array(bytes)
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(FOREIGN_WORKER_SOURCE, { eval: true, execArgv: [], workerData: { bytes: input, format, raw, color, rawModule, rawWasm, heifModule, heifWasm, maxSide, maxPixels, decoderPixels: FOREIGN_CODEC_LIMITS.maxDecodedPixels, wasmBytes: FOREIGN_CODEC_LIMITS.wasmBytes, metadataOnly, pngjs: require.resolve('pngjs') }, transferList: [input.buffer], resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } })
    const finish = (error?: unknown, result?: ForeignImage | ForeignMetadata) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); void worker.terminate(); if (error) reject(error); else resolve(result!) }
    const cancel = () => finish(options.signal?.reason ?? new DOMException('Import canceled', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('Foreign image decode timed out')), timeoutMs)
    options.signal?.addEventListener('abort', cancel, { once: true })
    worker.on('message', (message: Record<string, any>) => {
      if (settled) return
      if (message.type === 'metadata') { try { options.onMetadata?.({ width: message.width, height: message.height, metadata: message.metadata }) } catch (error) { finish(error) } }
      else if (message.type === 'metadata-result') finish(undefined, { width: message.width, height: message.height, metadata: message.metadata })
      else if (message.type === 'error') finish(new Error(`Foreign image decode failed: ${message.message}`))
      else if (message.type === 'result') {
        if (!(message.rgba instanceof Uint8Array) || !Number.isInteger(message.width) || !Number.isInteger(message.height) || message.width < 1 || message.height < 1 || message.width > maxSide || message.height > maxSide || message.width * message.height > maxPixels || message.rgba.length !== message.width * message.height * 4) return finish(new Error('Invalid foreign decoder result'))
        finish(undefined, { width: message.width, height: message.height, rgba: message.rgba, png: message.png, sourceName: safeSourceName(filename), format, colorProfile: message.colorProfile, orientationApplied: true, metadata: message.metadata, warnings: message.warnings })
      }
    })
    worker.on('error', finish); worker.on('exit', code => { if (!settled) finish(new Error(`Foreign image worker exited before a result (${code})`)) })
    if (options.signal?.aborted) cancel()
  })
}
