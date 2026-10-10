import {selectionGeometryBounds} from '../shared/selection-bounds'
import {PNG} from 'pngjs'
import {EditorError,LIMITS,type Layer,type Transform} from '../shared/contracts'
import type {Selection} from '../shared/pixel-contracts'
import {blankPNG,documentPoint,selectionCoverage,sourcePoint} from './raster-edit'
import {distortRaster,type WarpCorners} from './distort-raster'
import {coverageShape} from './pixel-actions'
import type {PixelStage} from './pixel-actions'
import {makeAsset} from './project-io'
import {encodeRaster} from './raster-edit'
function sample(image:PNG,x:number,y:number):number[]{const sx=x-.5,sy=y-.5,x0=Math.floor(sx),y0=Math.floor(sy),fx=sx-x0,fy=sy-y0,out=[0,0,0,0];for(let j=0;j<2;j++)for(let i=0;i<2;i++){const xx=x0+i,yy=y0+j;if(xx<0||yy<0||xx>=image.width||yy>=image.height)continue;const at=(yy*image.width+xx)*4,weight=(i?fx:1-fx)*(j?fy:1-fy),a=image.data[at+3]/255;out[3]+=weight*a;for(let c=0;c<3;c++)out[c]+=image.data[at+c]*weight*a}for(let c=0;c<3;c++)out[c]=out[3]?Math.round(out[c]/out[3]):0;out[3]=Math.round(out[3]*255);return out}
function budget(w:number,h:number):void{if(w<1||h<1||w>LIMITS.maxSide||h>LIMITS.maxSide||w*h>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Selection transform exceeds its source surface budget.')}
/** Conservative document ROI; inverse selections deliberately cover the entire canvas. */
export function selectionDocumentBounds(selection:Selection,width:number,height:number):[number,number,number,number]{
 const halo=Math.ceil(3*(selection.feather??Math.max(0,...selection.shapes.map(s=>s.feather)))+2),[left,top,w,h]=selectionGeometryBounds(selection,width,height,halo)
 return [left,top,left+w,top+h]
}
function sourceBounds(layer:Layer,left:number,top:number,right:number,bottom:number,width:number,height:number):[number,number,number,number]{
 const points=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>sourcePoint(layer,x,y,width,height))
 return [Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))-1),Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))-1),Math.min(width,Math.ceil(Math.max(...points.map(p=>p[0])))+1),Math.min(height,Math.ceil(Math.max(...points.map(p=>p[1])))+1)]
}
export function liftSelectedPixels(stage:PixelStage,layer:Layer):{pixels:PNG;coverage:PNG;cleared:PNG;transform:Transform}{
 if(!stage.selection||!layer.imageFile)throw new EditorError('INVALID_ARGUMENT','Select pixels on a raster layer before transforming them.')
 const asset=stage.assets.get(layer.imageFile);if(!asset)throw new EditorError('ASSET_NOT_FOUND','The selected raster is missing.');const source=PNG.sync.read(asset.bytes),selection=stage.selection,roi=selectionDocumentBounds(selection,stage.manifest.width,stage.manifest.height)
 let left=stage.manifest.width,top=stage.manifest.height,right=0,bottom=0
 for(let y=roi[1];y<roi[3];y++)for(let x=roi[0];x<roi[2];x++)if(selectionCoverage(selection,x+.5,y+.5)>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}
 if(right<=left||bottom<=top)throw new EditorError('EMPTY_SELECTION','The selection has no pixels inside the canvas.')
 budget(right-left,bottom-top)
 const pixels=blankPNG(right-left,bottom-top),coverage=blankPNG(pixels.width,pixels.height),cleared=source
 for(let y=0;y<pixels.height;y++)for(let x=0;x<pixels.width;x++){const p:[number,number]=[left+x+.5,top+y+.5],alpha=Math.round(selectionCoverage(selection,...p)*255),rgba=sample(source,...sourcePoint(layer,...p,source.width,source.height)),at=(y*pixels.width+x)*4;rgba[3]=Math.round(rgba[3]*alpha/255);pixels.data.set(rgba,at);coverage.data.set([alpha,alpha,alpha,255],at)}
 const clearBounds=sourceBounds(layer,left,top,right,bottom,source.width,source.height)
 for(let y=clearBounds[1];y<clearBounds[3];y++)for(let x=clearBounds[0];x<clearBounds[2];x++){const point=documentPoint(layer,x+.5,y+.5,source.width,source.height),at=(y*source.width+x)*4;cleared.data[at+3]=Math.round(source.data[at+3]*(1-selectionCoverage(selection,...point)))}
 return {pixels,coverage,cleared,transform:{origin:[left,top],size:[pixels.width,pixels.height],rotation:0,flipX:false,flipY:false,sampling:layer.transform.sampling}}
}
export function transformSelectedPixels(stage:PixelStage,layer:Layer,transform:Transform,corners?:WarpCorners):string{
 const lifted=liftSelectedPixels(stage,layer)
 if(!corners&&JSON.stringify(transform)===JSON.stringify(lifted.transform))return 'Transform Selection'
 let pixels=lifted.pixels,coverage=lifted.coverage,placed=transform
 if(corners){const warped=distortRaster(pixels,corners,{flipX:transform.flipX,flipY:transform.flipY,sampling:transform.sampling});pixels=warped.png;coverage=distortRaster(coverage,corners,{flipX:transform.flipX,flipY:transform.flipY,sampling:transform.sampling,mask:true}).png;placed=warped.transform}
 const original=lifted.cleared,ps=placed.size,a=placed.rotation*Math.PI/180,points=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{const dx=(u-.5)*ps[0],dy=(v-.5)*ps[1];return sourcePoint(layer,placed.origin[0]+ps[0]/2+dx*Math.cos(a)-dy*Math.sin(a),placed.origin[1]+ps[1]/2+dx*Math.sin(a)+dy*Math.cos(a),original.width,original.height)}),left=Math.floor(Math.min(0,...points.map(p=>p[0]))),top=Math.floor(Math.min(0,...points.map(p=>p[1]))),right=Math.ceil(Math.max(original.width,...points.map(p=>p[0]))),bottom=Math.ceil(Math.max(original.height,...points.map(p=>p[1])));budget(right-left,bottom-top)
 const merged=left===0&&top===0&&right===original.width&&bottom===original.height?original:blankPNG(right-left,bottom-top)
 if(merged!==original)for(let row=0;row<original.height;row++)merged.data.set(original.data.subarray(row*original.width*4,(row+1)*original.width*4),((row-top)*merged.width-left)*4)
 const destination=[Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))-left-1),Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))-top-1),Math.min(merged.width,Math.ceil(Math.max(...points.map(p=>p[0])))-left+1),Math.min(merged.height,Math.ceil(Math.max(...points.map(p=>p[1])))-top+1)]
 for(let y=destination[1];y<destination[3];y++)for(let x=destination[0];x<destination[2];x++){const at=(y*merged.width+x)*4,ox=x+left,oy=y+top,dest=ox>=0&&oy>=0&&ox<original.width&&oy<original.height?[...original.data.subarray((oy*original.width+ox)*4,(oy*original.width+ox)*4+4)]:[0,0,0,0],point=documentPoint(layer,ox+.5,oy+.5,original.width,original.height),[sx,sy]=sourcePoint({transform:placed},...point,pixels.width,pixels.height),src=sample(pixels,sx,sy),sa=src[3]/255,da=dest[3]/255,alpha=sa+da*(1-sa);for(let c=0;c<3;c++)merged.data[at+c]=alpha?Math.round((src[c]*sa+dest[c]*da*(1-sa))/alpha):0;merged.data[at+3]=Math.round(alpha*255)}
 const center=documentPoint(layer,(left+right)/2,(top+bottom)/2,original.width,original.height),size:[number,number]=[merged.width*layer.transform.size[0]/original.width,merged.height*layer.transform.size[1]/original.height]
 if(layer.maskFile&&!layer.maskPlacement&&layer.maskLinked===false&&(left||top||merged.width!==original.width||merged.height!==original.height))layer.maskPlacement=structuredClone(layer.transform)
 if(layer.maskFile&&!layer.maskPlacement&&(left||top||merged.width!==original.width||merged.height!==original.height)){const mask=PNG.sync.read(stage.assets.get(layer.maskFile)!.bytes),grown=blankPNG(merged.width,merged.height,255);for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++){const v=sample(mask,(x+.5)*mask.width/original.width,(y+.5)*mask.height/original.height)[0],at=((y-top)*grown.width+x-left)*4;grown.data.set([v,v,v,255],at)}stage.assets.set(layer.maskFile,makeAsset(layer.maskFile,encodeRaster(grown,true)))}
 layer.transform={...layer.transform,origin:[center[0]-size[0]/2,center[1]-size[1]/2],size};stage.assets.set(layer.imageFile!,makeAsset(layer.imageFile!,PNG.sync.write(merged)));delete layer.text;delete layer.shape
 const values=new Uint8Array(coverage.width*coverage.height);for(let i=0;i<values.length;i++)values[i]=coverage.data[i*4];stage.selection={inverted:false,shapes:[coverageShape({width:coverage.width,height:coverage.height,coverage:values},placed)]};return 'Transform Selection'
}
