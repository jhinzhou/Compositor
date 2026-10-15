import {HistoryBrushSourceStore,applyHistoryBrushOperation} from './history-brush'
import {inspectDeepComposite} from './deep-composite'
import {inspectHDRComposite} from './hdr-composite'
import {assertDeepActionSupported,assertDeepMergeSupported} from './deep-precision'
import {assertPaintRasterized} from './layer-rasterize'
import {assertDeepAssetBudget} from './deep-assets'
import {prepareEdgeRefinement as prepareEdgeRefinementStage,applyEdgeRefinementOutput,edgeRefinementPreviewState,type EdgeRefinementPrepared} from './edge-refinement'
import {transformSchema} from '../shared/transform'
import {assertLayerActionUnlocked,layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import {contentRasterTransform,shapeTransformExtent,type ShapeTransformRender,type PreparedShapeTransform} from '../shared/content-transform'
import type {RetouchPrepared} from './retouch-edit'
import {maskPlacementAfterTransform} from '../shared/mask-placement'
import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import {
  actionSchema, batchSchema, EditorError, historySchema, LIMITS, mutationSchema, taskBeginSchema, taskCancelSchema, taskFinishSchema, taskUndoSchema, type Activity,
  type BatchMutation, type EditAction, type EditResult, type EditorState, type HistoryRequest, type Manifest, type Mutation,type Transform
} from '../shared/contracts'
import { descendants, hierarchyOrder, validateManifest } from './manifest'
import { fingerprintProject, loadProject, makeAsset, projectFingerprint, saveProject, type Asset } from './project-io'
import { replaceProject } from './save-journal'
import { TaskRegistry } from './task-registry'
import { applyPixelAction,applySelectionRaster,type PixelStage } from './pixel-actions'
import {applyBucketFill} from './bucket-fill'
import {applyColorEraseOperation} from './color-erase-edit'
import { pasteLayerClipboard, altDragPastePlan, type LayerClipboard, type MergePlan } from './layer-operations'
import {coverageShape} from './pixel-actions'
import {prepareSubjectMask} from './subject-mask'
import {appendSelectionShape} from '../shared/selection-composition'
import type {RasterSelection,RGBAImage} from './selection-retouch'
import type { Selection } from '../shared/pixel-contracts'

import type { ExternalProjectStatus } from '../shared/external-project'

interface HistoryEntry { invalidatesReselect?: boolean; id: string; label: string; before: Manifest; after: Manifest; beforeAssets: Map<string, Asset>; afterAssets: Map<string, Asset>; beforeSelection: Selection | null; afterSelection: Selection | null }
export class Editor {
  private manifest!: Manifest
  private selection: Selection | null = null
  private deselectedSelection: Selection | null = null
  private sessionId: string = randomUUID()
  private revision = 0
  private title = 'Untitled'
  private projectPath?: string
  private savedContent?: string
  private savedFingerprint?: string
  private assets = new Map<string, Asset>()
  private past: HistoryEntry[] = []
  private future: HistoryEntry[] = []
  private historySources=new HistoryBrushSourceStore()
  private activity: Activity[] = []
  private retries = new Map<string, { digest: string; result: unknown }>()
  readonly tasks = new TaskRegistry()
  private warnings: string[] = []
  constructor(private options: { journalDirectory?: string; pixelBudget?:()=>number; checkAssets?:(assets:Asset[])=>void; retainedAssetBaseline?:()=>Asset[] } = {}) { this.create(1600, 1200) }

  create(width: number, height: number, options: { modified?: boolean;title?:string } = {}): EditorState {
    const manifest = validateManifest({ format: 'com.compositor.project', version: 11, colorSpace: 'sRGB',
      documentID: randomUUID().toUpperCase(), width, height, resolution: 72, activeLayerID: null, layers: [] }).manifest
    this.install(manifest, new Map(), [], options.title??'Untitled')
    // The untouched welcome canvas has no edits. Restores/imports deliberately remain dirty.
    this.savedContent = options.modified ? undefined : this.content()
    return this.state()
  }
  private install(manifest: Manifest, assets: Map<string, Asset>, warnings: string[], title: string, path?: string): void {
    const sessionId=randomUUID(),historySources=new HistoryBrushSourceStore();historySources.capture({manifest,assets},{sessionId,revision:0,label:'Initial state'},retained=>{if(assets.size)this.assertAssetBudget(assets,retained)})
    this.sessionId = sessionId; this.historySources=historySources;this.revision = 0; this.manifest = manifest; this.assets = assets
    this.selection = null; this.deselectedSelection = null; this.past = []; this.future = []; this.retries.clear(); this.activity = []; this.warnings = warnings
    this.tasks.clear()
    this.title = title; this.projectPath = path; this.savedContent = path ? this.content() : undefined
    this.savedFingerprint = path ? projectFingerprint(manifest, assets) : undefined
    this.record('Opened document', 'system')
  }
  async open(path: string): Promise<EditorState> {
    const loaded = await loadProject(path,{retainedAssets:this.options.retainedAssetBaseline?.()??this.retainedAssets()})
    this.install(loaded.manifest, loaded.assets, loaded.warnings, basename(path, '.comp'), path)
    return this.state()
  }
  async externalStatus(): Promise<ExternalProjectStatus> {
    const path=this.projectPath,sessionId=this.sessionId
    const result=():ExternalProjectStatus=>({sessionId:this.sessionId,revision:this.revision,projectPath:this.projectPath,modified:this.content()!==this.savedContent,changed:false,readable:true})
    if(!path)return result()
    try { const fingerprint=await fingerprintProject(path,this.options.retainedAssetBaseline?.()??this.retainedAssets());if(this.sessionId!==sessionId||this.projectPath!==path)throw new EditorError('SESSION_EXPIRED','The project was replaced during its external-change check.');return {...result(),fingerprint,changed:fingerprint!==this.savedFingerprint} }
    catch(error){return {...result(),changed:true,readable:false,error:error instanceof Error?error.message:String(error)}}
  }
  /** A freshly loaded replacement keeps the instance handle and advances its revision. */
  adoptReloadIdentity(sessionId:string,revision:number,expectedFingerprint?:string):void {
    if(this.past.length||this.future.length||!this.projectPath||!Number.isInteger(revision)||revision<0)throw new EditorError('INVALID_ARGUMENT','Only a fresh project may become a reload replacement.')
    if(expectedFingerprint&&this.savedFingerprint!==expectedFingerprint)throw new EditorError('EXTERNAL_CHANGE','The external project changed again during reload. Check its latest version before retrying.')
    this.sessionId=sessionId;this.revision=revision+1
  }
  async saveAs(path: string,preview?:{revision:number;bytes:Buffer}): Promise<EditorState> {
    if(preview&&preview.revision!==this.revision)throw new EditorError('REVISION_CONFLICT','The document changed while preparing its save preview. Retry saving.')
    const snapshot = this.snapshot(), content = this.content(snapshot.manifest, snapshot.assets), session = this.sessionId
    const destination = await saveProject(path, snapshot.manifest, snapshot.assets,preview?.bytes)
    const hash = await fingerprintProject(destination,this.options.retainedAssetBaseline?.()??this.retainedAssets())
    if (session !== this.sessionId) throw new EditorError('SESSION_EXPIRED', 'The saved document was replaced while saving.')
    this.projectPath = destination; this.title = basename(destination, '.comp'); this.savedContent = content; this.savedFingerprint = hash
    this.record('Saved project', 'user')
    return this.state()
  }
  async save(preview?:{revision:number;bytes:Buffer}): Promise<EditorState> {
    if (!this.projectPath || !this.savedFingerprint || !this.options.journalDirectory) throw new EditorError('SAVE_AS_REQUIRED', 'Choose a project path first.')
    if(preview&&preview.revision!==this.revision)throw new EditorError('REVISION_CONFLICT','The document changed while preparing its save preview. Retry saving.')
    const snapshot = this.snapshot(), content = this.content(snapshot.manifest, snapshot.assets), session = this.sessionId
    await replaceProject(this.projectPath, snapshot.manifest, snapshot.assets, this.savedFingerprint, this.options.journalDirectory,undefined,preview?.bytes,this.options.retainedAssetBaseline?.()??this.retainedAssets())
    const hash = await fingerprintProject(this.projectPath,this.options.retainedAssetBaseline?.()??this.retainedAssets())
    if (session !== this.sessionId) throw new EditorError('SESSION_EXPIRED', 'The saved document was replaced while saving.')
    this.savedContent = content; this.savedFingerprint = hash; this.record('Saved project', 'user')
    return this.state()
  }
  async saveCopy(path: string,preview?:{revision:number;bytes:Buffer}): Promise<EditorState> {
    if(preview&&preview.revision!==this.revision)throw new EditorError('REVISION_CONFLICT','The document changed while preparing its save preview. Retry saving.')
    const snapshot = this.snapshot()
    await saveProject(path, snapshot.manifest, snapshot.assets,preview?.bytes)
    return this.state()
  }
  snapshot(): { manifest: Manifest; assets: Map<string, Asset> } {
    const assets = new Map<string, Asset>()
    for (const layer of this.manifest.layers) for (const file of [layer.imageFile, layer.maskFile]) if (file) assets.set(file, this.assets.get(file)!)
    return { manifest: structuredClone(this.manifest), assets }
  }
  restore(manifest: Manifest, assets: Map<string, Asset>, title: string): EditorState {
    const checked = validateManifest(manifest)
    this.install(checked.manifest, assets, checked.warnings, `${title} recovered`)
    return this.state()
  }
  importDocument(manifest: Manifest, assets: Map<string,Asset>, title: string, warnings: string[] = []):EditorState{
    const checked=validateManifest(manifest);this.install(checked.manifest,assets,[...checked.warnings,...warnings],title);return this.state()
  }
  state(): EditorState {
    const referenced=new Set(this.manifest.layers.flatMap(layer=>[layer.imageFile,layer.maskFile]))
    return { sessionId: this.sessionId, revision: this.revision, manifest: structuredClone(this.manifest), title: this.title,
      projectPath: this.projectPath, modified: this.content() !== this.savedContent,
      canUndo: this.past.length > 0, canRedo: this.future.length > 0, canReselect: !this.selection && !!this.deselectedSelection,
      undoTransactionId: this.past.at(-1)?.id, redoTransactionId: this.future.at(-1)?.id,
      selection: structuredClone(this.selection),historyBrush:this.historySources.state(), warnings: [...new Set([...this.warnings,...validateManifest(this.manifest).warnings])],
      assets: [...this.assets.values()].filter(asset => referenced.has(asset.file)).map(({ file,hash,width,height,bitDepth,displayHash,pixelFormat,isHDR }) => ({file,hash,width,height,...(bitDepth!==undefined?{bitDepth}:{}),...(displayHash?{displayHash}:{}),...(pixelFormat?{pixelFormat}:{}),...(isHDR?{isHDR}:{})})), activity: [...this.activity] }
  }
  asset(sessionId: string, file: string, hash: string, representation:'source'|'display'='source', displayHash?:string): Buffer {
    if (sessionId !== this.sessionId) throw new EditorError('SESSION_EXPIRED', 'This document handle has expired.')
    const asset = [this.assets, ...this.past.flatMap(entry => [entry.beforeAssets, entry.afterAssets]), ...this.future.flatMap(entry => [entry.beforeAssets, entry.afterAssets])].map(assets => assets.get(file)).find(asset => asset?.hash === hash)
    if (!asset) throw new EditorError('ASSET_NOT_FOUND', 'This image snapshot is unavailable.')
    if(representation==='display'){if(displayHash&&displayHash!==asset.displayHash)throw new EditorError('ASSET_NOT_FOUND','This display snapshot is unavailable.');if(asset.bitDepth===16&&!asset.displayBytes)throw new EditorError('RENDER_FAILED','The high-bit image display proxy is missing.');return asset.displayBytes??asset.bytes}
    return asset.bytes
  }
  private content(manifest = this.manifest, assets = this.assets): string {
    return JSON.stringify({ manifest, images: manifest.layers.flatMap(layer => [layer.imageFile, layer.maskFile]).filter((file): file is string => !!file).map(file => [file, assets.get(file)?.hash]) })
  }
  private record(label: string, source: Activity['source']): void {
    this.activity.unshift({ id: randomUUID(), label, source, revision: this.revision, at: new Date().toISOString() })
    this.activity = this.activity.slice(0, 40)
  }
  private commit(next: Manifest, label: string, source: Activity['source'], assets = this.assets, selection = this.selection, convertedLayers:ReadonlySet<string>=new Set()): EditResult {
    const previousRevision = this.revision
    for(const layer of next.layers){const file=layer.imageFile;if(!convertedLayers.has(layer.id)&&file&&this.assets.get(file)?.bitDepth===16&&assets.get(file)?.bitDepth!==16)throw new EditorError('UNSUPPORTED_FEATURE','This operation does not yet preserve 16-bit layer data. The original pixels and history have been kept.')}
    if(next.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.hdr))next.version=13
    else if(next.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.bitDepth===16))next.version=12
    else if(next.version>=12)next.version=11
    for(const layer of next.layers){const previous=this.manifest.layers.find(item=>item.id===layer.id);if(!convertedLayers.has(layer.id)&&previous?.imageFile&&this.assets.get(previous.imageFile)?.bitDepth===16&&(!layer.imageFile||assets.get(layer.imageFile)?.bitDepth!==16))throw new EditorError('UNSUPPORTED_FEATURE','Replacing this layer does not yet preserve 16-bit data. The original pixels and history have been kept.')}
    for(const layer of next.layers){const previous=this.manifest.layers.find(item=>item.id===layer.id),old=previous?.imageFile?this.assets.get(previous.imageFile):undefined,replacement=layer.imageFile?assets.get(layer.imageFile):undefined;if(old?.hdr&&!replacement?.hdr&&!convertedLayers.has(layer.id))throw new EditorError('UNSUPPORTED_FEATURE','This operation does not preserve floating-point HDR data. The original source and history have been kept.')}
    validateManifest(next)
    const referenced = new Set(next.layers.flatMap(layer => [layer.imageFile, layer.maskFile]).filter((file): file is string => !!file))
    assets = new Map([...assets].filter(([file]) => referenced.has(file)))
    if(next.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.bitDepth===16)&&(next.layers.some(layer=>layer.adjustment&&layer.isVisible)||next.layers.some(layer=>layer.imageFile&&assets.get(layer.imageFile)?.hdr))){
      const inspection=[...assets.values()].some(asset=>asset.hdr)?inspectHDRComposite(next,assets):inspectDeepComposite(next,assets)
      if(!inspection.supported)throw new EditorError(inspection.reasons.some(reason=>['budget','work'].includes(reason.feature))?'RESOURCE_LIMIT':'UNSUPPORTED_FEATURE','This change cannot yet be composed at 16 bits. The original pixels and history have been kept.',{reasons:inspection.reasons})
    }
    if (this.content(next, assets) === this.content() && JSON.stringify(selection) === JSON.stringify(this.selection)) return { status: 'no_change', revision: this.revision, previousRevision, undoable: false }
    this.assertAssetBudget(assets)
    const id = randomUUID()
    this.past.push({ id, label, before: structuredClone(this.manifest), after: structuredClone(next), beforeAssets: new Map(this.assets), afterAssets: new Map(assets), beforeSelection: structuredClone(this.selection), afterSelection: structuredClone(selection) })
    if (this.past.length > 100) this.past.shift()
    if(next.width!==this.manifest.width||next.height!==this.manifest.height)this.deselectedSelection=null
    else if(this.selection&&!selection)this.deselectedSelection=structuredClone(this.selection)
    this.future = []; this.selection = structuredClone(selection); this.manifest = next; this.assets = new Map(assets); this.revision++; this.record(label, source)
    return { status: 'applied', revision: this.revision, previousRevision, transactionId: id, undoable: true }
  }
  private assertAssetBudget(assets:Map<string,Asset>,extra:Asset[]=[]):void {
    const versions=[...new Set([...extra,...this.historySources.retainedAssets(),...this.past.slice(-99).flatMap(entry=>[...entry.beforeAssets.values(),...entry.afterAssets.values()]),...this.assets.values(),...assets.values()])]
    const retained = new Map(versions.map(asset => [asset.hash, asset]))
    if ([...retained.values()].reduce((total, asset) => total + asset.width * asset.height, 0) > (this.options.pixelBudget?.()??LIMITS.maxPixels)) throw new EditorError('RESOURCE_LIMIT', 'Raster history exceeds this build’s pixel budget.')
    if([...retained.values()].some(asset=>asset.bitDepth===16))assertDeepAssetBudget(versions,0,(this.options.pixelBudget?.()??LIMITS.maxPixels)*4)
    this.options.checkAssets?.(versions)
  }
  private assertIdentity(request: Pick<Mutation, 'sessionId' | 'documentId'>): void {
    if (request.sessionId !== this.sessionId) throw new EditorError('SESSION_EXPIRED', 'Read the current document state to obtain a new session handle.')
    if (request.documentId !== this.manifest.documentID) throw new EditorError('DOCUMENT_NOT_FOUND', 'The requested document is not open.')
  }
  private retry<T, R extends Pick<Mutation, 'sessionId' | 'documentId' | 'idempotencyKey'> & { expectedRevision?: number }>(request: R, execute: () => T): T {
    this.assertIdentity(request)
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const cached = this.retries.get(request.idempotencyKey)
    if (cached) {
      if (cached.digest !== digest) throw new EditorError('IDEMPOTENCY_CONFLICT', 'A request key cannot be reused with different parameters.')
      return structuredClone(cached.result) as T
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== this.revision) throw new EditorError('REVISION_CONFLICT', 'The document changed. Read state and preview before retrying.', { expected: request.expectedRevision, actual: this.revision })
    if('action' in request){assertLayerActionUnlocked(this.manifest,request.action as EditAction);assertPaintRasterized(this.manifest,request.action as EditAction);assertDeepActionSupported(this.manifest,this.assets,request.action as EditAction)}
    const result = execute()
    this.retries.set(request.idempotencyKey, { digest, result: structuredClone(result) })
    if (this.retries.size > 512) this.retries.delete(this.retries.keys().next().value!)
    return result
  }
  commitTrim(input:unknown,bounds:{x:number;y:number;width:number;height:number}|undefined,source:Activity['source']='user'):EditResult{const request=mutationSchema.parse(input);if(request.action.type!=='document.trim')throw new EditorError('INVALID_ARGUMENT','Invalid trim operation.');return this.retry(request,()=>{if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId);const result=bounds?this.executeActions([{type:'document.crop',...bounds}],source,'Trim canvas'):{status:'no_change' as const,revision:this.revision,previousRevision:this.revision,undoable:false};if(request.taskId)this.tasks.record(request.taskId,result.revision,result.transactionId);return result})}
  inspectPrepared(input:unknown,source:Activity['source']='user'):EditResult|undefined{
    const request=mutationSchema.parse(input);this.assertIdentity(request)
    const cached=this.retries.get(request.idempotencyKey),digest=createHash('sha256').update(JSON.stringify(request)).digest('hex')
    if(cached){if(cached.digest!==digest)throw new EditorError('IDEMPOTENCY_CONFLICT','A request key cannot be reused with different parameters.');return structuredClone(cached.result) as EditResult}
    if(request.expectedRevision!==this.revision)throw new EditorError('REVISION_CONFLICT','The image source has changed. Read fresh state before retrying.')
    assertLayerActionUnlocked(this.manifest,request.action)
    assertPaintRasterized(this.manifest,request.action)
    assertDeepActionSupported(this.manifest,this.assets,request.action)
    if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId)
  }
  applySelectionRaster(input:unknown,image:RGBAImage,source:Activity['source']='user'):EditResult{
    const request=mutationSchema.parse(input)
    if(request.action.type!=='selection.wand'&&request.action.type!=='selection.color_range'&&request.action.type!=='selection.quick')throw new EditorError('INVALID_ARGUMENT','Invalid prepared selection action.')
    const action=request.action
    return this.retry(request,()=>{
      if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId)
      if(!this.manifest.layers.some(layer=>layer.id===action.layerId))throw new EditorError('LAYER_NOT_FOUND','The selection layer was removed.')
      const stage={manifest:structuredClone(this.manifest),assets:new Map(this.assets),selection:structuredClone(this.selection)},label=applySelectionRaster(stage,action,image)
      const result=this.commit(stage.manifest,label,source,stage.assets,stage.selection)
      if(request.taskId)this.tasks.record(request.taskId,result.revision,result.transactionId)
      return result
    })
  }
  applyColorEraseRaster(input:unknown,image:RGBAImage,source:Activity['source']='user'):EditResult{
    const request=mutationSchema.parse(input)
    if(request.action.type!=='layer.magic_erase'||!request.action.sampleAllLayers)throw new EditorError('INVALID_ARGUMENT','Invalid merged eraser action.')
    const action=request.action
    return this.retry(request,()=>{
      if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId)
      const stage={manifest:structuredClone(this.manifest),assets:new Map(this.assets),selection:structuredClone(this.selection)},label=applyColorEraseOperation(stage,action,image)
      const result=this.commit(stage.manifest,label,source,stage.assets,stage.selection)
      if(request.taskId)this.tasks.record(request.taskId,result.revision,result.transactionId)
      return result
    })
  }
  applyBucketFillRaster(input:unknown,image:RGBAImage,source:Activity['source']='user'):EditResult{const request=mutationSchema.parse(input);if(request.action.type!=='layer.bucket_fill'||!request.action.sampleAllLayers)throw new EditorError('INVALID_ARGUMENT','Invalid merged Paint Bucket action.');const action=request.action;return this.retry(request,()=>{if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId);const stage={manifest:structuredClone(this.manifest),assets:new Map(this.assets),selection:structuredClone(this.selection)},label=applyBucketFill(stage,action,image),result=this.commit(stage.manifest,label,source,stage.assets,stage.selection);if(request.taskId)this.tasks.record(request.taskId,result.revision,result.transactionId);return result})}
  commitRetouch(input:unknown,result:RetouchPrepared,source:Activity['source']='user'):EditResult{const request=mutationSchema.parse(input);if(request.action.type!=='layer.retouch')throw new EditorError('INVALID_ARGUMENT','Invalid prepared retouch action.');const action=request.action;return this.retry(request,()=>{if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId);const next=structuredClone(this.manifest),assets=new Map(this.assets),layer=next.layers.find(layer=>layer.id===action.layerId);if(!layer)throw new EditorError('LAYER_NOT_FOUND','The retouch layer was removed.');if(result.target!==(action.target??'image'))throw new EditorError('INVALID_ARGUMENT','Retouch target does not match the request.');const file=`${layer.id.toUpperCase()}${result.target==='mask'?'.mask':''}.png`;if(result.target==='mask'){if(!layer.maskFile)throw new EditorError('INVALID_ARGUMENT','The mask was removed.');layer.maskFile=file;invalidatePhotoshopComponent(layer,'mask')}else {layer.imageFile=file;layer.transform=structuredClone(result.transform);delete layer.text;delete layer.shape;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')}assets.set(file,makeAsset(file,Buffer.from(result.png)));if(result.maskPNG&&layer.maskFile){assets.set(layer.maskFile,makeAsset(layer.maskFile,Buffer.from(result.maskPNG)));invalidatePhotoshopComponent(layer,'mask')}const applied=this.commit(next,'Clone Stamp',source,assets);if(request.taskId)this.tasks.record(request.taskId,applied.revision,applied.transactionId);return applied})}
  prepareEdgeRefinement(input:unknown,source:Activity['source']='user'):EdgeRefinementPrepared|{cached:EditResult}{
    const request=mutationSchema.parse(input)
    if(request.action.type!=='selection.refine_edges')throw new EditorError('INVALID_ARGUMENT','Invalid edge refinement action.')
    const cached=this.inspectPrepared(request,source);if(cached)return {cached}
    return prepareEdgeRefinementStage({...this.snapshot(),selection:structuredClone(this.selection)},request.action)
  }
  edgeRefinementRasterPreview(input:unknown,result:{coverage:RasterSelection},source:Activity['source']='user'):{state:EditorState}{
    const request=mutationSchema.parse(input)
    if(request.action.type!=='selection.refine_edges')throw new EditorError('INVALID_ARGUMENT','Invalid edge refinement action.')
    if(this.inspectPrepared(request,source)||request.expectedRevision!==this.revision)throw new EditorError('REVISION_CONFLICT','The edge refinement preview is stale. Retry from the current document.')
    const stage={...this.snapshot(),selection:structuredClone(this.selection)}
    applyEdgeRefinementOutput(stage,request.action,result.coverage)
    validateManifest(stage.manifest)
    this.assertAssetBudget(stage.assets)
    return {state:edgeRefinementPreviewState(this.state(),stage)}
  }
  commitPrepared(input:unknown,result:{coverage?:RasterSelection;bytes?:Buffer;space?:'source'|'document'},source:Activity['source']='user'):EditResult{
    const request=mutationSchema.parse(input)
    return this.retry(request,()=>{if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId)
      if(request.action.type==='selection.refine_edges'){
        if(result.space&&result.space!=='source')throw new EditorError('INVALID_ARGUMENT','Edge refinement coverage must use source pixels.')
        const stage={manifest:structuredClone(this.manifest),assets:new Map(this.assets),selection:structuredClone(this.selection)}
        const label=applyEdgeRefinementOutput(stage,request.action,result.coverage!)
        const applied=this.commit(stage.manifest,label,source,stage.assets,stage.selection)
        if(request.taskId)this.tasks.record(request.taskId,applied.revision,applied.transactionId)
        return applied
      }
      if(request.action.type!=='selection.subject'&&request.action.type!=='layer.content_fill')throw new EditorError('INVALID_ARGUMENT','Unsupported prepared image operation.')
      const action=request.action,next=structuredClone(this.manifest),assets=new Map(this.assets),layer=next.layers.find(layer=>layer.id===action.layerId);if(!layer)throw new EditorError('LAYER_NOT_FOUND','The operation layer was removed.')
      let selection=structuredClone(this.selection)
      if(request.action.type==='selection.subject'){
        const mask=result.coverage,documentSpace=result.space==='document',sourceAsset=layer.imageFile?assets.get(layer.imageFile):undefined
        if((!documentSpace||request.action.removeBackground)&&!layer.imageFile)throw new EditorError('LAYER_NOT_FOUND','Choose a raster layer for this operation.')
        if((!documentSpace||request.action.removeBackground)&&!sourceAsset)throw new EditorError('ASSET_NOT_FOUND','The operation source raster is missing.')
        const expectedWidth=documentSpace?next.width:sourceAsset!.width,expectedHeight=documentSpace?next.height:sourceAsset!.height
        if(!mask||mask.width!==expectedWidth||mask.height!==expectedHeight||mask.coverage.length!==mask.width*mask.height)throw new EditorError('INVALID_ARGUMENT','The prepared mask does not match its source.')
        if(request.action.removeBackground){
          const prepared=prepareSubjectMask(layer,sourceAsset!,mask,this.selection,documentSpace?'document':'source',layer.maskFile?assets.get(layer.maskFile):undefined)
          assets.set(prepared.file,makeAsset(prepared.file,prepared.bytes));invalidatePhotoshopComponent(prepared.layer,'mask');next.layers[next.layers.indexOf(layer)]=prepared.layer
        }else{
          const hard:RasterSelection={...mask,coverage:mask.coverage.map(value=>value>=128?255:0)}
          const transform:Transform=documentSpace?{origin:[0,0],size:[next.width,next.height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}:layer.transform
          const settings=request.action as typeof request.action&{operation?:'replace'|'add'|'subtract'|'intersect';antialiased?:boolean}
          selection=appendSelectionShape(selection,coverageShape(hard,transform,settings.operation??'replace'),next.width,next.height);selection.canvasSize=[next.width,next.height];selection.antialiased=settings.antialiased??true
        }
      }else{if(!layer.imageFile)throw new EditorError('LAYER_NOT_FOUND','Choose a raster layer for this operation.');if(!result.bytes)throw new EditorError('INVALID_ARGUMENT','Content fill returned no raster.');const asset=makeAsset(layer.imageFile,result.bytes),old=assets.get(layer.imageFile);if(!old)throw new EditorError('ASSET_NOT_FOUND','The operation source raster is missing.');if(asset.width!==old.width||asset.height!==old.height)throw new EditorError('INVALID_ARGUMENT','The filled raster changed source dimensions.');assets.set(layer.imageFile,asset);delete layer.text;delete layer.shape;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')}
      const applied=this.commit(next,request.action.type==='layer.content_fill'?'Content-Aware Fill':request.action.removeBackground?'Remove Background':'Select Subject',source,assets,selection);if(request.taskId)this.tasks.record(request.taskId,applied.revision,applied.transactionId);return applied
    })
  }
  apply(input: unknown, source: Activity['source'] = 'user'): EditResult {
    const request = mutationSchema.parse(input)
    return this.retry(request, () => {
      if (source === 'agent' || request.taskId) this.tasks.assertWritable(request.taskId)
      const result = this.executeActions([request.action], source)
      if (request.taskId) this.tasks.record(request.taskId, result.revision, result.transactionId)
      return result
    })
  }
  applyBatch(input: unknown, source: Activity['source'] = 'user'): EditResult {
    const request = batchSchema.parse(input)
    return this.retry(request, () => {
      if (source === 'agent' || request.taskId) this.tasks.assertWritable(request.taskId)
      const result = this.executeActions(request.actions, source, request.label)
      if (request.taskId) this.tasks.record(request.taskId, result.revision, result.transactionId)
      return result
    })
  }
  prepareContentTransforms(input:unknown,batch=false,source:Activity['source']='user'):{cached?:EditResult;renders:ShapeTransformRender[]} {
    const request=batch?batchSchema.parse(input):mutationSchema.parse(input);this.assertIdentity(request)
    const cached=this.retries.get(request.idempotencyKey),digest=createHash('sha256').update(JSON.stringify(request)).digest('hex')
    if(cached){if(cached.digest!==digest)throw new EditorError('IDEMPOTENCY_CONFLICT','A request key cannot be reused with different parameters.');return {cached:structuredClone(cached.result) as EditResult,renders:[]}}
    if(request.expectedRevision!==this.revision)throw new EditorError('REVISION_CONFLICT','The content transform source changed. Read fresh state before retrying.')
    if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId)
    const actions='actions' in request?request.actions:[request.action],renders:ShapeTransformRender[]=[],dimensions=new Map<string,{width:number;height:number}>()
    for(const [index,action] of actions.entries()){
      if(action.type!=='layer.set_transform'||typeof action.layerId!=='string')continue
      const layer=this.manifest.layers.find(item=>item.id===action.layerId),asset=layer?.imageFile?this.assets.get(layer.imageFile):undefined
      if(!layer?.shape||!asset)continue
      if(asset.bitDepth===16)throw new EditorError('UNSUPPORTED_FEATURE','Shape rasterization does not yet preserve 16-bit layer data. The original pixels have been kept.')
      const size=shapeTransformExtent(layer.shape,action.transform,dimensions.get(layer.id)??asset)
      if(size){renders.push({index,layerId:layer.id,style:structuredClone(layer.shape) as ShapeTransformRender['style'],size,sourceHash:asset.hash});dimensions.set(layer.id,{width:size[0],height:size[1]})}
    }
    return {renders}
  }
  commitPreparedTransforms(input:unknown,prepared:PreparedShapeTransform[],batch=false,source:Activity['source']='user'):EditResult {
    const request=batch?batchSchema.parse(input):mutationSchema.parse(input)
    return this.retry(request,()=>{
      if(source==='agent'||request.taskId)this.tasks.assertWritable(request.taskId)
      const actions='actions' in request?request.actions:[request.action],rasters=new Map<number,PreparedShapeTransform>()
      for(const raster of prepared){if(!Number.isInteger(raster.index)||rasters.has(raster.index)||actions[raster.index]?.type!=='layer.set_transform')throw new EditorError('INVALID_ARGUMENT','Invalid prepared shape transform.');rasters.set(raster.index,raster)}
      const result=this.executeActions(actions,source,'label' in request?request.label:undefined,rasters)
      if(request.taskId)this.tasks.record(request.taskId,result.revision,result.transactionId)
      return result
    })
  }
  beginTask(input: unknown) {
    const request = taskBeginSchema.parse(input)
    return this.retry({ ...request, operation: 'task.begin' }, () => this.tasks.begin(this.sessionId, this.manifest.documentID, this.revision, request.label))
  }
  cancelTask(input: unknown) {
    const request = taskCancelSchema.parse(input)
    return this.retry({ ...request, operation: 'task.cancel' }, () => this.tasks.stop(request.taskId, 'cancelled'))
  }
  finishTask(input: unknown) {
    const request = taskFinishSchema.parse(input)
    return this.retry({ ...request, operation: 'task.finish' }, () => this.tasks.stop(request.taskId, request.state, request.message))
  }
  undoTask(input: unknown): EditResult {
    const request = taskUndoSchema.parse(input)
    return this.retry({ ...request, operation: 'history.undo_task' }, () => {
      const task = this.tasks.get(request.taskId), count = task.transactions.length
      if (!count) { this.tasks.stop(request.taskId, 'undone'); return { status: 'no_change', previousRevision: this.revision, revision: this.revision, undoable: false } }
      const entries = this.past.slice(-count)
      if (entries.length !== count || entries.some((entry, i) => entry.id !== task.transactions[i])) throw new EditorError('UNDO_CONFLICT', 'Only a complete task at the history top can be undone. Later user edits have been preserved.')
      const previousRevision = this.revision
      this.past.splice(-count)
      this.future.push(...entries.slice().reverse())
      this.manifest = structuredClone(entries[0].before); this.assets = new Map(entries[0].beforeAssets); this.selection = structuredClone(entries[0].beforeSelection); this.deselectedSelection=null; this.revision++
      this.tasks.stop(request.taskId, 'undone'); this.record(`Undo task: ${task.label}`, 'agent')
      return { status: 'applied', previousRevision, revision: this.revision, transactionId: entries.at(-1)!.id, undoable: true }
    })
  }
  private executeActions(actions: BatchMutation['actions'], source: Activity['source'], requestedLabel?: string, preparedShapes=new Map<number,PreparedShapeTransform>()): EditResult {
    if(actions.some(action=>action.type==='document.history_source')){if(actions.length!==1)throw new EditorError('INVALID_ARGUMENT','History source changes must be applied separately from image edits.');const action=actionSchema.parse(actions[0]);if(action.type==='document.history_source'){if(action.operation==='capture')this.historySources.capture(this.snapshot(),{sessionId:this.sessionId,revision:this.revision,label:action.label??`Source at revision ${this.revision}`},assets=>this.assertAssetBudget(this.assets,assets));else if(action.operation==='select')this.historySources.select(action.sourceId!);else this.historySources.clear();return {status:'no_change',revision:this.revision,previousRevision:this.revision,undoable:false}}}
    const next = structuredClone(this.manifest), stagedAssets = new Map(this.assets), createdIds: Record<string, string> = Object.create(null)
    let label = '';const convertedLayers=new Set<string>()
    const initialCanvas=[this.manifest.width,this.manifest.height]
    const pixelStage:PixelStage = { manifest: next, assets: stagedAssets, selection: structuredClone(this.selection) }
    const invalidatesReselect=actions.some(action=>action.type.startsWith('document.')&&!['document.info','document.path_set','document.path_delete'].includes(action.type))
    let deselectedSelection=invalidatesReselect?null:structuredClone(this.deselectedSelection)
    for (const [actionIndex,input] of actions.entries()) {
      const normalized = structuredClone(input) as Record<string, unknown>
      const resolveRef = (value: unknown): unknown => {
        if (value && typeof value === 'object' && 'ref' in value) {
          const ref = (value as { ref: string }).ref
          if (!createdIds[ref]) throw new EditorError('INVALID_ARGUMENT', `Unknown or forward object reference: ${ref}`)
          return createdIds[ref]
        }
        return value
      }
      for (const key of ['layerId', 'parentId', 'beforeLayerId', 'sourceId']) if (key in normalized) normalized[key] = resolveRef(normalized[key])
      if (Array.isArray(normalized.layerIds)) normalized.layerIds = normalized.layerIds.map(resolveRef)
      const action = actionSchema.parse(normalized)
      assertPaintRasterized(next,action)
      assertDeepActionSupported(next,stagedAssets,action)
      assertLayerActionUnlocked(next,action)
      const layer = 'layerId' in action ? next.layers.find(item => item.id === action.layerId) : undefined
      if ('layerId' in action && action.layerId && !layer) throw new EditorError('LAYER_NOT_FOUND', 'The requested layer no longer exists.')
      let created: string | undefined
      const beforeSelection=pixelStage.selection
      if(action.type==='selection.reselect'){
        if(!deselectedSelection||pixelStage.selection)throw new EditorError('INVALID_ARGUMENT','Deselect an existing selection before using Reselect.')
        pixelStage.selection=structuredClone(deselectedSelection)
      }
      const pixelLabel = action.type==='selection.reselect'?'Reselect':action.type==='layer.history_brush'?applyHistoryBrushOperation(pixelStage,action,this.historyBrushSource(action.sourceId),this.sessionId):applyPixelAction(pixelStage, action)
      if(action.type==='frame.create')created=next.activeLayerID??undefined
      if(!invalidatesReselect&&beforeSelection&&!pixelStage.selection)deselectedSelection=structuredClone(beforeSelection)
      if(action.type==='layer.convert_depth')convertedLayers.add(action.layerId)
      if (pixelLabel) label = pixelLabel
      else switch (action.type) {
        case 'layer.set_lock':if(action.lock==='all')layer!.locked=action.locked;else layer!.positionLocked=action.locked;invalidatePhotoshopComponent(layer!,'protection');label='Set layer lock';break
        case 'layer.rename': layer!.name = action.name; label = 'Rename layer'; break
        case 'layer.set_visibility': layer!.isVisible = action.visible; label = action.visible ? 'Show layer' : 'Hide layer'; break
        case 'layer.set_opacity': layer!.opacity = action.opacity; label = 'Set opacity'; break
        case 'layer.set_blend': layer!.blendMode = action.blendMode; label = 'Set blend mode'; break
        case 'layer.set_transform':
          if (layer!.isGroup&&!layer!.maskFile) throw new EditorError('UNSUPPORTED_FEATURE', 'Transform group children individually.')
          {const mask=layer!.maskFile&&stagedAssets.get(layer!.maskFile);const placement=maskPlacementAfterTransform(layer!,action.transform,!!mask&&mask.width===1&&mask.height===1);if(placement)layer!.maskPlacement=placement;else delete layer!.maskPlacement}
          {const asset=layer!.imageFile?stagedAssets.get(layer!.imageFile):undefined,size=shapeTransformExtent(layer!.shape,action.transform,asset),prepared=preparedShapes.get(actionIndex)
            if(size){
              if(!prepared)throw new EditorError('CONTENT_RENDER_REQUIRED','This shape size must be regenerated before its transform can commit.')
              const original=this.manifest.layers.find(item=>item.id===layer!.id),sourceAsset=original?.imageFile?this.assets.get(original.imageFile):undefined
              if(prepared.layerId!==layer!.id||prepared.sourceHash!==sourceAsset?.hash||JSON.stringify(prepared.style)!==JSON.stringify(layer!.shape))throw new EditorError('REVISION_CONFLICT','The shape raster no longer matches its source.')
              const file=layer!.imageFile!,replacement=makeAsset(file,Buffer.from(prepared.bytes));if(replacement.width!==size[0]||replacement.height!==size[1])throw new EditorError('INVALID_ARGUMENT','The shape raster has incorrect dimensions.')
              if(layer!.maskFile&&!layer!.maskPlacement)layer!.maskPlacement=structuredClone(action.transform)
              stagedAssets.set(file,replacement)
            }else if(prepared)throw new EditorError('INVALID_ARGUMENT','An unnecessary shape raster was supplied.')
          }
          layer!.transform = action.transform; label = 'Transform layer'; break
        case 'layer.delete': {
          const removed = descendants(next, layer!.id)
          next.layers = next.layers.filter(item => !removed.has(item.id))
          for (const item of next.layers) if (item.maskSourceID && removed.has(item.maskSourceID)) delete item.maskSourceID
          if (next.activeLayerID && removed.has(next.activeLayerID)) next.activeLayerID = next.layers.at(-1)?.id ?? null
          label = 'Delete layer'; break
        }
        case 'layer.duplicate': {
          const included = descendants(next, layer!.id)
          const originals = next.layers.filter(item => included.has(item.id))
          if (next.layers.length + originals.length > LIMITS.maxLayers) throw new EditorError('RESOURCE_LIMIT', 'Duplicating this selection would exceed the layer limit.')
          const mapping = new Map(originals.map(item => [item.id, randomUUID().toUpperCase()]))
          const copies = originals.map(original => {
            const copy = structuredClone(original)
            copy.id = mapping.get(original.id)!
            if (original.id === layer!.id) copy.name += ' copy'
            if (copy.parentID) copy.parentID = mapping.get(copy.parentID) ?? copy.parentID
            if (copy.maskSourceID) copy.maskSourceID = mapping.get(copy.maskSourceID) ?? copy.maskSourceID
            if (copy.maskFile) {
              const mask = stagedAssets.get(copy.maskFile)!; copy.maskFile = `${copy.id}.mask.png`; stagedAssets.set(copy.maskFile, { ...mask, file: copy.maskFile })
            }
            if (copy.imageFile) {
              const asset = stagedAssets.get(copy.imageFile)
              if (!asset) throw new EditorError('ASSET_NOT_FOUND', 'The copied layer image is missing.')
              copy.imageFile = `${copy.id}.${asset.hdr?'exr':'png'}`
              stagedAssets.set(copy.imageFile, { ...asset, file: copy.imageFile })
            }
            return copy
          })
          created = mapping.get(layer!.id)!
          next.layers.splice(next.layers.indexOf(layer!) + 1, 0, ...copies); next.activeLayerID = created
          label = layer!.isGroup ? 'Duplicate folder' : 'Duplicate layer'; break
        }
        case 'group.ungroup': {
          if (!layer!.isGroup) throw new EditorError('INVALID_ARGUMENT', 'Ungroup requires a folder.')
          const children = next.layers.filter(item => item.parentID === layer!.id)
          const childIDs = new Set(children.map(item => item.id))
          for (const child of children) child.parentID = layer!.parentID
          // Native Ungroup discards the folder's appearance, rather than baking it into its children.
          next.layers = next.layers.flatMap(item => item.id === layer!.id ? children : childIDs.has(item.id) ? [] : [item])
          if (next.activeLayerID === layer!.id) next.activeLayerID = children[0]?.id ?? next.layers.at(-1)?.id ?? null
          label = 'Ungroup layers'; break
        }
        case 'layer.reorder': {
          const siblings = next.layers.filter(item => item.parentID === layer!.parentID)
          const i = siblings.findIndex(item => item.id === layer!.id)
          const sibling = siblings[i + (action.direction === 'up' ? 1 : -1)]
          if (sibling) {
            const a = next.layers.indexOf(layer!), b = next.layers.indexOf(sibling)
            ;[next.layers[a], next.layers[b]] = [next.layers[b], next.layers[a]]
          }
          label = 'Reorder layer'; break
        }
        case 'layer.set_parent': layer!.parentID = action.parentId ?? undefined; label = 'Move layer to group'; break
        case 'layer.move': {
          const ids = new Set(action.layerIds)
          for (const id of ids) if (!next.layers.some(item => item.id === id)) throw new EditorError('LAYER_NOT_FOUND', 'A moved layer no longer exists.')
          const ordered = hierarchyOrder(next)
          const roots = ordered.filter(item => ids.has(item.id) && !next.layers.some(parent => ids.has(parent.id) && parent.id !== item.id && descendants(next, parent.id).has(item.id)))
          const removed = new Set<string>()
          for (const root of roots) for (const id of descendants(next, root.id)) removed.add(id)
          if (action.parentId && removed.has(action.parentId)) throw new EditorError('INVALID_PROJECT', 'A folder cannot be moved into itself or a descendant.')
          if (action.beforeLayerId && removed.has(action.beforeLayerId)) throw new EditorError('INVALID_ARGUMENT', 'The drop position is part of the moved selection.')
          const target = action.beforeLayerId ? next.layers.find(item => item.id === action.beforeLayerId) : undefined
          if (action.beforeLayerId && (!target || (target.parentID ?? null) !== action.parentId)) throw new EditorError('INVALID_ARGUMENT', 'The drop position must be in the target folder.')
          const block = ordered.filter(item => removed.has(item.id)), rest = next.layers.filter(item => !removed.has(item.id))
          for (const root of roots) root.parentID = action.parentId ?? undefined
          const index = target ? rest.findIndex(item => item.id === target.id) : rest.length
          rest.splice(index, 0, ...block); next.layers = rest; label = 'Move selected layers'; break
        }
        case 'group.add': {
          const id = randomUUID().toUpperCase()
          next.layers.push({ id, name: action.name, isVisible: true, isGroup: true, opacity: 1, blendMode: 'Normal',
            transform: { origin: [0, 0], size: [next.width, next.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } })
          next.activeLayerID = id; created = id; label = 'Add group'; break
        }
        case 'layer.add_blank': {
          // Native Compositor represents an empty layer without a raster asset.
          const id = randomUUID().toUpperCase()
          next.layers.push({ id, name: action.name, isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal',
            transform: { origin: [0, 0], size: [next.width, next.height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } })
          next.activeLayerID = id; created = id; label = 'Add blank layer'; break
        }
      }
      validateManifest(next)
      if (input.type === 'group.add' || input.type === 'layer.add_blank' || input.type === 'layer.duplicate' || input.type === 'frame.create') {
        if (input.clientRef && created) {
          if (createdIds[input.clientRef]) throw new EditorError('INVALID_ARGUMENT', 'A batch object reference must be unique.')
          createdIds[input.clientRef] = created
        }
      }
    }
    const result = this.commit(next, requestedLabel ?? (actions.length > 1 ? 'Edit selected layers' : label), source, stagedAssets, pixelStage.selection,convertedLayers)
    if(result.status==='applied'){this.deselectedSelection=!invalidatesReselect&&next.width===initialCanvas[0]&&next.height===initialCanvas[1]?deselectedSelection:null;this.past.at(-1)!.invalidatesReselect=invalidatesReselect}
    if(pixelStage.mixerReservoir)result.mixerReservoir=structuredClone(pixelStage.mixerReservoir)
    if (Object.keys(createdIds).length) result.createdIds = { ...createdIds }
    return result
  }
  history(input: unknown, source: Activity['source'] = 'user'): EditResult {
    const request = historySchema.parse(input)
    return this.retry(request, () => {
      const stack = request.direction === 'undo' ? this.past : this.future
      const target = stack.at(-1)
      if (!target) return { status: 'no_change', revision: this.revision, previousRevision: this.revision, undoable: false }
      if (source === 'agent' && !request.transactionId) throw new EditorError('INVALID_ARGUMENT', 'Agent undo requires the current top transactionId.')
      if (request.transactionId && request.transactionId !== target.id) throw new EditorError('UNDO_CONFLICT', 'Only the top history transaction can be undone or redone.')
      const previousRevision = this.revision
      stack.pop(); (request.direction === 'undo' ? this.future : this.past).push(target)
      if(target.invalidatesReselect||target.before.width!==target.after.width||target.before.height!==target.after.height)this.deselectedSelection=null
      this.manifest = structuredClone(request.direction === 'undo' ? target.before : target.after)
      const restoredSelection=request.direction === 'undo' ? target.beforeSelection : target.afterSelection
      if(!target.invalidatesReselect&&this.selection&&!restoredSelection&&target.before.width===target.after.width&&target.before.height===target.after.height)this.deselectedSelection=structuredClone(this.selection)
      this.selection = structuredClone(restoredSelection)
      this.assets = new Map(request.direction === 'undo' ? target.beforeAssets : target.afterAssets)
      this.revision++; this.record(`${request.direction === 'undo' ? 'Undo' : 'Redo'}: ${target.label}`, source)
      return { status: 'applied', previousRevision, revision: this.revision, transactionId: target.id, undoable: true }
    })
  }
  importPNG(bytes: Buffer, name: string, warnings: string[] = []): EditResult {
    const id = randomUUID().toUpperCase(), file = `${id}.png`, asset = makeAsset(file, bytes,{allow16:true})
    return this.importImageAsset(asset,name,warnings)
  }
  importImageAsset(source:Asset,name:string,warnings:string[]=[]):EditResult {
    const id=randomUUID().toUpperCase(),file=`${id}.${source.hdr?'exr':'png'}`,asset={...source,file}
    const next = structuredClone(this.manifest)
    if (!this.projectPath && !next.layers.length && this.revision === 0) { next.width = asset.width; next.height = asset.height }
    const scale = Math.min(1, next.width / asset.width, next.height / asset.height)
    const width = Math.max(1, asset.width * scale), height = Math.max(1, asset.height * scale)
    next.layers.push({ id, name, imageFile: file, isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal',
      transform: { origin: [(next.width - width) / 2, (next.height - height) / 2], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'High quality' } })
    next.activeLayerID = id
    if(asset.hdr)next.version=13;else if(asset.deep)next.version=12
    validateManifest(next)
    const stagedAssets = new Map(this.assets); stagedAssets.set(file, asset)
    const initialImage=!this.manifest.layers.length&&this.revision===0,initialSources=initialImage?new HistoryBrushSourceStore():undefined;if(initialSources)initialSources.capture({manifest:next,assets:stagedAssets},{sessionId:this.sessionId,revision:this.revision+1,label:'Initial state'},retained=>this.assertAssetBudget(stagedAssets,retained));const result=this.commit(next, `Import ${name}`, 'user', stagedAssets);if(initialSources)this.historySources=initialSources;this.warnings.push(...warnings);return result
  }
  paste(input: unknown, clipboard: LayerClipboard, sourceAssets: Map<string, Asset>, delta?: [number,number], point?:[number,number]): EditResult {
    const request = mutationSchema.omit({ action: true, taskId: true }).parse(input)
    return this.retry(request, () => {
      const next = structuredClone(this.manifest), assets = new Map(this.assets)
      const plan = delta ? altDragPastePlan(next, clipboard.roots, delta, () => randomUUID().toUpperCase()) : pasteLayerClipboard(clipboard,next,{newId:()=>randomUUID().toUpperCase(),point})
      for(const copy of plan.assetCopies){const asset=sourceAssets.get(copy.sourceFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The copied raster is missing.');assets.set(copy.destinationFile,{...asset,file:copy.destinationFile})}
      const sameDocument=clipboard.sourceSessionId===this.sessionId||!!delta,originalRoots=next.layers.filter(layer=>clipboard.roots.includes(layer.id)),top=originalRoots.at(-1)
      if(sameDocument&&top){const roots=new Set(plan.roots);for(const layer of plan.layers)if(roots.has(layer.id))layer.parentID=top.parentID;const index=next.layers.indexOf(top)+1;next.layers.splice(index,0,...plan.layers)}else next.layers.push(...plan.layers);next.activeLayerID=plan.activeLayerId
      const result=this.commit(next,delta?'Duplicate and move layers':'Paste layers','user',assets)
      result.createdIds=plan.idMap;return result
    })
  }
  merge(input: unknown, bytes: Buffer, plan: MergePlan): EditResult {
    const request=mutationSchema.omit({action:true,taskId:true}).parse(input)
    return this.retry(request,()=>{
      assertDeepMergeSupported(this.manifest,this.assets,plan.includedIds)
      const next=structuredClone(this.manifest), assets=new Map(this.assets),id=randomUUID().toUpperCase(),file=`${id}.png`,asset=makeAsset(file,bytes)
      if(!plan.stamp&&plan.includedIds.some(id=>layerProtected(next,id)))throw new EditorError('INVALID_ARGUMENT','The layer is locked. Unlock it before editing.')
      if(asset.width!==next.width||asset.height!==next.height)throw new EditorError('INVALID_ARGUMENT','Merge raster must cover the document canvas.')
      const removed=new Set(plan.stamp?[]:plan.includedIds);next.layers=next.layers.filter(layer=>!removed.has(layer.id))
      for(const layer of next.layers)if(layer.maskSourceID&&removed.has(layer.maskSourceID))layer.maskSourceID=id
      const layer={id,name:plan.name,parentID:plan.parentId??undefined,imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0] as [number,number],size:[next.width,next.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}}
      const index=plan.insertionBeforeId?next.layers.findIndex(layer=>layer.id===plan.insertionBeforeId):next.layers.length
      next.layers.splice(index<0?next.layers.length:index,0,layer);next.activeLayerID=id;assets.set(file,asset)
      return this.commit(next,plan.stamp?'Stamp layers':'Merge layers','user',assets)
    })
  }
  pastePixels(input:unknown,bytes:Buffer,origin?:[number,number]):EditResult{
    const request=mutationSchema.omit({action:true,taskId:true}).parse(input)
    return this.retry(request,()=>{const next=structuredClone(this.manifest),assets=new Map(this.assets),id=randomUUID().toUpperCase(),file=`${id}.png`,asset=makeAsset(file,bytes,{allow16:true}),active=next.layers.find(layer=>layer.id===next.activeLayerID)
      const layer={id,name:`Layer ${next.layers.length+1}`,imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',parentID:active?.isGroup?active.id:active?.parentID,transform:{origin:origin??[Math.floor((next.width-asset.width)/2),Math.floor((next.height-asset.height)/2)] as [number,number],size:[asset.width,asset.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}}
      const index=active?next.layers.indexOf(active)+1:next.layers.length;next.layers.splice(index,0,layer);next.activeLayerID=id;assets.set(file,asset);return this.commit(next,'Paste pixels','user',assets,null)
    })
  }
  contentRaster(input: unknown, bytes: Buffer, metadata: {name:string;layerId?:string;text?:unknown;shape?:unknown;origin?:[number,number];transform?:Transform},source:Activity['source']='user',prepared=false): EditResult {
    const request=prepared?mutationSchema.parse(input):mutationSchema.omit({action:true,taskId:true}).parse(input),taskId=prepared?(request as Mutation).taskId:undefined
    return this.retry(request,()=>{
      if(source==='agent'||taskId)this.tasks.assertWritable(taskId)
      const next=structuredClone(this.manifest),assets=new Map(this.assets),id=metadata.layerId??randomUUID().toUpperCase(),file=`${id}.png`,asset=makeAsset(file,bytes)
      let layer=next.layers.find(layer=>layer.id===id)
      if(metadata.layerId&&layerProtected(next,metadata.layerId,!!metadata.transform))throw new EditorError('INVALID_ARGUMENT','The layer is locked. Unlock it before editing.')
      if(metadata.layerId&&!layer)throw new EditorError('LAYER_NOT_FOUND','The edited layer is missing.')
      if(!layer){layer={id,name:metadata.name,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:metadata.origin??[(next.width-asset.width)/2,(next.height-asset.height)/2],size:[asset.width,asset.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}};next.layers.push(layer)}
      else if(layer.isGroup)throw new EditorError('INVALID_ARGUMENT','A folder cannot contain a raster.')
      const old=layer.imageFile?assets.get(layer.imageFile):undefined
      if(old){if(layer.maskFile&&!layer.maskPlacement)layer.maskPlacement=structuredClone(layer.transform);layer.transform=contentRasterTransform(layer.transform,[old.width,old.height],[asset.width,asset.height],!!(metadata.text as {boxSize?:unknown}|undefined)?.boxSize)}
      if(metadata.transform){if(!metadata.text)throw new EditorError('INVALID_ARGUMENT','Only a text draft supplies an explicit content transform.');layer.transform=transformSchema.parse(metadata.transform)}
      layer.name=metadata.name;layer.imageFile=file;layer.text=metadata.text;layer.shape=metadata.shape;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector');next.activeLayerID=id;assets.set(file,asset)
      const result=this.commit(next,metadata.layerId?'Edit content':'Create content',source,assets);if(taskId)this.tasks.record(taskId,result.revision,result.transactionId);return result
    })
  }
  identity(): Pick<Mutation, 'sessionId' | 'documentId' | 'expectedRevision' | 'idempotencyKey'> {
    return { sessionId: this.sessionId, documentId: this.manifest.documentID, expectedRevision: this.revision, idempotencyKey: randomUUID() }
  }
  historyBrushSource(id:string){const source=this.historySources.selected(this.sessionId);if(!source)throw new EditorError('INVALID_ARGUMENT','Capture a History Brush source before painting.');if(source.id!==id)throw new EditorError('REVISION_CONFLICT','The History Brush source changed. Start a new stroke.');return source}
  retainedAssets(): Asset[] {
    const all = new Set<Asset>()
    for (const assets of [this.assets, ...this.past.flatMap(entry => [entry.beforeAssets, entry.afterAssets]), ...this.future.flatMap(entry => [entry.beforeAssets, entry.afterAssets])]) {
      for (const asset of assets.values()) all.add(asset)
    }
    for(const asset of this.historySources.retainedAssets())all.add(asset)
    return [...all]
  }
}
