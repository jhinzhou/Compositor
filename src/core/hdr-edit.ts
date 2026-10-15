import {EditorError,type EditAction} from '../shared/contracts'
import {prepareHighDepthFilter} from './high-depth-filter'
import {assertDeepAssetBudget} from './deep-assets'
import {makeHDRAsset,makeAsset} from './project-io'
import {prepareHDRStroke} from './hdr-stroke-edit'
import {prepareHDRDrawing} from './deep-raster-fill'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import type {PixelStage} from './pixel-actions'

type HDREdit=Extract<EditAction,{type:'layer.paint'|'layer.retouch'|'layer.filter'|'layer.fill'|'layer.gradient'|'layer.clear_selected'}>
/** HDR edits never pass through the display PNG as their source. */
export function applyHDROperation(stage:PixelStage,action:HDREdit):string {
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId),asset=layer?.imageFile?stage.assets.get(layer.imageFile):undefined
 if(!layer||!asset?.hdr)throw new EditorError('INVALID_ARGUMENT','Choose a floating-point HDR raster layer.')
 assertDeepAssetBudget(stage.assets.values(),asset.width*asset.height*96+(action.type==='layer.retouch'?stage.manifest.width*stage.manifest.height*64:0))
 let result:{hdr:Float32Array;width:number;height:number;transform:typeof layer.transform;maskPNG?:Buffer}
 if(action.type==='layer.filter'){
  const prepared=prepareHighDepthFilter(stage,action)
  if(!prepared.hdr)throw new EditorError('INVALID_PROJECT','The HDR filter returned no canonical Float32 pixels.')
  result={...prepared,hdr:prepared.hdr}
 }else if(action.type==='layer.paint'||action.type==='layer.retouch')result=prepareHDRStroke(stage,action)
 else result=prepareHDRDrawing(stage,action)
 const label=action.type==='layer.filter'?'Apply filter':action.type==='layer.paint'?action.erase?'Erase pixels':'Paint pixels':action.type==='layer.retouch'?action.kind==='blur'?'Blur':action.smearMode==='liquify'?'Liquify':'Smudge':action.type==='layer.fill'?'Fill selection':action.type==='layer.gradient'?'Draw gradient':'Clear selected pixels'
 if(result.width===asset.width&&result.height===asset.height&&JSON.stringify(result.transform)===JSON.stringify(layer.transform)&&result.hdr.every((v,i)=>v===asset.hdr![i]))return label
 assertDeepAssetBudget(stage.assets.values(),result.width*result.height*96)
 const file=`${layer.id.toUpperCase()}.exr`,replacement=makeHDRAsset(file,result.width,result.height,result.hdr),mask=result.maskPNG&&layer.maskFile?makeAsset(layer.maskFile,result.maskPNG):undefined
 stage.assets.set(file,replacement);layer.imageFile=file;layer.transform=structuredClone(result.transform);delete layer.text;delete layer.shape;invalidatePhotoshopComponent(layer,'text');invalidatePhotoshopComponent(layer,'vector')
 if(mask&&layer.maskFile){stage.assets.set(layer.maskFile,mask);invalidatePhotoshopComponent(layer,'mask')}
 return label
}
