import {PNG} from 'pngjs'
import {EditorError,type EditAction} from '../shared/contracts'
import {tonalBrushPixels} from '../shared/tonal-brush'
import {brushStrokeCoverage} from '../shared/brush-coverage'
import {prepareBrushStroke} from '../shared/brush-dynamics'
import {documentPoint,selectionCoverage,encodeRaster} from './raster-edit'
import {makeAsset,makeDeepAsset,makeHDRAsset} from './project-io'
import {countAssetBytes} from './deep-assets'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'
export type TonalBrushAction=Extract<EditAction,{type:'layer.tonal_brush'}>
/** One non-destructive preparation used by preview and command commit. Local
 * exposure/saturation operators are portable approximations, not PS kernels. */
export function applyTonalBrush(stage:PixelStage,action:TonalBrushAction):string {
 const layer=stage.manifest.layers.find(l=>l.id===action.layerId),asset=layer?.imageFile&&stage.assets.get(layer.imageFile)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The tonal brush layer no longer exists.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','Unlock this layer before painting tones.')
 if(layer.text||layer.shape)throw new EditorError('RASTERIZATION_REQUIRED','Rasterize this text or shape layer before painting tones.')
 if(layer.isGroup||layer.adjustment||!asset)throw new EditorError('INVALID_ARGUMENT','Choose a raster image layer for the tonal brush.')
 const pixels=asset.width*asset.height;if(pixels>16_000_000||pixels*112+countAssetBytes(asset)>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Tonal brush exceeds its 16 MP source or 512 MiB working budget.')
 const label=action.kind==='dodge'?'Dodge':action.kind==='burn'?'Burn':'Sponge';if(!action.amount)return label
 const original=asset.hdr??asset.deep??PNG.sync.read(asset.bytes).data,premult=!!(asset.hdr||asset.deep),scale=asset.hdr?1:asset.deep?65535:255,prepared=prepareBrushStroke(action.points,action.size,action.smoothing??0,action.pressures),coverage=brushStrokeCoverage({width:asset.width,height:asset.height,transform:layer.transform,canvasWidth:stage.manifest.width,canvasHeight:stage.manifest.height},prepared.points,action.size,action.hardness,{...action,pressures:prepared.pressures,tip:'brush'})
 for(let y=0;y<asset.height;y++)for(let x=0;x<asset.width;x++){const at=y*asset.width+x;if(coverage[at])coverage[at]=Math.round(coverage[at]*selectionCoverage(stage.selection,...documentPoint(layer,x+.5,y+.5,asset.width,asset.height)))}
 const straight=premult?new Float32Array(original.length):original
 if(premult)for(let at=0;at<original.length;at+=4){const alpha=original[at+3]/scale;straight[at+3]=alpha;for(let c=0;c<3;c++)straight[at+c]=alpha?original[at+c]/scale/alpha:0}
 const toned=tonalBrushPixels(straight,coverage,{kind:action.kind,amount:action.amount,range:action.range,protectTones:action.protectTones,mode:action.mode,vibrance:action.vibrance}),result=asset.hdr?new Float32Array(original):asset.deep?new Uint16Array(original):Uint8Array.from(original),write=asset.hdr?Math.fround:Math.round;let changed=false
 for(let at=0;at<original.length;at+=4){if(!coverage[at/4])continue;for(let c=0;c<3;c++)if(toned[at+c]!==straight[at+c]){result[at+c]=premult?write(asset.deep?Math.max(0,Math.min(original[at+3],toned[at+c]*original[at+3])):toned[at+c]*original[at+3]):toned[at+c];changed ||=result[at+c]!==original[at+c]}}
 if(!changed)return label
 const file=`${layer.id.toUpperCase()}.${asset.hdr?'exr':'png'}`,replacement=asset.hdr?makeHDRAsset(file,asset.width,asset.height,result as Float32Array):asset.deep?makeDeepAsset(file,asset.width,asset.height,result as Uint16Array):makeAsset(file,encodeRaster({width:asset.width,height:asset.height,data:result} as PNG))
 stage.assets.set(file,replacement);layer.imageFile=file;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector');return label
}
