import {cameraRawBrightness,type CameraRawBrightness} from '../shared/camera-raw-adaptive'
import type {PixelImage} from '../shared/image-filters'
import {EditorError} from '../shared/contracts'

export interface CameraRawPreviewSourceKey {sessionId:string;layerId:string;hash:string;width:number;height:number;sourceVersion:string}
/** Keep only scalar statistics, never decoded PNG surfaces. Asset hashes survive
 * the repeated fresh PNG decoding performed by the preview worker. */
export class CameraRawPreviewBrightnessCache {
 private entries=new Map<string,CameraRawBrightness>()
 constructor(private capacity=4,private measure:(image:PixelImage)=>CameraRawBrightness=cameraRawBrightness){if(!Number.isInteger(capacity)||capacity<1||capacity>16)throw new EditorError('INVALID_ARGUMENT','Camera Raw source cache capacity must be between 1 and 16.')}
 get size():number{return this.entries.size}
 get(key:CameraRawPreviewSourceKey,image:PixelImage):CameraRawBrightness {
  if(image.width!==key.width||image.height!==key.height)throw new EditorError('INVALID_ARGUMENT','Camera Raw cached source dimensions changed.')
  const id=JSON.stringify([key.sessionId,key.layerId,key.hash,key.width,key.height,key.sourceVersion]),cached=this.entries.get(id)
  if(cached){this.entries.delete(id);this.entries.set(id,cached);return {...cached}}
  const brightness=this.measure(image);this.entries.set(id,{...brightness})
  while(this.entries.size>this.capacity)this.entries.delete(this.entries.keys().next().value!)
  return {...brightness}
 }
}
