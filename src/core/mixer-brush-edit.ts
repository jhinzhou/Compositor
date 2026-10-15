import {PNG} from 'pngjs'
import {EditorError,LIMITS,type Layer,type Transform} from '../shared/contracts'
import {mixBrushStroke,validateMixerBrushStroke,validateMixerBrushReservoir,loadMixerBrushReservoir,type MixerBrushStroke,type MixerBrushReservoir,type MixerBrushPixels,MIXER_BRUSH_LIMITS} from '../shared/mixer-brush'
import {prepareBrushStroke} from '../shared/brush-dynamics'
import {MAX_DEEP_WORKING_BYTES} from '../shared/deep-pixels'
import {deepDisplayPNG} from './deep-assets'
import {hdrDisplayPNG} from './hdr-assets'
import {documentPoint,sourcePoint,selectionCoverage,encodeRaster} from './raster-edit'
import {placedRasterRect} from './stroke-raster'
import {carryFilterMask} from './filter-edit'
import {layerProtected} from './layer-locks'
import {makeAsset,makeDeepAsset,makeHDRAsset} from './project-io'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'
export interface MixerBrushAction extends MixerBrushStroke {type:'layer.mixer_brush';layerId:string;smoothing?:number;reservoir?:MixerBrushReservoir}
export interface MixerBrushPrepared {png:Buffer;width:number;height:number;transform:Transform;target:'image';affectedPixels:number;reservoir:MixerBrushReservoir;deep?:Uint16Array;hdr?:Float32Array;maskPNG?:Buffer}
/** Pure preparation. Reservoir changes are returned to the caller, never stored
 * globally or committed by an async preview. Deep results bypass PNG8 proxies. */
