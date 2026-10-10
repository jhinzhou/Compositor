<script setup lang="ts">
import { useI18n } from './i18n'
import { translate as translateLocale, type Locale } from '../shared/i18n'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { ArrowDown, ArrowUp, Bandage, Check, ChevronDown, Copy, Crop, Droplet, Eye, EyeOff, Folder, FolderPlus, Hand, Lasso, Layers, Link, Maximize2, MoreVertical, Paintbrush, Pipette, Plus, ScanLine, Sparkles, Square, SquareDashed, SquarePlus, Stamp, Terminal, Trash2, Type, Unlink, WandSparkles, X, ZoomIn, ZoomOut } from '@lucide/vue'
import { BLEND_MODES, MCP_TOOLS, LIMITS, type BatchMutation, type BridgeInfo, type EditAction, type EditorState, type Layer, type RpcResult, type Transform } from '../shared/contracts'
import { assetUrl, CanvasEngine, viewportHalo } from './canvas-engine'
import { planViewportRender, type ViewportRenderPlan } from './viewport-render'
import {maskPlacementAfterTransform} from '../shared/mask-placement'
import CommitInput from './CommitInput.vue'
import EditorToolIcon from './EditorToolIcon.vue'
import CropOverlay from './CropOverlay.vue'
import ImageSizeDialog from './ImageSizeDialog.vue'
import BrushCursor from './BrushCursor.vue'
import GradientOverlay from './GradientOverlay.vue'
import {rasterSelectionOutline,selectionOutline} from '../shared/selection-outline'
import {selectionBoundingBox,createCropRectangle,pixelCropRect,validCropRect,type CropRect} from './crop-geometry'
import ColorPickerPanel from './ColorPickerPanel.vue'
import SelectionTransformOverlay from './SelectionTransformOverlay.vue'
import {floatingCorners,rasterSelectionMatrix,type FloatingCorners} from '../shared/floating-transform'
import {objectSelectionBounds} from '../shared/object-box'
import BlendMenu from './BlendMenu.vue'
import EffectsPanel from './EffectsPanel.vue'
import type {LayerEffects,EffectKind} from '../shared/layer-effects'
import FiltersPanel from './FiltersPanel.vue'
import {FILTER_NAMES,NATIVE_ADJUSTMENT_KINDS,nativeAdjustmentToSpec,type ImageFilter,type ImageFilterKind} from '../shared/image-filters'
import AgentChat, {type AgentChatEntry} from './AgentChat.vue'
import type {ModelConfig,ModelTool} from '../main/model-client'
import LayerActions from './LayerActions.vue'
import MaskPanel from './MaskPanel.vue'
import LayerEffectBadges from './LayerEffectBadges.vue'
import MaskThumbnail from './MaskThumbnail.vue'
import {maskDisplayState,maskBackgroundURL,solidMaskURL,type MaskPreview} from './mask-display'
import ExportAsPanel from './ExportAsPanel.vue'
import ObjectSelectionTools from './ObjectSelectionTools.vue'
import ContentTools, {type ContentEdit} from './ContentTools.vue'
import ContentCanvasOverlay from './ContentCanvasOverlay.vue'
import {setInstalledFontCatalog,type ContentRaster,type TextStyle,type ShapeStyle} from './content-raster'
import {compactStroke} from '../shared/stroke-compaction'
import {resizeLayer,resizeTogether,constrainMove,type ResizeHandle} from '../shared/layer-drag'
import {RasterStrokePreview} from './raster-stroke-preview'
import {contentBoxContains,contentLayerVisible} from './content-interaction'
import WorkspaceOverlays from './WorkspaceOverlays.vue'
import CloneSourceOverlay from './CloneSourceOverlay.vue'
import { cloneStrokeOffset, cloneSamplePoint } from '../shared/clone-source'
import { opacityDigit, type PendingOpacityDigit } from '../shared/opacity-digit'
import CommandPalette from './CommandPalette.vue'
import ShortcutSettings from './ShortcutSettings.vue'
import RawImportPanel from './RawImportPanel.vue'
import PhotoshopImportPanel from './PhotoshopImportPanel.vue'
import type {PhotoshopImportState} from '../main/photoshop-controller'
import { svgToPNG } from './svg-import'
import { rasterToPNG } from './foreign-raster'
import type { FileDesktopAPI } from '../shared/file-experience'
import type { ExternalChange } from '../shared/external-project'
import type { RecentProject } from '../main/file-experience'
import type { ForeignImportState } from '../main/foreign-controller'
import type { RawImportSettings } from '../core/foreign-import'
import {rpcValue} from './rpc-value'
import {TEXT_EDIT_COMMANDS} from './text-edit-commands'
import {commandForKey,loadShortcuts,saveShortcuts,shortcutFor,type WorkspaceCommand,type ShortcutOverrides} from './command-shortcuts'
import {DEFAULT_GRID,snapRect,type GridSettings} from './view-geometry'
import {duplicateSelectionActions,selectionBounds,sharedTransformActions,transformBounds,type MergePlan} from '../core/layer-operations'
import type {ExportOptions,ExportPreview} from '../shared/export-options'
import {smoothStroke,translateSelection,cropRectangle} from '../shared/interaction-geometry'
import {selectionCoverage} from '../shared/selection-coverage'
import {appendSelectionShape} from '../shared/selection-composition'
import type {Selection} from '../shared/pixel-contracts'
import { folderActions } from '../core/grouping'

