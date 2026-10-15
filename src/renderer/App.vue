<script setup lang="ts">
import InfoToolsPanel from './InfoToolsPanel.vue'
import InfoToolsOverlay from './InfoToolsOverlay.vue'
import {useInfoTools} from './use-info-tools'
import {useMagneticLasso} from './use-magnetic-lasso'
import type {DocumentInfo} from '../shared/document-info'

import { useI18n } from './i18n'
import { translate as translateLocale, type Locale } from '../shared/i18n'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { ArrowDown, ArrowUp, Bandage, Check, ChevronDown, Copy, Crop, Droplet, Eye, EyeOff, Folder, FolderPlus, Hand, Lasso, Layers, Link, Maximize2, MoreVertical, Paintbrush, Pipette, Plus, ScanLine, Sparkles, Square, SquareDashed, SquarePlus, Stamp, Terminal, Trash2, Type, Unlink, WandSparkles, X, ZoomIn, ZoomOut, RotateCw } from '@lucide/vue'
import { BLEND_MODES, MCP_TOOLS, LIMITS, type BatchMutation, type BridgeInfo, type EditAction, type EditorState, type Layer, type RpcResult, type Transform } from '../shared/contracts'
import { assetUrl, CanvasEngine, viewportHalo } from './canvas-engine'
import { planViewportRender, type ViewportRenderPlan } from './viewport-render'
import { LatestDraw } from './latest-draw'
import type {MaskProperties} from '../shared/mask-properties'
import {maskPlacementAfterTransform} from '../shared/mask-placement'
import CommitInput from './CommitInput.vue'
import FillDialog from './FillDialog.vue'
import RasterizeDialog from './RasterizeDialog.vue'
import EdgeRefinementPanel from './EdgeRefinementPanel.vue'
import SelectionMaskOverlay from './SelectionMaskOverlay.vue'
import NamedSelections from './NamedSelections.vue'
import EditorToolIcon from './EditorToolIcon.vue'
import ToolGroupMenu from './ToolGroupMenu.vue'
import {retouchToolAction,redEyeBounds,type RetouchToolMode} from './retouch-tool-actions'
import {toolGroup,toolGroupForTool,selectedToolGroupEntry,displayedToolGroupEntry,toolGroupIconProps,type ToolGroupAnchor,type ToolGroupEntry,type ToolGroupId} from './tool-groups'
import CropOverlay from './CropOverlay.vue'
import CropGeometryOverlay from './CropGeometryOverlay.vue'
import VectorPathOverlay from './VectorPathOverlay.vue'
import VectorPathPanel from './VectorPathPanel.vue'
import FrameOverlay from './FrameOverlay.vue'
import FrameContentPanel from './FrameContentPanel.vue'
import FrameCreationOverlay from './FrameCreationOverlay.vue'
import type {VectorPath} from '../shared/vector-path'
import type {FrameMetadata} from '../shared/frame'
import {cropCorners,perspectiveCropSize,photoshopPerspectiveCropSize,photoshopPerspectiveCropGeometry,straightenAngle,straightenCrop,straightenPlacement,type CropCorners,type CropPoint} from '../shared/crop-projective'
import {PointerFinish} from './pointer-finish'
import ImageSizeDialog from './ImageSizeDialog.vue'
import BrushCursor from './BrushCursor.vue'
import BrushDynamicsTools from './BrushDynamicsTools.vue'
import {brushPointerPressure} from '../shared/brush-dynamics'
import GradientOverlay from './GradientOverlay.vue'
import {rasterSelectionOutline,selectionOutline} from '../shared/selection-outline'
import {selectionBoundingBox,createCropRectangle,pixelCropRect,validCropRect,type CropRect} from './crop-geometry'
import ColorPickerPanel from './ColorPickerPanel.vue'
import SelectionTransformOverlay from './SelectionTransformOverlay.vue'
import {floatingCorners,rasterSelectionMatrix,type FloatingCorners} from '../shared/floating-transform'
import {objectSelectionBounds} from '../shared/object-box'
import BlendMenu from './BlendMenu.vue'
import EffectsPanel from './EffectsPanel.vue'
import {EFFECT_KINDS,EFFECT_NAMES,type LayerEffects,type EffectKind} from '../shared/layer-effects'
import FiltersPanel from './FiltersPanel.vue'
import {defaultProgressiveBlurLine} from '../shared/progressive-blur'
import {FILTER_NAMES,defaultFilter,NATIVE_ADJUSTMENT_KINDS,nativeAdjustmentToSpec,type ImageFilter,type ImageFilterKind} from '../shared/image-filters'
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
import {commandForKey,loadShortcuts,saveShortcuts,shortcutFor,shortcutProblem,type WorkspaceCommand,type ShortcutOverrides} from './command-shortcuts'
import {DEFAULT_GRID,snapRect,type GridSettings} from './view-geometry'
import {duplicateSelectionActions,selectionBounds,sharedTransformActions,transformBounds,type MergePlan} from '../core/layer-operations'
import type {ExportOptions,ExportPreview} from '../shared/export-options'
import {smoothStroke,translateSelection,cropRectangle} from '../shared/interaction-geometry'
import {selectionCoverage} from '../shared/selection-coverage'
import {appendSelectionShape} from '../shared/selection-composition'
import {cleanMixerBrushReservoir,loadMixerBrushReservoir,type MixerBrushReservoir} from '../shared/mixer-brush'
import type {Selection} from '../shared/pixel-contracts'
import { folderActions } from '../core/grouping'
import {loadInteractionProfile,PROFILE_STORAGE_KEY,profileCommands,thumbnailSelectionOperation,type InteractionProfile} from './interaction-profile'
import {layerProtected} from '../core/layer-locks'
import {rotateVector,clientToDocument,documentToClient,rotatedViewport} from './rotated-view'

const { locale, t, tm, setLocale } = useI18n()
type Tool = 'frame'|'pen'|'path-selection'|'direct-selection'|'mixer-brush'|'dodge'|'burn'|'sponge'|'history-brush'|'art-history-brush'|'pencil'|'paint-bucket'|'remove'|'content-move'|'red-eye'|'quick-selection'|'patch'|'color-sampler'|'ruler'|'selection-brush'|'rotate-view'|'object'|'move'|'hand'|'zoom'|'marquee'|'lasso'|'magic'|'crop'|'brush'|'eraser'|'background-eraser'|'magic-eraser'|'heal'|'clone'|'smear'|'gradient'|'shape'|'text'|'eyedropper'
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
const interactionProfile=ref<InteractionProfile>(loadInteractionProfile(browserStorage))
const panelsHidden=ref(false),sidePanelsHidden=ref(false)
const platform = window.compositor.platform
const documents = computed(() => state.value?.workspace?.documents ?? [])
type DocumentView = { selectedId?: string; selectedIds: string[]; collapsed: string[]; zoom: number; viewAngle?:number; scrollX: number; scrollY: number; panX?:number;panY?:number;tool: Tool; autoSelect: boolean; linked: boolean; showControls: boolean }
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
const quickOperation=ref<'replace'|'add'|'subtract'>('replace'),quickTolerance=ref(32),quickEdge=ref(.65),magneticWidth=ref(24),magneticContrast=ref(.1),magneticFrequency=ref(20)
const removeClosedLoop=ref(true),retouchProtectAlpha=ref(true),contentMoveAdaptation=ref(.5),redEyePupil=ref(.5),redEyeDarken=ref(.5)
const contentMoveDraft=ref<{request:ReturnType<typeof identity>;action:Extract<EditAction,{type:'layer.content_aware_move'}>}>(),contentMoveFinishing=ref(false)
const redEyeDraft=ref<[number,number,number,number]>()
const backgroundEraseSampling=ref<'continuous'|'once'|'background'>('continuous'),backgroundEraseLimits=ref<'contiguous'|'discontiguous'>('contiguous'),backgroundEraseTolerance=ref(50),backgroundEraseProtectForeground=ref(false)
const magicEraseTolerance=ref(32),magicEraseAA=ref(true),magicEraseContiguous=ref(true),magicEraseAllLayers=ref(false)
const patchMode=ref<'source'|'destination'>('source'),patchAdaptation=ref(1),patchProtectAlpha=ref(true)
const patchPreview=ref<{requestId:number;url:string;transform:Transform;selection:Selection|null;affectedPixels:number}>(),patchOwner=ref<string>()
let patchScheduler:RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},NonNullable<typeof patchPreview.value>>|undefined

