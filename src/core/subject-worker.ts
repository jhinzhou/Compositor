import { randomUUID } from 'node:crypto'
import {fork,type ChildProcess} from 'node:child_process'
import { PNG } from 'pngjs'
import { EditorError } from '../shared/contracts'
import { contentAwareFill } from './content-fill'
import type { ModelProgress, ObjectBounds, SubjectResult } from './subject-segmentation'
import type { RGBAImage, RasterSelection } from './selection-retouch'
import { LIMITS } from '../shared/limits'

export interface SubjectWorkerOptions { workerPath: string; cacheDir: string; bundledModelPath?: string; onProgress?: (progress: ModelProgress & { jobId: string }) => void }
export interface SubjectJobOptions { jobId?: string; signal?: AbortSignal; timeoutMs?: number; onProgress?: (progress: ModelProgress & { jobId: string }) => void }
export interface FillWorkerResult { width: number; height: number; data: Uint8Array; bytes: Uint8Array; filledPixels: number; donorCount: number; algorithm: 'compositor-patch-search-v1.4.8' }
interface Job {
  id: string; type: 'segment' | 'fill'; image: RGBAImage; box?: ObjectBounds; selection?: RasterSelection; maximumWork?: number
  resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: SubjectJobOptions['onProgress']; cleanup: () => void
}
interface WorkerRequest { id: string; type: 'segment' | 'fill'; image: RGBAImage; box?: ObjectBounds; selection?: RasterSelection; maximumWork?: number }
type WorkerReply = { id: string; type: 'progress'; progress: ModelProgress } | { id: string; type: 'result'; value: SubjectResult | FillWorkerResult } | { id: string; type: 'error'; code: string; message: string }

// Expensive model inference and native-style patch search run outside both the
// UI/main thread and the document command worker. Cancellation terminates the
// entire auxiliary process; no canceled result can publish a document mutation.
export class SubjectWorker {
  private worker?: ChildProcess
  private active?: Job
  private queued: Job[] = []
  private stopping = false
  private closed = false
  constructor(private readonly options: SubjectWorkerOptions) {}
  segment(image: RGBAImage, options: SubjectJobOptions & { box?: ObjectBounds } = {}): Promise<SubjectResult> {
    return this.enqueue('segment', image, options, { box: options.box }) as Promise<SubjectResult>
  }
  fill(image: RGBAImage, selection: RasterSelection, options: SubjectJobOptions & { maximumWork?: number } = {}): Promise<FillWorkerResult> {
    return this.enqueue('fill', image, options, { selection, maximumWork: options.maximumWork }) as Promise<FillWorkerResult>
  }
  private enqueue(type: Job['type'], image: RGBAImage, options: SubjectJobOptions, extra: Pick<Job, 'box' | 'selection' | 'maximumWork'>): Promise<unknown> {
    if (this.closed) return Promise.reject(new EditorError('WORKER_CLOSED', 'The image operation worker has been closed.'))
    if (options.signal?.aborted) return Promise.reject(new EditorError('CANCELED', 'The image operation was canceled.'))
    if (this.queued.length >= 8) return Promise.reject(new EditorError('RESOURCE_LIMIT', 'At most eight image operations may wait for the worker.'))
    const id = options.jobId ?? randomUUID(), timeout = options.timeoutMs ?? 90_000
    if (!id || this.active?.id === id || this.queued.some(job => job.id === id)) return Promise.reject(new EditorError('INVALID_ARGUMENT', 'Image operation IDs must be nonempty and unique.'))
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 300_000) return Promise.reject(new EditorError('INVALID_ARGUMENT', 'Invalid image operation timeout.'))
    const pixels = image.width * image.height
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > LIMITS.maxSide || image.height > LIMITS.maxSide || pixels > Math.min(LIMITS.maxSurfacePixels, 32_000_000) || image.data.length !== pixels * 4) return Promise.reject(new EditorError('RESOURCE_LIMIT', 'Invalid or oversized image operation surface (maximum 32 million pixels).'))
    if (extra.selection && (extra.selection.width !== image.width || extra.selection.height !== image.height || extra.selection.coverage.length !== pixels)) return Promise.reject(new EditorError('INVALID_ARGUMENT', 'The fill selection must match its source image.'))
    const queuedBytes = this.queued.reduce((bytes, job) => bytes + job.image.data.byteLength + (job.selection?.coverage.byteLength ?? 0), 0)
    if (queuedBytes + image.data.byteLength + (extra.selection?.coverage.byteLength ?? 0) > 256 * 1024 * 1024) return Promise.reject(new EditorError('RESOURCE_LIMIT', 'Queued image operation snapshots exceed the 256 MiB memory budget.'))
    return new Promise((resolve, reject) => {
      // Structured cloning here freezes the exact source snapshot while queued,
      // rather than reading assets a later revision has changed.
      const ownedImage = { width: image.width, height: image.height, data: Uint8Array.from(image.data) }
      const selection = extra.selection ? { ...extra.selection, coverage: Uint8Array.from(extra.selection.coverage) } : undefined
      const abort = (): void => { void this.cancel(id) }
      const timer = setTimeout(() => { void this.cancel(id, 'TIMEOUT', 'The image operation exceeded its time limit.') }, timeout)
      options.signal?.addEventListener('abort', abort, { once: true })
      const cleanup = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort) }
      this.queued.push({ id, type, image: ownedImage, box: extra.box ? [...extra.box] : undefined, selection, maximumWork: extra.maximumWork, resolve, reject, cleanup, onProgress: options.onProgress })
      this.pump()
    })
  }
  private createWorker(): ChildProcess {
    const worker = fork(this.options.workerPath,[],{serialization:'advanced',execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',COMPOSITOR_SUBJECT_PROCESS:JSON.stringify({cacheDir:this.options.cacheDir,bundledModelPath:this.options.bundledModelPath})},stdio:['ignore','ignore','pipe','ipc']})
    // ORT can crash when a worker_thread is terminated during N-API callbacks.
    // A process boundary makes cancellation and native failure independent of Electron.
    worker.stderr?.on('data',()=>{})
    worker.on('message', (reply: WorkerReply) => {
      if (this.worker !== worker || this.active?.id !== reply.id) return
      if (reply.type === 'progress') {
        const progress = { ...reply.progress, jobId: reply.id }
        try { this.options.onProgress?.(progress); this.active.onProgress?.(progress) } catch {}
        return
      }
      const job = this.active; this.active = undefined; job.cleanup()
      if (reply.type === 'result') job.resolve(reply.value)
      else job.reject(new EditorError(reply.code, reply.message))
      worker.unref(); worker.channel?.unref(); this.pump()
    })
    worker.on('error', error => { if (this.worker !== worker) return; this.worker = undefined; this.failActive(new EditorError('WORKER_FAILED', `The image operation worker failed: ${error instanceof Error ? error.message : String(error)}`)); this.pump() })
    worker.on('exit', code => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (this.active) this.failActive(new EditorError('WORKER_FAILED', `The image operation worker exited before returning a result (code ${code}).`))
      this.pump()
    })
    return worker
  }
  private failActive(error: EditorError): void { const job = this.active; this.active = undefined; if (job) { job.cleanup(); job.reject(error) } }
  private pump(): void {
    if (this.closed || this.stopping || this.active || !this.queued.length) return
    const job = this.queued.shift()!; this.active = job
    try {
      const worker = this.worker ??= this.createWorker(); worker.ref(); worker.channel?.ref()
      const request: WorkerRequest = { id: job.id, type: job.type, image: job.image, box: job.box, selection: job.selection, maximumWork: job.maximumWork }
      worker.send(request,error=>{if(error&&this.worker===worker&&this.active?.id===job.id){this.failActive(new EditorError('WORKER_FAILED',error.message));this.pump()}})
    } catch (error) { this.failActive(new EditorError('WORKER_FAILED', error instanceof Error ? error.message : String(error))); this.pump() }
  }
  async cancel(jobId?: string, code = 'CANCELED', message = 'The image operation was canceled.'): Promise<boolean> {
    const id = jobId ?? this.active?.id
    if (!id) return false
    const queued = this.queued.findIndex(job => job.id === id)
    if (queued >= 0) { const job = this.queued.splice(queued, 1)[0]; job.cleanup(); job.reject(new EditorError(code, message)); return true }
    if (this.active?.id !== id) return false
    this.stopping = true; this.failActive(new EditorError(code, message))
    const worker = this.worker; this.worker = undefined
    try { await terminate(worker) } finally { this.stopping = false; this.pump() }
    return true
  }
  async dispose(): Promise<void> {
    this.closed = true
    for (const job of this.queued.splice(0)) { job.cleanup(); job.reject(new EditorError('CANCELED', 'The application closed this image operation.')) }
    await this.cancel()
    const worker = this.worker; this.worker = undefined; await terminate(worker)
  }
}

