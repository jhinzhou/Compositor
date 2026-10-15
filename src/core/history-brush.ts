import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {EditorError,LIMITS,type Layer,type Manifest} from '../shared/contracts'
import type {Selection} from '../shared/pixel-contracts'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {prepareBrushStroke,type BrushDynamics} from '../shared/brush-dynamics'
import {restoreHistoryBrushPixels,type HistoryBrushPixels} from '../shared/history-brush'
import {documentPoint,selectionCoverage} from './raster-edit'
import {makeAsset,makeDeepAsset,makeHDRAsset,type Asset} from './project-io'
import {assertDeepAssetBudget,countAssetBackingBytes,DEEP_ASSET_WORKING_BUDGET} from './deep-assets'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'

export interface HistoryBrushSourceInfo {id:string;label:string;sessionId:string;revision:number;documentId:string;width:number;height:number}
export interface HistoryBrushSource extends HistoryBrushSourceInfo {manifest:Manifest;assets:ReadonlyMap<string,Asset>}
export interface HistoryBrushSourceMetadata {sessionId:string;revision:number;label:string;id?:string}
export interface HistoryBrushState {sourceId:string|null;snapshots:HistoryBrushSourceInfo[]}
export interface HistoryBrushStroke extends Omit<BrushDynamics,'tip'> {
 layerId:string;points:[number,number][];size:number;hardness:number;opacity:number
 kind:'history'|'art-history';artSize?:number;smoothing?:number;target?:'image'
}
type Snapshot={manifest:Manifest;assets:ReadonlyMap<string,Asset>}
type Stage={manifest:Manifest;assets:Map<string,Asset>;selection:Selection|null}
const sourceInfo=({id,label,sessionId,revision,documentId,width,height}:HistoryBrushSource):HistoryBrushSourceInfo=>({id,label,sessionId,revision,documentId,width,height})
/** Asset versions are immutable throughout Editor: retain their buffers, never
 * clone a display proxy or resolve the source through a later current asset map.
 * The manifest/map are independent snapshots and survive undo branch eviction. */