const showZoomEntry=ref(false),zoomPercent=computed({get:()=>Math.round(zoom.value*10000)/100,set:(value:number)=>{if(Number.isFinite(value))zoom.value=Math.max(.001,Math.min(32,value/100))}})
const canvasOnly=ref(false)
const lastQuickMaskBrush=ref<[number,number]>()
const quickMask=ref(false),selectionBrushMode=ref<'add'|'subtract'>('add'),showNamedSelections=ref(false)
let quickMaskColors:[string,string]|undefined
async function toggleQuickMask():Promise<void>{if(!state.value||showNew.value||busy.value||drag||switchingTool)return;if(state.value.manifest.width*state.value.manifest.height>64_000_000){error.value={message:'Selection painting exceeds the 64 MP coverage budget.'};return}if(!quickMask.value){await chooseTool('brush');if(tool.value!=='brush')return;lastBrush.value=undefined;lastQuickMaskBrush.value=undefined;quickMaskColors=[foreground.value,background.value];foreground.value='#000000';background.value='#ffffff';quickMask.value=true}else{quickMask.value=false;lastBrush.value=undefined;lastQuickMaskBrush.value=undefined;if(quickMaskColors)[foreground.value,background.value]=quickMaskColors;quickMaskColors=undefined}}
const viewAngle=ref(0)
watch(viewAngle,()=>void nextTick(updateViewGeometry))
const panOffset=ref({x:0,y:0})
async function toggleCanvasOnly():Promise<void>{if(showNew.value||showFilters.value||showEffects.value||showContent.value||showExport.value||showColorRange.value)return;const center={x:(viewSize.value.width/2-canvasOrigin.value.x)/zoom.value,y:(viewSize.value.height/2-canvasOrigin.value.y)/zoom.value};const result=await request<{enabled:boolean}>('setCanvasOnly',{enabled:!canvasOnly.value});if(result){canvasOnly.value=result.enabled;showZoomEntry.value=false;await nextTick();updateViewGeometry();centerView(center)}}
const error = ref<{ message: string; details?: unknown }>(), busy = ref(false), rendering = ref(false), copied = ref(false)
const showNew = ref(true), newWidth = ref(1920), newHeight = ref(1080), showAutomation = ref(false), showPresets = ref(false)
const renamingId = ref<string>(), contextLayer = ref<Layer>(), contextPosition = ref({ x: 0, y: 0 })
const draft = ref<Transform>(), draggedId = ref<string>(), ready = ref(false)
const blendPreview = ref<typeof BLEND_MODES[number]>()
const independentMask=computed(()=>maskTarget.value&&!!selected.value?.maskFile&&selected.value.maskLinked===false&&selectedIds.value.length===1)
const canTransform = computed(() => !showNew.value&&!showDistort.value&&!floatingSelection.value&&!selectedIds.value.some(id=>state.value&&layerProtected(state.value.manifest,id,true))&&(independentMask.value||movingLayers.value.length>0))
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
const canvasTools: {name:string;mode:Tool;shortcut?:string}[] = [
  {name:'Marquee (M)',mode:'marquee'},{name:'Lasso (L)',mode:'lasso'},{name:'Magic (W)',mode:'magic'},
  {name:'Crop (C)',mode:'crop'},{name:'Frame Tool (K)',mode:'frame'},{name:'Eyedropper (I)',mode:'eyedropper'},{name:'Spot Healing Brush (J)',mode:'heal'},
  {name:'Brush (B)',mode:'brush'},{name:'Clone Stamp (S)',mode:'clone'},{name:'History Brush (Y)',mode:'history-brush'},{name:'Eraser (E)',mode:'eraser'},
  {name:'Gradient (G)',mode:'gradient'},{name:'Blur / Smudge',mode:'smear',shortcut:'r'},{name:'Dodge (O)',mode:'dodge'},{name:'Pen Tool (P)',mode:'pen'},{name:'Type (T)',mode:'text'},{name:'Path Selection Tool (A)',mode:'path-selection'},{name:'Shape (U)',mode:'shape'}
]
const rememberedTools=ref<Partial<Record<ToolGroupId,ToolGroupEntry>>>({})
const toolFlyout=ref<{group:ToolGroupId;anchor:ToolGroupAnchor;trigger:HTMLButtonElement}>()
let toolHoldTimer:ReturnType<typeof setTimeout>|undefined,suppressToolClick=false
function cancelToolHold():void{clearTimeout(toolHoldTimer);toolHoldTimer=undefined}
function openToolFlyout(mode:string,trigger:HTMLButtonElement,suppressClick=false):void{
 const group=toolGroupForTool(mode);if(!group||group.entries.length<2||busy.value||drag||switchingTool)return
 cancelToolHold();suppressToolClick=suppressClick;const rect=trigger.getBoundingClientRect();toolFlyout.value={group:group.id,anchor:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},trigger}
}
function toolPointerDown(mode:string,event:PointerEvent):void{
 cancelToolHold();suppressToolClick=false;if(event.button!==0)return
 const trigger=event.currentTarget as HTMLButtonElement
 toolHoldTimer=setTimeout(()=>openToolFlyout(mode,trigger,true),400)
}
function closeToolFlyout():void{const trigger=toolFlyout.value?.trigger;toolFlyout.value=undefined;trigger?.focus({preventScroll:true})}
function toolClick(mode:Tool):void{cancelToolHold();if(suppressToolClick){suppressToolClick=false;return}closeToolFlyout();activateTool(mode)}
function currentToolGroupState(){return {tool:tool.value,ellipseSelection:ellipseSelection.value,marqueeAxis:marqueeAxis.value,lassoMode:lassoMode.value,cropMode:cropMode.value,retouchMode:retouchMode.value}}
function railToolEntry(mode:Tool):ToolGroupEntry|undefined{const group=toolGroupForTool(mode);return group?displayedToolGroupEntry(group.id,currentToolGroupState(),rememberedTools.value[group.id]):undefined}
function railToolLabel(mode:Tool,fallback:string):string{const entry=railToolEntry(mode),group=toolGroupForTool(mode);return entry&&group?`${t(entry.label)} (${group.id})`:t(mode==='smear'&&interactionProfile.value==='compositor'?'Smear (R)':fallback)}
function railToolIcon(mode:Tool):{tool:string;variant?:string}{const entry=railToolEntry(mode);return entry?toolGroupIconProps(entry):{tool:mode}}
function activateTool(mode:Tool):void{const entry=railToolEntry(mode);if(entry)void chooseToolGroupEntry(entry);else void chooseTool(mode)}
const toolFlyoutSelection=computed(()=>toolFlyout.value?displayedToolGroupEntry(toolFlyout.value.group,currentToolGroupState(),rememberedTools.value[toolFlyout.value.group]).id:undefined)
async function chooseToolGroupEntry(entry:ToolGroupEntry):Promise<void>{
 if(busy.value||drag||switchingTool)return
 await magnetic.finish(true);await infoTools.cancel()
 if(entry.tool==='lasso'&&polygonRequest.value)await finishPolygon(true)
 await chooseTool(entry.tool);if(tool.value!==entry.tool||busy.value||drag)return
 if(entry.marqueeAxis!==undefined)marqueeAxis.value=entry.marqueeAxis
 if(entry.ellipseSelection!==undefined)ellipseSelection.value=entry.ellipseSelection
 if(entry.lassoMode!==undefined)lassoMode.value=entry.lassoMode
 if(entry.retouchMode!==undefined){retouchMode.value=entry.retouchMode;cloneSource.value=undefined;cloneOffset.value=undefined;cloneActiveOffset.value=undefined}
 if(entry.cropMode!==undefined)chooseCropMode(entry.cropMode)
}
const externalChanges=ref<ExternalChange[]>([]),activeExternal=computed(()=>externalChanges.value.find(change=>change.sessionId===state.value?.sessionId))
async function refreshExternal():Promise<void>{const value=await request<ExternalChange[]>('externalState');if(value)externalChanges.value=value}
async function externalDecision(decision:'reload'|'keep'|'copy'):Promise<void>{if(!state.value)return;if(decision==='reload')await task('externalReload',{expectedRevision:state.value.revision});else if(decision==='keep')await request('externalKeep',{sessionId:state.value.sessionId});else await task('saveCopyDialog');await refreshExternal()}
const recentProjects=ref<RecentProject[]>([]),showRecents=ref(false),dropActive=ref(false)
async function refreshRecent():Promise<void>{const value=await request<RecentProject[]>('recentState');if(value)recentProjects.value=value}
async function openRecent(id:string):Promise<void>{showRecents.value=false;await task('openRecent',{id})}
async function clearRecents():Promise<void>{await request('clearRecents');await refreshRecent()}
function fileDrag(event:DragEvent):void{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dropActive.value=true;event.dataTransfer.dropEffect='copy'}}
async function dropFiles(event:DragEvent,destination?:'new'|string):Promise<void>{dropActive.value=false;const files=[...(event.dataTransfer?.files??[])];if(!files.length)return;event.preventDefault();event.stopPropagation();if(busy.value)return;busy.value=true;try{const result=await (window.compositor as FileDesktopAPI).dropFiles(files,destination?{destination}:undefined);if(result.ok)install(result.value);else error.value={message:result.error.message}}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}finally{busy.value=false}}
const photoshop=ref<PhotoshopImportState>({status:'idle'})
async function refreshPhotoshop():Promise<void>{const value=await request<PhotoshopImportState>('photoshopState');if(value)photoshop.value=value}
async function photoshopAction(method:'photoshopConfirm'|'photoshopCancel',id?:string):Promise<void>{await request(method,{id});await refreshPhotoshop()}
const foreign = ref<ForeignImportState>({ status: 'idle' })
let openingRawCamera = false
async function openImportedRawCamera():Promise<void>{
  const target=foreign.value.cameraRawTarget
  if(!target||openingRawCamera||busy.value||showFilters.value||foreign.value.status!=='idle')return
  openingRawCamera=true;busy.value=true
  try{
    const imported=await request<EditorState>('switchDocument',{sessionId:target.sessionId})
    if(!imported){await request('foreignCameraRawTarget',{id:target.id});return}
    install(imported)
    const layer=state.value?.manifest.layers.find(item=>item.id===target.layerId)
    if(state.value?.sessionId!==target.sessionId||!layer?.imageFile){error.value={message:'The imported RAW layer is no longer available.'};await request('foreignCameraRawTarget',{id:target.id});return}
    selectedId.value=target.layerId;selectedIds.value=[target.layerId];maskTarget.value=false;showNew.value=false
    await nextTick()
    if(state.value?.sessionId!==target.sessionId||selectedId.value!==target.layerId||!state.value.manifest.layers.some(item=>item.id===target.layerId&&item.imageFile)){error.value={message:'The imported RAW layer is no longer available.'};await request('foreignCameraRawTarget',{id:target.id});return}
    await openFilter('cameraRaw');await request('foreignCameraRawTarget',{id:target.id})
  }finally{openingRawCamera=false;busy.value=false}
}
watch(()=>[busy.value,foreign.value.status,foreign.value.cameraRawTarget?.id],()=>void openImportedRawCamera())
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
const edgeRefinementPanel=ref<{cancel:()=>Promise<void>}>()
const edgeRefinement=ref<{request:ReturnType<typeof identity>;layerId:string}>(),edgeApplying=ref(false)
const canRefineEdges=computed(()=>!!selected.value?.imageFile&&!selected.value.isGroup&&!selected.value.text&&!selected.value.shape&&!selected.value.adjustment&&(!!state.value?.selection||!!selected.value?.maskFile))
async function openEdgeRefinement():Promise<void>{if(!canRefineEdges.value||busy.value)return;await finishSubjectPreview();if(!state.value||!selected.value||!canRefineEdges.value)return;edgeRefinement.value={request:identity(),layerId:selected.value.id};edgeApplying.value=false}
watch(()=>[state.value?.sessionId,state.value?.revision,selectedId.value,edgeApplying.value],()=>{const draft=edgeRefinement.value;if(draft&&edgeApplying.value&&state.value?.sessionId!==draft.request.sessionId){void edgeRefinementPanel.value?.cancel();return}if(draft&&!edgeApplying.value&&(state.value?.sessionId!==draft.request.sessionId||state.value?.revision!==draft.request.expectedRevision||selectedId.value!==draft.layerId))edgeRefinement.value=undefined})
const showSubjects=ref(false),imageOperations=ref<{id:string;sessionId:string;progress?:{phase:string}}[]>([])
const imageOperation=computed(()=>imageOperations.value.find(job=>job.sessionId===state.value?.sessionId))
async function selectSubject(input:{kind:'subject'|'object'|'remove-background';box?:[number,number,number,number];settings?:{quality:'basic'|'advanced';refineEdges:number;matteContrast:number;shiftEdge:number;edgeMode:'native'|'color';feather:number}}):Promise<void>{if(selected.value)await edit({type:'selection.subject',layerId:selected.value.id,box:input.box,removeBackground:input.kind==='remove-background',operation:selectionOperation.value,sampleAllLayers:true,...subjectSettings.value,...(input.settings?{matteQuality:input.settings.quality,refineEdges:input.settings.refineEdges,matteContrast:input.settings.matteContrast,shiftEdge:input.settings.shiftEdge,edgeMode:input.settings.edgeMode,feather:input.settings.feather}:{})})}
const subjectDraft=ref<{request:ReturnType<typeof identity>;action:Extract<EditAction,{type:'selection.subject'}>}>(),subjectPreview=ref<{requestId:number;url:string;state:EditorState;cacheReady:boolean}>(),subjectPreviewBusy=ref(false);let subjectPreviewTimer:ReturnType<typeof setTimeout>|undefined,subjectPreviewGeneration=0
const subjectPreviewScheduler=new RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},{requestId:number;url:string;state:EditorState;cacheReady:boolean}>(async(input,requestId)=>{const result=await window.compositor.request<{requestId:number;url:string;state:EditorState;cacheReady:boolean}>('subjectPreview',{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},value=>{if(subjectDraft.value){subjectPreview.value=value;subjectPreviewBusy.value=false}},cause=>{if(subjectDraft.value){subjectPreviewBusy.value=false;error.value={message:cause instanceof Error?cause.message:String(cause)}}})
function previewSubject(input:{settings:{quality:'basic'|'advanced';refineEdges:number;matteContrast:number;shiftEdge:number;edgeMode:'native'|'color';feather:number}}):void {if(!state.value||!selected.value)return;const settings=input.settings;subjectSettings.value={matteQuality:settings.quality,refineEdges:settings.refineEdges,matteContrast:settings.matteContrast,shiftEdge:settings.shiftEdge,edgeMode:settings.edgeMode,feather:settings.feather};subjectDraft.value??={request:identity(),action:{type:'selection.subject',layerId:selected.value.id,removeBackground:true,operation:'replace',sampleAllLayers:false,...subjectSettings.value}};subjectDraft.value.action={...subjectDraft.value.action,...subjectSettings.value};clearTimeout(subjectPreviewTimer);subjectPreviewBusy.value=true;const generation=++subjectPreviewGeneration;subjectPreviewTimer=setTimeout(()=>{if(generation===subjectPreviewGeneration&&subjectDraft.value)subjectPreviewScheduler.update({request:{...rpcValue(subjectDraft.value.request),action:rpcValue(subjectDraft.value.action)}})},80)}
async function finishSubjectPreview(apply=false):Promise<void>{const draft=subjectDraft.value;if(!draft)return;if(apply){const result=await request('apply',{...rpcValue(draft.request),action:rpcValue(draft.action)});if(!result)return}subjectPreviewScheduler.invalidate();subjectDraft.value=undefined;subjectPreview.value=undefined;subjectPreviewBusy.value=false;subjectPreviewGeneration++;clearTimeout(subjectPreviewTimer);await request('cancelSubjectPreview',{sessionId:draft.request.sessionId})}
watch(showSubjects,value=>{if(!value)void finishSubjectPreview()})
watch(()=>[state.value?.sessionId,state.value?.revision,selectedId.value],()=>{if(subjectDraft.value&&(state.value?.sessionId!==subjectDraft.value.request.sessionId||state.value?.revision!==subjectDraft.value.request.expectedRevision||selectedId.value!==subjectDraft.value.action.layerId))void finishSubjectPreview()})
const showAgent=ref(false),agent=ref<{config?:Omit<ModelConfig,'apiKey'>;configured?:boolean;canUndo?:boolean;previews?:{stage:string;mimeType:string;data:string}[];conversation:AgentChatEntry[];status:'idle'|'running'|'cancelled'|'error';tools:ModelTool[];streamingText?:string;error?:string}>({conversation:[],status:'idle',tools:[]})
async function agentRequest(method:string,params?:unknown):Promise<boolean>{const result=await request<typeof agent.value>(method,params);if(result)agent.value=result;return !!result}
const subjectSettings=ref({matteQuality:'basic' as 'basic'|'advanced',refineEdges:12,matteContrast:25,shiftEdge:0,edgeMode:'color' as 'native'|'color',feather:0})
const effectTarget=ref<{layerId:string;kind:EffectKind}>(),effectsPanel=ref<InstanceType<typeof EffectsPanel>>()
const layerFooterMenu=ref<'adjustments'|'effects'>()
function chooseAdjustment(kind:keyof typeof NATIVE_ADJUSTMENT_KINDS):void{layerFooterMenu.value=undefined;openFilter(kind,true)}
function chooseEffect(kind:EffectKind):void{layerFooterMenu.value=undefined;if(selected.value)editLayerEffect(selected.value,kind)}
function layerDepth(layer:Layer):8|16{return state.value?.assets.find(asset=>asset.file===layer.imageFile)?.bitDepth??8}
function layerHDR(layer:Layer):boolean{return !!state.value?.assets.find(asset=>asset.file===layer.imageFile)?.isHDR}
function depthConvertible(layer:Layer):boolean{if(layer.isGroup||layer.adjustment||layer.text||layer.shape)return false;let item:Layer|undefined=layer;while(item){if(item.locked)return false;item=state.value?.manifest.layers.find(parent=>parent.id===item?.parentID)}return true}
function convertDepth(layer:Layer,bitDepth:8|16):void{contextLayer.value=undefined;void edit({type:'layer.convert_depth',layerId:layer.id,bitDepth})}
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
const displayWarning=ref<string>()
const progressiveLine=computed(()=>selected.value&&state.value?defaultProgressiveBlurLine(selected.value.transform,[state.value.manifest.width,state.value.manifest.height]):undefined)
const filterCommitting=ref(false)
const showFilters=ref(false),filterKind=ref<ImageFilterKind>('levels'),filterInitial=ref<ImageFilter>(),filterSource=ref(''),filterPreview=ref<{requestId:number;url:string;error?:string}>(),filterIdentity=ref<ReturnType<typeof identity>>(),filterLayerId=ref<string>(),filterAdjustment=ref(false),lastFilter=ref<ImageFilter>()
watch(showFilters,()=>void openImportedRawCamera())
async function openFilter(kind:ImageFilterKind,adjustment=false):Promise<void>{if(!state.value)return;filterKind.value=kind;filterAdjustment.value=adjustment;filterLayerId.value=selected.value?.id;filterIdentity.value=identity();filterInitial.value=selected.value?.adjustment?nativeAdjustmentToSpec(selected.value.adjustment):kind==='progressiveBlur'?{...defaultFilter(kind),...progressiveLine.value}:undefined;filterSource.value=!adjustment&&selected.value?.imageFile?assetUrl(state.value,selected.value.imageFile):thumbnail.value;filterPreview.value=undefined;showFilters.value=true}
let filterPreviewTicket=0
async function previewFilter(filter:ImageFilter|null,requestId:number):Promise<void>{
 const started=filterIdentity.value;if(!started)return;const ticket=++filterPreviewTicket,source=filterSource.value
 const current=()=>ticket===filterPreviewTicket&&showFilters.value&&filterIdentity.value===started
 if(!filter){filterPreview.value={requestId,url:source};return}
 try{const result=await window.compositor.request<{url:string}>('filterPreview',{...toRaw(started),layerId:filterLayerId.value,filter,adjustment:filterAdjustment.value});if(!current())return;filterPreview.value=result.ok?{requestId,url:result.value.url}:{requestId,url:source,error:`${result.error.code}: ${result.error.message}`}}
 catch(cause){if(current())filterPreview.value={requestId,url:source,error:cause instanceof Error?cause.message:String(cause)}}
}
async function applyFilter(filter:ImageFilter):Promise<void>{if(!filterIdentity.value||filterCommitting.value)return;filterCommitting.value=true;try{const action:EditAction=filterAdjustment.value?(selected.value?.adjustment?{type:'adjustment.set',layerId:filterLayerId.value!,filter}:{type:'adjustment.add',filter,name:FILTER_NAMES[filter.kind]}):{type:'layer.filter',layerId:filterLayerId.value!,filter};const result=await request('apply',{...filterIdentity.value,action});if(result){lastFilter.value=filter;showFilters.value=false}}finally{filterCommitting.value=false}}
const showTrim=ref(false),trimOptions=ref({basedOn:'transparent' as 'transparent'|'top-left'|'bottom-right',top:true,bottom:true,left:true,right:true,tolerance:0})
const selectionAmount=ref(8),selectionModify=ref<'expand'|'contract'|'feather'|'smooth'|'border'>(),showColorRange=ref(false),colorSoftness=ref(0),colorRangeIncluded=ref<string[]>([]),colorRangeExcluded=ref<string[]>([]),colorRangeInvert=ref(false),colorRangeSampling=ref<'replace'|'include'|'exclude'>('replace')
const selectionModifyLimits=computed(()=>selectionModify.value==='smooth'?{min:1,max:100}:selectionModify.value==='border'?{min:1,max:200}:{min:0,max:1000})
const selectionModifyValid=computed(()=>Number.isFinite(selectionAmount.value)&&selectionAmount.value>=selectionModifyLimits.value.min&&selectionAmount.value<=selectionModifyLimits.value.max&&(!['smooth','border'].includes(selectionModify.value??'')||Number.isInteger(selectionAmount.value)))
async function applySelectionModification():Promise<void>{
 if(!state.value||!selectionModify.value||!selectionModifyValid.value)return
 if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return
 const result=await request('apply',{...identity(),action:{type:'selection.modify',operation:selectionModify.value,amount:selectionAmount.value,featherModel:interactionProfile.value}})
 if(result)selectionModify.value=undefined
}
const colorRangePreview=ref<{requestId:number;url:string;selection:Selection}>(),colorRangePreviewBusy=ref(false);let colorRangeTicket=0,colorRangeTimer:ReturnType<typeof setTimeout>|undefined
function colorRangeAction():Extract<EditAction,{type:'selection.color_range'}>{return {type:'selection.color_range',layerId:selected.value!.id,colors:[foreground.value,...colorRangeIncluded.value].map(c=>color(c).slice(0,3).map(v=>v*255) as [number,number,number]),tolerance:wandTolerance.value,softness:colorSoftness.value,excludeColors:colorRangeExcluded.value.map(c=>color(c).slice(0,3).map(v=>v*255) as [number,number,number]),invert:colorRangeInvert.value,sampleAllLayers:true,antialiased:selectionAA.value,operation:selectionOperation.value}}
const colorRangeScheduler=new RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},{requestId:number;url:string;selection:Selection}>(async(input,requestId)=>{const result=await window.compositor.request<{requestId:number;url:string;selection:Selection}>('selectionRasterPreview',{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},value=>{if(showColorRange.value){colorRangePreview.value=value;colorRangePreviewBusy.value=false}},cause=>{colorRangePreviewBusy.value=false;error.value={message:cause instanceof Error?cause.message:String(cause)}})
function saveShortcutSettings(overrides:ShortcutOverrides):void{const next=profileCommands(rawCommands.value,interactionProfile.value,overrides,platform==='darwin'?'mac':'other');saveShortcuts(browserStorage,next,overrides,platform==='darwin'?'mac':'other');shortcutOverrides.value=overrides;showShortcuts.value=false;void syncNativeShortcuts()}
async function syncNativeShortcuts():Promise<void>{await request('setShortcuts',Object.fromEntries(commands.value.map(command=>[command.id,shortcutFor(command,shortcutOverrides.value,platform==='darwin'?'mac':'other')??''])));await syncNativeMenuCapabilities()}
async function syncNativeMenuCapabilities():Promise<void>{await request('setMenuCapabilities',Object.fromEntries(commands.value.map(command=>[command.id,command.enabled!==false])))}
async function changeInteractionProfile(profile:InteractionProfile):Promise<void>{
 const next=profileCommands(rawCommands.value,profile,shortcutOverrides.value,platform==='darwin'?'mac':'other'),problem=shortcutProblem(next,shortcutOverrides.value,platform==='darwin'?'mac':'other')
 if(problem){error.value={message:problem};return}
 interactionProfile.value=profile;browserStorage.setItem(PROFILE_STORAGE_KEY,profile);await syncNativeShortcuts()
}
const showFill=ref(false)
async function fillWith(value:string):Promise<void>{if(!state.value)return;if(quickMask.value){const c=color(value);await edit({type:'selection.fill',opacity:1,value:c[0]*.2126+c[1]*.7152+c[2]*.0722});showFill.value=false;return}if(!selected.value)return;const result=await request('apply',{...identity(),action:{type:'layer.fill',layerId:selected.value.id,color:color(value),target:maskTarget.value?'mask':'image'}});if(result)showFill.value=false}
const showLayerActions=ref(false),canPaste=ref(false),showExport=ref(false),showContent=ref<'text'|'shape'>(),showCanvasSize=ref(false),sizeMode=ref<'canvas'|'image'>('canvas'),sizeWidth=ref(1920),sizeHeight=ref(1080),resolution=ref(72),sizeAnchor=ref('center')
const imageSizeDialog=ref<{commit:()=>void;cancel:()=>void}>()
const showPalette=ref(false),showShortcuts=ref(false),shortcutOverrides=ref<ShortcutOverrides>({})
const rulers=ref(false),gridVisible=ref(false),guidesVisible=ref(true),guidesLocked=ref(false),snapEnabled=ref(true),navigatorVisible=ref(true),grid=ref<GridSettings>({...DEFAULT_GRID}),thumbnail=ref('')
const viewSize=ref({width:0,height:0}),canvasOrigin=ref({x:0,y:0}),exportPreview=ref<ExportPreview>()
const cloneOffset=ref<[number,number]>(),cloneAligned=ref(true),cloneAllLayers=ref(false),healingMode=ref<'content-aware'|'create-texture'|'proximity-match'>('content-aware'),blurRadius=ref(5),smearMode=ref<'liquify'|'blur'|'smudge'>(interactionProfile.value==='photoshop'?'blur':'liquify')
const cloneHover=ref<[number,number]>(),cloneActiveOffset=ref<[number,number]>()
watch(()=>state.value?.sessionId,()=>{cloneOffset.value=undefined;cloneSource.value=undefined;cloneHover.value=undefined;cloneActiveOffset.value=undefined})
const cloneSource=ref<[number,number]>(),retouchMode=ref<'spot-heal'|'heal'|'blur'|'smear'>('spot-heal'),wandTolerance=ref(32),wandContiguous=ref(true),wandSampleSize=ref<'point'|'3x3'|'5x5'>('point'),wandAllLayers=ref(false),selectionAA=ref(true)
const cloneMarker=computed(()=>cloneSamplePoint(cloneSource.value,cloneHover.value,cloneAligned.value,cloneOffset.value,cloneActiveOffset.value))
const toolHint=computed(()=>tool.value==='marquee'&&marqueeAxis.value!=='area'?'Click to select a single row or column · Shift add · Alt subtract · Shift+Alt intersect':({'mixer-brush':'Mix wet paint with canvas colors · Clean or load paint · Escape cancel','history-brush':'Paint from the selected history source · Capture a source first · Escape cancel','art-history-brush':'Paint source color patches · Portable approximation · Escape cancel',dodge:'Paint to lighten · Choose tone range and exposure · Escape cancel',burn:'Paint to darken · Choose tone range and exposure · Escape cancel',sponge:'Paint to change saturation · Escape cancel',pencil:'Draw hard-edged pixels · [ ] size · 1–0 opacity · Escape cancel', 'paint-bucket':'Click similar colors to fill · Escape cancel',remove:'Paint over an object or draw a closed loop · [ ] size · Escape cancel', 'content-move':'Outline an object, then drag inside the selection · Enter apply · Escape cancel', 'red-eye':'Click a red pupil or drag around the eye · Escape cancel', patch:'Outline an area, then drag inside the selection to patch · Shift add · Alt subtract', 'quick-selection':'Paint to grow the selection · Shift add · Alt subtract · [ ] size','rotate-view':'Drag to rotate the view · Shift snaps to 15°',gradient:'Drag to draw · Drag ends to adjust · Shift 45° · 1–0 opacity · Enter apply · Escape cancel',crop:'Drag to crop · Enter apply · Escape cancel · Space to pan',brush:'Drag to paint · [ ] size · Shift-[ ] hardness · 1–0 opacity · Escape cancel · Space to pan','background-eraser':'Drag over the background · Center crosshair samples color · [ ] size · Escape cancel', 'magic-eraser':'Click similar colors to erase · Escape cancel',eraser:'Drag to erase · [ ] size · Shift-[ ] hardness · 1–0 opacity · Escape cancel · Space to pan',marquee:'Drag a rectangle · Shift add · Alt subtract · Drag inside to move · Ctrl/Cmd+D deselect',lasso:'Drag an outline · Shift add · Alt subtract · Ctrl/Cmd+D deselect',magic:'Click similar colors · Shift add · Alt subtract · Ctrl/Cmd+D deselect',hand:'Drag to pan · Space temporarily activates Hand',zoom:'Click to zoom · Alt-click to zoom out'} as Partial<Record<Tool,string>>)[tool.value]??'Drag to move · Handles to resize · Circle to rotate · 1–0 layer opacity · Space to pan')
let pendingBrushOpacity:PendingOpacityDigit|undefined
watch([tool,selectedId,()=>state.value?.sessionId],()=>{pendingBrushOpacity=undefined})
const foreground=ref('#000000'),background=ref('#ffffff'),brushSize=ref(24),hardness=ref(1),paintOpacity=ref(1),maskTarget=ref(false),ellipseSelection=ref(false),marqueeAxis=ref<'area'|'row'|'column'>('area'),feather=ref(0),radialGradient=ref(false),selectionOperation=ref<'replace'|'add'|'subtract'|'intersect'>('replace')
const smoothing=ref(0),lastBrush=ref<{layerId:string;mask:boolean;point:[number,number]}>(),lassoMode=ref<'freehand'|'polygon'|'magnetic'>('freehand'),polygonPoints=ref<[number,number][]>([]),polygonRequest=ref<ReturnType<typeof identity>>(),polygonReady=ref<Promise<boolean>>()
const polygonOperation=ref<'replace'|'add'|'subtract'|'intersect'>('replace')
function selectionPointerOperation(event:Pick<MouseEvent,'shiftKey'|'altKey'>):'replace'|'add'|'subtract'|'intersect'{return event.shiftKey&&event.altKey?'intersect':event.shiftKey?'add':event.altKey?'subtract':selectionOperation.value}
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
const cropOverlay=ref<InstanceType<typeof CropOverlay>>()
const cropGeometryOverlay=ref<InstanceType<typeof CropGeometryOverlay>>()
const perspectivePointMode=ref(false),perspectiveReady=ref(true)
const cropMode=ref<'crop'|'straighten'|'perspective'>('crop'),cropAngle=ref(0),cropLine=ref<[CropPoint,CropPoint]>(),perspectiveCorners=ref<CropCorners>(),perspectiveWidth=ref(1),perspectiveHeight=ref(1),perspectiveManualSize=ref(false)
const perspectiveSampleCorners=computed(()=>{const corners=perspectiveCorners.value,manifest=state.value?.manifest;if(!corners||perspectiveManualSize.value||interactionProfile.value!=='photoshop'||!manifest)return corners;try{return photoshopPerspectiveCropGeometry(corners,manifest.width,manifest.height,cropAspect()).corners}catch{return corners}})
function resetCropGeometry():void{perspectivePointMode.value=false;perspectiveReady.value=true;cropAngle.value=0;cropLine.value=undefined;perspectiveCorners.value=undefined;perspectiveManualSize.value=false}
function chooseCropMode(value:'crop'|'straighten'|'perspective'):void{cropOverlay.value?.finish();cropGeometryOverlay.value?.finish();const pending=cropDraft.value;resetCropGeometry();cropMode.value=value;if(value==='perspective'){cropDraft.value=undefined;cropRequest.value=undefined;if(pending)updatePerspective(cropCorners(pending))}}
function updateStraighten(line:[CropPoint,CropPoint]):void{if(!state.value)return;try{const angle=straightenAngle(...line);cropAngle.value=angle;cropLine.value=line;updateCrop(straightenCrop(state.value.manifest.width,state.value.manifest.height,angle,cropAspect()))}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
function updatePerspective(corners:CropCorners):void{try{const manifest=state.value?.manifest,size=interactionProfile.value==='photoshop'&&manifest?photoshopPerspectiveCropSize(corners,manifest.width,manifest.height,cropAspect()):perspectiveCropSize(corners,cropAspect());perspectiveCorners.value=corners;if(!perspectiveManualSize.value){perspectiveWidth.value=size.width;perspectiveHeight.value=size.height}const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);cropDraft.value={x:Math.min(...xs),y:Math.min(...ys),width:perspectiveWidth.value,height:perspectiveHeight.value};cropRequest.value=cropOverlayLease??identity()}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
function updatePerspectiveSize(axis:'width'|'height',value:number):void{if(!Number.isSafeInteger(value)||value<1||value>30000){error.value={message:'Crop dimensions exceed the supported canvas size.'};return}perspectiveManualSize.value=true;if(axis==='width')perspectiveWidth.value=value;else perspectiveHeight.value=value;if(perspectiveCorners.value)updatePerspective(perspectiveCorners.value)}
watch(()=>state.value?.sessionId,()=>{cropMode.value='crop';resetCropGeometry()})

function cropAspect():number|undefined{if(cropRatio.value==='Original')return state.value?state.value.manifest.width/state.value.manifest.height:undefined;if(cropRatio.value.includes(':')){const [w,h]=cropRatio.value.split(':').map(Number);return w/h}}
type CropView={zoom:number;pan:[number,number];scroll:[number,number]}
const cropViews=new Map<string,{before:CropView;after:CropView}>()
function captureCropView():CropView{return {zoom:zoom.value,pan:[panOffset.value.x,panOffset.value.y],scroll:[viewport.value?.scrollLeft??0,viewport.value?.scrollTop??0]}}
async function restoreCropView(view:CropView):Promise<void>{zoom.value=view.zoom;panOffset.value={x:view.pan[0],y:view.pan[1]};await nextTick();if(viewport.value){viewport.value.scrollLeft=view.scroll[0];viewport.value.scrollTop=view.scroll[1]}updateViewGeometry()}
async function applyCrop():Promise<void>{if(cropMode.value==='perspective'&&!perspectiveReady.value)return;if(drag?.mode==='raster:crop')await pointerUp();await pointerFinish.wait();cropOverlay.value?.finish();cropGeometryOverlay.value?.finish();await cropOverlaySettled;if(!busy.value&&cropDraft.value&&cropRequest.value){busy.value=true;try{const before=captureCropView(),result=await request('apply',{...cropRequest.value,action:cropMode.value==='perspective'&&perspectiveCorners.value?{type:'document.perspective_crop',corners:rpcValue(!perspectiveManualSize.value&&interactionProfile.value==='photoshop'&&state.value?photoshopPerspectiveCropGeometry(perspectiveCorners.value,state.value.manifest.width,state.value.manifest.height,cropAspect()).corners:perspectiveCorners.value),width:perspectiveWidth.value,height:perspectiveHeight.value,sampling:'High quality'}:cropAngle.value?{type:'document.straighten',angle:cropAngle.value,crop:toRaw(cropDraft.value)}:{type:'document.crop',...toRaw(cropDraft.value),deleteCroppedPixels:false}});if(result){cropDraft.value=undefined;cropRequest.value=undefined;resetCropGeometry();cropMode.value='crop';await nextTick();fit();await nextTick();if(state.value?.undoTransactionId)cropViews.set(state.value.undoTransactionId,{before,after:captureCropView()})}}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}finally{busy.value=false}}}
async function finishPolygon(cancel=false):Promise<void>{const captured=polygonRequest.value,points=structuredClone(rpcValue(polygonPoints.value));try{if(captured&&!cancel&&points.length>=3&&await polygonReady.value){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),shape={kind:'polygon' as const,operation:polygonOperation.value,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)] as [number,number,number,number],points,feather:feather.value},selection=appendSelectionShape(toRaw(state.value?.selection),shape,state.value!.manifest.width,state.value!.manifest.height,selectionAA.value,interactionProfile.value);await request('apply',{...captured,action:{type:'selection.set',selection}})}}finally{if(captured)await request('interaction',{sessionId:captured.sessionId,interactionId:captured.idempotencyKey,busy:false});polygonPoints.value=[];polygonRequest.value=undefined;polygonOperation.value='replace';draftSelection.value=undefined}}
const visibleCrop=computed(()=>tool.value==='crop'&&state.value?(cropDraft.value??{x:0,y:0,width:state.value.manifest.width,height:state.value.manifest.height}):undefined)
const cropWorkspace=computed(()=>{if(viewAngle.value&&viewport.value&&canvasWrap.value&&state.value){const box=viewport.value.getBoundingClientRect(),area=rotatedViewport({left:box.left,top:box.top,...viewSize.value},currentViewGeometry());return {x:-area.origin.x/zoom.value,y:-area.origin.y/zoom.value,width:area.width/zoom.value,height:area.height/zoom.value}}return {x:-canvasOrigin.value.x/zoom.value,y:-canvasOrigin.value.y/zoom.value,width:viewSize.value.width/zoom.value,height:viewSize.value.height/zoom.value}})
const rasterPoints=ref<[number,number][]>([]),rasterPressures=ref<number[]>(),draftSelection=ref<Selection>()
const mixerWet=ref(.8),mixerLoad=ref(.75),mixerMix=ref(.9),mixerFlow=ref(1),mixerCleanAfter=ref(false),mixerLoadAfter=ref(true),mixerPickup=ref<'average'|'tip'>('average'),mixerProtectAlpha=ref(false),mixerReservoir=ref<MixerBrushReservoir>(loadMixerBrushReservoir([0,0,0,1],.75))
const mixerSources=new Map<string,MixerBrushReservoir>()
watch(()=>state.value?.sessionId,(next,previous)=>{if(previous)mixerSources.set(previous,structuredClone(rpcValue(mixerReservoir.value)));mixerReservoir.value=next&&mixerSources.get(next)?structuredClone(mixerSources.get(next)!):loadMixerBrushReservoir(color(foreground.value),mixerLoad.value)})
function mixerPaint(operation:'clean'|'load'):void{if(drag||busy.value)return;mixerReservoir.value=operation==='clean'?cleanMixerBrushReservoir():loadMixerBrushReservoir(color(foreground.value),mixerLoad.value)}
function mixerAction(layerId:string,points=rasterPoints.value,reservoir=drag?.mixerReservoir??mixerReservoir.value):EditAction{return {type:'layer.mixer_brush',layerId,points:points.map(p=>[...p] as [number,number]),size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,spacing:brushSpacing.value,smoothing:smoothing.value/zoom.value,wet:mixerWet.value,load:mixerLoad.value,mix:mixerMix.value,flow:mixerFlow.value,color:color(foreground.value),cleanAfterStroke:mixerCleanAfter.value,loadAfterStroke:mixerLoadAfter.value,colorPickup:mixerPickup.value,protectAlpha:mixerProtectAlpha.value,reservoir:structuredClone(rpcValue(reservoir))}}
const tonalRange=ref<'shadows'|'midtones'|'highlights'>('midtones'),tonalExposure=ref(.5),tonalProtect=ref(true),spongeMode=ref<'saturate'|'desaturate'>('desaturate'),spongeVibrance=ref(true),historyArtSize=ref(8)
async function historySource(operation:'capture'|'select'|'clear',sourceId?:string):Promise<void>{if(!state.value||drag||busy.value)return;const sessionId=state.value.sessionId;await edit({type:'document.history_source',operation,sourceId,label:operation==='capture'?t('Source at revision {revision}',{revision:state.value.revision}):undefined});const current=await request<EditorState>('state',{sessionId});if(current)install(current)}
function extraBrushAction(mode:Tool,layerId:string,points=rasterPoints.value,sourceId=drag?.historySourceId):EditAction{const common={layerId,points:points.map(p=>[...p] as [number,number]),size:brushSize.value,hardness:hardness.value,smoothing:smoothing.value/zoom.value,flow:['dodge','burn','sponge'].includes(mode)?1:brushFlow.value,spacing:interactionProfile.value==='photoshop'?brushSpacing.value:undefined,brushModel:interactionProfile.value,pressures:rasterPressures.value&&[...rasterPressures.value],pressureSize:pressureSize.value,pressureOpacity:pressureOpacity.value};if(mode==='history-brush'||mode==='art-history-brush'){if(!sourceId)throw Error('Capture a History Brush source before painting.');return {type:'layer.history_brush',...common,sourceId,kind:mode==='history-brush'?'history':'art-history',opacity:paintOpacity.value,artSize:historyArtSize.value}}return {type:'layer.tonal_brush',...common,kind:mode as 'dodge'|'burn'|'sponge',amount:tonalExposure.value,range:tonalRange.value,protectTones:tonalProtect.value,mode:spongeMode.value,vibrance:spongeVibrance.value}}
const bucketTolerance=ref(32),bucketContiguous=ref(true),bucketAA=ref(true),bucketAllLayers=ref(false)
const brushSpacing=ref(.25),brushFlow=ref(1),pressureSize=ref(true),pressureOpacity=ref(false)
const brushPercentControls=computed(()=>interactionProfile.value==='photoshop'&&['selection-brush','brush','pencil','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser'].includes(tool.value))
function paintStrokeAction(layerId:string,mode:string):EditAction{if(quickMask.value)return selectionPaintAction(mode as Tool);const raw=rasterPoints.value.map(point=>[...point] as [number,number]),pressures=rasterPressures.value&&[...rasterPressures.value],points=pressures?raw:compactStroke(raw,Math.min(.125,brushSize.value*.005));return {type:'layer.paint',layerId,points,color:color(foreground.value),size:brushSize.value,hardness:hardness.value,smoothing:smoothing.value/zoom.value,flow:mode==='pencil'?1:brushFlow.value,spacing:mode==='pencil'?undefined:interactionProfile.value==='photoshop'?brushSpacing.value:undefined,brushModel:interactionProfile.value,pressures,pressureSize:pressureSize.value,pressureOpacity:pressureOpacity.value,opacity:paintOpacity.value,erase:mode==='eraser',tip:mode==='pencil'?'pencil':undefined,target:maskTarget.value?'mask':'image'}}
function selectionPaintAction(mode=tool.value,subtract=false):EditAction{const pressures=rasterPressures.value&&[...rasterPressures.value],points=rasterPoints.value.map(p=>[...p] as [number,number]),rgb=color(mode==='eraser'?background.value:foreground.value);return {type:'selection.paint',points,tip:mode==='pencil'?'pencil':undefined,size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,flow:mode==='pencil'?1:brushFlow.value,spacing:mode==='pencil'?undefined:interactionProfile.value==='photoshop'?brushSpacing.value:undefined,brushModel:interactionProfile.value,pressures,pressureSize:pressureSize.value,pressureOpacity:pressureOpacity.value,smoothing:smoothing.value/zoom.value,initial:quickMask.value?'all':'empty',value:quickMask.value?(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722):subtract?0:1}}
const selectionDisplay=computed(()=>{const f=floatingSelection.value;if(f?.corners&&f.preview?.selection)return f.preview.selection;if(f?.selection){const {origin,size,rotation,flipX,flipY}=f.transform;return {...f.selection,shapes:f.selection.shapes.map(shape=>shape.raster?{...shape,raster:{...shape.raster,transform:{origin,size,rotation,flipX,flipY}}}:shape)}}return draftSelection.value??state.value?.selection})
const outlineResult=computed(()=>{const selection=selectionDisplay.value;if(!selection||!state.value)return {path:undefined};try{return {path:selectionOutline(toRaw(selection),state.value.manifest.width,state.value.manifest.height)}}catch(cause){return {path:'',error:cause instanceof Error?cause.message:String(cause)}}});const combinedOutline=computed(()=>outlineResult.value.path)
function color(hex:string):[number,number,number,number]{return [parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,1]}
const cropSnap=computed(()=>state.value?{enabled:snapEnabled.value,zoom:zoom.value,document:state.value.manifest,layers:state.value.manifest.layers.filter(layer=>!layer.isGroup).map(layer=>({...transformBounds(layer.transform),id:layer.id,visible:contentLayerVisible(state.value!.manifest.layers,layer.id)})),guides:state.value.manifest.guides,grid:grid.value,gridVisible:gridVisible.value,guidesVisible:guidesVisible.value}:undefined)
let cropOverlayLease:ReturnType<typeof identity>|undefined
let cropOverlayBefore:{sessionId:string;draft?:CropRect;request?:ReturnType<typeof identity>;angle:number;line?:[CropPoint,CropPoint];corners?:CropCorners;output:[number,number]}|undefined
let cropOverlaySettled:Promise<unknown>=Promise.resolve()
function cropInteraction(active:boolean):Promise<unknown>{if(active){const lease=identity();cropOverlayBefore={sessionId:lease.sessionId,draft:cropDraft.value&&{...cropDraft.value},request:cropRequest.value&&{...cropRequest.value},angle:cropAngle.value,line:cropLine.value&&structuredClone(rpcValue(cropLine.value)),corners:perspectiveCorners.value&&structuredClone(rpcValue(perspectiveCorners.value)),output:[perspectiveWidth.value,perspectiveHeight.value]};cropOverlayLease=lease;cropOverlaySettled=cropOverlaySettled.then(()=>request('interaction',{sessionId:lease.sessionId,interactionId:lease.idempotencyKey,busy:true}))}else{const lease=cropOverlayLease;cropOverlayLease=undefined;cropOverlayBefore=undefined;if(lease)cropOverlaySettled=cropOverlaySettled.then(()=>request('interaction',{sessionId:lease.sessionId,interactionId:lease.idempotencyKey,busy:false}))}return cropOverlaySettled}
function cancelCropOverlay():void{const before=cropOverlayBefore;if(before&&before.sessionId===state.value?.sessionId){cropDraft.value=before.draft;cropRequest.value=before.request;cropAngle.value=before.angle;cropLine.value=before.line;perspectiveCorners.value=before.corners;[perspectiveWidth.value,perspectiveHeight.value]=before.output}}
function updateCrop(rect:CropRect):void{if(!validCropRect(rect)){error.value={message:'Crop dimensions exceed the supported canvas size.'};return}cropDraft.value=rect;cropRequest.value=cropOverlayLease??identity()}
function cancelCrop():void{if(drag?.mode==='raster:crop')void pointerUp(true);cropOverlay.value?.finish(true);cropGeometryOverlay.value?.finish(true);cropDraft.value=undefined;cropRequest.value=undefined;resetCropGeometry();cropMode.value='crop'}
watch(cropRatio,()=>{if(cropMode.value==='straighten'&&cropLine.value&&state.value){updateCrop(straightenCrop(state.value.manifest.width,state.value.manifest.height,cropAngle.value,cropAspect()));return}if(cropMode.value==='perspective'&&perspectiveCorners.value){perspectiveManualSize.value=false;updatePerspective(perspectiveCorners.value);return}const rect=visibleCrop.value,aspect=cropAspect();if(rect&&aspect)updateCrop(pixelCropRect({x:rect.x,y:rect.y+rect.height/2-rect.width/aspect/2,width:rect.width,height:rect.width/aspect}))})
const sampleRingOriginal=ref<string>(),sampleRingActive=ref(false),showSampleRing=ref(true)
function sampleDocumentColor(event:PointerEvent):void{if(!canvas.value||!viewportPlan.value)return;const p=documentPoint(event),ctx=canvas.value.getContext('2d'),r=viewportPlan.value.region;if(!ctx)return;const x=Math.floor((p[0]-r.x)*canvas.value.width/r.width),y=Math.floor((p[1]-r.y)*canvas.value.height/r.height);if(x<0||y<0||x>=canvas.value.width||y>=canvas.value.height)return;const pixel=ctx.getImageData(x,y,1,1).data;foreground.value='#'+[...pixel.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('');brushHover.value=p}
const brushHover=ref<[number,number]>(),cursorSampling=ref(false)
function leaveCanvas():void{brushHover.value=undefined;if(!drag)cloneHover.value=undefined}
type StrokeRasterPreview=NonNullable<typeof gradientPreview.value>
const strokePreview=ref<StrokeRasterPreview>();let strokeScheduler:RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},StrokeRasterPreview>|undefined,strokePreviewOwner:string|undefined

