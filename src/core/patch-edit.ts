import {PNG} from 'pngjs'
import {EditorError,type Transform} from '../shared/contracts'
import type {Selection} from '../shared/pixel-contracts'
import {translateSelection} from '../shared/interaction-geometry'
import {blendSampledHealing,sampleHealingDonor,SAMPLED_HEALING_LIMITS} from '../shared/sampled-healing'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {makeAsset} from './project-io'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import {layerProtected} from './layer-locks'
import type {PixelStage} from './pixel-actions'

export interface PatchAction {type:'layer.patch';layerId:string;offset:[number,number];mode:'source'|'destination';opacity?:number;adaptation?:number;protectAlpha?:boolean}
export const PATCH_LIMITS={sourcePixels:16_000_000,workingPixels:SAMPLED_HEALING_LIMITS.pixels,work:SAMPLED_HEALING_LIMITS.work} as const
export interface PatchPrepared {png:Buffer;transform:Transform;target:'image';selection:Selection|null;affectedPixels:number}
// Affine round-trips can yield 24.999999999999996 for a pixel edge.
// Stabilize only values within floating-point noise of the half-pixel lattice
// before floor-based mask lookup and bilinear donor sampling.
const stablePixelCoordinate=(value:number)=>Math.abs(value*2-Math.round(value*2))<1e-9?Math.round(value*2)/2:value
/** Source mode selects the repair area and drags toward its donor. Destination
 * mode selects a donor and drags it to another area; neither mode erases a donor. */