const { locale, t, tm, setLocale } = useI18n()
type Tool = 'object'|'move'|'hand'|'zoom'|'marquee'|'lasso'|'magic'|'crop'|'brush'|'eraser'|'heal'|'clone'|'smear'|'gradient'|'shape'|'text'|'eyedropper'
const state = ref<EditorState>(), bridge = ref<BridgeInfo>(), selectedId = ref<string>()
const selectedIds = ref<string[]>([])
const draftTransforms = ref<{ id: string; transform: Transform }[]>([])
const selectedRoots = computed(() => {
  const layers = state.value?.manifest.layers ?? []
  return layers.filter(layer => selectedIds.value.includes(layer.id) && !layers.some(parent => parent.id !== layer.id && selectedIds.value.includes(parent.id) && isDescendant(layer.id, parent.id)))
})
function isDescendant(id: string, parentId: string): boolean {
  let current = state.value?.manifest.layers.find(layer => layer.id === id)
  const seen = new Set<string>()
  while (current?.parentID && !seen.has(current.id)) {
    if (current.parentID === parentId) return true
    seen.add(current.id); current = state.value?.manifest.layers.find(layer => layer.id === current!.parentID)
  }
  return false
}
const movingLayers = computed(() => state.value?.manifest.layers.filter(layer => (layer.imageFile&&!layer.isGroup||layer.isGroup&&layer.maskFile) && selectedRoots.value.some(root => root.id === layer.id || isDescendant(layer.id, root.id))) ?? [])
const browserStorage=localStorage
const platform = window.compositor.platform
const documents = computed(() => state.value?.workspace?.documents ?? [])
type DocumentView = { selectedId?: string; selectedIds: string[]; collapsed: string[]; zoom: number; scrollX: number; scrollY: number; panX?:number;panY?:number;tool: Tool; autoSelect: boolean; linked: boolean; showControls: boolean }
const views = new Map<string, DocumentView>()
const collapsedGroups = ref<string[]>([])
let fieldSession: string | undefined
const recoveryInfo = ref<{ entries: { id: string; sessionId: string; title: string; savedAt: string }[]; saveRecovery: { id: string; destination: string; status: string; message?: string }[] }>({ entries: [], saveRecovery: [] })
const recoverable = computed(() => recoveryInfo.value.entries.filter(entry => !documents.value.some(doc => doc.sessionId === entry.sessionId)))
const showRecovery = ref(false)
async function refreshRecovery(): Promise<void> { const result = await request<typeof recoveryInfo.value>('recoveryList'); if (result) recoveryInfo.value = result }
async function restoreDocument(id: string): Promise<void> { await task('recoverDocument', { id }); await refreshRecovery() }
async function discardRecovery(id: string): Promise<void> { await request('discardRecovery', { id }); await refreshRecovery() }
const selected = computed(() => state.value?.manifest.layers.find(layer => layer.id === selectedId.value))
const canvas = ref<HTMLCanvasElement>(), viewport = ref<HTMLElement>(), canvasWrap = ref<HTMLElement>()
const newWidthInput = ref<HTMLInputElement>()
const engine = new CanvasEngine(), thumbnailEngine = new CanvasEngine(), thumbnailCanvas = document.createElement('canvas'), zoom = ref(.55), viewportPlan = ref<ViewportRenderPlan>()
const tool = ref<Tool>('move'), autoSelect = ref(false), showControls = ref(true), linked = ref(true), spacePan = ref(false)
const showZoomEntry=ref(false),zoomPercent=computed({get:()=>Math.round(zoom.value*10000)/100,set:(value:number)=>{if(Number.isFinite(value))zoom.value=Math.max(.001,Math.min(32,value/100))}})
const canvasOnly=ref(false)
const panOffset=ref({x:0,y:0})
async function toggleCanvasOnly():Promise<void>{if(showNew.value||showFilters.value||showEffects.value||showContent.value||showExport.value||showColorRange.value)return;const center={x:(viewSize.value.width/2-canvasOrigin.value.x)/zoom.value,y:(viewSize.value.height/2-canvasOrigin.value.y)/zoom.value};const result=await request<{enabled:boolean}>('setCanvasOnly',{enabled:!canvasOnly.value});if(result){canvasOnly.value=result.enabled;showZoomEntry.value=false;await nextTick();updateViewGeometry();centerView(center)}}
const error = ref<{ message: string; details?: unknown }>(), busy = ref(false), rendering = ref(false), copied = ref(false)
const showNew = ref(true), newWidth = ref(1920), newHeight = ref(1080), showAutomation = ref(false), showPresets = ref(false)
const renamingId = ref<string>(), contextLayer = ref<Layer>(), contextPosition = ref({ x: 0, y: 0 })
const draft = ref<Transform>(), draggedId = ref<string>(), ready = ref(false)
const blendPreview = ref<typeof BLEND_MODES[number]>()
const independentMask=computed(()=>maskTarget.value&&!!selected.value?.maskFile&&selected.value.maskLinked===false&&selectedIds.value.length===1)
const canTransform = computed(() => !showNew.value&&!showDistort.value&&!floatingSelection.value&&(independentMask.value||movingLayers.value.length>0))
const pixelSize = computed(() => ({ width: (state.value?.manifest.width ?? 1) * zoom.value, height: (state.value?.manifest.height ?? 1) * zoom.value }))
const maskDraft=ref<Transform>(),fieldSummary=ref<Transform>()
const commonBounds=computed(()=>state.value?selectionBounds({...state.value.manifest,layers:state.value.manifest.layers.map(layer=>({...layer,transform:draftTransforms.value.find(item=>item.id===layer.id)?.transform??layer.transform}))},selectedIds.value):undefined)
const commonTransform=computed<Transform|undefined>(()=>{const r=commonBounds.value;if(!r)return;return {origin:[r.x,r.y],size:[r.width,r.height],rotation:0,flipX:false,flipY:false,sampling:selected.value?.transform.sampling??'High quality'}})
const sharedTargets=computed(()=>!independentMask.value&&(selectedIds.value.length>1||!!selected.value?.isGroup))
const transform = computed(() => fieldSummary.value??(independentMask.value?(maskDraft.value??selected.value?.maskPlacement??selected.value?.transform):draft.value??(sharedTargets.value?commonTransform.value:draftTransforms.value.find(item=>item.id===selectedId.value)?.transform??selected.value?.transform)))
const scalePercent = computed(() => {
  if(sharedTargets.value)return fieldSummary.value&&fieldTransformBase?fieldSummary.value.size[0]/fieldTransformBase.summary.size[0]*100:100
  if(independentMask.value){const a=state.value?.assets.find(item=>item.file===selected.value?.maskFile);return a&&a.width>1&&transform.value?transform.value.size[0]/a.width*100:100}
  const asset = state.value?.assets.find(item => item.file === selected.value?.imageFile)
  return asset && transform.value ? Math.round(transform.value.size[0] / asset.width * 1000) / 10 : 100
})
const canvasTools: {name:string;icon:unknown;mode:Tool}[] = [
  { name: 'Marquee (M)', mode:'marquee', icon: SquareDashed }, { name: 'Lasso (L)', mode:'lasso', icon: Lasso }, { name: 'Magic (W)', mode:'magic', icon: WandSparkles },
  { name: 'Crop (C)', mode:'crop', icon: Crop }, { name: 'Brush (B) · Eraser (E)', mode:'brush', icon: Paintbrush }, { name: 'Spot Healing Brush (J)', mode:'heal', icon: Bandage },
  { name: 'Clone Stamp (S)', mode:'clone', icon: Stamp }, { name: 'Smear (R)', mode:'smear', icon: Droplet }, { name: 'Gradient (G)', mode:'gradient', icon: ScanLine },
  { name: 'Shape (U)', mode:'shape', icon: Square }, { name: 'Type (T)', mode:'text', icon: Type }, { name: 'Eyedropper (I)', mode:'eyedropper', icon: Pipette }
]
const externalChanges=ref<ExternalChange[]>([]),activeExternal=computed(()=>externalChanges.value.find(change=>change.sessionId===state.value?.sessionId))
async function refreshExternal():Promise<void>{const value=await request<ExternalChange[]>('externalState');if(value)externalChanges.value=value}
async function externalDecision(decision:'reload'|'keep'|'copy'):Promise<void>{if(!state.value)return;if(decision==='reload')await task('externalReload',{expectedRevision:state.value.revision});else if(decision==='keep')await request('externalKeep',{sessionId:state.value.sessionId});else await task('saveCopyDialog');await refreshExternal()}
const recentProjects=ref<RecentProject[]>([]),showRecents=ref(false),dropActive=ref(false)
async function refreshRecent():Promise<void>{const value=await request<RecentProject[]>('recentState');if(value)recentProjects.value=value}
async function openRecent(id:string):Promise<void>{showRecents.value=false;await task('openRecent',{id})}
async function clearRecents():Promise<void>{await request('clearRecents');await refreshRecent()}
function fileDrag(event:DragEvent):void{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dropActive.value=true;event.dataTransfer.dropEffect='copy'}}
async function dropFiles(event:DragEvent):Promise<void>{dropActive.value=false;const files=[...(event.dataTransfer?.files??[])];if(!files.length)return;event.preventDefault();event.stopPropagation();if(busy.value)return;busy.value=true;try{const result=await (window.compositor as FileDesktopAPI).dropFiles(files);if(result.ok)install(result.value);else error.value={message:result.error.message}}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}finally{busy.value=false}}
const photoshop=ref<PhotoshopImportState>({status:'idle'})
async function refreshPhotoshop():Promise<void>{const value=await request<PhotoshopImportState>('photoshopState');if(value)photoshop.value=value}
async function photoshopAction(method:'photoshopConfirm'|'photoshopCancel',id?:string):Promise<void>{await request(method,{id});await refreshPhotoshop()}
const foreign = ref<ForeignImportState>({ status: 'idle' })
let rasterizingSVG: string | undefined
async function refreshForeign(): Promise<void> {
  const value = await request<ForeignImportState>('foreignState'); if (!value) return; foreign.value = value
  if (['svg','raster'].includes(value.kind ?? '') && value.status === 'decoding' && value.id && (value.svg || value.raster) && rasterizingSVG !== value.id) {
    rasterizingSVG = value.id
    try { const png = value.kind === 'svg' ? await svgToPNG(value.svg!) : await rasterToPNG(value.raster!); await request('foreignRasterComplete', { id: value.id, png }) }
    catch (cause) { await request('foreignRasterComplete', { id: value.id, error: cause instanceof Error ? cause.message : String(cause) }) }
    finally { rasterizingSVG = undefined }
  }
}
async function foreignAction(method: string, settings?: RawImportSettings): Promise<void> { await request(method, settings); await refreshForeign() }
const objectBox=ref<[number,number,number,number]>()
watch(()=>state.value?.sessionId,()=>{objectBox.value=undefined})
const showSubjects=ref(false),imageOperations=ref<{id:string;sessionId:string;progress?:{phase:string}}[]>([])
const imageOperation=computed(()=>imageOperations.value.find(job=>job.sessionId===state.value?.sessionId))
async function selectSubject(input:{kind:'subject'|'object'|'remove-background';box?:[number,number,number,number];settings?:{quality:'basic'|'advanced';refineEdges:number;matteContrast:number;shiftEdge:number}}):Promise<void>{if(selected.value)await edit({type:'selection.subject',layerId:selected.value.id,box:input.box,removeBackground:input.kind==='remove-background',operation:selectionOperation.value,sampleAllLayers:true,...subjectSettings.value,...(input.settings?{matteQuality:input.settings.quality,refineEdges:input.settings.refineEdges,matteContrast:input.settings.matteContrast,shiftEdge:input.settings.shiftEdge}:{})})}
const subjectDraft=ref<{request:ReturnType<typeof identity>;action:Extract<EditAction,{type:'selection.subject'}>}>(),subjectPreview=ref<{requestId:number;url:string;state:EditorState;cacheReady:boolean}>(),subjectPreviewBusy=ref(false);let subjectPreviewTimer:ReturnType<typeof setTimeout>|undefined,subjectPreviewGeneration=0
const subjectPreviewScheduler=new RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},{requestId:number;url:string;state:EditorState;cacheReady:boolean}>(async(input,requestId)=>{const result=await window.compositor.request<{requestId:number;url:string;state:EditorState;cacheReady:boolean}>('subjectPreview',{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},value=>{if(subjectDraft.value){subjectPreview.value=value;subjectPreviewBusy.value=false}},cause=>{if(subjectDraft.value){subjectPreviewBusy.value=false;error.value={message:cause instanceof Error?cause.message:String(cause)}}})
function previewSubject(input:{settings:{quality:'basic'|'advanced';refineEdges:number;matteContrast:number;shiftEdge:number}}):void {if(!state.value||!selected.value)return;const settings=input.settings;subjectSettings.value={matteQuality:settings.quality,refineEdges:settings.refineEdges,matteContrast:settings.matteContrast,shiftEdge:settings.shiftEdge};subjectDraft.value??={request:identity(),action:{type:'selection.subject',layerId:selected.value.id,removeBackground:true,operation:'replace',sampleAllLayers:false,...subjectSettings.value}};subjectDraft.value.action={...subjectDraft.value.action,...subjectSettings.value};clearTimeout(subjectPreviewTimer);subjectPreviewBusy.value=true;const generation=++subjectPreviewGeneration;subjectPreviewTimer=setTimeout(()=>{if(generation===subjectPreviewGeneration&&subjectDraft.value)subjectPreviewScheduler.update({request:{...rpcValue(subjectDraft.value.request),action:rpcValue(subjectDraft.value.action)}})},80)}
async function finishSubjectPreview(apply=false):Promise<void>{const draft=subjectDraft.value;if(!draft)return;if(apply){const result=await request('apply',{...rpcValue(draft.request),action:rpcValue(draft.action)});if(!result)return}subjectPreviewScheduler.invalidate();subjectDraft.value=undefined;subjectPreview.value=undefined;subjectPreviewBusy.value=false;subjectPreviewGeneration++;clearTimeout(subjectPreviewTimer);await request('cancelSubjectPreview',{sessionId:draft.request.sessionId})}
watch(showSubjects,value=>{if(!value)void finishSubjectPreview()})
watch(()=>[state.value?.sessionId,state.value?.revision,selectedId.value],()=>{if(subjectDraft.value&&(state.value?.sessionId!==subjectDraft.value.request.sessionId||state.value?.revision!==subjectDraft.value.request.expectedRevision||selectedId.value!==subjectDraft.value.action.layerId))void finishSubjectPreview()})
const showAgent=ref(false),agent=ref<{config?:Omit<ModelConfig,'apiKey'>;configured?:boolean;canUndo?:boolean;previews?:{stage:string;mimeType:string;data:string}[];conversation:AgentChatEntry[];status:'idle'|'running'|'cancelled'|'error';tools:ModelTool[];streamingText?:string;error?:string}>({conversation:[],status:'idle',tools:[]})
async function agentRequest(method:string,params?:unknown):Promise<boolean>{const result=await request<typeof agent.value>(method,params);if(result)agent.value=result;return !!result}
const subjectSettings=ref({matteQuality:'basic' as 'basic'|'advanced',refineEdges:12,matteContrast:25,shiftEdge:0})
const effectTarget=ref<{layerId:string;kind:EffectKind}>(),effectsPanel=ref<InstanceType<typeof EffectsPanel>>()
const showEffects=ref(false),effectsPreview=ref<LayerEffects|null>(),effectsIdentity=ref<ReturnType<typeof identity>>(),effectsLayer=ref<string>(),showDistort=ref(false),distortCorners=ref<[[number,number],[number,number],[number,number],[number,number]]>()
function openEffects():void{if(!selected.value||!state.value)return;effectsIdentity.value=identity();effectsLayer.value=selected.value.id;effectsPreview.value=undefined;showEffects.value=true}
async function commitEffects(effects:LayerEffects|null):Promise<void>{if(effectsIdentity.value&&effectsLayer.value){const result=await request('apply',{...effectsIdentity.value,action:{type:'layer.effects',layerId:effectsLayer.value,effects}});if(result){showEffects.value=false;effectsPreview.value=undefined}}}
type DistortPreview = {requestId:number;url:string;maskUrl?:string;maskPlacement?:Transform;maskWidth?:number;maskHeight?:number;transform:Transform;bounds:{x:number;y:number;width:number;height:number};width:number;height:number}
const distortTarget=ref<'image'|'mask'>('image')
const distortIdentity=ref<ReturnType<typeof identity>>(),distortLayer=ref<string>(),distortPreview=ref<DistortPreview>(),distortBusy=ref(false)
let distortTimer:ReturnType<typeof setTimeout>|undefined,distortRequest=0,distortDrag:{index:number;start:[number,number];zoom:number;point:[number,number];pointerId:number;target:HTMLElement}|undefined
function openDistort():void {
  if(!selected.value||(!selected.value.imageFile&&!independentMask.value)||!state.value||layerTransformDraft.value)return
  distortTarget.value=independentMask.value?'mask':'image';const t=independentMask.value?transform.value!:selected.value.transform,[w,h]=t.size,a=t.rotation*Math.PI/180,cx=t.origin[0]+w/2,cy=t.origin[1]+h/2
  distortIdentity.value=identity();distortLayer.value=selected.value.id;distortPreview.value=undefined
  distortCorners.value=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>[cx+x*Math.cos(a)-y*Math.sin(a),cy+x*Math.sin(a)+y*Math.cos(a)]) as typeof distortCorners.value
  showDistort.value=true
}
function cancelDistort():void { showDistort.value=false;distortPreview.value=undefined;distortRequest++;clearTimeout(distortTimer);distortBusy.value=false;endDistortDrag() }
function scheduleDistortPreview():void {
  clearTimeout(distortTimer)
  if(!showDistort.value||!distortIdentity.value||!distortLayer.value||!distortCorners.value)return
  const requestId=++distortRequest,corners=structuredClone(rpcValue(distortCorners.value)),started=toRaw(distortIdentity.value),layerId=distortLayer.value
  distortBusy.value=true
  distortTimer=setTimeout(async()=>{try{const result=await window.compositor.request<DistortPreview>('distortPreview',{...started,layerId,requestId,corners,trim:false,target:distortTarget.value});if(requestId!==distortRequest||!showDistort.value)return;distortBusy.value=false;if(result.ok)distortPreview.value=result.value;else error.value={message:`${result.error.code}: ${result.error.message}`}}catch(cause){if(requestId===distortRequest&&showDistort.value){distortBusy.value=false;error.value={message:cause instanceof Error?cause.message:String(cause)}}}},120)
}
async function applyDistort():Promise<void> { if(!distortIdentity.value||!distortLayer.value||!distortCorners.value)return;const result=await request('apply',{...distortIdentity.value,action:{type:'layer.distort',layerId:distortLayer.value,corners:structuredClone(rpcValue(distortCorners.value)),trim:false,target:distortTarget.value}});if(result)cancelDistort() }
function startDistortDrag(event:PointerEvent,index:number,captureTarget?:HTMLElement):void { if(event.button!==0||!distortCorners.value)return;const target=captureTarget??event.currentTarget as HTMLElement;distortDrag={index,start:[event.clientX,event.clientY],zoom:zoom.value,point:[...distortCorners.value[index]],pointerId:event.pointerId,target};target.setPointerCapture(event.pointerId);event.preventDefault() }
function moveDistortDrag(event:PointerEvent):void { if(!distortDrag||!distortCorners.value)return;const dx=(event.clientX-distortDrag.start[0])/distortDrag.zoom,dy=(event.clientY-distortDrag.start[1])/distortDrag.zoom;distortCorners.value[distortDrag.index]=[distortDrag.point[0]+(event.shiftKey&&Math.abs(dy)>Math.abs(dx)?0:dx),distortDrag.point[1]+(event.shiftKey&&Math.abs(dx)>=Math.abs(dy)?0:dy)] }
function endDistortDrag():void { if(distortDrag?.target.hasPointerCapture(distortDrag.pointerId))distortDrag.target.releasePointerCapture(distortDrag.pointerId);distortDrag=undefined }
watch(distortCorners,scheduleDistortPreview,{deep:true})
watch(()=>[state.value?.sessionId,state.value?.revision,selectedId.value],()=>{if(showDistort.value&&(state.value?.sessionId!==distortIdentity.value?.sessionId||state.value?.revision!==distortIdentity.value?.expectedRevision||selectedId.value!==distortLayer.value))cancelDistort()})
const showFilters=ref(false),filterKind=ref<ImageFilterKind>('levels'),filterInitial=ref<ImageFilter>(),filterSource=ref(''),filterPreview=ref<{requestId:number;url:string;error?:string}>(),filterIdentity=ref<ReturnType<typeof identity>>(),filterLayerId=ref<string>(),filterAdjustment=ref(false),lastFilter=ref<ImageFilter>()
async function openFilter(kind:ImageFilterKind,adjustment=false):Promise<void>{if(!state.value)return;filterKind.value=kind;filterAdjustment.value=adjustment;filterLayerId.value=selected.value?.id;filterIdentity.value=identity();filterInitial.value=selected.value?.adjustment?nativeAdjustmentToSpec(selected.value.adjustment):undefined;filterSource.value=!adjustment&&selected.value?.imageFile?assetUrl(state.value,selected.value.imageFile):thumbnail.value;filterPreview.value=undefined;showFilters.value=true}
let filterPreviewTicket=0
async function previewFilter(filter:ImageFilter|null,requestId:number):Promise<void>{
 const started=filterIdentity.value;if(!started)return;const ticket=++filterPreviewTicket,source=filterSource.value
 const current=()=>ticket===filterPreviewTicket&&showFilters.value&&filterIdentity.value===started
 if(!filter){filterPreview.value={requestId,url:source};return}
 try{const result=await window.compositor.request<{url:string}>('filterPreview',{...toRaw(started),layerId:filterLayerId.value,filter,adjustment:filterAdjustment.value});if(!current())return;filterPreview.value=result.ok?{requestId,url:result.value.url}:{requestId,url:source,error:`${result.error.code}: ${result.error.message}`}}
 catch(cause){if(current())filterPreview.value={requestId,url:source,error:cause instanceof Error?cause.message:String(cause)}}
}
async function applyFilter(filter:ImageFilter):Promise<void>{if(!filterIdentity.value)return;const action:EditAction=filterAdjustment.value?(selected.value?.adjustment?{type:'adjustment.set',layerId:filterLayerId.value!,filter}:{type:'adjustment.add',filter,name:FILTER_NAMES[filter.kind]}):{type:'layer.filter',layerId:filterLayerId.value!,filter};const result=await request('apply',{...filterIdentity.value,action});if(result){lastFilter.value=filter;showFilters.value=false}}
const showTrim=ref(false),trimOptions=ref({basedOn:'transparent' as 'transparent'|'top-left'|'bottom-right',top:true,bottom:true,left:true,right:true,tolerance:0})
const selectionAmount=ref(8),selectionModify=ref<'expand'|'contract'|'feather'>(),showColorRange=ref(false),colorSoftness=ref(0),colorRangeIncluded=ref<string[]>([]),colorRangeExcluded=ref<string[]>([]),colorRangeInvert=ref(false),colorRangeSampling=ref<'replace'|'include'|'exclude'>('replace')
const colorRangePreview=ref<{requestId:number;url:string;selection:Selection}>(),colorRangePreviewBusy=ref(false);let colorRangeTicket=0,colorRangeTimer:ReturnType<typeof setTimeout>|undefined
function colorRangeAction():Extract<EditAction,{type:'selection.color_range'}>{return {type:'selection.color_range',layerId:selected.value!.id,colors:[foreground.value,...colorRangeIncluded.value].map(c=>color(c).slice(0,3).map(v=>v*255) as [number,number,number]),tolerance:wandTolerance.value,softness:colorSoftness.value,excludeColors:colorRangeExcluded.value.map(c=>color(c).slice(0,3).map(v=>v*255) as [number,number,number]),invert:colorRangeInvert.value,sampleAllLayers:true,antialiased:selectionAA.value,operation:selectionOperation.value}}
const colorRangeScheduler=new RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},{requestId:number;url:string;selection:Selection}>(async(input,requestId)=>{const result=await window.compositor.request<{requestId:number;url:string;selection:Selection}>('selectionRasterPreview',{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},value=>{if(showColorRange.value){colorRangePreview.value=value;colorRangePreviewBusy.value=false}},cause=>{colorRangePreviewBusy.value=false;error.value={message:cause instanceof Error?cause.message:String(cause)}})
function saveShortcutSettings(overrides:ShortcutOverrides):void{saveShortcuts(browserStorage,commands.value,overrides);shortcutOverrides.value=overrides;showShortcuts.value=false;void syncNativeShortcuts()}
async function syncNativeShortcuts():Promise<void>{await request('setShortcuts',Object.fromEntries(commands.value.map(command=>[command.id,shortcutFor(command,shortcutOverrides.value)??''])))}
const showLayerActions=ref(false),canPaste=ref(false),showExport=ref(false),showContent=ref<'text'|'shape'>(),showCanvasSize=ref(false),sizeMode=ref<'canvas'|'image'>('canvas'),sizeWidth=ref(1920),sizeHeight=ref(1080),resolution=ref(72),sizeAnchor=ref('center')
const imageSizeDialog=ref<{commit:()=>void;cancel:()=>void}>()
const showPalette=ref(false),showShortcuts=ref(false),shortcutOverrides=ref<ShortcutOverrides>({})
const rulers=ref(false),gridVisible=ref(false),guidesVisible=ref(true),guidesLocked=ref(false),snapEnabled=ref(true),navigatorVisible=ref(true),grid=ref<GridSettings>({...DEFAULT_GRID}),thumbnail=ref('')
const viewSize=ref({width:0,height:0}),canvasOrigin=ref({x:0,y:0}),exportPreview=ref<ExportPreview>()
const cloneOffset=ref<[number,number]>(),cloneAligned=ref(true),cloneAllLayers=ref(false),healingMode=ref<'content-aware'|'create-texture'|'proximity-match'>('content-aware'),blurRadius=ref(5),smearMode=ref<'liquify'|'blur'|'smudge'>('liquify')
const cloneHover=ref<[number,number]>(),cloneActiveOffset=ref<[number,number]>()
watch(()=>state.value?.sessionId,()=>{cloneOffset.value=undefined;cloneSource.value=undefined;cloneHover.value=undefined;cloneActiveOffset.value=undefined})
const cloneSource=ref<[number,number]>(),retouchMode=ref<'spot-heal'|'heal'|'blur'|'smear'>('spot-heal'),wandTolerance=ref(32),wandContiguous=ref(true),wandSampleSize=ref<'point'|'3x3'|'5x5'>('point'),wandAllLayers=ref(false),selectionAA=ref(true)
const cloneMarker=computed(()=>cloneSamplePoint(cloneSource.value,cloneHover.value,cloneAligned.value,cloneOffset.value,cloneActiveOffset.value))
const toolHint=computed(()=>({gradient:'Drag to draw · Drag ends to adjust · Shift 45° · 1–0 opacity · Enter apply · Escape cancel',crop:'Drag to crop · Enter apply · Escape cancel · Space to pan',brush:'Drag to paint · [ ] size · Shift-[ ] hardness · 1–0 opacity · Escape cancel · Space to pan',eraser:'Drag to erase · [ ] size · Shift-[ ] hardness · 1–0 opacity · Escape cancel · Space to pan',marquee:'Drag a rectangle · Shift add · Alt subtract · Drag inside to move · Ctrl/Cmd+D deselect',lasso:'Drag an outline · Shift add · Alt subtract · Ctrl/Cmd+D deselect',magic:'Click similar colors · Shift add · Alt subtract · Ctrl/Cmd+D deselect',hand:'Drag to pan · Space temporarily activates Hand',zoom:'Click to zoom · Alt-click to zoom out'} as Partial<Record<Tool,string>>)[tool.value]??'Drag to move · Handles to resize · Circle to rotate · 1–0 layer opacity · Space to pan')
let pendingBrushOpacity:PendingOpacityDigit|undefined
watch([tool,selectedId,()=>state.value?.sessionId],()=>{pendingBrushOpacity=undefined})
const foreground=ref('#000000'),background=ref('#ffffff'),brushSize=ref(24),hardness=ref(1),paintOpacity=ref(1),maskTarget=ref(false),ellipseSelection=ref(false),feather=ref(0),radialGradient=ref(false),selectionOperation=ref<'replace'|'add'|'subtract'|'intersect'>('replace')
const smoothing=ref(0),lastBrush=ref<{layerId:string;mask:boolean;point:[number,number]}>(),lassoMode=ref<'freehand'|'polygon'>('freehand'),polygonPoints=ref<[number,number][]>([]),polygonRequest=ref<ReturnType<typeof identity>>(),polygonReady=ref<Promise<boolean>>()
const paletteTarget=ref<'foreground'|'background'>(),paletteSample=ref<string>()
function openPalette(target:'foreground'|'background'):void{paletteSample.value=undefined;paletteTarget.value=target}
function commitPalette(value:string):void{if(paletteTarget.value==='foreground')foreground.value=value;else background.value=value;paletteTarget.value=undefined}
const gradientStyle=ref<'transparent'|'background'>('transparent'),gradientReverse=ref(false),gradientOpacity=ref(1)
const gradientDraft=ref<{request:ReturnType<typeof identity>;layerId:string;target:'image'|'mask';start:[number,number];end:[number,number]}>(),gradientPreview=ref<{url:string;width:number;height:number;requestId:number;transform:Transform;maskPlacement?:Transform;maskUrl?:string;maskWidth?:number;maskHeight?:number}>()
watch([showColorRange,foreground,wandTolerance,colorSoftness,colorRangeExcluded,colorRangeIncluded,colorRangeInvert,selectionOperation,selectionAA,()=>state.value?.revision],()=>{clearTimeout(colorRangeTimer);colorRangeTicket++;if(!showColorRange.value||!state.value||!selected.value){colorRangeScheduler.invalidate();colorRangePreview.value=undefined;colorRangePreviewBusy.value=false;return}const ticket=colorRangeTicket;colorRangePreviewBusy.value=true;colorRangeTimer=setTimeout(()=>{if(ticket===colorRangeTicket&&showColorRange.value)colorRangeScheduler.update({request:{...identity(),action:colorRangeAction()}})},100)},{deep:true})
let gradientTimer:ReturnType<typeof setTimeout>|undefined,gradientTicket=0,gradientRendering=false,gradientDirty=false,gradientFinishing=false
function gradientAction():Extract<EditAction,{type:'layer.gradient'}>|undefined{const draft=gradientDraft.value;if(!draft||Math.hypot(draft.end[0]-draft.start[0],draft.end[1]-draft.start[1])<.5)return;const fg=color(foreground.value),bg=gradientStyle.value==='transparent'?[...fg.slice(0,3),0] as [number,number,number,number]:color(background.value);return {type:'layer.gradient',layerId:draft.layerId,start:toRaw(draft.start),end:toRaw(draft.end),from:gradientReverse.value?bg:fg,to:gradientReverse.value?fg:bg,radial:radialGradient.value,opacity:gradientOpacity.value,target:draft.target}}
function scheduleGradientPreview():void{
 if(!gradientDraft.value||gradientFinishing)return
 gradientDirty=true
 if(gradientTimer||gradientRendering)return
 gradientTimer=setTimeout(async()=>{
  gradientTimer=undefined;const action=gradientAction(),draft=gradientDraft.value;if(!action||!draft||gradientFinishing)return
  gradientDirty=false;gradientRendering=true;const ticket=++gradientTicket
  try{const result=await window.compositor.request<NonNullable<typeof gradientPreview.value>>('gradientPreview',{request:{...toRaw(draft.request),action},requestId:ticket});if(ticket!==gradientTicket||gradientDraft.value!==draft)return;if(result.ok)gradientPreview.value=result.value;else error.value={message:`${result.error.code}: ${result.error.message}`,details:result.error.details}}
  catch(cause){if(ticket===gradientTicket&&gradientDraft.value===draft)error.value={message:cause instanceof Error?cause.message:String(cause)}}
  finally{gradientRendering=false;if(gradientDirty&&!gradientFinishing)scheduleGradientPreview()}
 },40)
}
async function finishGradient(apply=false):Promise<void>{
 const draft=gradientDraft.value;if(!draft||gradientFinishing)return
 gradientFinishing=true;clearTimeout(gradientTimer);gradientTimer=undefined;gradientDirty=false;gradientTicket++
 try{
  if(drag?.mode.startsWith('gradient:'))await pointerUp()
  if(apply){const action=gradientAction();if(!action||!await request('apply',{...toRaw(draft.request),action}))return}
  await request('interaction',{sessionId:draft.request.sessionId,interactionId:draft.request.idempotencyKey,busy:false});if(gradientDraft.value===draft){gradientDraft.value=undefined;gradientPreview.value=undefined}
 }finally{gradientFinishing=false}
}
watch([gradientDraft,gradientStyle,gradientReverse,gradientOpacity,radialGradient,foreground,background],scheduleGradientPreview,{deep:true})
const cropRatio=ref('Free'),cropDraft=ref<{x:number;y:number;width:number;height:number}>(),cropRequest=ref<ReturnType<typeof identity>>()
function cropAspect():number|undefined{if(cropRatio.value==='Original')return state.value?state.value.manifest.width/state.value.manifest.height:undefined;if(cropRatio.value.includes(':')){const [w,h]=cropRatio.value.split(':').map(Number);return w/h}}
type CropView={zoom:number;pan:[number,number];scroll:[number,number]}
const cropViews=new Map<string,{before:CropView;after:CropView}>()
function captureCropView():CropView{return {zoom:zoom.value,pan:[panOffset.value.x,panOffset.value.y],scroll:[viewport.value?.scrollLeft??0,viewport.value?.scrollTop??0]}}
async function restoreCropView(view:CropView):Promise<void>{zoom.value=view.zoom;panOffset.value={x:view.pan[0],y:view.pan[1]};await nextTick();if(viewport.value){viewport.value.scrollLeft=view.scroll[0];viewport.value.scrollTop=view.scroll[1]}updateViewGeometry()}
async function applyCrop():Promise<void>{if(cropDraft.value&&cropRequest.value){const before=captureCropView(),result=await request('apply',{...cropRequest.value,action:{type:'document.crop',...toRaw(cropDraft.value)}});if(result){cropDraft.value=undefined;cropRequest.value=undefined;await nextTick();fit();await nextTick();if(state.value?.undoTransactionId)cropViews.set(state.value.undoTransactionId,{before,after:captureCropView()})}}}
async function finishPolygon(cancel=false):Promise<void>{const captured=polygonRequest.value,points=structuredClone(rpcValue(polygonPoints.value));try{if(captured&&!cancel&&points.length>=3&&await polygonReady.value){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),shape={kind:'polygon' as const,operation:selectionOperation.value,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)] as [number,number,number,number],points,feather:feather.value},selection=appendSelectionShape(toRaw(state.value?.selection),shape,state.value!.manifest.width,state.value!.manifest.height);await request('apply',{...captured,action:{type:'selection.set',selection}})}}finally{if(captured)await request('interaction',{sessionId:captured.sessionId,interactionId:captured.idempotencyKey,busy:false});polygonPoints.value=[];polygonRequest.value=undefined;draftSelection.value=undefined}}
const visibleCrop=computed(()=>tool.value==='crop'&&state.value?(cropDraft.value??{x:0,y:0,width:state.value.manifest.width,height:state.value.manifest.height}):undefined)
const cropWorkspace=computed(()=>({x:-canvasOrigin.value.x/zoom.value,y:-canvasOrigin.value.y/zoom.value,width:viewSize.value.width/zoom.value,height:viewSize.value.height/zoom.value}))
const rasterPoints=ref<[number,number][]>([]),draftSelection=ref<Selection>()
const selectionDisplay=computed(()=>{const f=floatingSelection.value;if(f?.corners&&f.preview?.selection)return f.preview.selection;if(f?.selection){const {origin,size,rotation,flipX,flipY}=f.transform;return {...f.selection,shapes:f.selection.shapes.map(shape=>shape.raster?{...shape,raster:{...shape.raster,transform:{origin,size,rotation,flipX,flipY}}}:shape)}}return draftSelection.value??state.value?.selection})
const outlineResult=computed(()=>{const selection=selectionDisplay.value;if(!selection||!state.value||!(selection.inverted||selection.shapes.length>1||!!selection.feather))return {path:undefined};try{return {path:selectionOutline(toRaw(selection),state.value.manifest.width,state.value.manifest.height)}}catch(cause){return {path:'',error:cause instanceof Error?cause.message:String(cause)}}});const combinedOutline=computed(()=>outlineResult.value.path)
function color(hex:string):[number,number,number,number]{return [parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,1]}
const cropSnap=computed(()=>state.value?{enabled:snapEnabled.value,zoom:zoom.value,document:state.value.manifest,layers:state.value.manifest.layers.filter(layer=>!layer.isGroup).map(layer=>({...transformBounds(layer.transform),id:layer.id,visible:contentLayerVisible(state.value!.manifest.layers,layer.id)})),guides:state.value.manifest.guides,grid:grid.value,gridVisible:gridVisible.value,guidesVisible:guidesVisible.value}:undefined)
let cropOverlayLease:ReturnType<typeof identity>|undefined
async function cropInteraction(active:boolean):Promise<void>{if(active){cropOverlayLease=identity();await request('interaction',{sessionId:cropOverlayLease.sessionId,interactionId:cropOverlayLease.idempotencyKey,busy:true})}else{const lease=cropOverlayLease;cropOverlayLease=undefined;if(lease)await request('interaction',{sessionId:lease.sessionId,interactionId:lease.idempotencyKey,busy:false})}}
function updateCrop(rect:CropRect):void{if(!validCropRect(rect)){error.value={message:'Crop dimensions exceed the supported canvas size.'};return}cropDraft.value=rect;cropRequest.value=cropOverlayLease??identity()}
watch(cropRatio,()=>{const rect=visibleCrop.value,aspect=cropAspect();if(rect&&aspect)updateCrop(pixelCropRect({x:rect.x,y:rect.y+rect.height/2-rect.width/aspect/2,width:rect.width,height:rect.width/aspect}))})
const sampleRingOriginal=ref<string>(),sampleRingActive=ref(false),showSampleRing=ref(true)
function sampleDocumentColor(event:PointerEvent):void{if(!canvas.value||!viewportPlan.value)return;const p=documentPoint(event),ctx=canvas.value.getContext('2d'),r=viewportPlan.value.region;if(!ctx)return;const x=Math.floor((p[0]-r.x)*canvas.value.width/r.width),y=Math.floor((p[1]-r.y)*canvas.value.height/r.height);if(x<0||y<0||x>=canvas.value.width||y>=canvas.value.height)return;const pixel=ctx.getImageData(x,y,1,1).data;foreground.value='#'+[...pixel.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('');brushHover.value=p}
const brushHover=ref<[number,number]>(),cursorSampling=ref(false)
function leaveCanvas():void{brushHover.value=undefined;if(!drag)cloneHover.value=undefined}
type StrokeRasterPreview=NonNullable<typeof gradientPreview.value>
const strokePreview=ref<StrokeRasterPreview>();let strokeScheduler:RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},StrokeRasterPreview>|undefined,strokePreviewOwner:string|undefined
function strokeAction():EditAction|undefined{if(!drag?.request||!drag.layerId||!drag.mode.startsWith('raster:')||!rasterPoints.value.length)return;const mode=drag.mode.slice(7),points=compactStroke(rasterPoints.value.map(p=>[...p] as [number,number]),Math.min(.125,brushSize.value*.005));if(['brush','eraser'].includes(mode))return {type:'layer.paint',layerId:drag.layerId,points,color:color(foreground.value),size:brushSize.value,hardness:hardness.value,smoothing:smoothing.value/zoom.value,opacity:paintOpacity.value,erase:mode==='eraser',target:maskTarget.value?'mask':'image'};if(['heal','clone','smear'].includes(mode))return {type:'layer.retouch',layerId:drag.layerId,kind:mode==='clone'?'clone':mode==='smear'?(smearMode.value==='blur'?'blur':'smear'):retouchMode.value,points,size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,sourceAnchor:cloneSource.value?[...cloneSource.value]:undefined,protectAlpha:false,smoothing:smoothing.value/zoom.value,aligned:cloneAligned.value,sourceOffset:mode==='clone'?cloneActiveOffset.value:undefined,sourceMode:mode==='clone'&&cloneAllLayers.value?'all-layers':'this-layer',healingMode:healingMode.value,smearMode:smearMode.value==='liquify'?'liquify':'smudge',blurRadius:blurRadius.value,target:maskTarget.value?'mask':'image',seed:drag.seed??0}}
function scheduleStrokePreview():void{const action=strokeAction(),current=drag;if(!action||!current?.request)return;if(!strokeScheduler){strokePreviewOwner=current.layerId;strokeScheduler=new RasterStrokePreview(async(input,requestId)=>{const result=await window.compositor.request<StrokeRasterPreview>('strokePreview',{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},preview=>strokePreview.value=preview,cause=>{error.value={message:cause instanceof Error?cause.message:String(cause)}})}strokeScheduler.update({request:{...toRaw(current.request),action}})}
function clearStrokePreview():void{strokeScheduler?.cancel();strokeScheduler=undefined;strokePreview.value=undefined;strokePreviewOwner=undefined}
let switchingTool = false
async function chooseTool(value:Tool):Promise<void>{
 if(switchingTool||busy.value||drag||brushTipDrag)return
 if(tool.value===value){if(value==='shape'||value==='text')showContent.value=value;return}
 switchingTool=true
 try{
  if(contentOnCanvas.value&&value!==tool.value){if(!await contentCanvas.value?.commit())return}
  if(layerTransformDraft.value){await finishLayerTransform(true);if(layerTransformDraft.value)return}
  if(gradientDraft.value){await finishGradient(true);if(gradientDraft.value)return}
  if(polygonRequest.value)await finishPolygon(true)
  cropDraft.value=undefined;cropRequest.value=undefined
  tool.value=value;showContent.value=value==='shape'||value==='text'?value:undefined
  if(value==='crop'&&state.value){cropRatio.value='Free';try{cropDraft.value=selectionBoundingBox(toRaw(state.value.selection),state.value.manifest.width,state.value.manifest.height);cropRequest.value=cropDraft.value?identity():undefined}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
 }finally{switchingTool=false}
}
function updateViewGeometry():void{if(!viewport.value||!canvasWrap.value)return;const v=viewport.value.getBoundingClientRect(),c=canvasWrap.value.getBoundingClientRect();viewSize.value={width:viewport.value.clientWidth,height:viewport.value.clientHeight};canvasOrigin.value={x:c.left-v.left,y:c.top-v.top};void redraw()}
function centerView(point:{x:number;y:number}):void{if(!viewport.value)return;viewport.value.scrollLeft+=canvasOrigin.value.x+point.x*zoom.value-viewSize.value.width/2;viewport.value.scrollTop+=canvasOrigin.value.y+point.y*zoom.value-viewSize.value.height/2;updateViewGeometry()}
async function copyLayers(ids=selectedIds.value,cut=false):Promise<void>{if(!state.value)return;const result=await request('copyLayers',{...identity(),layerIds:ids,cut});if(result)canPaste.value=true}
async function pasteLayers():Promise<void>{if(state.value)await request('pasteLayers',identity())}
async function mergeLayers(plan:MergePlan):Promise<void>{if(state.value)await request('mergeLayers',{...identity(),layerIds:plan.roots,kind:'selected'})}
const fontList=ref<string[]>([])
const contentPreview=ref<{raster:ContentRaster;transform:Transform;layerId?:string;url:string;ticket:number}>();let contentPreviewTicket=0
function previewContent(value:{raster:ContentRaster;transform:Transform;layerId?:string}|undefined):void {if(!value){contentPreview.value=undefined;return}let binary='';for(let i=0;i<value.raster.bytes.length;i+=8192)binary+=String.fromCharCode(...value.raster.bytes.subarray(i,i+8192));contentPreview.value={...value,url:`data:image/png;base64,${btoa(binary)}`,ticket:++contentPreviewTicket}}
const contentTools=ref<InstanceType<typeof ContentTools>>()
async function cycleShapeKind():Promise<void>{if(contentOnCanvas.value){contentCanvas.value?.cancel();await nextTick()}chooseTool('shape');await nextTick();contentTools.value?.cycleKind()}
const contentResetKey=ref(0)
const contentWarnings=ref<string[]>([]),canvasContentEditingLayer=ref<string>()
const contentCanvas=ref<InstanceType<typeof ContentCanvasOverlay>>(),contentOnCanvas=ref(false),canvasContentDraft=ref<{text?:TextStyle;shape?:ShapeStyle;size:[number,number]}>(),contentToolDraft=ref<{text?:TextStyle;shape?:ShapeStyle;size:[number,number]}>(),canvasTextSelection=ref<[number,number]>([0,0]);let contentLease:ReturnType<typeof identity>|undefined
function contentDraftChanged(value:{text?:TextStyle;shape?:ShapeStyle;size:[number,number]}):void{contentToolDraft.value=value;if(contentOnCanvas.value)contentCanvas.value?.updateDraft(value)}
function canvasDraftChanged(value:{text?:TextStyle;shape?:ShapeStyle;size:[number,number];layerId?:string}):void{contentOnCanvas.value=true;canvasContentEditingLayer.value=value.layerId;canvasContentDraft.value=value}
async function canvasContentLease(held:boolean):Promise<void>{if(!held){const lease=contentLease;contentLease=undefined;if(lease)await request('interaction',{sessionId:lease.sessionId,interactionId:lease.idempotencyKey,busy:false});return}contentLease=identity();await request('interaction',{sessionId:contentLease.sessionId,interactionId:contentLease.idempotencyKey,busy:true})}
async function contentRaster(edit:ContentEdit):Promise<boolean>{if(!state.value)return false;const started=edit.request??identity();await canvasContentLease(false);const result=await request('contentRaster',{request:started,bytes:edit.raster.bytes,metadata:{name:edit.name,layerId:edit.layerId,text:edit.raster.text,shape:edit.raster.shape,origin:edit.origin,transform:edit.transform}});if(result)contentWarnings.value=edit.raster.warnings??[];else if(contentOnCanvas.value&&state.value.sessionId===started.sessionId)await canvasContentLease(true);return !!result}

async function previewExport(options:ExportOptions,requestId:number):Promise<void>{if(!state.value)return;const result=await request<ExportPreview>('exportPreview',{sessionId:state.value.sessionId,expectedRevision:state.value.revision,requestId,options});if(result)exportPreview.value=result}
async function exportAs(options:ExportOptions,requestId:number):Promise<void>{if(!state.value)return;await request('exportAsDialog',{sessionId:state.value.sessionId,expectedRevision:state.value.revision,requestId,options})}
function canvasSize(mode:'canvas'|'image'):void{if(!state.value)return;sizeMode.value=mode;sizeWidth.value=state.value.manifest.width;sizeHeight.value=state.value.manifest.height;resolution.value=state.value.manifest.resolution;showCanvasSize.value=true}
async function applyImageSize(options:{width:number;height:number;resolution:number;resample:boolean;sampling:Transform['sampling']}):Promise<void>{if(!state.value)return;if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return;const result=await request('apply',{...identity(),action:{type:'document.image_size',...options}});if(result)showCanvasSize.value=false}
async function applySize():Promise<void>{await edit({type:'document.canvas_size',width:sizeWidth.value,height:sizeHeight.value,anchor:sizeAnchor.value as any});showCanvasSize.value=false}
const rawCommands=computed<WorkspaceCommand[]>(()=>[
 ...TEXT_EDIT_COMMANDS.filter(command=>command.id!=='cancel-draft'),
 {id:'export-psd',title:'Export PSD',category:'File'},{id:'export-psb',title:'Export PSB',category:'File'},{id:'selection-expand',title:'Expand Selection',category:'Select'},{id:'selection-contract',title:'Contract Selection',category:'Select'},{id:'selection-feather',title:'Feather Selection',category:'Select'},{id:'color-range',title:'Color Range',category:'Select',enabled:!!selected.value},
 {id:'subject-tools',title:'Select Subject / Object / Remove Background',category:'Select',enabled:!!selected.value},{id:'content-fill',title:'Content-Aware Fill',category:'Edit',enabled:!!selected.value?.imageFile&&!!state.value?.selection},
 {id:'transform-selection',title:'Free Transform',category:'Transform',shortcut:'Primary+t',enabled:!!selected.value},
 {id:'effects',title:'Layer Effects',category:'Layer',enabled:!!selected.value?.imageFile},{id:'distort',title:'Free Distort',category:'Transform',enabled:!!selected.value},
 {id:'new',title:'New Canvas',category:'File',shortcut:'Primary+n'}, {id:'openDialog',title:'Open Project',category:'File',shortcut:'Primary+o'}, {id:'recent-projects',title:'Recent Projects',category:'File'}, {id:'importDialog',title:'Import Images',category:'File',shortcut:'Primary+i'}, {id:'saveCurrent',title:'Save',category:'File',shortcut:'Primary+s'}, {id:'export-as',title:'Export As',category:'File',shortcut:'Primary+Shift+e'},
 {id:'undo',title:'Undo',category:'Edit',shortcut:'Primary+z',enabled:state.value?.canUndo}, {id:'redo',title:'Redo',category:'Edit',shortcut:'Primary+Shift+z',enabled:state.value?.canRedo},
 {id:'copy-merged',title:'Copy Merged',category:'Edit',shortcut:'Primary+Shift+c',enabled:!!state.value?.manifest.layers.length},
 {id:'copy',title:'Copy Layers',category:'Edit',shortcut:'Primary+c',enabled:!!selectedIds.value.length},{id:'cut',title:'Cut Layers',category:'Edit',shortcut:'Primary+x',enabled:!!selectedIds.value.length},{id:'paste',title:'Paste Layers',category:'Edit',shortcut:'Primary+v',enabled:!!state.value},
 {id:'duplicate',title:'Duplicate Layers',category:'Layer',shortcut:'Primary+j',enabled:!!selectedIds.value.length},{id:'layer-actions',title:'Layer Transform and Merge',category:'Layer'},
 {id:'trim-canvas',title:'Trim Canvas',category:'Image'},
 {id:'canvas-size',title:'Canvas Size',category:'Image'},{id:'image-size',title:'Image Size',category:'Image'}, {id:'rotate-canvas',title:'Rotate Canvas 90° Clockwise',category:'Image'}, {id:'flip-canvas',title:'Flip Canvas Horizontally',category:'Image'},
 {id:'select-all',title:'Select All Pixels',category:'Select',shortcut:'Primary+a'},{id:'deselect',title:'Deselect',category:'Select',shortcut:'Primary+d'},{id:'invert-selection',title:'Invert Selection',category:'Select',shortcut:'Primary+Shift+i'},{id:'fill',title:'Fill Selection',category:'Edit'},
 {id:'canvas-only',title:'Toggle Fullscreen',category:'View',shortcut:'f',enabled:!showNew.value}, {id:'rulers',title:'Toggle Rulers',category:'View',shortcut:'Primary+r'},{id:'grid',title:'Toggle Grid',category:'View'},{id:'guides',title:'Toggle Guides',category:'View'},{id:'lock-guides',title:'Lock Guides',category:'View'},{id:'clear-guides',title:'Clear Guides',category:'View'},{id:'snap',title:'Toggle Snapping',category:'View'},{id:'navigator',title:'Toggle Navigator',category:'View'},{id:'fit',title:'Fit Canvas',category:'View',shortcut:'Primary+0'},{id:'actual',title:'Actual Pixels',category:'View',shortcut:'Primary+1'},
 {id:'tool:object',title:'Object Selection',category:'Tools'},
 ...([{id:'tool:move',title:'Move',shortcut:'v'},{id:'tool:hand',title:'Hand',shortcut:'h'},{id:'tool:zoom',title:'Zoom',shortcut:'z'},{id:'tool:eraser',title:'Eraser',shortcut:'e'},{id:'cycle-tool',title:'Cycle Current Tool',shortcut:'tab'},{id:'cycle-shape',title:'Cycle Shape',shortcut:'Shift+u'},{id:'temporary-hand',title:'Temporary Hand',shortcut:'space'},{id:'swap-colors',title:'Swap Foreground / Background',shortcut:'x'},{id:'reset-colors',title:'Default Colors',shortcut:'d'},{id:'brush-smaller',title:'Smaller Brush',shortcut:'['},{id:'brush-larger',title:'Larger Brush',shortcut:']'},{id:'brush-softer',title:'Softer Brush',shortcut:'Shift+['},{id:'brush-harder',title:'Harder Brush',shortcut:'Shift+]'},{id:'apply-draft',title:'Apply Current Operation',shortcut:'enter'},{id:'cancel-draft',title:'Cancel Current Operation',shortcut:'escape'},{id:'delete',title:'Delete Current Target',shortcut:'backspace'},{id:'delete-forward',title:'Delete Current Target (Forward)',shortcut:'delete'},{id:'blend-next',title:'Next Blend Mode',shortcut:'Shift+='},{id:'blend-previous',title:'Previous Blend Mode',shortcut:'Shift+-'}] as WorkspaceCommand[]).map(command=>({...command,category:'Tools'})),
 ...Array.from({length:10},(_,digit)=>({id:`opacity:${digit}`,title:`Opacity digit ${digit}`,category:'Tools',shortcut:String(digit)})),
 ...(['left','right','up','down'] as const).flatMap(direction=>[{id:`nudge:${direction}`,title:`Nudge ${direction}`,category:'Transform',shortcut:`arrow${direction}`},{id:`nudge-fast:${direction}`,title:`Nudge ${direction} 10px`,category:'Transform',shortcut:`Shift+arrow${direction}`},{id:`nudge-pixels:${direction}`,title:`Move Selected Pixels ${direction}`,category:'Transform',shortcut:`Primary+arrow${direction}`},{id:`nudge-pixels-fast:${direction}`,title:`Move Selected Pixels ${direction} 10px`,category:'Transform',shortcut:`Primary+Shift+arrow${direction}`}]),
 {id:'palette',title:'Search Commands',category:'Help',shortcut:'Primary+f'},{id:'shortcuts',title:'Keyboard Shortcuts',category:'Settings'},
 ...Object.entries(FILTER_NAMES).map(([kind,title])=>({id:`filter:${kind}`,title,category:'Filter',enabled:!!selected.value?.imageFile})),
 ...Object.entries(NATIVE_ADJUSTMENT_KINDS).map(([kind,title])=>({id:`adjustment:${kind}`,title:`New ${title} Adjustment`,category:'Layer'})),
 {id:'repeat-filter',title:'Repeat Last Filter',category:'Filter',enabled:!!lastFilter.value&&!!selected.value?.imageFile},
 ...canvasTools.map(item=>({id:`tool:${item.mode}`,title:item.name,category:'Tools',shortcut:item.name.match(/\(([A-Z])\)/)?.[1].toLowerCase(),enabled:true}))
])
function commandTitle(command: WorkspaceCommand, language: Locale): string {
 const tr=(source:string,params?:Record<string,string|number>)=>translateLocale(language,source,params)
 if(command.id.startsWith('opacity:'))return tr('Opacity digit {digit}',{digit:command.id.split(':')[1]})
 const nudge=command.id.match(/^(nudge|nudge-fast|nudge-pixels|nudge-pixels-fast):(left|right|up|down)$/)
 if(nudge)return tr(nudge[1].includes('pixels')?(nudge[1].endsWith('fast')?'Move Selected Pixels {direction} 10px':'Move Selected Pixels {direction}'):(nudge[1].endsWith('fast')?'Nudge {direction} 10px':'Nudge {direction}'),{direction:tr(nudge[2])})
 if(command.id.startsWith('adjustment:'))return tr('New {name} Adjustment',{name:tr(NATIVE_ADJUSTMENT_KINDS[command.id.slice(11) as keyof typeof NATIVE_ADJUSTMENT_KINDS])})
 return tr(command.title)
}
const commands=computed<WorkspaceCommand[]>(()=>rawCommands.value.map(command=>({...command,title:commandTitle(command,locale.value),category:command.category?t(command.category):undefined,description:command.description?tm(command.description):undefined,keywords:[...(command.keywords??[]),command.title,command.category??'',command.description??'',commandTitle(command,'zh-CN'),command.category?translateLocale('zh-CN',command.category):'']})))
const languageBusy = ref(false)
function languageKeydown(event: KeyboardEvent): void {
  // Keep native button activation; the canvas uses Space for temporary panning.
  if (['Enter', ' '].includes(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation()
}
async function changeLanguage(): Promise<void> {
  if (languageBusy.value) return
  languageBusy.value = true
  try { await setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN') }
  catch(cause) { error.value={message:cause instanceof Error?cause.message:String(cause)} }
  finally { languageBusy.value = false }
}

watch([zoom,showNew],()=>void nextTick(updateViewGeometry))
const rows = computed(() => {
  const result: { layer: Layer; depth: number }[] = []
  const visit = (parent: string | undefined, depth: number): void => {
    for (const layer of state.value?.manifest.layers.filter(layer => layer.parentID === parent).slice().reverse() ?? []) {
      result.push({ layer, depth }); if (layer.isGroup && !collapsedGroups.value.includes(layer.id)) visit(layer.id, depth + 1)
    }
  }
  visit(undefined, 0); return result
})
const maskAlone=ref(false),maskPreview=ref<MaskPreview>(),maskPlacementPreview=ref<Transform>(),maskGrayBackground=ref(solidMaskURL(255))
let maskBackgroundTicket=0
watch(()=>[state.value?.sessionId,selectedId.value,selected.value?.maskFile,state.value?.assets.find(asset=>asset.file===selected.value?.maskFile)?.hash],async(values,previous)=>{const targetChanged=!previous||values[0]!==previous[0]||values[1]!==previous[1];if(targetChanged){maskAlone.value=false;maskTarget.value=false}if(previous&&values.every((value,index)=>value===previous[index]))return;const ticket=++maskBackgroundTicket;maskPreview.value=undefined;maskPlacementPreview.value=undefined;if(!selected.value?.maskFile){maskTarget.value=false;maskAlone.value=false;return}try{const url=await maskBackgroundURL(assetUrl(state.value!,selected.value.maskFile));if(ticket===maskBackgroundTicket)maskGrayBackground.value=url}catch(cause){if(ticket===maskBackgroundTicket)error.value={message:cause instanceof Error?cause.message:String(cause)}}},{flush:'sync'})
function chooseMask():void{maskTarget.value=true;tool.value='move'}
function maskThumbnailClick(layer:Layer,event:MouseEvent):void{
 if(layerTransformDraft.value){void finishLayerTransform(true).then(()=>{if(!layerTransformDraft.value)maskThumbnailClick(layer,event)});return}
 selectedId.value=layer.id;selectedIds.value=[layer.id]
 if(event.metaKey||event.ctrlKey){void edit({type:'selection.from_mask',layerId:layer.id,operation:event.altKey?'subtract':event.shiftKey?'add':'replace'});return}
 if(event.shiftKey){void edit({type:'layer.mask',layerId:layer.id,operation:layer.maskEnabled===false?'enable':'disable'});return}
 chooseMask();if(event.altKey)maskAlone.value=!maskAlone.value
}
function imageThumbnailClick(layer:Layer,event:MouseEvent):void{
 if(layerTransformDraft.value){void finishLayerTransform(true).then(()=>{if(!layerTransformDraft.value)imageThumbnailClick(layer,event)});return}
 selectLayer(layer,event);maskTarget.value=false;maskAlone.value=false;maskPreview.value=undefined;maskPlacementPreview.value=undefined
 if((event.metaKey||event.ctrlKey)&&layer.imageFile)void edit({type:'selection.from_alpha',layerId:layer.id})
}
const soloVisibility=ref<{sessionId:string;layerId:string;values:Record<string,boolean>}>()
async function layerEyeClick(layer:Layer,event:MouseEvent):Promise<void>{
 if(!state.value)return
 if(!event.altKey){soloVisibility.value=undefined;await edit({type:'layer.set_visibility',layerId:layer.id,visible:!layer.isVisible});return}
 const previous=soloVisibility.value
 if(previous?.sessionId===state.value.sessionId&&previous.layerId===layer.id){soloVisibility.value=undefined;await editMany(state.value.manifest.layers.filter(item=>item.id in previous.values).map(item=>({type:'layer.set_visibility' as const,layerId:item.id,visible:previous.values[item.id]})));return}
 soloVisibility.value={sessionId:state.value.sessionId,layerId:layer.id,values:Object.fromEntries(state.value.manifest.layers.map(item=>[item.id,item.isVisible]))}
 await editMany(state.value.manifest.layers.map(item=>({type:'layer.set_visibility' as const,layerId:item.id,visible:item.id===layer.id||isDescendant(layer.id,item.id)||layer.isGroup&&isDescendant(item.id,layer.id)})))
}
type FloatingPreview={pixelsURL:string;clearedURL:string;transform:Transform;width:number;height:number;sourceWidth:number;sourceHeight:number;previewTransform?:Transform;selection?:Selection}
type FloatingSelection=FloatingPreview&{layerId:string;request:ReturnType<typeof identity>;corners?:FloatingCorners;preview?:FloatingPreview;previewBusy?:boolean;previewError?:string}
const floatingSelection=ref<FloatingSelection>()
let floatingPreviewTimer:ReturnType<typeof setTimeout>|undefined,floatingPreviewRequest=0
async function beginSelectionTransform():Promise<void>{if(!state.value?.selection||!selected.value?.imageFile||maskTarget.value||floatingSelection.value)return;const started=identity(),layerId=selected.value.id;const result=await request<FloatingPreview>('selectionTransformDraft',{...started,action:{type:'selection.transform_pixels',layerId,transform:toRaw(selected.value.transform)}});if(result){await request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true});floatingSelection.value={...result,request:started,layerId}}}
function distortFloatingSelection():void {if(floatingSelection.value&&!floatingSelection.value.corners)floatingSelection.value.corners=floatingCorners(toRaw(floatingSelection.value.transform))}
function scheduleFloatingPreview():void {
 clearTimeout(floatingPreviewTimer);const f=floatingSelection.value,token=++floatingPreviewRequest
 if(!f?.corners){if(f){f.preview=undefined;f.previewBusy=false;f.previewError=undefined}return}
 const request={...structuredClone(rpcValue(f.request)),action:{type:'selection.transform_pixels' as const,layerId:f.layerId,transform:structuredClone(rpcValue(f.transform)),corners:structuredClone(rpcValue(f.corners))}}
 f.previewBusy=true;f.previewError=undefined
 floatingPreviewTimer=setTimeout(async()=>{try{const result=await window.compositor.request<FloatingPreview>('selectionTransformDraft',request);if(token!==floatingPreviewRequest||floatingSelection.value!==f)return;f.previewBusy=false;if(result.ok)f.preview=result.value;else f.previewError=result.error.message}catch(cause){if(token===floatingPreviewRequest&&floatingSelection.value===f){f.previewBusy=false;f.previewError=cause instanceof Error?cause.message:String(cause)}}},120)
}
watch(()=>[floatingSelection.value?.corners,floatingSelection.value?.transform.flipX,floatingSelection.value?.transform.flipY,floatingSelection.value?.transform.sampling],scheduleFloatingPreview,{deep:true})
async function endSelectionTransform(apply=false):Promise<void>{const floating=floatingSelection.value;if(!floating)return;if(apply&&!await request('apply',{...toRaw(floating.request),action:{type:'selection.transform_pixels',layerId:floating.layerId,transform:toRaw(floating.transform),corners:floating.corners?structuredClone(rpcValue(floating.corners)):undefined}}))return;floatingPreviewRequest++;clearTimeout(floatingPreviewTimer);await request('interaction',{sessionId:floating.request.sessionId,interactionId:floating.request.idempotencyKey,busy:false});if(floatingSelection.value===floating)floatingSelection.value=undefined}
watch(()=>[state.value?.sessionId,selectedId.value],()=>{if(floatingSelection.value&&(state.value?.sessionId!==floatingSelection.value.request.sessionId||selectedId.value!==floatingSelection.value.layerId))void endSelectionTransform()})
const displayState = computed(() => {
  if (!state.value) return undefined
  if(floatingSelection.value){const f=floatingSelection.value,preview=f.preview,placed=preview?.previewTransform??f.transform,pixelsURL=preview?.pixelsURL??f.pixelsURL,manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(item=>item.id===f.layerId),assets=[...state.value.assets];if(layer){layer.imageFile=f.clearedURL;delete layer.text;delete layer.shape;const at=manifest.layers.indexOf(layer);manifest.layers.splice(at+1,0,{...structuredClone(layer),id:'F0000000-0000-4000-8000-000000000000',name:'Floating Selection',imageFile:pixelsURL,maskFile:undefined,maskSourceID:undefined,effects:undefined,transform:structuredClone(rpcValue(placed))});assets.push({file:f.clearedURL,hash:f.clearedURL,width:f.sourceWidth,height:f.sourceHeight},{file:pixelsURL,hash:pixelsURL,width:preview?.width??f.width,height:preview?.height??f.height})}return {...state.value,manifest,assets}}
  if(strokePreview.value&&strokePreviewOwner){const preview=strokePreview.value,manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(l=>l.id===strokePreviewOwner),assets=[...state.value.assets];if(layer){layer.transform=structuredClone(rpcValue(preview.transform));layer.maskPlacement=preview.maskPlacement;if(maskTarget.value)layer.maskFile=preview.url;else{layer.imageFile=preview.url;delete layer.text;delete layer.shape;if(preview.maskUrl){layer.maskFile=preview.maskUrl;assets.push({file:preview.maskUrl,hash:`stroke-mask-${preview.requestId}`,width:preview.maskWidth!,height:preview.maskHeight!})}}assets.push({file:preview.url,hash:`stroke-${preview.requestId}-${strokePreviewOwner}`,width:preview.width,height:preview.height})}return {...state.value,manifest,assets}}
  if(subjectDraft.value&&subjectPreview.value)return subjectPreview.value.state
  if(gradientDraft.value&&gradientPreview.value){const manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(item=>item.id===gradientDraft.value!.layerId),preview=gradientPreview.value,assets=[...state.value.assets];if(layer){layer.transform=preview.transform;layer.maskPlacement=preview.maskPlacement;if(gradientDraft.value.target==='mask')layer.maskFile=preview.url;else {layer.imageFile=preview.url;delete layer.text;delete layer.shape;if(preview.maskUrl){layer.maskFile=preview.maskUrl;assets.push({file:preview.maskUrl,hash:`gradient-mask-${preview.requestId}`,width:preview.maskWidth!,height:preview.maskHeight!})}}assets.push({file:preview.url,hash:`gradient-${preview.requestId}`,width:preview.width,height:preview.height})}return {...state.value,manifest,assets}}
  if(contentOnCanvas.value&&contentPreview.value){const p=contentPreview.value,manifest=structuredClone(rpcValue(state.value.manifest)),assets=[...state.value.assets];let layer=manifest.layers.find(item=>item.id===p.layerId);if(!layer){layer={id:'F0000000-0000-4000-8000-000000000001',name:'Content Preview',isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',transform:structuredClone(rpcValue(p.transform))};manifest.layers.push(layer)}if(layer.maskFile&&!layer.maskPlacement&&p.layerId)layer.maskPlacement=structuredClone(rpcValue(layer.transform));layer.imageFile=p.url;layer.transform=structuredClone(rpcValue(p.transform));delete layer.text;delete layer.shape;assets.push({file:p.url,hash:`content-${p.ticket}`,width:p.raster.width,height:p.raster.height});return {...state.value,manifest,assets}}
  if(selectedId.value&&(maskAlone.value||maskPreview.value||maskPlacementPreview.value||maskDraft.value))return maskDisplayState(toRaw(state.value),selectedId.value,maskPreview.value&&toRaw(maskPreview.value),(maskDraft.value??maskPlacementPreview.value)&&toRaw((maskDraft.value??maskPlacementPreview.value)!),maskAlone.value,maskGrayBackground.value)
  if(showDistort.value&&distortPreview.value&&distortLayer.value){
    const preview=distortPreview.value,manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(item=>item.id===distortLayer.value),assets=[...state.value.assets]
    if(layer){if(distortTarget.value==='mask'){layer.maskFile=preview.url;layer.maskPlacement=structuredClone(rpcValue(preview.transform))}else{layer.imageFile=preview.url;layer.transform=structuredClone(rpcValue(preview.transform))};assets.push({file:preview.url,hash:`distort-image-${preview.requestId}`,width:preview.width,height:preview.height});if(preview.maskUrl){layer.maskFile=preview.maskUrl;layer.maskPlacement=preview.maskPlacement;assets.push({file:preview.maskUrl,hash:`distort-mask-${preview.requestId}`,width:preview.maskWidth!,height:preview.maskHeight!})}}
    return {...state.value,manifest,assets}
  }
  if(showEffects.value&&effectsLayer.value&&effectsPreview.value!==undefined){const manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(layer=>layer.id===effectsLayer.value);if(layer)layer.effects=effectsPreview.value??undefined;return {...state.value,manifest}}
  if (blendPreview.value && selectedId.value) {
    const manifest = structuredClone(rpcValue(state.value.manifest))
    const layer = manifest.layers.find(item => item.id === selectedId.value)
    if (layer && !layer.isGroup) layer.blendMode = blendPreview.value
    return { ...state.value, manifest }
  }
  if (draftTransforms.value.length) {
    const manifest = structuredClone(rpcValue(state.value.manifest))
    for (const item of draftTransforms.value) { const layer = manifest.layers.find(layer => layer.id === item.id); if(layer){const asset=state.value?.assets.find(asset=>asset.file===layer.maskFile),next=structuredClone(rpcValue(item.transform)),placement=maskPlacementAfterTransform(layer,next,asset?.width===1&&asset.height===1);if(placement)layer.maskPlacement=placement;else delete layer.maskPlacement;layer.transform=next} }
    return { ...state.value, manifest }
  }
  if (!draft.value || !draggedId.value) return state.value
  const manifest = structuredClone(rpcValue(state.value.manifest)), layer = manifest.layers.find(item => item.id === draggedId.value)
  if(layer){const asset=state.value.assets.find(asset=>asset.file===layer.maskFile),next=structuredClone(rpcValue(draft.value)),placement=maskPlacementAfterTransform(layer,next,asset?.width===1&&asset.height===1);if(placement)layer.maskPlacement=placement;else delete layer.maskPlacement;layer.transform=next}
  return { ...state.value, manifest }
})
const bounds = computed(() => {
  if (!canTransform.value || !selected.value?.isVisible || !transform.value) return undefined
  const t = transform.value
  return { left: `${t.origin[0] * zoom.value}px`, top: `${t.origin[1] * zoom.value}px`, width: `${t.size[0] * zoom.value}px`, height: `${t.size[1] * zoom.value}px`, transform: `rotate(${t.rotation}deg)` }
})
const multiBounds = computed(() => selectedIds.value.length > 1 ? (displayState.value?.manifest.layers ?? []).filter(layer => layer.imageFile && movingLayers.value.some(item => item.id === layer.id)).map(layer => ({ id: layer.id, style: { left: `${layer.transform.origin[0] * zoom.value}px`, top: `${layer.transform.origin[1] * zoom.value}px`, width: `${layer.transform.size[0] * zoom.value}px`, height: `${layer.transform.size[1] * zoom.value}px`, transform: `rotate(${layer.transform.rotation}deg)` } })) : [])
const mcpConfig = computed(() => bridge.value ? JSON.stringify({ mcpServers: { compositor: { command: bridge.value.mcpCommand, args: bridge.value.mcpArgs, env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2) : '')
async function request<T = unknown>(method: string, params?: unknown): Promise<T | undefined> {
  try {
    if (method === 'interaction' && typeof params === 'boolean') {
      if (params) fieldSession = state.value?.sessionId
      const sessionId = fieldSession ?? state.value?.sessionId
      if (!sessionId) return undefined
      params = { sessionId, interactionId: 'field', busy: params }
      if (!(params as { busy: boolean }).busy) fieldSession = undefined
    }
    const result: RpcResult<T> = await window.compositor.request<T>(method, rpcValue(params))
    if (!result.ok) { error.value = { message: `${result.error.code}: ${result.error.message}`, details: result.error.details }; return undefined }
    return result.value
  } catch (cause) { error.value = { message: cause instanceof Error ? cause.message : String(cause) }; return undefined }
}
function install(next: EditorState): void {
  if (next.workspace && next.workspace.activeSessionId !== next.sessionId) return
  if (!next.workspace && state.value && next.sessionId !== state.value.sessionId) return
  const changedSession = state.value?.sessionId !== next.sessionId
  if (changedSession && state.value) views.set(state.value.sessionId, { selectedId: selectedId.value, selectedIds: [...selectedIds.value], collapsed: [...collapsedGroups.value], zoom: zoom.value, scrollX: viewport.value?.scrollLeft ?? 0, scrollY: viewport.value?.scrollTop ?? 0, panX:panOffset.value.x,panY:panOffset.value.y,tool: tool.value, autoSelect: autoSelect.value, linked: linked.value, showControls: showControls.value })
  if (next.workspace) for (const id of views.keys()) if (!next.workspace.documents.some(doc => doc.sessionId === id)) views.delete(id)
  const hadLayers = !!state.value?.manifest.layers.length
  if (!changedSession && state.value && next.revision < state.value.revision) return
  const changedActive = state.value?.manifest.activeLayerID !== next.manifest.activeLayerID
  state.value = next
  blendPreview.value = undefined
  collapsedGroups.value = (changedSession ? views.get(next.sessionId)?.collapsed ?? [] : collapsedGroups.value).filter(id => next.manifest.layers.some(layer => layer.id === id && layer.isGroup))
  if (changedSession || changedActive || !next.manifest.layers.some(layer => layer.id === selectedId.value)) selectedId.value = next.manifest.activeLayerID ?? next.manifest.layers.at(-1)?.id
  selectedIds.value = selectedIds.value.filter(id => next.manifest.layers.some(layer => layer.id === id))
  if (changedSession || changedActive || !selectedIds.value.length) selectedIds.value = selectedId.value ? [selectedId.value] : []
  if (changedSession) {
    contentCanvas.value?.cancel();panOffset.value={x:0,y:0}
    const saved = views.get(next.sessionId)
    showNew.value = !next.manifest.layers.length
    renamingId.value = undefined; contextLayer.value = undefined; draft.value = undefined; draggedId.value = undefined; draftTransforms.value = []
    if (saved) {
      selectedId.value = next.manifest.layers.some(layer => layer.id === saved.selectedId) ? saved.selectedId : selectedId.value
      selectedIds.value = saved.selectedIds.filter(id => next.manifest.layers.some(layer => layer.id === id))
      panOffset.value={x:saved.panX??0,y:saved.panY??0};zoom.value = saved.zoom; tool.value = saved.tool; autoSelect.value = saved.autoSelect; linked.value = saved.linked; showControls.value = saved.showControls
      void nextTick(() => { if (viewport.value) { viewport.value.scrollLeft = saved.scrollX; viewport.value.scrollTop = saved.scrollY } })
    } else { tool.value = 'move'; void nextTick(fit) }
  }
  else if (!hadLayers && next.manifest.layers.length && showNew.value) { showNew.value = false; void nextTick(fit) }
}
const layerTransformDraft=ref<{request:ReturnType<typeof identity>;ids:string[];layerId:string;mask:boolean}>()
async function beginLayerTransform():Promise<void>{if(!selected.value||!canTransform.value||layerTransformDraft.value||!state.value)return;await chooseTool('move');const started=identity();layerTransformDraft.value={request:started,ids:[...selectedIds.value],layerId:selected.value.id,mask:independentMask.value};await request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true});if(independentMask.value)maskDraft.value=structuredClone(rpcValue(transform.value!));else draftTransforms.value=movingLayers.value.map(layer=>({id:layer.id,transform:structuredClone(rpcValue(layer.transform))}))}
async function finishLayerTransform(apply=false):Promise<void>{const pending=layerTransformDraft.value;if(!pending)return;if(drag)await pointerUp(!apply);if(apply){const actions:EditAction[]=pending.mask&&maskDraft.value?[{type:'layer.mask_set_placement',layerId:pending.layerId,transform:toRaw(maskDraft.value)}]:draftTransforms.value.map(item=>({type:'layer.set_transform',layerId:item.id,transform:toRaw(item.transform)}));if(actions.length){const result=await request('applyBatch',{...pending.request,actions,label:'Free Transform'});if(!result)return}}layerTransformDraft.value=undefined;draft.value=undefined;draftTransforms.value=[];maskDraft.value=undefined;draggedId.value=undefined;fieldSummary.value=undefined;await request('interaction',{sessionId:pending.request.sessionId,interactionId:pending.request.idempotencyKey,busy:false})}

function identity() { return { sessionId: state.value!.sessionId, documentId: state.value!.manifest.documentID, expectedRevision: state.value!.revision, idempotencyKey: crypto.randomUUID() } }
async function edit(action: EditAction): Promise<void> {
  if (!state.value) return
  if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return
  if ('layerId' in action && action.layerId && selectedIds.value.includes(action.layerId) && selectedRoots.value.length > 1 && ['layer.set_opacity', 'layer.set_blend', 'layer.set_visibility', 'layer.delete', 'layer.duplicate'].includes(action.type)) {
    await editMany(selectedRoots.value.map(layer => ({ ...action, layerId: layer.id } as EditAction)))
  } else await request('apply', { ...identity(), action })
}
async function editMany(actions: BatchMutation['actions'], label?: string): Promise<void> {
  if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return
  if (state.value && actions.length) await request('applyBatch', { ...identity(), actions, label })
}
function selectLayer(layer: Layer, event: MouseEvent): void {
  if(layerTransformDraft.value){void finishLayerTransform(true).then(()=>{if(!layerTransformDraft.value)selectLayer(layer,event)});return}
  if (event.shiftKey && selectedId.value) {
    const order = rows.value.map(row => row.layer.id), a = order.indexOf(selectedId.value), b = order.indexOf(layer.id)
    selectedIds.value = order.slice(Math.min(a, b), Math.max(a, b) + 1)
  } else if (event.metaKey || event.ctrlKey) {
    selectedIds.value = selectedIds.value.includes(layer.id) ? selectedIds.value.filter(id => id !== layer.id) : [...selectedIds.value, layer.id]
  } else selectedIds.value = [layer.id]
  selectedId.value = selectedIds.value.includes(layer.id) ? layer.id : selectedIds.value.at(-1)
  contextLayer.value = undefined
}
function startLayerDrag(layer: Layer, event: DragEvent): void {
  if (!state.value || !event.dataTransfer) return
  if (!selectedIds.value.includes(layer.id)) { selectedIds.value = [layer.id]; selectedId.value = layer.id }
  event.dataTransfer.setData('application/x-compositor-layers', JSON.stringify({ sessionId:state.value.sessionId,documentId:state.value.manifest.documentID,expectedRevision:state.value.revision,layerIds:[...selectedIds.value] }))
  event.dataTransfer.effectAllowed = 'copyMove'
}
let tabDragTimer:ReturnType<typeof setTimeout>|undefined
function leaveDocumentTab():void{clearTimeout(tabDragTimer)}
function hoverDocumentTab(sessionId:string,event:DragEvent):void{if(!event.dataTransfer?.types.includes('application/x-compositor-layers'))return;event.preventDefault();event.dataTransfer.dropEffect='copy';clearTimeout(tabDragTimer);if(state.value?.sessionId!==sessionId)tabDragTimer=setTimeout(()=>void task('switchDocument',{sessionId}),450)}
async function dropDocumentLayers(sessionId:string,event:DragEvent,point?:[number,number]):Promise<void>{
 clearTimeout(tabDragTimer);const raw=event.dataTransfer?.getData('application/x-compositor-layers');if(!raw)return;event.preventDefault();event.stopPropagation()
 try{const payload=JSON.parse(raw) as {sessionId:string;documentId:string;expectedRevision:number;layerIds:string[]};if(payload.sessionId===sessionId)return;const document=documents.value.find(doc=>doc.sessionId===sessionId);if(!document)return;const result=await request<{createdIds?:Record<string,string>}>('transferLayers',{source:{sessionId:payload.sessionId,documentId:payload.documentId,expectedRevision:payload.expectedRevision},request:{sessionId,documentId:document.documentId,expectedRevision:document.revision,idempotencyKey:crypto.randomUUID()},layerIds:payload.layerIds,point});if(result?.createdIds){selectedIds.value=payload.layerIds.map(id=>result.createdIds![id]).filter(Boolean);selectedId.value=selectedIds.value[0]}}
 catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}
}
function startComponentDrag(layer:Layer,event:DragEvent,kind:'mask'|'effect',effect?:EffectKind):void{if(!event.altKey||!event.dataTransfer||!state.value){event.preventDefault();return}event.dataTransfer.setData('application/x-compositor-component',JSON.stringify({sessionId:state.value.sessionId,sourceId:layer.id,kind,effect}));event.dataTransfer.effectAllowed='copy'}
function editLayerEffect(layer:Layer,kind:EffectKind):void{selectedId.value=layer.id;selectedIds.value=[layer.id];effectTarget.value={layerId:layer.id,kind};openEffects()}
async function dropLayers(layer: Layer | undefined, event: DragEvent): Promise<void> {
  const component=event.dataTransfer?.getData('application/x-compositor-component')
  if(component){if(!layer||!state.value)return;try{const payload=JSON.parse(component);if(payload.sessionId!==state.value.sessionId)return;const result=await request('apply',{...identity(),action:payload.kind==='mask'?{type:'layer.copy_mask',layerId:layer.id,sourceId:payload.sourceId}:{type:'layer.copy_effect',layerId:layer.id,sourceId:payload.sourceId,kind:payload.effect}});if(result){selectedId.value=layer.id;selectedIds.value=[layer.id];if(payload.kind==='mask')maskTarget.value=true;else{showEffects.value=false;effectsPreview.value=undefined}}}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}return}
  const raw = event.dataTransfer?.getData('application/x-compositor-layers')
  if (!raw || !state.value) return
  try {
    const payload = JSON.parse(raw) as { sessionId: string; layerIds: string[] }
    if(!Array.isArray(payload.layerIds))return;if(payload.sessionId!==state.value.sessionId){await dropDocumentLayers(state.value.sessionId,event);return}
    let parentId = layer?.parentID ?? null, beforeLayerId: string | null = null
    if (layer) {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect(), fraction = (event.clientY - box.top) / box.height
      if (layer.isGroup && fraction > .25 && fraction < .75) parentId = layer.id
      else if (fraction >= .5) beforeLayerId = layer.id
      else {
        const siblings = state.value.manifest.layers.filter(item => item.parentID === layer.parentID && !payload.layerIds.includes(item.id))
        beforeLayerId = siblings[siblings.findIndex(item => item.id === layer.id) + 1]?.id ?? null
      }
    }
    await editMany([{ type: 'layer.move', layerIds: payload.layerIds, parentId, beforeLayerId }], 'Reorder selected layers')
  } catch (cause) { error.value = { message: cause instanceof Error ? cause.message : String(cause) } }
}

async function history(direction: 'undo' | 'redo'): Promise<void> {
  if(layerTransformDraft.value){await finishLayerTransform();return}
  if(cropDraft.value){cropDraft.value=undefined;cropRequest.value=undefined;return}
  if(gradientDraft.value){if(drag?.mode.startsWith('gradient:'))await pointerUp(true);await finishGradient();return}
  if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return
  if (state.value) {
    const {width,height}=state.value.manifest,view=cropViews.get((direction==='undo'?state.value.undoTransactionId:state.value.redoTransactionId)??'')
    const result=await request('history', { ...identity(), direction, transactionId: direction === 'undo' ? state.value.undoTransactionId : state.value.redoTransactionId })
    if(result&&view)await restoreCropView(direction==='undo'?view.before:view.after);else if(result&&state.value&&(state.value.manifest.width!==width||state.value.manifest.height!==height)){await nextTick();fit()}
  }
}
async function task(method: string, params?: unknown): Promise<EditorState | undefined> {
  if(busy.value||switchingTool)return
  busy.value = true
  try {
    if (drag) await pointerUp(true)
    if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return
    if(layerTransformDraft.value){await finishLayerTransform(true);if(layerTransformDraft.value)return}
  if(gradientDraft.value){await finishGradient(true);if(gradientDraft.value)return}
    if(polygonRequest.value)await finishPolygon(true)
    if(floatingSelection.value){await endSelectionTransform(true);if(floatingSelection.value)return}
    cropDraft.value=undefined;cropRequest.value=undefined
    const result = await request<EditorState>(method, { ...(method === 'recoverDocument' ? {} : { sessionId: state.value?.sessionId }), ...(params as object ?? {}) })
    if (result && 'manifest' in result) { install(result); if (result.manifest.layers.length) showNew.value = false }
    return result
  } finally { busy.value = false }
}
async function create(): Promise<void> {
  const created = await task('create', { width: Number(newWidth.value), height: Number(newHeight.value) })
  if (created) { showNew.value = false; await nextTick(); fit() }
}
function fit(): void {
  if (!viewport.value || !state.value) return
  panOffset.value={x:0,y:0}
  zoom.value = Math.max(.001, Math.min(4, (viewport.value.clientWidth - 96) / state.value.manifest.width, (viewport.value.clientHeight - 96) / state.value.manifest.height))
}
function stepZoom(factor:number,event?:{clientX:number;clientY:number}):void {
 if(!viewport.value||!canvasWrap.value){zoom.value=Math.min(32,Math.max(.001,zoom.value*factor));return}
 const v=viewport.value.getBoundingClientRect(),c=canvasWrap.value.getBoundingClientRect(),screen={x:event?event.clientX-v.left:viewport.value.clientWidth/2,y:event?event.clientY-v.top:viewport.value.clientHeight/2},world={x:(v.left+screen.x-c.left)/zoom.value,y:(v.top+screen.y-c.top)/zoom.value}
 zoom.value=Math.min(32,Math.max(.001,zoom.value*factor));void nextTick(()=>{if(!viewport.value||!canvasWrap.value)return;const moved=canvasWrap.value.getBoundingClientRect(),view=viewport.value.getBoundingClientRect(),dx=moved.left-view.left+world.x*zoom.value-screen.x,dy=moved.top-view.top+world.y*zoom.value-screen.y,oldX=viewport.value.scrollLeft,oldY=viewport.value.scrollTop;viewport.value.scrollLeft+=dx;viewport.value.scrollTop+=dy;panOffset.value={x:panOffset.value.x-dx+viewport.value.scrollLeft-oldX,y:panOffset.value.y-dy+viewport.value.scrollTop-oldY};void nextTick(updateViewGeometry)})
}
type MiddleNavigation={clientX:number;clientY:number;zoom:number;scrollX:number;scrollY:number;panX:number;panY:number;kind:'pan'|'zoom'}
let middleNavigation:MiddleNavigation|undefined
function middleDown(event:MouseEvent):void{
 if(event.button!==1||showNew.value||!viewport.value)return
 middleNavigation={clientX:event.clientX,clientY:event.clientY,zoom:zoom.value,scrollX:viewport.value.scrollLeft,scrollY:viewport.value.scrollTop,panX:panOffset.value.x,panY:panOffset.value.y,kind:event.metaKey||event.ctrlKey?'zoom':'pan'}
 window.addEventListener('mousemove',middleMove);window.addEventListener('mouseup',middleUp);event.preventDefault()
}
function middleMove(event:MouseEvent):void{
 const navigation=middleNavigation;if(!navigation||!viewport.value)return
 if(navigation.kind==='zoom'){const target=Math.max(.001,Math.min(32,navigation.zoom*Math.pow(2,(navigation.clientY-event.clientY)/100)));stepZoom(target/zoom.value,{clientX:navigation.clientX,clientY:navigation.clientY})}
 else{const dx=event.clientX-navigation.clientX,dy=event.clientY-navigation.clientY;viewport.value.scrollLeft=navigation.scrollX-dx;viewport.value.scrollTop=navigation.scrollY-dy;panOffset.value={x:navigation.panX+dx-navigation.scrollX+viewport.value.scrollLeft,y:navigation.panY+dy-navigation.scrollY+viewport.value.scrollTop};void nextTick(updateViewGeometry)}
 event.preventDefault()
}
function middleUp(event?:MouseEvent):void{if(event&&event.button!==1)return;middleNavigation=undefined;window.removeEventListener('mousemove',middleMove);window.removeEventListener('mouseup',middleUp)}
function loseWindowFocus():void{spacePan.value=false;middleUp();void pointerUp(true)}
type TransformField = 'x'|'y'|'width'|'height'|'rotation'|'scale'
let fieldTransformBase:{manifest:EditorState['manifest'];ids:string[];request:ReturnType<typeof identity>;summary:Transform;layerId:string;mask:boolean;shared:boolean}|undefined,fieldCommitting=false
function beginTransformField(active:boolean):void {
  void request('interaction',active)
  if(active&&state.value&&transform.value&&selected.value&&!fieldTransformBase)fieldTransformBase={manifest:structuredClone(rpcValue(displayState.value!.manifest)),ids:[...selectedIds.value],request:layerTransformDraft.value?.request??identity(),summary:structuredClone(rpcValue(transform.value)),layerId:selected.value.id,mask:independentMask.value,shared:sharedTargets.value}
  else if(!active&&!fieldCommitting){fieldTransformBase=undefined;fieldSummary.value=undefined;if(!layerTransformDraft.value){maskDraft.value=undefined;draftTransforms.value=[]}}
}
function fieldActions(key:TransformField,value:number):EditAction[] {
  const base=fieldTransformBase;if(!base||!Number.isFinite(value))return []
  const t=structuredClone(base.summary)
  if(base.shared){
    let operation:Parameters<typeof sharedTransformActions>[2]
    if(key==='x'||key==='y')operation={kind:'translate',dx:key==='x'?value-t.origin[0]:0,dy:key==='y'?value-t.origin[1]:0}
    else if(key==='rotation')operation={kind:'rotate',degrees:value-t.rotation}
    else operation={kind:'scale',factor:key==='scale'?value/100:key==='width'?value/t.size[0]:value/t.size[1],pivot:key==='scale'?undefined:[...t.origin]}
    const actions=sharedTransformActions(base.manifest,base.ids,operation)
    if(operation.kind==='translate')t.origin=[t.origin[0]+operation.dx,t.origin[1]+operation.dy]
    else if(operation.kind==='rotate')t.rotation=value
    else if(operation.kind==='scale'){if(key==='scale')t.origin=[t.origin[0]+t.size[0]*(1-operation.factor)/2,t.origin[1]+t.size[1]*(1-operation.factor)/2];t.size=[t.size[0]*operation.factor,t.size[1]*operation.factor]}
    fieldSummary.value=t;return actions
  }
  if(key==='x')t.origin[0]=value
  else if(key==='y')t.origin[1]=value
  else if(key==='width'){if(linked.value)t.size[1]*=value/t.size[0];t.size[0]=value}
  else if(key==='height'){if(linked.value)t.size[0]*=value/t.size[1];t.size[1]=value}
  else if(key==='scale'){const layer=base.manifest.layers.find(layer=>layer.id===base.layerId),asset=state.value?.assets.find(asset=>asset.file===(base.mask?layer?.maskFile:layer?.imageFile));const width=(asset&&asset.width>1?asset.width:t.size[0])*value/100,height=t.size[1]*width/t.size[0];t.origin=[t.origin[0]+(t.size[0]-width)/2,t.origin[1]+(t.size[1]-height)/2];t.size=[width,height]}
  else t.rotation=value
  fieldSummary.value=t
  return [{type:base.mask?'layer.mask_set_placement':'layer.set_transform',layerId:base.layerId,transform:t}]
}
function previewTransformField(key:TransformField,input:string):void {if(!fieldTransformBase)return;try{const actions=fieldActions(key,Number(input));if(fieldTransformBase.mask){maskDraft.value=fieldSummary.value}else draftTransforms.value=actions.filter((a):a is Extract<EditAction,{type:'layer.set_transform'}>=>a.type==='layer.set_transform').map(a=>({id:a.layerId,transform:a.transform}))}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
async function setTransform(key:TransformField,input:string):Promise<void> {
 if(!canTransform.value)return
 if(!fieldTransformBase)beginTransformField(true)
 const base=fieldTransformBase;if(!base)return
 fieldCommitting=true
 try{const actions=fieldActions(key,Number(input));if(layerTransformDraft.value){if(base.mask)maskDraft.value=fieldSummary.value;else draftTransforms.value=actions.filter((a):a is Extract<EditAction,{type:'layer.set_transform'}>=>a.type==='layer.set_transform').map(a=>({id:a.layerId,transform:a.transform}));return}if(actions.length===1)await request('apply',{...base.request,action:actions[0]});else if(actions.length)await request('applyBatch',{...base.request,actions,label:'Transform selected layers'})}
 catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}
 finally{fieldCommitting=false;fieldTransformBase=undefined;fieldSummary.value=undefined;if(!layerTransformDraft.value){maskDraft.value=undefined;draftTransforms.value=[]};void request('interaction',false)}
}
async function setSampling(sampling:Transform['sampling']):Promise<void> {if(!canTransform.value||!selected.value)return;if(layerTransformDraft.value){if(independentMask.value)maskDraft.value={...toRaw(transform.value!),sampling};else draftTransforms.value=draftTransforms.value.map(item=>({...item,transform:{...item.transform,sampling}}));return}if(independentMask.value)await edit({type:'layer.mask_set_placement',layerId:selected.value.id,transform:{...toRaw(transform.value!),sampling}});else await editMany(movingLayers.value.map(layer=>({type:'layer.set_transform',layerId:layer.id,transform:{...toRaw(layer.transform),sampling}})),'Change layer sampling')}
async function flip(axis:'flipX'|'flipY'):Promise<void> {
 if(!canTransform.value||!state.value||!selected.value)return
 if(layerTransformDraft.value){if(independentMask.value){const t=structuredClone(rpcValue(transform.value!));t[axis]=!t[axis];maskDraft.value=t}else draftTransforms.value=sharedTransformActions(rpcValue(displayState.value!.manifest),selectedIds.value,{kind:'flip',axis:axis==='flipX'?'horizontal':'vertical'}).map(a=>({id:a.layerId,transform:a.transform}));return}
 if(sharedTargets.value){await editMany(sharedTransformActions(state.value.manifest,selectedIds.value,{kind:'flip',axis:axis==='flipX'?'horizontal':'vertical'}),'Flip selected layers');return}
 const t=structuredClone(rpcValue(transform.value!));t[axis]=!t[axis];await edit({type:independentMask.value?'layer.mask_set_placement':'layer.set_transform',layerId:selected.value.id,transform:t})
}
async function copyConfig(): Promise<void> {
  try { await navigator.clipboard.writeText(mcpConfig.value); copied.value = true; setTimeout(() => copied.value = false, 1800) }
  catch { error.value = { message: 'Select and copy the configuration below.' } }
}
function openContext(layer: Layer, event: MouseEvent): void {
  if(layerTransformDraft.value){void finishLayerTransform(true).then(()=>{if(!layerTransformDraft.value)openContext(layer,event)});return}
  if (!selectedIds.value.includes(layer.id)) selectedIds.value = [layer.id]
  selectedId.value = layer.id; contextLayer.value = layer
  contextPosition.value = { x: Math.min(event.clientX, innerWidth - 210), y: Math.min(event.clientY, innerHeight - 245) }
}
function hitLayer(event: PointerEvent): void {
  if (!canvasWrap.value || !state.value) return
  const box = canvasWrap.value.getBoundingClientRect(), x = (event.clientX - box.left) / zoom.value, y = (event.clientY - box.top) / zoom.value
  const hit = engine.hitTest(state.value, x, y)
  if((event.metaKey||event.ctrlKey)&&event.shiftKey){if(hit)selectedIds.value=selectedIds.value.includes(hit)?selectedIds.value.filter(id=>id!==hit):[...selectedIds.value,hit];selectedId.value=selectedIds.value.includes(hit??'')?hit:selectedIds.value.at(-1);return}
  if (!hit || !selectedIds.value.includes(hit)) selectedIds.value = hit ? [hit] : []
  selectedId.value = hit

}
type Drag = { startX: number; startY: number; mode: string; transform?: Transform; transforms?: { id: string; transform: Transform }[]; scrollX?: number; scrollY?: number; panX?:number;panY?:number;request?: ReturnType<typeof identity>; layerId?: string; ready: Promise<boolean>; pointerId: number; target: HTMLElement; alt?:boolean; selection?:Selection; operation?:'replace'|'add'|'subtract'|'intersect';shiftAtStart?:boolean;shared?:boolean;mask?:boolean;manifest?:EditorState['manifest'];layerIds?:string[];seed?:number;overflow?:boolean;gradientBefore?:{start:[number,number];end:[number,number]} }
let drag: Drag | undefined
function documentPoint(event:PointerEvent):[number,number]{const box=canvasWrap.value!.getBoundingClientRect();return [(event.clientX-box.left)/zoom.value,(event.clientY-box.top)/zoom.value]}
function updateSelectionDraft():void{if(!drag||!rasterPoints.value.length)return;const points=drag.mode==='raster:lasso'?compactStroke(rasterPoints.value,.125):rasterPoints.value,a=points[0],b=points.at(-1)!,x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.abs(b[0]-a[0]),h=Math.abs(b[1]-a[1]);const kind=drag.mode==='raster:object'?'rectangle':drag.mode==='raster:lasso'?'polygon':ellipseSelection.value?'ellipse':'rectangle';try{draftSelection.value=appendSelectionShape(toRaw(state.value?.selection),{kind,operation:drag.mode==='raster:object'?'replace':drag.operation??'replace',bounds:[x,y,w,h],points:kind==='polygon'&&points.length>=3?points:undefined,feather:drag.mode==='raster:object'?0:feather.value},state.value!.manifest.width,state.value!.manifest.height);draftSelection.value.antialiased=selectionAA.value;draftSelection.value.canvasSize=[state.value!.manifest.width,state.value!.manifest.height]}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
let brushTipDrag:{startX:number;diameter:number;hardness:number;pointerId:number;target:HTMLElement}|undefined
function sampleForeground(event:PointerEvent):void{if(!canvas.value||!viewportPlan.value)return;const p=documentPoint(event),ctx=canvas.value.getContext('2d'),r=viewportPlan.value.region,x=Math.floor((p[0]-r.x)*canvas.value.width/r.width),y=Math.floor((p[1]-r.y)*canvas.value.height/r.height);if(ctx&&x>=0&&y>=0&&x<canvas.value.width&&y<canvas.value.height){const rgba=ctx.getImageData(x,y,1,1).data;foreground.value='#'+[...rgba.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('')}}
function pointerDown(event: PointerEvent, mode = 'move'): void {
  if(event.button===0&&showColorRange.value&&!spacePan.value){const previous=foreground.value;sampleForeground(event);const sampled=foreground.value;if(event.altKey||colorRangeSampling.value==='exclude'){colorRangeExcluded.value.push(sampled);foreground.value=previous}else if(event.shiftKey||colorRangeSampling.value==='include'){colorRangeIncluded.value.push(sampled);foreground.value=previous}event.preventDefault();return}
  if(event.button===2&&['brush','eraser','heal','clone','smear'].includes(tool.value)&&!drag&&!spacePan.value){const target=event.currentTarget as HTMLElement;brushTipDrag={startX:event.clientX,diameter:brushSize.value,hardness:hardness.value,pointerId:event.pointerId,target};target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if (event.button !== 0 || busy.value || switchingTool || !state.value || !viewport.value || drag || showDistort.value&&!spacePan.value&&tool.value!=='hand') return
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  contextLayer.value = undefined
  if(['nw','ne','se','sw'].includes(mode)&&(event.metaKey||event.ctrlKey)&&(selected.value?.imageFile||independentMask.value)&&!sharedTargets.value&&(!maskTarget.value||independentMask.value)&&canvasWrap.value){openDistort();if(showDistort.value)startDistortDrag(event,['nw','ne','se','sw'].indexOf(mode),canvasWrap.value);return}
  if(paletteTarget.value&&canvas.value&&viewportPlan.value){const p=documentPoint(event),r=viewportPlan.value.region,ctx=canvas.value.getContext('2d'),x=Math.floor((p[0]-r.x)*canvas.value.width/r.width),y=Math.floor((p[1]-r.y)*canvas.value.height/r.height);if(ctx&&x>=0&&y>=0&&x<canvas.value.width&&y<canvas.value.height){const rgba=ctx.getImageData(x,y,1,1).data;paletteSample.value='#'+[...rgba.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('')}event.preventDefault();return}
  if((tool.value==='text'||tool.value==='shape')&&!spacePan.value){if(contentOnCanvas.value){event.preventDefault();void contentCanvas.value?.commit();return}showContent.value=tool.value;let existing:Layer|undefined;if(tool.value==='text'){const point=documentPoint(event),hit=engine.hitTest(state.value,point[0],point[1]);existing=state.value.manifest.layers.find(layer=>layer.id===hit&&layer.text)??[...state.value.manifest.layers].reverse().find(layer=>contentLayerVisible(state.value!.manifest.layers,layer.id)&&layer.text&&contentBoxContains(layer.transform,point));if(existing){selectedId.value=existing.id;selectedIds.value=[existing.id]}}contentCanvas.value?.start(event,tool.value,documentPoint,identity(),existing,contentToolDraft.value);return}
  if(tool.value==='magic'&&!spacePan.value&&selected.value){void edit({type:'selection.wand',layerId:selected.value.id,point:documentPoint(event),tolerance:wandTolerance.value,contiguous:wandContiguous.value,sampleSize:wandSampleSize.value,sampleAllLayers:wandAllLayers.value,antialiased:selectionAA.value,operation:event.shiftKey?'add':event.altKey?'subtract':selectionOperation.value});return}
  if(!spacePan.value&&(tool.value==='clone'||tool.value==='heal'&&retouchMode.value==='heal')&&event.altKey){cloneSource.value=documentPoint(event);cloneHover.value=cloneSource.value;cloneOffset.value=undefined;cloneActiveOffset.value=undefined;return}
  if(!spacePan.value&&['brush','eraser','heal','smear'].includes(tool.value)&&event.altKey&&!(tool.value==='heal'&&retouchMode.value==='heal')){sampleForeground(event);event.preventDefault();return}
  if(tool.value==='eyedropper'&&!spacePan.value&&canvas.value&&viewportPlan.value){sampleRingOriginal.value=foreground.value;sampleRingActive.value=true;sampleDocumentColor(event);const target=event.currentTarget as HTMLElement;target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if (tool.value === 'zoom'&&!spacePan.value) { stepZoom(event.altKey ? 1 / 1.2 : 1.2,event); return }
  const target = event.currentTarget as HTMLElement
  if(tool.value==='gradient'&&!spacePan.value&&selected.value){
    const point=documentPoint(event),existing=gradientDraft.value,started=existing?.request??identity(),before=existing?{start:[...existing.start] as [number,number],end:[...existing.end] as [number,number]}:undefined
    const endpoint=mode==='gradient-start'?'start':'end'
    if(!existing){gradientDraft.value={request:started,layerId:selected.value.id,target:maskTarget.value?'mask':'image',start:point,end:point};gradientPreview.value=undefined}
    else if(!mode.startsWith('gradient-')){existing.start=point;existing.end=point}
    drag={startX:event.clientX,startY:event.clientY,mode:`gradient:${endpoint}`,request:started,layerId:selected.value.id,pointerId:event.pointerId,target,gradientBefore:before,ready:request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true}).then(value=>!!value&&state.value?.revision===started.expectedRevision)}
    target.setPointerCapture(event.pointerId);event.preventDefault();return
  }
  if(tool.value==='lasso'&&lassoMode.value==='polygon'&&!spacePan.value){if(!polygonRequest.value){polygonRequest.value=identity();const captured=polygonRequest.value;polygonReady.value=request('interaction',{sessionId:captured.sessionId,interactionId:captured.idempotencyKey,busy:true}).then(value=>!!value&&state.value?.revision===captured.expectedRevision)}polygonPoints.value.push(documentPoint(event));if(event.detail>=2)void finishPolygon();event.preventDefault();return}
  if(!spacePan.value&&['marquee','lasso','magic'].includes(tool.value)&&state.value.selection&&!event.shiftKey&&!event.altKey&&selectionCoverage(state.value.selection,...documentPoint(event))>0){const started=identity();drag={startX:event.clientX,startY:event.clientY,mode:'selection-move',request:started,selection:structuredClone(rpcValue(state.value.selection)),pointerId:event.pointerId,target,ready:request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true}).then(value=>!!value)};target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if(['object','marquee','lasso','crop','brush','eraser','gradient','heal','clone','smear'].includes(tool.value)&&!spacePan.value){
    if(['brush','eraser','gradient','heal','clone','smear'].includes(tool.value)&&!selected.value)return
    if(tool.value==='object'&&(!selected.value||maskTarget.value||imageOperation.value))return
    if(tool.value==='clone'){if(maskTarget.value){error.value={message:'Clone Stamp works on image pixels. Select the image thumbnail to paint.'};return}if(!cloneSource.value){error.value={message:'Alt-click an image to choose the Clone Stamp source.'};return}cloneHover.value=documentPoint(event);cloneActiveOffset.value=cloneStrokeOffset(cloneSource.value,cloneHover.value,cloneAligned.value,cloneOffset.value)}
    const started=identity(),point=documentPoint(event);rasterPoints.value=event.shiftKey&&['brush','eraser'].includes(tool.value)&&!!lastBrush.value&&lastBrush.value.layerId===selectedId.value&&lastBrush.value.mask===maskTarget.value?[lastBrush.value.point,point]:[point];if(tool.value==='crop'){cropDraft.value=undefined;cropRequest.value=undefined}
    drag={startX:event.clientX,startY:event.clientY,mode:`raster:${tool.value}`,request:started,layerId:selectedId.value,seed:Math.floor(Math.random()*0x100000000),pointerId:event.pointerId,target,operation:event.shiftKey?'add':event.altKey?'subtract':selectionOperation.value,shiftAtStart:event.shiftKey,ready:request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true}).then(result=>!!result&&state.value?.revision===started.expectedRevision)}
    if(['object','marquee','lasso'].includes(tool.value))updateSelectionDraft();else scheduleStrokePreview()
  } else if (tool.value === 'hand' || spacePan.value) {
    drag = { startX: event.clientX, startY: event.clientY, scrollX: viewport.value.scrollLeft, scrollY: viewport.value.scrollTop, panX:panOffset.value.x,panY:panOffset.value.y,mode: 'pan', ready: Promise.resolve(true), pointerId: event.pointerId, target }
  } else {
    if (mode === 'move' && !maskTarget.value && (event.shiftKey&&(event.metaKey||event.ctrlKey)||autoSelect.value !== (event.metaKey||event.ctrlKey))) hitLayer(event)
    if (!canTransform.value) return
    const started = layerTransformDraft.value?.request??identity(),effectiveLayers=displayState.value?.manifest.layers??state.value.manifest.layers, transforms = independentMask.value?[{id:selected.value!.id,transform:structuredClone(rpcValue(transform.value!))}]:movingLayers.value.map(base=>effectiveLayers.find(layer=>layer.id===base.id)??base).map(layer => ({ id: layer.id, transform: structuredClone(rpcValue(layer.transform)) })), primary = transforms.find(item => item.id === selectedId.value) ?? transforms[0], t = sharedTargets.value?structuredClone(rpcValue(commonTransform.value!)):primary.transform
    drag = { startX: event.clientX, startY: event.clientY, transform: t, transforms, request: started, layerId: primary.id, mode, shared:sharedTargets.value,mask:independentMask.value,manifest:structuredClone(rpcValue(displayState.value!.manifest)),layerIds:[...selectedIds.value],alt:event.altKey, pointerId: event.pointerId, target,
      ready: request('interaction', { sessionId: started.sessionId, interactionId: started.idempotencyKey, busy: true }).then(result => !!result && state.value?.revision === started.expectedRevision) }
    draggedId.value = primary.id; draft.value = structuredClone(t);if(independentMask.value)maskDraft.value=structuredClone(t);else if(sharedTargets.value)draftTransforms.value=transforms
  }
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function pointerMove(event: PointerEvent): void {
  if(sampleRingActive.value){sampleDocumentColor(event);return}
  if(canvasWrap.value){brushHover.value=documentPoint(event);cursorSampling.value=event.altKey}
  if(brushTipDrag){const tip=brushTipDrag,dx=event.clientX-tip.startX;if(event.shiftKey){hardness.value=Math.max(0,Math.min(1,tip.hardness+dx/200));brushSize.value=tip.diameter}else{brushSize.value=Math.max(1,Math.min(2000,Math.round(tip.diameter+2*dx/zoom.value)));hardness.value=tip.hardness}return}
  if(distortDrag){moveDistortDrag(event);return}
  if(tool.value==='clone'&&canvasWrap.value)cloneHover.value=documentPoint(event)
  if (!drag) return
  if(drag.mode.startsWith('gradient:')&&gradientDraft.value){const endpoint=drag.mode==='gradient:start'?'start':'end',anchor=gradientDraft.value[endpoint==='start'?'end':'start'];let point=documentPoint(event);if(event.shiftKey){const dx=point[0]-anchor[0],dy=point[1]-anchor[1],length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;point=[anchor[0]+Math.cos(angle)*length,anchor[1]+Math.sin(angle)*length]}gradientDraft.value[endpoint]=point;return}
  if(drag.mode==='selection-move'&&drag.selection){draftSelection.value=translateSelection(drag.selection,[Math.round((event.clientX-drag.startX)/zoom.value),Math.round((event.clientY-drag.startY)/zoom.value)]);return}
  if(drag.mode==='raster:object'){const a=rasterPoints.value[0],p=documentPoint(event),dx=p[0]-a[0],dy=p[1]-a[1],side=Math.max(Math.abs(dx),Math.abs(dy));rasterPoints.value=[a,event.shiftKey?[a[0]+(dx<0?-1:1)*side,a[1]+(dy<0?-1:1)*side]:p];updateSelectionDraft();return}
  if(drag.mode==='raster:crop'){const point=documentPoint(event);rasterPoints.value=[rasterPoints.value[0],point];cropDraft.value=createCropRectangle(rasterPoints.value[0],point,cropAspect(),event.altKey,cropSnap.value,event.ctrlKey);return}
  if(drag.mode.startsWith('raster:')){let p=documentPoint(event);if(drag.mode==='raster:marquee'&&event.shiftKey&&!drag.shiftAtStart){const a=rasterPoints.value[0],dx=p[0]-a[0],dy=p[1]-a[1],side=Math.max(Math.abs(dx),Math.abs(dy));p=[a[0]+(dx<0?-1:1)*side,a[1]+(dy<0?-1:1)*side]}if(rasterPoints.value.length>=100000){drag.overflow=true;error.value={message:'This interaction exceeds 100,000 points. The stroke was canceled without changing the image.'};return}rasterPoints.value.push(p);if(rasterPoints.value.length>4096&&rasterPoints.value.length%256===0&&['raster:brush','raster:eraser','raster:heal','raster:clone','raster:smear'].includes(drag.mode))rasterPoints.value=compactStroke(rasterPoints.value,Math.min(.125,brushSize.value*.005));if(['raster:marquee','raster:lasso'].includes(drag.mode))updateSelectionDraft();else scheduleStrokePreview();return}
  if (drag.mode === 'pan' && viewport.value) { const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;viewport.value.scrollLeft=drag.scrollX!-dx;viewport.value.scrollTop=drag.scrollY!-dy;panOffset.value={x:drag.panX!+dx-drag.scrollX!+viewport.value.scrollLeft,y:drag.panY!+dy-drag.scrollY!+viewport.value.scrollTop};void nextTick(updateViewGeometry);return }
  if (!drag.transform || !draft.value) return
  const t = drag.transform;let dx = (event.clientX - drag.startX) / zoom.value, dy = (event.clientY - drag.startY) / zoom.value
  if (drag.mode === 'move') {
    const locked=constrainMove([dx,dy],event.shiftKey);dx=locked[0];dy=locked[1]
    const rect=selectionBounds(state.value!.manifest,selectedIds.value),layers=state.value!.manifest.layers.filter(layer=>!layer.isGroup).map(layer=>({...transformBounds(layer.transform),id:layer.id,visible:contentLayerVisible(state.value!.manifest.layers,layer.id)}))
    if(rect){const snapped=snapRect(rect,{x:dx,y:dy},{enabled:snapEnabled.value&&!event.ctrlKey,zoom:zoom.value,document:state.value!.manifest,layers,movingIds:movingLayers.value.map(layer=>layer.id),guides:state.value!.manifest.guides,grid:grid.value,gridVisible:gridVisible.value,guidesVisible:guidesVisible.value});dx=event.shiftKey&&locked[0]===0?0:snapped.delta.x;dy=event.shiftKey&&locked[1]===0?0:snapped.delta.y}
    draft.value.origin = [t.origin[0] + dx, t.origin[1] + dy]
    draftTransforms.value = drag.transforms?.map(item => ({ id: item.id, transform: { ...item.transform, origin: [item.transform.origin[0] + dx, item.transform.origin[1] + dy] } })) ?? []
  }
  else if (drag.mode === 'rotate' && canvas.value) {
    const box = canvasWrap.value!.getBoundingClientRect(), cx = box.left + (t.origin[0] + t.size[0] / 2) * zoom.value, cy = box.top + (t.origin[1] + t.size[1] / 2) * zoom.value
    let angle = t.rotation + (Math.atan2(event.clientY - cy, event.clientX - cx) - Math.atan2(drag.startY - cy, drag.startX - cx)) * 180 / Math.PI
    if (event.shiftKey) angle = Math.round(angle / 15) * 15
    draft.value.rotation = angle
    if(drag.shared&&drag.manifest&&drag.layerIds)draftTransforms.value=sharedTransformActions(drag.manifest,drag.layerIds,{kind:'rotate',degrees:angle-t.rotation}).map(action=>({id:action.layerId,transform:action.transform}))
  } else {
    const next=resizeLayer(t,drag.mode as ResizeHandle,[dx,dy],drag.shared||linked.value,event.shiftKey,event.altKey);draft.value=next
    if(drag.shared&&drag.manifest&&drag.layerIds){draftTransforms.value=(drag.transforms??[]).map(item=>({id:item.id,transform:resizeTogether(item.transform,t,next)}))}

  }
  if(drag.mask)maskDraft.value=structuredClone(rpcValue(draft.value))
}
async function pointerUp(cancel = false): Promise<void> {
  if(sampleRingActive.value){if(cancel&&sampleRingOriginal.value)foreground.value=sampleRingOriginal.value;sampleRingActive.value=false;return}
  if(brushTipDrag){const tip=brushTipDrag;if(cancel){brushSize.value=tip.diameter;hardness.value=tip.hardness}if(tip.target.hasPointerCapture(tip.pointerId))tip.target.releasePointerCapture(tip.pointerId);brushTipDrag=undefined;return}
  if(distortDrag){endDistortDrag();return}
  const current = drag
  if(current?.overflow)cancel=true
  strokeScheduler?.cancel();strokeScheduler=undefined
  if (!current) return
  drag = undefined
  if(cancel&&current.mode==='raster:crop'){cropDraft.value=undefined;cropRequest.value=undefined}
  try {
    if(current.mode.startsWith('gradient:')){const ready=await current.ready,draft=gradientDraft.value;if(draft){if(cancel||!ready||Math.hypot(draft.end[0]-draft.start[0],draft.end[1]-draft.start[1])<.5){if(current.gradientBefore){draft.start=current.gradientBefore.start;draft.end=current.gradientBefore.end}else{gradientDraft.value=undefined;gradientPreview.value=undefined;clearTimeout(gradientTimer);gradientTimer=undefined;gradientDirty=false;gradientTicket++}}else scheduleGradientPreview()}}
    else if(current.mode==='selection-move'&&await current.ready&&!cancel&&current.request&&draftSelection.value)await request('apply',{...current.request,action:{type:'selection.set',selection:toRaw(draftSelection.value)}})
    else if(current.mode.startsWith('raster:')&&await current.ready&&!cancel&&current.request){
      const mode=current.mode.slice(7),points=compactStroke(rasterPoints.value.map(point=>[point[0],point[1]] as [number,number]),['brush','eraser','heal','clone','smear'].includes(mode)?Math.min(.125,brushSize.value*.005):0),a=points[0],b=points.at(-1)!
      let action:EditAction|undefined
      if(mode==='object'&&current.layerId&&Math.hypot(b[0]-a[0],b[1]-a[1])<3/zoom.value){if(current.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId);await request('interaction',{sessionId:current.request.sessionId,interactionId:current.request.idempotencyKey,busy:false});await request('apply',{...current.request,action:{type:'selection.subject',layerId:current.layerId,point:a,removeBackground:false,operation:current.operation??'replace',sampleAllLayers:wandAllLayers.value,...subjectSettings.value}})}
      else if(mode==='object'&&current.layerId){const box=objectSelectionBounds(a,b,state.value!.manifest);if(box){objectBox.value=box;showSubjects.value=true;if(current.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId);await request('interaction',{sessionId:current.request.sessionId,interactionId:current.request.idempotencyKey,busy:false});await request('apply',{...current.request,action:{type:'selection.subject',layerId:current.layerId,box,removeBackground:false,operation:current.operation??'replace',sampleAllLayers:wandAllLayers.value,...subjectSettings.value}})}}
      else if(['marquee','lasso'].includes(mode)&&draftSelection.value&&(mode!=='lasso'||points.length>=3))action={type:'selection.set',selection:structuredClone(rpcValue(draftSelection.value))}
      else if(mode==='crop'){cropDraft.value??=cropRectangle(a,b,cropAspect());cropRequest.value=current.request}
      else if(['brush','eraser'].includes(mode)&&current.layerId)action={type:'layer.paint',layerId:current.layerId,points,color:color(foreground.value),size:brushSize.value,hardness:hardness.value,smoothing:smoothing.value/zoom.value,opacity:paintOpacity.value,erase:mode==='eraser',target:maskTarget.value?'mask':'image'}
      else if(['heal','clone','smear'].includes(mode)&&current.layerId){const kind=mode==='clone'?'clone':mode==='smear'?(smearMode.value==='blur'?'blur':'smear'):retouchMode.value;const offset=mode==='clone'&&cloneActiveOffset.value?[...cloneActiveOffset.value] as [number,number]:undefined;action={type:'layer.retouch',layerId:current.layerId,kind,points,size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,sourceAnchor:cloneSource.value?[...cloneSource.value] as [number,number]:undefined,protectAlpha:false,smoothing:smoothing.value/zoom.value,aligned:cloneAligned.value,sourceOffset:offset,sourceMode:mode==='clone'&&cloneAllLayers.value?'all-layers':'this-layer',healingMode:healingMode.value,smearMode:smearMode.value==='liquify'?'liquify':'smudge',blurRadius:blurRadius.value,target:maskTarget.value?'mask':'image',seed:current.seed??0}}
      else if(mode==='gradient'&&current.layerId&&Math.hypot(b[0]-a[0],b[1]-a[1])>=.5){gradientDraft.value={request:current.request,layerId:current.layerId,target:maskTarget.value?'mask':'image',start:a,end:b}}
      if(action){const applied=await request('apply',{...current.request,action});if(applied&&action.type==='layer.retouch'&&mode==='clone'&&cloneAligned.value)cloneOffset.value=action.sourceOffset;if(applied&&['brush','eraser'].includes(mode)&&current.layerId)lastBrush.value={layerId:current.layerId,mask:maskTarget.value,point:b}}
    } else if (await current.ready && !cancel && current.request && draft.value && current.layerId) {
      const t = structuredClone(rpcValue(draft.value)); t.origin = t.origin.map(Math.round) as [number, number]; t.size = t.size.map(v => Math.round(v * 100) / 100) as [number, number]
      if(layerTransformDraft.value){if(current.mask)maskDraft.value=t;else if(!current.shared)draftTransforms.value=current.mode==='move'?draftTransforms.value.map(item=>({...item,transform:item.id===current.layerId?t:item.transform})):[{id:current.layerId,transform:t}]}
      else if(current.mask)await request('apply',{...current.request,action:{type:'layer.mask_set_placement',layerId:current.layerId,transform:t}})
      else if(current.alt&&current.mode==='move')await request('duplicateMove',{request:current.request,layerIds:selectedIds.value,delta:[t.origin[0]-current.transform!.origin[0],t.origin[1]-current.transform!.origin[1]]})
      else if(current.shared&&draftTransforms.value.length)await request('applyBatch',{...current.request,actions:draftTransforms.value.map(item=>({type:'layer.set_transform',layerId:item.id,transform:toRaw(item.transform)})),label:'Transform selected layers'})
      else if (current.mode === 'move' && draftTransforms.value.length > 1) await request('applyBatch', { ...current.request, actions: draftTransforms.value.map(item => ({ type: 'layer.set_transform', layerId: item.id, transform: { ...toRaw(item.transform), origin: item.transform.origin.map(Math.round) } })), label: 'Move selected layers' })
      else await request('apply', { ...current.request, action: { type: 'layer.set_transform', layerId: current.layerId, transform: t } })
    }
  } finally {
    clearStrokePreview();if(current.mode==='raster:clone')cloneActiveOffset.value=undefined
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
    if (current.request&&layerTransformDraft.value?.request.idempotencyKey!==current.request.idempotencyKey&&gradientDraft.value?.request.idempotencyKey!==current.request.idempotencyKey) await request('interaction', { sessionId: current.request.sessionId, interactionId: current.request.idempotencyKey, busy: false }); draft.value = undefined;if(!layerTransformDraft.value){maskDraft.value=undefined;draftTransforms.value=[]};draggedId.value = undefined;rasterPoints.value=[];draftSelection.value=undefined
  }
}
let drawing = false, pendingDraw = false, thumbnailState: EditorState | undefined
async function redraw(): Promise<void> {
  pendingDraw = true
  if (drawing) return
  drawing = true; rendering.value = true
  try {
    while (pendingDraw) {
      pendingDraw = false
      if (!canvas.value || !displayState.value || showNew.value) break
      if(!viewport.value||!canvasWrap.value)break
      const current=displayState.value,v=viewport.value.getBoundingClientRect(),c=canvasWrap.value.getBoundingClientRect()
      viewSize.value={width:viewport.value.clientWidth,height:viewport.value.clientHeight};canvasOrigin.value={x:c.left-v.left,y:c.top-v.top}
      const plan=planViewportRender({document:current.manifest,viewport:viewSize.value,origin:canvasOrigin.value,zoom:zoom.value,deviceScale:window.devicePixelRatio,overscan:96+viewportHalo(current)*zoom.value})
      viewportPlan.value=plan
      await engine.draw(canvas.value,current,plan.width,plan.height,plan.region)
      if(thumbnailState!==current){const ratio=Math.min(1,320/Math.max(current.manifest.width,current.manifest.height));await thumbnailEngine.draw(thumbnailCanvas,current,Math.max(1,Math.round(current.manifest.width*ratio)),Math.max(1,Math.round(current.manifest.height*ratio)));thumbnail.value=thumbnailCanvas.toDataURL('image/png');thumbnailState=current}

    }
  } catch (cause) { error.value = { message: cause instanceof Error ? cause.message : String(cause) } }
  finally { drawing = false; rendering.value = false }
}
watch([displayState, showNew], () => void nextTick(redraw), { deep: true })
watch([showNew, ready], async () => { if (showNew.value && ready.value) { await nextTick(); newWidthInput.value?.focus(); newWidthInput.value?.select() } })
function action(name: string): void {
  if(name==='apply-draft'||name==='cancel-draft'){draftAction(name==='apply-draft');return}
  if(name==='cycle-tool'){cycleCurrentTool();return}
  if(name==='cycle-shape'){void cycleShapeKind();return}
  if(name==='temporary-hand'){spacePan.value=true;return}
  if(name==='swap-colors'){[foreground.value,background.value]=[background.value,foreground.value];return}
  if(name==='reset-colors'){foreground.value='#000000';background.value='#ffffff';return}
  if(name.startsWith('opacity:')){setOpacityDigit(Number(name.slice(8)));return}
  if(name.startsWith('nudge')){nudgeQueue=nudgeQueue.then(()=>nudgeTarget(name)).catch(cause=>{error.value={message:cause instanceof Error?cause.message:String(cause)}});return}
  if(name.startsWith('brush-')){if(drag||!['brush','eraser','heal','clone','smear'].includes(tool.value))return;if(name==='brush-smaller'||name==='brush-larger')brushSize.value=Math.max(1,Math.min(2000,name==='brush-larger'?Math.max(brushSize.value+1,Math.round(brushSize.value*1.2)):Math.min(brushSize.value-1,Math.round(brushSize.value/1.2))));else {const quarter=hardness.value*4;hardness.value=Math.max(0,Math.min(4,name==='brush-harder'?Math.floor(quarter+.001)+1:Math.ceil(quarter-.001)-1))/4}return}
  if(name==='blend-next'||name==='blend-previous'){if(selected.value&&!selected.value.isGroup){const index=BLEND_MODES.indexOf(selected.value.blendMode as typeof BLEND_MODES[number]);void edit({type:'layer.set_blend',layerId:selected.value.id,blendMode:BLEND_MODES[(index+(name==='blend-next'?1:BLEND_MODES.length-1))%BLEND_MODES.length]})}return}

  if(name==='imageOperationState'){void request<typeof imageOperations.value>('imageOperationState').then(value=>{if(value)imageOperations.value=value});return}
  if(name==='externalState'){void refreshExternal();return}
  if(name==='recentState'){void refreshRecent();return}
  if(name==='recent-projects'){void refreshRecent();showRecents.value=!showRecents.value;return}
  if(name==='fileOpenError'){void request<string>('fileOpenError').then(message=>{if(message)error.value={message}});return}
  if(name==='photoshopState'){void refreshPhotoshop();return}
  if (name === 'foreignState') { void refreshForeign(); return }
  if(['copy','cut','paste','select-all','undo','redo'].includes(name)&&document.activeElement?.matches('input,textarea,[contenteditable]')){void request('textEdit',{command:name==='select-all'?'selectAll':name});return}
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  if(name==='canvas-only'){void toggleCanvasOnly();return}
  if (name === 'new') void task('newDocument')
  else if (name === 'automation') showAutomation.value = !showAutomation.value
  else if (name === 'fit') fit()
  else if (name === 'actual') zoom.value = 1
  else if (name === 'zoom-in') stepZoom(1.2)
  else if (name === 'zoom-out') stepZoom(1 / 1.2)
  else if (name === 'undo' || name === 'redo') void history(name)
  else if (name === 'blank') void edit({ type: 'layer.add_blank', name: t('Layer {number}',{number:(state.value?.manifest.layers.length ?? 0) + 1}) })
  else if (name === 'folder' && state.value) void editMany(folderActions(state.value.manifest, selectedIds.value), selectedIds.value.length > 1 ? 'Group selected layers' : 'New folder')
  else if (name === 'duplicate' && state.value?.selection)void request('copyClipboard',{...identity(),layerIds:selectedIds.value,duplicate:true})
  else if (name === 'duplicate' && state.value) void editMany(duplicateSelectionActions(state.value.manifest,selectedIds.value),'Duplicate selected layers')
  else if (name === 'ungroup' && selected.value?.isGroup) void editMany(selectedRoots.value.filter(layer => layer.isGroup).map(layer => ({ type: 'group.ungroup', layerId: layer.id })), 'Ungroup layers')
  else if ((name === 'delete'||name==='delete-forward') && selected.value){if(effectTarget.value?.layerId===selected.value.id){const effects={...selected.value.effects as LayerEffects};delete effects[effectTarget.value.kind];void edit({type:'layer.effects',layerId:selected.value.id,effects});effectTarget.value=undefined}else if(state.value?.selection)void edit({type:'layer.clear_selected',layerId:selected.value.id,target:maskTarget.value?'mask':'image'});else if(maskTarget.value&&selected.value.maskFile)void edit({type:'layer.mask',layerId:selected.value.id,operation:'remove'});else void edit({type:'layer.delete',layerId:selected.value.id})}
  else if (name==='copy'||name==='cut'||name==='copy-merged')void request('copyClipboard',{...identity(),layerIds:selectedIds.value,cut:name==='cut',merged:name==='copy-merged',mask:maskTarget.value}).then(result=>{if(result)canPaste.value=true})
    else if (name==='paste')void request('pasteClipboard',identity())
  else if (name==='layer-actions')showLayerActions.value=!showLayerActions.value
  else if (name==='export-as')showExport.value=true
  else if(name==='trim-canvas')showTrim.value=true
  else if (name==='canvas-size')canvasSize('canvas')
  else if (name==='image-size')canvasSize('image')
  else if (name==='rotate-canvas')void edit({type:'document.rotate',clockwise:true})
  else if (name==='flip-canvas')void edit({type:'document.flip',axis:'horizontal'})
  else if (name==='palette')showPalette.value=true
  else if (name==='shortcuts')showShortcuts.value=true
  else if (name==='rulers')rulers.value=!rulers.value
  else if (name==='grid')gridVisible.value=!gridVisible.value
  else if (name==='guides')guidesVisible.value=!guidesVisible.value
  else if (name==='lock-guides')guidesLocked.value=!guidesLocked.value
  else if (name==='clear-guides')void edit({type:'document.guides',guides:[]})
  else if (name==='snap')snapEnabled.value=!snapEnabled.value
  else if (name==='navigator')navigatorVisible.value=!navigatorVisible.value
  else if (name==='deselect')void edit({type:'selection.set',selection:null})
  else if (name==='invert-selection')void edit({type:'selection.invert'})
  else if (name==='select-all'&&state.value)void edit({type:'selection.set',selection:{shapes:[{kind:'rectangle',bounds:[0,0,state.value.manifest.width,state.value.manifest.height],operation:'replace',feather:0}],inverted:false}})
  else if(name==='subject-tools')showSubjects.value=true
  else if(name==='content-fill'&&selected.value)void edit({type:'layer.content_fill',layerId:selected.value.id})
  else if (name==='fill'&&selected.value)void edit({type:'layer.fill',layerId:selected.value.id,color:color(foreground.value),target:maskTarget.value?'mask':'image'})
  else if(name==='export-psd'||name==='export-psb'){if(state.value)void request('photoshopExportDialog',{sessionId:state.value.sessionId,expectedRevision:state.value.revision,psb:name==='export-psb'})}
  else if(name.startsWith('selection-'))selectionModify.value=name.slice(10) as typeof selectionModify.value
  else if(name==='color-range')showColorRange.value=true
  else if(name==='effects')openEffects()
  else if(name==='transform-selection'){if(state.value?.selection&&!maskTarget.value)void beginSelectionTransform();else void beginLayerTransform()}
  else if(name==='distort'){if(floatingSelection.value)distortFloatingSelection();else openDistort()}
  else if(name.startsWith('filter:'))void openFilter(name.slice(7) as ImageFilterKind)
  else if(name.startsWith('adjustment:'))void openFilter(name.slice(11) as ImageFilterKind,true)
  else if(name==='repeat-filter'&&lastFilter.value&&selected.value)void edit({type:'layer.filter',layerId:selected.value.id,filter:toRaw(lastFilter.value)})
  else if(name.startsWith('tool:')){const next=name.slice(5) as Tool;if(tool.value===next)cycleCurrentTool();else void chooseTool(next)}
  else if (name === 'controls') showControls.value = !showControls.value
  else if (['openDialog','importDialog','saveDialog','saveCurrent','saveCopyDialog','exportDialog','closeDocument'].includes(name)) void task(name)
}
let temporaryHandKey:string|undefined
function cycleCurrentTool():void {
 if(tool.value==='marquee')ellipseSelection.value=!ellipseSelection.value
 else if(tool.value==='brush'||tool.value==='eraser')void chooseTool(tool.value==='brush'?'eraser':'brush')
 else if(tool.value==='lasso')lassoMode.value=lassoMode.value==='freehand'?'polygon':'freehand'
 else if(tool.value==='gradient')radialGradient.value=!radialGradient.value
 else if(tool.value==='magic'||tool.value==='object')void chooseTool(tool.value==='magic'?'object':'magic')
 else if(tool.value==='shape')void cycleShapeKind()
 else if(tool.value==='smear')smearMode.value=smearMode.value==='liquify'?'blur':smearMode.value==='blur'?'smudge':'liquify'
 else if(tool.value==='heal')healingMode.value=healingMode.value==='content-aware'?'create-texture':healingMode.value==='create-texture'?'proximity-match':'content-aware'
 else if(tool.value==='clone')cloneAllLayers.value=!cloneAllLayers.value
}
let opacityQueue=Promise.resolve(),nudgeQueue=Promise.resolve()
function setOpacityDigit(digit:number):void {
 const result=opacityDigit(digit,performance.now(),pendingBrushOpacity);pendingBrushOpacity=result.pending
 if(['brush','eraser','heal','clone','smear'].includes(tool.value)){if(!drag)paintOpacity.value=result.value}
 else if(tool.value==='gradient')gradientOpacity.value=result.value
 else if(selected.value){const layerId=selected.value.id;opacityQueue=opacityQueue.then(async()=>{await edit({type:'layer.set_opacity',layerId,opacity:result.value})})}
}
async function nudgeTarget(name:string):Promise<void>{
 if(!state.value||drag||busy.value)return
 const direction=name.split(':')[1],step=name.includes('fast')?10:1,delta:[number,number]=[direction==='left'?-step:direction==='right'?step:0,direction==='up'?-step:direction==='down'?step:0]
 if(name.includes('pixels')&&state.value.selection&&selected.value?.imageFile&&!maskTarget.value){await beginSelectionTransform();if(floatingSelection.value){floatingSelection.value.transform.origin=[floatingSelection.value.transform.origin[0]+delta[0],floatingSelection.value.transform.origin[1]+delta[1]];await endSelectionTransform(true)};return}
 if(['marquee','lasso','magic','object'].includes(tool.value)&&state.value.selection){await edit({type:'selection.translate',delta});return}
 if(!selected.value||!canTransform.value)return
 if(independentMask.value){const t=structuredClone(rpcValue(transform.value!));t.origin=[t.origin[0]+delta[0],t.origin[1]+delta[1]];if(layerTransformDraft.value)maskDraft.value=t;else await edit({type:'layer.mask_set_placement',layerId:selected.value.id,transform:t})}
 else{const manifest=rpcValue(displayState.value!.manifest),actions=sharedTransformActions(manifest,selectedIds.value,{kind:'translate',dx:delta[0],dy:delta[1]});if(layerTransformDraft.value)draftTransforms.value=actions.map(a=>({id:a.layerId,transform:a.transform}));else await editMany(actions,'Nudge selected layers')}
}
function draftAction(apply:boolean):void {
 if(showCanvasSize.value){if(sizeMode.value==='image'){if(apply)imageSizeDialog.value?.commit();else imageSizeDialog.value?.cancel()}else if(apply)void applySize();else showCanvasSize.value=false;return}
 if(paletteTarget.value){if(!apply)paletteTarget.value=undefined;return}
 if(showEffects.value){if(apply)effectsPanel.value?.commit();else effectsPanel.value?.cancel();return}
 if(floatingSelection.value){void endSelectionTransform(apply);return}
 if(layerTransformDraft.value){void finishLayerTransform(apply);return}
 if(gradientDraft.value){void finishGradient(apply);return}
 if(showDistort.value){if(apply)void applyDistort();else cancelDistort();return}
 if(polygonRequest.value){void finishPolygon(!apply);return}
 if(cropDraft.value){if(apply)void applyCrop();else{void pointerUp(true);cropDraft.value=undefined;cropRequest.value=undefined};return}
 if(!apply){if(canvasOnly.value){void toggleCanvasOnly();return}void pointerUp(true);showAutomation.value=false;contextLayer.value=undefined;if(state.value?.manifest.layers.length)showNew.value=false;error.value=undefined}
}
function keydown(event:KeyboardEvent):void {
 if(event.isComposing)return
 const command=commandForKey(commands.value,shortcutOverrides.value,event,platform==='darwin'?'mac':'other')
 if(!command)return
 if(showEffects.value&&effectTarget.value&&['delete','delete-forward'].includes(command.id)&&!(event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')){event.preventDefault();showEffects.value=false;effectsPreview.value=undefined;action(command.id);return}
 if(showEffects.value&&['apply-draft','cancel-draft'].includes(command.id)){event.preventDefault();draftAction(command.id==='apply-draft');return}
 if((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')||showFilters.value||showEffects.value||showExport.value||showCanvasSize.value||showRecovery.value||showPalette.value||showShortcuts.value||foreign.value.status!=='idle'||photoshop.value.status!=='idle')return
 event.preventDefault()
 if(command.id==='temporary-hand'){temporaryHandKey=event.key;spacePan.value=true;return}
 action(command.id)
}
function keyup(event:KeyboardEvent):void {if(event.key===temporaryHandKey){spacePan.value=false;temporaryHandKey=undefined}}

function toggleFolder(id: string): void { collapsedGroups.value = collapsedGroups.value.includes(id) ? collapsedGroups.value.filter(item => item !== id) : [...collapsedGroups.value, id] }
watch(selectedId, async id => {
  blendPreview.value = undefined
  if(showEffects.value&&id!==effectsLayer.value){showEffects.value=false;effectsPreview.value=undefined}
  if (!id || !state.value) return
  const ancestors = new Set<string>()
  let layer = state.value.manifest.layers.find(item => item.id === id)
  while (layer?.parentID && !ancestors.has(layer.parentID)) { ancestors.add(layer.parentID); layer = state.value.manifest.layers.find(item => item.id === layer!.parentID) }
  collapsedGroups.value = collapsedGroups.value.filter(item => !ancestors.has(item))
  await nextTick()
  document.querySelector(`[data-layer-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })
})
let unsubscribeAgent:(()=>void)|undefined
let unsubscribe: (() => void) | undefined, unsubscribeAction: (() => void) | undefined
watch(()=>outlineResult.value.error,message=>{if(message)error.value={message}})
onMounted(async () => {
  unsubscribeAgent=window.compositor.onAgent(value=>agent.value=value as typeof agent.value);await agentRequest('agentState')
  await refreshForeign(); await refreshPhotoshop(); await refreshRecent(); await refreshExternal()
  unsubscribe = window.compositor.onState(install); unsubscribeAction = window.compositor.onAction(action)
  const initial = await request<EditorState>('state'); if (initial) install(initial)
  bridge.value = await request<BridgeInfo>('bridgeInfo'); const catalog=await request<{family:string;postscriptName?:string;fullName?:string;style?:string}[]>('fontCatalog');if(catalog){setInstalledFontCatalog(catalog);fontList.value=[...new Set(catalog.map(f=>f.family))].sort()} await refreshRecovery(); ready.value = true;shortcutOverrides.value=loadShortcuts(localStorage,commands.value);await syncNativeShortcuts();window.addEventListener('resize',updateViewGeometry);window.addEventListener('blur',loseWindowFocus)
  document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup)
})
onBeforeUnmount(() => { subjectPreviewScheduler.cancel();clearTimeout(subjectPreviewTimer);void finishSubjectPreview();colorRangeScheduler.cancel();clearTimeout(colorRangeTimer);clearTimeout(tabDragTimer);void finishGradient();clearTimeout(gradientTimer);gradientTicket++;void endSelectionTransform();void finishPolygon(true);void canvasContentLease(false); unsubscribeAgent?.();unsubscribe?.(); unsubscribeAction?.(); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); window.removeEventListener('resize',updateViewGeometry);window.removeEventListener('blur',loseWindowFocus);middleUp();engine.dispose();thumbnailEngine.dispose();clearTimeout(distortTimer);endDistortDrag() })
</script>

<template>
  <div class="editor-shell" :class="[platform,{'canvas-only':canvasOnly}]" :data-canvas-only="canvasOnly" :data-ready="ready" :data-dragging="!!draggedId" @dragover="fileDrag" @dragleave.self="dropActive=false" @drop.capture="dropFiles" @click="contextLayer = undefined">
    <header class="titlebar">
      <div class="titlebar-leading">
        <button class="new-button" @click="action('new')" :aria-label="t('New canvas')" :title="t('New canvas (Ctrl/Cmd+N)')"><Plus :size="19" /></button>
        <div class="project-tabs" role="tablist" :aria-label="t('Open projects')">
          <div v-for="doc in documents" :key="doc.sessionId" class="project-tab" :class="{ active: state?.sessionId === doc.sessionId }" role="tab" :aria-selected="state?.sessionId === doc.sessionId" :aria-label="doc.title" :data-session-id="doc.sessionId" tabindex="0" @dragenter="hoverDocumentTab(doc.sessionId,$event)" @dragover="hoverDocumentTab(doc.sessionId,$event)" @dragleave="leaveDocumentTab" @drop="dropDocumentLayers(doc.sessionId,$event)" @click="task('switchDocument', { sessionId: doc.sessionId })" @keydown.enter="task('switchDocument', { sessionId: doc.sessionId })" @keydown.space.prevent="task('switchDocument', { sessionId: doc.sessionId })">
            <span v-if="doc.modified && !doc.empty" class="modified-dot"></span><strong>{{ doc.title }}</strong><button v-if="documents.length>1||!doc.empty" :aria-label="t('Close project')" :title="t('Close {name}', {name:doc.title})" @click.stop="task('closeDocument', { sessionId: doc.sessionId })"><X :size="13" /></button>
          </div>
        </div>
      </div>
      <div class="titlebar-actions"><button class="interface-language" type="button" :aria-label="t('Interface language')" :title="t(locale === 'zh-CN' ? 'Switch to English' : 'Switch to Simplified Chinese')" :aria-disabled="languageBusy" :aria-busy="languageBusy" @keydown="languageKeydown" @click="changeLanguage"><span :class="{ active: locale === 'zh-CN' }">ZH</span><span class="language-divider" aria-hidden="true">/</span><span :class="{ active: locale === 'en' }">EN</span></button><button @click="action('recent-projects')" :aria-label="t('Recent projects')">{{ t('Recent') }}</button><button @click="showAgent=!showAgent" :aria-label="t('Agent chat')">{{ t('Agent') }}</button><button @click="showPalette = true" :aria-label="t('Search commands')" :title="t('Search commands')">{{ t('Commands') }}</button><button v-if="recoverable.length || recoveryInfo.saveRecovery.some(item => item.status === 'attention')" @click="showRecovery = !showRecovery" :aria-label="t('Recovery')" :title="t('Recover unsaved documents')">{{t('Recovery {count}',{count:recoverable.length})}}</button><button class="automation-toggle" @click="showAutomation = !showAutomation" :aria-label="t('Automation')" :title="t('Agent / MCP')"><Terminal :size="16" /></button><button @click="fit" :disabled="showNew">{{ t('Fit') }}</button><button @click="zoom = 1" @contextmenu.prevent="showZoomEntry=!showZoomEntry" :disabled="showNew" :title="t('Actual pixels. Right-click to enter a zoom percentage.')">100%</button><div class="zoom-pair"><button @click="stepZoom(1.2)" :disabled="showNew" :aria-label="t('Zoom in')"><ZoomIn :size="18" /></button><button @click="stepZoom(1 / 1.2)" :disabled="showNew" :aria-label="t('Zoom out')"><ZoomOut :size="18" /></button></div></div>
    </header>
    <div v-if="showZoomEntry&&!showNew" class="zoom-entry"><label>{{ t('Zoom') }} <input v-model.number="zoomPercent" :aria-label="t('Canvas zoom percent')" type="number" min=".1" max="3200" step="25"> %</label><button @click="showZoomEntry=false" :aria-label="t('Close zoom entry')"><X :size="14"/></button></div>
    <section v-if="tool==='move'" class="transform-toolbar" :aria-label="t('Transform controls')">
      <strong>{{ t('Transform') }}</strong><template v-if="layerTransformDraft"><button @click="finishLayerTransform()">{{ t('Cancel') }}</button><button @click="finishLayerTransform(true)">{{ t('Apply') }}</button></template>
      <label class="check-label"><input v-model="autoSelect" type="checkbox" />{{ t('Auto Select') }}</label>
      <label class="check-label"><input v-model="showControls" type="checkbox" />{{ t('Show Controls') }}</label>
      <div class="transform-values">
        <label v-for="[key, label, value] in [['x', 'X', transform?.origin[0] ?? 0], ['y', 'Y', transform?.origin[1] ?? 0], ['width', 'W', transform?.size[0] ?? (showNew ? 1 : state?.manifest.width ?? 1)], ['height', 'H', transform?.size[1] ?? (showNew ? 1 : state?.manifest.height ?? 1)]]" :key="key" class="transform-field"><CommitInput :scrub-label="String(label)" :min="['width','height'].includes(String(key))?1:-30000" :max="30000" :label="t('Layer {dimension}', {dimension:t(String(key))})" :value="Math.round(Number(value) * 100) / 100" :disabled="!canTransform" @preview="previewTransformField(key as any,$event)" @commit="setTransform(key as any, $event)" @editing="beginTransformField" /></label>
        <button class="link-button pill" :class="{ active: sharedTargets||linked }" :disabled="!canTransform||sharedTargets" @click="linked = !linked" :aria-pressed="sharedTargets||linked" :aria-label="t('Link aspect ratio')"><Link v-if="linked" :size="17" /><Unlink v-else :size="17" /></button>
        <label class="transform-field scale-field"><CommitInput :scrub-label="t('Scale')" :label="t('Layer scale')" :value="scalePercent" :disabled="!canTransform" :min=".01" @preview="previewTransformField('scale',$event)" @commit="setTransform('scale', $event)" @editing="beginTransformField" /><span>%</span></label>
        <label class="transform-field rotation-field"><CommitInput scrub-label="°" :min="-360" :max="360" :label="t('Layer rotation')" :value="Math.round((transform?.rotation ?? 0) * 100) / 100" :disabled="!canTransform" @preview="previewTransformField('rotation',$event)" @commit="setTransform('rotation', $event)" @editing="beginTransformField" /></label>
        <label class="sampling-field">{{ t('Sampling') }}<select :aria-label="t('Sampling')" :value="transform?.sampling ?? 'High quality'" :disabled="!canTransform" @change="setSampling(($event.target as HTMLSelectElement).value as Transform['sampling'])"><option value="High quality">{{ t('High quality') }}</option><option value="Smooth">{{ t('Smooth') }}</option><option value="Nearest">{{ t('Nearest') }}</option></select></label>
        <button class="pill" @click="flip('flipX')" :disabled="!canTransform">{{ t('Flip H') }}</button><button class="pill" @click="flip('flipY')" :disabled="!canTransform">{{ t('Flip V') }}</button>
      </div>
    </section>
    <section v-else-if="tool==='hand'||tool==='zoom'" class="transform-toolbar navigation-toolbar"><strong>{{tool==='hand'?t('Pan'):t('Zoom')}}</strong><label v-if="tool==='zoom'"><CommitInput :label="t('Zoom percentage')" :scrub-label="t('Zoom')" :value="zoomPercent" :min=".1" :max="3200" :step="1" @preview="zoomPercent=Number($event)" @commit="zoomPercent=Number($event)"/> %</label></section><section v-else-if="tool==='text'||tool==='shape'" class="transform-toolbar content-toolbar"><ContentTools compact ref="contentTools" :key="contentResetKey" :layer="contentOnCanvas?state?.manifest.layers.find(layer=>layer.id===canvasContentEditingLayer):selected" :mode="tool" :fonts="fontList" :disabled="busy" :draft="canvasContentDraft" :selection-range="canvasTextSelection" :on-canvas="contentOnCanvas" @draft="contentDraftChanged" @apply-canvas="contentCanvas?.commit()" @create="contentRaster" @update="contentRaster" @error="error={message:$event}" /></section><section v-else class="transform-toolbar raster-toolbar" :aria-label="t('Tool controls')"><strong>{{ t(tool) }}</strong><label>{{ t('Foreground') }} <input v-model="foreground" type="color" :aria-label="t('Foreground color')"></label><label>{{ t('Background') }} <input v-model="background" type="color" :aria-label="t('Background color')"></label><template v-if="['brush','eraser','heal','clone','smear'].includes(tool)"><label>{{ t('Size') }} <CommitInput :label="t('Brush size')" :value="brushSize" :min="1" :max="4096" @preview="brushSize=Number($event)" @commit="brushSize=Number($event)"/></label><label>{{ t('Hardness') }} <CommitInput :label="t('Hardness')" :value="hardness" :min="0" :max="1" :step=".1" @preview="hardness=Number($event)" @commit="hardness=Number($event)"/></label><label>{{tool==='smear'?t('Strength'):t('Opacity')}} <CommitInput :label="tool==='smear'?t('Strength'):t('Opacity')" :value="paintOpacity" :min="0" :max="1" :step=".1" @preview="paintOpacity=Number($event)" @commit="paintOpacity=Number($event)"/></label><label>{{ t('Smoothing') }}<CommitInput :label="t('Brush smoothing')" :value="smoothing" :min="0" :max="100" @preview="smoothing=Number($event)" @commit="smoothing=Number($event)"/></label><label v-if="selected?.maskFile"><input v-model="maskTarget" type="checkbox">{{ t('Mask') }}</label></template><template v-if="['marquee','lasso'].includes(tool)"><label v-if="tool==='lasso'">{{ t('Mode') }}<select v-model="lassoMode" :aria-label="t('Lasso mode')"><option value="freehand">{{ t('Freehand') }}</option><option value="polygon">{{ t('Polygonal') }}</option></select></label><select v-model="selectionOperation" :aria-label="t('Selection operation')"><option value="replace">{{ t('replace') }}</option><option value="add">{{ t('add') }}</option><option value="subtract">{{ t('subtract') }}</option><option value="intersect">{{ t('intersect') }}</option></select><label v-if="tool==='marquee'"><input v-model="ellipseSelection" type="checkbox">{{ t('Ellipse') }}</label><label><input v-model="selectionAA" type="checkbox">{{ t('Anti-alias') }}</label><label>{{ t('Feather') }} <input v-model.number="feather" type="number" min="0" max="250"></label><button @click="action('deselect')">{{ t('Deselect') }}</button><button @click="action('fill')">{{ t('Fill') }}</button></template><label v-if="tool==='heal'">{{ t('Mode') }}<select v-model="retouchMode"><option value="spot-heal">{{ t('Spot Healing') }}</option><option value="heal">{{ t('Healing Brush (Alt sample)') }}</option><option value="blur">{{ t('Blur') }}</option></select></label><template v-if="tool==='clone'"><label><input v-model="cloneAligned" type="checkbox" :aria-label="t('Clone Aligned')">{{ t('Aligned') }}</label><label>{{ t('Sample') }}<select v-model="cloneAllLayers" :aria-label="t('Clone sample')"><option :value="false">{{ t('This Layer') }}</option><option :value="true">{{ t('All Layers') }}</option></select></label><span>{{ t('Alt-click to sample') }} {{cloneSource?.map(Math.round).join(', ')}}</span></template><label v-if="tool==='heal'&&retouchMode==='spot-heal'">{{ t('Type') }}<select v-model="healingMode" :aria-label="t('Spot healing type')"><option value="content-aware">{{ t('Content-Aware') }}</option><option value="create-texture">{{ t('Create Texture') }}</option><option value="proximity-match">{{ t('Proximity Match') }}</option></select></label><label v-if="tool==='smear'">{{ t('Mode') }}<select v-model="smearMode" :aria-label="t('Smear mode')"><option value="liquify">{{ t('Liquify') }}</option><option value="blur">{{ t('Blur') }}</option><option value="smudge">{{ t('Smudge') }}</option></select></label><label v-if="tool==='smear'&&smearMode==='blur'||tool==='heal'&&retouchMode==='blur'">{{ t('Radius') }}<input v-model.number="blurRadius" type="number" min=".5" max="50" step=".1" :aria-label="t('Blur radius')"></label><label v-if="tool==='magic'||tool==='object'">{{ t('Mode') }}<select :value="tool" :aria-label="t('Magic mode')" @change="chooseTool(($event.target as HTMLSelectElement).value as Tool)"><option value="magic">{{ t('Wand') }}</option><option value="object">{{ t('Object Selection') }}</option></select></label><label v-if="tool==='eyedropper'"><input v-model="showSampleRing" type="checkbox">{{ t('Sample Ring') }}</label><template v-if="tool==='magic'"><label>{{ t('Tolerance') }}<input v-model.number="wandTolerance" type="number" min="0" max="255"></label><label>{{ t('Sample') }}<select v-model="wandSampleSize" :aria-label="t('Wand sample size')"><option value="point">{{ t('Point') }}</option><option value="3x3">3 × 3</option><option value="5x5">5 × 5</option></select></label><label><input v-model="wandAllLayers" type="checkbox">{{ t('All Layers') }}</label><label><input v-model="selectionAA" type="checkbox">{{ t('Anti-alias') }}</label><label><input v-model="wandContiguous" type="checkbox">{{ t('Contiguous') }}</label></template><template v-if="tool==='crop'"><label>{{ t('Ratio') }}<select v-model="cropRatio" :aria-label="t('Crop ratio')"><option v-for="ratio in ['Free','Original','1:1','4:3','3:4','16:9','9:16']" :value="ratio">{{t(ratio)}}</option></select></label><span v-if="cropDraft">{{cropDraft.width}} × {{cropDraft.height}} px</span><button @click="cropDraft=undefined;cropRequest=undefined" :disabled="!cropDraft">{{ t('Cancel') }}</button><button @click="applyCrop" :disabled="!cropDraft||!cropRequest" :aria-label="t('Apply Crop')">{{ t('Apply Crop') }}</button></template><template v-if="tool==='gradient'"><label><input v-model="radialGradient" type="checkbox">{{ t('Radial') }}</label><label>{{ t('Colors') }}<select v-model="gradientStyle" :aria-label="t('Gradient colors')"><option value="transparent">{{ t('Foreground to Transparent') }}</option><option value="background">{{ t('Foreground to Background') }}</option></select></label><label><input v-model="gradientReverse" type="checkbox"/>{{ t('Reverse') }}</label><label>{{ t('Opacity') }}<CommitInput :label="t('Gradient opacity')" :value="gradientOpacity" :min="0" :max="1" :step=".01" @preview="gradientOpacity=Number($event)" @commit="gradientOpacity=Number($event)"/></label><label v-if="selected?.maskFile"><input v-model="maskTarget" type="checkbox"/>{{ t('Mask') }}</label><template v-if="gradientDraft"><button @click="finishGradient()">{{ t('Cancel') }}</button><button @click="finishGradient(true)" :aria-label="t('Apply Gradient')">{{ t('Apply') }}</button></template></template></section>
    <div class="work-area">
      <aside class="tool-rail" :aria-label="t('Canvas tools')"><div class="rail-tools">
        <button :class="{ active: tool === 'move' }" @click="chooseTool('move')" :aria-label="t('Move / Transform (V)')" :title="t('Move / Transform (V)')"><Maximize2 :size="21" /></button>
        <button v-for="item in canvasTools" :key="item.name" :aria-label="t(item.name)" :title="t(item.name)" :class="{active:tool===item.mode||item.mode==='magic'&&tool==='object'}" :disabled="false" @click="chooseTool(item.mode)"><EditorToolIcon :tool="item.mode" /></button>
        <button :class="{ active: tool === 'hand' }" @click="chooseTool('hand')" :aria-label="t('Hand (H)')" :title="t('Hand (H)')"><Hand :size="22" /></button>
        <button :class="{ active: tool === 'zoom' }" @click="chooseTool('zoom')" :aria-label="t('Zoom (Z)')" :title="t('Zoom (Z)')"><ZoomIn :size="22" /></button>
        <div class="color-swatches" :title="t('Foreground / background colors')"><span class="background-swatch" :style="{background}" role="button" :aria-label="t('Background color picker')" @click="openPalette('background')"></span><span class="foreground-swatch" :style="{background:foreground}" role="button" :aria-label="t('Foreground color picker')" @click="openPalette('foreground')"></span></div>
      </div></aside>
      <main class="canvas-panel">
        <div v-if="showNew" class="new-canvas-panel">
          <form class="new-canvas-form" @submit.prevent="create">
            <div class="new-heading"><h1>{{ t('New canvas') }}</h1><button type="button" :aria-label="t('Preset sizes')" @click="showPresets = !showPresets"><MoreVertical :size="19" /></button><div v-if="showPresets" class="presets"><button type="button" v-for="preset in [[1920,1080,'Full HD'],[3840,2160,'4K'],[1080,1080,'Square'],[1080,1920,'Portrait']]" :key="String(preset[2])" @click="newWidth = Number(preset[0]); newHeight = Number(preset[1]); showPresets = false">{{ t(String(preset[2])) }}<span>{{ preset[0] }} × {{ preset[1] }}</span></button></div></div>
            <div class="new-dimensions"><label>{{ t('Width') }}<div><input ref="newWidthInput" v-model="newWidth" :aria-label="t('Canvas width')" type="number" min="1" :max="LIMITS.maxSide" required /><span>px</span></div></label><span class="dimension-cross">×</span><label>{{ t('Height') }}<div><input v-model="newHeight" :aria-label="t('Canvas height')" type="number" min="1" :max="LIMITS.maxSide" required /><span>px</span></div></label></div>
            <p class="canvas-spec">{{ t('Transparent canvas') }}<span>·</span>{{ t('Pixels') }}<span>·</span>{{ t('72 DPI') }}</p>
            <div class="new-actions"><button class="pill" type="button" @click="task('openDialog')">{{ t('Open project') }}</button><button class="pill" type="button" @click="task('importDialog')">{{ t('Import image') }}</button><button class="pill primary" type="submit" :disabled="busy || !ready">{{ t('Create canvas') }}</button></div>
          </form>
        </div>
        <div v-show="!showNew" ref="viewport" class="viewport" @mousedown="middleDown" @scroll="updateViewGeometry" :class="{ 'hand-tool': tool === 'hand' || spacePan, 'zoom-tool': tool === 'zoom' }" @wheel.ctrl.prevent="stepZoom($event.deltaY < 0 ? 1.08 : 1 / 1.08,$event)">
          <div class="canvas-stage"><div ref="canvasWrap" class="canvas-wrap checkerboard" :style="{ width: `${pixelSize.width}px`, height: `${pixelSize.height}px`,transform:`translate(${panOffset.x}px,${panOffset.y}px)` }" @pointerdown="pointerDown($event)" @pointermove="pointerMove" @pointerup="pointerUp()" @pointercancel="pointerUp(true)" @pointerleave="leaveCanvas" @contextmenu.prevent>
            <canvas ref="canvas" data-testid="editor-canvas" :data-rendering="rendering" :style="viewportPlan?.css ?? {width: `${pixelSize.width}px`,height: `${pixelSize.height}px`}" :data-world-x="viewportPlan?.region.x" :data-world-y="viewportPlan?.region.y" :data-world-width="viewportPlan?.region.width" :data-world-height="viewportPlan?.region.height"></canvas>
            <BrushCursor :point="brushHover" :diameter="brushSize" :zoom="zoom" :tool="tool" :hardness="hardness" :sampling="cursorSampling" :enabled="!spacePan&&!showNew&&!contentOnCanvas" :show-sample-ring="showSampleRing&&sampleRingActive" :sampled-color="foreground" :original-color="sampleRingOriginal"/><CropOverlay v-if="visibleCrop" :draft="visibleCrop" :workspace="cropWorkspace" :zoom="zoom" :aspect="cropAspect()" :snap="cropSnap" :disabled="busy" :space-pan="spacePan" @update="updateCrop" @interaction="cropInteraction"/><CloneSourceOverlay v-if="tool==='clone'&&cloneMarker&&state" :point="cloneMarker" :width="state.manifest.width" :height="state.manifest.height" :zoom="zoom"/>
            <svg v-if="selectionDisplay||rasterPoints.length||cropDraft||polygonPoints.length" class="selection-outline" :viewBox="`0 0 ${state?.manifest.width} ${state?.manifest.height}`" :width="pixelSize.width" :height="pixelSize.height"><path v-if="combinedOutline!==undefined" class="marching" :d="combinedOutline"/><rect v-if="combinedOutline===undefined&&selectionDisplay?.inverted" class="marching" x="0" y="0" :width="state?.manifest.width" :height="state?.manifest.height"/><template v-for="(shape,i) in (combinedOutline!==undefined?[]:selectionDisplay?.shapes)" :key="i"><rect v-if="shape.kind==='rectangle'" class="marching" :x="shape.bounds[0]" :y="shape.bounds[1]" :width="shape.bounds[2]" :height="shape.bounds[3]"/><ellipse v-else-if="shape.kind==='ellipse'" class="marching" :cx="shape.bounds[0]+shape.bounds[2]/2" :cy="shape.bounds[1]+shape.bounds[3]/2" :rx="shape.bounds[2]/2" :ry="shape.bounds[3]/2"/><path v-else-if="shape.kind==='raster'" class="marching" :transform="rasterSelectionMatrix(shape.raster!.transform,shape.raster!.width,shape.raster!.height)" :d="rasterSelectionOutline(shape.raster!)" /><polygon v-else class="marching" :points="shape.points?.map(p=>p.join(',')).join(' ')" /></template><rect v-if="cropDraft" class="marching" :x="cropDraft.x" :y="cropDraft.y" :width="cropDraft.width" :height="cropDraft.height"/><polyline v-if="polygonPoints.length" class="marching" :points="polygonPoints.map(p=>p.join(',')).join(' ')"/></svg>
            <GradientOverlay v-if="tool==='gradient'&&gradientDraft&&!spacePan" :start="gradientDraft.start" :end="gradientDraft.end" :zoom="zoom" :radial="radialGradient" @down="(event,endpoint)=>pointerDown(event,`gradient-${endpoint}`)" @move="pointerMove" @up="pointerUp()" @cancel="pointerUp(true)"/>
            <SelectionTransformOverlay v-if="floatingSelection" :transform="floatingSelection.transform" :corners="floatingSelection.corners" :zoom="zoom" @update="floatingSelection.transform=$event" @corners="floatingSelection.corners=$event"/>
            <svg v-if="showDistort&&distortCorners" class="distort-outline" :width="pixelSize.width" :height="pixelSize.height" :viewBox="`0 0 ${state?.manifest.width} ${state?.manifest.height}`"><polygon :points="distortCorners.map(p=>p.join(',')).join(' ')" fill="none" stroke="#0a84ff" :stroke-width="1.5/zoom"/></svg>
            <template v-if="showDistort&&distortCorners"><button v-for="(point,index) in distortCorners" :key="index" class="distort-corner" :aria-label="t('Distort corner {index}', {index:index+1})" :style="{left:`${point[0]*zoom}px`,top:`${point[1]*zoom}px`}" @pointerdown.stop="startDistortDrag($event,index)" @pointermove.stop="moveDistortDrag" @pointerup.stop="endDistortDrag" @pointercancel.stop="endDistortDrag"/></template>
            <ContentCanvasOverlay ref="contentCanvas" :zoom="zoom" :disabled="busy" :foreground="foreground" :text-shortcut-overrides="shortcutOverrides" :shortcut-platform="platform==='darwin'?'mac':'other'" :commit-edit="contentRaster" @create="contentRaster" @update="contentRaster" @draft="canvasDraftChanged" @preview="previewContent" @selection="canvasTextSelection=$event" @lease="canvasContentLease" @close="contentPreview=undefined;contentOnCanvas=false;canvasContentDraft=undefined;canvasContentEditingLayer=undefined;contentToolDraft=undefined;contentResetKey++" @error="error={message:$event}" />
            <div v-if="!showDistort && bounds && showControls && tool === 'move' && !spacePan" class="transform-outline" :style="bounds"><button v-for="position in ['nw','n','ne','e','se','s','sw','w']" :key="position" :class="['transform-handle', position]" :aria-label="t('Resize {position}', {position:t(position)})" @pointerdown.stop="pointerDown($event, position)" @pointermove.stop="pointerMove" @pointerup.stop="pointerUp()" @pointercancel.stop="pointerUp(true)"></button><span class="rotation-stem"></span><button class="rotation-handle" :aria-label="t('Rotate layer')" @pointerdown.stop="pointerDown($event, 'rotate')" @pointermove.stop="pointerMove" @pointerup.stop="pointerUp()" @pointercancel.stop="pointerUp(true)"></button></div>
          </div></div>
        </div>
        <button v-if="maskAlone" style="position:absolute;left:80px;top:125px;z-index:5;background:#333;border:1px solid #555;padding:5px 10px;border-radius:5px" @click="maskAlone=false">{{ t('Mask alone · Show composite') }}</button><WorkspaceOverlays v-if="state&&!showNew&&!canvasOnly" :document="state.manifest" :viewport="viewSize" :canvas-origin="canvasOrigin" :zoom="zoom" :thumbnail="thumbnail" :navigator="navigatorVisible" :rulers="rulers" :grid-visible="gridVisible" :guides-visible="guidesVisible" :guides-locked="guidesLocked" :guides="state.manifest.guides??[]" :grid="grid" @center="centerView" @guides-change="edit({type:'document.guides',guides:$event})" @grid-change="grid=$event" />
      </main>
      <aside class="inspector" :aria-label="t('Layers panel')">
        <div class="layer-heading"><strong>{{ t('Layers') }}</strong><span>{{ showNew ? 0 : state?.manifest.layers.length ?? 0 }}</span></div>
        <div class="layer-controls"><label>{{ t('Blend') }}<BlendMenu :value="selected?.blendMode ?? 'Normal'" :disabled="!selected || selected.isGroup || showNew" @preview="blendPreview = $event" @commit="selected && edit({ type: 'layer.set_blend', layerId: selected.id, blendMode: $event })" /></label><label>{{ t('Opacity') }}<input class="opacity-slider" :aria-label="t('Opacity slider')" type="range" min="0" max="100" :value="Math.round((selected?.opacity ?? 1) * 100)" :disabled="!selected || showNew" @change="selected && edit({ type: 'layer.set_opacity', layerId: selected.id, opacity: Number(($event.target as HTMLInputElement).value) / 100 })" /><CommitInput :label="t('Layer opacity')" :value="Math.round((selected?.opacity ?? 1) * 100)" :disabled="!selected || showNew" :min="0" :max="100" @commit="selected && edit({ type: 'layer.set_opacity', layerId: selected.id, opacity: Number($event) / 100 })" @editing="request('interaction', $event)" /><span>%</span></label></div>
        <div class="layer-list" role="list" :aria-label="t('Document layers')" @dragover.prevent @drop.prevent="dropLayers(undefined, $event)"><template v-if="!showNew"><div v-for="{ layer, depth } in rows" :key="layer.id" class="layer-row" :class="{ selected: selectedIds.includes(layer.id), hidden: !layer.isVisible }" :style="{ paddingLeft: `${12 + depth * 15}px` }" @click.stop="selectLayer(layer, $event)" draggable="true" @dragstart="startLayerDrag(layer, $event)" @dragover.prevent @drop.prevent.stop="dropLayers(layer, $event)" @contextmenu.prevent.stop="openContext(layer, $event)" role="listitem" :data-layer-id="layer.id">
          <button v-if="layer.isGroup" class="folder-toggle" :aria-label="t(collapsedGroups.includes(layer.id) ? 'Expand {name}' : 'Collapse {name}', {name:layer.name})" :aria-expanded="!collapsedGroups.includes(layer.id)" @click.stop="toggleFolder(layer.id)"><ChevronDown :size="13" :class="{ collapsed: collapsedGroups.includes(layer.id) }" /></button><span v-else class="folder-toggle-spacer"></span>
          <button class="visibility-button" @click.stop="layerEyeClick(layer,$event)" :aria-label="t(layer.isVisible ? 'Hide {name}' : 'Show {name}', {name:layer.name})"><Eye v-if="layer.isVisible" :size="18" /><EyeOff v-else :size="18" /></button>
          <button class="layer-thumbnail checkerboard" :class="{ folder: layer.isGroup }" :style="selectedId===layer.id&&maskTarget?{boxShadow:'none'}:undefined" :aria-label="t('Select {name} image', {name:layer.name})" @click.stop="imageThumbnailClick(layer,$event)"><Folder v-if="layer.isGroup" :size="23" /><img v-else-if="layer.imageFile && state" :src="assetUrl(state, layer.imageFile)" alt="" /></button><MaskThumbnail v-if="layer.maskFile&&state" :url="assetUrl(state,layer.maskFile)" :name="layer.name" :selected="selectedId===layer.id&&maskTarget" :enabled="layer.maskEnabled!==false" :linked="layer.maskLinked!==false" @drag="startComponentDrag(layer,$event,'mask')" @select="maskThumbnailClick(layer,$event)" @link="edit({type:'layer.mask',layerId:layer.id,operation:layer.maskLinked===false?'link':'unlink'})" /><div class="layer-name" @dblclick="layer.adjustment?openFilter(nativeAdjustmentToSpec(layer.adjustment).kind,true):layer.text?(showContent='text'):layer.shape?(showContent='shape'):(renamingId=layer.id)"><CommitInput v-if="renamingId === layer.id" :label="t('Layer name')" type="text" :value="layer.name" @commit="edit({ type: 'layer.rename', layerId: layer.id, name: $event }); renamingId = undefined" @editing="request('interaction', $event)" /><span v-else>{{ layer.name }}</span><LayerEffectBadges v-if="layer.effects" :effects="layer.effects as LayerEffects" @drag="(kind,event)=>startComponentDrag(layer,event,'effect',kind)" @edit="editLayerEffect(layer,$event)"/><small v-if="!layer.isGroup">{{ Math.round(layer.transform.size[0]) }} × {{ Math.round(layer.transform.size[1]) }} px</small></div>
        </div></template><div v-if="showNew || !rows.length" class="empty-layers"><Layers :size="29" /><strong>{{ t('No layers yet') }}</strong><p>{{ t('Create a canvas or import an image.') }}</p></div></div>
        <div class="layer-footer"><button @click="action('blank')" :disabled="showNew" :aria-label="t('New blank layer')" :title="t('New blank layer')"><SquarePlus :size="17" /></button><button @click="action('folder')" :disabled="showNew" :aria-label="t('New folder')" :title="t('New folder')"><FolderPlus :size="19" /></button><button :disabled="!selected||showNew||selectedIds.length!==1||!!selected.maskFile" @click="selected&&edit({type:'layer.mask',layerId:selected.id,operation:$event.altKey?'hide':'reveal'})" :aria-label="t('Add layer mask')" :title="t('Add layer mask')"><Square :size="19" /></button><button :disabled="!selected?.imageFile||showNew" @click="openEffects" :aria-label="t('Layer effects')" :title="t('Layer effects')"><Sparkles :size="18" /><ChevronDown :size="10" /></button><button :disabled="showNew" @click="openFilter('levels',true)" :aria-label="t('New adjustment layer')" :title="t('New adjustment layer')"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"/></svg><ChevronDown :size="10" /></button><button class="delete-layer" @click="action('delete')" :disabled="!selected || showNew" :aria-label="t('Delete selected layer')" :title="t('Delete selected layer')"><Trash2 :size="18" /></button></div>
      </aside>
    </div>
    <div v-if="dropActive" class="modal-backdrop" style="pointer-events:none"><div class="size-dialog"><h2>{{ t('Drop files to open a project or import image layers') }}</h2></div></div>
    <div v-if="showRecents" class="modal-backdrop" @click.self="showRecents=false"><div class="size-dialog" role="dialog" :aria-label="t('Recent projects')"><h2>{{ t('Recent projects') }}</h2><p v-if="!recentProjects.length">{{ t('No recent projects yet.') }}</p><button v-for="project in recentProjects" :key="project.id" :title="project.location" style="width:100%;text-align:left" @click="openRecent(project.id)">{{ project.title }} <small>{{ project.format.toUpperCase() }}</small></button><button :disabled="!recentProjects.length" @click="clearRecents">{{ t('Clear recent projects') }}</button><button @click="showRecents=false">{{ t('Close') }}</button></div></div>
    <PhotoshopImportPanel :state="photoshop" @confirm="photoshopAction('photoshopConfirm',$event)" @cancel="photoshopAction('photoshopCancel',$event)" />
    <RawImportPanel v-if="foreign.kind === 'raw'" :open="foreign.status !== 'idle'" :filename="foreign.filename ?? ''" :settings="foreign.settings" :metadata="foreign.metadata" :preview="foreign.preview" :error="foreign.error" :busy="['metadata','preview','decoding','error'].includes(foreign.status)" @import="foreignAction('foreignConfirm',$event)" @preview="foreignAction('foreignPreview',$event)" @cancel="foreignAction('foreignCancel')" />
    <div v-if="foreign.kind !== 'raw' && foreign.status !== 'idle'" class="modal-backdrop"><div class="size-dialog" role="dialog" :aria-label="t('Image import')"><h2>{{ t('Import image') }}</h2><p>{{ foreign.filename }}</p><p>{{ foreign.error ? tm(foreign.error) : t('Decoding image…') }}</p><button @click="foreignAction('foreignCancel')">{{ t('Cancel import') }}</button></div></div>
    <div v-if="showAgent" class="agent-panel"><AgentChat v-bind="agent" :configure-model="config=>agentRequest('agentConfigure',config)" :send-message="text=>agentRequest('agentSend',{text})" :document-title="state?.title" @configure="agentRequest('agentConfigure',$event)" @send="agentRequest('agentSend',{text:$event})" @cancel="agentRequest('agentCancel')" @clear="agentRequest('agentClear')" @undo="agentRequest('agentUndo')" @close="showAgent=false" /></div>
    <div v-if="showLayerActions&&state" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Layer operations') }}</strong><button @click="showLayerActions=false"><X :size="16" /></button></div><LayerActions :manifest="state.manifest" :selected-ids="selectedIds" :disabled="busy" :can-paste="canPaste" @actions="editMany" @copy="copyLayers" @cut="copyLayers($event,true)" @paste="pasteLayers" @merge="mergeLayers" @error="error={message:$event}" /><MaskPanel v-if="selected" :layer="selected" :url="selected.maskFile?assetUrl(state,selected.maskFile):undefined" :disabled="busy" :selected="maskTarget" :alone="maskAlone" @action="edit" @select="chooseMask" @alone="maskAlone=$event;chooseMask()" @preview="maskPreview=$event" @placement="maskPlacementPreview=$event" @background="maskGrayBackground=$event" @error="error={message:$event}" /><div v-if="selected" class="mask-actions"><label>{{ t('Clipping source') }}<select :value="selected.maskSourceID??''" @change="edit({type:'layer.set_clipping',layerId:selected.id,sourceId:($event.target as HTMLSelectElement).value||null})"><option value="">{{ t('None') }}</option><option v-for="layer in state.manifest.layers.filter(item=>!item.isGroup&&item.id!==selected?.id)" :value="layer.id">{{layer.name}}</option></select></label></div></div>
    <div v-if="showSubjects&&state" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Subject / Object') }}</strong><button @click="showSubjects=false"><X :size="16" /></button></div><ObjectSelectionTools :width="state.manifest.width" :height="state.manifest.height" :box="objectBox" :disabled="!selected" :has-raster="!!selected?.imageFile" :busy="!!imageOperation" :preview="subjectPreview?.url" :preview-busy="subjectPreviewBusy" :pending="!!subjectDraft" @preview="previewSubject" @apply="finishSubjectPreview(true)" :progress="imageOperation?.progress" @select="selectSubject" @drawbox="showSubjects=false;chooseTool('object')" @fill="action('content-fill')" @cancel="subjectDraft?finishSubjectPreview():request('cancelImageOperation',{sessionId:state.sessionId})" @error="error={message:$event}" /></div>
    <div v-if="showTrim" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Trim Canvas') }}</strong><button @click="showTrim=false"><X :size="16" /></button></div><label>{{ t('Based on') }}<select v-model="trimOptions.basedOn"><option value="transparent">{{ t('Transparent Pixels') }}</option><option value="top-left">{{ t('Top Left Pixel Color') }}</option><option value="bottom-right">{{ t('Bottom Right Pixel Color') }}</option></select></label><label v-for="side in ['top','bottom','left','right'] as const"><input v-model="trimOptions[side]" type="checkbox">{{t(side)}}</label><label>{{ t('Tolerance') }}<input v-model.number="trimOptions.tolerance" type="number" min="0" max="255"></label><button @click="edit({type:'document.trim',options:toRaw(trimOptions)}).then(()=>showTrim=false)">{{ t('Apply') }}</button><button @click="showTrim=false">{{ t('Cancel') }}</button></div>
    <div v-if="showContent&&tool!=='text'&&tool!=='shape'" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Editable {kind}',{kind:t(showContent)}) }}</strong><button @click="showContent=undefined"><X :size="16" /></button></div><ContentTools ref="contentTools" :key="contentResetKey" :layer="contentOnCanvas?state?.manifest.layers.find(layer=>layer.id===canvasContentEditingLayer):selected" :mode="showContent" :disabled="busy" :draft="canvasContentDraft" :fonts="fontList" :selection-range="canvasTextSelection" :on-canvas="contentOnCanvas" @draft="contentDraftChanged" @apply-canvas="contentCanvas?.commit()" @create="contentRaster" @update="contentRaster" @error="error={message:$event}" /></div>
    <div v-if="selectionModify" class="feature-panel"><strong>{{t('{operation} selection',{operation:t(selectionModify)})}}</strong><label>{{ t('Pixels') }}<input v-model.number="selectionAmount" type="number" min="0" max="1000"></label><button @click="edit({type:'selection.modify',operation:selectionModify,amount:selectionAmount});selectionModify=undefined">{{ t('Apply') }}</button><button @click="selectionModify=undefined">{{ t('Cancel') }}</button></div>
    <div v-if="showColorRange&&selected" class="feature-panel"><strong>{{ t('Color Range') }}</strong><label>{{ t('Canvas sampling') }}<select v-model="colorRangeSampling" :aria-label="t('Color Range canvas sampling')"><option value="replace">{{ t('Replace reference color') }}</option><option value="include">{{ t('Add reference color') }}</option><option value="exclude">{{ t('Exclude reference color') }}</option></select></label><p>{{ t('Click the canvas to sample. Shift adds a color; Alt excludes a color.') }}</p><img v-if="colorRangePreview" :src="colorRangePreview.url" :alt="t('Color Range selection preview')" style="max-width:100%;max-height:180px;object-fit:contain"><p v-if="colorRangePreviewBusy" role="status">{{ t('Updating selection preview…') }}</p><label>{{ t('Add color') }}<input type="color" :aria-label="t('Included color')" @change="colorRangeIncluded.push(($event.target as HTMLInputElement).value)"></label><span>{{t('{count} included colors',{count:colorRangeIncluded.length+1})}}</span><button @click="colorRangeIncluded=[]">{{ t('Clear additional colors') }}</button><label>{{ t('Color') }}<input v-model="foreground" type="color"></label><label>{{ t('Tolerance') }}<input v-model.number="wandTolerance" type="number" min="0" max="255"></label><label><input v-model="colorRangeInvert" type="checkbox">{{ t('Invert') }}</label><label>{{ t('Exclude') }}<input type="color" :aria-label="t('Excluded color')" @change="colorRangeExcluded.push(($event.target as HTMLInputElement).value)"></label><span>{{t('{count} excluded colors',{count:colorRangeExcluded.length})}}</span><button @click="colorRangeExcluded=[]">{{ t('Clear excluded colors') }}</button><label>{{ t('Softness') }}<input v-model.number="colorSoftness" type="number" min="0" max="1" step=".1"></label><button :disabled="colorRangePreviewBusy" @click="edit(colorRangeAction());showColorRange=false">{{ t('Select') }}</button><button @click="showColorRange=false">{{ t('Cancel') }}</button></div>
    <div v-if="showEffects&&selected" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Layer Effects') }}</strong><button @click="showEffects=false;effectsPreview=undefined"><X :size="16" /></button></div><EffectsPanel ref="effectsPanel" :initial-kind="effectTarget?.layerId===effectsLayer?effectTarget?.kind:undefined" :effects="selected.effects" :layer-id="selected.id" @preview="effectsPreview=$event" @commit="commitEffects" @cancel="showEffects=false;effectsPreview=undefined" @error="error={message:$event}" /></div>
    <ColorPickerPanel v-if="paletteTarget" :value="paletteTarget==='foreground'?foreground:background" :sample="paletteSample" @apply="commitPalette" @close="paletteTarget=undefined"/>
    <div v-if="floatingSelection" class="feature-panel" data-testid="selection-transform-panel"><div class="drawer-heading"><strong>{{ t('Transform Selected Pixels') }}</strong><button @click="endSelectionTransform()"><X :size="16"/></button></div><p>{{ t('Drag selected pixels or corner handles. Cmd/Ctrl-drag a corner for Free Distort; Shift constrains its axis. Apply commits one undo step; Escape cancels.') }}</p><button @click="distortFloatingSelection" :disabled="!!floatingSelection.corners">{{ t('Free Distort Selected Pixels') }}</button><template v-if="floatingSelection.corners"><label v-for="(point,i) in floatingSelection.corners" :key="i">{{t('Corner {index}',{index:i+1})}}<input v-model.number="point[0]" type="number" :aria-label="t('Selected pixels corner {index} X',{index:i+1})"/><input v-model.number="point[1]" type="number" :aria-label="t('Selected pixels corner {index} Y',{index:i+1})"/></label><p role="status">{{floatingSelection.previewError?tm(floatingSelection.previewError):(floatingSelection.previewBusy?t('Rendering selection preview…'):t('Preview does not change your document.'))}}</p></template><template v-else><label v-for="(axis,i) in ['X','Y']">{{t(axis)}}<input v-model.number="floatingSelection.transform.origin[i]" type="number" :aria-label="t('Selected pixels {axis}',{axis:t(axis)})"/></label><label v-for="(axis,i) in ['Width','Height']">{{t(axis)}}<input v-model.number="floatingSelection.transform.size[i]" type="number" min="1" :aria-label="t('Selected pixels {axis}',{axis:t(axis)})"/></label><label>{{ t('Rotation') }}<input v-model.number="floatingSelection.transform.rotation" type="number" :aria-label="t('Selected pixels rotation')"/></label></template><label><input v-model="floatingSelection.transform.flipX" type="checkbox"/>{{ t('Flip H') }}</label><label><input v-model="floatingSelection.transform.flipY" type="checkbox"/>{{ t('Flip V') }}</label><button @click="endSelectionTransform(true)">{{ t('Apply') }}</button><button @click="endSelectionTransform()">{{ t('Cancel') }}</button></div>
    <div v-if="showDistort&&distortCorners&&selected" class="feature-panel" data-testid="distort-panel"><div class="drawer-heading"><strong>{{ t('Free Distort') }}</strong><button @click="cancelDistort"><X :size="16" /></button></div><p>{{ t('Drag the four corners on canvas. Hold Shift to constrain to one axis. Enter applies; Escape cancels.') }}</p><label v-for="(point,i) in distortCorners" :key="i">{{t('Corner {index}',{index:i+1})}} <input v-model.number="point[0]" type="number" :aria-label="t('Corner {index} X',{index:i+1})"><input v-model.number="point[1]" type="number" :aria-label="t('Corner {index} Y',{index:i+1})"></label><p role="status">{{distortBusy?t('Rendering preview…'):t('Preview does not change your document.')}}</p><button @click="applyDistort">{{ t('Apply') }}</button><button @click="cancelDistort">{{ t('Cancel') }}</button></div>
    <div v-if="showFilters" class="modal-backdrop"><FiltersPanel :kind="filterKind" :initial="filterInitial" :original-u-r-l="filterSource" :preview="filterPreview" :last-filter="lastFilter" @preview="previewFilter" @apply="applyFilter" @cancel="showFilters=false" @repeat="applyFilter" /></div>
    <div v-if="showExport&&state" class="modal-backdrop"><ExportAsPanel :width="state.manifest.width" :height="state.manifest.height" :resolution="state.manifest.resolution" :preview="exportPreview" @preview="previewExport" @export="exportAs" @cancel="showExport=false" /></div>
    <div v-if="showCanvasSize&&sizeMode==='image'" class="modal-backdrop"><ImageSizeDialog ref="imageSizeDialog" :width="sizeWidth" :height="sizeHeight" :resolution="resolution" :shortcut-overrides="shortcutOverrides" :shortcut-platform="platform==='darwin'?'mac':'other'" @apply="applyImageSize" @cancel="showCanvasSize=false" /></div>
    <div v-if="showCanvasSize&&sizeMode==='canvas'" class="modal-backdrop"><form class="size-dialog" @submit.prevent="applySize"><h2>{{ t('Canvas Size') }}</h2><label>{{ t('Width') }}<input v-model.number="sizeWidth" type="number" min="1" :max="LIMITS.maxSide" required></label><label>{{ t('Height') }}<input v-model.number="sizeHeight" type="number" min="1" :max="LIMITS.maxSide" required></label><label>{{ t('Anchor') }}<select v-model="sizeAnchor"><option v-for="anchor in ['center','top-left','top','top-right','left','right','bottom-left','bottom','bottom-right']" :value="anchor">{{t(anchor)}}</option></select></label><button type="submit">{{ t('Apply') }}</button><button type="button" @click="showCanvasSize=false">{{ t('Cancel') }}</button></form></div>
    <CommandPalette :open="showPalette" :commands="commands" :overrides="shortcutOverrides" :platform="platform==='darwin'?'mac':'other'" @execute="action" @close="showPalette=false" />
    <ShortcutSettings :open="showShortcuts" :commands="commands" :overrides="shortcutOverrides" :platform="platform==='darwin'?'mac':'other'" @save="saveShortcutSettings" @close="showShortcuts=false" />
    <footer class="status-bar"><template v-if="!showNew && state"><span data-testid="zoom-status">{{ (zoom * 100).toFixed(1) }}%</span><span>{{ state.manifest.width.toLocaleString(locale) }} × {{ state.manifest.height.toLocaleString(locale) }} px</span><span>{{ t('sRGB · Transparent') }}</span></template><span v-else>{{ t('Ready when you are') }}</span><span v-if="selectedIds.length > 1">{{t('{count} layers selected',{count:selectedIds.length})}}</span><span class="status-hint">{{ t(toolHint) }}</span></footer>
    <div v-if="(state?.warnings.length||foreign.warnings?.length||contentWarnings.length) && !showNew" class="warning-bar">{{ tm(contentWarnings[0] ?? state?.warnings[0] ?? foreign.warnings?.[0] ?? '') }}</div>
    <div v-if="activeExternal" class="external-warning" role="status" data-testid="external-change"><strong>{{activeExternal.readable?t('Project changed outside Compositor'):t('External project cannot be read')}}</strong><span>{{activeExternal.readable?(state?.modified?t('Local edits are preserved. Reload replaces them with the external version.'):t('Reload is waiting until the current operation finishes.')):tm(activeExternal.error??'')}}</span><button :disabled="busy||!activeExternal.readable" @click="externalDecision('reload')">{{ t('Reload') }}</button><button :disabled="busy" @click="externalDecision('keep')">{{ t('Keep current') }}</button><button :disabled="busy" @click="externalDecision('copy')">{{ t('Save a Copy…') }}</button></div>
    <div v-if="state?.recoveryError" class="recovery-warning" role="status">{{ t('Automatic recovery copy failed: {error}. Save the project to keep your changes.',{error:tm(state.recoveryError)}) }}</div>
    <div v-if="showRecovery" class="recovery-panel"><div class="drawer-heading"><strong>{{ t('Recover documents') }}</strong><button @click="showRecovery = false" :aria-label="t('Close recovery')"><X :size="17" /></button></div><p>{{ t('Restore an unsaved copy into a new tab. The original project is preserved.') }}</p><div v-for="entry in recoverable" :key="entry.id" class="recovery-entry"><strong>{{ entry.title }}</strong><small>{{ new Date(entry.savedAt).toLocaleString(locale) }}</small><div><button class="pill" @click="restoreDocument(entry.id)">{{ t('Restore') }}</button><button @click="discardRecovery(entry.id)">{{ t('Discard copy') }}</button></div></div><p v-if="!recoverable.length">{{ t('No unsaved copies to restore.') }}</p><div v-for="item in recoveryInfo.saveRecovery.filter(item => item.status === 'attention')" :key="item.id" class="recovery-entry"><strong>{{ t('Save needs attention') }}</strong><p>{{ item.destination }}</p><small>{{ tm(item.message??'') }}</small></div></div>
    <div v-if="error" class="error-toast" role="alert"><div><strong>{{ t('Could not complete operation') }}</strong><p>{{ tm(error.message) }}</p><pre v-if="error.details">{{ JSON.stringify(error.details, null, 2) }}</pre></div><button @click="error = undefined" :aria-label="t('Dismiss error')"><X :size="17" /></button></div>
    <div v-if="showAutomation" class="automation-drawer"><div class="drawer-heading"><strong>{{ t('Agent / MCP') }}</strong><button @click="showAutomation = false" :aria-label="t('Close automation')"><X :size="17" /></button></div><p>{{ t('Connect an MCP client to inspect the canvas, edit layers, preview the result, and undo a change.') }}</p><div class="bridge-status"><i></i>{{ t('Local bridge ready') }}<span>{{t('{count} tools',{count:MCP_TOOLS.length})}}</span></div><button class="copy-config pill" @click="copyConfig"><Check v-if="copied" :size="15" /><Copy v-else :size="15" />{{ copied ? t('Copied configuration') : t('Copy MCP configuration') }}</button><details open><summary>{{ t('Connection configuration') }}</summary><pre>{{ mcpConfig }}</pre></details><div class="session-info">{{ t('Document revision') }}<span>{{ state?.revision }}</span></div><h3>{{ t('AVAILABLE TOOLS') }}</h3><code v-for="name in MCP_TOOLS" :key="name">{{ name }}</code><h3>{{ t('ACTIVITY') }}</h3><div v-for="item in state?.activity.slice(0,8)" :key="item.id" class="activity-item"><Sparkles v-if="item.source === 'agent'" :size="13" /><span>{{ tm(item.label) }}<small>{{ t('{source} · revision {revision}',{source:t(item.source),revision:item.revision}) }}</small></span></div><button class="pill demo-button" @click="task('demo'); showAutomation = false">{{ t('Open demo project') }}</button></div>
    <div v-if="contextLayer" class="context-menu" :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }" @click.stop>
      <button @click="renamingId = contextLayer.id; contextLayer = undefined">{{ t('Rename') }}</button><button @click="edit({ type:'layer.duplicate', layerId: contextLayer.id }); contextLayer = undefined"><Copy :size="14" />{{ contextLayer.isGroup ? t('Duplicate folder') : t('Duplicate layer') }}</button><button v-if="contextLayer.isGroup" @click="edit({ type:'group.ungroup', layerId: contextLayer.id }); contextLayer = undefined">{{ t('Ungroup layers') }}</button><button @click="edit({ type:'layer.reorder', layerId: contextLayer.id, direction:'up' }); contextLayer = undefined"><ArrowUp :size="14" />{{ t('Move up') }}</button><button @click="edit({ type:'layer.reorder', layerId: contextLayer.id, direction:'down' }); contextLayer = undefined"><ArrowDown :size="14" />{{ t('Move down') }}</button><label>{{ t('Move to') }}<select :aria-label="t('Parent group')" :value="contextLayer.parentID ?? ''" @change="edit({ type:'layer.set_parent', layerId: contextLayer.id, parentId: ($event.target as HTMLSelectElement).value || null }); contextLayer = undefined"><option value="">{{ t('Document root') }}</option><option v-for="group in state?.manifest.layers.filter(item => item.isGroup && item.id !== contextLayer?.id)" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><button @click="edit({ type:'layer.delete', layerId: contextLayer.id }); contextLayer = undefined"><Trash2 :size="14" />{{ t('Delete layer') }}</button>
    </div>
  </div>
</template>

<style scoped>
.titlebar-actions .interface-language { -webkit-app-region:no-drag; flex:none; display:inline-flex; align-items:center; gap:5px; min-width:66px; min-height:27px; padding:2px 9px; border:1px solid #555; border-radius:14px; background:#383838; font:inherit; line-height:20px; cursor:pointer; }
.interface-language span { color:#999; font-weight:400; }
.interface-language span.active { color:#f5f5f5; font-weight:700; }
.interface-language .language-divider { color:#777; }
.titlebar-actions .interface-language:hover { background:#444; }
.titlebar-actions .interface-language[aria-disabled=true] { opacity:.6; cursor:wait; }
.titlebar-actions .interface-language:focus-visible { outline:2px solid #168aff; outline-offset:2px; }

.external-warning {position:absolute;left:85px;right:350px;bottom:45px;z-index:12;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px;background:#40351f;border:1px solid #ac863c;border-radius:7px;box-shadow:0 4px 24px #0008;}
.external-warning span {flex:1;min-width:160px;}
.external-warning button {padding:6px 10px;border-radius:5px;background:#555;white-space:nowrap;}
.canvas-wrap canvas { position:absolute !important; }
.canvas-only .titlebar,.canvas-only .transform-toolbar,.canvas-only .tool-rail,.canvas-only .inspector,.canvas-only .status-bar,.canvas-only .warning-bar { display:none; }
.canvas-only .canvas-panel,.canvas-only .viewport { background:#000; }
.canvas-only .canvas-stage { padding:0; }
.canvas-only .canvas-wrap { box-shadow:none; }
.zoom-entry { position:absolute;right:60px;top:42px;z-index:8;display:flex;align-items:center;gap:8px;background:#292929;padding:10px;border:1px solid #555;border-radius:7px;box-shadow:0 6px 24px #0008; }
.zoom-entry input { width:75px; }
.distort-outline { position:absolute;left:0;top:0;z-index:3;pointer-events:none;overflow:visible; }
.distort-corner { position:absolute;z-index:4;width:12px;height:12px;padding:0;border:1px solid #0a84ff;background:white;transform:translate(-50%,-50%);cursor:crosshair;touch-action:none; }
</style>
