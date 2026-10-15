import {brushStrokeCoverage} from '../shared/brush-coverage'
import type {BrushDynamics,BrushGrid} from '../shared/brush-dynamics'
import type {RGBA,Selection} from '../shared/pixel-contracts'
import type {Layer} from '../shared/contracts'
import {documentPoint,selectionCoverage} from './raster-edit'

/** Paint into original premultiplied samples. The shared tip still defines brush
 * coverage, but SDR display bytes never become the high-depth editing source. */
export function paintHighDepthRaster<T extends Uint16Array|Float32Array>(source:T,grid:BrushGrid,points:[number,number][],color:RGBA,size:number,hardness:number,opacity:number,erase:boolean,selection:Selection|null,dynamics:BrushDynamics):T {
 const coverage=brushStrokeCoverage(grid,points,size,hardness,dynamics),output=source.slice() as T,integer=source instanceof Uint16Array,scale=integer?65535:1
 const write=integer?Math.round:Math.fround
 for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++){
  const p=y*grid.width+x;if(!coverage[p])continue
  const point=documentPoint({transform:grid.transform} as Layer,x+.5,y+.5,grid.width,grid.height)
  const alpha=color[3]*coverage[p]/255*selectionCoverage(selection,...point)*opacity
  if(!alpha)continue
  const at=p*4,keep=1-alpha
  output[at+3]=write(erase?source[at+3]*keep:alpha*scale+source[at+3]*keep)
  for(let c=0;c<3;c++){
   const value=write(erase?source[at+c]*keep:color[c]*alpha*scale+source[at+c]*keep)
   output[at+c]=!output[at+3]?0:integer?Math.max(0,Math.min(output[at+3],value)):value
  }
 }
 return output
}
