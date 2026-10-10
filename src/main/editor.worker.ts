import {prepareSubjectMask} from '../core/subject-mask'
import {CameraRawPreviewBrightnessCache} from '../core/camera-raw-preview-cache'
import {createHash} from 'node:crypto'
import {bakeExternalClipping} from '../core/live-mask-bake'
import {coverageShape} from '../core/pixel-actions'
import {decodeTIFF} from '../core/tiff-import'
import {encodePNG} from '../core/export-codecs'
import {prepareRetouch} from '../core/retouch-edit'
import {applyPixelAction,applySelectionRaster} from '../core/pixel-actions'
import {liftSelectedPixels} from '../core/selection-transform'
import {filterRaster} from '../core/filter-edit'
import {distortRaster} from '../core/distort-raster'

import {applyImageFilter,imageFilterSchema} from '../shared/image-filters'
import {PNG} from 'pngjs'
import {blankPNG,documentPoint,selectionCoverage,sourcePoint} from '../core/raster-edit'
import { DocumentManager } from '../core/document-manager'
import { RecoveryStore } from '../core/recovery-store'
import { recoverSaveJournals } from '../core/save-journal'
import { captureLayerClipboard, mergeSelectionPlan, type LayerClipboard } from '../core/layer-operations'
import { makeAsset, type Asset } from '../core/project-io'
import { failure } from '../shared/contracts'

const options: { journalDirectory?: string } = {}
const manager = new DocumentManager(options)
const cameraRawPreviewBrightness=new CameraRawPreviewBrightnessCache()
let recovery: RecoveryStore | undefined
let recoveryTimer: ReturnType<typeof setTimeout> | undefined
let recoveryError: string | undefined
let saveRecovery: Awaited<ReturnType<typeof recoverSaveJournals>> = []
const port = (process as NodeJS.Process & { parentPort: { on: (event: string, callback: (event: { data: any }) => void) => void; postMessage: (value: unknown) => void } }).parentPort
let queue = Promise.resolve()
const saveQueues = new Map<string,Promise<unknown>>()
const saving = new Set<string>()
function backgroundSave(id:string,method:string,params:any):void {
 const doc=manager.get(params.sessionId),key=doc.state().sessionId
 const previous=saveQueues.get(key)??Promise.resolve()
 saving.add(key)
 const pending=previous.catch(()=>{}).then(()=>method==='save'?doc.save(params.preview?{revision:params.preview.revision,bytes:Buffer.from(params.preview.bytes)}:undefined):method==='saveCopy'?doc.saveCopy(params.path,params.preview?{revision:params.preview.revision,bytes:Buffer.from(params.preview.bytes)}:undefined):doc.saveAs(params.path,params.preview?{revision:params.preview.revision,bytes:Buffer.from(params.preview.bytes)}:undefined))
 saveQueues.set(key,pending)
 void pending.then(value=>{scheduleRecovery();port.postMessage({id,result:{ok:true,value},state:{...manager.state(),recoveryError}})},error=>port.postMessage({id,result:failure(error)})).finally(()=>{if(saveQueues.get(key)===pending){saveQueues.delete(key);saving.delete(key)}})
}
let clipboard: {metadata: LayerClipboard;assets: Map<string,Asset>;external:{metadata:LayerClipboard;assets:Map<string,Asset>}} | undefined
async function checkpoint(): Promise<void> {
  if (!recovery) return
  try {
    for (const doc of manager.workspace().documents) await recovery.checkpoint(manager.get(doc.sessionId))
    recoveryError = undefined
  } catch (error) { recoveryError = error instanceof Error ? error.message : String(error) }
}
function scheduleRecovery(): void {
  clearTimeout(recoveryTimer)
  recoveryTimer = setTimeout(() => {
    queue = queue.then(async () => { await checkpoint(); port.postMessage({ state: { ...manager.state(), recoveryError } }) }).catch(console.error)
  }, 5000)
}

