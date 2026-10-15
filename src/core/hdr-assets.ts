import {PNG} from 'pngjs'
import {EditorError} from '../shared/contracts'
import {quantizeHDRPreview,validateHDRPixels} from '../shared/hdr-pixels'
import {DEEP_ASSET_WORKING_BUDGET} from './deep-assets'
import {inspectEXR} from './hdr-codecs'

/** Decode + immutable source copy + Float32 pixels + SDR display construction. */
export function hdrAssetWorkingBytes(bytes:Buffer):number {
 const header=inspectEXR(bytes),estimate=header.estimatedBytes+bytes.length+header.width*header.height*32+header.height*7
 if(estimate>DEEP_ASSET_WORKING_BUDGET)throw new EditorError('RESOURCE_LIMIT','HDR source and display preparation exceed the 512 MiB working budget.',{estimatedBytes:estimate})
 return estimate
}
export function hdrDisplayPNG(width:number,height:number,hdr:Float32Array):Buffer {
 validateHDRPixels(hdr,width,height,32)
 const rgba=quantizeHDRPreview(hdr,width,height)
 return PNG.sync.write({width,height,data:Buffer.from(rgba.buffer,rgba.byteOffset,rgba.byteLength)} as PNG)
}
