import { randomUUID } from 'node:crypto'
import { decodeForeign, readRawMetadata, normalizeRawSettings, safeSourceName, type RawImportSettings, type ForeignImage } from '../core/foreign-import'
import { EditorError, type EditorState } from '../shared/contracts'
export interface ForeignCameraRawTarget { id: string; sessionId: string; layerId: string; revision: number }
export interface ForeignImportState { id?: string; kind?: 'raw' | 'heif' | 'svg' | 'raster'; filename?: string; status: 'idle' | 'metadata' | 'awaiting' | 'preview' | 'decoding' | 'committing' | 'error'; metadata?: { width: number; height: number; camera_make?: string; camera_model?: string }; settings?: RawImportSettings; preview?: string; error?: string; warnings?: string[]; svg?: string; raster?: string; cameraRawTarget?: ForeignCameraRawTarget }
interface Job { id: string; bytes: Uint8Array; sessionId: string; name: string; kind: 'raw' | 'heif' | 'svg' | 'raster'; newCanvas:boolean; openCameraRaw?:boolean; controller: AbortController; resolve: (value: unknown) => void; reject: (error: unknown) => void }
/** Coordinates GUI approval without exposing paths, file access, or mutations to the renderer. */
export class ForeignController {
  private current: ForeignImportState = { status: 'idle' }
  private job?: Job
  private cameraRawTargets: ForeignCameraRawTarget[] = []
  constructor(private notify: () => void, private importPNG: (sessionId: string, bytes: Uint8Array, name: string, warnings?:string[],newCanvas?:boolean) => Promise<unknown>) {}
  snapshot(): ForeignImportState { return structuredClone({ ...this.current, ...(this.cameraRawTargets[0] ? { cameraRawTarget:this.cameraRawTargets[0] } : {}) }) }
  takeCameraRawTarget(id:unknown): ForeignCameraRawTarget | undefined { if(typeof id!=='string'||this.cameraRawTargets[0]?.id!==id)return;const target=this.cameraRawTargets.shift()!;this.notify();return structuredClone(target) }
  private publish(value: Partial<ForeignImportState>): void { this.current = { ...this.current, ...value }; this.notify() }
  start(bytes: Uint8Array, filename: string, sessionId: string, kind: Job['kind'],options:{newCanvas?:boolean}={}): Promise<unknown> {
    if (this.job) throw new EditorError('DOCUMENT_BUSY', 'Finish or cancel the current image import first.')
    return new Promise((resolve, reject) => {
      const job = this.job = { id: randomUUID(), bytes, sessionId, name: safeSourceName(filename), kind,newCanvas:!!options.newCanvas, controller: new AbortController(), resolve, reject }
      this.current = { id: job.id, kind, filename: job.name, status: kind === 'raw' ? 'metadata' : 'decoding', settings: normalizeRawSettings(), ...(kind === 'svg' ? { svg: Buffer.from(bytes).toString('utf8') } : kind === 'raster' ? { raster: `data:image/${job.name.split('.').pop()!.toLowerCase()};base64,${Buffer.from(bytes).toString('base64')}` } : {}) }; this.notify()
      if (kind === 'raw') void readRawMetadata(bytes, job.name, { signal: job.controller.signal }).then(value => { if (this.job !== job) return; this.publish({ metadata: { width: value.width, height: value.height, camera_make: value.metadata.camera_make as string, camera_model: value.metadata.camera_model as string }, status: 'awaiting' }) }, error => this.fail(job, error))
      else if (kind === 'heif') void this.decode(job, normalizeRawSettings(), false)
      else setTimeout(() => { if (this.job === job) this.fail(job, new Error('SVG raster conversion timed out')) }, 30_000).unref()
    })
  }
  confirm(input: unknown,options:{openCameraRaw?:boolean}={}): ForeignImportState { const settings = normalizeRawSettings(input as Partial<RawImportSettings>), job = this.job; if (!job || job.kind !== 'raw' || !['awaiting', 'error'].includes(this.current.status)) throw new EditorError('INVALID_ARGUMENT', 'No RAW import is awaiting confirmation.'); if(options.openCameraRaw&&this.cameraRawTargets.length>=16)throw new EditorError('RESOURCE_LIMIT','Finish the pending Camera Raw imports before starting another.');job.openCameraRaw=options.openCameraRaw===true;void this.decode(job, settings, false); return this.snapshot() }
  preview(input: unknown): ForeignImportState { const settings = normalizeRawSettings(input as Partial<RawImportSettings>), job = this.job; if (!job || job.kind !== 'raw' || !['awaiting', 'error'].includes(this.current.status)) throw new EditorError('INVALID_ARGUMENT', 'No RAW import is available for preview.'); void this.decode(job, settings, true); return this.snapshot() }
  private async decode(job: Job, settings: RawImportSettings, preview: boolean): Promise<void> {
    this.publish({ status: preview ? 'preview' : 'decoding', settings, error: undefined })
    try {
      const result: ForeignImage = await decodeForeign(job.bytes, job.name, { format: job.kind === 'heif' ? 'heif' : 'raw', raw: preview ? { ...settings, halfSize: true } : settings, signal: job.controller.signal })
      if (this.job !== job) return
      if (preview) { this.publish({ preview: `data:image/png;base64,${Buffer.from(result.png).toString('base64')}`, status: 'awaiting', warnings: result.warnings }); return }
      this.publish({status:'committing'})
      const value = await this.importPNG(job.sessionId, result.png, job.name.replace(/\.[^.]+$/, ''),result.warnings,job.newCanvas)
      if (this.job !== job) return
      if(job.openCameraRaw){
        const imported=value as EditorState|undefined,layer=imported?.manifest?.layers?.find(item=>item.id===imported.manifest.activeLayerID)
        if(typeof imported?.sessionId!=='string'||!Number.isInteger(imported.revision)||!layer?.imageFile)throw new EditorError('INVALID_ARGUMENT','The imported RAW layer is no longer available.')
        this.cameraRawTargets.push({id:job.id,sessionId:imported.sessionId,layerId:layer.id,revision:imported.revision})
      }
      this.job = undefined; this.current = { status: 'idle', warnings: result.warnings }; this.notify(); job.resolve(value)
    } catch (error) { if (this.job !== job) return; if (preview) this.publish({ status: 'awaiting', error: error instanceof Error ? error.message : String(error) }); else this.fail(job, error) }
  }
  async svgComplete(input: { id: string; png?: Uint8Array; error?: string }): Promise<ForeignImportState> {
    const job = this.job
    if (!job || !['svg','raster'].includes(job.kind) || job.id !== input.id) throw new EditorError('INVALID_ARGUMENT', 'The SVG import request expired.')
    if (input.error) { this.fail(job, new Error(input.error)); return this.snapshot() }
    if (!input.png) throw new EditorError('INVALID_ARGUMENT', 'SVG conversion returned no pixels.')
    try { this.publish({status:'committing'});const value = await this.importPNG(job.sessionId, input.png, job.name.replace(/\.[^.]+$/, ''),undefined,job.newCanvas); if (this.job === job) { this.job = undefined; this.current = { status: 'idle', warnings: [job.kind === 'svg' ? 'SVG was rasterized; vector editability is not retained.' : 'Raster import creates a still image layer; animation is not retained.'] }; this.notify(); job.resolve(value) } } catch (error) { this.fail(job, error) }
    return this.snapshot()
  }
  cancel(): ForeignImportState { if(this.job&&this.current.status==='committing')return this.snapshot();const job = this.job; this.job = undefined; job?.controller.abort(); this.current = { status: 'idle' }; this.notify(); job?.resolve(null); return this.snapshot() }
  private fail(job: Job, error: unknown): void { if (this.job !== job) return; this.job = undefined; this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error), svg: undefined }); job.reject(error) }
}
