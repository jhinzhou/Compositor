import {PNG} from 'pngjs'
import {EditorError,type Layer} from '../shared/contracts'
import type {Selection} from '../shared/pixel-contracts'
import type {RasterSelection} from './selection-retouch'
import {documentPoint,encodeRaster,selectionCoverage} from './raster-edit'

export interface SubjectMaskResult {file:string;bytes:Buffer;width:number;height:number;layer:Layer}
/** The same remove-background raster and metadata are used by preview and commit.
 * Native only combines an existing mask when it occupies the source pixel grid. */
export function prepareSubjectMask(layer:Layer,source:{width:number;height:number},mask:RasterSelection,selection:Selection|null,space:'source'|'document'='source',oldMask?:{width:number;height:number;bytes:Buffer}):SubjectMaskResult {
 if(!Number.isInteger(source.width)||!Number.isInteger(source.height)||source.width<1||source.height<1)throw new EditorError('INVALID_ARGUMENT','The subject source dimensions are invalid.')
 if(!Number.isInteger(mask.width)||!Number.isInteger(mask.height)||mask.width<1||mask.height<1||mask.coverage.length!==mask.width*mask.height||(space==='source'&&(mask.width!==source.width||mask.height!==source.height)))throw new EditorError('INVALID_ARGUMENT','The prepared mask does not match its source.')
 if(layer.maskFile&&!oldMask)throw new EditorError('ASSET_NOT_FOUND','The existing layer mask is missing.')
 const existing=oldMask&&!layer.maskPlacement&&oldMask.width===source.width&&oldMask.height===source.height?PNG.sync.read(oldMask.bytes):undefined
 const file=`${layer.id.toUpperCase()}.mask.png`,png=new PNG({width:source.width,height:source.height})
 if(existing&&(existing.width!==source.width||existing.height!==source.height))throw new EditorError('INVALID_ARGUMENT','The existing layer mask dimensions are inconsistent.')
 for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
  const point=documentPoint(layer,x+.5,y+.5,png.width,png.height),at=(y*png.width+x)*4,base=existing?existing.data[at]:255
  const mx=space==='document'?Math.floor(point[0]):x,my=space==='document'?Math.floor(point[1]):y,subject=mx<0||my<0||mx>=mask.width||my>=mask.height?0:mask.coverage[my*mask.width+mx]
  const selected=selectionCoverage(selection,...point),value=Math.round(base+(base*subject/255-base)*selected)
  png.data.set([value,value,value,255],at)
 }
 const next=structuredClone(layer);next.maskFile=file;next.maskEnabled=true
 if(!oldMask){next.maskLinked=true;delete next.maskPlacement}
 return {file,bytes:encodeRaster(png,true),width:png.width,height:png.height,layer:next}
}
