import {documentInfoSchema} from '../shared/document-info'
import {editorMenuTemplate,nativeAccelerator} from './editor-menu'
import {expandImageImports} from './image-folder'
import {countAssetBackingBytes} from '../core/deep-assets'
import type {ShapeTransformRender,PreparedShapeTransform} from '../shared/content-transform'
import {refineSubjectMatte,pickSubjectComponent} from '../shared/subject-matte'
import {SubjectPreviewCache} from './subject-preview-cache'
import {EdgeRefinementPreviews,edgeRefinementImages} from './edge-refinement-preview'
import type {TrimapDraftSettings} from '../shared/trimap-draft'
import {installedFonts} from './font-catalog'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, utilityProcess, safeStorage, clipboard, ClipboardItem, type UtilityProcess } from 'electron'
import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SubjectWorker } from '../core/subject-worker'
import type {RGBAImage,RasterSelection} from '../core/selection-retouch'
import { mutationSchema,batchSchema,transformSchema } from '../shared/contracts'
import {documentPixelBudget} from '../shared/limits'
import {totalmem} from 'node:os'
import {calculateTrimBounds} from '../shared/trim'
import {PNG} from 'pngjs'
import { ModelSettingsStore } from './model-settings'
import { LocaleSettingsStore } from './locale-settings'
import { isLocale, translate, translateMessage, type Locale, type TranslationParams } from '../shared/i18n'
import { AgentController } from './agent-controller'
import { ForeignController } from './foreign-controller'
import { PhotoshopController } from './photoshop-controller'
import { encodePhotoshopAsync, type PhotoshopSnapshot } from '../core/photoshop-worker'
import { RAW_EXTENSIONS } from '../core/foreign-import'
import { rasterDimensions } from '../core/raster-header'
import { FileExperience, launchFilePaths, validateProjectPath } from './file-experience'
import { EditorRpc } from './editor-rpc'
import { RenderQueue } from './render-queue'
import { SourceWatch } from './source-watch'
import type { ExternalProjectStatus } from '../shared/external-project'
import { z } from 'zod'
import { clipCanvasPixels } from '../core/pixel-clipboard'
import { encodeExport } from '../core/export-codecs'
import {normalizeChord} from '../renderer/command-shortcuts'
import {imageFilterSchema,FILTER_NAMES,FILTER_PARITY_LIMITATIONS,NATIVE_ADJUSTMENT_KINDS,specToNativeAdjustment} from '../shared/image-filters'
import { exportOptionsSchema } from '../shared/export-options'
import { mergeSelectionPlan } from '../core/layer-operations'
import { BLEND_MODES, MCP_TOOLS, taskReadSchema, taskBeginSchema, taskCancelSchema, taskFinishSchema, taskUndoSchema, EditorError, failure, LIMITS, type BridgeInfo, type EditorState, type PreviewResult, type RpcResult } from '../shared/contracts'