export function prepareMixerBrush(stage:PixelStage,input:MixerBrushAction,options:{signal?:AbortSignal;maximumWork?:number}={}):MixerBrushPrepared {
 validateMixerBrushStroke(input);if(!Number.isFinite(input.smoothing??0)||(input.smoothing??0)<0||(input.smoothing??0)>5000)throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush smoothing.')
 const layer=stage.manifest.layers.find(v=>v.id===input.layerId);if(!layer)throw new EditorError('LAYER_NOT_FOUND','The Mixer Brush layer no longer exists.');if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','Unlock the layer before using Mixer Brush.');if(layer.isGroup||layer.adjustment||layer.text||layer.shape)throw new EditorError('INVALID_ARGUMENT','Choose a raster image layer for Mixer Brush.')
 let asset=layer.imageFile?stage.assets.get(layer.imageFile):undefined;if(layer.imageFile&&!asset)throw new EditorError('ASSET_NOT_FOUND','The Mixer Brush image is missing.');if(options.signal?.aborted)throw new EditorError('CANCELED','Mixer Brush was canceled.')
 if(!asset){const width=Math.max(1,Math.round(layer.transform.size[0])),height=Math.max(1,Math.round(layer.transform.size[1]));if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>MIXER_BRUSH_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','The blank Mixer Brush raster exceeds its 4 MP budget.');asset=makeAsset(`${layer.id.toUpperCase()}.png`,encodeRaster(new PNG({width,height})))}
 const reservoir=input.reservoir?structuredClone(input.reservoir):loadMixerBrushReservoir(input.color,input.load),unchanged=():MixerBrushPrepared=>({png:asset.displayBytes??asset.bytes,width:asset.width,height:asset.height,transform:structuredClone(layer.transform),target:'image',affectedPixels:0,reservoir,...(asset.deep?{deep:asset.deep}:{}),...(asset.hdr?{hdr:asset.hdr}:{})});validateMixerBrushReservoir(reservoir)
 if(!input.opacity||!input.flow)return unchanged()
 const budget=options.maximumWork??MIXER_BRUSH_LIMITS.work;if(!Number.isFinite(budget)||budget<0||budget>MIXER_BRUSH_LIMITS.work)throw new EditorError('INVALID_ARGUMENT','Invalid Mixer Brush compute budget.')
 if(asset.width*asset.height>MIXER_BRUSH_LIMITS.pixels)throw new EditorError('RESOURCE_LIMIT','Mixer Brush exceeds its 4 MP working raster budget.')
 const points=prepareBrushStroke(input.points,input.size,input.smoothing??0).points,original: MixerBrushPixels=asset.hdr??asset.deep??Uint8Array.from(PNG.sync.read(asset.bytes).data),floating=original instanceof Float32Array,integer=original instanceof Uint16Array
 if(asset.bitDepth===16&&!integer&&!floating)throw new EditorError('UNSUPPORTED_FEATURE','Mixer Brush requires the retained high-depth samples; display pixels cannot replace them.')
 if(original.length!==asset.width*asset.height*4)throw new EditorError('INVALID_PROJECT','Mixer Brush image dimensions do not match its retained samples.')
 let left=0,top=0,right=asset.width,bottom=asset.height
 if(!input.protectAlpha){const rx=(input.size/2+2)*asset.width/layer.transform.size[0],ry=(input.size/2+2)*asset.height/layer.transform.size[1];for(const point of points){const [x,y]=sourcePoint(layer,...point,asset.width,asset.height);left=Math.min(left,Math.floor(x-rx));top=Math.min(top,Math.floor(y-ry));right=Math.max(right,Math.ceil(x+rx));bottom=Math.max(bottom,Math.ceil(y+ry))}}
 const width=right-left,height=bottom-top,count=width*height,maskAsset=layer.maskFile&&stage.assets.get(layer.maskFile),estimatedBytes=original.byteLength*2+count*64+asset.bytes.length+(asset.displayBytes?.length??0)+(maskAsset?maskAsset.bytes.length+maskAsset.width*maskAsset.height*12:0)
 if(width>LIMITS.maxSide||height>LIMITS.maxSide||count>MIXER_BRUSH_LIMITS.pixels||estimatedBytes>MAX_DEEP_WORKING_BYTES)throw new EditorError('RESOURCE_LIMIT','Mixer Brush exceeds its raster or 512 MiB working budget.')
 if(count*(stage.selection?2:1)>budget)throw new EditorError('RESOURCE_LIMIT','Mixer Brush exceeds its stroke compute budget.')
 const transform=left||top||width!==asset.width||height!==asset.height?placedRasterRect(layer.transform,asset.width,asset.height,left,top,width,height):structuredClone(layer.transform),expanded=floating?new Float32Array(count*4):integer?new Uint16Array(count*4):new Uint8Array(count*4)
 for(let y=0;y<asset.height;y++){if(options.signal?.aborted)throw new EditorError('CANCELED','Mixer Brush was canceled.');expanded.set(original.subarray(y*asset.width*4,(y+1)*asset.width*4),((y-top)*width-left)*4)}
 const coverage=stage.selection?new Uint8Array(count):undefined
 if(coverage)for(let y=0;y<height;y++){if(options.signal?.aborted)throw new EditorError('CANCELED','Mixer Brush was canceled.');for(let x=0;x<width;x++){const point=documentPoint({transform} as Layer,x+.5,y+.5,width,height);coverage[y*width+x]=Math.round(selectionCoverage(stage.selection,...point)*255)}}
 const result=mixBrushStroke(expanded,{width,height,transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},{...input,points},reservoir,{...options,maximumWork:budget-count-(coverage?count:0),selectionCoverage:coverage})
 if(!result.affectedPixels)return {...unchanged(),reservoir:result.reservoir}
 const pixels=result.pixels,png=floating?hdrDisplayPNG(width,height,pixels as Float32Array):integer?deepDisplayPNG(width,height,pixels as Uint16Array):encodeRaster(Object.assign(new PNG({width,height}),{data:Buffer.from(pixels)}))
 let maskPNG:Buffer|undefined;if(layer.maskFile&&layer.maskLinked!==false&&!layer.maskPlacement&&(left||top||width!==asset.width||height!==asset.height)){if(!maskAsset)throw new EditorError('ASSET_NOT_FOUND','The linked Mixer Brush mask is missing.');maskPNG=encodeRaster(carryFilterMask(PNG.sync.read(maskAsset.bytes),layer.transform,{png:{width,height} as PNG,transform,grew:true},255),true)}
 return {png,width,height,transform,target:'image',affectedPixels:result.affectedPixels,reservoir:result.reservoir,...(floating?{hdr:pixels as Float32Array}:integer?{deep:pixels as Uint16Array}:{}),...(maskPNG?{maskPNG}:{})}
}
export function applyMixerBrushOperation(stage:PixelStage,action:MixerBrushAction,onPrepared?:(prepared:MixerBrushPrepared)=>void):string {
 const result=prepareMixerBrush(stage,action),layer=stage.manifest.layers.find(v=>v.id===action.layerId)!
 if(result.affectedPixels){const file=`${layer.id.toUpperCase()}.${result.hdr?'exr':'png'}`,asset=result.hdr?makeHDRAsset(file,result.width,result.height,result.hdr):result.deep?makeDeepAsset(file,result.width,result.height,result.deep):makeAsset(file,result.png);stage.assets.set(file,asset);layer.imageFile=file;layer.transform=result.transform;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector');if(result.maskPNG&&layer.maskFile)stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,result.maskPNG))}
 onPrepared?.(result);return 'Mixer Brush'
}
