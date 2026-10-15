import {applyMixerBrushOperation} from './mixer-brush-edit'
import {applyTonalBrush} from './tonal-brush-edit'
import {applyBucketFill} from './bucket-fill'
import {applyFrameOperation} from './frame-edit'
import {applyPathOperation} from './path-edit'
import {transformVectorFrameMetadata} from './vector-frame-metadata'
import {applyPatchOperation} from './patch-edit'
import {applyColorEraseOperation} from './color-erase-edit'
import {applyRetouchTool} from './retouch-tools'
import {mapDocumentInfoPoints} from '../shared/document-info'
import {applyStraighten,applyPerspectiveCrop} from './crop-actions'
import {quickSelection,IMAGE_SELECTION_LIMITS} from './image-driven-selection'
import {bakeDeepImageSizeRaster} from './deep-resample'
import {assertDeepAssetBudget,DEEP_ASSET_WORKING_BUDGET,countAssetBytes} from './deep-assets'
import {applyDeepColorOperation,applyDeepBlurOperation,applyDeepStrokeOperation,applyDeepDrawingOperation} from './deep-edit'
import {convertLayerDepth} from './layer-depth'
import {assertPaintRasterized,rasterizeLayer} from './layer-rasterize'
import {applyHDROperation} from './hdr-edit'
import {bakeHDRImageSizeRaster} from './hdr-resample'
import {assertDeepActionSupported} from './deep-precision'
import {brushStrokeExtentDiameter,prepareBrushStroke} from '../shared/brush-dynamics'
import {paintSelection,fillSelection} from '../shared/selection-paint'
import {applyNamedSelectionAction,transformNamedSelections} from './named-selections'
import {scaleImageSizeEffects} from './image-size-effects'
import {bakeImageSizeRaster,imageSizePlacement} from './image-size-raster'
import {followingTransform} from '../shared/mask-placement'
import {morphDocumentSelection} from '../shared/selection-morphology'
import {modifyDocumentSelection} from '../shared/selection-modify'
import {sampleLayerInDocument} from './document-sampler'
import {invalidateSelectionCoverage} from '../shared/selection-coverage'
import {textStyleSchema} from '../shared/content-style'
import {copyLayerComponent} from './layer-component-copy'
import {growStrokeRaster,trimStrokeRaster} from './stroke-raster'
import {maskBackground} from '../shared/mask-pixels'
import {applyRetouchOperation} from './retouch-edit'
import {transformSelectedPixels} from './selection-transform'
import {applyMaskOperation} from './mask-operations'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import {filterRaster,carryFilterMask} from './filter-edit'
import {translateSelection} from '../shared/interaction-geometry'
import {appendSelectionShape,appendSelectionFeather} from '../shared/selection-composition'
import {distortRaster,validateWarpCorners} from './distort-raster'
import {randomUUID} from 'node:crypto'
import {specToNativeAdjustment} from '../shared/image-filters'
import {documentPoint,selectionCoverage} from './raster-edit'
import {magicWandSelection,colorRangeSelection,selectionFromAlpha,type RasterSelection,type RGBAImage} from './selection-retouch'
import { PNG } from 'pngjs'
import { EditorError, LIMITS, type EditAction, type Layer, type Manifest } from '../shared/contracts'
import type { Selection } from '../shared/pixel-contracts'
import { makeAsset, makeDeepAsset, makeHDRAsset, type Asset } from './project-io'
import { blankPNG, encodeRaster, fillRaster, gradientRaster, paintRaster } from './raster-edit'