port.on('message', ({ data }) => {
  queue = queue.then(async () => {
    const { id, method, params } = data
    try {
      if(['save','saveCopy','saveAs'].includes(method)){backgroundSave(id,method,params);return}
      if(['close','reload'].includes(method)&&saving.has(params.sessionId))throw new Error('Wait for the document save to finish before closing it.')
      let value: unknown
      switch (method) {
        case 'configure': {
          options.journalDirectory = params.journalDirectory
          recovery = new RecoveryStore(params.recoveryDirectory)
          await recovery.initialize()
          saveRecovery = await recoverSaveJournals(params.journalDirectory)
          value = { saveRecovery }; break
        }
        case 'recoveryList': value = { entries: await recovery?.list() ?? [], saveRecovery }; break
        case 'checkpoint': await checkpoint(); value = { entries: await recovery?.list() ?? [], recoveryError }; break
        case 'recover': {
          if (!recovery) throw new Error('Recovery store is not configured.')
          const item = await recovery.get(params.id)
          value = await manager.restore(item.path, item.entry.title)
          try { await recovery.checkpoint(manager.get()); await recovery.discard(params.id) }
          catch (error) { recoveryError = error instanceof Error ? error.message : String(error) }
          break
        }
        case 'clearOpenRecovery': for (const doc of manager.workspace().documents) await recovery?.discardSession(doc.sessionId); value = null; break
        case 'discardRecovery': await recovery?.discard(params.id); value = null; break
        case 'save': value = await manager.get(params.sessionId).save(); break
        case 'saveCopy': value = await manager.get(params.sessionId).saveCopy(params.path); break

        case 'externalStatus': {if(saving.has(params.sessionId))throw new Error('Wait for this project save to finish before checking its external version.');value=await manager.get(params.sessionId).externalStatus();break}
        case 'reload': value=await manager.reload(params.sessionId,params.expectedRevision,params.fingerprint);break
        case 'state': value = manager.state(params?.sessionId); break
        case 'documents': value = manager.workspace(); break
        case 'new': value = manager.newDocument(); break
        case 'switch': value = manager.switch(params.sessionId); break
        case 'close': await recovery?.discardSession(params.sessionId); value = manager.close(params.sessionId); break
        case 'create': value = manager.create(params.width, params.height, params.sessionId); break
        case 'openPhotoshop':value=await manager.openPhotoshop(params.path);break
        case 'photoshopSnapshot': {const doc=manager.get(params.sessionId);if(doc.state().revision!==params.expectedRevision)throw new Error('The Photoshop export snapshot changed. Retry.');const snapshot=doc.snapshot();value={manifest:snapshot.manifest,assets:[...snapshot.assets]};break}
        case 'importPhotoshopSnapshot':value=manager.importPhotoshopSnapshot(params.snapshot,params.title);break

        case 'open': value = await manager.open(params.path); break
        case 'saveAs': value = await manager.get(params.sessionId).saveAs(params.path); break
        case 'prepareImageOperation':{const doc=manager.get(params.request.sessionId),cached=doc.inspectPrepared(params.request,params.source);if(cached){value={cached};break}const state=doc.state(),layer=state.manifest.layers.find(layer=>layer.id===params.request.action.layerId);if(!layer||!params.composite&&!layer.imageFile)throw new Error('Choose a raster layer for this operation.');const png=params.composite??PNG.sync.read(doc.snapshot().assets.get(layer.imageFile!)!.bytes),coverage=new Uint8Array(params.request.action.type==='layer.content_fill'?png.width*png.height:0);if(params.request.action.type==='layer.content_fill'){if(!state.selection)throw new Error('Make a selection before content fill.');for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const p=documentPoint(layer,x+.5,y+.5,png.width,png.height);coverage[y*png.width+x]=Math.round(selectionCoverage(state.selection,...p)*255)}}const box=params.request.action.box;let sourceBox:[number,number,number,number]|undefined;if(box&&!params.composite){const points=[[box[0],box[1]],[box[0]+box[2],box[1]],[box[0]+box[2],box[1]+box[3]],[box[0],box[1]+box[3]]].map(p=>sourcePoint(layer,p[0],p[1],png.width,png.height)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);sourceBox=[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)]}const point=params.request.action.point;const preparedPoint=point?(params.composite?point:sourcePoint(layer,point[0],point[1],png.width,png.height)):undefined;value={point:preparedPoint,box:params.composite?box:sourceBox,image:{width:png.width,height:png.height,data:Uint8Array.from(png.data)},selection:{width:png.width,height:png.height,coverage}};break}
        case 'prepareRetouchResult':{const doc=manager.get(params.request.sessionId);doc.inspectPrepared(params.request,params.source);value=prepareRetouch({...doc.snapshot(),selection:doc.state().selection??null},params.request.action,params.composite);break}
        case 'commitRetouch':value=manager.get(params.request.sessionId).commitRetouch(params.request,params.result,params.source);break
        case 'commitTrim':value=manager.get(params.request.sessionId).commitTrim(params.request,params.bounds,params.source);break
        case 'preparedContent':{const action=params.request.action;value=manager.get(params.request.sessionId).contentRaster(params.request,Buffer.from(params.bytes),{name:action.name,layerId:action.layerId,text:action.type==='layer.text'?action.style:undefined,shape:action.type==='layer.shape'?action.style:undefined},params.source,true);break}
        case 'prepareContentTransforms':value=manager.get(params.request.sessionId).prepareContentTransforms(params.request,params.batch,params.source);break
        case 'commitPreparedTransforms':value=manager.get(params.request.sessionId).commitPreparedTransforms(params.request,params.prepared,params.batch,params.source);break
        case 'inspectPrepared':value=manager.get(params.request.sessionId).inspectPrepared(params.request,params.source)??null;break
        case 'commitSelectionRaster':value=manager.get(params.request.sessionId).applySelectionRaster(params.request,params.image,params.source);break;
        case 'commitImageOperation':value=manager.get(params.request.sessionId).commitPrepared(params.request,{coverage:params.result.coverage,space:params.result.space,bytes:params.result.bytes?Buffer.from(params.result.bytes):undefined},params.source);break
        case 'apply': value = manager.get(params.request.sessionId).apply(params.request, params.source); break
        case 'applyBatch': value = manager.get(params.request.sessionId).applyBatch(params.request, params.source); break
        case 'taskBegin': value = manager.get(params.sessionId).beginTask(params); break
        case 'taskStatus': value = manager.get(params.sessionId).tasks.get(params.taskId); break
        case 'taskCancel': value = manager.get(params.sessionId).cancelTask(params); break
        case 'taskFinish': value = manager.get(params.sessionId).finishTask(params); break
        case 'undoTask': value = manager.get(params.sessionId).undoTask(params); break
        case 'history': value = manager.get(params.request.sessionId).history(params.request, params.source); break
        case 'import': value = manager.importPNG(params.sessionId, Buffer.from(params.bytes), params.name); break
        case 'importTIFF': {const decoded=decodeTIFF(Buffer.from(params.bytes));value=manager.importPNG(params.sessionId,encodePNG(decoded),params.name,[`TIFF color: ${decoded.colorProfile}`,...decoded.warnings]);break}
        case 'subjectRasterPreview':{const doc=manager.get(params.request.sessionId);doc.inspectPrepared(params.request);const state=doc.state(),assets=doc.snapshot().assets,layer=state.manifest.layers.find(layer=>layer.id===params.request.action.layerId)!;if(!params.request.action.removeBackground||!layer.imageFile)throw new Error('Background preview requires a raster layer.');const source=assets.get(layer.imageFile)!,oldMask=layer.maskFile?assets.get(layer.maskFile):undefined,result=prepareSubjectMask(layer,source,params.result.coverage,state.selection??null,params.result.space,oldMask),url=`data:image/png;base64,${result.bytes.toString('base64')}`;state.manifest={...state.manifest,layers:state.manifest.layers.map(item=>item.id===layer.id?{...result.layer,maskFile:url}:item)};state.assets=[...state.assets,{file:url,hash:`subject-${params.request.idempotencyKey}-${params.requestId}`,width:result.width,height:result.height}];value={state};break}

        case 'selectionRasterPreview':{const doc=manager.get(params.request.sessionId);doc.inspectPrepared(params.request);const stage={...doc.snapshot(),selection:doc.state().selection??null};applySelectionRaster(stage,params.request.action,params.image);const maxSide=512,scale=Math.min(1,maxSide/Math.max(stage.manifest.width,stage.manifest.height)),width=Math.max(1,Math.round(stage.manifest.width*scale)),height=Math.max(1,Math.round(stage.manifest.height*scale)),png=new PNG({width,height});for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=Math.round(selectionCoverage(stage.selection,(x+.5)/scale,(y+.5)/scale)*255);png.data.set([value,value,value,255],(y*width+x)*4)}value={requestId:params.requestId,url:`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,selection:stage.selection};break}
        case 'strokePreview':{const doc=manager.get(params.request.sessionId);doc.inspectPrepared(params.request);const snapshot=doc.snapshot(),stage={...snapshot,selection:doc.state().selection??null},layer=stage.manifest.layers.find(layer=>layer.id===params.request.action.layerId)!;if(params.composite){const prepared=prepareRetouch(stage,params.request.action,params.composite);const file=layer.imageFile!;stage.assets.set(file,makeAsset(file,prepared.png));layer.transform=prepared.transform;delete layer.text;delete layer.shape;if(prepared.maskPNG&&layer.maskFile)stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,prepared.maskPNG))}else applyPixelAction(stage,params.request.action);const mask=params.request.action.target==='mask',asset=stage.assets.get((mask?layer.maskFile:layer.imageFile)!)!,maskAsset=!mask&&layer.maskFile?stage.assets.get(layer.maskFile):undefined;value={url:`data:image/png;base64,${asset.bytes.toString('base64')}`,width:asset.width,height:asset.height,requestId:params.requestId,transform:layer.transform,maskPlacement:layer.maskPlacement,maskUrl:maskAsset?`data:image/png;base64,${maskAsset.bytes.toString('base64')}`:undefined,maskWidth:maskAsset?.width,maskHeight:maskAsset?.height};break}
        case 'gradientPreview':{const doc=manager.get(params.request.sessionId);doc.inspectPrepared(params.request);const snapshot=doc.snapshot(),stage={...snapshot,selection:doc.state().selection??null},layer=stage.manifest.layers.find(layer=>layer.id===params.request.action.layerId)!;applyPixelAction(stage,params.request.action);const mask=params.request.action.target==='mask',file=mask?layer.maskFile:layer.imageFile,asset=stage.assets.get(file!)!,maskAsset=!mask&&layer.maskFile?stage.assets.get(layer.maskFile):undefined;value={url:`data:image/png;base64,${asset.bytes.toString('base64')}`,width:asset.width,height:asset.height,requestId:params.requestId,transform:layer.transform,maskPlacement:layer.maskPlacement,maskUrl:maskAsset?`data:image/png;base64,${maskAsset.bytes.toString('base64')}`:undefined,maskWidth:maskAsset?.width,maskHeight:maskAsset?.height};break}
        case 'selectionTransformDraft':{const doc=manager.get(params.request.sessionId);doc.inspectPrepared(params.request);const stage=doc.snapshot(),layer=stage.manifest.layers.find(layer=>layer.id===params.request.action.layerId)!;const result=liftSelectedPixels({...stage,selection:doc.state().selection??null},layer);let pixels=result.pixels,coverage=result.coverage,previewTransform=params.request.action.transform;if(params.request.action.corners){const warped=distortRaster(pixels,params.request.action.corners,{flipX:previewTransform.flipX,flipY:previewTransform.flipY,sampling:previewTransform.sampling});pixels=warped.png;coverage=distortRaster(coverage,params.request.action.corners,{flipX:previewTransform.flipX,flipY:previewTransform.flipY,sampling:previewTransform.sampling,mask:true}).png;previewTransform=warped.transform}const values=new Uint8Array(coverage.width*coverage.height);for(let i=0;i<values.length;i++)values[i]=coverage.data[i*4];value={pixelsURL:`data:image/png;base64,${PNG.sync.write(pixels).toString('base64')}`,clearedURL:`data:image/png;base64,${PNG.sync.write(result.cleared).toString('base64')}`,transform:result.transform,previewTransform:params.request.action.corners?previewTransform:undefined,selection:{inverted:false,shapes:[coverageShape({width:coverage.width,height:coverage.height,coverage:values},params.request.action.corners?previewTransform:result.transform)]},width:pixels.width,height:pixels.height,sourceWidth:result.cleared.width,sourceHeight:result.cleared.height};break}
        case 'distortPreview':{const doc=manager.get(params.sessionId);doc.inspectPrepared({sessionId:params.sessionId,documentId:params.documentId,expectedRevision:params.expectedRevision,idempotencyKey:params.idempotencyKey,action:{type:'layer.distort',layerId:params.layerId,corners:params.corners,trim:params.trim,target:params.target}});const stage={...doc.snapshot(),selection:doc.state().selection??null};applyPixelAction(stage,{type:'layer.distort',layerId:params.layerId,corners:params.corners,trim:params.trim,target:params.target});const layer=stage.manifest.layers.find(layer=>layer.id===params.layerId)!,asset=stage.assets.get((params.target==='mask'?layer.maskFile:layer.imageFile)!)!,maskAsset=params.target!=='mask'&&layer.maskFile?stage.assets.get(layer.maskFile):undefined;value={requestId:params.requestId,url:`data:image/png;base64,${asset.bytes.toString('base64')}`,maskUrl:maskAsset?`data:image/png;base64,${maskAsset.bytes.toString('base64')}`:undefined,maskPlacement:layer.maskPlacement,maskWidth:maskAsset?.width,maskHeight:maskAsset?.height,transform:params.target==='mask'?layer.maskPlacement??layer.transform:layer.transform,width:asset.width,height:asset.height};break}
        case 'filterPreview':{
          const doc=manager.get(params.sessionId),state=doc.state();if(state.revision!==params.expectedRevision)throw new Error('The filter source has changed. Reopen the filter.')
          const layer=state.manifest.layers.find(layer=>layer.id===params.layerId);if(!layer?.imageFile)throw new Error('Choose a raster layer to preview this filter.')
          const asset=doc.snapshot().assets.get(layer.imageFile)!,png=PNG.sync.read(asset.bytes),filter=imageFilterSchema.parse(params.filter),knownBrightness=filter.kind==='cameraRaw'&&(filter.contrast||filter.highlights||filter.shadows)?cameraRawPreviewBrightness.get({sessionId:state.sessionId,layerId:layer.id,hash:asset.hash,width:png.width,height:png.height,sourceVersion:createHash('sha256').update(JSON.stringify([layer.transform,state.selection??null])).digest('hex')},{width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)}):undefined,result=filterRaster(png,layer.transform,state.selection??null,filter,{knownBrightness})
          value={url:`data:image/png;base64,${PNG.sync.write(result.png).toString('base64')}`,transform:result.transform,width:result.png.width,height:result.png.height};break
        }
        case 'copyLayers': {
          const doc=manager.get(params.sessionId),state=doc.state()
          if(params.expectedRevision!==state.revision)throw new Error('The document changed before copying.')
          const metadata=captureLayerClipboard(state.manifest,params.layerIds,state.sessionId),snapshot=doc.snapshot()
          clipboard={metadata,assets:new Map(metadata.files.map(file=>[file,snapshot.assets.get(file)!])),external:bakeExternalClipping(snapshot.manifest,snapshot.assets,metadata)}
          if(params.cut)doc.applyBatch({sessionId:params.sessionId,documentId:params.documentId,expectedRevision:params.expectedRevision,idempotencyKey:params.idempotencyKey,actions:metadata.roots.map(layerId=>({type:'layer.delete',layerId})),label:'Cut layers'})
          value={copied:true};break
        }
        case 'transferLayers':value=manager.transferLayers(params);break
        case 'pasteLayers': if(!clipboard)throw new Error('The layer clipboard is empty.');else {const doc=manager.get(params.sessionId),payload=clipboard.metadata.sourceSessionId===params.sessionId?clipboard:clipboard.external;value=doc.paste(params,payload.metadata,payload.assets)};break
        case 'duplicateMove': {const doc=manager.get(params.request.sessionId),metadata=captureLayerClipboard(doc.state().manifest,params.layerIds);value=doc.paste(params.request,metadata,doc.snapshot().assets,params.delta);break}
        case 'mergeLayers': {const doc=manager.get(params.request.sessionId),plan=mergeSelectionPlan(doc.state().manifest,params.layerIds,params.kind);value=doc.merge(params.request,Buffer.from(params.bytes),plan);break}
        case 'pastePixels':value=manager.get(params.request.sessionId).pastePixels(params.request,Buffer.from(params.bytes),params.origin);break
        case 'contentRaster': value=manager.get(params.request.sessionId).contentRaster(params.request,Buffer.from(params.bytes),params.metadata);break
        case 'asset': value = manager.get(params.sessionId).asset(params.sessionId, params.file, params.hash); break
        default: throw new Error(`Unknown editor method: ${method}`)
      }
      if (!['prepareContentTransforms','photoshopSnapshot','externalStatus','asset','prepareRetouchResult','subjectRasterPreview','selectionRasterPreview','strokePreview','gradientPreview','selectionTransformDraft','distortPreview','inspectPrepared', 'prepareImageOperation', 'state', 'documents', 'taskStatus', 'recoveryList', 'checkpoint', 'configure'].includes(method)) scheduleRecovery()
      port.postMessage({ id, result: { ok: true, value }, state: !['prepareContentTransforms','photoshopSnapshot','externalStatus','asset','prepareRetouchResult','subjectRasterPreview','selectionRasterPreview','strokePreview','gradientPreview','selectionTransformDraft','distortPreview','inspectPrepared', 'prepareImageOperation', 'state', 'documents', 'taskStatus', 'recoveryList', 'checkpoint', 'configure'].includes(method) ? { ...manager.state(), recoveryError } : undefined })
    } catch (error) { port.postMessage({ id, result: failure(error) }) }
  }).catch(error => { console.error('Editor worker failure:', error) })
})
port.postMessage({ ready: true })
