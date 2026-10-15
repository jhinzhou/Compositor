// Latest Compositor PatchPixels.c integration; MIT notice: licenses/Compositor-MIT.txt.
import {PNG} from 'pngjs'
import {EditorError} from '../shared/contracts'
import {patchFillPremultiplied,preflightPatchFill,type PatchFillOptions} from '../shared/native-patch-fill'
import type {RGBAImage,RasterSelection} from './selection-retouch'
export {contentAwareFillLegacy1_4_8} from './content-fill-legacy'
export interface ContentFillResult {png:PNG;filledPixels:number;donorCount:number;algorithm:'compositor-multiscale-patchmatch-6aea90a'}
/** PNG rasters are straight RGBA; the native PatchPixels contract is premultiplied.
 * Hidden RGB and every unselected byte are retained exactly in the PNG result. */
export function contentAwareFill(image:RGBAImage,selection:RasterSelection,options:PatchFillOptions={}):ContentFillResult {
 if(selection.width!==image.width||selection.height!==image.height||selection.coverage.length!==image.width*image.height)throw new EditorError('INVALID_ARGUMENT','Content fill requires equal-sized RGBA and selection rasters.')
 preflightPatchFill(image.data,selection.coverage,image.width,image.height,options,image.width*image.height*12)
 const input=new Uint8Array(image.data)
 for(let p=0;p<image.width*image.height;p++){const at=p*4,a=input[at+3];for(let c=0;c<3;c++)input[at+c]=Math.round(input[at+c]*a/255)}
 const budget=options.maximumWork??120_000_000,conversionWork=image.width*image.height*3
 if(conversionWork>budget)throw new EditorError('RESOURCE_LIMIT','Content fill exceeds the patch-search budget; use a smaller image or selection.')
 const result=patchFillPremultiplied(input,selection.coverage,image.width,image.height,{...options,maximumWork:budget-conversionWork})
 if(!result.status)throw new EditorError('NO_SOURCE','Not enough unselected opaque image pixels to synthesize a fill. Use a smaller selection with surrounding image.')
 const png=new PNG({width:image.width,height:image.height});png.data.set(image.data)
 for(let p=0;p<selection.coverage.length;p++)if(selection.coverage[p]){const at=p*4,a=result.data[at+3];png.data[at+3]=a;for(let c=0;c<3;c++)png.data[at+c]=a?Math.round(result.data[at+c]*255/a):0}
 return {png,filledPixels:result.filledPixels,donorCount:result.donorCount,algorithm:'compositor-multiscale-patchmatch-6aea90a'}
}
