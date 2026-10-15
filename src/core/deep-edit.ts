import {prepareDeepPaint,prepareDeepWarp,type DeepStrokePrepared} from './deep-stroke-edit'
import {EditorError,type EditAction,type Layer} from '../shared/contracts'
import {prepareHighDepthFilter} from './high-depth-filter'
import {assertDeepAssetBudget} from './deep-assets'
import {makeAsset,makeDeepAsset,type Asset} from './project-io'
import {prepareDeepBlur} from './deep-blur-edit'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'
import {prepareDeepDrawing} from './deep-raster-fill'

function source(stage:PixelStage,layer:Layer):Asset&{deep:Uint16Array}{
 const asset=layer.imageFile&&stage.assets.get(layer.imageFile)
 if(!asset||asset.bitDepth!==16||!asset.deep)throw new EditorError('INVALID_ARGUMENT','Choose a 16-bit raster layer.')
 return asset as Asset&{deep:Uint16Array}
}
function install(stage:PixelStage,layer:Layer,asset:Asset):void {
 stage.assets.set(asset.file,asset);layer.imageFile=asset.file;delete layer.text;delete layer.shape
 invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')
}
export function applyDeepColorOperation(stage:PixelStage,action:Extract<EditAction,{type:'layer.filter'}>):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The filter layer was removed.')
 const asset=source(stage,layer)
 assertDeepAssetBudget(stage.assets.values(),asset.width*asset.height*48)
 const result=prepareHighDepthFilter(stage,action)
 if(!result.deep)throw new EditorError('INVALID_PROJECT','The 16-bit filter returned no canonical UNORM pixels.')
 // Prepare every replacement before mutating the stage, including the linked mask.
 if(result.width===asset.width&&result.height===asset.height&&JSON.stringify(result.transform)===JSON.stringify(layer.transform)&&result.deep.every((value,index)=>value===asset.deep[index]))return 'Apply filter'
 assertDeepAssetBudget(stage.assets.values(),result.width*result.height*64)
 const replacement=makeDeepAsset(`${layer.id.toUpperCase()}.png`,result.width,result.height,result.deep),mask=result.maskPNG&&layer.maskFile?makeAsset(layer.maskFile,result.maskPNG):undefined
 install(stage,layer,replacement);layer.transform=structuredClone(result.transform)
 if(mask&&layer.maskFile){stage.assets.set(layer.maskFile,mask);invalidatePhotoshopComponent(layer,'mask')}
 return 'Apply filter'
}
export function applyDeepBlurOperation(stage:PixelStage,action:Extract<EditAction,{type:'layer.retouch'}>):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The blur layer was removed.')
 const asset=source(stage,layer),result=prepareDeepBlur(stage,action)
 if(result.width===asset.width&&result.height===asset.height&&JSON.stringify(result.transform)===JSON.stringify(layer.transform)&&result.deep.every((value,index)=>value===asset.deep[index]))return 'Blur'
 install(stage,layer,makeDeepAsset(`${layer.id.toUpperCase()}.png`,result.width,result.height,result.deep));layer.transform=structuredClone(result.transform)
 if(result.maskPNG&&layer.maskFile){stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,result.maskPNG));invalidatePhotoshopComponent(layer,'mask')}
 return 'Blur'
}

export function applyDeepStrokeOperation(stage:PixelStage,action:Extract<EditAction,{type:'layer.paint'|'layer.retouch'}>):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The stroke layer was removed.')
 const asset=source(stage,layer)
 assertDeepAssetBudget(stage.assets.values(),asset.width*asset.height*64+(action.type==='layer.retouch'?stage.manifest.width*stage.manifest.height*40:0))
 const result:DeepStrokePrepared=action.type==='layer.paint'?prepareDeepPaint(stage,action):prepareDeepWarp(stage,action)
 const label=action.type==='layer.paint'?action.erase?'Erase pixels':'Paint pixels':action.smearMode==='liquify'?'Liquify':'Smudge'
 if(result.width===asset.width&&result.height===asset.height&&JSON.stringify(result.transform)===JSON.stringify(layer.transform)&&result.deep.every((value,index)=>value===asset.deep[index]))return label
 install(stage,layer,makeDeepAsset(`${layer.id.toUpperCase()}.png`,result.width,result.height,result.deep));layer.transform=structuredClone(result.transform)
 if(result.maskPNG&&layer.maskFile){stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,result.maskPNG));invalidatePhotoshopComponent(layer,'mask')}
 return label
}

export function applyDeepDrawingOperation(stage:PixelStage,action:Extract<EditAction,{type:'layer.fill'|'layer.gradient'|'layer.clear_selected'}>):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The drawing layer was removed.')
 const asset=source(stage,layer),result=prepareDeepDrawing(stage,action),label=action.type==='layer.gradient'?'Draw gradient':action.type==='layer.fill'?'Fill selection':'Clear selected pixels'
 if(result.width===asset.width&&result.height===asset.height&&JSON.stringify(result.transform)===JSON.stringify(layer.transform)&&result.deep.every((value,index)=>value===asset.deep[index]))return label
 install(stage,layer,makeDeepAsset(`${layer.id.toUpperCase()}.png`,result.width,result.height,result.deep));layer.transform=structuredClone(result.transform)
 if(result.maskPNG&&layer.maskFile){stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,result.maskPNG));invalidatePhotoshopComponent(layer,'mask')}
 return label
}
