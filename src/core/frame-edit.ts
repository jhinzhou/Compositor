import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {EditorError,LIMITS,transformSchema,type Layer,type Manifest,type Transform} from '../shared/contracts'
import {frameImagePlacement,validateFrame,type FrameMetadata} from '../shared/frame'
import type {Selection} from '../shared/pixel-contracts'
import {encodeRaster} from './raster-edit'
import {makeAsset,type Asset} from './project-io'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
export type FrameAction=
 |{type:'frame.create';name:string;kind:FrameMetadata['kind'];bounds:FrameMetadata['bounds'];id?:string}
 |{type:'frame.place';layerId:string;sourceId:string;fit?:'cover'|'contain'}
 |{type:'frame.set_bounds';layerId:string;bounds:FrameMetadata['bounds'];kind?:FrameMetadata['kind']}
 |{type:'frame.set_content_transform';layerId:string;transform:Transform}
type Stage={manifest:Manifest;assets:Map<string,Asset>;selection:Selection|null}
function frameMask(id:string,metadata:FrameMetadata):Asset {
 const frame=validateFrame(metadata),width=Math.max(2,Math.ceil(frame.bounds[2])),height=Math.max(2,Math.ceil(frame.bounds[3])),pixels=width*height
 if(pixels*24>512*1024*1024||frame.kind==='ellipse'&&pixels*4>80_000_000)throw new EditorError('RESOURCE_LIMIT','Frame clip mask exceeds the working budget.')
 const png=new PNG({width,height})
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let coverage=255
  if(frame.kind==='ellipse'){let inside=0;for(const sy of [.25,.75])for(const sx of [.25,.75])if(((x+sx)/width*2-1)**2+((y+sy)/height*2-1)**2<=1)inside++;coverage=Math.round(inside*255/4)}
  png.data.set([coverage,coverage,coverage,255],(y*width+x)*4)
 }
 return makeAsset(`${id.toUpperCase()}.mask.png`,encodeRaster(png,true))
}
function installFrameMask(layer:Layer,frame:FrameMetadata,asset:Asset):void {
 layer.frame=frame;layer.maskFile=asset.file;layer.maskEnabled=true;layer.maskLinked=false;layer.maskDensity=1;layer.maskFeather=0;layer.photoshopMaskDefault=0
 layer.maskPlacement={origin:[frame.bounds[0],frame.bounds[1]],size:[frame.bounds[2],frame.bounds[3]],rotation:0,flipX:false,flipY:false,sampling:'Smooth'}
 delete layer.vectorMask;invalidatePhotoshopComponent(layer,'mask')
}
/** Persistent frame metadata plus the existing independent raster clip mask
 * means save/render/undo retain both clip boundary and the whole source image. */
export function applyFrameOperation(stage:Stage,action:FrameAction):{label:string;createdLayerId?:string} {
 if(action.type==='frame.create'){
  if(stage.manifest.layers.length>=LIMITS.maxLayers)throw new EditorError('RESOURCE_LIMIT','The document layer limit was reached.')
  if(!action.name.trim()||action.name.length>4096)throw new EditorError('INVALID_ARGUMENT','Frame requires a name.')
  const frame=validateFrame({kind:action.kind,bounds:action.bounds}),id=action.id??randomUUID().toUpperCase()
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new EditorError('INVALID_ARGUMENT','Frame requires a valid layer identity.')
  if(stage.manifest.layers.some(layer=>layer.id===id))throw new EditorError('INVALID_ARGUMENT','Frame layer identity is already in use.')
  const mask=frameMask(id,frame),layer:Layer={id,name:action.name,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[frame.bounds[0],frame.bounds[1]],size:[frame.bounds[2],frame.bounds[3]],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}
  installFrameMask(layer,frame,mask);stage.assets.set(mask.file,mask);stage.manifest.layers.push(layer);stage.manifest.activeLayerID=id;return {label:'Create frame',createdLayerId:id}
 }
 const layer=stage.manifest.layers.find(layer=>layer.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The frame layer is unavailable.')
 if(layerProtected(stage.manifest,layer.id,true))throw new EditorError('INVALID_ARGUMENT','The frame layer is locked. Unlock it before editing.')
 if(!layer.frame)throw new EditorError('INVALID_ARGUMENT','Choose a frame layer.')
 const frame=validateFrame(layer.frame)
 if(action.type==='frame.set_bounds'){
  const metadata=validateFrame({kind:action.kind??frame.kind,bounds:action.bounds}),mask=frameMask(layer.id,metadata)
  installFrameMask(layer,metadata,mask);stage.assets.set(mask.file,mask);return {label:'Resize frame boundary'}
 }
 if(action.type==='frame.set_content_transform'){
  if(!layer.imageFile)throw new EditorError('INVALID_ARGUMENT','Place an image in the frame before transforming its content.')
  const transform=transformSchema.parse(action.transform);layer.transform=transform;return {label:'Transform frame content'}
 }
 if(action.sourceId===layer.id)throw new EditorError('INVALID_ARGUMENT','Choose another image layer to place in this frame.')
 const donor=stage.manifest.layers.find(item=>item.id===action.sourceId),asset=donor?.imageFile?stage.assets.get(donor.imageFile):undefined
 if(!donor||!asset)throw new EditorError('ASSET_NOT_FOUND','Choose an image layer to place in the frame.')
 if(donor.isGroup||donor.adjustment||donor.text||donor.shape)throw new EditorError('RASTERIZATION_REQUIRED','Frame content must be a raster image layer.')
 const current=layer.imageFile?stage.assets.get(layer.imageFile):undefined
 if(current?.hdr&&!asset.hdr||current?.deep&&!asset.deep&&!asset.hdr)throw new EditorError('UNSUPPORTED_FEATURE','Replacing frame content cannot reduce its existing pixel precision.')
 const transform=frameImagePlacement(frame,asset.width,asset.height,action.fit??'cover'),file=`${layer.id.toUpperCase()}.${asset.hdr?'exr':'png'}`,replacement={...asset,file}
 // Preserve precision and source buffers. A named source layer can continue to
 // own the same immutable version without subsequent frame edits mutating it.
 stage.assets.set(file,replacement);layer.imageFile=file;layer.transform=transform;return {label:'Place frame image'}
}