async function terminate(worker:ChildProcess|undefined):Promise<void>{if(!worker||worker.exitCode!==null||worker.signalCode!==null)return;await new Promise<void>(resolve=>{worker.once('exit',()=>resolve());worker.kill('SIGKILL')})}

if (process.env.COMPOSITOR_SUBJECT_PROCESS&&process.send) {
  process.once('disconnect',()=>process.exit(0))
  const workerData=JSON.parse(process.env.COMPOSITOR_SUBJECT_PROCESS)
  const reply=(value:WorkerReply)=>process.send?.(value)
  let activeId = ''
  let segmenter: import('./subject-segmentation').SubjectSegmenter | undefined
  process.on('message', async (request: WorkerRequest) => {
    activeId = request.id
    try {
      if (request.type === 'segment') {
        if (!segmenter) {
          const { SubjectSegmenter } = await import('./subject-segmentation')
          segmenter = new SubjectSegmenter({ cacheDir: workerData.cacheDir, bundledModelPath: workerData.bundledModelPath, onProgress: progress => reply({ id: activeId, type: 'progress', progress } satisfies WorkerReply) })
        }
        const result = await segmenter.select(request.image, { box: request.box })
        reply({ id: request.id, type: 'result', value: result } satisfies WorkerReply)
      } else {
        reply({ id: request.id, type: 'progress', progress: { phase: 'inference' } } satisfies WorkerReply)
        const result = contentAwareFill(request.image, request.selection!, { maximumWork: request.maximumWork }), data = Uint8Array.from(result.png.data), bytes = Uint8Array.from(PNG.sync.write(result.png))
        const value: FillWorkerResult = { width: result.png.width, height: result.png.height, data, bytes, filledPixels: result.filledPixels, donorCount: result.donorCount, algorithm: result.algorithm }
        reply({ id: request.id, type: 'result', value } satisfies WorkerReply)
      }
    } catch (error) { reply({ id: request.id, type: 'error', code: error instanceof EditorError ? error.code : 'IMAGE_OPERATION_FAILED', message: error instanceof Error ? error.message : String(error) } satisfies WorkerReply) }
    finally { activeId = '' }
  })
}
