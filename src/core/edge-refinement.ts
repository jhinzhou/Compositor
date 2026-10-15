import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {EditorError,LIMITS,type EditAction,type Layer,type EditorState} from '../shared/contracts'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask,maskPropertyGeometry} from '../shared/mask-properties'
import {appendSelectionShape} from '../shared/selection-composition'
import {coverageShape,type PixelStage} from './pixel-actions'
import {documentPoint,selectionCoverage,encodeRaster} from './raster-edit'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import {makeAsset} from './project-io'
import {assertLayerActionUnlocked} from './layer-locks'
import type {RasterSelection,RGBAImage} from './selection-retouch'
export type EdgeRefinementAction=Extract<EditAction,{type:'selection.refine_edges'}>
export interface EdgeRefinementPrepared {image:RGBAImage;selection:RasterSelection;coarseSource:'selection'|'mask'}
const MAX_EDGE_PIXELS=32_000_000
function sourceRaster(stage:PixelStage,action:EdgeRefinementAction,copy=true):{layer:Layer;image:RGBAImage}{
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The edge refinement layer was removed.')
 if(!layer.imageFile||layer.isGroup||layer.adjustment||layer.text||layer.shape)throw new EditorError('UNSUPPORTED_FEATURE','Edge refinement requires an ordinary raster layer.')
 const source=stage.assets.get(layer.imageFile)
 if(!source)throw new EditorError('ASSET_NOT_FOUND','The edge refinement source raster is missing.')
 if(source.width*source.height>MAX_EDGE_PIXELS)throw new EditorError('RESOURCE_LIMIT','Edge refinement exceeds the 32 megapixel working budget.')
 const png=PNG.sync.read(source.displayBytes??source.bytes),image={width:png.width,height:png.height,data:copy?Uint8Array.from(png.data):png.data}
 for(let i=3;i<image.data.length;i+=4)if(image.data[i]!==255)throw new EditorError('UNSUPPORTED_FEATURE','Edge refinement requires an opaque source image. Transparent source pixels are not supported.')
 if(action.region){const [x,y,w,h]=action.region;if(x+w>image.width||y+h>image.height)throw new EditorError('INVALID_ARGUMENT','The edge refinement region must be inside the source image.')}
 return {layer,image}
}
/** No mutable asset buffers escape; document selection wins over the effective layer mask. */
export function prepareEdgeRefinement(stage:PixelStage,action:EdgeRefinementAction):EdgeRefinementPrepared{
 assertLayerActionUnlocked(stage.manifest,action)
 const {layer,image}=sourceRaster(stage,action),coverage=new Uint8Array(image.width*image.height)
 let coarseSource:'selection'|'mask'
 if(stage.selection){coarseSource='selection';for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const p=documentPoint(layer,x+.5,y+.5,image.width,image.height);coverage[y*image.width+x]=Math.round(selectionCoverage(stage.selection,...p)*255)}}
 else if(layer.maskFile){
  coarseSource='mask';const asset=stage.assets.get(layer.maskFile)
  if(!asset)throw new EditorError('ASSET_NOT_FOUND','The existing layer mask is missing.')
  if(layer.maskEnabled===false)coverage.fill(255)
  else {let geometry:ReturnType<typeof maskPropertyGeometry>;try{geometry=maskPropertyGeometry(asset.width,asset.height,layer)}catch{throw new EditorError('RESOURCE_LIMIT','Edge refinement mask preparation exceeds the 512 MiB working budget.')}
   const estimatedBytes=image.width*image.height*12+asset.width*asset.height*8+geometry.width*geometry.height*(geometry.inset?40:layer.maskDensity===undefined||layer.maskDensity===1?0:12)
   if(estimatedBytes>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Edge refinement mask preparation exceeds the 512 MiB working budget.')
   const png=PNG.sync.read(asset.bytes),effective=effectiveMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},layer),placement=effectiveMaskTransform(layer.maskPlacement??layer.transform,png,effective.inset)
   for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const p=documentPoint(layer,x+.5,y+.5,image.width,image.height);coverage[y*image.width+x]=sampleEffectiveMask(effective,placement,...p)}}
 }else throw new EditorError('MAKE_SELECTION','Make a selection or add a layer mask before refining edges.')
 return {image,selection:{width:image.width,height:image.height,coverage},coarseSource}
}
/** Mutates only an isolated stage. Preview and commit share this exact coverage/metadata path. */
export function applyEdgeRefinementOutput(stage:PixelStage,action:EdgeRefinementAction,mask:RasterSelection):string{
 assertLayerActionUnlocked(stage.manifest,action)
 const {layer:source,image}=sourceRaster(stage,action,false)
 if(!stage.selection&&!source.maskFile)throw new EditorError('MAKE_SELECTION','Make a selection or add a layer mask before refining edges.')
 if(source.maskFile&&!stage.assets.has(source.maskFile))throw new EditorError('ASSET_NOT_FOUND','The existing layer mask is missing.')
 if(!mask||mask.width!==image.width||mask.height!==image.height||!(mask.coverage instanceof Uint8Array)||mask.coverage.length!==mask.width*mask.height)throw new EditorError('INVALID_ARGUMENT','The refined coverage must match the source image.')
 if(action.output==='selection'){
  stage.selection=appendSelectionShape(null,coverageShape(mask,source.transform),stage.manifest.width,stage.manifest.height)
  stage.selection.canvasSize=[stage.manifest.width,stage.manifest.height];stage.selection.antialiased=true
  return 'Refine edges to selection'
 }
 let layer=source
 if(action.output==='new-layer'){
  if(stage.manifest.layers.length>=LIMITS.maxLayers)throw new EditorError('RESOURCE_LIMIT','Creating a refined layer exceeds the document layer budget.')
  layer=structuredClone(source);layer.id=randomUUID().toUpperCase();layer.name=`${source.name} — Refined`;if(layer.name.length>4096)layer.name=layer.name.slice(0,4096)
  // Editable descriptors refer to the original object. A new raster clone must not resurrect them.
  delete layer.photoshop;delete layer.text;delete layer.shape;delete layer.locked;delete layer.positionLocked
  const file=`${layer.id}.png`,asset=stage.assets.get(source.imageFile!)!
  // Project assets are immutable; an independent asset entry avoids copying the unchanged encoded source.
  stage.assets.set(file,{...asset,file});layer.imageFile=file
  stage.manifest.layers.splice(stage.manifest.layers.indexOf(source)+1,0,layer);stage.manifest.activeLayerID=layer.id
 }
 const png=new PNG({width:mask.width,height:mask.height})
 for(let i=0;i<mask.coverage.length;i++){const value=mask.coverage[i];png.data.set([value,value,value,255],i*4)}
 const file=`${layer.id.toUpperCase()}.mask.png`;stage.assets.set(file,makeAsset(file,encodeRaster(png,true)));layer.maskFile=file
 layer.maskEnabled=true;layer.maskLinked=true;layer.maskDensity=1;layer.maskFeather=0;delete layer.maskFeatherModel;delete layer.maskFeatherEdgeMode
 delete layer.maskPlacement;delete layer.photoshopMaskDefault
 invalidatePhotoshopComponent(layer,'mask')
 // This output replaces the entire matte; a retained source vector mask would apply another alpha on PSD export.
 if(layer.photoshop&&typeof layer.photoshop==='object')delete (layer.photoshop as Record<string,unknown>).vectorMask
 return action.output==='new-layer'?'Refine edges to new layer':'Refine layer mask edges'
}
/** Convert temporary new/changed assets to URLs because they are not installed in the document asset store. */
export function edgeRefinementPreviewState(state:EditorState,stage:PixelStage):EditorState{
 const result=structuredClone(state),known=new Map(state.assets.map(asset=>[asset.file,asset.hash])),knownHashes=new Map(state.assets.map(asset=>[asset.hash,asset.file])),urls=new Map<string,string>()
 for(const [file,asset] of stage.assets)if(known.get(file)!==asset.hash)urls.set(file,knownHashes.get(asset.hash)??`data:image/png;base64,${(asset.displayBytes??asset.bytes).toString('base64')}`)
 result.manifest=structuredClone(stage.manifest);result.selection=structuredClone(stage.selection)
 for(const layer of result.manifest.layers)for(const field of ['imageFile','maskFile'] as const){const file=layer[field];if(file&&urls.has(file))layer[field]=urls.get(file)!}
 const referenced=new Set(result.manifest.layers.flatMap(layer=>[layer.imageFile,layer.maskFile].filter((file):file is string=>!!file)))
 result.assets=[...new Map([...stage.assets].map(([file,asset])=>{const mapped=urls.get(file)??file;return [mapped,{file:mapped,hash:asset.hash,width:asset.width,height:asset.height,...(asset.bitDepth===16&&!urls.has(file)?{bitDepth:16 as const,displayHash:asset.displayHash,pixelFormat:asset.pixelFormat}:{})}] as const})).values()].filter(asset=>referenced.has(asset.file))
 return result
}