const here = fileURLToPath(new URL('.', import.meta.url))
app.setName('Compositor Electron')
if (process.env.COMPOSITOR_PROFILE) app.setPath('userData', process.env.COMPOSITOR_PROFILE)
protocol.registerSchemesAsPrivileged([{ scheme: 'compositor-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

let window: BrowserWindow | undefined
let renderWindow: BrowserWindow | undefined
let editor: UtilityProcess
let bridge: Server
let bridgeInfo: BridgeInfo
let lastState: EditorState
let closeConfirmed = false, closing = false, shutdownStarted = false
let canvasOnlyWindow:{alreadyFullscreen:boolean}|undefined
let renderCount = 0
let subjectWorker:SubjectWorker
const imageJobs=new Map<string,{controller:AbortController;taskId?:string;sessionId:string;progress?:{phase:string}}>()
function imageOperationState(){return [...imageJobs].map(([id,job])=>({id,sessionId:job.sessionId,progress:job.progress}))}
function imageProgress(){window?.webContents.send('editor:action','imageOperationState')}
let pixelClipboard:{bytes:Buffer;origin:[number,number];sessionId:string;marker:string}|undefined
let layerClipboardMarker:string|undefined
const clipboardFormat='web application/x-compositor-electron-clipboard'
const interactions = new Map<string, Map<string, number>>()
const modelSettings=new ModelSettingsStore(join(app.getPath('userData'),'model-settings.json'),{available:()=>safeStorage.isEncryptionAvailable(),encrypt:text=>safeStorage.encryptString(text),decrypt:bytes=>safeStorage.decryptString(bytes)})
const agentController=new AgentController(()=>bridgeInfo,()=>required<EditorState>('state'),state=>window?.webContents.send('agent:state',state),config=>modelSettings.save(config))
const foreignController = new ForeignController(() => window?.webContents.send('editor:action', 'foreignState'), async (sessionId, bytes, name, warnings,newCanvas) => { await requireWritable(sessionId); return required(newCanvas?'newCanvasPaste':'importForeign', { sessionId, bytes, name, warnings }) })
const photoshopController = new PhotoshopController(join(here,'photoshop.js'),()=>window?.webContents.send('editor:action','photoshopState'),async(snapshot,title)=>{await requireWritable();return required('importPhotoshopSnapshot',{snapshot,title,retainedWorkingBytes:countAssetBackingBytes(snapshot.assets.map(([,asset])=>asset))})})
const recentFiles = new FileExperience(join(app.getPath('userData'), 'recent-projects.json'), () => window?.webContents.send('editor:action', 'recentState'))
const pendingOpenFiles = launchFilePaths(process.argv, process.cwd())
let fileOpeningReady = false, drainingOpenFiles = false
app.on('open-file', (event, path) => { event.preventDefault(); if (pendingOpenFiles.length < 32) pendingOpenFiles.push(path); void drainOpenFiles() })
app.on('second-instance', (_event, args, cwd) => { window?.show(); window?.focus(); pendingOpenFiles.push(...launchFilePaths(args, cwd).slice(0, Math.max(0,32-pendingOpenFiles.length))); void drainOpenFiles() })
async function openProjectFile(path: string): Promise<EditorState> {
  await requireWritable(); const canonical = await validateProjectPath(path)
  if(/\.ps[db]$/i.test(canonical)&&(await lstat(canonical)).size>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','PSD/PSB exceeds the encoded file budget.')
  const workspace = await required<EditorState>('state'), existing = workspace.workspace?.documents.find(document => document.projectPath === canonical)
  const value = existing ? await required<EditorState>('switch', { sessionId: existing.sessionId }) : /\.ps[db]$/i.test(canonical) ? await photoshopController.start(await readFile(canonical),basename(canonical)) as EditorState|null : await required<EditorState>('open', { path: canonical })
  if(!value)return required<EditorState>('state')
  await recentFiles.record(canonical); app.addRecentDocument(canonical); return value
}
async function drainOpenFiles(): Promise<void> {
  if (!fileOpeningReady || drainingOpenFiles) return; drainingOpenFiles = true
  try { while (pendingOpenFiles.length) { const path = pendingOpenFiles.shift()!; try { await openProjectFile(path) } catch (error) { lastFileOpenError = error instanceof Error ? error.message : String(error); window?.webContents.send('editor:action', 'fileOpenError') } } } finally { drainingOpenFiles = false }
}
let lastFileOpenError: string | undefined
const closingDocuments = new Set<string>()
const savingDocuments = new Set<string>()
const sourceWatch = new SourceWatch(
  sessionId => required<ExternalProjectStatus>('externalStatus', { sessionId }),
  (sessionId, expectedRevision, fingerprint) => required('reload', { sessionId, expectedRevision, fingerprint }),
  sessionId => closing || closingDocuments.has(sessionId) || savingDocuments.has(sessionId) || interactionBusy(sessionId) || renderCount > 0 || [...imageJobs.values()].some(job => job.sessionId === sessionId) || agentController.snapshot().status === 'running',
  () => window?.webContents.send('editor:action', 'externalState')
)
function interactionBusy(sessionId: string): boolean {
  const leases = interactions.get(sessionId)
  if (!leases) return false
  for (const [id, expiry] of leases) if (expiry <= Date.now()) leases.delete(id)
  if (!leases.size) interactions.delete(sessionId)
  return leases.size > 0
}
let applicationLocale: Locale = 'en'
const localeSettings = new LocaleSettingsStore(join(app.getPath('userData'), 'language-settings.json'))
const t = (source: string, params?: TranslationParams) => translate(applicationLocale, source, params)
let nativeMenuTemplate:Electron.MenuItemConstructorOptions[]=[]
let shortcutOverrides: Record<string, string> = {}
let menuCapabilities: Record<string, boolean> = {}
function installShortcuts(overrides?: Record<string, string>): void {
  if (overrides) shortcutOverrides = { ...overrides }
  const adjust = (items: Electron.MenuItemConstructorOptions[]): Electron.MenuItemConstructorOptions[] => items.map(original => {
    const item = { ...original }
    if (item.label) item.label = t(item.label, { version: app.getVersion() })
    if (item.id === 'locale:zh-CN' || item.id === 'locale:en') item.checked = applicationLocale === item.id.slice(7)
    if (item.id && item.id in shortcutOverrides) {
      const chord = shortcutOverrides[item.id]
      item.accelerator = nativeAccelerator(chord)
    }
    if(item.id&&Object.hasOwn(menuCapabilities,item.id)&&!['undo','redo','cut','copy','paste','select-all'].includes(item.id))item.enabled=menuCapabilities[item.id]
    if (Array.isArray(item.submenu)) item.submenu = adjust(item.submenu)
    return item
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(adjust(nativeMenuTemplate)))
}
async function setApplicationLocale(locale: Locale): Promise<{ locale: Locale }> {
  // Persist first: failed writes cannot leave menus and the saved preference out of sync.
  try { await localeSettings.save(locale) } catch { throw new EditorError('SETTINGS_WRITE_FAILED', 'Could not save language settings.') }
  applicationLocale = locale
  installShortcuts()
  window?.webContents.send('editor:action', 'localeChanged')
  renderWindow?.webContents.send('editor:action', 'localeChanged')
  return { locale }
}
function changeMenuLocale(locale: Locale): void {
  void setApplicationLocale(locale).catch(error => {
    if (window && !window.isDestroyed()) void dialog.showMessageBox(window, { type: 'error', title: t('Could not change language'), message: translateMessage(applicationLocale, error instanceof Error ? error.message : String(error)), buttons: [t('OK')] })
  })
}

const editorRpc = new EditorRpc(message => editor.postMessage(message))
const renderQueue = new RenderQueue()
const renders = new Map<string, { resolve: (value: RpcResult<PreviewResult>) => void; timer: NodeJS.Timeout }>()

function workerCall<T = unknown>(method: string, params?: unknown): Promise<RpcResult<T>> {
  return editorRpc.request<T>(method, params)
}
async function required<T = unknown>(method: string, params?: unknown): Promise<T> {
  const result = await workerCall<T>(method, params)
  if (!result.ok) throw new EditorError(result.error.code, result.error.message, result.error.details)
  return result.value
}
function loadWindow(target: BrowserWindow, render = false): Promise<void> {
  const url = process.env.ELECTRON_RENDERER_URL
  return url ? target.loadURL(`${url}${render ? '?render=1' : ''}`) : target.loadFile(join(here, '../renderer/index.html'), render ? { query: { render: '1' } } : undefined)
}
function options(): Electron.BrowserWindowConstructorOptions {
  return { backgroundColor: '#18191d', webPreferences: { preload: join(here, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } }
}
async function renderPreview(params: unknown, fullSize = false, layers?: EditorState['manifest']['layers'],content?:Extract<import('../shared/contracts').EditAction,{type:'layer.text'|'layer.shape'}>, snapshot?:EditorState): Promise<PreviewResult> {
  const request = z.object({ sessionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), maxDimension: z.number().int().min(64).max(2048).default(1024) }).strict().parse(params)
  const release = await renderQueue.acquire(request.sessionId)
  renderCount++
  try {
    const current = await required<EditorState>('state', { sessionId: request.sessionId });const state=snapshot??current
    if (request.sessionId !== state.sessionId) throw new EditorError('SESSION_EXPIRED', 'The requested document is no longer open.')
    if (request.expectedRevision !== current.revision||request.expectedRevision!==state.revision) throw new EditorError('SNAPSHOT_EXPIRED', 'Only the current revision can be captured. Read state and request a new preview.')
    if (!renderWindow || renderWindow.isDestroyed()) {
      renderWindow = new BrowserWindow({ ...options(), show: false, width: 1000, height: 800 })
      await loadWindow(renderWindow, true)
    }
    const result = await new Promise<RpcResult<PreviewResult>>(resolve => {
      const id = randomUUID()
      const timer = setTimeout(() => { renders.delete(id); resolve(failure(new EditorError('RENDER_TIMEOUT', 'The render exceeded 30 seconds.'))) }, 30_000)
      renders.set(id, { resolve, timer })
      if(layers)state.manifest={...state.manifest,layers}
      renderWindow!.webContents.send('renderer:render', { id, state, maxDimension: request.maxDimension, fullSize,content })
    })
    if (!result.ok) throw new EditorError(result.error.code, result.error.message, result.error.details)
    return result.value
  } finally { renderCount--; release() }
}
async function applyContentTransforms(request:unknown,batch:boolean,source:'user'|'agent'|'system'):Promise<unknown> {
 const parsed=batch?batchSchema.parse(request):mutationSchema.parse(request),plan=await required<{cached?:unknown;renders:ShapeTransformRender[]}>('prepareContentTransforms',{request:parsed,batch,source})
 if(plan.cached)return plan.cached
 if(!plan.renders.length)return required(batch?'applyBatch':'apply',{request:parsed,source})
 const prepared:PreparedShapeTransform[]=[]
 for(const render of plan.renders){const png=await renderPreview({sessionId:parsed.sessionId,expectedRevision:parsed.expectedRevision},true,undefined,{type:'layer.shape',layerId:render.layerId,name:'Shape',style:render.style,size:render.size});prepared.push({...render,bytes:new Uint8Array(Buffer.from(png.data,'base64'))})}
 return required('commitPreparedTransforms',{request:parsed,batch,source,prepared})
}
async function requireIdle(sessionId = lastState?.sessionId): Promise<void> {
  if (sessionId && interactionBusy(sessionId)) throw new EditorError('DOCUMENT_BUSY', 'Finish the current interaction first.')
  if (sessionId) await renderQueue.waitIdle(sessionId)
  if (sessionId && interactionBusy(sessionId)) throw new EditorError('DOCUMENT_BUSY', 'Finish the current interaction first.')
}
async function requireWritable(sessionId = lastState?.sessionId): Promise<void> {
  await requireIdle(sessionId)
  if (closing || sessionId && closingDocuments.has(sessionId)) throw new EditorError('DOCUMENT_BUSY', 'The document is awaiting a close decision.')
}
async function discardConfirmed(sessionId = lastState.sessionId): Promise<boolean> {
  const state = await required<EditorState>('state', { sessionId })
  if (!state.modified) return true
  const response = await dialog.showMessageBox(window!, { type: 'question', buttons: ['Save', 'Discard changes', 'Cancel'].map(label => t(label)), defaultId: 0, cancelId: 2, message: t('Save changes to {title}?', { title: state.title }) })
  if (response.response === 2) return false
  if (response.response === 1) return true
  await dispatch('saveCurrent', { sessionId }, 'user')
  return !(await required<EditorState>('state', { sessionId })).modified
}
async function importImage(path: string, sessionId: string,newCanvas=false): Promise<unknown> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.maxAssetBytes) throw new EditorError('RESOURCE_LIMIT', 'Select a regular image within the encoded asset budget.')
  const extension = path.split('.').pop()?.toLowerCase()
  if ((RAW_EXTENSIONS.includes(extension as typeof RAW_EXTENSIONS[number]) || ['heic','heif','hif'].includes(extension ?? '')) && stat.size > 64 * 1024 * 1024) throw new EditorError('RESOURCE_LIMIT', 'RAW/HEIF input exceeds the decoder’s 64 MiB encoded-file budget.')
  if (extension === 'svg' && stat.size > 16 * 1024 * 1024) throw new EditorError('RESOURCE_LIMIT', 'SVG exceeds the 16 MiB import budget.')
  const bytes = await readFile(path)
  await requireWritable(sessionId)
  if (/\.ps[db]$/i.test(path)) return openProjectFile(path)
  if(['exr','hdr','rgbe'].includes(extension??'')||extension==='png'&&bytes.length>24&&bytes[24]===16)return required('importWide',{sessionId,bytes,sourceName:basename(path),newCanvas,name:basename(path).replace(/\.[^.]+$/,'')})
  if (/\.tiff?$/i.test(path)) return required('importTIFF', { sessionId, bytes, newCanvas, name: basename(path).replace(/\.[^.]+$/, '') })
  if (RAW_EXTENSIONS.includes(extension as typeof RAW_EXTENSIONS[number])) return foreignController.start(bytes, basename(path), sessionId, 'raw',{newCanvas})
  if (['heic', 'heif', 'hif'].includes(extension ?? '')) return foreignController.start(bytes, basename(path), sessionId, 'heif',{newCanvas})
  if (extension === 'svg') { if (bytes.length > 16 * 1024 * 1024) throw new EditorError('RESOURCE_LIMIT', 'SVG exceeds the 16 MiB import budget.'); return foreignController.start(bytes, basename(path), sessionId, 'svg',{newCanvas}) }
  try { rasterDimensions(bytes) } catch (error) { throw new EditorError('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Invalid raster header.') }
  const image = nativeImage.createFromBuffer(bytes)
  if (image.isEmpty()) { if (['bmp','gif','webp'].includes(extension ?? '')) { if(bytes.length > 64 * 1024 * 1024) throw new EditorError('RESOURCE_LIMIT','Raster fallback exceeds the 64 MiB decoder input budget.'); return foreignController.start(bytes, basename(path), sessionId, 'raster',{newCanvas}) } throw new EditorError('INVALID_ARGUMENT', 'The image cannot be decoded by this platform.') }
  const { width, height } = image.getSize(); if (width > LIMITS.maxSide || height > LIMITS.maxSide || width * height > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'The decoded image exceeds working-surface limits.')
  return required(newCanvas?'newCanvasPaste':'import', { sessionId, bytes: image.toPNG(), name: basename(path).replace(/\.[^.]+$/, '') })
}
/** The folder and drop paths share expansion, validation and modal cancellation. */
async function importImageInputs(inputs:string[],sessionId:string,allowProjects=false,destination?:'new'):Promise<EditorState>{
 const expanded=await expandImageImports(inputs),errors=expanded.emptyFolders.map(name=>t('The folder “{value1}” has no images to import.',{value1:name}))
 for(const path of expanded.paths){
  await requireWritable(sessionId)
  try {
   if(allowProjects&&/\.comp$/i.test(path)){sessionId=(await openProjectFile(path)).sessionId;continue}
   const value=await importImage(path,sessionId,destination==='new')
   if(value===null)break // Canceling a decoder dialog stops the remaining queue.
   if(destination==='new'||/\.ps[db]$/i.test(path))sessionId=(await required<EditorState>('state')).sessionId
  }catch(error){
   if(error instanceof EditorError&&['DOCUMENT_BUSY','TASK_LOCKED','REVISION_CONFLICT'].includes(error.code))throw error
   errors.push(`${basename(path)}: ${translateMessage(applicationLocale,error instanceof Error?error.message:String(error))}`)
  }
 }
 if(errors.length){lastFileOpenError=errors.join('\n');window?.webContents.send('editor:action','fileOpenError')}
 return required<EditorState>('state')
}
const subjectPreviewCache=new SubjectPreviewCache()
const edgeRefinementPreviews=new EdgeRefinementPreviews()
type EdgeRefinementAction=Extract<import('../shared/contracts').EditAction,{type:'selection.refine_edges'}>
function edgeRefinementSettings(action:EdgeRefinementAction):TrimapDraftSettings {return {boundaryRadius:action.boundaryRadius,sampleRadius:action.sampleRadius,guidedRadius:action.guidedRadius,region:action.region,strokes:action.strokes}}
async function assertEdgeRefinementRead(request:import('../shared/contracts').Mutation):Promise<void>{
 if(closing||closingDocuments.has(request.sessionId))throw new EditorError('DOCUMENT_BUSY','The document is awaiting a close decision.')
 const state=await required<EditorState>('state',{sessionId:request.sessionId})
 if(state.revision!==request.expectedRevision||state.manifest.documentID!==request.documentId)throw new EditorError('REVISION_CONFLICT','The edge refinement source changed. Open a fresh draft.')
 if(await required('inspectPrepared',{request,source:'user'}))throw new EditorError('REVISION_CONFLICT','This edge refinement draft has already been applied.')
}
/** Reject merged erase reads before allocating a full-document renderer/PNG. */
async function assertMergedBucketRead(request:import('../shared/contracts').Mutation){const state=await required<EditorState>('state',{sessionId:request.sessionId});if(state.revision!==request.expectedRevision)throw new EditorError('REVISION_CONFLICT','The fill source has changed.');if(state.manifest.width*state.manifest.height>16_000_000)throw new EditorError('RESOURCE_LIMIT','Merged Paint Bucket sampling supports up to 16 MP.');if(state.manifest.layers.some(l=>l.imageFile&&state.assets.some(a=>a.file===l.imageFile&&(a.bitDepth===16||a.isHDR))))throw new EditorError('UNSUPPORTED_FEATURE','Paint Bucket All Layers sampling currently requires RGB8 layers. High-depth pixels and history have been kept.')}
async function assertMergedEraseRead(request:import('../shared/contracts').Mutation){
 const current=await required<EditorState>('state',{sessionId:request.sessionId})
 if(current.revision!==request.expectedRevision)throw new EditorError('REVISION_CONFLICT','The eraser source has changed.')
 if(current.manifest.width*current.manifest.height>16_000_000)throw new EditorError('RESOURCE_LIMIT','Merged Magic Eraser sampling supports up to 16 MP.')
}
async function subjectSource(request:import('../shared/contracts').Mutation,source:'user'|'agent',signal?:AbortSignal,onProgress?:(progress:{phase:string})=>void){
 const action=request.action;if(action.type!=='selection.subject')throw new EditorError('INVALID_ARGUMENT','Invalid subject source.');
 return subjectPreviewCache.get({sessionId:request.sessionId,documentId:request.documentId,revision:request.expectedRevision,layerId:action.layerId,removeBackground:action.removeBackground,sampleAllLayers:action.sampleAllLayers,box:action.box,point:action.point},async cacheSignal=>{
  await required('inspectPrepared',{request,source});let composite:RGBAImage|undefined
  if(!action.removeBackground){const current=await required<EditorState>('state',{sessionId:request.sessionId}),layers=action.sampleAllLayers||!action.box&&!action.point?undefined:current.manifest.layers.filter(layer=>layer.id===action.layerId).map(layer=>({...layer,parentID:undefined,isVisible:true,opacity:1,blendMode:'Normal',maskFile:undefined,maskSourceID:undefined,effects:undefined}));const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true,layers),png=PNG.sync.read(Buffer.from(rendered.data,'base64'));composite={width:png.width,height:png.height,data:new Uint8Array(png.data)}}
  const prepared=await required<{image:RGBAImage;box?:[number,number,number,number];point?:[number,number]}>('prepareImageOperation',{request,source,composite});const mask=await subjectWorker.segment(prepared.image,{jobId:request.idempotencyKey,signal:cacheSignal,onProgress,box:prepared.box})
  return {image:prepared.image,coarse:action.point?pickSubjectComponent(mask,prepared.point??action.point):mask,space:composite?'document':'source'}
 },signal)
}
function subjectRefinement(action:Extract<import('../shared/contracts').EditAction,{type:'selection.subject'}>){return {quality:action.matteQuality,refineEdges:action.refineEdges,matteContrast:action.matteContrast,shiftEdge:action.shiftEdge,edgeMode:action.edgeMode,feather:action.feather}}
async function dispatch(method: string, params: unknown, source: 'user' | 'agent'): Promise<unknown> {
  if (['apply', 'applyBatch', 'history', 'undoTask', 'taskBegin', 'create', 'newDocument', 'openDialog', 'demo', 'importDialog', 'importFolderDialog', 'recoverDocument','copyLayers','pasteLayers','transferLayers','transferLayersToNew','newCanvasPaste','contentRaster','mergeLayers','duplicateMove'].includes(method)) {
    const sessionId = params && typeof params === 'object' && 'sessionId' in params ? (params as { sessionId?: string }).sessionId : lastState?.sessionId
    if (closing || sessionId && closingDocuments.has(sessionId)) throw new EditorError('DOCUMENT_BUSY', 'The document is awaiting a close decision.')
  }
  switch (method) {
    case 'localeGet':
      if (source !== 'user') throw new EditorError('FORBIDDEN', 'Application language is available only to the local editor.')
      return { locale: applicationLocale }
    case 'localeSet': {
      if (source !== 'user') throw new EditorError('FORBIDDEN', 'Application language is available only to the local editor.')
      const { locale } = z.object({ locale: z.custom<Locale>(isLocale, { message: 'Unsupported interface language.' }) }).strict().parse(params)
      return setApplicationLocale(locale)
    }
    case 'textEdit': {
      if (source !== 'user') throw new EditorError('FORBIDDEN', 'Text editing is available only to the local editor.')
      const { command } = z.object({ command: z.enum(['copy', 'cut', 'paste', 'selectAll', 'undo', 'redo']) }).strict().parse(params)
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new EditorError('WINDOW_UNAVAILABLE', 'No editor window is open.')
      window.webContents[command]()
      return { edited: true }
    }
    case 'copyClipboard': {
      const input=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string(),layerIds:z.array(z.string().uuid()).min(1),cut:z.boolean().default(false),merged:z.boolean().default(false),mask:z.boolean().default(false),duplicate:z.boolean().default(false)}).strict().parse(params)
      await requireIdle(input.sessionId);const state=await required<EditorState>('state',{sessionId:input.sessionId}),layer=state.manifest.layers.find(layer=>layer.id===input.layerIds.at(-1))
      if(!layer)throw new EditorError('LAYER_NOT_FOUND','Choose a layer to copy.')
      if(input.cut&&!state.selection)throw new EditorError('INVALID_ARGUMENT','Cut pixels requires a selection.');
      if(!state.selection&&!input.merged&&!input.mask&&!input.duplicate){const {cut,merged,mask,duplicate,...request}=input;let png:Uint8Array|undefined;if(layer.imageFile){const rendered=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},true,[{...layer,parentID:undefined,isVisible:true,opacity:1,blendMode:'Normal',effects:undefined,maskFile:undefined,maskSourceID:undefined}]);png=new Uint8Array(Buffer.from(rendered.data,'base64'))}await required('copyLayers',{...request,cut});pixelClipboard=undefined;layerClipboardMarker=randomUUID();await clipboard.write([new ClipboardItem({[clipboardFormat]:new Blob([layerClipboardMarker]),...(png?{'image/png':new Blob([png as Uint8Array<ArrayBuffer>],{type:'image/png'})}:{})})]);return {copied:true}}
      if(!input.mask&&state.manifest.layers.some(item=>(input.merged||item.id===layer.id)&&item.imageFile&&state.assets.find(asset=>asset.file===item.imageFile)?.bitDepth===16))throw new EditorError('UNSUPPORTED_FEATURE','Pixel clipboard does not yet preserve 16-bit data. Copy whole layers without a selection to keep source precision.');
      if(!input.merged&&!layer.imageFile&&!input.mask)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer to copy pixels.')
      let layers:EditorState['manifest']['layers']|undefined
      if(!input.merged){const imageFile=input.mask?layer.maskFile:layer.imageFile;if(!imageFile)throw new EditorError('INVALID_ARGUMENT','This layer has no mask.');const transform=input.mask&&layer.maskPlacement?layer.maskPlacement:layer.transform;const asset=state.assets.find(asset=>asset.file===imageFile)!;layers=[{...layer,parentID:undefined,isVisible:true,opacity:1,blendMode:'Normal',effects:undefined,maskFile:undefined,maskSourceID:undefined,imageFile,transform:input.mask&&asset.width===1&&asset.height===1?{...transform,origin:[0,0],size:[state.manifest.width,state.manifest.height]}:transform}]}
      const rendered=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},true,layers),copied=clipCanvasPixels(Buffer.from(rendered.data,'base64'),state.selection??null),{layerIds,cut,merged,mask,duplicate,...request}=input
      if(input.duplicate)return required('pastePixels',{request,bytes:copied.bytes,origin:copied.origin})
      const marker=randomUUID();await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(copied.bytes)],{type:'image/png'}),[clipboardFormat]:new Blob([marker])})]);pixelClipboard={...copied,sessionId:input.sessionId,marker};layerClipboardMarker=undefined
      if(input.cut){if(!state.selection)throw new EditorError('INVALID_ARGUMENT','Cut pixels requires a selection.');await required('apply',{request:{...request,action:{type:'layer.clear_selected',layerId:layer.id,target:input.mask?'mask':'image'}},source:'user'})}
      return {copied:true}
    }
    case 'newCanvasPaste': {
      if(source!=='user')throw new EditorError('FORBIDDEN','Clipboard access is available only to the local editor.')
      const input=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string(),dimensionField:z.boolean().default(false)}).strict().parse(params),state=await required<EditorState>('state',{sessionId:input.sessionId})
      await requireIdle(input.sessionId)
      if(state.manifest.documentID!==input.documentId||state.revision!==input.expectedRevision)throw new EditorError('REVISION_CONFLICT','The document changed before pasting.')
      if(state.manifest.layers.length||state.projectPath||state.revision!==0)throw new EditorError('DOCUMENT_CHANGED','Create a new tab before pasting a new canvas.')
      const items=await clipboard.read()
      // A numeric dimension keeps normal text-field paste; image/file clipboard data takes priority for other text.
      for(const item of items){const type=item.types.find(type=>type==='text/plain');if(type){const text=(await (await item.getType(type)).text()).trim();if(input.dimensionField&&/^\d+$/.test(text)&&Number(text)>=1&&Number(text)<=LIMITS.maxSide)return {handled:false}}}
      const paths:string[]=[]
      for(const item of items){for(const type of item.types.filter(type=>type==='text/uri-list'||type==='public.file-url')){for(const value of (await (await item.getType(type)).text()).split(/\r?\n/)){if(!value.startsWith('file:'))continue;try{const path=fileURLToPath(value.trim());if(/\.(png|jpe?g|tiff?|bmp|gif|webp|heic|heif|hif|svg|exr|hdr|rgbe|comp|psd|psb)$/i.test(path)||RAW_EXTENSIONS.some(extension=>path.toLowerCase().endsWith(`.${extension}`)))paths.push(path)}catch{}}}}
      if(paths.length)return {handled:true,state:await importImageInputs(paths,input.sessionId,true,'new')}
      const markerItem=items.find(item=>item.types.includes(clipboardFormat)),marker=markerItem?await (await markerItem.getType(clipboardFormat)).text():''
      if(layerClipboardMarker&&marker===layerClipboardMarker)return {handled:true,state:await required<EditorState>('newCanvasPaste',{cachedLayers:true})}
      const item=items.find(item=>item.types.some(type=>['image/png','image/tiff','image/jpeg'].includes(type)));if(!item)return {handled:false}
      const type=['image/png','image/tiff','image/jpeg'].find(type=>item.types.includes(type))!,bytes=Buffer.from(await (await item.getType(type) as Blob).arrayBuffer())
      if(bytes.length>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','The clipboard image exceeds the encoded raster budget.')
      if(type==='image/jpeg'){rasterDimensions(bytes);const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw new EditorError('INVALID_ARGUMENT','The clipboard image cannot be decoded.');return {handled:true,state:await required<EditorState>('newCanvasPaste',{bytes:image.toPNG(),format:'png'})}}
      return {handled:true,state:await required<EditorState>('newCanvasPaste',{bytes,format:type==='image/tiff'?'tiff':'png'})}
    }
    case 'pasteClipboard':{
      const input=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string()}).strict().parse(params);await requireIdle(input.sessionId)
      const items=await clipboard.read(),markerItem=items.find(item=>item.types.includes(clipboardFormat)),marker=markerItem?await (await markerItem.getType(clipboardFormat)).text():''
      if(layerClipboardMarker&&marker===layerClipboardMarker)return required('pasteLayers',input)
      if(pixelClipboard&&marker===pixelClipboard.marker)return required('pastePixels',{request:input,bytes:pixelClipboard.bytes,origin:pixelClipboard.sessionId===input.sessionId?pixelClipboard.origin:undefined})
      const imageItem=items.find(item=>item.types.some(type=>type==='image/png'||type==='image/jpeg'));if(!imageItem)throw new EditorError('EMPTY_CLIPBOARD','The clipboard contains no image.');const imageType=imageItem.types.find(type=>type==='image/png'||type==='image/jpeg')!,image=nativeImage.createFromBuffer(Buffer.from(await (await imageItem.getType(imageType)).arrayBuffer()));if(image.isEmpty())throw new EditorError('EMPTY_CLIPBOARD','The clipboard contains no image or copied layers.');const size=image.getSize();if(size.width>LIMITS.maxSide||size.height>LIMITS.maxSide||size.width*size.height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The clipboard image exceeds the raster budget.');return required('pastePixels',{request:input,bytes:image.toPNG()})
    }
    case 'setCanvasOnly':{const {enabled}=z.object({enabled:z.boolean()}).strict().parse(params);if(!window)throw new EditorError('WINDOW_UNAVAILABLE','No editor window is open.');if(enabled&&!canvasOnlyWindow){canvasOnlyWindow={alreadyFullscreen:window.isFullScreen()};if(!canvasOnlyWindow.alreadyFullscreen){if(process.platform==='darwin')window.setSimpleFullScreen(true);else window.setFullScreen(true)}}else if(!enabled&&canvasOnlyWindow){if(!canvasOnlyWindow.alreadyFullscreen){if(process.platform==='darwin')window.setSimpleFullScreen(false);else window.setFullScreen(false)}canvasOnlyWindow=undefined}return {enabled:!!canvasOnlyWindow}}
    case 'setMenuCapabilities':{
      menuCapabilities=z.record(z.string().min(1).max(100),z.boolean()).parse(params)
      installShortcuts()
      return null
    }
    case 'setShortcuts':{
      const input=z.record(z.string().min(1).max(100),z.string().max(100)).parse(params)
      for(const chord of Object.values(input))if(chord&&!normalizeChord(chord))throw new EditorError('INVALID_ARGUMENT','Invalid keyboard shortcut.')
      installShortcuts(input)
      return null
    }
    case 'photoshopExportDialog':{
      const input=z.object({sessionId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),psb:z.boolean().default(false)}).strict().parse(params),state=await required<EditorState>('state',{sessionId:input.sessionId}),png=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},true)
      const snapshot=await required<PhotoshopSnapshot>('photoshopSnapshot',input),encoded=await encodePhotoshopAsync(snapshot,new Uint8Array(Buffer.from(png.data,'base64')),input.psb,{workerPath:join(here,'photoshop.js')}),extension=input.psb?'psb':'psd',choice=await dialog.showSaveDialog(window!,{title:t('Export {format}',{format:extension.toUpperCase()}),defaultPath:`${state.title}.${extension}`,filters:[{name:extension.toUpperCase(),extensions:[extension]}]})
      if(choice.canceled||!choice.filePath)return null;await writeFile(choice.filePath,Buffer.from(encoded.bytes));return {path:choice.filePath,warnings:encoded.warnings}
    }
    case 'externalState': return sourceWatch.snapshot()
    case 'externalKeep': { const input = z.object({ sessionId: z.string().uuid() }).strict().parse(params); sourceWatch.keep(input.sessionId); return null }
    case 'externalReload': {
      const input = z.object({ sessionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() }).strict().parse(params)
      await requireIdle(input.sessionId)
      if (savingDocuments.has(input.sessionId) || closingDocuments.has(input.sessionId) || closing || [...imageJobs.values()].some(job=>job.sessionId===input.sessionId) || agentController.snapshot().status==='running') throw new EditorError('DOCUMENT_BUSY', 'Wait for the save, image operation, Agent task or close decision to finish.')
      const status = await required<ExternalProjectStatus>('externalStatus', { sessionId: input.sessionId })
      if (!status.readable || !status.fingerprint) throw new EditorError('INVALID_PROJECT', status.error ?? 'The external project cannot be read. The current document is preserved.')
      const result = await required('reload', { ...input, fingerprint: status.fingerprint }); await sourceWatch.reloaded(input.sessionId); return result
    }
    case 'recentState': return recentFiles.snapshot()
    case 'clearRecents': await recentFiles.clear(); app.clearRecentDocuments(); return recentFiles.snapshot()
    case 'openRecent': { const input=z.object({id:z.string().uuid(),sessionId:z.string().uuid().optional()}).strict().parse(params); return openProjectFile(await recentFiles.pathFor(input.id)) }
    case 'fileOpenError': { const message=lastFileOpenError; lastFileOpenError=undefined; return message }
    case 'photoshopState':return photoshopController.snapshot()
    case 'photoshopConfirm':return photoshopController.confirm(z.object({id:z.string().uuid()}).strict().parse(params).id)
    case 'photoshopCancel':return photoshopController.cancel(z.object({id:z.string().uuid().optional()}).strict().parse(params??{}).id)
    case 'foreignState': return foreignController.snapshot()
    case 'foreignConfirm': return foreignController.confirm(params)
    case 'foreignConfirmCameraRaw': return foreignController.confirm(params,{openCameraRaw:true})
    case 'foreignCameraRawTarget': return foreignController.takeCameraRawTarget(z.object({id:z.string().uuid()}).strict().parse(params).id)
    case 'foreignPreview': return foreignController.preview(params)
    case 'foreignCancel': return foreignController.cancel()
    case 'foreignRasterComplete': case 'foreignSvgComplete': { const input = z.object({ id: z.string().uuid(), png: z.instanceof(Uint8Array).optional(), error: z.string().max(4096).optional() }).strict().parse(params); return foreignController.svgComplete(input) }
    case 'imageOperationState':return imageOperationState()
    case 'cancelImageOperation':{const input=z.object({sessionId:z.string().uuid()}).strict().parse(params);for(const job of imageJobs.values())if(job.sessionId===input.sessionId)job.controller.abort();return null}
    case 'agentState':return agentController.snapshot()
    case 'agentConfigure':return agentController.configure(params)
    case 'agentSend':return agentController.send(params)
    case 'agentCancel':return agentController.cancel()
    case 'agentUndo':return agentController.undoLast()
    case 'agentClear':return agentController.clear()
    case 'capabilities': return { app: 'Compositor Electron', version: app.getVersion(), stage: 'V2 development', formats:['.comp v1–11','.comp v12 with PNG16 sRGB assets','.comp v13 with floating-point EXR assets','PNG (8/16-bit)','OpenEXR scanline RGB(A) HALF/FLOAT','Radiance HDR/RGBE','Floating TIFF RGB(A)','JPEG','WebP','PDF export','TIFF','PSD','PSB','RAW','HEIC','SVG'], blendModes: BLEND_MODES, limits: {...LIMITS,retainedWorkspacePixels:documentPixelBudget(totalmem()),viewportPixels:16_000_000,subjectPixels:32_000_000,selectionTransformPixels:64_000_000,selectionPaintPixels:64_000_000,folderImport:{maxImages:256,maxEntries:10_000,recursive:false},edgeRefinement:{experimental:true,maxSourcePixels:32_000_000,maxPreviewSide:1024,maxStrokes:256,maxPoints:10_000},imageDrivenSelection:{maxPixels:16_000_000,maxPoints:4096},colorSamples:{maxCount:10,maxWindow:101},patch:{precision:[8],currentRasterOnly:true},namedSelections:{maxCount:32,maxRuns:100_000,maxPixels:64_000_000,maxBytes:2*1024*1024}},
      tools: MCP_TOOLS, protocolVersion: 2, batchLimit: 100, taskLimit: 200,
      limitations:[...FILTER_PARITY_LIMITATIONS,'Background and Magic Eraser edit RGB8 and preserved RGB16 alpha. Background Eraser supports Continuous/Once/Background sampling, Contiguous/Discontiguous limits and Protect Foreground; Find Edges, mixed-edge decontamination and floating HDR are not implemented. Magic Eraser merged sampling uses a revision-checked RGBA8 document raster. Antialiasing is a portable approximation; full Photoshop eraser equivalence has not been established.','Quick Selection grows an image-derived connected region; Magnetic Lasso uses bounded edge tracking. These are portable algorithms, not Photoshop proprietary selection kernels. Patch and Photoshop-profile sampled healing support RGB8 current-layer sources; Patch supports Source/Destination with boundary color adaptation, but not Content-Aware Patch, Patterns or Photoshop Diffusion. Persisted color samples and ruler coordinates survive project saves/history; current-layer readings ignore layer opacity, masks and effects, and merged high-depth readings reject unsupported stacks.','Native .comp v12 PNG16 and v13 floating EXR layers preserve source data through history and project saves. Canvas and MCP previews produce RGBA8 SDR output; ordinary RGB16 layers now attempt high-depth composition before screen quantization, with an explicit compatibility fallback for unsupported stacks or budgets. Existing destructive filters and 12 supported adjustment kinds, paint/erase, fill/gradient/clear, this-layer blur/smudge/liquify and image resize use preserved high-depth data. Progressive Blur supports RGB8/RGB16/HDR. Threshold and Posterize support RGB8/RGB16 and explicitly reject floating HDR. Export As offers PNG16 and HDR EXR; legacy quick PNG, JPEG and PDF are 8-bit. HDR Camera Raw geometry/guided correction and optical warps require an ordered float pipeline and are refused; standalone HDR Lens Correction is supported. Byte-filter reconstruction and Camera Raw retain portable Core Image differences; keeping Dither high-depth is an intentional extension over upstream 8-bit rasterization. Normal Gaussian/Motion adjustment blur convolves RGBA and blends all four channels by mask and opacity; non-Normal blur and Gaussian Preserve Transparency retain the original alpha. Unsupported deep operations, high-depth raster merge/stamp, all-layers deep retouch, deep pixel clipboard and high-depth PSD export are refused atomically.','Experimental selection.refine_edges uses constrained encoded-sRGB color matting on opaque raster sources; low contrast, missing samples and varying colors can fail. No RGB decontamination or Photoshop hair equivalence.','Subject/Object/Remove Background use local U2NetP CPU saliency; results differ from macOS Vision.','RAW uses LibRaw wavelet threshold 0–1000 and highlight modes 0–9; no automatic lens profile correction or CIRAWFilter equivalence. Decoded pixels remain RGBA8.', 'RGBA8 display, premultiplied RGBA16 sRGB and Float32 extended-sRGB working sources are distinct. HDR composite currently supports Normal, Multiply, Darken, Lighten, Linear Dodge (Add) and Difference; visible raster effects and unsupported stacks are rejected. EXR supports flat scanline full-resolution HALF/FLOAT RGB(A), NONE/RLE/ZIPS/ZIP, equal data/display windows and square pixels; multipart/tiled/deep/other compression require conversion. Float TIFF supports classic RGB(A) IEEE 16/32/64-bit strips (chunky/planar) with NONE/LZW/Deflate; tiled float TIFF, JPEG/CCITT, CMYK and unsupported color profiles require conversion. Codec working budgets are independent of canvas limits. Native HDR/EDR display output is not implemented.','PSD/PSB RGB8 and RGB16 import verifies embedded sRGB-equivalent ICC or explicitly interprets untagged pixels as sRGB; non-sRGB ICC requires conversion. RGB16 raster channels remain high-depth in .comp v12; masks and PSD/PSB export remain 8-bit. RGB32 and unsupported ICC require conversion. Basic editable metadata has a conversion report; complex appearance is not guaranteed.','Desktop fonts and text rasterization vary by OS. Missing fonts block text rerender and preserve saved PNG fallbacks.','OpenAI-compatible endpoint/model/key are configurable. Real provider acceptance depends on tool-call support; image preview requires vision support.','Windows native runtime and signing/notarization have not been validated in this macOS workspace.'],idempotency: 'Current session; last 512 requests', historyLimit: 100 }
    case 'state': return required('state', z.object({ sessionId: z.string().uuid().optional() }).strict().parse(params ?? {}))
    case 'documents': return required('documents')
    case 'apply':
      if (source === 'agent' && interactionBusy(z.object({ sessionId: z.string().uuid() }).passthrough().parse(params).sessionId)) throw new EditorError('DOCUMENT_BUSY', 'A user interaction is in progress.')
      {const request=mutationSchema.parse(params);if(request.action.type==='layer.set_transform')return applyContentTransforms(request,false,source);if(request.action.type==='selection.wand'||request.action.type==='selection.color_range'||request.action.type==='selection.quick'){
 const cached=await required('inspectPrepared',{request,source});if(cached)return cached;
 const selectionAction=request.action;if(!selectionAction.sampleAllLayers)return required('apply',{request,source});const current=await required<any>('state',{sessionId:request.sessionId});
 if(selectionAction.type==='selection.quick'&&current.manifest.width*current.manifest.height>16_000_000)throw new EditorError('RESOURCE_LIMIT','Quick Selection analysis supports up to 16 MP.');
 const layers=request.action.sampleAllLayers?undefined:current.manifest.layers.filter((layer:any)=>layer.id===selectionAction.layerId).map((layer:any)=>({...layer,parentID:undefined,isVisible:true,opacity:1,blendMode:'Normal',maskFile:undefined,maskSourceID:undefined,effects:undefined,clippingMask:undefined}));
 const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true,layers),png=PNG.sync.read(Buffer.from(rendered.data,'base64'));
 return required('commitSelectionRaster',{request,source,image:{width:png.width,height:png.height,data:new Uint8Array(png.data)}})
 }if(request.action.type==='layer.bucket_fill'&&request.action.sampleAllLayers){const cached=await required('inspectPrepared',{request,source});if(cached)return cached;await assertMergedBucketRead(request);const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true),png=PNG.sync.read(Buffer.from(rendered.data,'base64'));return required('commitBucketFillRaster',{request,source,image:{width:png.width,height:png.height,data:new Uint8Array(png.data)}})}if(request.action.type==='layer.magic_erase'&&request.action.sampleAllLayers){const cached=await required('inspectPrepared',{request,source});if(cached)return cached;await assertMergedEraseRead(request);const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true),png=PNG.sync.read(Buffer.from(rendered.data,'base64'));return required('commitColorEraseRaster',{request,source,image:{width:png.width,height:png.height,data:new Uint8Array(png.data)}})}if(request.action.type==='layer.retouch'&&request.action.sourceMode==='all-layers'){const cached=await required('inspectPrepared',{request,source});if(cached)return cached;const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true),png=PNG.sync.read(Buffer.from(rendered.data,'base64')),result=await required('prepareRetouchResult',{request,source,composite:{width:png.width,height:png.height,data:new Uint8Array(png.data)}});return required('commitRetouch',{request,source,result})}if(request.action.type==='document.trim'){const cached=await required('inspectPrepared',{request,source});if(cached)return cached;const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true);return required('commitTrim',{request,source,bounds:calculateTrimBounds(PNG.sync.read(Buffer.from(rendered.data,'base64')),request.action.options)})}if(request.action.type==='layer.text'||request.action.type==='layer.shape'){const cached=await required('inspectPrepared',{request,source});if(cached)return cached;const rendered=await renderPreview({sessionId:request.sessionId,expectedRevision:request.expectedRevision},true,undefined,request.action);return required('preparedContent',{request,source,bytes:Buffer.from(rendered.data,'base64')})}if(request.action.type!=='selection.subject'&&request.action.type!=='layer.content_fill'&&request.action.type!=='selection.refine_edges')return required('apply',{request,source})
       const id=request.idempotencyKey;if(imageJobs.has(id))throw new EditorError('DOCUMENT_BUSY','This image operation is already running.');const controller=new AbortController(),job={controller,sessionId:request.sessionId,taskId:request.taskId,progress:{phase:'starting'}};imageJobs.set(id,job);imageProgress()
       try{const onProgress=(progress:{phase:string})=>{job.progress=progress;imageProgress()};if(request.action.type==='selection.refine_edges'){
         const cached=await required('inspectPrepared',{request,source});if(cached)return cached
         if(source==='user')edgeRefinementPreviews.cancel(request.sessionId)
         const prepared=await required<{cached?:unknown;image:RGBAImage;selection:RasterSelection}>('prepareEdgeRefinement',{request,source});if(prepared.cached)return prepared.cached
         if(controller.signal.aborted)throw new EditorError('CANCELED','The image operation was canceled.')
         const result=await subjectWorker.refine(prepared.image,prepared.selection,edgeRefinementSettings(request.action),{jobId:id,signal:controller.signal,onProgress})
         if(controller.signal.aborted)throw new EditorError('CANCELED','The image operation was canceled.')
         return required('commitImageOperation',{request,result:{coverage:result.coverage,space:'source'},source})
        }if(request.action.type==='selection.subject'){const cached=await required('inspectPrepared',{request,source});if(cached)return cached;const prepared=await subjectSource(request,source,controller.signal,onProgress),coverage=refineSubjectMatte(prepared.coarse,prepared.image,subjectRefinement(request.action));if(controller.signal.aborted)throw new EditorError('CANCELED','The image operation was canceled.');return required('commitImageOperation',{request,result:{coverage,space:prepared.space},source})}
        const prepared=await required<{cached?:unknown;image:RGBAImage;selection:RasterSelection}>('prepareImageOperation',{request,source});if(prepared.cached)return prepared.cached;const result=await subjectWorker.fill(prepared.image,prepared.selection,{jobId:id,signal:controller.signal,onProgress});if(controller.signal.aborted)throw new EditorError('CANCELED','The image operation was canceled.');return required('commitImageOperation',{request,result:{bytes:result.bytes},source})
       }finally{imageJobs.delete(id);imageProgress()}
      }
    case 'applyBatch':
      if (source === 'agent' && interactionBusy(z.object({ sessionId: z.string().uuid() }).passthrough().parse(params).sessionId)) throw new EditorError('DOCUMENT_BUSY', 'A user interaction is in progress.')
      return applyContentTransforms(params,true,source)
    case 'history':
      await requireIdle(z.object({ sessionId: z.string().uuid() }).passthrough().parse(params).sessionId)
      return required('history', { request: params, source })
    case 'taskBegin': return required('taskBegin', taskBeginSchema.parse(params))
    case 'taskStatus': return required('taskStatus', taskReadSchema.parse(params))
    case 'taskCancel':{const input=taskCancelSchema.parse(params);for(const job of imageJobs.values())if(job.taskId===input.taskId&&job.sessionId===input.sessionId)job.controller.abort();return required('taskCancel',input)}
    case 'taskFinish': return required('taskFinish', taskFinishSchema.parse(params))
    case 'undoTask': {
      const request = taskUndoSchema.parse(params)
      if (interactionBusy(request.sessionId)) throw new EditorError('DOCUMENT_BUSY', 'Finish the current interaction first.')
      return required('undoTask', request)
    }
    case 'edgeRefinementSource': {
      if(source!=='user')throw new EditorError('FORBIDDEN','Edge refinement drafts belong to the local editor.')
      const input=z.object({request:mutationSchema}).strict().parse(params)
      if(input.request.action.type!=='selection.refine_edges')throw new EditorError('INVALID_ARGUMENT','Invalid edge refinement draft.')
      await assertEdgeRefinementRead(input.request)
      const prepared=await required<{cached?:unknown;image:RGBAImage;selection:RasterSelection;coarseSource:'selection'|'mask'}>('prepareEdgeRefinement',{request:input.request,source:'user'})
      if(prepared.cached)throw new EditorError('REVISION_CONFLICT','This edge refinement draft has already been applied.')
      await assertEdgeRefinementRead(input.request)
      return {...edgeRefinementImages(prepared.image,prepared.selection),coarseSource:prepared.coarseSource}
    }
    case 'cancelEdgeRefinement': {
      if(source!=='user')throw new EditorError('FORBIDDEN','Only the editor can cancel its edge refinement preview.')
      const input=z.object({sessionId:z.string().uuid(),requestId:z.number().int().nonnegative().optional()}).strict().parse(params)
      return {canceled:edgeRefinementPreviews.cancel(input.sessionId,input.requestId)}
    }
    case 'edgeRefinementPreview': {
      if(source!=='user')throw new EditorError('FORBIDDEN','Edge refinement drafts belong to the local editor.')
      const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params)
      if(input.request.action.type!=='selection.refine_edges')throw new EditorError('INVALID_ARGUMENT','Invalid edge refinement draft.')
      const sessionId=input.request.sessionId,controller=edgeRefinementPreviews.begin(sessionId,input.requestId)
      try {
        await assertEdgeRefinementRead(input.request)
        const prepared=await required<{cached?:unknown;image:RGBAImage;selection:RasterSelection}>('prepareEdgeRefinement',{request:input.request,source:'user'})
        if(prepared.cached)throw new EditorError('REVISION_CONFLICT','This edge refinement draft has already been applied.')
        edgeRefinementPreviews.assertCurrent(sessionId,controller)
        const result=await subjectWorker.refine(prepared.image,prepared.selection,edgeRefinementSettings(input.request.action),{jobId:randomUUID(),signal:controller.signal})
        edgeRefinementPreviews.assertCurrent(sessionId,controller)
        await assertEdgeRefinementRead(input.request)
        // Validate the exact prospective output through the same stage helper as
        // commit, including its project/selection budgets, without publishing.
        await required('edgeRefinementRasterPreview',{...input,result:{coverage:result.coverage,space:'source'},source:'user'})
        edgeRefinementPreviews.assertCurrent(sessionId,controller)
        return {requestId:input.requestId,...edgeRefinementImages(prepared.image,result.coverage,result.trimap),report:result.report}
      }finally{edgeRefinementPreviews.finish(sessionId,controller)}
    }
    case 'cancelSubjectPreview':{if(source!=='user')throw new EditorError('FORBIDDEN','Only the editor can cancel its preview.');const input=z.object({sessionId:z.string().uuid()}).strict().parse(params);subjectPreviewCache.invalidateSession(input.sessionId);return null}
    case 'subjectPreview':{if(source!=='user')throw new EditorError('FORBIDDEN','Preview drafts belong to the editor.');const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params),action=input.request.action;if(action.type!=='selection.subject'||!action.removeBackground)throw new EditorError('INVALID_ARGUMENT','Background previews require a Remove Background action.');const prepared=await subjectSource(input.request,'user'),coverage=refineSubjectMatte(prepared.coarse,prepared.image,subjectRefinement(action));await required('inspectPrepared',{request:input.request});const preview=await required<{state:EditorState}>('subjectRasterPreview',{...input,result:{coverage,space:prepared.space},source:'user'}),rendered=await renderPreview({sessionId:input.request.sessionId,expectedRevision:input.request.expectedRevision,maxDimension:512},false,undefined,undefined,preview.state);return {requestId:input.requestId,url:`data:image/png;base64,${rendered.data}`,state:preview.state,cacheReady:true}}
    case 'documentInfoRead': {
      const input=z.object({sessionId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),layerId:z.string().uuid().optional(),info:documentInfoSchema.optional()}).strict().parse(params)
      return required('documentInfoRead',input)
    }
    case 'magneticLassoPreview': {
      const input=z.object({sessionId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),layerId:z.string().uuid(),points:z.array(z.tuple([z.number().finite(),z.number().finite()])).min(2).max(4096),width:z.number().int().min(1).max(128),contrast:z.number().min(0).max(1),frequency:z.number().int().min(0).max(100),closed:z.boolean().default(false),sampleAllLayers:z.boolean().default(false)}).strict().parse(params)
      const current=await required<EditorState>('state',{sessionId:input.sessionId});if(current.revision!==input.expectedRevision)throw new EditorError('SNAPSHOT_EXPIRED','The selection source has changed.');if(current.manifest.width*current.manifest.height>16_000_000)throw new EditorError('RESOURCE_LIMIT','Magnetic Lasso analysis supports up to 16 MP.')
      if(!input.sampleAllLayers)return required('magneticLassoPreview',input)
      const rendered=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},true),png=PNG.sync.read(Buffer.from(rendered.data,'base64'))
      return required('magneticLassoPreview',{...input,composite:{width:png.width,height:png.height,data:new Uint8Array(png.data)}})
    }
    case 'retouchToolPreview': {
      const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params);if(!['layer.remove','layer.content_aware_move','layer.red_eye'].includes(input.request.action.type))throw new EditorError('INVALID_ARGUMENT','Invalid retouch tool preview.');return required('retouchToolPreview',input)
    }
    case 'patchPreview': {
      const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params);if(input.request.action.type!=='layer.patch')throw new EditorError('INVALID_ARGUMENT','Invalid Patch preview.');return required('patchPreview',input)
    }
    case 'selectionRasterPreview':{const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params);if(!['selection.color_range','selection.paint','selection.quick'].includes(input.request.action.type))throw new EditorError('INVALID_ARGUMENT','Invalid selection preview.');if(input.request.action.type==='selection.paint'||input.request.action.type==='selection.quick'&&!input.request.action.sampleAllLayers)return required('selectionRasterPreview',input);await required('inspectPrepared',{request:input.request});if(input.request.action.type==='selection.quick'){const current=await required<any>('state',{sessionId:input.request.sessionId});if(current.manifest.width*current.manifest.height>16_000_000)throw new EditorError('RESOURCE_LIMIT','Quick Selection analysis supports up to 16 MP.')}const rendered=await renderPreview({sessionId:input.request.sessionId,expectedRevision:input.request.expectedRevision},true),png=PNG.sync.read(Buffer.from(rendered.data,'base64'));return required('selectionRasterPreview',{...input,image:{width:png.width,height:png.height,data:new Uint8Array(png.data)}})}
    case 'strokePreview':{const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params);if(!['layer.paint','layer.retouch','layer.background_erase','layer.magic_erase','layer.bucket_fill','layer.tonal_brush','layer.history_brush','layer.mixer_brush'].includes(input.request.action.type))throw new EditorError('INVALID_ARGUMENT','Invalid stroke preview.');let composite:RGBAImage|undefined;if(input.request.action.type==='layer.bucket_fill'&&input.request.action.sampleAllLayers||input.request.action.type==='layer.retouch'&&input.request.action.sourceMode==='all-layers'||input.request.action.type==='layer.magic_erase'&&input.request.action.sampleAllLayers){await required('inspectPrepared',{request:input.request});if(input.request.action.type==='layer.magic_erase')await assertMergedEraseRead(input.request);if(input.request.action.type==='layer.bucket_fill')await assertMergedBucketRead(input.request);const rendered=await renderPreview({sessionId:input.request.sessionId,expectedRevision:input.request.expectedRevision},true),png=PNG.sync.read(Buffer.from(rendered.data,'base64'));composite={width:png.width,height:png.height,data:new Uint8Array(png.data)}}return required('strokePreview',{...input,composite})}
    case 'gradientPreview':{const input=z.object({request:mutationSchema,requestId:z.number().int().nonnegative()}).strict().parse(params);if(input.request.action.type!=='layer.gradient')throw new EditorError('INVALID_ARGUMENT','Invalid gradient preview.');return required('gradientPreview',input)}
    case 'selectionTransformDraft':{const request=mutationSchema.parse(params);if(request.action.type!=='selection.transform_pixels')throw new EditorError('INVALID_ARGUMENT','Invalid selection transform.');return required('selectionTransformDraft',{request})}
    case 'distortPreview':{const input=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string(),requestId:z.number().int(),layerId:z.string().uuid(),corners:z.tuple([z.tuple([z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite()]),z.tuple([z.number().finite(),z.number().finite()])]),trim:z.boolean().default(false),target:z.enum(['image','mask']).default('image')}).strict().parse(params);return required('distortPreview',input)}
    case 'filterPreview':{
      const input=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string(),layerId:z.string().uuid().optional(),filter:imageFilterSchema,adjustment:z.boolean().default(false)}).strict().parse(params)
      if(!input.adjustment){const {adjustment:_,...request}=input;return required('filterPreview',request)}
      const state=await required<EditorState>('state',{sessionId:input.sessionId}),layers=structuredClone(state.manifest.layers),selected=layers.find(layer=>layer.id===input.layerId)
      if(selected?.adjustment)selected.adjustment=specToNativeAdjustment(input.filter)
      else layers.push({id:randomUUID().toUpperCase(),name:'Adjustment preview',adjustment:specToNativeAdjustment(input.filter),isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[state.manifest.width,state.manifest.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}})
      const preview=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},false,layers);return {url:`data:image/png;base64,${preview.data}`}
    }
    case 'transferLayersToNew': {
      const input=z.object({source:z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative()}).strict(),layerIds:z.array(z.string().uuid()).min(1).max(LIMITS.maxLayers)}).strict().parse(params)
      await requireIdle(input.source.sessionId);return required(method,input)
    }
    case 'transferLayers': {
      const identity=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative()}).strict()
      const input=z.object({source:identity,request:identity.extend({idempotencyKey:z.string().min(1).max(200)}),layerIds:z.array(z.string().uuid()).min(1).max(LIMITS.maxLayers),point:z.tuple([z.number().finite(),z.number().finite()]).optional()}).strict().parse(params)
      await requireIdle(input.source.sessionId);await requireIdle(input.request.sessionId);return required(method,input)
    }
    case 'copyLayers': case 'pasteLayers': {
      const schema=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(200)})
      const input=method==='copyLayers'?schema.extend({layerIds:z.array(z.string().uuid()).min(1).max(LIMITS.maxLayers),cut:z.boolean().default(false)}).strict().parse(params):schema.strict().parse(params)
      await requireIdle(input.sessionId);return required(method,input)
    }
    case 'duplicateMove': {
      const input=z.object({request:z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(200)}).strict(),layerIds:z.array(z.string().uuid()).min(1).max(LIMITS.maxLayers),delta:z.tuple([z.number().finite(),z.number().finite()])}).strict().parse(params)
      return required(method,input)
    }
    case 'mergeLayers': {
      const input=z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(200),layerIds:z.array(z.string().uuid()).max(LIMITS.maxLayers),kind:z.enum(['selected','down','group','visible','stamp-visible','stamp-selected']).default('selected')}).strict().parse(params)
      await requireIdle(input.sessionId);const state=await required<EditorState>('state',{sessionId:input.sessionId}),plan=mergeSelectionPlan(state.manifest,input.layerIds,input.kind)
      const png=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},true,plan.renderLayers)
      const {layerIds,kind,...request}=input;return required(method,{request,layerIds,kind,bytes:Buffer.from(png.data,'base64')})
    }
    case 'contentRaster': {
      const input=z.object({request:z.object({sessionId:z.string().uuid(),documentId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(200)}).strict(),bytes:z.instanceof(Uint8Array),metadata:z.object({name:z.string().trim().min(1).max(4096),layerId:z.string().uuid().optional(),text:z.unknown().optional(),shape:z.unknown().optional(),transform:transformSchema.optional(),origin:z.tuple([z.number().finite().min(-LIMITS.maxSide).max(LIMITS.maxSide),z.number().finite().min(-LIMITS.maxSide).max(LIMITS.maxSide)]).optional()}).strict()}).strict().parse(params)
      await requireIdle(input.request.sessionId);if(input.bytes.length>LIMITS.maxAssetBytes)throw new EditorError('RESOURCE_LIMIT','The raster exceeds the asset budget.');return required(method,input)
    }
    case 'exportPreview': case 'exportAsDialog': {
      const input=z.object({sessionId:z.string().uuid(),expectedRevision:z.number().int().nonnegative(),requestId:z.number().int(),options:exportOptionsSchema}).strict().parse(params)
      const state=await required<EditorState>('state',{sessionId:input.sessionId})
      if(input.options.format==='exr'||input.options.format==='png'&&input.options.bitDepth===16){
        const wide=await required<{data:Uint8Array;previewPNG:Uint8Array;extension:string;bitDepth:16|32;isHDR:boolean;revision:number}>('deepExport',input)
        if(method==='exportPreview')return {requestId:input.requestId,url:`data:image/png;base64,${Buffer.from(wide.previewPNG).toString('base64')}`,bytes:wide.data.length,bitDepth:wide.bitDepth,isHDR:wide.isHDR,sourceBitDepth:state.assets.some(asset=>asset.bitDepth===16)?16:8}
        const choice=await dialog.showSaveDialog(window!,{title:t('Export As'),defaultPath:`${state.title}.${wide.extension}`,filters:[{name:input.options.format.toUpperCase(),extensions:[wide.extension]}]})
        if(choice.canceled||!choice.filePath)return null
        await writeFile(choice.filePath,Buffer.from(wide.data));return {path:choice.filePath,revision:wide.revision,bytes:wide.data.length,bitDepth:wide.bitDepth,isHDR:wide.isHDR,sourceBitDepth:state.assets.some(asset=>asset.bitDepth===16)?16:8}
      }
      const png=await renderPreview({sessionId:input.sessionId,expectedRevision:input.expectedRevision},true)
      const encoded=await encodeExport(Buffer.from(png.data,'base64'),input.options,(bytes,quality)=>nativeImage.createFromBuffer(bytes).toJPEG(Math.round(quality*100)))
      if(method==='exportPreview')return {requestId:input.requestId,url:`data:${input.options.format==='jpeg'?'image/jpeg':'image/png'};base64,${(input.options.format==='jpeg'?encoded.data:encoded.previewPNG).toString('base64')}`,bytes:encoded.data.length,bitDepth:8,sourceBitDepth:state.assets.some(asset=>asset.bitDepth===16)?16:8}
      const choice=await dialog.showSaveDialog(window!,{title:t('Export As'),defaultPath:`${state.title}.${encoded.extension}`,filters:[{name:input.options.format.toUpperCase(),extensions:[encoded.extension]}]})
      if(choice.canceled||!choice.filePath)return null
      await writeFile(choice.filePath,encoded.data);return {path:choice.filePath,revision:png.revision,bytes:encoded.data.length,bitDepth:8,sourceBitDepth:state.assets.some(asset=>asset.bitDepth===16)?16:8}
    }
    case 'deepCompositePreview': return required('deepCompositePreview',params)
    case 'preview': return renderPreview(params)
    case 'fontCatalog': if(source==='agent')throw new EditorError('INVALID_ARGUMENT','Font catalog is a desktop setting.');return installedFonts()
    case 'bridgeInfo': return bridgeInfo
    case 'interaction': {
      const request = z.object({ sessionId: z.string().uuid(), interactionId: z.string().min(1).max(100), busy: z.boolean() }).strict().parse(params)
      await required('state', { sessionId: request.sessionId })
      const leases = interactions.get(request.sessionId) ?? new Map<string, number>()
      if (request.busy) leases.set(request.interactionId, Date.now() + 300_000)
      else leases.delete(request.interactionId)
      if (leases.size) interactions.set(request.sessionId, leases)
      else interactions.delete(request.sessionId)
      return { busy: leases.size > 0 }
    }
    case 'newDocument': await requireIdle(); return required('new')
    case 'switchDocument': {
      const request = z.object({ sessionId: z.string().uuid() }).strict().parse(params)
      await requireIdle(); return required('switch', request)
    }
    case 'create': {
      const request = z.object({ sessionId: z.string().uuid(), width: z.number().int().min(1).max(LIMITS.maxSide), height: z.number().int().min(1).max(LIMITS.maxSide) }).strict().parse(params ?? { sessionId: lastState.sessionId })
      await requireIdle(request.sessionId); return required('create', request)
    }
    case 'closeDocument': {
      const request = z.object({ sessionId: z.string().uuid() }).strict().parse(params ?? { sessionId: lastState.sessionId })
      await requireIdle(request.sessionId)
      if (closing || closingDocuments.has(request.sessionId) || savingDocuments.has(request.sessionId)) throw new EditorError('DOCUMENT_BUSY', 'Wait for the current save or close decision to finish.')
      closingDocuments.add(request.sessionId)
      try {
        if (!await discardConfirmed(request.sessionId)) return null
        await requireIdle(request.sessionId)
        interactions.delete(request.sessionId)
        return required('close', request)
      } finally { closingDocuments.delete(request.sessionId) }
    }
    case 'openDialog': {
      await requireIdle()
      // Windows native dialogs cannot select files and folders in one picker.
      let photoshop = false
      if (process.platform === 'win32') {
        const format = await dialog.showMessageBox(window!, { type: 'question', title: t('Open project'), message: t('Choose the project format to open.'), buttons: ['Compositor project (.comp)', 'Photoshop document (.psd / .psb)', 'Cancel'].map(label => t(label)), defaultId: 0, cancelId: 2 })
        if (format.response === 2) return null
        photoshop = format.response === 1
      }
      const choice = await dialog.showOpenDialog(window!, { title: t(photoshop ? 'Open Photoshop document' : 'Open Compositor project'), properties: process.platform==='darwin'?['openFile','openDirectory','treatPackageAsDirectory']:photoshop?['openFile']:['openDirectory','treatPackageAsDirectory'], ...(photoshop ? { filters: [{ name: t('Photoshop document'), extensions: ['psd', 'psb'] }] } : {}) })
      if (choice.canceled) return null
      return openProjectFile(choice.filePaths[0])
    }
    case 'demo': {
      await requireIdle()
      return required('open', { path: app.isPackaged ? join(process.resourcesPath, 'demo.comp') : join(app.getAppPath(), 'fixtures/demo.comp') })
    }
    case 'importDialog':
    case 'importFolderDialog': {
      if(source!=='user')throw new EditorError('FORBIDDEN','Image import dialogs are available only to the local editor.')
      const target = z.object({ sessionId: z.string().uuid() }).strict().parse(params ?? { sessionId: lastState.sessionId })
      await requireWritable(target.sessionId)
      const folder=method==='importFolderDialog'
      const choice = await dialog.showOpenDialog(window!, folder
        ? {title:t('Import image folder'),properties:['openDirectory','multiSelections']}
        : {title:t('Import images'),properties:['openFile','multiSelections'],filters:[{name:t('Images'),extensions:['png','jpg','jpeg','tif','tiff','psd','psb','bmp','gif','webp','exr','hdr','rgbe','svg','heic','heif','hif',...RAW_EXTENSIONS]}]})
      if (choice.canceled) return null
      return importImageInputs(choice.filePaths,target.sessionId)
    }
    case 'saveCurrent':
    case 'saveDialog':
    case 'saveCopyDialog': {
      const target = z.object({ sessionId: z.string().uuid() }).strict().parse(params ?? { sessionId: lastState.sessionId })
      await requireIdle(target.sessionId)
      if (savingDocuments.has(target.sessionId)) throw new EditorError('DOCUMENT_BUSY', 'A save is already in progress for this document.')
      savingDocuments.add(target.sessionId)
      try {
      const state = await required<EditorState>('state', target)
      if (method === 'saveCurrent' && state.projectPath) { const rendered=await renderPreview({sessionId:state.sessionId,expectedRevision:state.revision,maxDimension:1024}),preview={revision:rendered.revision,bytes:nativeImage.createFromBuffer(Buffer.from(rendered.data,'base64')).toJPEG(85)};const value=await required('save', {...target,preview}); await recentFiles.record(state.projectPath); app.addRecentDocument(state.projectPath); return value }
      const copy = method === 'saveCopyDialog'
      const choice = await dialog.showSaveDialog(window!, { title: t(copy ? 'Save a project copy' : 'Save project as'), defaultPath: `${state.title}${copy ? ' copy' : ''}.comp`, filters: [{ name: t('Compositor project'), extensions: ['comp'] }] })
      if (choice.canceled || !choice.filePath) return null
      const current=await required<EditorState>('state',target),rendered=await renderPreview({sessionId:current.sessionId,expectedRevision:current.revision,maxDimension:1024}),preview={revision:rendered.revision,bytes:nativeImage.createFromBuffer(Buffer.from(rendered.data,'base64')).toJPEG(85)};const value=await required(copy ? 'saveCopy' : 'saveAs', { ...target, path: choice.filePath,preview }); await recentFiles.record(choice.filePath); app.addRecentDocument(choice.filePath); return value
      } finally { savingDocuments.delete(target.sessionId); sourceWatch.requestCheck(target.sessionId) }
    }
    case 'recoveryList': return required('recoveryList')
    case 'checkpoint': return required('checkpoint')
    case 'recoverDocument': {
      const target = z.object({ id: z.string().uuid() }).strict().parse(params)
      return required('recover', target)
    }
    case 'discardRecovery': return required('discardRecovery', z.object({ id: z.string().uuid() }).strict().parse(params))
    case 'exportDialog': {
      const state = await required<EditorState>('state', z.object({ sessionId: z.string().uuid() }).strict().parse(params ?? { sessionId: lastState.sessionId }))
      const choice = await dialog.showSaveDialog(window!, { title: t(state.assets.some(asset=>asset.bitDepth===16)?'Export PNG (8-bit display)':'Export PNG'), defaultPath: `${state.title}.png`, filters: [{ name: t('PNG image'), extensions: ['png'] }] })
      if (choice.canceled || !choice.filePath) return null
      const result = await renderPreview({ sessionId: state.sessionId, expectedRevision: state.revision, maxDimension: 1024 }, true)
      const encoded=await encodeExport(Buffer.from(result.data,'base64'),{format:'png',width:state.manifest.width,height:state.manifest.height,resolution:state.manifest.resolution,quality:1,background:null});await writeFile(choice.filePath,encoded.data)
      return { path: choice.filePath, revision: result.revision }
    }
    default: throw new EditorError('UNKNOWN_METHOD', 'This operation is not available.')
  }
}