export function captureHistoryBrushSource(snapshot:Snapshot,metadata:HistoryBrushSourceMetadata):HistoryBrushSource {
 if(!metadata.sessionId||!Number.isSafeInteger(metadata.revision)||metadata.revision<0||!metadata.label.trim()||metadata.label.length>256)throw new EditorError('INVALID_ARGUMENT','History Brush requires a valid source snapshot identity.')
 const manifest=structuredClone(snapshot.manifest),assets=new Map<string,Asset>()
 for(const layer of manifest.layers)for(const file of [layer.imageFile,layer.maskFile])if(file){const asset=snapshot.assets.get(file);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The history source raster is unavailable.');assets.set(file,asset)}
 return {...metadata,id:metadata.id??randomUUID(),documentId:manifest.documentID,width:manifest.width,height:manifest.height,manifest,assets}
}
/** Owned by one Editor instance. Snapshot capture/selection is tool state, not
 * document Undo. Include retainedAssets in the Editor/global asset budgets. */
export class HistoryBrushSourceStore {
 private snapshots:HistoryBrushSource[]=[]
 private sourceId:string|null=null
 constructor(private maximumSnapshots=16){if(!Number.isSafeInteger(maximumSnapshots)||maximumSnapshots<1||maximumSnapshots>100)throw new EditorError('INVALID_ARGUMENT','Invalid history source retention limit.')}
 capture(snapshot:Snapshot,metadata:HistoryBrushSourceMetadata,checkRetention?:(assets:Asset[])=>void):HistoryBrushSourceInfo {
  const source=captureHistoryBrushSource(snapshot,metadata)
  const next=[...this.snapshots.filter(item=>item.id!==source.id&&item.sessionId===source.sessionId),source].slice(-this.maximumSnapshots)
  const assets=[...new Set(next.flatMap(item=>[...item.assets.values()]))]
  const unique=new Map(assets.map(asset=>[asset.hash,asset]))
  if([...unique.values()].reduce((sum,asset)=>sum+asset.width*asset.height,0)>LIMITS.maxPixels)throw new EditorError('RESOURCE_LIMIT','History source snapshots exceed the document pixel budget.')
  assertDeepAssetBudget(assets);checkRetention?.(assets)
  this.snapshots=next;this.sourceId=source.id;return sourceInfo(source)
 }
 select(id:string):HistoryBrushSourceInfo {const source=this.snapshots.find(item=>item.id===id);if(!source)throw new EditorError('ASSET_NOT_FOUND','The selected history source snapshot is unavailable.');this.sourceId=id;return sourceInfo(source)}
 selected(sessionId:string):HistoryBrushSource|undefined {const source=this.snapshots.find(item=>item.id===this.sourceId);if(source&&source.sessionId!==sessionId)throw new EditorError('SESSION_EXPIRED','The history source belongs to another document session.');return source}
 state():HistoryBrushState{return {sourceId:this.sourceId,snapshots:this.snapshots.map(sourceInfo)}}
 clear():void{this.snapshots=[];this.sourceId=null}
 retainedAssets():Asset[]{return [...new Set(this.snapshots.flatMap(source=>[...source.assets.values()]))]}
}
function samePlacement(a:Layer,b:Layer):boolean {
 const x=a.transform,y=b.transform
 return a.parentID===b.parentID&&x.rotation===y.rotation&&x.flipX===y.flipX&&x.flipY===y.flipY&&x.origin.every((value,i)=>value===y.origin[i])&&x.size.every((value,i)=>value===y.size[i])
}
/** Local raster restoration; complete matching-grid restoration is possible,
 * with current brush coverage/selection/opacity. Art uses source color patches
 * and has no claim of native Photoshop Style/Area/Tolerance equivalence. */
export function applyHistoryBrushOperation(stage:Stage,action:HistoryBrushStroke,source:HistoryBrushSource,sessionId?:string):string {
 if(sessionId&&source.sessionId!==sessionId)throw new EditorError('SESSION_EXPIRED','The history source belongs to another document session.')
 if(source.documentId!==stage.manifest.documentID)throw new EditorError('DOCUMENT_NOT_FOUND','History Brush requires a source from the same document.')
 if(source.manifest.colorSpace!==stage.manifest.colorSpace)throw new EditorError('UNSUPPORTED_FEATURE','History Brush cannot restore across changed document color spaces.')
 if(source.width!==stage.manifest.width||source.height!==stage.manifest.height)throw new EditorError('INVALID_ARGUMENT','History Brush cannot restore across changed canvas dimensions. Select a compatible source.')
 if(!['history','art-history'].includes(action.kind)||action.target!==undefined&&action.target!=='image')throw new EditorError('INVALID_ARGUMENT','History Brush supports image pixels only.')
 if(!action.points.length||action.points.length>100_000||action.points.some(point=>point.length!==2||point.some(value=>!Number.isFinite(value)||Math.abs(value)>1_000_000))||!Number.isFinite(action.size)||action.size<1||action.size>4096||!Number.isFinite(action.hardness)||action.hardness<0||action.hardness>1)throw new EditorError('INVALID_ARGUMENT','History Brush requires a finite brush stroke.')
 if(!Number.isFinite(action.opacity)||action.opacity<0||action.opacity>1||action.smoothing!==undefined&&(!Number.isFinite(action.smoothing)||action.smoothing<0||action.smoothing>5000)||action.artSize!==undefined&&(!Number.isSafeInteger(action.artSize)||action.artSize<2||action.artSize>128))throw new EditorError('INVALID_ARGUMENT','Invalid History Brush opacity, smoothing or art scale.')
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId),previous=source.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer||!previous)throw new EditorError('LAYER_NOT_FOUND','History Brush requires the same layer in the current and source states.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','The layer is locked. Unlock it before editing.')
 if(layer.text||layer.shape||previous.text||previous.shape)throw new EditorError('RASTERIZATION_REQUIRED','Rasterize the current and source text or shape before painting history pixels.')
 if(layer.isGroup||layer.adjustment||previous.isGroup||previous.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer present in the history source.')
 if(!samePlacement(layer,previous))throw new EditorError('INVALID_ARGUMENT','History Brush cannot restore a layer whose placement changed. Select a compatible source.')
 const asset=layer.imageFile?stage.assets.get(layer.imageFile):undefined,donor=previous.imageFile?source.assets.get(previous.imageFile):undefined
 if(!asset||previous.imageFile&&!donor)throw new EditorError('ASSET_NOT_FOUND','The current or history source raster is unavailable.')
 const width=asset.width,height=asset.height,pixels=width*height
 if(donor&&(donor.width!==width||donor.height!==height)||!donor&&(Math.round(previous.transform.size[0])!==width||Math.round(previous.transform.size[1])!==height))throw new EditorError('INVALID_ARGUMENT','History Brush cannot restore across changed raster dimensions.')
 const depth=asset.hdr?'hdr':asset.deep?16:8,sourceDepth=donor?.hdr?'hdr':donor?.deep?16:8
 if(donor&&depth!==sourceDepth)throw new EditorError('UNSUPPORTED_FEATURE','History Brush cannot restore across changed pixel precision.')
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||pixels>LIMITS.maxSurfacePixels||pixels*(depth==='hdr'?112:depth===16?80:48)+countAssetBackingBytes([asset,...(donor?[donor]:[])])>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','History Brush exceeds its 512 MiB working budget.')
 // Both buffers are immutable source versions. Decode PNG8 only after preflight;
 // high-depth layers use their actual premultiplied grids, never displayBytes.
 const current:HistoryBrushPixels=asset.hdr??asset.deep??PNG.sync.read(asset.bytes).data
 const old:HistoryBrushPixels=donor?(donor.hdr??donor.deep??PNG.sync.read(donor.bytes).data):depth==='hdr'?new Float32Array(pixels*4):depth===16?new Uint16Array(pixels*4):new Uint8Array(pixels*4)
 const prepared=prepareBrushStroke(action.points,action.size,action.smoothing??0,action.pressures),dynamics:BrushDynamics={...action,...prepared,tip:'brush'}
 const brush=brushStrokeCoverage({width,height,transform:layer.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},prepared.points,action.size,action.hardness,dynamics),coverage=new Float32Array(pixels);let changed=false
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x;if(!brush[i])continue;const point=documentPoint(layer,x+.5,y+.5,width,height);coverage[i]=brush[i]/255*selectionCoverage(stage.selection,...point);changed ||= coverage[i]>0&&action.opacity>0}
 const label=action.kind==='history'?'History Brush':'Art History Brush (source color patches)'
 if(!changed)return label
 const output=restoreHistoryBrushPixels(current,old,coverage,width,height,action.opacity,action.kind==='art-history'?(action.artSize??8):undefined)
 const file=`${layer.id.toUpperCase()}.${depth==='hdr'?'exr':'png'}`
 const replacement=depth==='hdr'?makeHDRAsset(file,width,height,output as Float32Array):depth===16?makeDeepAsset(file,width,height,output as Uint16Array):makeAsset(file,PNG.sync.write({width,height,data:Buffer.from(output.buffer,output.byteOffset,output.byteLength)} as PNG))
 stage.assets.set(file,replacement);layer.imageFile=file;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')
 return label
}
