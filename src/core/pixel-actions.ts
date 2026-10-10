import {compactStroke} from '../shared/stroke-compaction'
import {scaleImageSizeEffects} from './image-size-effects'
import {bakeImageSizeRaster,imageSizePlacement} from './image-size-raster'
import {followingTransform} from '../shared/mask-placement'
import {morphDocumentSelection} from '../shared/selection-morphology'
import {sampleLayerInDocument} from './document-sampler'
import {invalidateSelectionCoverage} from '../shared/selection-coverage'
import {textStyleSchema} from '../shared/content-style'
import {copyLayerComponent} from './layer-component-copy'
import {growStrokeRaster,trimStrokeRaster} from './stroke-raster'
import {maskBackground} from '../shared/mask-pixels'
import {applyRetouchOperation} from './retouch-edit'
import {transformSelectedPixels} from './selection-transform'
import {applyMaskOperation} from './mask-operations'
import {filterRaster,carryFilterMask} from './filter-edit'
import {smoothStroke,translateSelection} from '../shared/interaction-geometry'
import {appendSelectionShape} from '../shared/selection-composition'
import {distortRaster,validateWarpCorners} from './distort-raster'
import {randomUUID} from 'node:crypto'
import {specToNativeAdjustment} from '../shared/image-filters'
import {documentPoint,selectionCoverage} from './raster-edit'
import {magicWandSelection,colorRangeSelection,selectionFromAlpha,type RasterSelection,type RGBAImage} from './selection-retouch'
import { PNG } from 'pngjs'
import { EditorError, LIMITS, type EditAction, type Layer, type Manifest } from '../shared/contracts'
import type { Selection } from '../shared/pixel-contracts'
import { makeAsset, type Asset } from './project-io'
import { blankPNG, encodeRaster, fillRaster, gradientRaster, paintRaster } from './raster-edit'