async function startBridge(): Promise<void> {
  const token = randomBytes(32).toString('hex')
  bridge = createServer(async (request, response) => {
    const auth = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    if (request.headers.origin || !/^[a-f0-9]{64}$/.test(auth) || !timingSafeEqual(Buffer.from(auth), Buffer.from(token))) { response.writeHead(403); response.end(); return }
    if (request.method !== 'POST' || request.url !== '/rpc') { response.writeHead(404); response.end(); return }
    const chunks: Buffer[] = []; let size = 0
    try {
      for await (const chunk of request) { size += chunk.length; if (size > 64 * 1024) throw new EditorError('RESOURCE_LIMIT', 'The RPC request is too large.'); chunks.push(Buffer.from(chunk)) }
      const input = z.object({ method: z.enum(['capabilities', 'documents', 'state', 'apply', 'applyBatch', 'history', 'preview', 'taskBegin', 'taskStatus', 'taskCancel', 'taskFinish', 'undoTask']), params: z.unknown().optional() }).strict().parse(JSON.parse(Buffer.concat(chunks).toString()))
      const value = await dispatch(input.method, input.params, 'agent')
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ ok: true, value }))
    } catch (error) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(failure(error))) }
  })
  await new Promise<void>((resolve, reject) => { bridge.once('error', reject); bridge.listen(0, '127.0.0.1', resolve) })
  const port = (bridge.address() as { port: number }).port
  await mkdir(app.getPath('userData'), { recursive: true })
  const connectionFile = join(app.getPath('userData'), 'automation.json')
  await writeFile(connectionFile, JSON.stringify({ port, token, instanceId: randomUUID(), pid: process.pid }), { mode: 0o600 })
  bridgeInfo = { connectionFile, port, mcpCommand: process.execPath, mcpArgs: [join(app.getAppPath(), 'out/mcp/server.cjs'), '--connection', connectionFile] }
}