export interface PixelStage { bucketPreview?:Asset;mixerPreview?:Pick<import('./mixer-brush-edit').MixerBrushPrepared,'png'|'width'|'height'|'transform'>;mixerReservoir?:import('../shared/mixer-brush').MixerBrushReservoir;manifest: Manifest; assets: Map<string, Asset>; selection: Selection | null }
function raster(stage: PixelStage, layer: Layer, mask: boolean): PNG {
  const file = mask ? layer.maskFile : layer.imageFile
  if (file) {
    const asset = stage.assets.get(file)
    if (!asset) throw new EditorError('ASSET_NOT_FOUND', 'The layer raster is missing.')
    const png = PNG.sync.read(asset.displayBytes??asset.bytes)
    if (!mask || png.width > 1 || png.height > 1) return png
    const size=(layer.maskPlacement??layer.transform).size
    if(size[0]>LIMITS.maxSide||size[1]>LIMITS.maxSide||size[0]*size[1]>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Mask raster exceeds the resource budget.')
    return blankPNG(Math.max(1,Math.round(size[0])),Math.max(1,Math.round(size[1])),png.data[0])
  }
  if (mask) throw new EditorError('INVALID_ARGUMENT', 'Add a layer mask before painting it.')
  if (layer.isGroup || layer.adjustment) throw new EditorError('INVALID_ARGUMENT', 'Choose a raster layer to paint.')
  const w = Math.max(1, Math.round(layer.transform.size[0])), h = Math.max(1, Math.round(layer.transform.size[1]))
  if (w > LIMITS.maxSide || h > LIMITS.maxSide || w * h > LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT', 'Raster size exceeds this build’s resource budget.')
  return blankPNG(w, h)
}
function store(stage: PixelStage, layer: Layer, png: PNG, mask: boolean): void {
  const file = `${layer.id.toUpperCase()}${mask ? '.mask' : ''}.png`
  stage.assets.set(file, makeAsset(file, encodeRaster(png, mask)))
  if (mask) {layer.maskFile = file;invalidatePhotoshopComponent(layer,'mask')}
  else { layer.imageFile = file; delete layer.text; delete layer.shape;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector') }
}
function matchesPlacement(a:Layer['transform'],b:Layer['transform']):boolean{return a.rotation===b.rotation&&a.flipX===b.flipX&&a.flipY===b.flipY&&a.origin.every((v,i)=>v===b.origin[i])&&a.size.every((v,i)=>v===b.size[i])}
function shift(stage: PixelStage, x: number, y: number): void {
  transformVectorFrameMetadata(stage,p=>[p[0]+x,p[1]+y])
  if(stage.manifest.documentInfo)stage.manifest.documentInfo=mapDocumentInfoPoints(stage.manifest.documentInfo,p=>[p[0]+x,p[1]+y])
  for (const layer of stage.manifest.layers) {
    layer.transform.origin = [layer.transform.origin[0] + x, layer.transform.origin[1] + y]
    const placement = layer.maskPlacement as Layer['transform'] | undefined
    if (placement) placement.origin = [placement.origin[0] + x, placement.origin[1] + y]
  }
  const guides = stage.manifest.guides as {axis: string; position: number}[] | undefined
  if (guides) for (const guide of guides) guide.position += guide.axis === 'vertical' ? x : y
  if(stage.selection)invalidateSelectionCoverage(stage.selection)
  if (stage.selection) for (const shape of stage.selection.shapes) {
    shape.bounds[0] += x; shape.bounds[1] += y
    if (shape.points) shape.points = shape.points.map(([a,b]) => [a+x,b+y])
    if(shape.raster){shape.raster.transform.origin[0]+=x;shape.raster.transform.origin[1]+=y}
  }
}
export function coverageShape(mask:RasterSelection,transform:Layer['transform'],operation:'replace'|'add'|'subtract'|'intersect'='replace'):Selection['shapes'][number]{
 const runs:[number,number,number,number][]=[]
 for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;){const value=mask.coverage[y*mask.width+x],start=x++;while(x<mask.width&&mask.coverage[y*mask.width+x]===value)x++;if(value)runs.push([y,start,x-start,value]);if(runs.length>100_000)throw new EditorError('RESOURCE_LIMIT','This selection is too detailed for this build’s coverage budget.')}
 const {sampling:_,...t}=transform;return {kind:'raster',bounds:[transform.origin[0],transform.origin[1],transform.size[0],transform.size[1]],operation,feather:0,raster:{width:mask.width,height:mask.height,transform:t,runs}}
}
export function applySelectionRaster(stage:PixelStage,action:Extract<EditAction,{type:'selection.wand'|'selection.color_range'|'selection.quick'}>,image:RGBAImage):string{
 if(image.width!==stage.manifest.width||image.height!==stage.manifest.height||image.data.length!==image.width*image.height*4)throw new EditorError('INVALID_ARGUMENT','The selection sample must match the document dimensions.')
 const mask=action.type==='selection.quick'?quickSelection(image,action.points,action):action.type==='selection.wand'?magicWandSelection(image,action.point,{tolerance:action.tolerance,contiguous:action.contiguous,sampleSize:action.sampleSize}):colorRangeSelection(image,action.colors,action.tolerance,action.softness,true,{excludeColors:action.excludeColors,invert:action.invert})
 const transform:Layer['transform']={origin:[0,0],size:[image.width,image.height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}
 const shape=coverageShape(mask,transform,action.operation)
 if(action.type==='selection.quick')shape.feather=action.feather
 // Pass AA during composition: a new feathered operation must be materialized
 // with its own AA flag, not the previous selection's flag and then patched.
 stage.selection=appendSelectionShape(stage.selection,shape,image.width,image.height,action.antialiased)
 stage.selection.canvasSize=[image.width,image.height]
 return action.type==='selection.quick'?'Quick Selection':action.type==='selection.wand'?'Magic Wand':'Color Range'
}
export function applyPixelAction(stage: PixelStage, action: EditAction): string | undefined {
  assertPaintRasterized(stage.manifest,action)
  assertDeepActionSupported(stage.manifest,stage.assets,action)
  const layer = 'layerId' in action ? stage.manifest.layers.find(layer => layer.id === action.layerId)! : undefined
  if(layer?.imageFile&&stage.assets.get(layer.imageFile)?.hdr&&(!('target'in action)||action.target!=='mask')&&['layer.paint','layer.retouch','layer.filter','layer.fill','layer.gradient','layer.clear_selected'].includes(action.type))return applyHDROperation(stage,action as Parameters<typeof applyHDROperation>[1])
  switch (action.type) {
    case 'frame.create':case 'frame.place':case 'frame.set_bounds':case 'frame.set_content_transform':return applyFrameOperation(stage,action).label
    case 'document.path_set':case 'document.path_delete':case 'selection.from_path':case 'layer.path_fill':case 'layer.path_mask':return applyPathOperation(stage,action).label
    case 'document.info':stage.manifest.documentInfo=structuredClone(action.info);return 'Edit document information'
    case 'layer.mixer_brush':return applyMixerBrushOperation(stage,action,prepared=>{stage.mixerReservoir=structuredClone(prepared.reservoir);stage.mixerPreview=prepared})
    case 'layer.tonal_brush':return applyTonalBrush(stage,action)
    case 'layer.bucket_fill':return applyBucketFill(stage,action)
    case 'layer.patch':return applyPatchOperation(stage,action)
    case 'layer.background_erase':case 'layer.magic_erase':return applyColorEraseOperation(stage,action)
    case 'layer.remove':case 'layer.content_aware_move':case 'layer.red_eye':return applyRetouchTool(stage,action)
    case 'layer.rasterize':rasterizeLayer(layer!,stage.assets);return 'Rasterize layer'
    case 'layer.convert_depth':return convertLayerDepth(stage,action)
    case 'selection.save_named':case 'selection.load_named':case 'selection.rename_named':case 'selection.delete_named':return applyNamedSelectionAction(stage,action)
    case 'layer.copy_mask':case 'layer.copy_effect':{const label=copyLayerComponent(stage,action);invalidatePhotoshopComponent(layer!,action.type==='layer.copy_mask'?'mask':'effects');return label}
    case 'document.trim':case 'layer.text':case 'layer.shape':case 'selection.subject':case 'selection.refine_edges':case 'layer.content_fill':throw new EditorError('ASYNC_OPERATION_REQUIRED','Use a single document.apply for this image operation; it cannot run inside a batch.')
    case 'selection.transform_pixels':return transformSelectedPixels(stage,layer!,action.transform,action.corners)
    case 'selection.translate':if(stage.selection)stage.selection=translateSelection(stage.selection,action.delta);return 'Move selection'
    case 'layer.clear_selected': {if(action.target!=='mask'&&layer?.imageFile&&stage.assets.get(layer.imageFile)?.deep)return applyDeepDrawingOperation(stage,action);const mask=action.target==='mask',png=raster(stage,layer!,mask),placement=mask&&layer!.maskPlacement?{...layer!,transform:layer!.maskPlacement}:layer!;for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const p=documentPoint(placement,x+.5,y+.5,png.width,png.height),amount=selectionCoverage(stage.selection,...p),at=(y*png.width+x)*4;if(mask)png.data[at]=png.data[at+1]=png.data[at+2]=Math.round(png.data[at]*(1-amount));else png.data[at+3]=Math.round(png.data[at+3]*(1-amount))}store(stage,layer!,png,mask);return 'Clear selected pixels'}
    case 'layer.effects':if(layer!.isGroup||layer!.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer for effects.');else{if(action.effects)layer!.effects=structuredClone(action.effects);else delete layer!.effects;invalidatePhotoshopComponent(layer!,'effects');return 'Edit layer effects'}
    case 'layer.distort':{
      if(action.target==='mask'){
        if(!layer!.maskFile)throw new EditorError('INVALID_ARGUMENT','Choose a layer with a raster mask.')
        const asset=stage.assets.get(layer!.maskFile!);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer mask is missing.');const original=PNG.sync.read(asset.bytes),placement=layer!.maskPlacement??layer!.transform
        if(original.width===1&&original.height===1){
          const corners=validateWarpCorners(action.corners),left=Math.floor(Math.min(...corners.map(p=>p[0]))),top=Math.floor(Math.min(...corners.map(p=>p[1]))),width=Math.ceil(Math.max(...corners.map(p=>p[0])))-left,height=Math.ceil(Math.max(...corners.map(p=>p[1])))-top
          if(width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Distortion exceeds the image budget.')
          layer!.maskPlacement={origin:[left,top],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:placement.sampling};if(matchesPlacement(layer!.maskPlacement,layer!.transform))delete layer!.maskPlacement;return 'Distort layer mask'
        }
        const result=distortRaster(original,action.corners,{flipX:placement.flipX,flipY:placement.flipY,sampling:placement.sampling,mask:true,maskBackground:maskBackground({width:original.width,height:original.height,data:new Uint8ClampedArray(original.data)})})
        store(stage,layer!,result.png,true);if(matchesPlacement(result.transform,layer!.transform))delete layer!.maskPlacement;else layer!.maskPlacement=result.transform;return 'Distort layer mask'
      }
      const original=raster(stage,layer!,false),result=distortRaster(original,action.corners,{flipX:layer!.transform.flipX,flipY:layer!.transform.flipY,sampling:layer!.transform.sampling,trim:action.trim})
      if(layer!.maskFile&&layer!.maskLinked!==false&&!layer!.maskPlacement){const mask=PNG.sync.read(stage.assets.get(layer!.maskFile)!.bytes);if(mask.width>1||mask.height>1){const distorted=distortRaster(mask,action.corners,{flipX:layer!.transform.flipX,flipY:layer!.transform.flipY,sampling:layer!.transform.sampling,mask:true,maskBackground:mask.data[0]>=128?255:0});store(stage,layer!,distorted.png,true)}}
      store(stage,layer!,result.png,false);layer!.transform=result.transform;return 'Distort layer'
    }
    case 'selection.wand':case 'selection.color_range':case 'selection.quick':{
      if(action.sampleAllLayers)throw new EditorError('ASYNC_OPERATION_REQUIRED','Sample All Layers requires a revision-matched document composite.')
      if(action.type==='selection.quick'&&stage.manifest.width*stage.manifest.height>IMAGE_SELECTION_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Quick Selection analysis supports up to 16 MP.')
      if(!layer||layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer for image-driven selection.')
      const selectionAsset=layer.imageFile?stage.assets.get(layer.imageFile):undefined
      if(action.type==='selection.quick'&&selectionAsset&&selectionAsset.width*selectionAsset.height>IMAGE_SELECTION_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Quick Selection source analysis supports up to 16 MP.')
      const png=layer!.imageFile?raster(stage,layer!,false):null,sample=sampleLayerInDocument(png,layer!.transform,stage.manifest.width,stage.manifest.height)
      return applySelectionRaster(stage,action,sample)
    }
    case 'selection.from_alpha':{
      const png=raster(stage,layer!,false),mask=selectionFromAlpha(png)
      stage.selection=appendSelectionShape(stage.selection,{...coverageShape(mask,layer!.transform),operation:action.operation},stage.manifest.width,stage.manifest.height);return 'Select pixels'
    }
    case 'layer.retouch':return action.target!=='mask'&&layer?.imageFile&&stage.assets.get(layer.imageFile)?.bitDepth===16?(action.kind==='blur'?applyDeepBlurOperation(stage,action):applyDeepStrokeOperation(stage,action)):applyRetouchOperation(stage,action)
    case 'layer.filter':{
      if(layer?.imageFile&&stage.assets.get(layer.imageFile)?.bitDepth===16)return applyDeepColorOperation(stage,action)
      const png=raster(stage,layer!,false),oldTransform=structuredClone(layer!.transform),result=filterRaster(png,oldTransform,stage.selection,action.filter,{canvasSize:[stage.manifest.width,stage.manifest.height]})
      if(result.grew&&layer!.maskFile&&layer!.maskLinked!==false&&!layer!.maskPlacement){const asset=stage.assets.get(layer!.maskFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer mask is missing.');const mask=PNG.sync.read(asset.bytes);if(mask.width>1||mask.height>1)store(stage,layer!,carryFilterMask(mask,oldTransform,result),true)}
      store(stage,layer!,result.png,false);layer!.transform=result.transform;return 'Apply filter'
    }
    case 'adjustment.add':{
      const id=randomUUID().toUpperCase();stage.manifest.layers.push({id,name:action.name,isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',adjustment:specToNativeAdjustment(action.filter),transform:{origin:[0,0],size:[stage.manifest.width,stage.manifest.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}});stage.manifest.activeLayerID=id;return 'Add adjustment layer'
    }
    case 'adjustment.set':if(!layer!.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose an adjustment layer.');else{layer!.adjustment=specToNativeAdjustment(action.filter);return 'Edit adjustment layer'}

    case 'selection.fill':try {stage.selection=fillSelection(stage.selection,stage.manifest.width,stage.manifest.height,action.value,action.opacity);return 'Fill selection channel'}catch(cause){throw new EditorError('RESOURCE_LIMIT',cause instanceof Error?cause.message:String(cause))}
    case 'selection.paint':try {stage.selection=paintSelection(stage.selection,stage.manifest.width,stage.manifest.height,action);return 'Paint selection'}catch(cause){throw new EditorError('RESOURCE_LIMIT',cause instanceof Error?cause.message:String(cause))}
    case 'selection.set': stage.selection = structuredClone(action.selection); return 'Set selection'
    case 'selection.invert': stage.selection = stage.selection ? { ...stage.selection, inverted: !stage.selection.inverted } : {shapes: [], inverted: true}; return 'Invert selection'
    case 'selection.modify': {
      if (!stage.selection) return 'Modify selection'
      if(action.operation==='feather')stage.selection=appendSelectionFeather(stage.selection,stage.manifest.width,stage.manifest.height,action.amount,action.featherModel)
      else if(action.operation==='smooth'||action.operation==='border')stage.selection=modifyDocumentSelection(stage.selection,stage.manifest.width,stage.manifest.height,action.operation,action.amount)
      else stage.selection=morphDocumentSelection(stage.selection,stage.manifest.width,stage.manifest.height,action.operation,action.amount)
      return 'Modify selection'
    }
    case 'layer.paint': {
      if(action.target!=='mask'&&layer?.imageFile&&stage.assets.get(layer.imageFile)?.deep)return applyDeepStrokeOperation(stage,action)
      const mask=action.target==='mask',original=raster(stage,layer!,mask),oldTransform=structuredClone(mask?layer!.maskPlacement??layer!.transform:layer!.transform),prepared=prepareBrushStroke(action.points,action.size,action.smoothing??0,action.pressureSize!==false||action.pressureOpacity?action.pressures:undefined),points=prepared.points
      const result=action.erase&&!mask?{png:original,transform:oldTransform,grew:false}:growStrokeRaster(original,oldTransform,points,brushStrokeExtentDiameter(action.size,action.hardness,{brushModel:action.brushModel,tip:action.tip}),mask?maskBackground({width:original.width,height:original.height,data:new Uint8ClampedArray(original.data)}):undefined)
      paintRaster(result.png,{...layer!,transform:result.transform},points,action.color,action.size,action.hardness,action.opacity,action.erase,stage.selection,mask,[stage.manifest.width,stage.manifest.height],{flow:action.flow,spacing:action.spacing,brushModel:action.brushModel,tip:action.tip,pressures:prepared.pressures,pressureSize:action.pressureSize,pressureOpacity:action.pressureOpacity})
      const final=mask?result:trimStrokeRaster(result.png,result.transform)
      if(mask){store(stage,layer!,final.png,true);if(result.grew)layer!.maskPlacement=final.transform}
      else {if(layer!.maskFile&&!layer!.maskPlacement&&(JSON.stringify(final.transform)!==JSON.stringify(layer!.transform))){const asset=stage.assets.get(layer!.maskFile)!,maskPNG=PNG.sync.read(asset.bytes);if(maskPNG.width>1||maskPNG.height>1)store(stage,layer!,carryFilterMask(maskPNG,layer!.transform,{...final,grew:true}),true)}store(stage,layer!,final.png,false);layer!.transform=final.transform}
      return action.erase?'Erase pixels':mask?'Paint mask':'Paint pixels'
    }
    case 'layer.fill': {
      if(action.target!=='mask'&&layer?.imageFile&&stage.assets.get(layer.imageFile)?.deep)return applyDeepDrawingOperation(stage,action)
      const mask = action.target === 'mask', png = raster(stage, layer!, mask)
      const text=!mask&&!stage.selection?textStyleSchema.safeParse(layer!.text):undefined
      if(text?.success){
        const style={...text.data,red:action.color[0],green:action.color[1],blue:action.color[2]};delete style.colorRuns
        // Fill Text recolors letters, preserving their coverage and the saved font runs.
        // The raster never acquires an opaque rectangle around the letters.
        for(let at=0;at<png.data.length;at+=4)for(let channel=0;channel<3;channel++)png.data[at+channel]=Math.round(action.color[channel]*255)
        const file=layer!.imageFile!;stage.assets.set(file,makeAsset(file,encodeRaster(png)));layer!.text=style;return 'Fill Text'
      }
      fillRaster(png, mask&&layer!.maskPlacement?{...layer!,transform:layer!.maskPlacement}:layer!, action.color, stage.selection, mask); store(stage, layer!, png, mask); return 'Fill selection'
    }
    case 'layer.gradient': {
      if(action.target!=='mask'&&layer?.imageFile&&stage.assets.get(layer.imageFile)?.deep)return applyDeepDrawingOperation(stage,action)
      const mask=action.target==='mask',source=raster(stage,layer!,mask),oldTransform=structuredClone(mask?layer!.maskPlacement??layer!.transform:layer!.transform)
      const canvasSize:[number,number]=[stage.manifest.width,stage.manifest.height],corners:[number,number][]=[[0,0],[canvasSize[0],0],canvasSize,[0,canvasSize[1]]]
      // Native gradient edits use the source grid expanded to the canvas's inverse
      // bounds. Preserve source resolution, rotation and flips instead of stretching it.
      const result=growStrokeRaster(source,oldTransform,corners,0,mask?maskBackground({width:source.width,height:source.height,data:new Uint8ClampedArray(source.data)}):undefined)
      gradientRaster(result.png,{...layer!,transform:result.transform},action.start,action.end,action.from,action.to,action.radial,stage.selection,action.opacity??1,mask,canvasSize)
      if(mask){store(stage,layer!,result.png,true);if(result.grew)layer!.maskPlacement=result.transform}
      else {
        // BrushCommit also trims the gradient's transparent image bounds; masks
        // keep their entire grid. Carry mask coverage from the original placement.
        const final=trimStrokeRaster(result.png,result.transform),changed=JSON.stringify(final.transform)!==JSON.stringify(oldTransform)
        if(changed&&layer!.maskFile&&!layer!.maskPlacement){
          if(layer!.maskLinked===false)layer!.maskPlacement=oldTransform
          else {const asset=stage.assets.get(layer!.maskFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer mask is missing.');const maskPNG=PNG.sync.read(asset.bytes);store(stage,layer!,carryFilterMask(maskPNG,oldTransform,{...final,grew:true},255),true)}
        }
        store(stage,layer!,final.png,false);layer!.transform=final.transform
      }
      return mask?'Gradient Mask':'Draw gradient'
    }
    case 'layer.mask_set_placement':case 'selection.from_mask':case 'layer.mask_filter':case 'layer.mask_properties':{const label=applyMaskOperation(stage,action);if(action.type==='layer.mask_filter'||action.type==='layer.mask_properties')invalidatePhotoshopComponent(layer!,'mask');return label}
    case 'layer.mask': {
      switch (action.operation) {
        case 'reveal': case 'hide': {
          if(layer!.maskFile)throw new EditorError('INVALID_ARGUMENT','This layer already has a mask. Remove it before adding another mask.')
          const reveal=action.operation==='reveal'
          let png:PNG
          if(stage.selection&&action.useSelection!==false){
            const asset=layer!.imageFile&&stage.assets.get(layer!.imageFile)
            const width=asset?asset.width:Math.max(1,Math.round(layer!.transform.size[0])),height=asset?asset.height:Math.max(1,Math.round(layer!.transform.size[1]))
            if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The selection mask exceeds the source surface budget.')
            png=blankPNG(width,height)
            for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=documentPoint(layer!,x+.5,y+.5,width,height),inside=p[0]>=0&&p[1]>=0&&p[0]<stage.manifest.width&&p[1]<stage.manifest.height?selectionCoverage(stage.selection,...p):0,value=Math.round((reveal?inside:1-inside)*255);png.data.set([value,value,value,255],(y*width+x)*4)}
          }else png=blankPNG(1,1,reveal?255:0)
          store(stage,layer!,png,true);layer!.maskEnabled=true;layer!.maskLinked=true;delete layer!.maskPlacement;delete layer!.photoshopMaskDefault;delete layer!.maskDensity;delete layer!.maskFeather;delete layer!.maskFeatherModel;delete layer!.maskFeatherEdgeMode;stage.selection=null;break
        }
        case 'remove': delete layer!.maskFile; delete layer!.maskEnabled; delete layer!.maskLinked; delete layer!.maskPlacement;delete layer!.photoshopMaskDefault;delete layer!.maskDensity;delete layer!.maskFeather;delete layer!.maskFeatherModel;delete layer!.maskFeatherEdgeMode;invalidatePhotoshopComponent(layer!,'mask'); break
        case 'enable': layer!.maskEnabled = true; break
        case 'disable': layer!.maskEnabled = false; break
        case 'unlink': layer!.maskLinked = false; break
        case 'link': layer!.maskLinked = true; break
        case 'invert': {
          const png = raster(stage,layer!,true)
          for (let i=0;i<png.data.length;i+=4) png.data[i]=png.data[i+1]=png.data[i+2]=255-png.data[i]
          if(typeof layer!.photoshopMaskDefault==='number')layer!.photoshopMaskDefault=255-layer!.photoshopMaskDefault
          store(stage,layer!,png,true); break
        }
      }
      return 'Edit layer mask'
    }
    case 'layer.set_clipping': {
      if (action.sourceId === null) delete layer!.maskSourceID
      else layer!.maskSourceID = action.sourceId
      return 'Set clipping mask'
    }
    case 'document.canvas_size': {
      const w = stage.manifest.width, h = stage.manifest.height
      const x = action.anchor.includes('left') ? 0 : action.anchor.includes('right') ? 1 : .5
      const y = action.anchor.includes('top') ? 0 : action.anchor.includes('bottom') ? 1 : .5
      const dx=(action.width-w)*x,dy=(action.height-h)*y
      transformNamedSelections(stage.manifest,action.width,action.height,(a,b)=>[a-dx,b-dy],!Number.isInteger(dx)||!Number.isInteger(dy))
      shift(stage, (action.width-w)*x,(action.height-h)*y)
      stage.manifest.width=action.width;stage.manifest.height=action.height;return 'Canvas size'
    }
    case 'document.straighten':return applyStraighten(stage,action)
    case 'document.perspective_crop':return applyPerspectiveCrop(stage,action)
    case 'document.crop':
      if(action.deleteCroppedPixels)throw new EditorError('UNSUPPORTED_FEATURE','Deleting cropped pixels is not supported. Crop without deleting pixels to preserve the original layers.')
      transformNamedSelections(stage.manifest,action.width,action.height,(x,y)=>[x+action.x,y+action.y]);shift(stage,-action.x,-action.y);stage.manifest.width=action.width;stage.manifest.height=action.height;return 'Crop canvas'
    case 'document.image_size': {
      if (action.width*action.height>LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT','Resized canvas exceeds the pixel budget.')
      if (action.resample&&(action.width!==stage.manifest.width||action.height!==stage.manifest.height)) {
        const sx=action.width/stage.manifest.width,sy=action.height/stage.manifest.height
        transformVectorFrameMetadata(stage,p=>[p[0]*sx,p[1]*sy])
        if(stage.manifest.documentInfo)stage.manifest.documentInfo=mapDocumentInfoPoints(stage.manifest.documentInfo,p=>[p[0]*sx,p[1]*sy])
        transformNamedSelections(stage.manifest,action.width,action.height,(x,y)=>[x/sx,y/sy],action.sampling!=='Nearest',true)
        const plans=stage.manifest.layers.map(layer=>({layer,oldTransform:structuredClone(layer.transform),placement:imageSizePlacement(layer.transform,sx,sy,action.sampling)}))
        // Reject aggregate target allocations before decoding or baking any PNG.
        // Independent/uniform masks keep their pixels; pure groups allocate none.
        // Count each referenced file once, conservatively taking the largest
        // placement if a caller supplied the same asset to multiple layers.
        const targets=new Map<string,number>()
        for(const {layer,placement} of plans)for(const file of [layer.imageFile,layer.maskFile])if(file){
          const old=stage.assets.get(file);if(!old)throw new EditorError('ASSET_NOT_FOUND','A resized source raster is missing.')
          const preserved=file===layer.maskFile&&((old.width===1&&old.height===1)||!!layer.maskPlacement),width=preserved?old.width:placement.bounds[2],height=preserved?old.height:placement.bounds[3],pixels=width*height
          if(width>LIMITS.maxSide||height>LIMITS.maxSide||pixels>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','A resized raster exceeds the pixel budget.')
          targets.set(file,Math.max(targets.get(file)??0,pixels))
        }
        if([...targets.values()].reduce((total,pixels)=>total+pixels,0)>LIMITS.maxPixels)throw new EditorError('RESOURCE_LIMIT','Resized layers and masks exceed the document pixel budget.')
        if(plans.some(({layer})=>layer.imageFile&&stage.assets.get(layer.imageFile)?.bitDepth===16)){
          const outputBytes=[...targets].reduce((total,[file,pixels])=>total+pixels*(stage.assets.get(file)?.hdr?80:stage.assets.get(file)?.deep?48:20),0)
          const sourceBytes=[...new Set(stage.assets.values())].reduce((total,asset)=>total+countAssetBytes(asset),0)
          if(outputBytes+sourceBytes>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','Resized high-depth layers and masks exceed the working byte budget.')
          assertDeepAssetBudget(stage.assets.values(),outputBytes)
        }

        for (const {layer,oldTransform,placement} of plans) {
          const sampling=action.sampling
          for (const file of [layer.imageFile,layer.maskFile]) if (file) {
            const old=stage.assets.get(file);if(!old)throw new EditorError('ASSET_NOT_FOUND','A resized source raster is missing.')
            if (file===layer.maskFile && ((old.width===1&&old.height===1)||layer.maskPlacement)) continue
            if(file===layer.imageFile&&old.hdr){const resized=bakeHDRImageSizeRaster({width:old.width,height:old.height,hdr:old.hdr},oldTransform,sx,sy,sampling);stage.assets.set(file,makeHDRAsset(file,resized.width,resized.height,resized.hdr));continue}
            if(file===layer.imageFile&&old.deep){const resized=bakeDeepImageSizeRaster({width:old.width,height:old.height,deep:old.deep},oldTransform,sx,sy,sampling);stage.assets.set(file,makeDeepAsset(file,resized.width,resized.height,resized.deep));continue}
            const {png}=bakeImageSizeRaster(PNG.sync.read(old.bytes),oldTransform,sx,sy,sampling,file===layer.maskFile)
            stage.assets.set(file,makeAsset(file,encodeRaster(png,file===layer.maskFile)))
          }
          layer.transform=placement.transform
          const p=layer.maskPlacement as Layer['transform']|undefined
          if(p){const identity={origin:[0,0] as [number,number],size:[1,1] as [number,number],rotation:0,flipX:false,flipY:false,sampling:p.sampling};layer.maskPlacement=followingTransform(p,identity,{...identity,size:[sx,sy]})}
          if(layer.effects)layer.effects=scaleImageSizeEffects(layer.effects,sx,sy)
          delete layer.text;delete layer.shape;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')
        }
        stage.manifest.width=action.width;stage.manifest.height=action.height
        const guides=stage.manifest.guides as {axis:string;position:number}[]|undefined
        if(guides) for(const guide of guides)guide.position*=guide.axis==='vertical'?sx:sy
        stage.selection=null
      }
      stage.manifest.resolution=action.resolution;return 'Image size'
    }
    case 'document.flip': {
      transformVectorFrameMetadata(stage,p=>action.axis==='horizontal'?[stage.manifest.width-p[0],p[1]]:[p[0],stage.manifest.height-p[1]])
      if(stage.manifest.documentInfo)stage.manifest.documentInfo=mapDocumentInfoPoints(stage.manifest.documentInfo,p=>action.axis==='horizontal'?[stage.manifest.width-p[0],p[1]]:[p[0],stage.manifest.height-p[1]])
      transformNamedSelections(stage.manifest,stage.manifest.width,stage.manifest.height,(x,y)=>action.axis==='horizontal'?[stage.manifest.width-x,y]:[x,stage.manifest.height-y])
      for(const layer of stage.manifest.layers)for(const t of [layer.transform,...(layer.maskPlacement?[layer.maskPlacement]:[])]){
        if(action.axis==='horizontal'){t.origin[0]=stage.manifest.width-t.origin[0]-t.size[0];t.flipX=!t.flipX;t.rotation=-t.rotation}
        else{t.origin[1]=stage.manifest.height-t.origin[1]-t.size[1];t.flipY=!t.flipY;t.rotation=-t.rotation}
      }
      for(const guide of stage.manifest.guides??[])if(guide.axis===(action.axis==='horizontal'?'vertical':'horizontal'))guide.position=(action.axis==='horizontal'?stage.manifest.width:stage.manifest.height)-guide.position
      stage.selection=null;return 'Flip canvas'
    }
    case 'document.rotate': {
      const w=stage.manifest.width,h=stage.manifest.height
      transformVectorFrameMetadata(stage,p=>action.clockwise?[h-p[1],p[0]]:[p[1],w-p[0]])
      if(stage.manifest.documentInfo)stage.manifest.documentInfo=mapDocumentInfoPoints(stage.manifest.documentInfo,p=>action.clockwise?[h-p[1],p[0]]:[p[1],w-p[0]])
      transformNamedSelections(stage.manifest,h,w,(x,y)=>action.clockwise?[y,h-x]:[w-y,x])
      for(const layer of stage.manifest.layers)for(const t of [layer.transform,...(layer.maskPlacement?[layer.maskPlacement]:[])]){const cx=t.origin[0]+t.size[0]/2,cy=t.origin[1]+t.size[1]/2
        t.origin=action.clockwise?[h-cy-t.size[0]/2,cx-t.size[1]/2]:[cy-t.size[0]/2,w-cx-t.size[1]/2];t.rotation+=action.clockwise?90:-90
      }
      for(const guide of stage.manifest.guides??[]){const vertical=guide.axis==='vertical';guide.position=action.clockwise?(vertical?guide.position:h-guide.position):(vertical?w-guide.position:guide.position);guide.axis=vertical?'horizontal':'vertical'}
      stage.manifest.width=h;stage.manifest.height=w;stage.selection=null;return 'Rotate canvas'
    }
    case 'document.guides': stage.manifest.guides=structuredClone(action.guides);return 'Edit guides'
  }
}