export interface PixelStage { manifest: Manifest; assets: Map<string, Asset>; selection: Selection | null }
function raster(stage: PixelStage, layer: Layer, mask: boolean): PNG {
  const file = mask ? layer.maskFile : layer.imageFile
  if (file) {
    const asset = stage.assets.get(file)
    if (!asset) throw new EditorError('ASSET_NOT_FOUND', 'The layer raster is missing.')
    const png = PNG.sync.read(asset.bytes)
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
  if (mask) layer.maskFile = file
  else { layer.imageFile = file; delete layer.text; delete layer.shape }
}
function matchesPlacement(a:Layer['transform'],b:Layer['transform']):boolean{return a.rotation===b.rotation&&a.flipX===b.flipX&&a.flipY===b.flipY&&a.origin.every((v,i)=>v===b.origin[i])&&a.size.every((v,i)=>v===b.size[i])}
function shift(stage: PixelStage, x: number, y: number): void {
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
export function applySelectionRaster(stage:PixelStage,action:Extract<EditAction,{type:'selection.wand'|'selection.color_range'}>,image:RGBAImage):string{
 if(image.width!==stage.manifest.width||image.height!==stage.manifest.height||image.data.length!==image.width*image.height*4)throw new EditorError('INVALID_ARGUMENT','The selection sample must match the document dimensions.')
 const mask=action.type==='selection.wand'?magicWandSelection(image,action.point,{tolerance:action.tolerance,contiguous:action.contiguous,sampleSize:action.sampleSize}):colorRangeSelection(image,action.colors,action.tolerance,action.softness,true,{excludeColors:action.excludeColors,invert:action.invert})
 const transform:Layer['transform']={origin:[0,0],size:[image.width,image.height],rotation:0,flipX:false,flipY:false,sampling:'Nearest'}
 stage.selection=appendSelectionShape(stage.selection,coverageShape(mask,transform,action.operation),image.width,image.height)
 stage.selection.antialiased=action.antialiased;stage.selection.canvasSize=[image.width,image.height]
 return action.type==='selection.wand'?'Magic Wand':'Color Range'
}
export function applyPixelAction(stage: PixelStage, action: EditAction): string | undefined {
  const layer = 'layerId' in action ? stage.manifest.layers.find(layer => layer.id === action.layerId)! : undefined
  switch (action.type) {
    case 'layer.copy_mask':case 'layer.copy_effect':return copyLayerComponent(stage,action)
    case 'document.trim':case 'layer.text':case 'layer.shape':case 'selection.subject':case 'layer.content_fill':throw new EditorError('ASYNC_OPERATION_REQUIRED','Use a single document.apply for this image operation; it cannot run inside a batch.')
    case 'selection.transform_pixels':return transformSelectedPixels(stage,layer!,action.transform,action.corners)
    case 'selection.translate':if(stage.selection)stage.selection=translateSelection(stage.selection,action.delta);return 'Move selection'
    case 'layer.clear_selected': {const mask=action.target==='mask',png=raster(stage,layer!,mask),placement=mask&&layer!.maskPlacement?{...layer!,transform:layer!.maskPlacement}:layer!;for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const p=documentPoint(placement,x+.5,y+.5,png.width,png.height),amount=selectionCoverage(stage.selection,...p),at=(y*png.width+x)*4;if(mask)png.data[at]=png.data[at+1]=png.data[at+2]=Math.round(png.data[at]*(1-amount));else png.data[at+3]=Math.round(png.data[at+3]*(1-amount))}store(stage,layer!,png,mask);return 'Clear selected pixels'}
    case 'layer.effects':if(layer!.isGroup||layer!.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a raster layer for effects.');else{if(action.effects)layer!.effects=structuredClone(action.effects);else delete layer!.effects;return 'Edit layer effects'}
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
    case 'selection.wand':case 'selection.color_range':{
      if(action.sampleAllLayers)throw new EditorError('ASYNC_OPERATION_REQUIRED','Sample All Layers requires a revision-matched document composite.')
      const png=layer!.imageFile?raster(stage,layer!,false):null,sample=sampleLayerInDocument(png,layer!.transform,stage.manifest.width,stage.manifest.height)
      return applySelectionRaster(stage,action,sample)
    }
    case 'selection.from_alpha':{
      const png=raster(stage,layer!,false),mask=selectionFromAlpha(png)
      stage.selection=appendSelectionShape(stage.selection,coverageShape(mask,layer!.transform),stage.manifest.width,stage.manifest.height);return 'Select pixels'
    }
    case 'layer.retouch':return applyRetouchOperation(stage,action)
    case 'layer.filter':{
      const png=raster(stage,layer!,false),oldTransform=structuredClone(layer!.transform),result=filterRaster(png,oldTransform,stage.selection,action.filter)
      if(result.grew&&layer!.maskFile&&layer!.maskLinked!==false&&!layer!.maskPlacement){const asset=stage.assets.get(layer!.maskFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The layer mask is missing.');const mask=PNG.sync.read(asset.bytes);if(mask.width>1||mask.height>1)store(stage,layer!,carryFilterMask(mask,oldTransform,result),true)}
      store(stage,layer!,result.png,false);layer!.transform=result.transform;return 'Apply filter'
    }
    case 'adjustment.add':{
      const id=randomUUID().toUpperCase();stage.manifest.layers.push({id,name:action.name,isGroup:false,isVisible:true,opacity:1,blendMode:'Normal',adjustment:specToNativeAdjustment(action.filter),transform:{origin:[0,0],size:[stage.manifest.width,stage.manifest.height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}});stage.manifest.activeLayerID=id;return 'Add adjustment layer'
    }
    case 'adjustment.set':if(!layer!.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose an adjustment layer.');else{layer!.adjustment=specToNativeAdjustment(action.filter);return 'Edit adjustment layer'}

    case 'selection.set': stage.selection = structuredClone(action.selection); return 'Set selection'
    case 'selection.invert': stage.selection = stage.selection ? { ...stage.selection, inverted: !stage.selection.inverted } : {shapes: [], inverted: true}; return 'Invert selection'
    case 'selection.modify': {
      if (!stage.selection) return 'Modify selection'
      if(action.operation==='feather')stage.selection={...stage.selection,feather:Math.min(250,Math.hypot(stage.selection.feather??0,action.amount)),canvasSize:[stage.manifest.width,stage.manifest.height]}
      else stage.selection=morphDocumentSelection(stage.selection,stage.manifest.width,stage.manifest.height,action.operation,action.amount)
      return 'Modify selection'
    }
    case 'layer.paint': {
      const mask=action.target==='mask',original=raster(stage,layer!,mask),oldTransform=structuredClone(mask?layer!.maskPlacement??layer!.transform:layer!.transform),points=smoothStroke(compactStroke(action.points,Math.min(.125,action.size*.005)),action.smoothing??0)
      const result=action.erase&&!mask?{png:original,transform:oldTransform,grew:false}:growStrokeRaster(original,oldTransform,points,action.size,mask?maskBackground({width:original.width,height:original.height,data:new Uint8ClampedArray(original.data)}):undefined)
      paintRaster(result.png,{...layer!,transform:result.transform},points,action.color,action.size,action.hardness,action.opacity,action.erase,stage.selection,mask,[stage.manifest.width,stage.manifest.height])
      const final=mask?result:trimStrokeRaster(result.png,result.transform)
      if(mask){store(stage,layer!,final.png,true);if(result.grew)layer!.maskPlacement=final.transform}
      else {if(layer!.maskFile&&!layer!.maskPlacement&&(JSON.stringify(final.transform)!==JSON.stringify(layer!.transform))){const asset=stage.assets.get(layer!.maskFile)!,maskPNG=PNG.sync.read(asset.bytes);if(maskPNG.width>1||maskPNG.height>1)store(stage,layer!,carryFilterMask(maskPNG,layer!.transform,{...final,grew:true}),true)}store(stage,layer!,final.png,false);layer!.transform=final.transform}
      return action.erase?'Erase pixels':mask?'Paint mask':'Paint pixels'
    }
    case 'layer.fill': {
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
    case 'layer.mask_set_placement':case 'selection.from_mask':case 'layer.mask_filter':return applyMaskOperation(stage,action)
    case 'layer.mask': {
      switch (action.operation) {
        case 'reveal': case 'hide': {
          if(layer!.maskFile)throw new EditorError('INVALID_ARGUMENT','This layer already has a mask. Remove it before adding another mask.')
          const reveal=action.operation==='reveal'
          let png:PNG
          if(stage.selection){
            const asset=layer!.imageFile&&stage.assets.get(layer!.imageFile)
            const width=asset?asset.width:Math.max(1,Math.round(layer!.transform.size[0])),height=asset?asset.height:Math.max(1,Math.round(layer!.transform.size[1]))
            if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The selection mask exceeds the source surface budget.')
            png=blankPNG(width,height)
            for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=documentPoint(layer!,x+.5,y+.5,width,height),inside=p[0]>=0&&p[1]>=0&&p[0]<stage.manifest.width&&p[1]<stage.manifest.height?selectionCoverage(stage.selection,...p):0,value=Math.round((reveal?inside:1-inside)*255);png.data.set([value,value,value,255],(y*width+x)*4)}
          }else png=blankPNG(1,1,reveal?255:0)
          store(stage,layer!,png,true);layer!.maskEnabled=true;layer!.maskLinked=true;delete layer!.maskPlacement;stage.selection=null;break
        }
        case 'remove': delete layer!.maskFile; delete layer!.maskEnabled; delete layer!.maskLinked; delete layer!.maskPlacement; break
        case 'enable': layer!.maskEnabled = true; break
        case 'disable': layer!.maskEnabled = false; break
        case 'unlink': layer!.maskLinked = false; break
        case 'link': layer!.maskLinked = true; break
        case 'invert': {
          const png = raster(stage,layer!,true)
          for (let i=0;i<png.data.length;i+=4) png.data[i]=png.data[i+1]=png.data[i+2]=255-png.data[i]
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
      shift(stage, (action.width-w)*x,(action.height-h)*y)
      stage.manifest.width=action.width;stage.manifest.height=action.height;return 'Canvas size'
    }
    case 'document.crop': shift(stage,-action.x,-action.y);stage.manifest.width=action.width;stage.manifest.height=action.height;return 'Crop canvas'
    case 'document.image_size': {
      if (action.width*action.height>LIMITS.maxSurfacePixels) throw new EditorError('RESOURCE_LIMIT','Resized canvas exceeds the pixel budget.')
      if (action.resample&&(action.width!==stage.manifest.width||action.height!==stage.manifest.height)) {
        const sx=action.width/stage.manifest.width,sy=action.height/stage.manifest.height
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
        for (const {layer,oldTransform,placement} of plans) {
          const sampling=action.sampling
          for (const file of [layer.imageFile,layer.maskFile]) if (file) {
            const old=stage.assets.get(file);if(!old)throw new EditorError('ASSET_NOT_FOUND','A resized source raster is missing.')
            if (file===layer.maskFile && ((old.width===1&&old.height===1)||layer.maskPlacement)) continue
            const {png}=bakeImageSizeRaster(PNG.sync.read(old.bytes),oldTransform,sx,sy,sampling,file===layer.maskFile)
            stage.assets.set(file,makeAsset(file,encodeRaster(png,file===layer.maskFile)))
          }
          layer.transform=placement.transform
          const p=layer.maskPlacement as Layer['transform']|undefined
          if(p){const identity={origin:[0,0] as [number,number],size:[1,1] as [number,number],rotation:0,flipX:false,flipY:false,sampling:p.sampling};layer.maskPlacement=followingTransform(p,identity,{...identity,size:[sx,sy]})}
          if(layer.effects)layer.effects=scaleImageSizeEffects(layer.effects,sx,sy)
          delete layer.text;delete layer.shape
        }
        stage.manifest.width=action.width;stage.manifest.height=action.height
        const guides=stage.manifest.guides as {axis:string;position:number}[]|undefined
        if(guides) for(const guide of guides)guide.position*=guide.axis==='vertical'?sx:sy
        stage.selection=null
      }
      stage.manifest.resolution=action.resolution;return 'Image size'
    }
    case 'document.flip': {
      for(const layer of stage.manifest.layers)for(const t of [layer.transform,...(layer.maskPlacement?[layer.maskPlacement]:[])]){
        if(action.axis==='horizontal'){t.origin[0]=stage.manifest.width-t.origin[0]-t.size[0];t.flipX=!t.flipX;t.rotation=-t.rotation}
        else{t.origin[1]=stage.manifest.height-t.origin[1]-t.size[1];t.flipY=!t.flipY;t.rotation=-t.rotation}
      }
      for(const guide of stage.manifest.guides??[])if(guide.axis===(action.axis==='horizontal'?'vertical':'horizontal'))guide.position=(action.axis==='horizontal'?stage.manifest.width:stage.manifest.height)-guide.position
      stage.selection=null;return 'Flip canvas'
    }
    case 'document.rotate': {
      const w=stage.manifest.width,h=stage.manifest.height
      for(const layer of stage.manifest.layers)for(const t of [layer.transform,...(layer.maskPlacement?[layer.maskPlacement]:[])]){const cx=t.origin[0]+t.size[0]/2,cy=t.origin[1]+t.size[1]/2
        t.origin=action.clockwise?[h-cy-t.size[0]/2,cx-t.size[1]/2]:[cy-t.size[0]/2,w-cx-t.size[1]/2];t.rotation+=action.clockwise?90:-90
      }
      for(const guide of stage.manifest.guides??[]){const vertical=guide.axis==='vertical';guide.position=action.clockwise?(vertical?guide.position:h-guide.position):(vertical?w-guide.position:guide.position);guide.axis=vertical?'horizontal':'vertical'}
      stage.manifest.width=h;stage.manifest.height=w;stage.selection=null;return 'Rotate canvas'
    }
    case 'document.guides': stage.manifest.guides=structuredClone(action.guides);return 'Edit guides'
  }
}