app.whenReady().then(async () => {
  if (!primaryInstance) return
  applicationLocale = await localeSettings.load(app.getPreferredSystemLanguages()[0] ?? app.getLocale(), process.env.COMPOSITOR_TEST === '1')
  subjectWorker=new SubjectWorker({workerPath:join(here,'subject.worker.cjs'),cacheDir:join(app.getPath('userData'),'models'),bundledModelPath:app.isPackaged?join(process.resourcesPath,'models','u2netp.onnx'):join(app.getAppPath(),'fixtures/models/u2netp.onnx')})
  editor = utilityProcess.fork(join(here, 'editor.js'), [], { serviceName: 'Compositor Editor', stdio: 'pipe' })
  editor.stdout?.on('data', data => process.stdout.write(data)); editor.stderr?.on('data', data => process.stderr.write(data))
  const editorReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Editor initialization timed out.')), 15_000)
    editor.on('message', message => { if (message.ready) { clearTimeout(timer); resolve() } })
    editor.once('exit', () => { clearTimeout(timer); reject(new Error('Editor stopped during initialization.')) })
  })
  editor.on('message', message => {
    const { id, result, state } = message
    editorRpc.receive(id, result)
    if (state) { lastState = state; sourceWatch.update(state.workspace?.documents ?? [{ sessionId: state.sessionId, title: state.title, projectPath: state.projectPath }]); window?.webContents.send('editor:state', state) }
  })
  editor.on('exit', () => {
    editorRpc.stop()
  })
  protocol.handle('compositor-asset', async request => {
    try {
      const url = new URL(request.url)
      const result = await required<Uint8Array>('asset', { sessionId: url.hostname, file: decodeURIComponent(url.pathname.slice(1)), hash: url.searchParams.get('hash'), representation:z.enum(['source','display']).parse(url.searchParams.get('representation')??'source'),displayHash:url.searchParams.get('displayHash')??undefined })
      return new Response(new Uint8Array(result), { headers: { 'Content-Type': url.searchParams.get('representation')!=='display'&&url.pathname.toLowerCase().endsWith('.exr')?'image/x-exr':'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } })
    } catch { return new Response('Asset not found', { status: 404 }) }
  })
  await startBridge()
  try{await agentController.restore(await modelSettings.load())}catch{console.warn('Saved model settings could not be restored; reconfigure in Agent settings.')} 
  ipcMain.handle('editor:request', async (event, input) => {
    if (event.sender !== window?.webContents && event.sender !== renderWindow?.webContents) return failure(new EditorError('FORBIDDEN', 'Unknown UI sender.'))
    try {
      const parsed = z.object({ method: z.string(), params: z.unknown().optional() }).strict().parse(input)
      if (event.sender === renderWindow?.webContents && !['state','fontCatalog','localeGet','deepCompositePreview'].includes(parsed.method)) throw new EditorError('FORBIDDEN', 'The render service cannot edit documents.')
      return { ok: true, value: await dispatch(parsed.method, parsed.params, 'user') }
    } catch (error) { return failure(error) }
  })
  ipcMain.handle('editor:drop', async (event, value) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return failure(new EditorError('FORBIDDEN','Only the main editor may import dropped local files.'))
    try { const schema=z.array(z.string().min(1).max(8192)).min(1).max(32),input=Array.isArray(value)?{paths:schema.parse(value),destination:undefined}:z.object({paths:schema,destination:z.union([z.literal('new'),z.string().uuid()]).optional()}).strict().parse(value); const sessionId=input.destination&&input.destination!=='new'?input.destination:lastState.sessionId;await requireIdle(sessionId);if(input.destination&&input.destination!=='new')await required('switch',{sessionId});return {ok:true,value:await importImageInputs(input.paths,sessionId,true,input.destination==='new'?'new':undefined)} } catch(error){return failure(error)}
  })
  ipcMain.on('renderer:complete', (event, { id, result }) => {
    if (event.sender !== renderWindow?.webContents) return
    const pending = renders.get(id)
    if (pending) { clearTimeout(pending.timer); renders.delete(id); pending.resolve(result) }
  })
  window = new BrowserWindow({ ...options(), width: 1440, height: 840, minWidth: 1050, minHeight: 600, title: 'Compositor Electron',icon:app.isPackaged?join(process.resourcesPath,'icon.png'):join(app.getAppPath(),'build/icon.png'),
    titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 13 },
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#2d2d2d', symbolColor: '#d1d1d1', height: 40 } } : {}) })
  const send = (action: string): void => {const target=window;if(target&&!target.isDestroyed()&&!target.webContents.isDestroyed())target.webContents.send('editor:action',action)}
  window.on('blur',()=>send('windowFocusLost'))
  nativeMenuTemplate = editorMenuTemplate(process.platform, send, changeMenuLocale)
  installShortcuts()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('render-process-gone', () => interactions.clear())
  window.on('close', event => {
    if (closeConfirmed || process.env.COMPOSITOR_TEST === '1') return
    event.preventDefault()
    if (closing) return
    closing = true
    void (async () => {
      try {
        for (const doc of lastState.workspace?.documents ?? []) {
          await requireIdle(doc.sessionId)
          if (!await discardConfirmed(doc.sessionId)) return
        }
        await required('clearOpenRecovery')
        closeConfirmed = true; window?.close()
      } catch (error) {
        console.error(error)
        if (window && !window.isDestroyed()) {
          const engineStopped = error instanceof EditorError && error.code === 'ENGINE_UNAVAILABLE'
          const response = await dialog.showMessageBox(window, { type: 'error', title: t('Could not close project'), message: translateMessage(applicationLocale, error instanceof Error ? error.message : String(error)), detail: t(engineStopped ? 'Saving is unavailable. Quit keeps the existing automatic recovery files; edits after the latest recovery may be missing.' : 'The window has been kept open. Resolve the operation or save error, then try closing again.'), buttons: (engineStopped ? ['Keep application open', 'Quit and keep recovery files'] : ['OK']).map(label => t(label)), defaultId: 0, cancelId: 0 })
          if (engineStopped && response.response === 1) { closeConfirmed = true; window.close() }
        }
      }
      finally { closing = false }
    })()
  })
  window.on('closed', () => { window = undefined; app.quit() })
  const demoPath = app.isPackaged ? join(process.resourcesPath, 'demo.comp') : join(app.getAppPath(), 'fixtures/demo.comp')
  await editorReady
  await required('configure', { journalDirectory: join(app.getPath('userData'), 'save-journals'), recoveryDirectory: join(app.getPath('userData'), 'recovery') })
  if (process.env.COMPOSITOR_TEST === '1') await required('open', { path: demoPath })
  else lastState = await required<EditorState>('state')
  await recentFiles.initialize()
  await loadWindow(window)
  fileOpeningReady = true; await drainOpenFiles()
}).catch(error => { console.error(error); app.quit() })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (window && !window.isDestroyed() && !closeConfirmed && process.env.COMPOSITOR_TEST !== '1') { event.preventDefault(); window.close(); return }
  if (shutdownStarted) return
  shutdownStarted = true
  sourceWatch.dispose()
  if (photoshopController.snapshot().status !== 'committing') photoshopController.cancel()
  agentController.cancel(); edgeRefinementPreviews.dispose(); void subjectWorker?.dispose(); bridge?.close(); editor?.kill()
  if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy()
  if (bridgeInfo) void unlink(bridgeInfo.connectionFile).catch(() => {})
})