export function preparePatch(stage:PixelStage,action:PatchAction,options:{signal?:AbortSignal;maximumWork?:number}={}):PatchPrepared {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The patch layer no longer exists.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','Unlock this layer before using Patch.')
 if(layer.isGroup||layer.adjustment||layer.text||layer.shape)throw new EditorError('INVALID_ARGUMENT','Choose a raster image layer for Patch.')
 if(!stage.selection)throw new EditorError('INVALID_ARGUMENT','Create a selection before using Patch.')
 if(!['source','destination'].includes(action.mode)||action.offset.length!==2||action.offset.some(value=>!Number.isFinite(value)||Math.abs(value)>1_000_000))throw new EditorError('INVALID_ARGUMENT','Invalid patch mode or offset.')
 if(options.signal?.aborted)throw new EditorError('CANCELED','Patch was canceled.')
 const asset=layer.imageFile&&stage.assets.get(layer.imageFile)
 if(!asset)throw new EditorError('ASSET_NOT_FOUND','The patch image is missing.')
 if(asset.deep||asset.hdr||asset.bitDepth===16)throw new EditorError('UNSUPPORTED_FEATURE','Patch currently requires RGB8 pixels. The original high-depth pixels and history have been kept.')
 const count=asset.width*asset.height
 if(count>PATCH_LIMITS.sourcePixels)throw new EditorError('RESOURCE_LIMIT','Patch exceeds its 16 MP source raster budget; use a smaller image.')
 const budget=options.maximumWork??PATCH_LIMITS.work
 if(!Number.isFinite(budget)||budget<0||budget>PATCH_LIMITS.work)throw new EditorError('INVALID_ARGUMENT','Invalid Patch compute budget.')
 if(count>budget)throw new EditorError('RESOURCE_LIMIT','Patch exceeds its blending budget; use a smaller selection or image.')
 if(action.opacity===0||action.offset.every(value=>value===0))return {png:asset.bytes,transform:structuredClone(layer.transform),target:'image',selection:structuredClone(stage.selection),affectedPixels:0}
 const png=PNG.sync.read(asset.bytes)
 if(png.width!==asset.width||png.height!==asset.height)throw new EditorError('INVALID_PROJECT','The patch image dimensions do not match its descriptor.')
 const original=png.data,coverage=new Uint8Array(count)
 let affectedPixels=0,left=png.width,top=png.height,right=0,bottom=0
 // Discover the target independently of donors. This keeps inverted, feathered,
 // translated and rotated selections exact without allocating a full-image
 // Float32 donor. Only the selected region plus the solver's 2 px boundary ring is sampled.
 for(let y=0;y<png.height;y++){
  if(options.signal?.aborted)throw new EditorError('CANCELED','Patch was canceled.')
  for(let x=0;x<png.width;x++){
   const p=y*png.width+x,doc=documentPoint(layer,x+.5,y+.5,png.width,png.height),inside=doc[0]>=0&&doc[1]>=0&&doc[0]<stage.manifest.width&&doc[1]<stage.manifest.height
   const maskPoint=([doc[0]-(action.mode==='destination'?action.offset[0]:0),doc[1]-(action.mode==='destination'?action.offset[1]:0)] as [number,number]).map(stablePixelCoordinate) as [number,number]
   coverage[p]=inside?Math.round(selectionCoverage(stage.selection,...maskPoint)*255):0
   if(coverage[p]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}
  }
 }
 if(right<=left)throw new EditorError('INVALID_ARGUMENT','The patch source or destination has no usable pixels.')
 left=Math.max(0,left-2);top=Math.max(0,top-2);right=Math.min(png.width,right+2);bottom=Math.min(png.height,bottom+2)
 const width=right-left,height=bottom-top,workingCount=width*height
 if(workingCount>PATCH_LIMITS.workingPixels)throw new EditorError('RESOURCE_LIMIT','Patch exceeds its 4 MP selected working area budget; use a smaller selection.')
 // Explicit feather uses a soft compositing tail around the native >=50% core.
 // Baked masks may lose metadata; any weak pixel without a core neighbor within
 // one pixel likewise needs the soft path. This classification is conservative.
 let sharpCoverage=!(stage.selection.feather??0)&&stage.selection.shapes.every(shape=>!shape.feather),classificationWork=0
 const destination=new Uint8Array(workingCount*4),localCoverage=new Uint8Array(workingCount),donor=new Float32Array(workingCount*4),direction=action.mode==='source'?1:-1
 for(let y=0;y<height;y++){
  if(options.signal?.aborted)throw new EditorError('CANCELED','Patch was canceled.')
  for(let x=0;x<width;x++){
   const p=(top+y)*png.width+left+x,q=y*width+x,doc=documentPoint(layer,left+x+.5,top+y+.5,png.width,png.height)
   destination.set(original.subarray(p*4,p*4+4),q*4);localCoverage[q]=coverage[p]
   if(sharpCoverage&&coverage[p]>0&&coverage[p]<128){
    let nearCore=false
    for(let dy=-1;dy<=1&&!nearCore;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;classificationWork++;if(count+classificationWork>budget)throw new EditorError('RESOURCE_LIMIT','Patch exceeds its blending budget; use a smaller selection or image.');const xx=left+x+dx,yy=top+y+dy;if(xx>=0&&yy>=0&&xx<png.width&&yy<png.height&&coverage[yy*png.width+xx]>=128){nearCore=true;break}}
    if(!nearCore)sharpCoverage=false
   }
   const source=sourcePoint(layer,doc[0]+action.offset[0]*direction,doc[1]+action.offset[1]*direction,png.width,png.height)
   donor.set(sampleHealingDonor(original,png.width,png.height,...source.map(stablePixelCoordinate) as [number,number]),q*4)
   if(localCoverage[q]&&donor[q*4+3]>0&&(action.protectAlpha===false||original[p*4+3]>0))affectedPixels++
  }
 }
 if(!affectedPixels)throw new EditorError('INVALID_ARGUMENT','The patch source or destination has no usable pixels.')
 const result=blendSampledHealing(destination,donor,localCoverage,width,height,{opacity:action.opacity,adaptation:action.adaptation,protectAlpha:action.protectAlpha,selectionCoreThreshold:128,selectionSoftTail:!sharpCoverage,selectionPyramid:true,signal:options.signal,maximumWork:budget-count-classificationWork})
 affectedPixels=0
 for(let y=0;y<height;y++){
  if(options.signal?.aborted)throw new EditorError('CANCELED','Patch was canceled.')
  for(let x=0;x<width;x++){const p=(top+y)*png.width+left+x,q=y*width+x,at=p*4,qt=q*4;if(result[qt]!==original[at]||result[qt+1]!==original[at+1]||result[qt+2]!==original[at+2]||result[qt+3]!==original[at+3]){affectedPixels++;original.set(result.subarray(qt,qt+4),at)}}
 }
 const selection=action.mode==='destination'?translateSelection(stage.selection,action.offset):structuredClone(stage.selection)
 return {png:affectedPixels?encodeRaster(png):asset.bytes,transform:structuredClone(layer.transform),target:'image',selection,affectedPixels}
}
/** Preparation and mutation share one pixel path; Editor commits its private stage
 * once, so preview/cancel cannot create history or mutate any source asset. */
export function applyPatchOperation(stage:PixelStage,action:PatchAction):string {
 const result=preparePatch(stage,action),layer=stage.manifest.layers.find(item=>item.id===action.layerId)!,file=`${layer.id.toUpperCase()}.png`
 if(result.affectedPixels){const asset=makeAsset(file,result.png);stage.assets.set(file,asset);layer.imageFile=file;layer.transform=result.transform;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')}
 stage.selection=result.selection
 return 'Patch selection'
}
