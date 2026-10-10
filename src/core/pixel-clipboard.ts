import {PNG} from 'pngjs'
import {selectionCoverage,blankPNG} from './raster-edit'
import {EditorError} from '../shared/contracts'
import type {Selection} from '../shared/pixel-contracts'
export function clipCanvasPixels(bytes:Buffer,selection:Selection|null):{bytes:Buffer;origin:[number,number]}{
 const image=PNG.sync.read(bytes);let left=image.width,top=image.height,right=0,bottom=0
 const mask=new Uint8Array(image.width*image.height)
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const alpha=mask[y*image.width+x]=Math.round(selectionCoverage(selection,x+.5,y+.5)*255);if(alpha){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}}
 if(right<=left||bottom<=top)throw new EditorError('EMPTY_SELECTION','The selection contains no canvas pixels.')
 const output=blankPNG(right-left,bottom-top)
 for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const from=(y*image.width+x)*4,to=((y-top)*output.width+x-left)*4;image.data.copy(output.data,to,from,from+4);output.data[to+3]=Math.round(image.data[from+3]*mask[y*image.width+x]/255)}
 return {bytes:PNG.sync.write(output),origin:[left,top]}
}
