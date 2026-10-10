import type {Selection} from './pixel-contracts'
/** Conservative geometry bounds; raster bounds use nonzero RLE cells, not the
 * whole document-sized storage. A global inverse necessarily covers canvas. */
export function selectionGeometryBounds(selection:Selection,width:number,height:number,halo=0):[number,number,number,number] {
 if(selection.inverted)return [0,0,width,height]
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity
 for(const shape of selection.shapes){
  if(shape.operation==='replace'){left=Infinity;top=Infinity;right=-Infinity;bottom=-Infinity}
  if(shape.operation==='subtract')continue
  if(shape.raster){const raster=shape.raster,t=raster.transform;let sx=Infinity,sy=Infinity,ex=-Infinity,ey=-Infinity
   for(const [y,x,n,value] of raster.runs)if(value){sx=Math.min(sx,x);sy=Math.min(sy,y);ex=Math.max(ex,x+n);ey=Math.max(ey,y+1)}
   if(!Number.isFinite(sx))continue
   const a=t.rotation*Math.PI/180,cs=Math.cos(a),sn=Math.sin(a)
   for(const [x,y] of [[sx,sy],[ex,sy],[ex,ey],[sx,ey]]){const dx=(x/raster.width-.5)*t.size[0]*(t.flipX?-1:1),dy=(y/raster.height-.5)*t.size[1]*(t.flipY?-1:1),px=t.origin[0]+t.size[0]/2+dx*cs-dy*sn,py=t.origin[1]+t.size[1]/2+dx*sn+dy*cs;left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py)}
  }else{const [x,y,w,h]=shape.bounds;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+w);bottom=Math.max(bottom,y+h)}
 }
 if(!Number.isFinite(left))return [0,0,0,0]
 left=Math.max(0,Math.floor(left-halo));top=Math.max(0,Math.floor(top-halo));right=Math.min(width,Math.ceil(right+halo));bottom=Math.min(height,Math.ceil(bottom+halo))
 return [left,top,Math.max(0,right-left),Math.max(0,bottom-top)]
}
