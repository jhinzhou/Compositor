import {compactStroke} from '../shared/stroke-compaction'
import {PNG} from 'pngjs'
import {growStrokeRaster,trimStrokeRaster} from './stroke-raster'
import {smoothStroke} from '../shared/interaction-geometry'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {EditorError,LIMITS,type EditAction,type Layer,type Transform} from '../shared/contracts'
import {applyImageFilter} from '../shared/image-filters'
import {blurMaskPixels} from '../shared/mask-pixels'
import {healPremultiplied} from '../shared/native-heal'
import {warpPremultiplied} from '../shared/native-warp'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {carryFilterMask} from './filter-edit'
import {makeAsset} from './project-io'
import {retouchRaster,type RGBAImage} from './selection-retouch'
import type {PixelStage} from './pixel-actions'
export type RetouchAction=Extract<EditAction,{type:'layer.retouch'}>
export interface RetouchPrepared {png:Buffer;transform:Transform;target:'image'|'mask';maskPNG?:Buffer}
const round=(v:number)=>v<0?-Math.round(-v):Math.round(v)
function checked(width:number,height:number):void{if(width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','The retouch working raster exceeds its pixel budget.')}
function premul(image:RGBAImage):Uint8Array{const data=new Uint8Array(image.data);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)data[i+c]=Math.round(data[i+c]*data[i+3]/255);return data}
function unpremul(data:Uint8Array):Buffer{const output=Buffer.from(data);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)output[i+c]=data[i+3]?Math.min(255,Math.round(data[i+c]*255/data[i+3])):0;return output}
function sample(data:Uint8Array,width:number,height:number,x:number,y:number,background?:number):number[]{const x0=Math.floor(x-.5),y0=Math.floor(y-.5),fx=x-.5-x0,fy=y-.5-y0,result=[0,0,0,0];for(let row=0;row<2;row++)for(let column=0;column<2;column++){const sx=x0+column,sy=y0+row,weight=(column?fx:1-fx)*(row?fy:1-fy);for(let c=0;c<4;c++)result[c]+=(sx<0||sy<0||sx>=width||sy>=height?background===undefined?0:c===3?255:background:data[(sy*width+sx)*4+c])*weight}return result}
/** Pure preparation shared by sync actions and the revision-checked all-layer composite path. */
export function prepareRetouch(stage:PixelStage,input:RetouchAction,composite?:RGBAImage):RetouchPrepared {
 const action={...input,points:smoothStroke(compactStroke(input.points,Math.min(.125,input.size*.005)),input.smoothing??0)}
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The retouch layer no longer exists.')
 const target=action.target??'image',mask=target==='mask'
 if(mask&&action.kind!=='blur')throw new EditorError('INVALID_ARGUMENT','Clone, healing, smudge and liquify work on image pixels; choose Blur to edit a mask.')
 if(!mask&&(layer.isGroup||layer.adjustment))throw new EditorError('INVALID_ARGUMENT','Choose an image layer to retouch.')
 const file=mask?layer.maskFile:layer.imageFile,asset=file&&stage.assets.get(file)
 if(!asset)throw new EditorError('ASSET_NOT_FOUND',mask?'Add a raster mask before blurring it.':'The retouch image is missing.')
 const original=PNG.sync.read(asset.bytes),oldTransform=structuredClone(mask?layer.maskPlacement??layer.transform:layer.transform)
 let transform=structuredClone(oldTransform);let png:PNG=original
 if(action.kind==='smear'&&action.points.length<2)return {png:asset.bytes,transform,target}
 if(mask&&original.width===1&&original.height===1)return {png:asset.bytes,transform,target}
 if(action.sourceMode==='all-layers'&&action.kind!=='clone')throw new EditorError('INVALID_ARGUMENT','Sample All Layers is available for Clone Stamp.')
 if(action.sourceMode==='all-layers'&&(!composite||composite.width!==stage.manifest.width||composite.height!==stage.manifest.height||composite.data.length!==composite.width*composite.height*4))throw new EditorError('ASYNC_OPERATION_REQUIRED','Sample All Layers requires a revision-matched canvas composite.')
 const first=action.points[0],offset: [number,number]=action.aligned!==false&&action.sourceOffset? [round(action.sourceOffset[0]),round(action.sourceOffset[1])]:action.sourceAnchor?[round(action.sourceAnchor[0]-first[0]),round(action.sourceAnchor[1]-first[1])]:[0,0]
 if(['clone','heal'].includes(action.kind)&&!action.sourceAnchor&&!action.sourceOffset)throw new EditorError('INVALID_ARGUMENT','Alt-click a source point before cloning or healing.')
 // A retouch tip can paint outside the old image, at the image's original pixel resolution.
 if(!mask&&['clone','blur','heal','smear'].includes(action.kind)&&!action.protectAlpha){const grown=growStrokeRaster(original,oldTransform,action.points,action.size+2);png=grown.png;transform=grown.transform}
 checked(png.width,png.height)
 const coverage=brushStrokeCoverage({width:png.width,height:png.height,transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},action.points,action.size,action.hardness)
 if(stage.selection)for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const doc=documentPoint({transform} as Layer,x+.5,y+.5,png.width,png.height),p=y*png.width+x;coverage[p]=Math.round(coverage[p]*selectionCoverage(stage.selection,...doc))}
 const base=premul(png),output=new Uint8Array(base)
 if(action.kind==='spot-heal')output.set(healPremultiplied(base,coverage,png.width,png.height,action.opacity,action.healingMode??'content-aware',action.seed??0))
 else if(action.kind==='smear'){
  // Native Smudge/Liquify work on a document-sized copy; the final result returns to the layer's grid.
  const {width,height}=stage.manifest;checked(width,height);const working=new Uint8Array(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const source=sourcePoint({transform},x+.5,y+.5,png.width,png.height);working.set(sample(base,png.width,png.height,...source).map(Math.round),(y*width+x)*4)}
  const warped=warpPremultiplied({width,height,data:working},{mode:action.smearMode??'smudge',points:action.points,size:action.size,hardness:action.hardness,strength:action.opacity})
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const doc=documentPoint({transform} as Layer,x+.5,y+.5,png.width,png.height),p=y*png.width+x;if(!coverage[p])continue;const color=sample(warped,width,height,...doc),amount=selectionCoverage(stage.selection,...doc);for(let c=0;c<4;c++)output[p*4+c]=Math.round(base[p*4+c]+(color[c]-base[p*4+c])*amount)}
 }else if(action.kind==='heal'){
  // The optional sampled Healing Brush remains available in addition to native Spot Healing modes.
  const points=action.points.map(p=>sourcePoint({transform},...p,png.width,png.height)),anchor=sourcePoint({transform},first[0]+offset[0],first[1]+offset[1],png.width,png.height),result=retouchRaster(png,{...action,points,sourceAnchor:anchor,size:action.size*Math.sqrt(png.width*png.height/(transform.size[0]*transform.size[1])),selection:{width:png.width,height:png.height,coverage}});output.set(premul(result))
 }else {
  let sampleImage:RGBAImage,sampleBytes:Uint8Array
  if(action.kind==='blur'){const scale=Math.sqrt(png.width*png.height/(transform.size[0]*transform.size[1])),sigma=Math.min((action.blurRadius??5)*scale,Math.max(png.width,png.height)/2);const softened=mask?blurMaskPixels({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},Math.min(250,sigma),sigma/Math.min(250,sigma)):applyImageFilter({width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)},{kind:'gaussianBlur',radius:Math.min(250,sigma)},undefined,sigma/Math.min(250,sigma));sampleImage={...softened,data:Uint8Array.from(softened.data)};sampleBytes=premul(sampleImage)}else{sampleImage=composite??original;sampleBytes=premul(sampleImage)}
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const p=y*png.width+x,at=p*4,amount=coverage[p]/255*action.opacity;if(!amount)continue;let color:number[]
   if(action.kind==='blur')color=[...sampleBytes.subarray(at,at+4)]
   else{const doc=documentPoint({transform} as Layer,x+.5,y+.5,png.width,png.height),sourceDoc:[number,number]=[doc[0]+offset[0],doc[1]+offset[1]],point=composite?sourceDoc:sourcePoint({transform:oldTransform},...sourceDoc,original.width,original.height);color=sample(sampleBytes,sampleImage.width,sampleImage.height,...point)}
   if(mask){const value=Math.round(png.data[at]+(color[0]-png.data[at])*amount);output.set([value,value,value,255],at)}else{const sa=color[3]/255*amount;if(action.protectAlpha){if(!base[at+3])continue;for(let c=0;c<3;c++)output[at+c]=Math.round(base[at+c]*(1-sa)+(color[3]?color[c]*base[at+3]/color[3]:0)*sa)}else{for(let c=0;c<3;c++)output[at+c]=Math.round(color[c]*amount+base[at+c]*(1-sa));output[at+3]=Math.round(color[3]*amount+base[at+3]*(1-sa))}}
  }
 }
 png.data=unpremul(output)
 if(!mask){const trimmed=trimStrokeRaster(png,transform);png=trimmed.png;transform=trimmed.transform}
 let maskPNG:Buffer|undefined
 if(!mask&&layer.maskFile&&layer.maskLinked!==false&&!layer.maskPlacement&&(png.width!==original.width||png.height!==original.height||transform.origin[0]!==oldTransform.origin[0]||transform.origin[1]!==oldTransform.origin[1])){const maskAsset=stage.assets.get(layer.maskFile);if(!maskAsset)throw new EditorError('ASSET_NOT_FOUND','The linked mask is missing.');const carried=carryFilterMask(PNG.sync.read(maskAsset.bytes),oldTransform,{png,transform,grew:true});maskPNG=encodeRaster(carried,true)}
 return {png:encodeRaster(png,mask),transform,target,...(maskPNG?{maskPNG}:{})}
}
export function applyRetouchOperation(stage:PixelStage,action:RetouchAction):string {
 const result=prepareRetouch(stage,action),layer=stage.manifest.layers.find(item=>item.id===action.layerId)!,file=`${layer.id.toUpperCase()}${result.target==='mask'?'.mask':''}.png`;stage.assets.set(file,makeAsset(file,result.png))
 if(result.target==='mask')layer.maskFile=file
 else{layer.imageFile=file;layer.transform=result.transform;delete layer.text;delete layer.shape;if(result.maskPNG&&layer.maskFile)stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,result.maskPNG))}
 return action.kind==='smear'?(action.smearMode==='liquify'?'Liquify':'Smudge'):action.kind==='blur'?'Blur':action.kind==='clone'?'Clone stamp':action.kind==='spot-heal'?'Spot healing':'Healing brush'
}
