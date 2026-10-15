import {EditorError,type EditAction,type Layer,type Manifest} from '../shared/contracts'
import type {Asset} from './project-io'
import {invalidatePhotoshopComponent} from './photoshop-metadata'

/** Rasterization is an explicit, undoable command; a preview must not discard
 * editable text or vector metadata merely because a paint tool was selected. */
export function assertPaintRasterized(manifest:Manifest,action:EditAction):void {
 if(!('layerId'in action))return
 const layer=manifest.layers.find(layer=>layer.id===action.layerId)
 if((layer?.frame||layer?.vectorMask)&&(['layer.mask','layer.copy_mask','layer.mask_set_placement','layer.mask_properties','layer.mask_filter'].includes(action.type)||'target' in action&&action.target==='mask'))throw new EditorError('UNSUPPORTED_FEATURE','Edit this clip with the Frame or Path tool. Its editable definition and original pixels have been kept.')
 if(!['layer.paint','layer.mixer_brush','layer.tonal_brush','layer.history_brush','layer.bucket_fill','layer.retouch','layer.gradient','layer.background_erase','layer.magic_erase'].includes(action.type)||'target'in action&&action.target==='mask')return
 if(layer?.text||layer?.shape)throw new EditorError('RASTERIZATION_REQUIRED','Rasterize this text or shape layer before painting its image pixels.',{layerId:layer.id,action:action.type})
}

/** Reuse the already rendered source snapshot without quantizing or rerendering
 * it. Imported editable content without a readable snapshot is not safe to
 * convert into an empty layer. All unrelated layer properties remain intact. */
export function rasterizeLayer(layer:Layer,assets:ReadonlyMap<string,Asset>):void {
 if(!layer.text&&!layer.shape)return
 if(!layer.imageFile||!assets.has(layer.imageFile))throw new EditorError('ASSET_NOT_FOUND','The editable layer has no rendered image to rasterize. Its editable content has been kept.')
 if(layer.isGroup||layer.adjustment)throw new EditorError('INVALID_ARGUMENT','Choose a text or shape image layer to rasterize.')
 if(layer.text){delete layer.text;invalidatePhotoshopComponent(layer,'text')}
 if(layer.shape){delete layer.shape;invalidatePhotoshopComponent(layer,'vector')}
}