function clampSelectionPoint(p:[number,number]):[number,number]{return [Math.max(0,Math.min(state.value!.manifest.width-1e-6,p[0])),Math.max(0,Math.min(state.value!.manifest.height-1e-6,p[1]))]}
function quickAction(layerId:string,points=rasterPoints.value,operation=drag?.operation??quickOperation.value):Extract<EditAction,{type:'selection.quick'}>{return {type:'selection.quick',layerId,points:compactStroke(points.map(clampSelectionPoint),Math.max(1,brushSize.value*.1)),size:brushSize.value,tolerance:quickTolerance.value,edgeSensitivity:quickEdge.value,sampleAllLayers:wandAllLayers.value,antialiased:selectionAA.value,feather:feather.value,operation}}
function patchAction(layerId:string,points=rasterPoints.value):Extract<EditAction,{type:'layer.patch'}>{const a=points[0],b=points.at(-1)!;return {type:'layer.patch',layerId,offset:[b[0]-a[0],b[1]-a[1]],mode:patchMode.value,opacity:paintOpacity.value,adaptation:patchAdaptation.value,protectAlpha:patchProtectAlpha.value}}
function eraserAction(mode:'background-eraser'|'magic-eraser',layerId:string,points=rasterPoints.value):EditAction{
 if(mode==='magic-eraser')return {type:'layer.magic_erase',layerId,point:[...points[0]] as [number,number],tolerance:magicEraseTolerance.value,contiguous:magicEraseContiguous.value,antialiased:magicEraseAA.value,opacity:paintOpacity.value,sampleAllLayers:magicEraseAllLayers.value,target:'image'}
 return {type:'layer.background_erase',layerId,points:compactStroke(points.map(p=>[...p] as [number,number]),Math.min(.125,brushSize.value*.005)),size:brushSize.value,hardness:hardness.value,opacity:1,tolerance:backgroundEraseTolerance.value*255/100,sampling:backgroundEraseSampling.value,limits:backgroundEraseLimits.value,protectForeground:backgroundEraseProtectForeground.value,foreground:color(foreground.value),background:color(background.value),brushModel:interactionProfile.value,smoothing:smoothing.value/zoom.value,sampleAllLayers:false}
}
function currentRetouchOptions(){return {size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,protectAlpha:retouchProtectAlpha.value,fillClosedLoop:removeClosedLoop.value,adaptation:contentMoveAdaptation.value,pupilSize:redEyePupil.value,darkenAmount:redEyeDarken.value}}
function newRetouchAction(mode:RetouchToolMode,layerId:string,points=rasterPoints.value,seed=drag?.seed??0){return retouchToolAction(mode,layerId,points,seed,currentRetouchOptions())}
function scheduleRetouchPreview(action:EditAction,captured:ReturnType<typeof identity>,layerId:string):void{
 if(!patchScheduler){patchOwner.value=layerId;patchScheduler=new RasterStrokePreview(async(input,requestId)=>{const route=input.request.action.type==='layer.patch'?'patchPreview':'retouchToolPreview';const result=await window.compositor.request<NonNullable<typeof patchPreview.value>>(route,{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},value=>{patchPreview.value=value;draftSelection.value=value.selection??undefined},cause=>error.value={message:cause instanceof Error?cause.message:String(cause)})}
 patchScheduler.update({request:{...toRaw(captured),action}})
}
async function finishContentMove(apply=false):Promise<void>{
 if(contentMoveFinishing.value)return
 if(drag?.mode==='raster:content-move'||pointerFinish.active)await pointerUp(!apply)
 if(contentMoveFinishing.value)return
 const pending=contentMoveDraft.value;if(!pending)return
 contentMoveFinishing.value=true
 patchScheduler?.cancel();patchScheduler=undefined
 try{if(apply)await request('apply',{...toRaw(pending.request),action:rpcValue(pending.action)})}
 finally{contentMoveDraft.value=undefined;clearStrokePreview();draftSelection.value=undefined;try{await request('interaction',{sessionId:pending.request.sessionId,interactionId:pending.request.idempotencyKey,busy:false})}finally{contentMoveFinishing.value=false}}
}
watch(()=>[state.value?.sessionId,state.value?.revision,selectedId.value,maskTarget.value],()=>{const pending=contentMoveDraft.value;if(pending&&!contentMoveFinishing.value&&(state.value?.sessionId!==pending.request.sessionId||state.value?.revision!==pending.request.expectedRevision||selectedId.value!==pending.action.layerId||maskTarget.value))void finishContentMove()})
watch([contentMoveAdaptation,paintOpacity,retouchProtectAlpha],()=>{const pending=contentMoveDraft.value;if(!pending||contentMoveFinishing.value)return;pending.action={...pending.action,adaptation:contentMoveAdaptation.value,opacity:paintOpacity.value,protectAlpha:retouchProtectAlpha.value};scheduleRetouchPreview(pending.action,pending.request,pending.action.layerId)})
function bucketAction(layerId:string,points=rasterPoints.value):EditAction{return {type:'layer.bucket_fill',layerId,point:[...points[0]] as [number,number],color:color(foreground.value),opacity:paintOpacity.value,tolerance:bucketTolerance.value,contiguous:bucketContiguous.value,antialiased:bucketAA.value,sampleAllLayers:bucketAllLayers.value}}
function strokeAction():EditAction|undefined{if(!drag?.request||!drag.mode.startsWith('raster:')||!rasterPoints.value.length)return;const mode=drag.mode.slice(7);if(mode==='mixer-brush'&&drag.layerId)return mixerAction(drag.layerId);if(['dodge','burn','sponge','history-brush','art-history-brush'].includes(mode)&&drag.layerId)return extraBrushAction(mode as Tool,drag.layerId);if(mode==='paint-bucket'&&drag.layerId)return bucketAction(drag.layerId);if(mode==='quick-selection'&&drag.layerId)return quickAction(drag.layerId);if(mode==='patch'&&drag.layerId)return patchAction(drag.layerId);if(['remove','content-move','red-eye'].includes(mode)&&drag.layerId)return newRetouchAction(mode as RetouchToolMode,drag.layerId);if(mode==='selection-brush'||quickMask.value&&['brush','pencil','eraser'].includes(mode))return selectionPaintAction(mode as Tool,drag.operation==='subtract');if(!drag.layerId)return;if(mode==='background-eraser'||mode==='magic-eraser')return eraserAction(mode,drag.layerId);const points=compactStroke(rasterPoints.value.map(p=>[...p] as [number,number]),Math.min(.125,brushSize.value*.005));if(['brush','pencil','eraser'].includes(mode))return paintStrokeAction(drag.layerId,mode);if(['heal','clone','smear'].includes(mode))return {type:'layer.retouch',layerId:drag.layerId,kind:mode==='clone'?'clone':mode==='smear'?(smearMode.value==='blur'?'blur':'smear'):retouchMode.value,points,size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,sourceAnchor:cloneSource.value?[...cloneSource.value]:undefined,protectAlpha:false,smoothing:smoothing.value/zoom.value,aligned:cloneAligned.value,sourceOffset:mode==='clone'?cloneActiveOffset.value:undefined,sourceMode:mode==='clone'&&cloneAllLayers.value?'all-layers':'this-layer',healingMode:healingMode.value,healingModel:interactionProfile.value,smearMode:smearMode.value==='liquify'?'liquify':'smudge',blurRadius:blurRadius.value,target:maskTarget.value?'mask':'image',seed:drag.seed??0}}
let selectionStrokeScheduler:RasterStrokePreview<{request:ReturnType<typeof identity>&{action:EditAction}},{requestId:number;selection:Selection}>|undefined
function scheduleStrokePreview():void{let action:EditAction|undefined;try{action=strokeAction()}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)};if(drag)drag.overflow=true;clearStrokePreview();return}const current=drag;if(!action||!current?.request)return;if(action.type==='selection.paint'||action.type==='selection.quick'){if(!selectionStrokeScheduler)selectionStrokeScheduler=new RasterStrokePreview(async(input,requestId)=>{const result=await window.compositor.request<{requestId:number;selection:Selection}>('selectionRasterPreview',{...input,requestId});if(!result.ok)throw new Error(result.error.message);return result.value},preview=>draftSelection.value=preview.selection,cause=>error.value={message:cause instanceof Error?cause.message:String(cause)});selectionStrokeScheduler.update({request:{...toRaw(current.request),action}});return;}if(['layer.patch','layer.remove','layer.content_aware_move','layer.red_eye'].includes(action.type)&&current.layerId){scheduleRetouchPreview(action,current.request,current.layerId);return;}if(!strokeScheduler){strokePreviewOwner=current.layerId;strokeScheduler=new RasterStrokePreview(async(input,requestId)=>{const result=await window.compositor.request<StrokeRasterPreview>('strokePreview',{...input,requestId});if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value},preview=>strokePreview.value=preview,cause=>{error.value={message:cause instanceof Error?cause.message:String(cause)}})}strokeScheduler.update({request:{...toRaw(current.request),action}})}
function clearStrokePreview():void{patchScheduler?.cancel();patchScheduler=undefined;patchPreview.value=undefined;patchOwner.value=undefined;selectionStrokeScheduler?.cancel();selectionStrokeScheduler=undefined;strokeScheduler?.cancel();strokeScheduler=undefined;strokePreview.value=undefined;strokePreviewOwner=undefined}
let switchingTool = false
async function chooseTool(value:Tool):Promise<void>{
 if(contentMoveDraft.value)await finishContentMove()
 await magnetic.finish(true);await infoTools.cancel()
 await pointerFinish.wait()
 if(tool.value!==value){vectorOverlay.value?.finish(true);frameCreation.value?.finish(true);frameOverlay.value?.finish(true);await vectorSettled;await frameSettled;cropOverlay.value?.finish();cropGeometryOverlay.value?.finish()}
 await cropOverlaySettled
 if(switchingTool||busy.value||drag||brushTipDrag)return
 if(tool.value===value){if(value==='shape'||value==='text')showContent.value=value;return}
 switchingTool=true
 try{
  if(contentOnCanvas.value&&value!==tool.value){if(!await contentCanvas.value?.commit())return}
  if(layerTransformDraft.value){await finishLayerTransform(true);if(layerTransformDraft.value)return}
  if(gradientDraft.value){await finishGradient(true);if(gradientDraft.value)return}
  if(polygonRequest.value)await finishPolygon(true)
  cropDraft.value=undefined;cropRequest.value=undefined;resetCropGeometry();cropMode.value='crop'
  if(quickMask.value&&!['brush','pencil','eraser','hand','zoom','eyedropper','rotate-view'].includes(value)){quickMask.value=false;lastBrush.value=undefined;lastQuickMaskBrush.value=undefined;if(quickMaskColors)[foreground.value,background.value]=quickMaskColors;quickMaskColors=undefined}
  if(['frame','pen','path-selection','direct-selection','background-eraser','magic-eraser','paint-bucket','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush'].includes(value))maskTarget.value=false
  tool.value=value;showContent.value=value==='shape'||value==='text'?value:undefined
  if(value==='crop'&&state.value){cropRatio.value='Free';try{cropDraft.value=selectionBoundingBox(toRaw(state.value.selection),state.value.manifest.width,state.value.manifest.height);cropRequest.value=cropDraft.value?identity():undefined}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
 }finally{switchingTool=false}
}
function updateViewGeometry():void{if(!viewport.value||!canvasWrap.value)return;const v=viewport.value.getBoundingClientRect(),c=canvasWrap.value.getBoundingClientRect();viewSize.value={width:viewport.value.clientWidth,height:viewport.value.clientHeight};canvasOrigin.value={x:c.left-v.left,y:c.top-v.top};void redraw()}
function centerView(point:{x:number;y:number}):void{if(!viewport.value||!canvasWrap.value)return;const client=documentToClient(point,currentViewGeometry()),box=viewport.value.getBoundingClientRect();viewport.value.scrollLeft+=client.x-box.left-viewSize.value.width/2;viewport.value.scrollTop+=client.y-box.top-viewSize.value.height/2;updateViewGeometry()}
async function copyLayers(ids=selectedIds.value,cut=false):Promise<void>{if(!state.value)return;const result=await request('copyLayers',{...identity(),layerIds:ids,cut});if(result)canPaste.value=true}
async function pasteLayers():Promise<void>{if(state.value)await request('pasteLayers',identity())}
async function mergeLayers(plan:MergePlan):Promise<void>{if(state.value)await request('mergeLayers',{...identity(),layerIds:plan.roots,kind:'selected'})}
async function mergeCommand(name:string):Promise<void>{
 if(!state.value||busy.value||drag)return
 if(layerTransformDraft.value){await finishLayerTransform(true);if(layerTransformDraft.value)return}
 if(gradientDraft.value){await finishGradient(true);if(gradientDraft.value)return}
 const kind=name==='merge-visible'?'visible':name==='stamp-visible'?'stamp-visible':name==='stamp-selected'?'stamp-selected':selectedRoots.value.length===1?(selectedRoots.value[0].isGroup?'group':'down'):'selected'
 await request('mergeLayers',{...identity(),layerIds:selectedIds.value,kind})
}
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
 {id:'info-tools',title:'Info',category:'Window',shortcut:'F8',enabled:!!state.value},
 {id:'saveDialog',title:'Save As',category:'File',shortcut:'Primary+Shift+s',enabled:!!state.value?.manifest.layers.length},
 {id:'saveCopyDialog',title:'Save a Copy',category:'File',shortcut:'Primary+Alt+s',enabled:!!state.value?.manifest.layers.length},
 {id:'closeDocument',title:'Close Project',category:'File',shortcut:'Primary+w',enabled:!!state.value},
 {id:'blank',title:'New Blank Layer',category:'Layer',shortcut:'Primary+Shift+n',enabled:!showNew.value},
 {id:'folder',title:'New Folder',category:'Layer',shortcut:'Primary+g',enabled:!showNew.value},
 {id:'ungroup',title:'Ungroup Layers',category:'Layer',shortcut:'Primary+Shift+g',enabled:!!selected.value?.isGroup},
 {id:'zoom-in',title:'Zoom In',category:'View',shortcut:'Primary+='}, {id:'zoom-out',title:'Zoom Out',category:'View',shortcut:'Primary+-'},
 {id:'reselect',title:'Reselect',category:'Select',enabled:!!state.value?.canReselect},
 {id:'select-all-layers',title:'All Layers',category:'Select',shortcut:'Primary+Alt+a',enabled:!!state.value?.manifest.layers.length},
 {id:'load-selection',title:'Load Selection',category:'Select',enabled:!!state.value?.manifest.namedSelections?.length},
 {id:'save-selection',title:'Save Selection',category:'Select',enabled:!!state.value?.selection},
 {id:'delete-layer',title:'Delete Layer',category:'Layer',enabled:!!selected.value},
 ...(['reveal','hide','selection','toggle','remove'] as const).map(operation=>({id:`mask:${operation}`,title:({'reveal':'Reveal All','hide':'Hide All','selection':'Reveal Selection','toggle':'Disable / Enable Layer Mask','remove':'Delete Layer Mask'})[operation],category:'Layer',enabled:!!selected.value&&(['toggle','remove'].includes(operation)?!!selected.value.maskFile:!selected.value.isGroup&&!selected.value.maskFile&&(operation!=='selection'||!!state.value?.selection))})),
 {id:'rotate-canvas-ccw',title:'Rotate Canvas 90° Counterclockwise',category:'Image',enabled:!showNew.value},
 {id:'rotate-canvas-180',title:'Rotate Canvas 180°',category:'Image',enabled:!showNew.value},
 {id:'flip-canvas-vertical',title:'Flip Canvas Vertical',category:'Image',enabled:!showNew.value},

 ...TEXT_EDIT_COMMANDS.filter(command=>command.id!=='cancel-draft'),
 {id:'export-psd',title:'Export PSD',category:'File'},{id:'export-psb',title:'Export PSB',category:'File'},{id:'selection-smooth',title:'Smooth Selection',category:'Select',enabled:!!state.value?.selection},{id:'selection-border',title:'Border Selection',category:'Select',enabled:!!state.value?.selection},{id:'selection-expand',title:'Expand Selection',category:'Select',enabled:!!state.value?.selection},{id:'selection-contract',title:'Contract Selection',category:'Select',enabled:!!state.value?.selection},{id:'selection-feather',title:'Feather Selection',category:'Select',enabled:!!state.value?.selection},{id:'color-range',title:'Color Range',category:'Select',enabled:!!selected.value},
 {id:'edge-refinement',title:'Refine Selection Edges…',category:'Select',enabled:canRefineEdges.value},
 {id:'subject-tools',title:'Select Subject / Object / Remove Background',category:'Select',enabled:!!selected.value},{id:'content-fill',title:'Content-Aware Fill',category:'Edit',enabled:!!selected.value?.imageFile&&!!state.value?.selection},
 {id:'transform-selection',title:'Free Transform',category:'Transform',shortcut:'Primary+t',enabled:!!selected.value},
 {id:'effects',title:'Layer Effects',category:'Layer',enabled:!!selected.value?.imageFile},{id:'distort',title:'Free Distort',category:'Transform',enabled:!!selected.value},
 {id:'new',title:'New Canvas',category:'File',shortcut:'Primary+n'}, {id:'openDialog',title:'Open Project',category:'File',shortcut:'Primary+o'}, {id:'recent-projects',title:'Recent Projects',category:'File'}, {id:'importDialog',title:'Import Images',category:'File',shortcut:'Primary+i'}, {id:'importFolderDialog',title:'Import Image Folder',category:'File'}, {id:'saveCurrent',title:'Save',category:'File',shortcut:'Primary+s'}, {id:'export-as',title:'Export As',category:'File',shortcut:'Primary+Shift+e'},
 {id:'undo',title:'Undo',category:'Edit',shortcut:'Primary+z',enabled:state.value?.canUndo}, {id:'redo',title:'Redo',category:'Edit',shortcut:'Primary+Shift+z',enabled:state.value?.canRedo},
 {id:'copy-merged',title:'Copy Merged',category:'Edit',shortcut:'Primary+Shift+c',enabled:!!state.value?.manifest.layers.length},
 {id:'copy',title:'Copy Layers',category:'Edit',shortcut:'Primary+c',enabled:!!selectedIds.value.length},{id:'cut',title:'Cut Layers',category:'Edit',shortcut:'Primary+x',enabled:!!selectedIds.value.length},{id:'paste',title:'Paste Layers',category:'Edit',shortcut:'Primary+v',enabled:!!state.value},
 {id:'duplicate',title:'Duplicate Layers',category:'Layer',shortcut:'Primary+j',enabled:!!selectedIds.value.length},{id:'layer-actions',title:'Layer Transform and Merge',category:'Layer'},
 {id:'merge-auto',title:'Merge Layers',category:'Layer',enabled:!!selectedIds.value.length},
 {id:'merge-visible',title:'Merge Visible',category:'Layer',enabled:!!state.value?.manifest.layers.length},
 {id:'stamp-visible',title:'Stamp Visible',category:'Layer',enabled:!!state.value?.manifest.layers.length},
 {id:'stamp-selected',title:'Stamp Selected',category:'Layer',enabled:!!selectedIds.value.length},
 {id:'toggle-panels',title:'Show / Hide Panels',category:'View'}, {id:'toggle-side-panels',title:'Show / Hide Side Panels',category:'View'},
 {id:'tool:rotate-view',title:'Rotate View',category:'Tools'},{id:'reset-view-rotation',title:'Reset View Rotation',category:'View'},
 {id:'fill-foreground',title:'Fill with Foreground',category:'Edit'}, {id:'fill-background',title:'Fill with Background',category:'Edit'},
 {id:'fill-foreground-forward',title:'Fill with Foreground (Delete)',category:'Edit'}, {id:'fill-background-forward',title:'Fill with Background (Delete)',category:'Edit'},
 {id:'trim-canvas',title:'Trim Canvas',category:'Image'},
 {id:'canvas-size',title:'Canvas Size',category:'Image'},{id:'image-size',title:'Image Size',category:'Image'}, {id:'rotate-canvas',title:'Rotate Canvas 90° Clockwise',category:'Image'}, {id:'flip-canvas',title:'Flip Canvas Horizontally',category:'Image'},
 {id:'select-all',title:'Select All Pixels',category:'Select',shortcut:'Primary+a'},{id:'deselect',title:'Deselect',category:'Select',shortcut:'Primary+d'},{id:'invert-selection',title:'Invert Selection',category:'Select',shortcut:'Primary+Shift+i'},{id:'fill',title:'Fill Selection',category:'Edit'},
 {id:'canvas-only',title:'Toggle Fullscreen',category:'View',shortcut:'f',enabled:!showNew.value}, {id:'rulers',title:'Toggle Rulers',category:'View',shortcut:'Primary+r'},{id:'grid',title:'Toggle Grid',category:'View'},{id:'guides',title:'Toggle Guides',category:'View'},{id:'lock-guides',title:'Lock Guides',category:'View'},{id:'clear-guides',title:'Clear Guides',category:'View'},{id:'snap',title:'Toggle Snapping',category:'View'},{id:'navigator',title:'Toggle Navigator',category:'View'},{id:'fit',title:'Fit Canvas',category:'View',shortcut:'Primary+0'},{id:'actual',title:'Actual Pixels',category:'View',shortcut:'Primary+1'},
 {id:'quick-mask',title:'Quick Mask (Q)',category:'Select',shortcut:'q'}, {id:'named-selections',title:'Named Selections',category:'Select'},
 {id:'tool:object',title:'Object Selection',category:'Tools'},{id:'tool:background-eraser',title:'Background Eraser Tool',category:'Tools'},{id:'tool:magic-eraser',title:'Magic Eraser Tool',category:'Tools'},
 ...([{id:'tool:move',title:'Move',shortcut:'v'},{id:'tool:hand',title:'Hand',shortcut:'h'},{id:'tool:zoom',title:'Zoom',shortcut:'z'},{id:'cycle-tool',title:'Cycle Current Tool',shortcut:'tab'},{id:'cycle-shape',title:'Cycle Shape',shortcut:'Shift+u'},{id:'temporary-hand',title:'Temporary Hand',shortcut:'space'},{id:'swap-colors',title:'Swap Foreground / Background',shortcut:'x'},{id:'reset-colors',title:'Default Colors',shortcut:'d'},{id:'brush-smaller',title:'Smaller Brush',shortcut:'['},{id:'brush-larger',title:'Larger Brush',shortcut:']'},{id:'brush-softer',title:'Softer Brush',shortcut:'Shift+['},{id:'brush-harder',title:'Harder Brush',shortcut:'Shift+]'},{id:'apply-draft',title:'Apply Current Operation',shortcut:'enter'},{id:'cancel-draft',title:'Cancel Current Operation',shortcut:'escape'},{id:'delete',title:'Delete Current Target',shortcut:'backspace'},{id:'delete-forward',title:'Delete Current Target (Forward)',shortcut:'delete'},{id:'blend-next',title:'Next Blend Mode',shortcut:'Shift+='},{id:'blend-previous',title:'Previous Blend Mode',shortcut:'Shift+-'}] as WorkspaceCommand[]).map(command=>({...command,category:'Tools'})),
 ...Array.from({length:10},(_,digit)=>({id:`opacity:${digit}`,title:`Opacity digit ${digit}`,category:'Tools',shortcut:String(digit)})),
 ...Array.from({length:10},(_,digit)=>({id:`flow:${digit}`,title:`Flow digit ${digit}`,category:'Tools'})),
 ...(['m','l','w','c','b','e','j','s','g','u','i','o','y','a'] as const).map(key=>({id:`cycle-group:${key}`,title:`Cycle ${key.toUpperCase()} tool group`,category:'Tools'})),
 ...(['left','right','up','down'] as const).flatMap(direction=>[{id:`nudge:${direction}`,title:`Nudge ${direction}`,category:'Transform',shortcut:`arrow${direction}`},{id:`nudge-fast:${direction}`,title:`Nudge ${direction} 10px`,category:'Transform',shortcut:`Shift+arrow${direction}`},{id:`nudge-pixels:${direction}`,title:`Move Selected Pixels ${direction}`,category:'Transform',shortcut:`Primary+arrow${direction}`},{id:`nudge-pixels-fast:${direction}`,title:`Move Selected Pixels ${direction} 10px`,category:'Transform',shortcut:`Primary+Shift+arrow${direction}`}]),
 {id:'palette',title:'Search Commands',category:'Help',shortcut:'Primary+f'},{id:'shortcuts',title:'Keyboard Shortcuts',category:'Settings'},
 ...Object.entries(FILTER_NAMES).map(([kind,title])=>({id:`filter:${kind}`,title,category:'Filter',enabled:!!selected.value?.imageFile})),
 ...Object.entries(NATIVE_ADJUSTMENT_KINDS).map(([kind,title])=>({id:`adjustment:${kind}`,title:`New ${title} Adjustment`,category:'Layer'})),
 {id:'repeat-filter',title:'Repeat Last Filter',category:'Filter',enabled:!!lastFilter.value&&!!selected.value?.imageFile},
 ...canvasTools.map(item=>({id:`tool:${item.mode}`,title:item.name,category:'Tools',shortcut:item.shortcut??item.name.match(/\(([A-Z])\)/)?.[1].toLowerCase(),enabled:true}))
])
function commandTitle(command: WorkspaceCommand, language: Locale): string {
 const tr=(source:string,params?:Record<string,string|number>)=>translateLocale(language,source,params)
 if(command.id.startsWith('tool:')){const mode=command.id.slice(5) as Tool,entry=railToolEntry(mode),group=toolGroupForTool(mode);if(entry&&group)return `${tr(entry.label)} (${group.id})`}
 if(command.id.startsWith('opacity:'))return tr('Opacity digit {digit}',{digit:command.id.split(':')[1]})
 if(command.id.startsWith('flow:'))return tr('Flow digit {digit}',{digit:command.id.split(':')[1]})
 if(command.id.startsWith('cycle-group:'))return tr('Cycle {key} tool group',{key:command.id.split(':')[1].toUpperCase()})
 const nudge=command.id.match(/^(nudge|nudge-fast|nudge-pixels|nudge-pixels-fast):(left|right|up|down)$/)
 if(nudge)return tr(nudge[1].includes('pixels')?(nudge[1].endsWith('fast')?'Move Selected Pixels {direction} 10px':'Move Selected Pixels {direction}'):(nudge[1].endsWith('fast')?'Nudge {direction} 10px':'Nudge {direction}'),{direction:tr(nudge[2])})
 if(command.id.startsWith('adjustment:'))return tr('New {name} Adjustment',{name:tr(NATIVE_ADJUSTMENT_KINDS[command.id.slice(11) as keyof typeof NATIVE_ADJUSTMENT_KINDS])})
 return tr(command.title)
}
const commands=computed<WorkspaceCommand[]>(()=>profileCommands(rawCommands.value,interactionProfile.value,shortcutOverrides.value,platform==='darwin'?'mac':'other').map(command=>({...command,title:commandTitle(command,locale.value),category:command.category?t(command.category):undefined,description:command.description?tm(command.description):undefined,keywords:[...(command.keywords??[]),command.title,command.category??'',command.description??'',commandTitle(command,'zh-CN'),command.category?translateLocale('zh-CN',command.category):'']})))
watch(commands,()=>{if(ready.value)void syncNativeMenuCapabilities()})
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
const maskPropertiesPreview=ref<MaskProperties>()
watch(showLayerActions,value=>{if(!value){maskPropertiesPreview.value=undefined;maskPreview.value=undefined;maskPlacementPreview.value=undefined}})
const maskAlone=ref(false),maskPreview=ref<MaskPreview>(),maskPlacementPreview=ref<Transform>(),maskGrayBackground=ref(solidMaskURL(255))
let maskBackgroundTicket=0
watch(()=>[state.value?.sessionId,selectedId.value,selected.value?.maskFile,state.value?.assets.find(asset=>asset.file===selected.value?.maskFile)?.hash],async(values,previous)=>{const targetChanged=!previous||values[0]!==previous[0]||values[1]!==previous[1];if(targetChanged){maskAlone.value=false;maskTarget.value=false}if(previous&&values.every((value,index)=>value===previous[index]))return;const ticket=++maskBackgroundTicket;maskPreview.value=undefined;maskPlacementPreview.value=undefined;maskPropertiesPreview.value=undefined;if(!selected.value?.maskFile){maskTarget.value=false;maskAlone.value=false;return}try{const url=await maskBackgroundURL(assetUrl(state.value!,selected.value.maskFile));if(ticket===maskBackgroundTicket)maskGrayBackground.value=url}catch(cause){if(ticket===maskBackgroundTicket)error.value={message:cause instanceof Error?cause.message:String(cause)}}},{flush:'sync'})
function chooseMask():void{maskTarget.value=true;if(interactionProfile.value!=='photoshop')tool.value='move'}
function maskThumbnailClick(layer:Layer,event:MouseEvent):void{
 if(layerTransformDraft.value){void finishLayerTransform(true).then(()=>{if(!layerTransformDraft.value)maskThumbnailClick(layer,event)});return}
 selectedId.value=layer.id;selectedIds.value=[layer.id]
 if(event.metaKey||event.ctrlKey){void edit({type:'selection.from_mask',layerId:layer.id,operation:thumbnailSelectionOperation(event),coverage:interactionProfile.value==='photoshop'?'visible':'hidden'});return}
 if(event.shiftKey){void edit({type:'layer.mask',layerId:layer.id,operation:layer.maskEnabled===false?'enable':'disable'});return}
 chooseMask();if(event.altKey)maskAlone.value=!maskAlone.value
}
function imageThumbnailClick(layer:Layer,event:MouseEvent):void{
 if(layerTransformDraft.value){void finishLayerTransform(true).then(()=>{if(!layerTransformDraft.value)imageThumbnailClick(layer,event)});return}
 if((event.metaKey||event.ctrlKey)&&layer.imageFile){void edit({type:'selection.from_alpha',layerId:layer.id,operation:thumbnailSelectionOperation(event)});return}
 selectLayer(layer,event);maskTarget.value=false;maskAlone.value=false;maskPreview.value=undefined;maskPlacementPreview.value=undefined
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
const vectorOverlay=ref<InstanceType<typeof VectorPathOverlay>>(),frameOverlay=ref<InstanceType<typeof FrameOverlay>>(),frameCreation=ref<InstanceType<typeof FrameCreationOverlay>>()
const vectorPaths=computed(()=>state.value?.manifest.vectorPaths??[]),vectorPathId=ref<string>(),vectorDraft=ref<VectorPath>(),vectorSelectedKnot=ref<string>()
const activeVectorPath=computed(()=>vectorDraft.value??vectorPaths.value.find(record=>record.id===vectorPathId.value)?.path??{fillRule:'nonzero' as const,subpaths:[]})
const frameKind=ref<FrameMetadata['kind']>('rectangle'),frameMode=ref<'frame'|'content'>('frame'),frameDraft=ref<FrameMetadata>(),frameContentDraft=ref<Transform>(),frameCreateNew=ref(false)
const frameSources=computed(()=>state.value?.manifest.layers.filter(layer=>layer.imageFile&&!layer.isGroup&&!layer.text&&!layer.shape&&!layer.adjustment).map(layer=>({id:layer.id,name:layer.name}))??[])
const activeFrame=computed(()=>frameDraft.value??selected.value?.frame)
type GeometryOwner=ReturnType<typeof identity>&{layerId?:string;pathId?:string}
let vectorOwner:GeometryOwner|undefined,frameOwner:GeometryOwner|undefined,vectorSettled:Promise<unknown>=Promise.resolve(),frameSettled:Promise<unknown>=Promise.resolve(),vectorCancelled=false,frameCancelled=false
function geometryPoint(x:number,y:number):[number,number]{return documentPoint({clientX:x,clientY:y} as PointerEvent)}
function vectorInteraction(active:boolean):void{if(active){vectorCancelled=false;vectorOwner={...identity(),pathId:vectorPathId.value};const owner=vectorOwner;vectorSettled=vectorSettled.then(()=>request('interaction',{sessionId:owner.sessionId,interactionId:owner.idempotencyKey,busy:true}))}else{const owner=vectorOwner;if(owner)vectorSettled=vectorSettled.then(()=>request('interaction',{sessionId:owner.sessionId,interactionId:owner.idempotencyKey,busy:false}));if(vectorCancelled)void vectorSettled.then(()=>{if(vectorOwner===owner)vectorOwner=undefined})}}
function cancelVectorDraft():void{vectorCancelled=true;vectorDraft.value=undefined}
async function commitVectorPath(path:VectorPath):Promise<void>{if(!state.value||busy.value)return;const owner=vectorOwner??{...identity(),pathId:vectorPathId.value};busy.value=true;try{await vectorSettled;const {layerId:_layer,pathId:_path,...requestId}=owner;const result=await request('apply',{...requestId,action:{type:'document.path_set',pathId:owner.pathId,name:owner.pathId?undefined:t('Work Path'),path:rpcValue(path)}});if(result){vectorDraft.value=undefined;vectorPathId.value=owner.pathId??state.value?.manifest.vectorPaths?.at(-1)?.id}}finally{busy.value=false;if(vectorOwner===owner)vectorOwner=undefined}}
function selectVectorPath(id:string):void{vectorOverlay.value?.finish(true);vectorPathId.value=id;vectorDraft.value=undefined;vectorSelectedKnot.value=undefined}
function newVectorPath():void{vectorOverlay.value?.finish(true);vectorPathId.value=undefined;vectorDraft.value={fillRule:'nonzero',subpaths:[]};vectorSelectedKnot.value=undefined;void chooseTool('pen')}
async function vectorCommand(type:'selection.from_path'|'layer.path_fill'|'layer.path_mask'|'document.path_delete',pathId:string):Promise<void>{if(!state.value||busy.value)return;if(type==='layer.path_fill'||type==='layer.path_mask'){if(!selected.value)return;await edit(type==='layer.path_fill'?{type,layerId:selected.value.id,pathId,color:color(foreground.value)}:{type,layerId:selected.value.id,pathId})}else await edit(type==='selection.from_path'?{type,pathId,operation:selectionOperation.value,antialiased:selectionAA.value}:{type,pathId});if(type==='document.path_delete'&&!state.value.manifest.vectorPaths?.some(record=>record.id===pathId)){vectorPathId.value=undefined;vectorDraft.value=undefined}}
function deleteCurrentVectorPath():void{if(vectorPathId.value)void vectorCommand('document.path_delete',vectorPathId.value);else{vectorDraft.value=undefined;vectorSelectedKnot.value=undefined}}
function frameInteraction(active:boolean):void{if(active){frameCancelled=false;frameOwner={...identity(),layerId:frameCreateNew.value?undefined:selected.value?.id};const owner=frameOwner;frameSettled=frameSettled.then(()=>request('interaction',{sessionId:owner.sessionId,interactionId:owner.idempotencyKey,busy:true}))}else{const owner=frameOwner;if(owner)frameSettled=frameSettled.then(()=>request('interaction',{sessionId:owner.sessionId,interactionId:owner.idempotencyKey,busy:false}));if(frameCancelled)void frameSettled.then(()=>{if(frameOwner===owner)frameOwner=undefined})}}
function cancelFrameDraft():void{frameCancelled=true;frameDraft.value=undefined;frameContentDraft.value=undefined}
async function commitFrame(created?:FrameMetadata):Promise<void>{if(!state.value||busy.value)return;const owner=frameOwner??{...identity(),layerId:selected.value?.id},frame=created??frameDraft.value,content=frameContentDraft.value;busy.value=true;try{await frameSettled;const action:EditAction|undefined=created?{type:'frame.create',name:t('Frame'),kind:created.kind,bounds:created.bounds}:owner.layerId&&content?{type:'frame.set_content_transform',layerId:owner.layerId,transform:rpcValue(content)}:owner.layerId&&frame?{type:'frame.set_bounds',layerId:owner.layerId,bounds:frame.bounds,kind:frame.kind}:undefined;if(action){const {layerId:_layer,pathId:_path,...requestId}=owner;const result=await request('apply',{...requestId,action});if(result){frameDraft.value=undefined;frameContentDraft.value=undefined;frameCreateNew.value=false}}}finally{busy.value=false;if(frameOwner===owner)frameOwner=undefined}}
async function placeFrameImage(value:{sourceId:string;fit:'cover'|'contain'}):Promise<void>{if(!selected.value?.frame||value.sourceId===selected.value.id)return;await editMany([{type:'frame.place',layerId:selected.value.id,...value},{type:'layer.set_visibility',layerId:value.sourceId,visible:false}],t('Place frame image'))}
function newFrame():void{frameCreation.value?.finish(true);frameOverlay.value?.finish(true);frameDraft.value=undefined;frameContentDraft.value=undefined;frameCreateNew.value=true}
watch(()=>state.value?.sessionId,()=>{vectorPathId.value=undefined;vectorDraft.value=undefined;frameDraft.value=undefined;frameContentDraft.value=undefined;frameCreateNew.value=false})
watch(()=>selectedId.value,()=>{frameDraft.value=undefined;frameContentDraft.value=undefined;frameCreateNew.value=false})
watch([zoom,viewAngle],()=>{vectorOverlay.value?.finish(true);frameCreation.value?.finish(true);frameOverlay.value?.finish(true)})
const displayState = computed(() => {
  if (!state.value) return undefined
  if(tool.value==='frame'&&!frameCreateNew.value&&selected.value?.frame&&(frameContentDraft.value||frameDraft.value)){const manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(item=>item.id===selected.value!.id);if(layer){if(frameContentDraft.value)layer.transform=structuredClone(rpcValue(frameContentDraft.value));if(frameDraft.value&&layer.maskPlacement){layer.frame=structuredClone(rpcValue(frameDraft.value));layer.maskPlacement={origin:[frameDraft.value.bounds[0],frameDraft.value.bounds[1]],size:[frameDraft.value.bounds[2],frameDraft.value.bounds[3]],rotation:0,flipX:false,flipY:false,sampling:'Smooth'}}}return {...state.value,manifest}}
  if(patchPreview.value&&patchOwner.value){const p=patchPreview.value,manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(l=>l.id===patchOwner.value),asset=state.value.assets.find(a=>a.file===layer?.imageFile);if(layer&&asset){layer.imageFile=p.url;layer.transform=p.transform;return {...state.value,manifest,assets:[...state.value.assets,{file:p.url,hash:p.url,width:asset.width,height:asset.height}]}}}
  if(tool.value==='crop'&&cropAngle.value){const manifest=structuredClone(rpcValue(state.value.manifest)),{width,height}=manifest;for(const layer of manifest.layers){layer.transform=straightenPlacement(layer.transform,width,height,cropAngle.value);if(layer.maskPlacement)layer.maskPlacement=straightenPlacement(layer.maskPlacement,width,height,cropAngle.value)}return {...state.value,manifest}}
  if(floatingSelection.value){const f=floatingSelection.value,preview=f.preview,placed=preview?.previewTransform??f.transform,pixelsURL=preview?.pixelsURL??f.pixelsURL,manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(item=>item.id===f.layerId),assets=[...state.value.assets];if(layer){layer.imageFile=f.clearedURL;delete layer.text;delete layer.shape;const at=manifest.layers.indexOf(layer);manifest.layers.splice(at+1,0,{...structuredClone(layer),id:'F0000000-0000-4000-8000-000000000000',name:'Floating Selection',imageFile:pixelsURL,maskFile:undefined,maskSourceID:undefined,effects:undefined,transform:structuredClone(rpcValue(placed))});assets.push({file:f.clearedURL,hash:f.clearedURL,width:f.sourceWidth,height:f.sourceHeight},{file:pixelsURL,hash:pixelsURL,width:preview?.width??f.width,height:preview?.height??f.height})}return {...state.value,manifest,assets}}
  if(strokePreview.value&&strokePreviewOwner){const preview=strokePreview.value,manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(l=>l.id===strokePreviewOwner),assets=[...state.value.assets];if(layer){layer.transform=structuredClone(rpcValue(preview.transform));layer.maskPlacement=preview.maskPlacement;if(maskTarget.value)layer.maskFile=preview.url;else{layer.imageFile=preview.url;delete layer.text;delete layer.shape;if(preview.maskUrl){layer.maskFile=preview.maskUrl;assets.push({file:preview.maskUrl,hash:`stroke-mask-${preview.requestId}`,width:preview.maskWidth!,height:preview.maskHeight!})}}assets.push({file:preview.url,hash:`stroke-${preview.requestId}-${strokePreviewOwner}`,width:preview.width,height:preview.height})}return {...state.value,manifest,assets}}
  if(subjectDraft.value&&subjectPreview.value)return subjectPreview.value.state
  if(gradientDraft.value&&gradientPreview.value){const manifest=structuredClone(rpcValue(state.value.manifest)),layer=manifest.layers.find(item=>item.id===gradientDraft.value!.layerId),preview=gradientPreview.value,assets=[...state.value.assets];if(layer){layer.transform=preview.transform;layer.maskPlacement=preview.maskPlacement;if(gradientDraft.value.target==='mask')layer.maskFile=preview.url;else {layer.imageFile=preview.url;delete layer.text;delete layer.shape;if(preview.maskUrl){layer.maskFile=preview.maskUrl;assets.push({file:preview.maskUrl,hash:`gradient-mask-${preview.requestId}`,width:preview.maskWidth!,height:preview.maskHeight!})}}assets.push({file:preview.url,hash:`gradient-${preview.requestId}`,width:preview.width,height:preview.height})}return {...state.value,manifest,assets}}
  if(contentOnCanvas.value&&contentPreview.value){const p=contentPreview.value,manifest=structuredClone(rpcValue(state.value.manifest)),assets=[...state.value.assets];let layer=manifest.layers.find(item=>item.id===p.layerId);if(!layer){layer={id:'F0000000-0000-4000-8000-000000000001',name:'Content Preview',isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',transform:structuredClone(rpcValue(p.transform))};manifest.layers.push(layer)}if(layer.maskFile&&!layer.maskPlacement&&p.layerId)layer.maskPlacement=structuredClone(rpcValue(layer.transform));layer.imageFile=p.url;layer.transform=structuredClone(rpcValue(p.transform));delete layer.text;delete layer.shape;assets.push({file:p.url,hash:`content-${p.ticket}`,width:p.raster.width,height:p.raster.height});return {...state.value,manifest,assets}}
  if(selectedId.value&&(maskAlone.value||maskPreview.value||maskPlacementPreview.value||maskDraft.value||maskPropertiesPreview.value))return maskDisplayState(toRaw(state.value),selectedId.value,maskPreview.value&&toRaw(maskPreview.value),(maskDraft.value??maskPlacementPreview.value)&&toRaw((maskDraft.value??maskPlacementPreview.value)!),maskAlone.value,maskGrayBackground.value,maskPropertiesPreview.value&&toRaw(maskPropertiesPreview.value))
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
async function toolTransport<T=unknown>(method:string,params?:unknown):Promise<T|undefined>{
 if(!['magneticLassoPreview','documentInfoRead'].includes(method))return request<T>(method,params)
 const result=await window.compositor.request<T>(method,rpcValue(params))
 if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`)
 return result.value
}
function install(next: EditorState): void {
  if (next.workspace && next.workspace.activeSessionId !== next.sessionId) return
  if (!next.workspace && state.value && next.sessionId !== state.value.sessionId) return
  const changedSession = state.value?.sessionId !== next.sessionId
  if (changedSession && state.value) views.set(state.value.sessionId, { selectedId: selectedId.value, selectedIds: [...selectedIds.value], collapsed: [...collapsedGroups.value], zoom: zoom.value, viewAngle:viewAngle.value, scrollX: viewport.value?.scrollLeft ?? 0, scrollY: viewport.value?.scrollTop ?? 0, panX:panOffset.value.x,panY:panOffset.value.y,tool: tool.value, autoSelect: autoSelect.value, linked: linked.value, showControls: showControls.value })
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
    quickMask.value=false;lastBrush.value=undefined;lastQuickMaskBrush.value=undefined;if(quickMaskColors)[foreground.value,background.value]=quickMaskColors;quickMaskColors=undefined;
    contentCanvas.value?.cancel();panOffset.value={x:0,y:0}
    const saved = views.get(next.sessionId)
    viewAngle.value=saved?.viewAngle??0
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
const rasterizePending=ref<{request:ReturnType<typeof identity>;layerId:string;selectedIds:string[];name:string}>(),rasterizeBusy=ref(false)
async function confirmRasterize():Promise<void>{
 const pending=rasterizePending.value;if(!pending||rasterizeBusy.value)return
 const current=state.value
 if(!current||current.sessionId!==pending.request.sessionId||current.manifest.documentID!==pending.request.documentId||current.revision!==pending.request.expectedRevision||selectedId.value!==pending.layerId||selectedIds.value.join(',')!==pending.selectedIds.join(',')||maskTarget.value||quickMask.value){rasterizePending.value=undefined;error.value={message:'The layer changed while the rasterization dialog was open. Try the tool again.'};return}
 rasterizeBusy.value=true
 try{const result=await request('apply',{...toRaw(pending.request),action:{type:'layer.rasterize',layerId:pending.layerId}});if(result)rasterizePending.value=undefined}
 finally{rasterizeBusy.value=false}
}
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
  if(event.altKey){event.preventDefault();return}
  if (!selectedIds.value.includes(layer.id)) { selectedIds.value = [layer.id]; selectedId.value = layer.id }
  event.dataTransfer.setData('application/x-compositor-layers', JSON.stringify({ sessionId:state.value.sessionId,documentId:state.value.manifest.documentID,expectedRevision:state.value.revision,layerIds:[...selectedIds.value] }))
  event.dataTransfer.effectAllowed = 'copyMove'
}
let tabDragTimer:ReturnType<typeof setTimeout>|undefined
function leaveDocumentTab():void{clearTimeout(tabDragTimer)}
const newDropTarget=ref(false)
function documentDrag(event:DragEvent):boolean{return !event.altKey&&!!event.dataTransfer?.types.some(type=>type==='application/x-compositor-layers'||type==='Files')}
function hoverNewDocument(event:DragEvent):void{if(!documentDrag(event))return;event.preventDefault();event.stopPropagation();leaveDocumentTab();newDropTarget.value=true;if(event.dataTransfer)event.dataTransfer.dropEffect='copy'}
async function dropNewDocument(event:DragEvent):Promise<void>{newDropTarget.value=false;leaveDocumentTab();if(!documentDrag(event))return;event.preventDefault();event.stopPropagation();if(event.dataTransfer?.files.length){await dropFiles(event,'new');return}const raw=event.dataTransfer?.getData('application/x-compositor-layers');if(!raw)return;try{const payload=JSON.parse(raw) as {sessionId:string;documentId:string;expectedRevision:number;layerIds:string[]};const result=await request<EditorState&{createdIds:Record<string,string>}>('transferLayersToNew',{source:{sessionId:payload.sessionId,documentId:payload.documentId,expectedRevision:payload.expectedRevision},layerIds:payload.layerIds});if(result){install(result);selectedIds.value=payload.layerIds.map(id=>result.createdIds[id]).filter(Boolean);selectedId.value=selectedIds.value[0]}}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}}
function hoverDocumentTab(sessionId:string,event:DragEvent):void{if(!documentDrag(event))return;event.preventDefault();event.stopPropagation();newDropTarget.value=false;if(event.dataTransfer)event.dataTransfer.dropEffect='copy';clearTimeout(tabDragTimer);if(state.value?.sessionId!==sessionId)tabDragTimer=setTimeout(()=>void task('switchDocument',{sessionId}),450)}
async function dropDocumentLayers(sessionId:string,event:DragEvent,point?:[number,number]):Promise<void>{
 clearTimeout(tabDragTimer);newDropTarget.value=false;if(!documentDrag(event))return;if(event.dataTransfer?.files.length){await dropFiles(event,sessionId);return}const raw=event.dataTransfer?.getData('application/x-compositor-layers');if(!raw)return;event.preventDefault();event.stopPropagation()
 try{const payload=JSON.parse(raw) as {sessionId:string;documentId:string;expectedRevision:number;layerIds:string[]};if(payload.sessionId===sessionId)return;const document=documents.value.find(doc=>doc.sessionId===sessionId);if(!document)return;const result=await request<{createdIds?:Record<string,string>}>('transferLayers',{source:{sessionId:payload.sessionId,documentId:payload.documentId,expectedRevision:payload.expectedRevision},request:{sessionId,documentId:document.documentId,expectedRevision:document.revision,idempotencyKey:crypto.randomUUID()},layerIds:payload.layerIds,point});if(result?.createdIds){selectedIds.value=payload.layerIds.map(id=>result.createdIds![id]).filter(Boolean);selectedId.value=selectedIds.value[0]}}
 catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}
}
async function pasteOnNewCanvas():Promise<void>{if(!state.value||busy.value)return;busy.value=true;try{const result=await request<{handled:boolean;state?:EditorState}>('newCanvasPaste',{...identity(),dimensionField:!!document.activeElement?.matches('.new-dimensions input')});if(result?.state)install(result.state);else if(result&&!result.handled&&document.activeElement?.matches('input,textarea,[contenteditable]'))await request('textEdit',{command:'paste'})}finally{busy.value=false}}
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
  if(contentMoveDraft.value){await finishContentMove();return}
  if(drag||pointerFinish.active)await pointerUp(true)
  if(layerTransformDraft.value){await finishLayerTransform();return}
  if(cropDraft.value){cancelCrop();return}
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
    if(contentMoveDraft.value)await finishContentMove()
    cropOverlay.value?.finish(true);cropGeometryOverlay.value?.finish(true);await cropOverlaySettled
    if(contentOnCanvas.value&&!await contentCanvas.value?.commit())return
    if(layerTransformDraft.value){await finishLayerTransform(true);if(layerTransformDraft.value)return}
  if(gradientDraft.value){await finishGradient(true);if(gradientDraft.value)return}
    if(polygonRequest.value)await finishPolygon(true)
    if(floatingSelection.value){await endSelectionTransform(true);if(floatingSelection.value)return}
    cropDraft.value=undefined;cropRequest.value=undefined;resetCropGeometry();cropMode.value='crop'
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
  const rotated=rotateVector({x:state.value.manifest.width,y:0},viewAngle.value),other=rotateVector({x:0,y:state.value.manifest.height},viewAngle.value)
  zoom.value = Math.max(.001, Math.min(4, (viewport.value.clientWidth - 96) / (Math.abs(rotated.x)+Math.abs(other.x)), (viewport.value.clientHeight - 96) / (Math.abs(rotated.y)+Math.abs(other.y))))
}
function stepZoom(factor:number,event?:{clientX:number;clientY:number}):void {
 if(!viewport.value||!canvasWrap.value){zoom.value=Math.min(32,Math.max(.001,zoom.value*factor));return}
 const v=viewport.value.getBoundingClientRect(),screen={x:event?event.clientX-v.left:viewport.value.clientWidth/2,y:event?event.clientY-v.top:viewport.value.clientHeight/2},world=clientToDocument({x:v.left+screen.x,y:v.top+screen.y},currentViewGeometry())
 zoom.value=Math.min(32,Math.max(.001,zoom.value*factor));void nextTick(()=>{if(!viewport.value||!canvasWrap.value)return;const moved=documentToClient(world,currentViewGeometry()),view=viewport.value.getBoundingClientRect(),dx=moved.x-view.left-screen.x,dy=moved.y-view.top-screen.y,oldX=viewport.value.scrollLeft,oldY=viewport.value.scrollTop;viewport.value.scrollLeft+=dx;viewport.value.scrollTop+=dy;panOffset.value={x:panOffset.value.x-dx+viewport.value.scrollLeft-oldX,y:panOffset.value.y-dy+viewport.value.scrollTop-oldY};void nextTick(updateViewGeometry)})
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
function loseWindowFocus():void{void finishContentMove();cancelToolHold();closeToolFlyout();spacePan.value=false;middleUp();void pointerUp(true)}
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
  const [x,y]=documentPoint(event)
  const hit = engine.hitTest(state.value, x, y)
  if((event.metaKey||event.ctrlKey)&&event.shiftKey){if(hit)selectedIds.value=selectedIds.value.includes(hit)?selectedIds.value.filter(id=>id!==hit):[...selectedIds.value,hit];selectedId.value=selectedIds.value.includes(hit??'')?hit:selectedIds.value.at(-1);return}
  if (!hit || !selectedIds.value.includes(hit)) selectedIds.value = hit ? [hit] : []
  selectedId.value = hit

}
type Drag = { mixerReservoir?:MixerBrushReservoir;historySourceId?:string;startX: number; startY: number; mode: string; transform?: Transform; transforms?: { id: string; transform: Transform }[]; scrollX?: number; scrollY?: number; panX?:number;panY?:number;request?: ReturnType<typeof identity>; layerId?: string; ready: Promise<boolean>; pointerId: number; target: HTMLElement; alt?:boolean; selection?:Selection; operation?:'replace'|'add'|'subtract'|'intersect';shiftAtStart?:boolean;shared?:boolean;mask?:boolean;manifest?:EditorState['manifest'];layerIds?:string[];seed?:number;overflow?:boolean;gradientBefore?:{start:[number,number];end:[number,number]} }
let drag: Drag | undefined
function currentViewGeometry(){const box=canvasWrap.value!.getBoundingClientRect();return {center:{x:box.left+box.width/2,y:box.top+box.height/2},width:state.value!.manifest.width,height:state.value!.manifest.height,zoom:zoom.value,angle:viewAngle.value}}
function documentPoint(event:{clientX:number;clientY:number}):[number,number]{const p=clientToDocument({x:event.clientX,y:event.clientY},currentViewGeometry());return [p.x,p.y]}
let viewRotationDrag:{pointerId:number;target:HTMLElement;center:{x:number;y:number};start:number;angle:number}|undefined
function updateSelectionDraft():void{
 if(!drag||!rasterPoints.value.length||!state.value)return
 const points=drag.mode==='raster:lasso'?compactStroke(rasterPoints.value,.125):rasterPoints.value
 const polygon=drag.mode==='raster:lasso';if(polygon&&points.length<3)return
 const a=points[0],b=points.at(-1)!,xs=polygon?points.map(p=>p[0]):[a[0],b[0]],ys=polygon?points.map(p=>p[1]):[a[1],b[1]]
 let x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y
 const single=drag.mode==='raster:marquee'&&marqueeAxis.value!=='area';if(single){if(marqueeAxis.value==='row'){x=0;y=Math.max(0,Math.min(state.value.manifest.height-1,Math.floor(b[1])));w=state.value.manifest.width;h=1}else{x=Math.max(0,Math.min(state.value.manifest.width-1,Math.floor(b[0])));y=0;w=1;h=state.value.manifest.height}}
 const kind=drag.mode==='raster:object'?'rectangle':polygon?'polygon':!single&&ellipseSelection.value?'ellipse':'rectangle'
 try{draftSelection.value=appendSelectionShape(toRaw(state.value.selection),{kind,operation:drag.mode==='raster:object'?'replace':drag.operation??'replace',bounds:[x,y,w,h],points:polygon?points:undefined,feather:drag.mode==='raster:object'?0:feather.value},state.value.manifest.width,state.value.manifest.height,single?false:selectionAA.value,interactionProfile.value);draftSelection.value.antialiased=single?false:selectionAA.value;draftSelection.value.canvasSize=[state.value.manifest.width,state.value.manifest.height]}catch(cause){error.value={message:cause instanceof Error?cause.message:String(cause)}}
}

let brushTipDrag:{startX:number;diameter:number;hardness:number;pointerId:number;target:HTMLElement}|undefined
function sampleForeground(event:PointerEvent):void{if(!canvas.value||!viewportPlan.value)return;const p=documentPoint(event),ctx=canvas.value.getContext('2d'),r=viewportPlan.value.region,x=Math.floor((p[0]-r.x)*canvas.value.width/r.width),y=Math.floor((p[1]-r.y)*canvas.value.height/r.height);if(ctx&&x>=0&&y>=0&&x<canvas.value.width&&y<canvas.value.height){const rgba=ctx.getImageData(x,y,1,1).data;foreground.value='#'+[...rgba.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('')}}
function pointerDown(event: PointerEvent, mode = 'move'): void {
  if(infoTools.active.value||contentMoveDraft.value||contentMoveFinishing.value)return
  if(!spacePan.value&&event.button===0&&(tool.value==='color-sampler'||tool.value==='eyedropper'&&event.shiftKey)){infoTools.startSample(event);if(tool.value==='eyedropper')void infoTools.finish();event.preventDefault();return}
  if(!spacePan.value&&event.button===0&&tool.value==='ruler'){infoTools.startRuler(event);event.preventDefault();return}
  if(!spacePan.value&&event.button===0&&tool.value==='lasso'&&lassoMode.value==='magnetic'){magnetic.start(event);event.preventDefault();return}
  if(rasterizePending.value||toolFlyout.value)return
  if(event.button===0&&showColorRange.value&&!spacePan.value){const previous=foreground.value;sampleForeground(event);const sampled=foreground.value;if(event.altKey||colorRangeSampling.value==='exclude'){colorRangeExcluded.value.push(sampled);foreground.value=previous}else if(event.shiftKey||colorRangeSampling.value==='include'){colorRangeIncluded.value.push(sampled);foreground.value=previous}event.preventDefault();return}
  if(event.button===2&&['selection-brush','brush','pencil','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','heal','clone','smear'].includes(tool.value)&&!drag&&!spacePan.value){const target=event.currentTarget as HTMLElement;brushTipDrag={startX:event.clientX,diameter:brushSize.value,hardness:hardness.value,pointerId:event.pointerId,target};target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if (event.button !== 0 || busy.value || switchingTool || pointerFinish.active || !state.value || !viewport.value || drag || showDistort.value&&!spacePan.value&&tool.value!=='hand') return
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
  contextLayer.value = undefined
  if(['nw','ne','se','sw'].includes(mode)&&(event.metaKey||event.ctrlKey)&&(selected.value?.imageFile||independentMask.value)&&!sharedTargets.value&&(!maskTarget.value||independentMask.value)&&canvasWrap.value){openDistort();if(showDistort.value)startDistortDrag(event,['nw','ne','se','sw'].indexOf(mode),canvasWrap.value);return}
  if(paletteTarget.value&&canvas.value&&viewportPlan.value){const p=documentPoint(event),r=viewportPlan.value.region,ctx=canvas.value.getContext('2d'),x=Math.floor((p[0]-r.x)*canvas.value.width/r.width),y=Math.floor((p[1]-r.y)*canvas.value.height/r.height);if(ctx&&x>=0&&y>=0&&x<canvas.value.width&&y<canvas.value.height){const rgba=ctx.getImageData(x,y,1,1).data;paletteSample.value='#'+[...rgba.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('')}event.preventDefault();return}
  if((tool.value==='text'||tool.value==='shape')&&!spacePan.value){if(contentOnCanvas.value){event.preventDefault();void contentCanvas.value?.commit();return}showContent.value=tool.value;let existing:Layer|undefined;if(tool.value==='text'){const point=documentPoint(event),hit=engine.hitTest(state.value,point[0],point[1]);existing=state.value.manifest.layers.find(layer=>layer.id===hit&&layer.text)??[...state.value.manifest.layers].reverse().find(layer=>contentLayerVisible(state.value!.manifest.layers,layer.id)&&layer.text&&contentBoxContains(layer.transform,point));if(existing){selectedId.value=existing.id;selectedIds.value=[existing.id]}}contentCanvas.value?.start(event,tool.value,documentPoint,identity(),existing,contentToolDraft.value);return}
  if(tool.value==='magic'&&!spacePan.value&&selected.value){void edit({type:'selection.wand',layerId:selected.value.id,point:documentPoint(event),tolerance:wandTolerance.value,contiguous:wandContiguous.value,sampleSize:wandSampleSize.value,sampleAllLayers:wandAllLayers.value,antialiased:selectionAA.value,operation:selectionPointerOperation(event)});return}
  if(!spacePan.value&&(tool.value==='clone'||tool.value==='heal'&&retouchMode.value==='heal')&&event.altKey){cloneSource.value=documentPoint(event);cloneHover.value=cloneSource.value;cloneOffset.value=undefined;cloneActiveOffset.value=undefined;return}
  if(!spacePan.value&&['brush','pencil','paint-bucket','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','heal','smear'].includes(tool.value)&&event.altKey&&!(tool.value==='heal'&&retouchMode.value==='heal')){sampleForeground(event);event.preventDefault();return}
  if(!spacePan.value&&!maskTarget.value&&!quickMask.value&&['brush','pencil','paint-bucket','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','magic-eraser','heal','clone','smear','gradient'].includes(tool.value)&&selected.value&&(selected.value.text||selected.value.shape)){
    rasterizePending.value={request:identity(),layerId:selected.value.id,selectedIds:[...selectedIds.value],name:selected.value.name};event.preventDefault();return
  }
  if(tool.value==='eyedropper'&&!spacePan.value&&canvas.value&&viewportPlan.value){sampleRingOriginal.value=foreground.value;sampleRingActive.value=true;sampleDocumentColor(event);const target=event.currentTarget as HTMLElement;target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if (tool.value === 'zoom'&&!spacePan.value) { stepZoom(event.altKey ? 1 / 1.2 : 1.2,event); return }
  const target = event.currentTarget as HTMLElement
  if(tool.value==='rotate-view'&&!spacePan.value){const center=currentViewGeometry().center;viewRotationDrag={target,pointerId:event.pointerId,center,start:Math.atan2(event.clientY-center.y,event.clientX-center.x),angle:viewAngle.value};target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if(tool.value==='gradient'&&!spacePan.value&&selected.value){
    const point=documentPoint(event),existing=gradientDraft.value,started=existing?.request??identity(),before=existing?{start:[...existing.start] as [number,number],end:[...existing.end] as [number,number]}:undefined
    const endpoint=mode==='gradient-start'?'start':'end'
    if(!existing){gradientDraft.value={request:started,layerId:selected.value.id,target:maskTarget.value?'mask':'image',start:point,end:point};gradientPreview.value=undefined}
    else if(!mode.startsWith('gradient-')){existing.start=point;existing.end=point}
    drag={startX:event.clientX,startY:event.clientY,mode:`gradient:${endpoint}`,request:started,layerId:selected.value.id,pointerId:event.pointerId,target,gradientBefore:before,ready:request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true}).then(value=>!!value&&state.value?.revision===started.expectedRevision)}
    target.setPointerCapture(event.pointerId);event.preventDefault();return
  }
  if(tool.value==='lasso'&&lassoMode.value==='polygon'&&!spacePan.value){if(!polygonRequest.value){polygonOperation.value=selectionPointerOperation(event);polygonRequest.value=identity();const captured=polygonRequest.value;polygonReady.value=request('interaction',{sessionId:captured.sessionId,interactionId:captured.idempotencyKey,busy:true}).then(value=>!!value&&state.value?.revision===captured.expectedRevision)}polygonPoints.value.push(documentPoint(event));if(event.detail>=2)void finishPolygon();event.preventDefault();return}
  if(!spacePan.value&&['marquee','lasso','magic'].includes(tool.value)&&selectionOperation.value==='replace'&&state.value.selection&&!event.shiftKey&&!event.altKey&&selectionCoverage(state.value.selection,...documentPoint(event))>0){const started=identity();drag={startX:event.clientX,startY:event.clientY,mode:'selection-move',request:started,selection:structuredClone(rpcValue(state.value.selection)),pointerId:event.pointerId,target,ready:request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true}).then(value=>!!value)};target.setPointerCapture(event.pointerId);event.preventDefault();return}
  if(['remove','content-move','red-eye','quick-selection','patch','selection-brush','object','marquee','lasso','crop','brush','pencil','paint-bucket','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','magic-eraser','gradient','heal','clone','smear'].includes(tool.value)&&!spacePan.value){
    if(['remove','content-move','red-eye','brush','pencil','paint-bucket','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','magic-eraser','gradient','heal','clone','smear','quick-selection','patch'].includes(tool.value)&&!selected.value&&!quickMask.value)return
    if(['remove','content-move','red-eye','quick-selection','patch'].includes(tool.value)&&(maskTarget.value||!selected.value?.imageFile)){if(['remove','content-move','red-eye'].includes(tool.value))error.value={message:'Select a raster image layer to use this tool.'};return}
    if((tool.value==='background-eraser'||tool.value==='magic-eraser')&&!selected.value?.imageFile){error.value={message:'Select a raster image layer to use this tool.'};return}
    if(tool.value==='object'&&(!selected.value||maskTarget.value||imageOperation.value))return
    if(tool.value==='clone'){if(maskTarget.value){error.value={message:'Clone Stamp works on image pixels. Select the image thumbnail to paint.'};return}if(!cloneSource.value){error.value={message:'Alt-click an image to choose the Clone Stamp source.'};return}cloneHover.value=documentPoint(event);cloneActiveOffset.value=cloneStrokeOffset(cloneSource.value,cloneHover.value,cloneAligned.value,cloneOffset.value)}
    if(['history-brush','art-history-brush'].includes(tool.value)&&!state.value.historyBrush?.sourceId){error.value={message:'Capture a History Brush source before painting.'};return}
    const started=identity(),point=documentPoint(event);rasterPoints.value=quickMask.value&&event.shiftKey&&lastQuickMaskBrush.value?[lastQuickMaskBrush.value,point]:!quickMask.value&&event.shiftKey&&['brush','pencil','eraser'].includes(tool.value)&&!!lastBrush.value&&lastBrush.value.layerId===selectedId.value&&lastBrush.value.mask===maskTarget.value?[lastBrush.value.point,point]:[point];const penPressure=brushPointerPressure(event);rasterPressures.value=['selection-brush','brush','pencil','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser'].includes(tool.value)&&(pressureSize.value||pressureOpacity.value)&&penPressure!==undefined?rasterPoints.value.map(()=>penPressure):undefined;if(tool.value==='crop'){cropDraft.value=undefined;cropRequest.value=undefined}
    drag={startX:event.clientX,startY:event.clientY,mixerReservoir:tool.value==='mixer-brush'?structuredClone(rpcValue(mixerReservoir.value)):undefined,historySourceId:state.value.historyBrush?.sourceId??undefined,mode:`raster:${['patch','content-move'].includes(tool.value)&&(event.shiftKey||event.altKey||!(state.value.selection&&selectionCoverage(state.value.selection,...point)>0))?'lasso':tool.value}`,request:started,layerId:selectedId.value,seed:Math.floor(Math.random()*0x100000000),pointerId:event.pointerId,target,operation:tool.value==='quick-selection'?(event.altKey?'subtract':event.shiftKey?'add':quickOperation.value):tool.value==='selection-brush'?(event.altKey?'subtract':selectionBrushMode.value):selectionPointerOperation(event),shiftAtStart:event.shiftKey,ready:request('interaction',{sessionId:started.sessionId,interactionId:started.idempotencyKey,busy:true}).then(result=>!!result&&state.value?.revision===started.expectedRevision)}
    if(tool.value==='red-eye')redEyeDraft.value=redEyeBounds(rasterPoints.value);if(['object','marquee','lasso'].includes(tool.value)||drag?.mode==='raster:lasso')updateSelectionDraft();else scheduleStrokePreview()
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
  if(infoTools.active.value){infoTools.move(event);return}
  if(magnetic.active.value&&!spacePan.value){magnetic.move(event);return}
  if(pointerFinish.active)return
  if(viewRotationDrag){const r=viewRotationDrag;if(event.pointerId!==r.pointerId)return;let angle=r.angle+(Math.atan2(event.clientY-r.center.y,event.clientX-r.center.x)-r.start)*180/Math.PI;if(event.shiftKey)angle=Math.round(angle/15)*15;viewAngle.value=angle;return}
  if(sampleRingActive.value){sampleDocumentColor(event);return}
  if(canvasWrap.value){brushHover.value=documentPoint(event);cursorSampling.value=event.altKey}
  if(brushTipDrag){const tip=brushTipDrag,dx=event.clientX-tip.startX;if(event.shiftKey){hardness.value=Math.max(0,Math.min(1,tip.hardness+dx/200));brushSize.value=tip.diameter}else{brushSize.value=Math.max(1,Math.min(2000,Math.round(tip.diameter+2*dx/zoom.value)));hardness.value=tip.hardness}return}
  if(distortDrag){moveDistortDrag(event);return}
  if(tool.value==='clone'&&canvasWrap.value)cloneHover.value=documentPoint(event)
  if (!drag||event.pointerId!==drag.pointerId) return
  if(drag.mode.startsWith('gradient:')&&gradientDraft.value){const endpoint=drag.mode==='gradient:start'?'start':'end',anchor=gradientDraft.value[endpoint==='start'?'end':'start'];let point=documentPoint(event);if(event.shiftKey){const dx=point[0]-anchor[0],dy=point[1]-anchor[1],length=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;point=[anchor[0]+Math.cos(angle)*length,anchor[1]+Math.sin(angle)*length]}gradientDraft.value[endpoint]=point;return}
  if(drag.mode==='selection-move'&&drag.selection){const delta=rotateVector({x:(event.clientX-drag.startX)/zoom.value,y:(event.clientY-drag.startY)/zoom.value},-viewAngle.value);draftSelection.value=translateSelection(drag.selection,[Math.round(delta.x),Math.round(delta.y)]);return}
  if(drag.mode==='raster:object'){const a=rasterPoints.value[0],p=documentPoint(event),dx=p[0]-a[0],dy=p[1]-a[1],side=Math.max(Math.abs(dx),Math.abs(dy));rasterPoints.value=[a,event.shiftKey?[a[0]+(dx<0?-1:1)*side,a[1]+(dy<0?-1:1)*side]:p];updateSelectionDraft();return}
  if(drag.mode==='raster:crop'){const point=documentPoint(event);rasterPoints.value=[rasterPoints.value[0],point];cropDraft.value=createCropRectangle(rasterPoints.value[0],point,cropAspect(),event.altKey,cropSnap.value,event.ctrlKey);return}
  if(['raster:patch','raster:content-move','raster:red-eye'].includes(drag.mode)){rasterPoints.value=[rasterPoints.value[0],documentPoint(event)];if(drag.mode==='raster:red-eye')redEyeDraft.value=redEyeBounds(rasterPoints.value);scheduleStrokePreview();return}
  if(drag.mode.startsWith('raster:')){if(drag.mode==='raster:magic-eraser'||drag.mode==='raster:paint-bucket')return;let p=documentPoint(event);if(drag.mode==='raster:quick-selection'&&state.value)p=clampSelectionPoint(p);if(drag.mode==='raster:marquee'&&marqueeAxis.value==='area'&&event.shiftKey&&!drag.shiftAtStart){const a=rasterPoints.value[0],dx=p[0]-a[0],dy=p[1]-a[1],side=Math.max(Math.abs(dx),Math.abs(dy));p=[a[0]+(dx<0?-1:1)*side,a[1]+(dy<0?-1:1)*side]}if(rasterPoints.value.length>=100000){drag.overflow=true;error.value={message:'This interaction exceeds 100,000 points. The stroke was canceled without changing the image.'};return}rasterPoints.value.push(p);if(rasterPressures.value)rasterPressures.value.push(brushPointerPressure(event)??rasterPressures.value.at(-1)??1);if(!rasterPressures.value&&rasterPoints.value.length>4096&&rasterPoints.value.length%256===0&&['raster:brush','raster:pencil','raster:mixer-brush','raster:dodge','raster:burn','raster:sponge','raster:history-brush','raster:art-history-brush','raster:eraser','raster:background-eraser','raster:heal','raster:clone','raster:smear'].includes(drag.mode))rasterPoints.value=compactStroke(rasterPoints.value,Math.min(.125,brushSize.value*.005));if(['raster:marquee','raster:lasso'].includes(drag.mode))updateSelectionDraft();else scheduleStrokePreview();return}
  if (drag.mode === 'pan' && viewport.value) { const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;viewport.value.scrollLeft=drag.scrollX!-dx;viewport.value.scrollTop=drag.scrollY!-dy;panOffset.value={x:drag.panX!+dx-drag.scrollX!+viewport.value.scrollLeft,y:drag.panY!+dy-drag.scrollY!+viewport.value.scrollTop};void nextTick(updateViewGeometry);return }
  if (!drag.transform || !draft.value) return
  const t = drag.transform,delta=rotateVector({x:(event.clientX-drag.startX)/zoom.value,y:(event.clientY-drag.startY)/zoom.value},-viewAngle.value);let dx=delta.x,dy=delta.y
  if (drag.mode === 'move') {
    const locked=constrainMove([dx,dy],event.shiftKey);dx=locked[0];dy=locked[1]
    const rect=selectionBounds(state.value!.manifest,selectedIds.value),layers=state.value!.manifest.layers.filter(layer=>!layer.isGroup).map(layer=>({...transformBounds(layer.transform),id:layer.id,visible:contentLayerVisible(state.value!.manifest.layers,layer.id)}))
    if(rect){const snapped=snapRect(rect,{x:dx,y:dy},{enabled:snapEnabled.value&&!event.ctrlKey,zoom:zoom.value,document:state.value!.manifest,layers,movingIds:movingLayers.value.map(layer=>layer.id),guides:state.value!.manifest.guides,grid:grid.value,gridVisible:gridVisible.value,guidesVisible:guidesVisible.value});dx=event.shiftKey&&locked[0]===0?0:snapped.delta.x;dy=event.shiftKey&&locked[1]===0?0:snapped.delta.y}
    draft.value.origin = [t.origin[0] + dx, t.origin[1] + dy]
    draftTransforms.value = drag.transforms?.map(item => ({ id: item.id, transform: { ...item.transform, origin: [item.transform.origin[0] + dx, item.transform.origin[1] + dy] } })) ?? []
  }
  else if (drag.mode === 'rotate' && canvas.value) {
    const center=documentToClient({x:t.origin[0]+t.size[0]/2,y:t.origin[1]+t.size[1]/2},currentViewGeometry()),cx=center.x,cy=center.y
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
const pointerFinish=new PointerFinish()
function canvasPointerEnd(event:PointerEvent,cancel=false):void{if(drag&&event.pointerId!==drag.pointerId)return;void pointerUp(cancel)}
function pointerUp(cancel=false):Promise<void>{if(infoTools.active.value)return infoTools.finish(cancel);return pointerFinish.run(canceled=>finishPointer(cancel,canceled),cancel)}
async function finishPointer(cancel = false,canceled:()=>boolean=()=>cancel): Promise<void> {
  if(viewRotationDrag){const r=viewRotationDrag;viewRotationDrag=undefined;if(cancel)viewAngle.value=r.angle;if(r.target.hasPointerCapture(r.pointerId))r.target.releasePointerCapture(r.pointerId);return}
  if(sampleRingActive.value){if(cancel&&sampleRingOriginal.value)foreground.value=sampleRingOriginal.value;sampleRingActive.value=false;return}
  if(brushTipDrag){const tip=brushTipDrag;if(cancel){brushSize.value=tip.diameter;hardness.value=tip.hardness}if(tip.target.hasPointerCapture(tip.pointerId))tip.target.releasePointerCapture(tip.pointerId);brushTipDrag=undefined;return}
  if(distortDrag){endDistortDrag();return}
  const current = drag
  if(current?.overflow)cancel=true
  strokeScheduler?.cancel();strokeScheduler=undefined;selectionStrokeScheduler?.cancel();selectionStrokeScheduler=undefined
  if (!current) return
  const capturedPoints=rasterPoints.value.map(point=>[...point] as [number,number]),capturedSelection=draftSelection.value&&structuredClone(rpcValue(draftSelection.value)),capturedCrop=cropDraft.value&&{...cropDraft.value},capturedPaint=current.mode==='raster:selection-brush'?selectionPaintAction('selection-brush',current.operation==='subtract'):['raster:brush','raster:pencil','raster:mixer-brush','raster:dodge','raster:burn','raster:sponge','raster:history-brush','raster:art-history-brush','raster:eraser'].includes(current.mode)&&(current.layerId||quickMask.value)?paintStrokeAction(current.layerId??'',current.mode.slice(7)):undefined
  const capturedErase=current.layerId&&(current.mode==='raster:background-eraser'||current.mode==='raster:magic-eraser')?eraserAction(current.mode.slice(7) as 'background-eraser'|'magic-eraser',current.layerId,capturedPoints):undefined
  if(cancel&&current.mode==='raster:crop'){cropDraft.value=undefined;cropRequest.value=undefined}
  try {
    if(current.mode.startsWith('gradient:')){const ready=await current.ready,draft=gradientDraft.value;if(draft){if(cancel||canceled()||!ready||Math.hypot(draft.end[0]-draft.start[0],draft.end[1]-draft.start[1])<.5){if(current.gradientBefore){draft.start=current.gradientBefore.start;draft.end=current.gradientBefore.end}else{gradientDraft.value=undefined;gradientPreview.value=undefined;clearTimeout(gradientTimer);gradientTimer=undefined;gradientDirty=false;gradientTicket++}}else scheduleGradientPreview()}}
    else if(current.mode==='selection-move'&&await current.ready&&!cancel&&!canceled()&&current.request&&capturedSelection)await request('apply',{...current.request,action:{type:'selection.set',selection:capturedSelection}})
    else if(current.mode.startsWith('raster:')&&await current.ready&&!cancel&&!canceled()&&current.request){
      const mode=current.mode.slice(7),points=compactStroke(capturedPoints,['brush','pencil','eraser','heal','clone','smear'].includes(mode)?Math.min(.125,brushSize.value*.005):0),a=points[0],b=points.at(-1)!
      let action:EditAction|undefined
      if(mode==='object'&&current.layerId&&Math.hypot(b[0]-a[0],b[1]-a[1])<3/zoom.value){if(current.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId);await request('interaction',{sessionId:current.request.sessionId,interactionId:current.request.idempotencyKey,busy:false});await request('apply',{...current.request,action:{type:'selection.subject',layerId:current.layerId,point:a,removeBackground:false,operation:current.operation??'replace',sampleAllLayers:wandAllLayers.value,...subjectSettings.value}})}
      else if(mode==='object'&&current.layerId){const box=objectSelectionBounds(a,b,state.value!.manifest);if(box){objectBox.value=box;showSubjects.value=true;if(current.target.hasPointerCapture(current.pointerId))current.target.releasePointerCapture(current.pointerId);await request('interaction',{sessionId:current.request.sessionId,interactionId:current.request.idempotencyKey,busy:false});await request('apply',{...current.request,action:{type:'selection.subject',layerId:current.layerId,box,removeBackground:false,operation:current.operation??'replace',sampleAllLayers:wandAllLayers.value,...subjectSettings.value}})}}
      else if(['marquee','lasso'].includes(mode)&&capturedSelection&&(mode!=='lasso'||points.length>=3))action={type:'selection.set',selection:capturedSelection}
      else if(mode==='crop'){cropDraft.value=capturedCrop??cropRectangle(a,b,cropAspect());cropRequest.value=current.request}
      else if(mode==='quick-selection'&&current.layerId)action=quickAction(current.layerId,capturedPoints,current.operation)
      else if(mode==='patch'&&current.layerId)action=patchAction(current.layerId,capturedPoints)
      else if(['remove','red-eye'].includes(mode)&&current.layerId)action=newRetouchAction(mode as RetouchToolMode,current.layerId,capturedPoints,current.seed??0)
      else if(mode==='content-move'&&current.layerId&&Math.hypot(b[0]-a[0],b[1]-a[1])>=.5){const move=newRetouchAction('content-move',current.layerId,capturedPoints,current.seed??0) as Extract<EditAction,{type:'layer.content_aware_move'}>;contentMoveDraft.value={request:current.request,action:move};scheduleRetouchPreview(move,current.request,current.layerId)}
      else if((mode==='background-eraser'||mode==='magic-eraser')&&current.layerId)action=capturedErase
      else if(mode==='mixer-brush'&&current.layerId)action=mixerAction(current.layerId,capturedPoints,current.mixerReservoir)
      else if(['dodge','burn','sponge','history-brush','art-history-brush'].includes(mode)&&current.layerId)action=extraBrushAction(mode as Tool,current.layerId,capturedPoints,current.historySourceId)
      else if(mode==='paint-bucket'&&current.layerId)action=bucketAction(current.layerId,capturedPoints)
      else if(mode==='selection-brush'||['brush','pencil','eraser'].includes(mode)&&(current.layerId||quickMask.value))action=capturedPaint
      else if(['heal','clone','smear'].includes(mode)&&current.layerId){const kind=mode==='clone'?'clone':mode==='smear'?(smearMode.value==='blur'?'blur':'smear'):retouchMode.value;const offset=mode==='clone'&&cloneActiveOffset.value?[...cloneActiveOffset.value] as [number,number]:undefined;action={type:'layer.retouch',layerId:current.layerId,kind,points,size:brushSize.value,hardness:hardness.value,opacity:paintOpacity.value,sourceAnchor:cloneSource.value?[...cloneSource.value] as [number,number]:undefined,protectAlpha:false,smoothing:smoothing.value/zoom.value,aligned:cloneAligned.value,sourceOffset:offset,sourceMode:mode==='clone'&&cloneAllLayers.value?'all-layers':'this-layer',healingMode:healingMode.value,healingModel:interactionProfile.value,smearMode:smearMode.value==='liquify'?'liquify':'smudge',blurRadius:blurRadius.value,target:maskTarget.value?'mask':'image',seed:current.seed??0}}
      else if(mode==='gradient'&&current.layerId&&Math.hypot(b[0]-a[0],b[1]-a[1])>=.5){gradientDraft.value={request:current.request,layerId:current.layerId,target:maskTarget.value?'mask':'image',start:a,end:b}}
      if(action){const applied=await request<import('../shared/contracts').EditResult>('apply',{...current.request,action});if(applied?.mixerReservoir&&action.type==='layer.mixer_brush'&&state.value?.sessionId===current.request.sessionId)mixerReservoir.value=structuredClone(applied.mixerReservoir);if(applied&&action.type==='selection.quick'&&action.operation==='replace')quickOperation.value='add';if(applied&&action.type==='layer.retouch'&&mode==='clone'&&cloneAligned.value)cloneOffset.value=action.sourceOffset;if(applied&&action.type==='selection.paint'&&quickMask.value)lastQuickMaskBrush.value=b;if(applied&&action.type==='layer.paint'&&['brush','pencil','eraser'].includes(mode)&&current.layerId)lastBrush.value={layerId:current.layerId,mask:maskTarget.value,point:b}}
    } else if (await current.ready && !cancel && !canceled() && current.request && draft.value && current.layerId) {
      const t = structuredClone(rpcValue(draft.value)); t.origin = t.origin.map(Math.round) as [number, number]; t.size = t.size.map(v => Math.round(v * 100) / 100) as [number, number]
      if(layerTransformDraft.value){if(current.mask)maskDraft.value=t;else if(!current.shared)draftTransforms.value=current.mode==='move'?draftTransforms.value.map(item=>({...item,transform:item.id===current.layerId?t:item.transform})):[{id:current.layerId,transform:t}]}
      else if(current.mask)await request('apply',{...current.request,action:{type:'layer.mask_set_placement',layerId:current.layerId,transform:t}})
      else if(current.alt&&current.mode==='move')await request('duplicateMove',{request:current.request,layerIds:selectedIds.value,delta:[t.origin[0]-current.transform!.origin[0],t.origin[1]-current.transform!.origin[1]]})
      else if(current.shared&&draftTransforms.value.length)await request('applyBatch',{...current.request,actions:draftTransforms.value.map(item=>({type:'layer.set_transform',layerId:item.id,transform:toRaw(item.transform)})),label:'Transform selected layers'})
      else if (current.mode === 'move' && draftTransforms.value.length > 1) await request('applyBatch', { ...current.request, actions: draftTransforms.value.map(item => ({ type: 'layer.set_transform', layerId: item.id, transform: { ...toRaw(item.transform), origin: item.transform.origin.map(Math.round) } })), label: 'Move selected layers' })
      else await request('apply', { ...current.request, action: { type: 'layer.set_transform', layerId: current.layerId, transform: t } })
    }
  } finally {
    if(current.mode==='raster:crop'&&(cancel||canceled()||!cropRequest.value)){cropDraft.value=undefined;cropRequest.value=undefined}
    if(!contentMoveDraft.value)clearStrokePreview();redEyeDraft.value=undefined;if(current.mode==='raster:clone')cloneActiveOffset.value=undefined
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
    try{if (current.request&&layerTransformDraft.value?.request.idempotencyKey!==current.request.idempotencyKey&&gradientDraft.value?.request.idempotencyKey!==current.request.idempotencyKey&&contentMoveDraft.value?.request.idempotencyKey!==current.request.idempotencyKey) await request('interaction', { sessionId: current.request.sessionId, interactionId: current.request.idempotencyKey, busy: false })}finally{drag=undefined;draft.value = undefined;if(!layerTransformDraft.value){maskDraft.value=undefined;draftTransforms.value=[]};draggedId.value = undefined;rasterPoints.value=[];rasterPressures.value=undefined;if(!contentMoveDraft.value)draftSelection.value=undefined}
  }
}
const infoTools=useInfoTools({state,selectedId,tool,canStart:()=>!busy.value&&!drag&&!switchingTool&&!pointerFinish.active&&!toolFlyout.value&&!magnetic.active.value,point:documentPoint,identity,send:toolTransport})
const magnetic=useMagneticLasso({state,selectedId,operation:()=>selectionOperation.value,options:()=>({width:magneticWidth.value,contrast:magneticContrast.value,frequency:magneticFrequency.value,sampleAllLayers:wandAllLayers.value}),canStart:()=>!busy.value&&!drag&&!switchingTool&&!infoTools.active.value,point:documentPoint,identity,send:toolTransport,onError:message=>error.value={message},commit:async(captured,points,operation)=>{if(!state.value||points.length<3)return;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),shape={kind:'polygon' as const,operation,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)] as [number,number,number,number],points,feather:feather.value};await request('apply',{...captured,action:{type:'selection.set',selection:appendSelectionShape(rpcValue(state.value.selection),shape,state.value.manifest.width,state.value.manifest.height,selectionAA.value,interactionProfile.value)}})}})
watch([tool,lassoMode],()=>{if(tool.value!=='lasso'||lassoMode.value!=='magnetic')void magnetic.finish(true)})
watch([tool,ellipseSelection,marqueeAxis,lassoMode,cropMode,retouchMode],()=>{const group=toolGroupForTool(tool.value);if(!group)return;const entry=selectedToolGroupEntry(group.id,{tool:tool.value,ellipseSelection:ellipseSelection.value,marqueeAxis:marqueeAxis.value,lassoMode:lassoMode.value,cropMode:cropMode.value,retouchMode:retouchMode.value});if(entry)rememberedTools.value[group.id]=entry},{immediate:true})
let thumbnailState: EditorState | undefined
const redrawQueue = new LatestDraw(
  () => !showNew.value && canvas.value && viewport.value && canvasWrap.value ? displayState.value : undefined,
  async (current, isCurrent) => {
      const target=canvas.value!,view=viewport.value!,v=view.getBoundingClientRect(),c=canvasWrap.value!.getBoundingClientRect()
      viewSize.value={width:view.clientWidth,height:view.clientHeight};canvasOrigin.value={x:c.left-v.left,y:c.top-v.top}
      const rotated=viewAngle.value?rotatedViewport({left:v.left,top:v.top,...viewSize.value},currentViewGeometry()):undefined
      const plan=planViewportRender({document:current.manifest,viewport:rotated??viewSize.value,origin:rotated?.origin??canvasOrigin.value,zoom:zoom.value,deviceScale:window.devicePixelRatio,overscan:96+viewportHalo(current)*zoom.value})
      viewportPlan.value=plan
      await engine.draw(target,current,plan.width,plan.height,plan.region)
      if(!isCurrent())return
      displayWarning.value=engine.getDisplayWarning()?.message
      if(thumbnailState!==current){const ratio=Math.min(1,320/Math.max(current.manifest.width,current.manifest.height));await thumbnailEngine.draw(thumbnailCanvas,current,Math.max(1,Math.round(current.manifest.width*ratio)),Math.max(1,Math.round(current.manifest.height*ratio)));if(!isCurrent())return;thumbnail.value=thumbnailCanvas.toDataURL('image/png');thumbnailState=current}
  },
  cause => { error.value = { message: cause instanceof Error ? cause.message : String(cause) } }
)
async function redraw(): Promise<void> {
  rendering.value = true
  try { await redrawQueue.request() }
  finally { rendering.value = redrawQueue.active }
}
watch([displayState, showNew], () => void nextTick(redraw), { deep: true })
watch([showNew, ready], async () => { if (showNew.value && ready.value) { await nextTick(); newWidthInput.value?.focus(); newWidthInput.value?.select() } })
function action(name: string): void {
  if(name==='windowFocusLost'){loseWindowFocus();void magnetic.finish(true);void infoTools.cancel();return}
  if(commands.value.find(command=>command.id===name)?.enabled===false&&!(['undo','redo','cut','copy','paste','select-all'].includes(name)&&document.activeElement?.matches('input,textarea,[contenteditable]')))return
  // Native menu accelerators can arrive while a field owns focus. Keep text
  // deletion in the field even if a restored/custom shortcut targets canvas edits.
  if(document.activeElement?.matches('input,textarea,select,[contenteditable]')&&(['delete','delete-forward','delete-layer','reselect','deselect','invert-selection','quick-mask'].includes(name)||name.startsWith('fill-')||name.startsWith('nudge')))return
  if(name==='automation-help')name='automation'
  if(name==='reselect'){void edit({type:'selection.reselect'});return}
  if(name==='select-all-layers'&&state.value){selectedIds.value=state.value.manifest.layers.map(layer=>layer.id);selectedId.value=selectedIds.value.at(-1);return}
  if(name==='load-selection'||name==='save-selection'){showNamedSelections.value=true;return}
  if(name==='delete-layer'&&selected.value){void edit({type:'layer.delete',layerId:selected.value.id});return}
  if(name.startsWith('mask:')&&selected.value){const operation=name.slice(5);if(operation==='toggle')void edit({type:'layer.mask',layerId:selected.value.id,operation:selected.value.maskEnabled===false?'enable':'disable'});else void edit({type:'layer.mask',layerId:selected.value.id,operation:operation==='selection'?'reveal':operation as 'reveal'|'hide'|'remove',...(['reveal','hide','selection'].includes(operation)?{useSelection:operation==='selection'}:{})});return}

  if(name==='quick-mask'){void toggleQuickMask();return}
  if(quickMask.value&&(['duplicate','cut','copy','copy-merged','paste','content-fill','transform-selection','distort','repeat-filter'].includes(name)||name.startsWith('filter:')||name.startsWith('adjustment:')||name.startsWith('nudge-pixels'))){error.value={message:'Exit Quick Mask before editing image content.'};return}
  if(quickMask.value&&name.startsWith('nudge')&&!state.value?.selection)return
  if(name==='named-selections'){showNamedSelections.value=!showNamedSelections.value;return}
  if(name==='reset-view-rotation'){viewAngle.value=0;return}
  if(['merge-auto','merge-visible','stamp-visible','stamp-selected'].includes(name)){void mergeCommand(name);return}
  if(name==='toggle-panels'||name==='toggle-side-panels'){if(name==='toggle-panels')panelsHidden.value=!panelsHidden.value;else sidePanelsHidden.value=!sidePanelsHidden.value;void nextTick(updateViewGeometry);return}
  if(name.startsWith('cycle-group:')){void cyclePhotoshopGroup(name.slice(12));return}
  if(name.startsWith('flow:')){if(tool.value==='mixer-brush'&&!drag){const result=opacityDigit(Number(name.slice(5)),performance.now(),pendingFlowOpacity);pendingFlowOpacity=result.pending;mixerFlow.value=result.value;return}if(['selection-brush','brush','eraser'].includes(tool.value)&&!drag){const result=opacityDigit(Number(name.slice(5)),performance.now(),pendingFlowOpacity);pendingFlowOpacity=result.pending;brushFlow.value=result.value}return}
  if(name==='apply-draft'||name==='cancel-draft'){draftAction(name==='apply-draft');return}
  if(name==='cycle-tool'){cycleCurrentTool();return}
  if(name==='cycle-shape'){void cycleShapeKind();return}
  if(name==='temporary-hand'){spacePan.value=true;return}
  if(name==='swap-colors'){[foreground.value,background.value]=[background.value,foreground.value];return}
  if(name==='reset-colors'){foreground.value='#000000';background.value='#ffffff';return}
  if(name.startsWith('opacity:')){setOpacityDigit(Number(name.slice(8)));return}
  if(name.startsWith('nudge')){nudgeQueue=nudgeQueue.then(()=>nudgeTarget(name)).catch(cause=>{error.value={message:cause instanceof Error?cause.message:String(cause)}});return}
  if(name.startsWith('brush-')){if(tool.value==='lasso'&&lassoMode.value==='magnetic'){if(name==='brush-smaller'||name==='brush-larger')magneticWidth.value=Math.max(1,Math.min(128,magneticWidth.value+(name==='brush-larger'?1:-1)));return}if(drag||!['remove','selection-brush','brush','pencil','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','heal','clone','smear','quick-selection'].includes(tool.value))return;if(tool.value==='quick-selection'&&!['brush-smaller','brush-larger'].includes(name))return;if(tool.value==='pencil'&&!['brush-smaller','brush-larger'].includes(name))return;if(name==='brush-smaller'||name==='brush-larger')brushSize.value=Math.max(1,Math.min(2000,name==='brush-larger'?Math.max(brushSize.value+1,Math.round(brushSize.value*1.2)):Math.min(brushSize.value-1,Math.round(brushSize.value/1.2))));else {const quarter=hardness.value*4;hardness.value=Math.max(0,Math.min(4,name==='brush-harder'?Math.floor(quarter+.001)+1:Math.ceil(quarter-.001)-1))/4}return}
  if(name==='blend-next'||name==='blend-previous'){if(selected.value&&!selected.value.isGroup){const index=BLEND_MODES.indexOf(selected.value.blendMode as typeof BLEND_MODES[number]);void edit({type:'layer.set_blend',layerId:selected.value.id,blendMode:BLEND_MODES[(index+(name==='blend-next'?1:BLEND_MODES.length-1))%BLEND_MODES.length]})}return}

  if(name==='imageOperationState'){void request<typeof imageOperations.value>('imageOperationState').then(value=>{if(value)imageOperations.value=value});return}
  if(name==='externalState'){void refreshExternal();return}
  if(name==='recentState'){void refreshRecent();return}
  if(name==='recent-projects'){void refreshRecent();showRecents.value=!showRecents.value;return}
  if(name==='fileOpenError'){void request<string>('fileOpenError').then(message=>{if(message)error.value={message}});return}
  if(name==='photoshopState'){void refreshPhotoshop();return}
  if (name === 'foreignState') { void refreshForeign(); return }
  if(name==='paste'&&showNew.value){void pasteOnNewCanvas();return}
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
  else if((name==='delete'||name==='delete-forward')&&quickMask.value)void fillWith(background.value)
  else if ((name === 'delete'||name==='delete-forward') && selected.value){if(effectTarget.value?.layerId===selected.value.id){const effects={...selected.value.effects as LayerEffects};delete effects[effectTarget.value.kind];void edit({type:'layer.effects',layerId:selected.value.id,effects});effectTarget.value=undefined}else if(state.value?.selection)void edit({type:'layer.clear_selected',layerId:selected.value.id,target:maskTarget.value?'mask':'image'});else if(maskTarget.value&&selected.value.maskFile)void edit({type:'layer.mask',layerId:selected.value.id,operation:'remove'});else void edit({type:'layer.delete',layerId:selected.value.id})}
  else if (name==='copy'||name==='cut'||name==='copy-merged')void request('copyClipboard',{...identity(),layerIds:selectedIds.value,cut:name==='cut',merged:name==='copy-merged',mask:maskTarget.value}).then(result=>{if(result)canPaste.value=true})
    else if (name==='paste')void request('pasteClipboard',identity())
  else if (name==='layer-actions')showLayerActions.value=!showLayerActions.value
  else if (name==='export-as')showExport.value=true
  else if(name==='trim-canvas')showTrim.value=true
  else if (name==='canvas-size')canvasSize('canvas')
  else if (name==='image-size')canvasSize('image')
  else if (name==='rotate-canvas')void edit({type:'document.rotate',clockwise:true})
  else if(name==='rotate-canvas-ccw')void edit({type:'document.rotate',clockwise:false})
  else if(name==='rotate-canvas-180')void editMany([{type:'document.rotate',clockwise:true},{type:'document.rotate',clockwise:true}],'Rotate Canvas 180°')
  else if(name==='flip-canvas-vertical')void edit({type:'document.flip',axis:'vertical'})
  else if (name==='flip-canvas')void edit({type:'document.flip',axis:'horizontal'})
  else if (name==='palette')showPalette.value=true
  else if (name==='shortcuts')showShortcuts.value=true
  else if(name==='info-tools')infoTools.showPanel.value=!infoTools.showPanel.value
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
  else if(name==='edge-refinement')void openEdgeRefinement()
  else if(name==='subject-tools')showSubjects.value=true
  else if(name==='content-fill'&&selected.value)void edit({type:'layer.content_fill',layerId:selected.value.id})
  else if (name==='fill'&&(selected.value||quickMask.value)){if(interactionProfile.value==='photoshop')showFill.value=true;else void fillWith(foreground.value)}
  else if(name.startsWith('fill-')&&(selected.value||quickMask.value))void fillWith(name.startsWith('fill-background')?background.value:foreground.value)
  else if(name==='export-psd'||name==='export-psb'){if(state.value)void request('photoshopExportDialog',{sessionId:state.value.sessionId,expectedRevision:state.value.revision,psb:name==='export-psb'})}
  else if(name.startsWith('selection-'))selectionModify.value=name.slice(10) as typeof selectionModify.value
  else if(name==='color-range')showColorRange.value=true
  else if(name==='effects')openEffects()
  else if(name==='transform-selection'){if(state.value?.selection&&!maskTarget.value)void beginSelectionTransform();else void beginLayerTransform()}
  else if(name==='distort'){if(floatingSelection.value)distortFloatingSelection();else openDistort()}
  else if(name.startsWith('filter:'))void openFilter(name.slice(7) as ImageFilterKind)
  else if(name.startsWith('adjustment:'))void openFilter(name.slice(11) as ImageFilterKind,true)
  else if(name==='repeat-filter'&&lastFilter.value&&selected.value)void edit({type:'layer.filter',layerId:selected.value.id,filter:toRaw(lastFilter.value)})
  else if(name.startsWith('tool:')){const next=name.slice(5) as Tool;if(tool.value===next&&interactionProfile.value==='compositor')cycleCurrentTool();else if(next==='background-eraser'||next==='magic-eraser')void chooseTool(next);else activateTool(next)}
  else if (name === 'controls') showControls.value = !showControls.value
  else if (['openDialog','importDialog','importFolderDialog','saveDialog','saveCurrent','saveCopyDialog','exportDialog','closeDocument'].includes(name)) void task(name)
}
let temporaryHandKey:string|undefined
let pendingFlowOpacity:PendingOpacityDigit|undefined
async function cyclePhotoshopGroup(key:string):Promise<void>{
 if(drag||busy.value)return
 if(['m','l','w','c','j','i','e','b','g','o','y','a'].includes(key)){
  const group=toolGroup(key.toUpperCase() as ToolGroupId),selected=selectedToolGroupEntry(group.id,{tool:tool.value,ellipseSelection:ellipseSelection.value,marqueeAxis:marqueeAxis.value,lassoMode:lassoMode.value,cropMode:cropMode.value,retouchMode:retouchMode.value})
  const index=group.entries.findIndex(entry=>entry.id===selected?.id)
  await chooseToolGroupEntry(group.entries[(index+1)%group.entries.length]);return
 }
 const groups:Record<string,Tool[]>={b:['brush'],s:['clone'],g:['gradient'],u:['shape']}
 const group=groups[key];if(!group)return
 if(!group.includes(tool.value)){await chooseTool(group[0]);return}
 if(key==='u')await cycleShapeKind()
}
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
 if(tool.value==='background-eraser')return
 const result=opacityDigit(digit,performance.now(),pendingBrushOpacity);pendingBrushOpacity=result.pending
 if(['dodge','burn','sponge'].includes(tool.value)){if(!drag)tonalExposure.value=result.value;return}
 if(quickMask.value||['remove','content-move','selection-brush','brush','pencil','paint-bucket','mixer-brush','dodge','burn','sponge','history-brush','art-history-brush','eraser','background-eraser','magic-eraser','heal','clone','smear'].includes(tool.value)){if(!drag)paintOpacity.value=result.value}
 else if(tool.value==='gradient')gradientOpacity.value=result.value
 else if(selected.value){const layerId=selected.value.id;opacityQueue=opacityQueue.then(async()=>{await edit({type:'layer.set_opacity',layerId,opacity:result.value})})}
}
async function nudgeTarget(name:string):Promise<void>{
 if(!state.value||drag||busy.value)return
 const direction=name.split(':')[1],step=name.includes('fast')?10:1,delta:[number,number]=[direction==='left'?-step:direction==='right'?step:0,direction==='up'?-step:direction==='down'?step:0]
 if(name.includes('pixels')&&state.value.selection&&selected.value?.imageFile&&!maskTarget.value){await beginSelectionTransform();if(floatingSelection.value){floatingSelection.value.transform.origin=[floatingSelection.value.transform.origin[0]+delta[0],floatingSelection.value.transform.origin[1]+delta[1]];await endSelectionTransform(true)};return}
 if((quickMask.value||['selection-brush','marquee','lasso','magic','object'].includes(tool.value))&&state.value.selection){await edit({type:'selection.translate',delta});return}
 if(!selected.value||!canTransform.value)return
 if(independentMask.value){const t=structuredClone(rpcValue(transform.value!));t.origin=[t.origin[0]+delta[0],t.origin[1]+delta[1]];if(layerTransformDraft.value)maskDraft.value=t;else await edit({type:'layer.mask_set_placement',layerId:selected.value.id,transform:t})}
 else{const manifest=rpcValue(displayState.value!.manifest),actions=sharedTransformActions(manifest,selectedIds.value,{kind:'translate',dx:delta[0],dy:delta[1]});if(layerTransformDraft.value)draftTransforms.value=actions.map(a=>({id:a.layerId,transform:a.transform}));else await editMany(actions,'Nudge selected layers')}
}
function draftAction(apply:boolean):void {
 if(contentMoveDraft.value||drag?.mode==='raster:content-move'){void finishContentMove(apply);return}
 if(infoTools.active.value){void infoTools.finish(!apply);return}
 if(magnetic.active.value){void magnetic.finish(!apply);return}
 if(showCanvasSize.value){if(sizeMode.value==='image'){if(apply)imageSizeDialog.value?.commit();else imageSizeDialog.value?.cancel()}else if(apply)void applySize();else showCanvasSize.value=false;return}
 if(paletteTarget.value){if(!apply)paletteTarget.value=undefined;return}
 if(showEffects.value){if(apply)effectsPanel.value?.commit();else effectsPanel.value?.cancel();return}
 if(floatingSelection.value){void endSelectionTransform(apply);return}
 if(layerTransformDraft.value){void finishLayerTransform(apply);return}
 if(gradientDraft.value){void finishGradient(apply);return}
 if(showDistort.value){if(apply)void applyDistort();else cancelDistort();return}
 if(polygonRequest.value){void finishPolygon(!apply);return}
 if(cropDraft.value){if(apply)void applyCrop();else cancelCrop();return}
 if(!apply){if(canvasOnly.value){void toggleCanvasOnly();return}void pointerUp(true);showAutomation.value=false;contextLayer.value=undefined;if(state.value?.manifest.layers.length)showNew.value=false;error.value=undefined}
}
function keydown(event:KeyboardEvent):void {
 if(magnetic.active.value&&!((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]'))&&['Enter','Escape','Backspace','Delete'].includes(event.key)){event.preventDefault();if(event.key==='Enter')void magnetic.finish();else if(event.key==='Escape')void magnetic.finish(true);else magnetic.backspace();return}
 if(infoTools.active.value&&event.key==='Escape'){event.preventDefault();void infoTools.cancel();return}
 if(rasterizePending.value||toolFlyout.value)return
 if(event.isComposing)return
 const command=commandForKey(commands.value,shortcutOverrides.value,event,platform==='darwin'?'mac':'other')
 if(!command)return
 if(command.id==='paste'&&showNew.value){event.preventDefault();void pasteOnNewCanvas();return}
 if(showEffects.value&&effectTarget.value&&['delete','delete-forward'].includes(command.id)&&!(event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')){event.preventDefault();showEffects.value=false;effectsPreview.value=undefined;action(command.id);return}
 if(showEffects.value&&['apply-draft','cancel-draft'].includes(command.id)){event.preventDefault();draftAction(command.id==='apply-draft');return}
 if((event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')||showFilters.value||showEffects.value||showExport.value||showCanvasSize.value||showRecovery.value||showPalette.value||showShortcuts.value||showFill.value||!!edgeRefinement.value||foreign.value.status!=='idle'||photoshop.value.status!=='idle')return
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
  bridge.value = await request<BridgeInfo>('bridgeInfo'); const catalog=await request<{family:string;postscriptName?:string;fullName?:string;style?:string}[]>('fontCatalog');if(catalog){setInstalledFontCatalog(catalog);fontList.value=[...new Set(catalog.map(f=>f.family))].sort()} await refreshRecovery(); ready.value = true;shortcutOverrides.value=loadShortcuts(localStorage,rawCommands.value.map(command=>({...command,shortcut:undefined})),platform==='darwin'?'mac':'other');await syncNativeShortcuts();window.addEventListener('resize',updateViewGeometry);window.addEventListener('blur',loseWindowFocus)
  document.addEventListener('keydown', keydown); document.addEventListener('keyup', keyup)
})
onBeforeUnmount(() => { void finishContentMove();cancelToolHold();subjectPreviewScheduler.cancel();clearTimeout(subjectPreviewTimer);void finishSubjectPreview();colorRangeScheduler.cancel();clearTimeout(colorRangeTimer);clearTimeout(tabDragTimer);void finishGradient();clearTimeout(gradientTimer);gradientTicket++;void endSelectionTransform();void finishPolygon(true);void canvasContentLease(false); unsubscribeAgent?.();unsubscribe?.(); unsubscribeAction?.(); document.removeEventListener('keydown', keydown); document.removeEventListener('keyup', keyup); window.removeEventListener('resize',updateViewGeometry);window.removeEventListener('blur',loseWindowFocus);middleUp();engine.dispose();thumbnailEngine.dispose();clearTimeout(distortTimer);endDistortDrag() })
</script>

<template>
  <div class="editor-shell" :class="[platform,{'canvas-only':canvasOnly,'panels-hidden':panelsHidden,'side-panels-hidden':sidePanelsHidden}]" :data-interaction-profile="interactionProfile" :data-view-angle="viewAngle" :data-canvas-only="canvasOnly" :data-ready="ready" :data-dragging="!!draggedId" :data-content-move-pending="!!contentMoveDraft" @dragover="fileDrag" @dragleave.self="dropActive=false" @drop="dropFiles($event)" @click="contextLayer = undefined;layerFooterMenu=undefined">
    <header class="titlebar">
      <div class="titlebar-leading">
        <button class="new-button" :class="{'new-drop-target':newDropTarget}" @dragover="hoverNewDocument" @dragleave="newDropTarget=false" @drop="dropNewDocument" @click="action('new')" :aria-label="t('New canvas')" :title="t('New canvas (Ctrl/Cmd+N)')"><Plus :size="19" /></button>
        <div class="project-tabs" :class="{'new-drop-target':newDropTarget}" @dragover="hoverNewDocument" @dragleave.self="newDropTarget=false" @drop="dropNewDocument" role="tablist" :aria-label="t('Open projects')">
          <div v-for="doc in documents" :key="doc.sessionId" class="project-tab" :class="{ active: state?.sessionId === doc.sessionId }" role="tab" :aria-selected="state?.sessionId === doc.sessionId" :aria-label="doc.title" :data-session-id="doc.sessionId" tabindex="0" @dragenter="hoverDocumentTab(doc.sessionId,$event)" @dragover="hoverDocumentTab(doc.sessionId,$event)" @dragleave="leaveDocumentTab" @drop="dropDocumentLayers(doc.sessionId,$event)" @click="task('switchDocument', { sessionId: doc.sessionId })" @keydown.enter="task('switchDocument', { sessionId: doc.sessionId })" @keydown.space.prevent="task('switchDocument', { sessionId: doc.sessionId })">
            <span v-if="doc.modified && !doc.empty" class="modified-dot"></span><strong>{{ doc.title }}</strong><button v-if="documents.length>1||!doc.empty" :aria-label="t('Close project')" :title="t('Close {name}', {name:doc.title})" @click.stop="task('closeDocument', { sessionId: doc.sessionId })"><X :size="13" /></button>
          </div>
        </div>
      </div>
      <div class="titlebar-actions"><button class="interface-language" type="button" :aria-label="t('Interface language')" :title="t(locale === 'zh-CN' ? 'Switch to English' : 'Switch to Simplified Chinese')" :aria-disabled="languageBusy" :aria-busy="languageBusy" @keydown="languageKeydown" @click="changeLanguage"><span :class="{ active: locale === 'zh-CN' }">ZH</span><span class="language-divider" aria-hidden="true">/</span><span :class="{ active: locale === 'en' }">EN</span></button><button @click="action('recent-projects')" :aria-label="t('Recent projects')">{{ t('Recent') }}</button><button @click="showAgent=!showAgent" :aria-label="t('Agent chat')">{{ t('Agent') }}</button><button @click="showPalette = true" :aria-label="t('Search commands')" :title="t('Search commands')">{{ t('Commands') }}</button><button v-if="recoverable.length || recoveryInfo.saveRecovery.some(item => item.status === 'attention')" @click="showRecovery = !showRecovery" :aria-label="t('Recovery')" :title="t('Recover unsaved documents')">{{t('Recovery {count}',{count:recoverable.length})}}</button><button class="automation-toggle" @click="showAutomation = !showAutomation" :aria-label="t('Automation')" :title="t('Agent / MCP')"><Terminal :size="16" /></button><button @click="fit" :disabled="showNew">{{ t('Fit') }}</button><button @click="zoom = 1" @contextmenu.prevent="showZoomEntry=!showZoomEntry" :disabled="showNew" :title="t('Actual pixels. Right-click to enter a zoom percentage.')">100%</button><div class="zoom-pair"><button @click="stepZoom(1.2)" :disabled="showNew" :aria-label="t('Zoom in')"><ZoomIn :size="18" /></button><button @click="stepZoom(1 / 1.2)" :disabled="showNew" :aria-label="t('Zoom out')"><ZoomOut :size="18" /></button></div></div>
    </header>
    <div v-if="showZoomEntry&&!showNew" class="zoom-entry"><label>{{ t('Zoom') }} <input v-model.number="zoomPercent" :aria-label="t('Canvas zoom percent')" type="number" min=".1" max="3200" step="25"> %</label><button @click="showZoomEntry=false" :aria-label="t('Close zoom entry')"><X :size="14"/></button></div>
    <section v-if="tool==='frame'" class="transform-toolbar raster-toolbar" data-testid="frame-toolbar"><strong>{{t('Frame Tool')}}</strong><label>{{t('Frame shape')}}<select v-model="frameKind" :aria-label="t('Frame shape')"><option value="rectangle">{{t('Rectangle')}}</option><option value="ellipse">{{t('Ellipse')}}</option></select></label><button :disabled="busy" @click="newFrame">{{t('New frame')}}</button><FrameContentPanel v-if="selected?.frame&&!frameCreateNew" :frame="selected.frame" :layer-id="selected.id" :sources="frameSources" :disabled="busy" :mode="frameMode" @mode="frameMode=$event" @place="placeFrameImage"/><span v-else>{{t('Drag on the canvas to create a frame')}}</span></section>
    <section v-else-if="tool==='pen'||tool==='path-selection'||tool==='direct-selection'" class="transform-toolbar raster-toolbar" data-testid="vector-path-toolbar"><strong>{{t(tool==='pen'?'Pen Tool':tool==='path-selection'?'Path Selection Tool':'Direct Selection Tool')}}</strong><VectorPathPanel :paths="vectorPaths" :selected-id="vectorPathId" :has-layer="!!selected" :disabled="busy" @select="selectVectorPath" @create="newVectorPath" @delete="vectorCommand('document.path_delete',$event)" @selection="vectorCommand('selection.from_path',$event)" @fill="vectorCommand('layer.path_fill',$event)" @mask="vectorCommand('layer.path_mask',$event)"/><button :disabled="busy||!vectorOverlay?.canSplitSelected" @click="vectorOverlay?.splitSelected()">{{t('Add anchor')}}</button><button :disabled="busy||tool==='path-selection'||!vectorSelectedKnot" @click="vectorOverlay?.deleteSelected()">{{t('Delete anchor')}}</button><button :disabled="busy||tool==='path-selection'||!vectorSelectedKnot" @click="vectorOverlay?.convertSelected()">{{t('Convert anchor')}}</button></section>
    <section v-else-if="tool==='move'" class="transform-toolbar" :aria-label="t('Transform controls')">
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
    <section v-else-if="tool==='color-sampler'||tool==='ruler'" class="transform-toolbar raster-toolbar" data-testid="info-tool-toolbar"><strong>{{t(tool==='ruler'?'Ruler Tool':'Color Sampler')}}</strong><button :aria-pressed="infoTools.showPanel.value" @click="infoTools.showPanel.value=!infoTools.showPanel.value">{{t('Info')}}</button><button :disabled="busy||infoTools.active.value" @click="tool==='ruler'?infoTools.clearRuler():infoTools.clearSamples()">{{t('Clear')}}</button></section>
    <section v-else-if="tool==='quick-selection'" class="transform-toolbar raster-toolbar" data-testid="quick-selection-toolbar"><strong>{{t('Quick Selection')}}</strong><div class="selection-mode-buttons"><button v-for="mode in (['replace','add','subtract'] as const)" :aria-label="t(mode==='replace'?'New selection':mode==='add'?'Add to selection':'Subtract from selection')" :aria-pressed="quickOperation===mode" @click="quickOperation=mode">{{t(mode==='replace'?'New selection':mode==='add'?'Add to selection':'Subtract from selection')}}</button></div><label>{{t('Size')}}<input v-model.number="brushSize" :aria-label="t('Brush size')" type="number" min="1" max="4096"/>px</label><label><input v-model="wandAllLayers" type="checkbox" :aria-label="t('Sample All Layers')"/>{{t('Sample All Layers')}}</label><label>{{t('Tolerance')}}<input v-model.number="quickTolerance" type="number" min="0" max="255"/></label><label>{{t('Edge sensitivity')}}<input v-model.number="quickEdge" type="number" min="0" max="1" step=".05"/></label><label>{{t('Feather')}}<input v-model.number="feather" type="number" min="0" max="250"/></label></section>
    <section v-else-if="tool==='remove'||tool==='content-move'||tool==='red-eye'" class="transform-toolbar raster-toolbar" data-testid="retouch-tool-toolbar"><strong>{{t(tool==='remove'?'Remove Tool':tool==='content-move'?'Content-Aware Move Tool':'Red Eye Tool')}}</strong><template v-if="tool==='remove'"><label>{{t('Size')}}<input v-model.number="brushSize" :aria-label="t('Remove brush size')" type="number" min="1" max="2000"/></label><label>{{t('Hardness')}}<input v-model.number="hardness" :aria-label="t('Remove hardness')" type="number" min="0" max="1" step=".01"/></label><label><input v-model="removeClosedLoop" type="checkbox" :aria-label="t('Fill closed loops')"/>{{t('Fill closed loops')}}</label></template><label v-if="tool==='content-move'">{{t('Adaptation')}}<input v-model.number="contentMoveAdaptation" :aria-label="t('Content-aware move adaptation')" type="number" min="0" max="1" step=".05" :disabled="contentMoveFinishing"/></label><template v-if="tool==='red-eye'"><label>{{t('Pupil Size')}}<input  :value="redEyePupil*100" @input="redEyePupil=Number(($event.target as HTMLInputElement).value)/100" :aria-label="t('Pupil Size')" type="number" min="0" max="100" step="1"/>%</label><label>{{t('Darken Amount')}}<input  :value="redEyeDarken*100" @input="redEyeDarken=Number(($event.target as HTMLInputElement).value)/100" :aria-label="t('Darken Amount')" type="number" min="0" max="100" step="1"/>%</label></template><template v-else><label>{{t('Opacity')}}<input v-model.number="paintOpacity" :aria-label="t('Retouch opacity')" type="number" min="0" max="1" step=".05" :disabled="contentMoveFinishing"/></label><label><input v-model="retouchProtectAlpha" type="checkbox" :aria-label="t('Protect Transparency')" :disabled="contentMoveFinishing"/>{{t('Protect Transparency')}}</label></template><template v-if="contentMoveDraft"><button :disabled="contentMoveFinishing" @click="finishContentMove()">{{t('Cancel')}}</button><button :disabled="contentMoveFinishing" :aria-label="t('Apply Content-Aware Move')" @click="finishContentMove(true)">{{t('Apply')}}</button></template></section>
    <section v-else-if="tool==='patch'" class="transform-toolbar raster-toolbar" data-testid="patch-toolbar"><strong>{{t('Patch Tool')}}</strong><label>{{t('Patch mode')}}<select v-model="patchMode" :aria-label="t('Patch mode')"><option value="source">{{t('Source')}}</option><option value="destination">{{t('Destination')}}</option></select></label><label>{{t('Adaptation')}}<input v-model.number="patchAdaptation" :aria-label="t('Adaptation')" type="number" min="0" max="1" step=".1"/></label><label><input v-model="patchProtectAlpha" type="checkbox"/>{{t('Preserve target transparency')}}</label><span>{{t('Draw a selection, then drag it to patch. Alt subtracts; Shift adds.')}}</span></section>
    <section v-else-if="tool==='lasso'&&lassoMode==='magnetic'" class="transform-toolbar raster-toolbar" data-testid="magnetic-lasso-toolbar"><strong>{{t('Magnetic Lasso')}}</strong><label>{{t('Width')}}<input v-model.number="magneticWidth" :aria-label="t('Magnetic width')" type="number" min="1" max="128"/>px</label><label>{{t('Contrast')}}<input :value="magneticContrast*100" :aria-label="t('Magnetic contrast')" type="number" min="0" max="100" @change="magneticContrast=Number(($event.target as HTMLInputElement).value)/100"/>%</label><label>{{t('Frequency')}}<input v-model.number="magneticFrequency" :aria-label="t('Magnetic frequency')" type="number" min="0" max="100"/></label><button :disabled="!magnetic.active.value||magnetic.points.value.length<3" @click="magnetic.finish()">{{t('Apply')}}</button><button :disabled="!magnetic.active.value" @click="magnetic.finish(true)">{{t('Cancel')}}</button><span>{{t('Click to start, follow the edge, Enter to finish, Backspace to remove a point.')}}</span></section>
    <section v-else-if="tool==='background-eraser'||tool==='magic-eraser'" class="transform-toolbar raster-toolbar" data-testid="eraser-toolbar">
      <strong>{{t(tool==='background-eraser'?'Background Eraser Tool':'Magic Eraser Tool')}}</strong>
      <template v-if="tool==='background-eraser'"><label>{{t('Size')}}<CommitInput :label="t('Brush size')" :value="brushSize" :min="1" :max="4096" @preview="brushSize=Number($event)" @commit="brushSize=Number($event)"/></label><label>{{t('Hardness')}}<CommitInput :label="t('Hardness')" :value="Math.round(hardness*100)" :min="0" :max="100" @commit="hardness=Number($event)/100"/>%</label><label>{{t('Sampling')}}<select v-model="backgroundEraseSampling" :aria-label="t('Background eraser sampling')"><option value="continuous">{{t('Continuous')}}</option><option value="once">{{t('Once')}}</option><option value="background">{{t('Background Swatch')}}</option></select></label><label>{{t('Limits')}}<select v-model="backgroundEraseLimits" :aria-label="t('Background eraser limits')"><option value="contiguous">{{t('Contiguous')}}</option><option value="discontiguous">{{t('Discontiguous')}}</option><option value="find-edges" disabled>{{t('Find Edges (not yet available)')}}</option></select></label><label>{{t('Tolerance')}}<CommitInput :label="t('Background eraser tolerance percentage')" :value="backgroundEraseTolerance" :min="0" :max="100" :step="1" @commit="backgroundEraseTolerance=Number($event)"/>%</label><label><input v-model="backgroundEraseProtectForeground" type="checkbox" :aria-label="t('Protect Foreground Color')"/>{{t('Protect Foreground Color')}}</label><label :title="t('Background Eraser currently samples the selected layer only.')"><input type="checkbox" disabled :checked="false" :aria-label="t('Sample All Layers')"/>{{t('Sample All Layers')}}</label></template>
      <template v-else><label>{{t('Tolerance')}}<CommitInput :label="t('Magic eraser tolerance')" :value="magicEraseTolerance" :min="0" :max="255" :step="1" @commit="magicEraseTolerance=Number($event)"/></label><label><input v-model="magicEraseAA" type="checkbox" :aria-label="t('Anti-alias')"/>{{t('Anti-alias')}}</label><label><input v-model="magicEraseContiguous" type="checkbox" :aria-label="t('Contiguous')"/>{{t('Contiguous')}}</label><label><input v-model="magicEraseAllLayers" type="checkbox" :aria-label="t('Sample All Layers')"/>{{t('Sample All Layers')}}</label></template>
      <label v-if="tool==='magic-eraser'">{{t('Opacity')}}<CommitInput :label="t('Eraser opacity percentage')" :value="Math.round(paintOpacity*100)" :min="0" :max="100" :step="1" @commit="paintOpacity=Number($event)/100"/>%</label>
    </section><section v-else-if="tool==='hand'||tool==='zoom'" class="transform-toolbar navigation-toolbar"><strong>{{tool==='hand'?t('Pan'):t('Zoom')}}</strong><label v-if="tool==='zoom'" class="zoom-control"><CommitInput :label="t('Zoom percentage')" :scrub-label="t('Zoom')" :value="zoomPercent" :min=".1" :max="3200" :step="1" @preview="zoomPercent=Number($event)" @commit="zoomPercent=Number($event)"/><span class="zoom-unit" aria-hidden="true">%</span></label></section><section v-else-if="tool==='text'||tool==='shape'" class="transform-toolbar content-toolbar"><ContentTools compact ref="contentTools" :key="contentResetKey" :layer="contentOnCanvas?state?.manifest.layers.find(layer=>layer.id===canvasContentEditingLayer):selected" :mode="tool" :fonts="fontList" :disabled="busy" :draft="canvasContentDraft" :selection-range="canvasTextSelection" :on-canvas="contentOnCanvas" @draft="contentDraftChanged" @apply-canvas="contentCanvas?.commit()" @create="contentRaster" @update="contentRaster" @error="error={message:$event}" /></section><section v-else class="transform-toolbar raster-toolbar" :aria-label="t('Tool controls')"><strong>{{ t(quickMask?'Quick Mask':tool==='selection-brush'?'Selection Brush':tool==='rotate-view'?'Rotate View':tool) }}</strong><label v-if="tool==='selection-brush'">{{t('Mode')}}<select v-model="selectionBrushMode" :aria-label="t('Selection Brush mode')"><option value="add">{{t('add')}}</option><option value="subtract">{{t('subtract')}}</option></select></label><label>{{ t('Foreground') }} <input v-model="foreground" type="color" :aria-label="t('Foreground color')"></label><label>{{ t('Background') }} <input v-model="background" type="color" :aria-label="t('Background color')"></label><template v-if="['selection-brush','brush','pencil','history-brush','art-history-brush','eraser','heal','clone','smear'].includes(tool)"><label>{{ t('Size') }} <CommitInput :label="t('Brush size')" :value="brushSize" :min="1" :max="4096" @preview="brushSize=Number($event)" @commit="brushSize=Number($event)"/></label><label v-if="tool!=='pencil'">{{ t('Hardness') }} <CommitInput :label="t('Hardness')" :value="brushPercentControls?Math.round(hardness*100):hardness" :min="0" :max="brushPercentControls?100:1" :step="brushPercentControls?1:.1" @preview="hardness=Number($event)/(brushPercentControls?100:1)" @commit="hardness=Number($event)/(brushPercentControls?100:1)"/></label><label>{{tool==='smear'?t('Strength'):t('Opacity')}} <CommitInput :label="tool==='smear'?t('Strength'):t('Opacity')" :value="brushPercentControls?Math.round(paintOpacity*100):paintOpacity" :min="0" :max="brushPercentControls?100:1" :step="brushPercentControls?1:.1" @preview="paintOpacity=Number($event)/(brushPercentControls?100:1)" @commit="paintOpacity=Number($event)/(brushPercentControls?100:1)"/></label><label>{{ t('Smoothing') }}<CommitInput :label="t('Brush smoothing')" :value="smoothing" :min="0" :max="100" @preview="smoothing=Number($event)" @commit="smoothing=Number($event)"/></label><template v-if="tool==='pencil'"><label><input v-model="pressureSize" type="checkbox">{{t('Pressure size')}}</label><label><input v-model="pressureOpacity" type="checkbox">{{t('Pressure opacity')}}</label></template><BrushDynamicsTools v-if="['selection-brush','brush','eraser','history-brush','art-history-brush'].includes(tool)" v-model:flow="brushFlow" :show-spacing="interactionProfile==='photoshop'" v-model:spacing="brushSpacing" v-model:hardness="hardness" v-model:pressure-size="pressureSize" v-model:pressure-opacity="pressureOpacity"/><label v-if="selected?.maskFile&&!quickMask&&tool!=='selection-brush'"><input v-model="maskTarget" type="checkbox">{{ t('Mask') }}</label></template><template v-if="['marquee','lasso'].includes(tool)"><label v-if="tool==='lasso'">{{ t('Mode') }}<select v-model="lassoMode" :aria-label="t('Lasso mode')"><option value="freehand">{{ t('Freehand') }}</option><option value="magnetic">{{t('Magnetic Lasso')}}</option><option value="polygon">{{ t('Polygonal') }}</option></select></label><select v-model="selectionOperation" :aria-label="t('Selection operation')"><option value="replace">{{ t('replace') }}</option><option value="add">{{ t('add') }}</option><option value="subtract">{{ t('subtract') }}</option><option value="intersect">{{ t('intersect') }}</option></select><label v-if="tool==='marquee'">{{t('Marquee type')}}<select v-model="marqueeAxis" :aria-label="t('Marquee type')"><option value="area">{{t('Area')}}</option><option value="row">{{t('Single Row Marquee')}}</option><option value="column">{{t('Single Column Marquee')}}</option></select></label><label v-if="tool==='marquee'&&marqueeAxis==='area'"><input v-model="ellipseSelection" type="checkbox">{{ t('Ellipse') }}</label><label v-if="tool!=='marquee'||marqueeAxis==='area'"><input v-model="selectionAA" type="checkbox">{{ t('Anti-alias') }}</label><label>{{ t('Feather') }} <input v-model.number="feather" type="number" min="0" max="250"></label><button @click="action('deselect')">{{ t('Deselect') }}</button><button @click="action('fill')">{{ t('Fill') }}</button></template><label v-if="tool==='heal'">{{ t('Mode') }}<select v-model="retouchMode"><option value="spot-heal">{{ t('Spot Healing') }}</option><option value="heal">{{ t('Healing Brush (Alt sample)') }}</option><option value="blur">{{ t('Blur') }}</option></select></label><template v-if="tool==='clone'"><label><input v-model="cloneAligned" type="checkbox" :aria-label="t('Clone Aligned')">{{ t('Aligned') }}</label><label>{{ t('Sample') }}<select v-model="cloneAllLayers" :aria-label="t('Clone sample')"><option :value="false">{{ t('This Layer') }}</option><option :value="true">{{ t('All Layers') }}</option></select></label><span>{{ t('Alt-click to sample') }} {{cloneSource?.map(Math.round).join(', ')}}</span></template><label v-if="tool==='heal'&&retouchMode==='spot-heal'">{{ t('Type') }}<select v-model="healingMode" :aria-label="t('Spot healing type')"><option value="content-aware">{{ t('Content-Aware') }}</option><option value="create-texture">{{ t('Create Texture') }}</option><option value="proximity-match">{{ t('Proximity Match') }}</option></select></label><label v-if="tool==='smear'">{{ t('Mode') }}<select v-model="smearMode" :aria-label="t('Smear mode')"><option value="liquify">{{ t('Liquify') }}</option><option value="blur">{{ t('Blur') }}</option><option value="smudge">{{ t('Smudge') }}</option></select></label><label v-if="tool==='smear'&&smearMode==='blur'||tool==='heal'&&retouchMode==='blur'">{{ t('Radius') }}<input v-model.number="blurRadius" type="number" min=".5" max="50" step=".1" :aria-label="t('Blur radius')"></label><label v-if="tool==='magic'||tool==='object'">{{ t('Mode') }}<select :value="tool" :aria-label="t('Magic mode')" @change="chooseTool(($event.target as HTMLSelectElement).value as Tool)"><option value="magic">{{ t('Wand') }}</option><option value="object">{{ t('Object Selection') }}</option></select></label><label v-if="tool==='eyedropper'"><input v-model="showSampleRing" type="checkbox">{{ t('Sample Ring') }}</label><template v-if="tool==='magic'"><label>{{ t('Tolerance') }}<input v-model.number="wandTolerance" type="number" min="0" max="255"></label><label>{{ t('Sample') }}<select v-model="wandSampleSize" :aria-label="t('Wand sample size')"><option value="point">{{ t('Point') }}</option><option value="3x3">3 × 3</option><option value="5x5">5 × 5</option></select></label><label><input v-model="wandAllLayers" type="checkbox">{{ t('All Layers') }}</label><label><input v-model="selectionAA" type="checkbox">{{ t('Anti-alias') }}</label><label><input v-model="wandContiguous" type="checkbox">{{ t('Contiguous') }}</label></template><template v-if="tool==='crop'"><label>{{t('Crop mode')}}<select :value="cropMode" :aria-label="t('Crop mode')" :disabled="busy" @change="chooseCropMode(($event.target as HTMLSelectElement).value as 'crop'|'straighten'|'perspective')"><option value="crop">{{t('Crop')}}</option><option value="straighten">{{t('Straighten')}}</option><option value="perspective">{{t('Perspective Crop')}}</option></select></label><span v-if="cropMode==='perspective'" class="crop-preserve-mode" :title="t('Perspective Crop resamples raster layers at their original working depth. Undo restores the source. Rasterize text and shapes first; groups, adjustments, effects, guides and feathered masks are unsupported.')">{{t('Resamples layers')}}</span><span v-else class="crop-preserve-mode" :title="t('Pixels outside the crop are preserved. Expand the canvas to reveal them again.')">{{t('Non-destructive crop')}}</span><label>{{ t('Ratio') }}<select v-model="cropRatio" :aria-label="t('Crop ratio')"><option v-for="ratio in ['Free','Original','1:1','4:3','3:4','16:9','9:16']" :value="ratio">{{t(ratio)}}</option></select></label><span v-if="cropMode==='straighten'">{{cropAngle.toFixed(2)}}° · {{t('Draw a horizon or vertical reference line')}}</span><template v-if="cropMode==='perspective'"><label><input v-model="perspectivePointMode" type="checkbox" :aria-label="t('Four-corner input')"/>{{t('Four-corner input')}}</label><span :title="t('Suggested size restores perspective proportions when possible and preserves the longest source edges. Photoshop automatic resolution can still differ; set output dimensions explicitly for an exact size.')">{{t(perspectiveManualSize?'Output size':'Suggested output size')}}</span><CommitInput :label="t('Perspective output width')" :value="perspectiveWidth" :min="1" :max="30000" :step="1" @commit="updatePerspectiveSize('width',Number($event))"/><span>×</span><CommitInput :label="t('Perspective output height')" :value="perspectiveHeight" :min="1" :max="30000" :step="1" @commit="updatePerspectiveSize('height',Number($event))"/></template><span v-else-if="cropDraft">{{cropDraft.width}} × {{cropDraft.height}} px</span><button @click="cancelCrop" :disabled="!cropDraft&&!(cropMode==='perspective'&&perspectivePointMode&&!perspectiveReady)">{{ t('Cancel') }}</button><button :disabled="busy||!cropDraft||!cropRequest||cropMode==='perspective'&&!perspectiveReady" @click="applyCrop" :aria-label="t('Apply Crop')">{{ t('Apply Crop') }}</button></template><template v-if="tool==='mixer-brush'"><label>{{t('Size')}}<CommitInput :label="t('Brush size')" :value="brushSize" :min="1" :max="4096" @preview="brushSize=Number($event)" @commit="brushSize=Number($event)"/></label><label>{{t('Hardness')}}<CommitInput :label="t('Hardness')" :value="Math.round(hardness*100)" :min="0" :max="100" @preview="hardness=Number($event)/100" @commit="hardness=Number($event)/100"/></label><label>{{t('Opacity')}}<CommitInput :label="t('Mixer opacity')" :value="Math.round(paintOpacity*100)" :min="0" :max="100" @preview="paintOpacity=Number($event)/100" @commit="paintOpacity=Number($event)/100"/></label><label>{{t('Wet')}}<CommitInput :label="t('Mixer wet')" :value="Math.round(mixerWet*100)" :min="0" :max="100" @commit="mixerWet=Number($event)/100"/></label><label>{{t('Load')}}<CommitInput :label="t('Mixer load')" :value="Math.round(mixerLoad*100)" :min="0" :max="100" @commit="mixerLoad=Number($event)/100"/></label><label>{{t('Mix')}}<CommitInput :label="t('Mixer mix')" :value="Math.round(mixerMix*100)" :min="0" :max="100" @commit="mixerMix=Number($event)/100"/></label><label>{{t('Flow')}}<CommitInput :label="t('Mixer flow')" :value="Math.round(mixerFlow*100)" :min="0" :max="100" @commit="mixerFlow=Number($event)/100"/></label><button :disabled="busy" @click="mixerPaint('clean')">{{t('Clean Mixer Paint')}}</button><button :disabled="busy" @click="mixerPaint('load')">{{t('Load Mixer Paint')}}</button><label><input v-model="mixerCleanAfter" type="checkbox">{{t('Clean after stroke')}}</label><label><input v-model="mixerLoadAfter" type="checkbox">{{t('Load after stroke')}}</label><label>{{t('Pickup')}}<select v-model="mixerPickup" :aria-label="t('Mixer pickup')"><option value="average">{{t('Average')}}</option><option value="tip">{{t('Tip')}}</option></select></label><label><input v-model="mixerProtectAlpha" type="checkbox">{{t('Protect Transparency')}}</label><span>{{t('Paint remaining')}} {{Math.round(mixerReservoir.paintRemaining*100)}}%</span></template><template v-if="['dodge','burn','sponge'].includes(tool)"><label>{{t('Size')}}<CommitInput :label="t('Brush size')" :value="brushSize" :min="1" :max="4096" @preview="brushSize=Number($event)" @commit="brushSize=Number($event)"/></label><label>{{t('Hardness')}}<CommitInput :label="t('Hardness')" :value="Math.round(hardness*100)" :min="0" :max="100" @preview="hardness=Number($event)/100" @commit="hardness=Number($event)/100"/></label><label>{{tool==='sponge'?t('Flow'):t('Exposure')}}<CommitInput :label="tool==='sponge'?t('Sponge flow'):t('Tonal exposure')" :value="Math.round(tonalExposure*100)" :min="0" :max="100" @preview="tonalExposure=Number($event)/100" @commit="tonalExposure=Number($event)/100"/></label><template v-if="tool!=='sponge'"><label>{{t('Range')}}<select v-model="tonalRange" :aria-label="t('Tonal range')"><option value="shadows">{{t('Shadows')}}</option><option value="midtones">{{t('Midtones')}}</option><option value="highlights">{{t('Highlights')}}</option></select></label><label><input v-model="tonalProtect" type="checkbox">{{t('Protect Tones')}}</label></template><template v-else><label>{{t('Mode')}}<select v-model="spongeMode" :aria-label="t('Sponge mode')"><option value="desaturate">{{t('Desaturate')}}</option><option value="saturate">{{t('Saturate')}}</option></select></label><label><input v-model="spongeVibrance" type="checkbox">{{t('Vibrance')}}</label></template></template><template v-if="tool==='history-brush'||tool==='art-history-brush'"><button :disabled="busy" @click="historySource('capture')">{{t('Capture History Source')}}</button><label>{{t('History Source')}}<select :value="state?.historyBrush?.sourceId??''" :disabled="busy||!state?.historyBrush?.snapshots.length" :aria-label="t('History Source')" @change="historySource('select',($event.target as HTMLSelectElement).value)"><option value="" disabled>{{t('Capture a source first')}}</option><option v-for="snapshot in state?.historyBrush?.snapshots" :key="snapshot.id" :value="snapshot.id">{{snapshot.label==='Initial state'?t('Initial state'):snapshot.label}}</option></select></label><label v-if="tool==='art-history-brush'">{{t('Source patch size')}}<CommitInput :label="t('Source patch size')" :value="historyArtSize" :min="2" :max="128" @commit="historyArtSize=Number($event)"/></label><span v-if="tool==='art-history-brush'">{{t('Source color patches approximation')}}</span></template><template v-if="tool==='paint-bucket'"><label>{{t('Tolerance')}}<input v-model.number="bucketTolerance" type="number" min="0" max="255" :aria-label="t('Paint Bucket tolerance')"></label><label><input v-model="bucketContiguous" type="checkbox" :aria-label="t('Paint Bucket contiguous')">{{t('Contiguous')}}</label><label><input v-model="bucketAA" type="checkbox" :aria-label="t('Paint Bucket anti-alias')">{{t('Anti-alias')}}</label><label><input v-model="bucketAllLayers" type="checkbox" :aria-label="t('Paint Bucket all layers')">{{t('All Layers')}}</label><label>{{t('Opacity')}}<CommitInput :label="t('Paint Bucket opacity')" :value="Math.round(paintOpacity*100)" :min="0" :max="100" @preview="paintOpacity=Number($event)/100" @commit="paintOpacity=Number($event)/100"/></label></template><template v-if="tool==='gradient'"><label><input v-model="radialGradient" type="checkbox">{{ t('Radial') }}</label><label>{{ t('Colors') }}<select v-model="gradientStyle" :aria-label="t('Gradient colors')"><option value="transparent">{{ t('Foreground to Transparent') }}</option><option value="background">{{ t('Foreground to Background') }}</option></select></label><label><input v-model="gradientReverse" type="checkbox"/>{{ t('Reverse') }}</label><label>{{ t('Opacity') }}<CommitInput :label="t('Gradient opacity')" :value="gradientOpacity" :min="0" :max="1" :step=".01" @preview="gradientOpacity=Number($event)" @commit="gradientOpacity=Number($event)"/></label><label v-if="selected?.maskFile"><input v-model="maskTarget" type="checkbox"/>{{ t('Mask') }}</label><template v-if="gradientDraft"><button @click="finishGradient()">{{ t('Cancel') }}</button><button @click="finishGradient(true)" :aria-label="t('Apply Gradient')">{{ t('Apply') }}</button></template></template></section>
    <section v-if="tool==='rotate-view'&&!showNew" class="transform-toolbar view-rotation-toolbar"><strong>{{t('Rotate View')}}</strong><label>{{t('View angle')}}<CommitInput :label="t('View angle')" :value="viewAngle" :min="-360" :max="360" @preview="viewAngle=Number($event)" @commit="viewAngle=Number($event)" /></label><button @click="viewAngle=0">{{t('Reset View Rotation')}}</button><span>{{t('Drag to rotate the view · Shift snaps to 15°')}}</span></section>
    <ToolGroupMenu v-if="toolFlyout" :open="true" :group="toolFlyout.group" :anchor="toolFlyout.anchor" :selected="toolFlyoutSelection" :disabled="busy" @select="chooseToolGroupEntry" @close="closeToolFlyout"/>
    <div class="work-area">
      <aside class="tool-rail" :aria-label="t('Canvas tools')"><div class="rail-tools">
        <button :class="{ active: tool === 'move' }" @click="chooseTool('move')" :aria-label="t('Move / Transform (V)')" :title="t('Move / Transform (V)')"><EditorToolIcon tool="move" /></button>
        <button v-for="item in canvasTools" :key="item.name" :aria-label="railToolLabel(item.mode,item.name)" :title="railToolLabel(item.mode,item.name)" :class="{active:tool===item.mode||!!toolGroupForTool(item.mode)&&toolGroupForTool(tool)?.id===toolGroupForTool(item.mode)?.id}" :disabled="false" @click="toolClick(item.mode)" @pointerdown="toolPointerDown(item.mode,$event)" @pointerup="cancelToolHold" @pointercancel="cancelToolHold" @pointerleave="cancelToolHold" @contextmenu.prevent="openToolFlyout(item.mode,$event.currentTarget as HTMLButtonElement)" @keydown.shift.f10.prevent="openToolFlyout(item.mode,$event.currentTarget as HTMLButtonElement)" :aria-haspopup="(toolGroupForTool(item.mode)?.entries.length??0)>1?'menu':undefined" :aria-expanded="toolFlyout?.group===toolGroupForTool(item.mode)?.id" :data-tool-group="toolGroupForTool(item.mode)?.id" :data-tool-mode="item.mode"><EditorToolIcon v-bind="railToolIcon(item.mode)" /><span v-if="(toolGroupForTool(item.mode)?.entries.length??0)>1" class="tool-group-indicator" aria-hidden="true">◢</span></button>
        <button :class="{ active: tool === 'hand' }" @click="chooseTool('hand')" :aria-label="t('Hand (H)')" :title="t('Hand (H)')"><Hand :size="22" /></button>
        <button :class="{active:tool==='rotate-view'}" :title="t(interactionProfile==='photoshop'?'Rotate View (R)':'Rotate View')" :aria-label="t(interactionProfile==='photoshop'?'Rotate View (R)':'Rotate View')" @click="chooseTool('rotate-view')"><RotateCw :size="21" /></button>
        <button :class="{ active: tool === 'zoom' }" @click="chooseTool('zoom')" :aria-label="t('Zoom (Z)')" :title="t('Zoom (Z)')"><ZoomIn :size="22" /></button>
        <button :aria-label="t(quickMask?'Exit Quick Mask':'Edit selection in Quick Mask')" :title="t('Quick Mask (Q)')" :class="{active:quickMask}" :aria-pressed="quickMask" @click="toggleQuickMask"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4" :fill="quickMask?'currentColor':'none'"/></svg></button>
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
          <div class="canvas-stage"><div ref="canvasWrap" class="canvas-wrap checkerboard" :data-view-angle="viewAngle" :style="{ width: `${pixelSize.width}px`, height: `${pixelSize.height}px`,transform:`translate(${panOffset.x}px,${panOffset.y}px) rotate(${viewAngle}deg)` }" @pointerdown="pointerDown($event)" @pointermove="pointerMove" @pointerup="infoTools.active.value?(infoTools.move($event),infoTools.finish()):canvasPointerEnd($event)" @pointercancel="canvasPointerEnd($event,true)" @pointerleave="leaveCanvas" @contextmenu.prevent>
            <canvas ref="canvas" data-testid="editor-canvas" :data-rendering="rendering" :style="viewportPlan?.css ?? {width: `${pixelSize.width}px`,height: `${pixelSize.height}px`}" :data-world-x="viewportPlan?.region.x" :data-world-y="viewportPlan?.region.y" :data-world-width="viewportPlan?.region.width" :data-world-height="viewportPlan?.region.height"></canvas>
            <VectorPathOverlay v-if="state&&(tool==='pen'||tool==='path-selection'||tool==='direct-selection')" ref="vectorOverlay" :path="activeVectorPath" :width="state.manifest.width" :height="state.manifest.height" :zoom="zoom" :mode="tool==='pen'?'pen':tool==='path-selection'?'path':'edit'" :map-client-point="geometryPoint" :disabled="busy" :space-pan="spacePan" @update="vectorDraft=$event" @commit="commitVectorPath" @interaction="vectorInteraction" @cancel="cancelVectorDraft" @selected="vectorSelectedKnot=$event" @delete-path="deleteCurrentVectorPath"/>
            <FrameOverlay v-if="state&&tool==='frame'&&selected?.frame&&activeFrame&&!frameCreateNew" ref="frameOverlay" :frame="activeFrame" :content-transform="frameContentDraft??selected?.transform" :mode="frameMode" :zoom="zoom" :view-angle="viewAngle" :disabled="busy" :space-pan="spacePan" @boundary="frameDraft=$event" @content="frameContentDraft=$event" @interaction="frameInteraction" @commit="commitFrame()" @cancel="cancelFrameDraft"/>
            <FrameCreationOverlay v-else-if="state&&tool==='frame'" ref="frameCreation" :width="state.manifest.width" :height="state.manifest.height" :zoom="zoom" :kind="frameKind" :map-client-point="geometryPoint" :disabled="busy" :space-pan="spacePan" @update="frameDraft=$event" @interaction="frameInteraction" @commit="commitFrame" @cancel="cancelFrameDraft"/>
            <InfoToolsOverlay v-if="state" :info="infoTools.displayInfo.value" :width="state.manifest.width" :height="state.manifest.height" :zoom="zoom" :interactive="tool==='color-sampler'||tool==='ruler'" :sample-interactive="tool==='color-sampler'" :ruler-interactive="tool==='ruler'" @sample-down="infoTools.startSample" @ruler-down="infoTools.startRuler" @move="infoTools.move" @up="infoTools.finish()" @cancel="infoTools.cancel()"/><svg v-if="magnetic.active.value" class="selection-outline" :viewBox="`0 0 ${state?.manifest.width} ${state?.manifest.height}`" :width="pixelSize.width" :height="pixelSize.height"><polyline data-testid="magnetic-lasso-path" class="marching" :points="magnetic.points.value.map(p=>p.join(',')).join(' ')"/></svg><BrushCursor :point="brushHover" :diameter="brushSize" :zoom="zoom" :tool="tool==='remove'||tool==='quick-selection'?'brush':tool==='red-eye'?'eyedropper':tool" :hardness="hardness" :sampling="tool==='remove'||tool==='magic-eraser'?false:cursorSampling" :enabled="!spacePan&&!showNew&&!contentOnCanvas" :show-sample-ring="showSampleRing&&sampleRingActive" :sampled-color="foreground" :original-color="sampleRingOriginal"/><CropOverlay ref="cropOverlay" :view-angle="viewAngle" v-if="visibleCrop&&cropMode==='crop'" :draft="visibleCrop" :workspace="cropWorkspace" :zoom="zoom" :aspect="cropAspect()" :snap="cropSnap" :disabled="busy" :space-pan="spacePan" @update="updateCrop" @interaction="cropInteraction" @cancel="cancelCropOverlay"/><CropGeometryOverlay v-if="visibleCrop&&cropMode!=='crop'&&state" ref="cropGeometryOverlay" :mode="cropMode" :point-mode="perspectivePointMode" :inclusive-drag="interactionProfile==='photoshop'" @ready="perspectiveReady=$event" :draft="visibleCrop" :corners="perspectiveCorners" :preview-corners="perspectiveSampleCorners" :line="cropLine" :workspace="cropWorkspace" :zoom="zoom" :view-angle="viewAngle" :width="state.manifest.width" :height="state.manifest.height" :output-width="perspectiveWidth" :output-height="perspectiveHeight" :source-canvas="thumbnailCanvas" :source-region="{x:0,y:0,width:state.manifest.width,height:state.manifest.height}" :disabled="busy" :space-pan="spacePan" @line="updateStraighten" @corners="updatePerspective" @interaction="cropInteraction" @cancel="cancelCropOverlay"/><CloneSourceOverlay v-if="tool==='clone'&&cloneMarker&&state" :point="cloneMarker" :width="state.manifest.width" :height="state.manifest.height" :zoom="zoom"/>
            <svg v-if="redEyeDraft&&state" class="selection-outline" data-testid="red-eye-bounds" :width="pixelSize.width" :height="pixelSize.height" :viewBox="`0 0 ${state.manifest.width} ${state.manifest.height}`"><rect :x="redEyeDraft[0]" :y="redEyeDraft[1]" :width="redEyeDraft[2]" :height="redEyeDraft[3]" fill="none" stroke="white" :stroke-width="1/zoom"/></svg>
            <SelectionMaskOverlay v-if="state&&(quickMask||tool==='selection-brush')" :selection="selectionDisplay" :plan="viewportPlan" :width="state.manifest.width" :height="state.manifest.height" :zoom="zoom" :protected-areas="quickMask" @error="error={message:$event}"/>
            <svg v-if="!quickMask&&(selectionDisplay||rasterPoints.length||cropDraft||polygonPoints.length)" class="selection-outline" :viewBox="`0 0 ${state?.manifest.width} ${state?.manifest.height}`" :width="pixelSize.width" :height="pixelSize.height"><path v-if="combinedOutline!==undefined" class="marching" :d="combinedOutline"/><rect v-if="combinedOutline===undefined&&selectionDisplay?.inverted" class="marching" x="0" y="0" :width="state?.manifest.width" :height="state?.manifest.height"/><template v-for="(shape,i) in (combinedOutline!==undefined?[]:selectionDisplay?.shapes)" :key="i"><rect v-if="shape.kind==='rectangle'" class="marching" :x="shape.bounds[0]" :y="shape.bounds[1]" :width="shape.bounds[2]" :height="shape.bounds[3]"/><ellipse v-else-if="shape.kind==='ellipse'" class="marching" :cx="shape.bounds[0]+shape.bounds[2]/2" :cy="shape.bounds[1]+shape.bounds[3]/2" :rx="shape.bounds[2]/2" :ry="shape.bounds[3]/2"/><path v-else-if="shape.kind==='raster'" class="marching" :transform="rasterSelectionMatrix(shape.raster!.transform,shape.raster!.width,shape.raster!.height)" :d="rasterSelectionOutline(shape.raster!)" /><polygon v-else class="marching" :points="shape.points?.map(p=>p.join(',')).join(' ')" /></template><rect v-if="cropDraft&&cropMode==='crop'" class="marching" :x="cropDraft.x" :y="cropDraft.y" :width="cropDraft.width" :height="cropDraft.height"/><polyline v-if="polygonPoints.length" class="marching" :points="polygonPoints.map(p=>p.join(',')).join(' ')"/></svg>
            <GradientOverlay v-if="tool==='gradient'&&gradientDraft&&!spacePan" :start="gradientDraft.start" :end="gradientDraft.end" :zoom="zoom" :radial="radialGradient" @down="(event,endpoint)=>pointerDown(event,`gradient-${endpoint}`)" @move="pointerMove" @up="pointerUp()" @cancel="pointerUp(true)"/>
            <SelectionTransformOverlay :view-angle="viewAngle" v-if="floatingSelection" :transform="floatingSelection.transform" :corners="floatingSelection.corners" :zoom="zoom" @update="floatingSelection.transform=$event" @corners="floatingSelection.corners=$event"/>
            <svg v-if="showDistort&&distortCorners" class="distort-outline" :width="pixelSize.width" :height="pixelSize.height" :viewBox="`0 0 ${state?.manifest.width} ${state?.manifest.height}`"><polygon :points="distortCorners.map(p=>p.join(',')).join(' ')" fill="none" stroke="#0a84ff" :stroke-width="1.5/zoom"/></svg>
            <template v-if="showDistort&&distortCorners"><button v-for="(point,index) in distortCorners" :key="index" class="distort-corner" :aria-label="t('Distort corner {index}', {index:index+1})" :style="{left:`${point[0]*zoom}px`,top:`${point[1]*zoom}px`}" @pointerdown.stop="startDistortDrag($event,index)" @pointermove.stop="moveDistortDrag" @pointerup.stop="endDistortDrag" @pointercancel.stop="endDistortDrag"/></template>
            <ContentCanvasOverlay ref="contentCanvas" :zoom="zoom" :disabled="busy" :foreground="foreground" :text-shortcut-overrides="shortcutOverrides" :shortcut-platform="platform==='darwin'?'mac':'other'" :commit-edit="contentRaster" @create="contentRaster" @update="contentRaster" @draft="canvasDraftChanged" @preview="previewContent" @selection="canvasTextSelection=$event" @lease="canvasContentLease" @close="contentPreview=undefined;contentOnCanvas=false;canvasContentDraft=undefined;canvasContentEditingLayer=undefined;contentToolDraft=undefined;contentResetKey++" @error="error={message:$event}" />
            <div v-if="!showDistort && bounds && showControls && tool === 'move' && !spacePan" class="transform-outline" :style="bounds"><button v-for="position in ['nw','n','ne','e','se','s','sw','w']" :key="position" :class="['transform-handle', position]" :aria-label="t('Resize {position}', {position:t(position)})" @pointerdown.stop="pointerDown($event, position)" @pointermove.stop="pointerMove" @pointerup.stop="pointerUp()" @pointercancel.stop="pointerUp(true)"></button><span class="rotation-stem"></span><button class="rotation-handle" :aria-label="t('Rotate layer')" @pointerdown.stop="pointerDown($event, 'rotate')" @pointermove.stop="pointerMove" @pointerup.stop="pointerUp()" @pointercancel.stop="pointerUp(true)"></button></div>
          </div></div>
        </div>
        <button v-if="maskAlone" style="position:absolute;left:80px;top:125px;z-index:5;background:#333;border:1px solid #555;padding:5px 10px;border-radius:5px" @click="maskAlone=false">{{ t('Mask alone · Show composite') }}</button><WorkspaceOverlays v-if="state&&!showNew&&!canvasOnly" :document="state.manifest" :viewport="viewSize" :canvas-origin="canvasOrigin" :zoom="zoom" :thumbnail="thumbnail" :navigator="navigatorVisible" :rulers="rulers&&!viewAngle" :grid-visible="gridVisible&&!viewAngle" :guides-visible="guidesVisible&&!viewAngle" :guides-locked="guidesLocked" :guides="state.manifest.guides??[]" :grid="grid" @center="centerView" @guides-change="edit({type:'document.guides',guides:$event})" @grid-change="grid=$event" />
      </main>
      <aside class="inspector" :aria-label="t('Layers panel')">
        <div class="layer-heading"><strong>{{ t('Layers') }}</strong><span>{{ showNew ? 0 : state?.manifest.layers.length ?? 0 }}</span></div>
        <div class="layer-controls"><label>{{ t('Blend') }}<BlendMenu :value="selected?.blendMode ?? 'Normal'" :disabled="!selected || selected.isGroup || showNew" @preview="blendPreview = $event" @commit="selected && edit({ type: 'layer.set_blend', layerId: selected.id, blendMode: $event })" /></label><label>{{ t('Opacity') }}<input class="opacity-slider" :aria-label="t('Opacity slider')" type="range" min="0" max="100" :value="Math.round((selected?.opacity ?? 1) * 100)" :disabled="!selected || showNew" @change="selected && edit({ type: 'layer.set_opacity', layerId: selected.id, opacity: Number(($event.target as HTMLInputElement).value) / 100 })" /><CommitInput :label="t('Layer opacity')" :value="Math.round((selected?.opacity ?? 1) * 100)" :disabled="!selected || showNew" :min="0" :max="100" @commit="selected && edit({ type: 'layer.set_opacity', layerId: selected.id, opacity: Number($event) / 100 })" @editing="request('interaction', $event)" /><span>%</span></label></div>
        <div class="layer-list" role="list" :aria-label="t('Document layers')" @dragover.prevent @drop.prevent="dropLayers(undefined, $event)"><template v-if="!showNew"><div v-for="{ layer, depth } in rows" :key="layer.id" class="layer-row" :class="{ selected: selectedIds.includes(layer.id), hidden: !layer.isVisible }" :style="{ paddingLeft: `${12 + depth * 15}px` }" @click.stop="selectLayer(layer, $event)" draggable="true" @dragstart="startLayerDrag(layer, $event)" @dragover.prevent @drop.prevent.stop="dropLayers(layer, $event)" @contextmenu.prevent.stop="openContext(layer, $event)" role="listitem" :data-layer-id="layer.id">
          <button v-if="layer.isGroup" class="folder-toggle" :aria-label="t(collapsedGroups.includes(layer.id) ? 'Expand {name}' : 'Collapse {name}', {name:layer.name})" :aria-expanded="!collapsedGroups.includes(layer.id)" @click.stop="toggleFolder(layer.id)"><ChevronDown :size="13" :class="{ collapsed: collapsedGroups.includes(layer.id) }" /></button><span v-else class="folder-toggle-spacer"></span>
          <button class="visibility-button" @click.stop="layerEyeClick(layer,$event)" :aria-label="t(layer.isVisible ? 'Hide {name}' : 'Show {name}', {name:layer.name})"><Eye v-if="layer.isVisible" :size="18" /><EyeOff v-else :size="18" /></button>
          <button class="layer-thumbnail checkerboard" :class="{ folder: layer.isGroup }" :style="selectedId===layer.id&&maskTarget?{boxShadow:'none'}:undefined" :aria-label="t('Select {name} image', {name:layer.name})" @click.stop="imageThumbnailClick(layer,$event)"><Folder v-if="layer.isGroup" :size="23" /><img v-else-if="layer.imageFile && state" :src="assetUrl(state, layer.imageFile)" alt="" /></button><MaskThumbnail v-if="layer.maskFile&&state" :url="assetUrl(state,layer.maskFile)" :name="layer.name" :selected="selectedId===layer.id&&maskTarget" :enabled="layer.maskEnabled!==false" :linked="layer.maskLinked!==false" @drag="startComponentDrag(layer,$event,'mask')" @select="maskThumbnailClick(layer,$event)" @link="edit({type:'layer.mask',layerId:layer.id,operation:layer.maskLinked===false?'link':'unlink'})" /><div class="layer-name" @dblclick="layer.adjustment?openFilter(nativeAdjustmentToSpec(layer.adjustment).kind,true):layer.text?(showContent='text'):layer.shape?(showContent='shape'):(renamingId=layer.id)"><CommitInput v-if="renamingId === layer.id" :label="t('Layer name')" type="text" :value="layer.name" @commit="edit({ type: 'layer.rename', layerId: layer.id, name: $event }); renamingId = undefined" @editing="request('interaction', $event)" /><span v-else>{{ layer.name }}<span v-if="layer.locked||layer.positionLocked" :title="t(layer.locked?'Lock all':'Lock position')"> 🔒</span></span><LayerEffectBadges v-if="layer.effects" :effects="layer.effects as LayerEffects" @drag="(kind,event)=>startComponentDrag(layer,event,'effect',kind)" @edit="editLayerEffect(layer,$event)"/><span v-if="layerHDR(layer)||layerDepth(layer)===16" class="layer-depth-badge">{{ t(layerHDR(layer)?'HDR':'16-Bit') }}</span><small v-if="!layer.isGroup">{{ Math.round(layer.transform.size[0]) }} × {{ Math.round(layer.transform.size[1]) }} px</small></div>
        </div></template><div v-if="showNew || !rows.length" class="empty-layers"><Layers :size="29" /><strong>{{ t('No layers yet') }}</strong><p>{{ t('Create a canvas or import an image.') }}</p></div></div>
        <div class="layer-footer"><button @click="action('blank')" :disabled="showNew" :aria-label="t('New blank layer')" :title="t('New blank layer')"><SquarePlus :size="17" /></button><button @click="action('folder')" :disabled="showNew" :aria-label="t('New folder')" :title="t('New folder')"><FolderPlus :size="19" /></button><button :disabled="!selected||showNew||selectedIds.length!==1||!!selected.maskFile" @click="selected&&edit({type:'layer.mask',layerId:selected.id,operation:$event.altKey?'hide':'reveal'})" :aria-label="t('Add layer mask')" :title="t('Add layer mask')"><Square :size="19" /></button><button :disabled="showNew" @click.stop="layerFooterMenu=layerFooterMenu==='adjustments'?undefined:'adjustments'" :aria-expanded="layerFooterMenu==='adjustments'" :aria-label="t('New adjustment layer')" :title="t('New adjustment layer')"><svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"/></svg><ChevronDown :size="10" /></button><button :disabled="!selected?.imageFile||showNew" @click.stop="layerFooterMenu=layerFooterMenu==='effects'?undefined:'effects'" :aria-expanded="layerFooterMenu==='effects'" :aria-label="t('Layer effects')" :title="t('Layer effects')"><Sparkles :size="18" /><ChevronDown :size="10" /></button><button class="delete-layer" @click="action('delete')" :disabled="!selected || showNew" :aria-label="t('Delete selected layer')" :title="t('Delete selected layer')"><Trash2 :size="18" /></button></div>
        <div v-if="layerFooterMenu" class="layer-footer-menu" @click.stop><template v-if="layerFooterMenu==='adjustments'"><button v-for="(name,kind) in NATIVE_ADJUSTMENT_KINDS" :key="kind" @click="chooseAdjustment(kind)">{{ t(name) }}</button></template><template v-else><button v-for="kind in EFFECT_KINDS" :key="kind" @click="chooseEffect(kind)">{{ t(EFFECT_NAMES[kind]) }}</button></template></div>
      </aside>
    </div>
    <div v-if="dropActive" class="modal-backdrop" style="pointer-events:none"><div class="size-dialog"><h2>{{ t('Drop files to open a project or import image layers') }}</h2></div></div>
    <div v-if="showRecents" class="modal-backdrop" @click.self="showRecents=false"><section class="size-dialog recent-dialog" role="dialog" aria-modal="true" :aria-label="t('Recent projects')"><header><h2>{{ t('Recent projects') }}</h2></header><div class="recent-dialog-body"><p v-if="!recentProjects.length" class="recent-empty">{{ t('No recent projects yet.') }}</p><div v-else class="recent-project-list"><button v-for="project in recentProjects" :key="project.id" :title="project.location" class="recent-project" @click="openRecent(project.id)"><span>{{ project.title }}</span><small>{{ project.format.toUpperCase() }}</small></button></div></div><footer class="dialog-actions"><button type="button" :disabled="!recentProjects.length" @click="clearRecents">{{ t('Clear recent projects') }}</button><button type="button" class="primary" @click="showRecents=false">{{ t('Close') }}</button></footer></section></div>
    <PhotoshopImportPanel :state="photoshop" @confirm="photoshopAction('photoshopConfirm',$event)" @cancel="photoshopAction('photoshopCancel',$event)" />
    <RawImportPanel v-if="foreign.kind === 'raw'" :open="foreign.status !== 'idle'" :filename="foreign.filename ?? ''" :settings="foreign.settings" :metadata="foreign.metadata" :preview="foreign.preview" :error="foreign.error" :busy="['metadata','preview','decoding','committing','error'].includes(foreign.status)" :cancelable="foreign.status!=='committing'" @import="foreignAction('foreignConfirm',$event)" @camera-raw="foreignAction('foreignConfirmCameraRaw',$event)" @preview="foreignAction('foreignPreview',$event)" @cancel="foreignAction('foreignCancel')" />
    <div v-if="foreign.kind !== 'raw' && foreign.status !== 'idle'" class="modal-backdrop"><div class="size-dialog" role="dialog" :aria-label="t('Image import')"><h2>{{ t('Import image') }}</h2><p>{{ foreign.filename }}</p><p>{{ foreign.error ? tm(foreign.error) : t('Decoding image…') }}</p><button :disabled="foreign.status==='committing'" @click="foreignAction('foreignCancel')">{{ t('Cancel import') }}</button></div></div>
    <div v-if="showAgent" class="agent-panel"><AgentChat v-bind="agent" :configure-model="config=>agentRequest('agentConfigure',config)" :send-message="text=>agentRequest('agentSend',{text})" :document-title="state?.title" @configure="agentRequest('agentConfigure',$event)" @send="agentRequest('agentSend',{text:$event})" @cancel="agentRequest('agentCancel')" @clear="agentRequest('agentClear')" @undo="agentRequest('agentUndo')" @close="showAgent=false" /></div>
    <div v-if="showNamedSelections&&state" class="feature-panel"><div class="drawer-heading"><strong>{{t('Named Selections')}}</strong><button :aria-label="t('Close')" @click="showNamedSelections=false"><X :size="16"/></button></div><NamedSelections :selections="state.manifest.namedSelections" :has-selection="!!state.selection" :disabled="busy" @action="edit"/></div>
    <div v-if="infoTools.showPanel.value&&state" class="feature-panel info-feature-panel"><div class="drawer-heading"><strong>{{t('Info')}}</strong><button :aria-label="t('Close Info')" @click="infoTools.showPanel.value=false"><X :size="16"/></button></div><InfoToolsPanel :info="infoTools.info.value" :readings="infoTools.readings.value" :resolution="state.manifest.resolution" :disabled="busy||infoTools.active.value" :error="tm(infoTools.error.value)" :loading="infoTools.loading.value" @change="infoTools.change" @remove-sample="infoTools.removeSample" @clear-samples="infoTools.clearSamples" @clear-ruler="infoTools.clearRuler"/></div><div v-if="showLayerActions&&state" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Layer operations') }}</strong><button @click="showLayerActions=false"><X :size="16" /></button></div><LayerActions :manifest="state.manifest" :selected-ids="selectedIds" :disabled="busy" :can-paste="canPaste" @actions="editMany" @copy="copyLayers" @cut="copyLayers($event,true)" @paste="pasteLayers" @merge="mergeLayers" @composite="mergeCommand" @error="error={message:$event}" /><MaskPanel v-if="selected&&!selected.frame&&!selected.vectorMask" :layer="selected" :feather-model="interactionProfile" :document-width="state.manifest.width" :document-height="state.manifest.height" :coverage="interactionProfile==='photoshop'?'visible':'hidden'" :url="selected.maskFile?assetUrl(state,selected.maskFile):undefined" :disabled="busy" :selected="maskTarget" :alone="maskAlone" @action="edit" @select="chooseMask" @alone="maskAlone=$event;chooseMask()" @preview="maskPreview=$event" @properties-preview="maskPropertiesPreview=$event" @placement="maskPlacementPreview=$event" @background="maskGrayBackground=$event" @error="error={message:$event}" /><div v-if="selected" class="mask-actions"><label>{{ t('Clipping source') }}<select :value="selected.maskSourceID??''" @change="edit({type:'layer.set_clipping',layerId:selected.id,sourceId:($event.target as HTMLSelectElement).value||null})"><option value="">{{ t('None') }}</option><option v-for="layer in state.manifest.layers.filter(item=>!item.isGroup&&item.id!==selected?.id)" :value="layer.id">{{layer.name}}</option></select></label></div></div>
    <div v-if="showSubjects&&state" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Subject / Object') }}</strong><button @click="showSubjects=false"><X :size="16" /></button></div><button :disabled="!canRefineEdges||busy" @click="openEdgeRefinement">{{t('Refine Selection Edges…')}}</button><ObjectSelectionTools :width="state.manifest.width" :height="state.manifest.height" :box="objectBox" :disabled="!selected" :has-raster="!!selected?.imageFile" :busy="!!imageOperation" :preview="subjectPreview?.url" :preview-busy="subjectPreviewBusy" :pending="!!subjectDraft" @preview="previewSubject" @apply="finishSubjectPreview(true)" :progress="imageOperation?.progress" @select="selectSubject" @drawbox="showSubjects=false;chooseTool('object')" @fill="action('content-fill')" @cancel="subjectDraft?finishSubjectPreview():request('cancelImageOperation',{sessionId:state.sessionId})" @error="error={message:$event}" /></div>
    <div v-if="showTrim" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Trim Canvas') }}</strong><button @click="showTrim=false"><X :size="16" /></button></div><label>{{ t('Based on') }}<select v-model="trimOptions.basedOn"><option value="transparent">{{ t('Transparent Pixels') }}</option><option value="top-left">{{ t('Top Left Pixel Color') }}</option><option value="bottom-right">{{ t('Bottom Right Pixel Color') }}</option></select></label><label v-for="side in ['top','bottom','left','right'] as const"><input v-model="trimOptions[side]" type="checkbox">{{t(side)}}</label><label>{{ t('Tolerance') }}<input v-model.number="trimOptions.tolerance" type="number" min="0" max="255"></label><button @click="edit({type:'document.trim',options:toRaw(trimOptions)}).then(()=>showTrim=false)">{{ t('Apply') }}</button><button @click="showTrim=false">{{ t('Cancel') }}</button></div>
    <div v-if="showContent&&tool!=='text'&&tool!=='shape'" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Editable {kind}',{kind:t(showContent)}) }}</strong><button @click="showContent=undefined"><X :size="16" /></button></div><ContentTools ref="contentTools" :key="contentResetKey" :layer="contentOnCanvas?state?.manifest.layers.find(layer=>layer.id===canvasContentEditingLayer):selected" :mode="showContent" :disabled="busy" :draft="canvasContentDraft" :fonts="fontList" :selection-range="canvasTextSelection" :on-canvas="contentOnCanvas" @draft="contentDraftChanged" @apply-canvas="contentCanvas?.commit()" @create="contentRaster" @update="contentRaster" @error="error={message:$event}" /></div>
    <div v-if="selectionModify" class="feature-panel selection-modify-panel"><strong>{{t('{operation} selection',{operation:t(selectionModify)})}}</strong><label>{{ t(selectionModify==='smooth'?'Sample Radius':selectionModify==='border'?'Width':'Pixels') }}<input v-model.number="selectionAmount" type="number" :min="selectionModifyLimits.min" :max="selectionModifyLimits.max" :step="selectionModify==='smooth'||selectionModify==='border'?1:'any'"></label><button :disabled="!selectionModifyValid" @click="applySelectionModification">{{ t('Apply') }}</button><button @click="selectionModify=undefined">{{ t('Cancel') }}</button></div>
    <div v-if="showColorRange&&selected" class="feature-panel"><strong>{{ t('Color Range') }}</strong><label>{{ t('Canvas sampling') }}<select v-model="colorRangeSampling" :aria-label="t('Color Range canvas sampling')"><option value="replace">{{ t('Replace reference color') }}</option><option value="include">{{ t('Add reference color') }}</option><option value="exclude">{{ t('Exclude reference color') }}</option></select></label><p>{{ t('Click the canvas to sample. Shift adds a color; Alt excludes a color.') }}</p><img v-if="colorRangePreview" :src="colorRangePreview.url" :alt="t('Color Range selection preview')" style="max-width:100%;max-height:180px;object-fit:contain"><p v-if="colorRangePreviewBusy" role="status">{{ t('Updating selection preview…') }}</p><label>{{ t('Add color') }}<input type="color" :aria-label="t('Included color')" @change="colorRangeIncluded.push(($event.target as HTMLInputElement).value)"></label><span>{{t('{count} included colors',{count:colorRangeIncluded.length+1})}}</span><button @click="colorRangeIncluded=[]">{{ t('Clear additional colors') }}</button><label>{{ t('Color') }}<input v-model="foreground" type="color"></label><label>{{ t('Tolerance') }}<input v-model.number="wandTolerance" type="number" min="0" max="255"></label><label><input v-model="colorRangeInvert" type="checkbox">{{ t('Invert') }}</label><label>{{ t('Exclude') }}<input type="color" :aria-label="t('Excluded color')" @change="colorRangeExcluded.push(($event.target as HTMLInputElement).value)"></label><span>{{t('{count} excluded colors',{count:colorRangeExcluded.length})}}</span><button @click="colorRangeExcluded=[]">{{ t('Clear excluded colors') }}</button><label>{{ t('Softness') }}<input v-model.number="colorSoftness" type="number" min="0" max="1" step=".1"></label><button :disabled="colorRangePreviewBusy" @click="edit(colorRangeAction());showColorRange=false">{{ t('Select') }}</button><button @click="showColorRange=false">{{ t('Cancel') }}</button></div>
    <div v-if="showEffects&&selected" class="feature-panel"><div class="drawer-heading"><strong>{{ t('Layer Effects') }}</strong><button @click="showEffects=false;effectsPreview=undefined"><X :size="16" /></button></div><EffectsPanel ref="effectsPanel" :initial-kind="effectTarget?.layerId===effectsLayer?effectTarget?.kind:undefined" :effects="selected.effects" :layer-id="selected.id" @preview="effectsPreview=$event" @commit="commitEffects" @cancel="showEffects=false;effectsPreview=undefined" @error="error={message:$event}" /></div>
    <ColorPickerPanel v-if="paletteTarget" :value="paletteTarget==='foreground'?foreground:background" :sample="paletteSample" @apply="commitPalette" @close="paletteTarget=undefined"/>
    <div v-if="floatingSelection" class="feature-panel" data-testid="selection-transform-panel"><div class="drawer-heading"><strong>{{ t('Transform Selected Pixels') }}</strong><button @click="endSelectionTransform()"><X :size="16"/></button></div><p>{{ t('Drag selected pixels or corner handles. Cmd/Ctrl-drag a corner for Free Distort; Shift constrains its axis. Apply commits one undo step; Escape cancels.') }}</p><button @click="distortFloatingSelection" :disabled="!!floatingSelection.corners">{{ t('Free Distort Selected Pixels') }}</button><template v-if="floatingSelection.corners"><label v-for="(point,i) in floatingSelection.corners" :key="i">{{t('Corner {index}',{index:i+1})}}<input v-model.number="point[0]" type="number" :aria-label="t('Selected pixels corner {index} X',{index:i+1})"/><input v-model.number="point[1]" type="number" :aria-label="t('Selected pixels corner {index} Y',{index:i+1})"/></label><p role="status">{{floatingSelection.previewError?tm(floatingSelection.previewError):(floatingSelection.previewBusy?t('Rendering selection preview…'):t('Preview does not change your document.'))}}</p></template><template v-else><label v-for="(axis,i) in ['X','Y']">{{t(axis)}}<input v-model.number="floatingSelection.transform.origin[i]" type="number" :aria-label="t('Selected pixels {axis}',{axis:t(axis)})"/></label><label v-for="(axis,i) in ['Width','Height']">{{t(axis)}}<input v-model.number="floatingSelection.transform.size[i]" type="number" min="1" :aria-label="t('Selected pixels {axis}',{axis:t(axis)})"/></label><label>{{ t('Rotation') }}<input v-model.number="floatingSelection.transform.rotation" type="number" :aria-label="t('Selected pixels rotation')"/></label></template><label><input v-model="floatingSelection.transform.flipX" type="checkbox"/>{{ t('Flip H') }}</label><label><input v-model="floatingSelection.transform.flipY" type="checkbox"/>{{ t('Flip V') }}</label><button @click="endSelectionTransform(true)">{{ t('Apply') }}</button><button @click="endSelectionTransform()">{{ t('Cancel') }}</button></div>
    <div v-if="showDistort&&distortCorners&&selected" class="feature-panel" data-testid="distort-panel"><div class="drawer-heading"><strong>{{ t('Free Distort') }}</strong><button @click="cancelDistort"><X :size="16" /></button></div><p>{{ t('Drag the four corners on canvas. Hold Shift to constrain to one axis. Enter applies; Escape cancels.') }}</p><label v-for="(point,i) in distortCorners" :key="i">{{t('Corner {index}',{index:i+1})}} <input v-model.number="point[0]" type="number" :aria-label="t('Corner {index} X',{index:i+1})"><input v-model.number="point[1]" type="number" :aria-label="t('Corner {index} Y',{index:i+1})"></label><p role="status">{{distortBusy?t('Rendering preview…'):t('Preview does not change your document.')}}</p><button @click="applyDistort">{{ t('Apply') }}</button><button @click="cancelDistort">{{ t('Cancel') }}</button></div>
    <div v-if="showFilters" class="modal-backdrop"><FiltersPanel :committing="filterCommitting" :progressive-line="progressiveLine" :kind="filterKind" :initial="filterInitial" :original-u-r-l="filterSource" :preview="filterPreview" :last-filter="lastFilter" @preview="previewFilter" @apply="applyFilter" @cancel="showFilters=false" @repeat="applyFilter" /></div>
    <div v-if="showExport&&state" class="modal-backdrop"><ExportAsPanel :source-bit-depth="state.assets.some(asset=>asset.bitDepth===16)?16:8" :sourceHasHDR="state.assets.some(asset=>asset.isHDR)" :width="state.manifest.width" :height="state.manifest.height" :resolution="state.manifest.resolution" :preview="exportPreview" @preview="previewExport" @export="exportAs" @cancel="showExport=false" /></div>
    <div v-if="showCanvasSize&&sizeMode==='image'" class="modal-backdrop"><ImageSizeDialog ref="imageSizeDialog" :width="sizeWidth" :height="sizeHeight" :resolution="resolution" :shortcut-overrides="shortcutOverrides" :shortcut-platform="platform==='darwin'?'mac':'other'" @apply="applyImageSize" @cancel="showCanvasSize=false" /></div>
    <div v-if="showCanvasSize&&sizeMode==='canvas'" class="modal-backdrop"><form class="size-dialog" @submit.prevent="applySize"><h2>{{ t('Canvas Size') }}</h2><label>{{ t('Width') }}<input v-model.number="sizeWidth" type="number" min="1" :max="LIMITS.maxSide" required></label><label>{{ t('Height') }}<input v-model.number="sizeHeight" type="number" min="1" :max="LIMITS.maxSide" required></label><label>{{ t('Anchor') }}<select v-model="sizeAnchor"><option v-for="anchor in ['center','top-left','top','top-right','left','right','bottom-left','bottom','bottom-right']" :value="anchor">{{t(anchor)}}</option></select></label><button type="submit">{{ t('Apply') }}</button><button type="button" @click="showCanvasSize=false">{{ t('Cancel') }}</button></form></div>
    <EdgeRefinementPanel ref="edgeRefinementPanel" v-if="edgeRefinement" :request="edgeRefinement.request" :layer-id="edgeRefinement.layerId" @cancel="edgeRefinement=undefined" @applied="edgeRefinement=undefined" @applying="edgeApplying=$event"/>
    <FillDialog v-if="showFill" :foreground="foreground" :background="background" :disabled="busy" @apply="fillWith" @cancel="showFill=false" />
    <RasterizeDialog v-if="rasterizePending" :name="rasterizePending.name" :disabled="rasterizeBusy" @confirm="confirmRasterize" @cancel="rasterizePending=undefined" />
    <CommandPalette :open="showPalette" :commands="commands" :overrides="shortcutOverrides" :platform="platform==='darwin'?'mac':'other'" @execute="action" @close="showPalette=false" />
    <ShortcutSettings :default-commands="rawCommands" :open="showShortcuts" :commands="commands" :overrides="shortcutOverrides" :profile="interactionProfile" :platform="platform==='darwin'?'mac':'other'" @profile="changeInteractionProfile" @save="saveShortcutSettings" @close="showShortcuts=false" />
    <footer class="status-bar"><template v-if="!showNew && state"><span data-testid="zoom-status">{{ (zoom * 100).toFixed(1) }}%</span><span>{{ state.manifest.width.toLocaleString(locale) }} × {{ state.manifest.height.toLocaleString(locale) }} px</span><span>{{ t('sRGB · Transparent') }}</span><span v-if="selected?.imageFile&&state.assets.find(asset=>asset.file===selected?.imageFile)?.bitDepth===16" data-testid="deep-status" :title="t('Original 16-bit data is preserved.')">{{ t('16-bit layer · 8-bit display') }}</span></template><span v-else>{{ t('Ready when you are') }}</span><span v-if="selectedIds.length > 1">{{t('{count} layers selected',{count:selectedIds.length})}}</span><span class="status-hint">{{ t(toolHint) }}</span></footer>
    <div v-if="(displayWarning||state?.warnings.length||foreign.warnings?.length||contentWarnings.length) && !showNew" class="warning-bar" :title="displayWarning?tm(displayWarning):undefined">{{ displayWarning?t('The canvas is using an 8-bit compatibility preview. High-depth source pixels are preserved.'):tm(contentWarnings[0] ?? state?.warnings[0] ?? foreign.warnings?.[0] ?? '') }}</div>
    <div v-if="activeExternal" class="external-warning" role="status" data-testid="external-change"><strong>{{activeExternal.readable?t('Project changed outside Compositor'):t('External project cannot be read')}}</strong><span>{{activeExternal.readable?(state?.modified?t('Local edits are preserved. Reload replaces them with the external version.'):t('Reload is waiting until the current operation finishes.')):tm(activeExternal.error??'')}}</span><button :disabled="busy||!activeExternal.readable" @click="externalDecision('reload')">{{ t('Reload') }}</button><button :disabled="busy" @click="externalDecision('keep')">{{ t('Keep current') }}</button><button :disabled="busy" @click="externalDecision('copy')">{{ t('Save a Copy…') }}</button></div>
    <div v-if="state?.recoveryError" class="recovery-warning" role="status">{{ t('Automatic recovery copy failed: {error}. Save the project to keep your changes.',{error:tm(state.recoveryError)}) }}</div>
    <div v-if="showRecovery" class="recovery-panel"><div class="drawer-heading"><strong>{{ t('Recover documents') }}</strong><button @click="showRecovery = false" :aria-label="t('Close recovery')"><X :size="17" /></button></div><p>{{ t('Restore an unsaved copy into a new tab. The original project is preserved.') }}</p><div v-for="entry in recoverable" :key="entry.id" class="recovery-entry"><strong>{{ entry.title }}</strong><small>{{ new Date(entry.savedAt).toLocaleString(locale) }}</small><div><button class="pill" @click="restoreDocument(entry.id)">{{ t('Restore') }}</button><button @click="discardRecovery(entry.id)">{{ t('Discard copy') }}</button></div></div><p v-if="!recoverable.length">{{ t('No unsaved copies to restore.') }}</p><div v-for="item in recoveryInfo.saveRecovery.filter(item => item.status === 'attention')" :key="item.id" class="recovery-entry"><strong>{{ t('Save needs attention') }}</strong><p>{{ item.destination }}</p><small>{{ tm(item.message??'') }}</small></div></div>
    <div v-if="error" class="error-toast" role="alert"><div><strong>{{ t('Could not complete operation') }}</strong><p>{{ tm(error.message) }}</p><pre v-if="error.details">{{ JSON.stringify(error.details, null, 2) }}</pre></div><button @click="error = undefined" :aria-label="t('Dismiss error')"><X :size="17" /></button></div>
    <div v-if="showAutomation" class="automation-drawer"><div class="drawer-heading"><strong>{{ t('Agent / MCP') }}</strong><button @click="showAutomation = false" :aria-label="t('Close automation')"><X :size="17" /></button></div><p>{{ t('Connect an MCP client to inspect the canvas, edit layers, preview the result, and undo a change.') }}</p><div class="bridge-status"><i></i>{{ t('Local bridge ready') }}<span>{{t('{count} tools',{count:MCP_TOOLS.length})}}</span></div><button class="copy-config pill" @click="copyConfig"><Check v-if="copied" :size="15" /><Copy v-else :size="15" />{{ copied ? t('Copied configuration') : t('Copy MCP configuration') }}</button><details open><summary>{{ t('Connection configuration') }}</summary><pre>{{ mcpConfig }}</pre></details><div class="session-info">{{ t('Document revision') }}<span>{{ state?.revision }}</span></div><h3>{{ t('AVAILABLE TOOLS') }}</h3><code v-for="name in MCP_TOOLS" :key="name">{{ name }}</code><h3>{{ t('ACTIVITY') }}</h3><div v-for="item in state?.activity.slice(0,8)" :key="item.id" class="activity-item"><Sparkles v-if="item.source === 'agent'" :size="13" /><span>{{ tm(item.label) }}<small>{{ t('{source} · revision {revision}',{source:t(item.source),revision:item.revision}) }}</small></span></div><button class="pill demo-button" @click="task('demo'); showAutomation = false">{{ t('Open demo project') }}</button></div>
    <div v-if="contextLayer" class="context-menu" :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }" @click.stop>
      <button @click="renamingId = contextLayer.id; contextLayer = undefined">{{ t('Rename') }}</button><button @click="edit({ type:'layer.duplicate', layerId: contextLayer.id }); contextLayer = undefined"><Copy :size="14" />{{ contextLayer.isGroup ? t('Duplicate folder') : t('Duplicate layer') }}</button><button v-if="contextLayer.isGroup" @click="edit({ type:'group.ungroup', layerId: contextLayer.id }); contextLayer = undefined">{{ t('Ungroup layers') }}</button><button @click="edit({ type:'layer.reorder', layerId: contextLayer.id, direction:'up' }); contextLayer = undefined"><ArrowUp :size="14" />{{ t('Move up') }}</button><button @click="edit({ type:'layer.reorder', layerId: contextLayer.id, direction:'down' }); contextLayer = undefined"><ArrowDown :size="14" />{{ t('Move down') }}</button><label>{{ t('Move to') }}<select :aria-label="t('Parent group')" :value="contextLayer.parentID ?? ''" @change="edit({ type:'layer.set_parent', layerId: contextLayer.id, parentId: ($event.target as HTMLSelectElement).value || null }); contextLayer = undefined"><option value="">{{ t('Document root') }}</option><option v-for="group in state?.manifest.layers.filter(item => item.isGroup && item.id !== contextLayer?.id)" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><template v-if="depthConvertible(contextLayer)"><button v-if="layerDepth(contextLayer)===16" @click="convertDepth(contextLayer,8)">{{ t('Convert to 8-bit') }}</button><button v-if="layerDepth(contextLayer)===8||layerHDR(contextLayer)" @click="convertDepth(contextLayer,16)">{{ t('Convert to 16-bit') }}</button></template><button @click="edit({ type:'layer.delete', layerId: contextLayer.id }); contextLayer = undefined"><Trash2 :size="14" />{{ t('Delete layer') }}</button>
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
.panels-hidden .transform-toolbar,.panels-hidden .tool-rail,.panels-hidden .inspector,.side-panels-hidden .inspector { display:none; }
.zoom-entry { position:absolute;right:60px;top:42px;z-index:8;display:flex;align-items:center;gap:8px;background:#292929;padding:10px;border:1px solid #555;border-radius:7px;box-shadow:0 6px 24px #0008; }
.zoom-entry input { width:75px; }
.distort-outline { position:absolute;left:0;top:0;z-index:3;pointer-events:none;overflow:visible; }
.distort-corner { position:absolute;z-index:4;width:12px;height:12px;padding:0;border:1px solid #0a84ff;background:white;transform:translate(-50%,-50%);cursor:crosshair;touch-action:none; }
.layer-depth-badge{display:inline-block;align-self:flex-start;width:max-content;padding:1px 5px;margin-top:3px;background:#555;border-radius:4px;color:#ddd;font-size:10px;font-weight:600;white-space:nowrap}.layer-footer-menu{position:absolute;right:10px;bottom:46px;z-index:20;display:grid;max-height:calc(100vh - 120px);overflow:auto;min-width:190px;padding:6px;background:#303030;border:1px solid #555;border-radius:7px;box-shadow:0 8px 24px #0008}.layer-footer-menu button{text-align:left;white-space:nowrap;padding:7px 10px;border-radius:4px;color:#ddd}.layer-footer-menu button:hover{background:#087dff;color:#fff}
.inspector{position:relative}.project-tabs{flex:1;min-height:32px}.project-tabs,.new-button{-webkit-app-region:no-drag}.new-drop-target{box-shadow:inset 0 0 0 2px #168aff;background:#168aff22!important}
</style>
