import type {Layer} from '../shared/contracts'

type PhotoshopComponent='effects'|'mask'|'protection'|'text'|'vector'
const fields:Record<PhotoshopComponent,string[]>={effects:['effects','nativeEffectsSnapshot','fillOpacity'],mask:['maskParameters','nativeMaskHash','nativeMaskPropertiesSnapshot'],protection:['protected','nativeLockSnapshot'],text:['text','nativeTextSnapshot'],vector:['vectorFill','vectorMask','vectorOrigination','vectorStroke','nativeShapeSnapshot']}
/** User edits are authoritative even when they produce the same final native
 * parameters/pixel hash. Undo restores the metadata through the normal manifest
 * snapshot; merely editing back to the old value must not resurrect source PSD
 * behavior that the editor no longer represents. */
export function invalidatePhotoshopComponent(layer:Layer,component:PhotoshopComponent):void {
 if(layer.photoshop&&typeof layer.photoshop==='object')for(const key of fields[component])delete (layer.photoshop as Record<string,unknown>)[key]
}
