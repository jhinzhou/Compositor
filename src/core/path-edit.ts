import {randomUUID} from 'node:crypto'
import {PNG} from 'pngjs'
import {EditorError,type Manifest,type Layer} from '../shared/contracts'
import {storedVectorPathsSchema,validateVectorPath,rasterizeVectorPath,vectorPathSelection,type VectorPath} from '../shared/vector-path'
import {appendSelectionShape} from '../shared/selection-composition'
import type {RGBA,Selection} from '../shared/pixel-contracts'
import {makeAsset,type Asset} from './project-io'
import {encodeRaster} from './raster-edit'
import {layerProtected} from './layer-locks'
import {invalidatePhotoshopComponent} from './photoshop-metadata'
import {applyPixelAction} from './pixel-actions'
export interface StoredVectorPath {id:string;name:string;path:VectorPath}
export type PathAction=
 |{type:'document.path_set';pathId?:string;name?:string;path:VectorPath}
 |{type:'document.path_delete';pathId:string}
 |{type:'selection.from_path';pathId:string;operation?:'replace'|'add'|'subtract'|'intersect';antialiased?:boolean}
 |{type:'layer.path_fill';layerId:string;pathId:string;color:RGBA}
 |{type:'layer.path_mask';layerId:string;pathId:string}
type Stage={manifest:Manifest;assets:Map<string,Asset>;selection:Selection|null}
export function documentVectorPaths(manifest:Manifest):StoredVectorPath[] {
 const value=manifest.vectorPaths
 return value===undefined?[]:storedVectorPathsSchema.parse(value)
}
function vectorMaskAsset(layer:Layer,path:VectorPath,width:number,height:number):Asset {
 if(width*height*24>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Vector mask exceeds its working memory budget.')
 const coverage=rasterizeVectorPath(path,width,height,true),png=new PNG({width,height})
 for(let i=0;i<coverage.length;i++)png.data.set([coverage[i],coverage[i],coverage[i],255],i*4)
 return makeAsset(`${layer.id.toUpperCase()}.mask.png`,encodeRaster(png,true))
}
function installVectorMask(layer:Layer,record:StoredVectorPath,asset:Asset,width:number,height:number):void {
 layer.maskFile=asset.file;layer.maskLinked=false;layer.maskEnabled=true;layer.maskDensity=1;layer.maskFeather=0;layer.photoshopMaskDefault=0
 layer.maskPlacement={origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'Smooth'}
 layer.vectorMask={pathId:record.id,path:structuredClone(record.path)};invalidatePhotoshopComponent(layer,'mask')
}
export function applyPathOperation(stage:Stage,action:PathAction):{label:string;pathId?:string} {
 const paths=documentVectorPaths(stage.manifest)
 if(action.type==='document.path_set'){
  const path=validateVectorPath(action.path),id=action.pathId??randomUUID().toUpperCase(),old=paths.find(record=>record.id===id),name=action.name??old?.name??'Work Path'
  if(!name.trim()||name.length>256)throw new EditorError('INVALID_ARGUMENT','Path requires a name.')
  if(action.pathId&&!old)throw new EditorError('INVALID_ARGUMENT','The edited path is unavailable.')
  const next=old?paths.map(record=>record.id===id?{id,name,path}:record):[...paths,{id,name,path}]
  if(next.length>64)throw new EditorError('RESOURCE_LIMIT','The document path limit was reached.')
  const record={id,name,path},linked=stage.manifest.layers.filter(layer=>(layer.vectorMask as {pathId?:string}|undefined)?.pathId===id)
  if(linked.some(layer=>layerProtected(stage.manifest,layer.id)))throw new EditorError('INVALID_ARGUMENT','Editing this vector path would change a locked vector mask.')
  if(linked.length*stage.manifest.width*stage.manifest.height*24>512*1024*1024)throw new EditorError('RESOURCE_LIMIT','Linked vector masks exceed the working memory budget.')
  const masks=linked.map(layer=>({layer,asset:vectorMaskAsset(layer,path,stage.manifest.width,stage.manifest.height)}))
  stage.manifest.vectorPaths=next;for(const {layer,asset} of masks){installVectorMask(layer,record,asset,stage.manifest.width,stage.manifest.height);stage.assets.set(asset.file,asset)}
  return {label:old?'Edit vector path':'Create vector path',pathId:id}
 }
 const record=paths.find(path=>path.id===action.pathId)
 if(!record)throw new EditorError('INVALID_ARGUMENT','The vector path is unavailable.')
 if(action.type==='document.path_delete'){stage.manifest.vectorPaths=paths.filter(path=>path.id!==record.id);return {label:'Delete vector path'}}
 if(action.type==='selection.from_path'){
  const shape=vectorPathSelection(record.path,stage.manifest.width,stage.manifest.height,action.antialiased??true);shape.operation=action.operation??'replace'
  stage.selection=appendSelectionShape(stage.selection,shape,stage.manifest.width,stage.manifest.height,action.antialiased??true);return {label:'Select from vector path'}
 }
 const layer=stage.manifest.layers.find(item=>item.id===action.layerId)
 if(!layer)throw new EditorError('LAYER_NOT_FOUND','The path target layer is unavailable.')
 if(layerProtected(stage.manifest,layer.id))throw new EditorError('INVALID_ARGUMENT','The path target layer is locked.')
 if(action.type==='layer.path_fill'){
  if(layer.text||layer.shape)throw new EditorError('RASTERIZATION_REQUIRED','Rasterize the text or shape before filling path pixels.')
  const previous=stage.selection,shape=vectorPathSelection(record.path,stage.manifest.width,stage.manifest.height,true);shape.operation=previous?'intersect':'replace'
  stage.selection=appendSelectionShape(previous,shape,stage.manifest.width,stage.manifest.height,true)
  try{applyPixelAction(stage,{type:'layer.fill',layerId:layer.id,target:'image',color:action.color})}finally{stage.selection=previous}
  return {label:'Fill vector path'}
 }
 if(layer.frame)throw new EditorError('INVALID_ARGUMENT','A frame already uses its own clip mask. Choose another layer for a vector mask.')
 const width=stage.manifest.width,height=stage.manifest.height,asset=vectorMaskAsset(layer,record.path,width,height)
 installVectorMask(layer,record,asset,width,height);stage.assets.set(asset.file,asset);return {label:'Create vector mask'}
}
