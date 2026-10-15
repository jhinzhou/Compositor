import type {Layer as PhotoshopLayer, LayerTextData, TextStyleRun, BezierKnot} from 'ag-psd'
import {validateTextStyle,validateShapeStyle} from '../shared/content-style'
import type {Layer,Transform} from '../shared/contracts'

const px=(value:number)=>({units:'Pixels' as const,value})
function matrix(transform:Transform,width:number,height:number):number[]{
 const angle=transform.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),sx=transform.size[0]/width*(transform.flipX?-1:1),sy=transform.size[1]/height*(transform.flipY?-1:1)
 return [c*sx,s*sx,-s*sy,c*sy,transform.origin[0]+transform.size[0]/2-c*sx*width/2+s*sy*height/2,transform.origin[1]+transform.size[1]/2-s*sx*width/2-c*sy*height/2]
}
const point=(m:number[],x:number,y:number):[number,number]=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]
function sourceMetadata(layer:Layer):Record<string,unknown>{return layer.photoshop&&typeof layer.photoshop==='object'?layer.photoshop as Record<string,unknown>:{} }

export function exportPhotoshopText(layer:Layer,width:number,height:number,rasterHash?:string):LayerTextData|undefined {
 if(!layer.text)return
 const style=validateTextStyle(layer.text),metadata=sourceMetadata(layer),snapshot=metadata.nativeTextSnapshot,original=metadata.text as LayerTextData|undefined,oldTransform=metadata.nativeTransformSnapshot as Transform|undefined
 // Preserve advanced imported typography verbatim when the editable text and
 // geometry are untouched. Translation does not invalidate those descriptors.
 if(original&&oldTransform&&metadata.nativeRasterHash===rasterHash&&JSON.stringify(snapshot)===JSON.stringify(layer.text)&&JSON.stringify({...oldTransform,origin:layer.transform.origin})===JSON.stringify(layer.transform)){
  const text=structuredClone(original),m=text.transform??[1,0,0,1,0,0];m[4]+=layer.transform.origin[0]-oldTransform.origin[0];m[5]+=layer.transform.origin[1]-oldTransform.origin[1];text.transform=m;return text
 }
 const m=matrix(layer.transform,width,height),lineHeight=style.leading||style.fontSize*1.2,baseline=12+lineHeight-style.fontSize*.2,[x,y]=point(m,12,baseline),color=(rgb:{red:number;green:number;blue:number})=>({r:rgb.red*255,g:rgb.green*255,b:rgb.blue*255})
 const boundaries=[...new Set([0,style.content.length,...(style.colorRuns??[]).flatMap(run=>[run.location,run.location+run.length]),...(style.fontRuns??[]).flatMap(run=>[run.location,run.location+run.length])])].sort((a,b)=>a-b),runs:TextStyleRun[]=[]
 for(let index=0;index<boundaries.length-1;index++){const start=boundaries[index],end=boundaries[index+1],rgb=style.colorRuns?.find(run=>start>=run.location&&start<run.location+run.length)??style,font=style.fontRuns?.find(run=>start>=run.location&&start<run.location+run.length)?.fontName??style.fontName;runs.push({length:end-start,style:{font:{name:font},fillColor:color(rgb)}})}
 return {text:style.content.replace(/\n/g,'\r'),left:0,top:0,right:width,bottom:height,orientation:'horizontal',antiAlias:'smooth',transform:[m[0],m[1],m[2],m[3],x,y],shapeType:style.boxSize?'box':'point',...(style.boxSize?{boxBounds:[0,-baseline+12,Math.max(1,style.boxSize[0]-24),style.boxSize[1]-baseline-12]}:{pointBase:[0,0]}),style:{font:{name:style.fontName},fontSize:style.fontSize,fillColor:color(style),tracking:style.tracking/style.fontSize*1000,leading:lineHeight,autoLeading:false},paragraphStyle:{justification:style.alignment.toLowerCase() as 'left'|'center'|'right'},...(runs.length?{styleRuns:runs}:{})}
}

/** Editable solid vector paths for the editor's basic closed shapes. Lines remain
 * raster until the editor and PSD agree on stroked path/cap geometry. */
export function exportPhotoshopShape(layer:Layer,width:number,height:number):Pick<PhotoshopLayer,'vectorFill'|'vectorMask'|'vectorOrigination'|'vectorStroke'>|undefined {
 if(!layer.shape)return
 const style=validateShapeStyle(layer.shape);if(style.kind==='Line')return
 const m=matrix(layer.transform,width,height),knots:BezierKnot[]=[],k=.5522847498307936
 const add=(before:[number,number],anchor:[number,number],after:[number,number])=>knots.push({linked:true,points:[...point(m,...before),...point(m,...anchor),...point(m,...after)]})
 if(style.kind==='Ellipse'){
  const cx=width/2,cy=height/2,rx=width/2,ry=height/2
  add([cx-k*rx,0],[cx,0],[cx+k*rx,0]);add([width,cy-k*ry],[width,cy],[width,cy+k*ry]);add([cx+k*rx,height],[cx,height],[cx-k*rx,height]);add([0,cy+k*ry],[0,cy],[0,cy-k*ry])
 }else{
  const r=Math.min(style.cornerRadius,width/2,height/2)
  if(!r)for(const p of [[0,0],[width,0],[width,height],[0,height]] as [number,number][])add(p,p,p)
  else {add([r-k*r,0],[r,0],[r,0]);add([width-r,0],[width-r,0],[width-r+k*r,0]);add([width,r-k*r],[width,r],[width,r]);add([width,height-r],[width,height-r],[width,height-r+k*r]);add([width-r+k*r,height],[width-r,height],[width-r,height]);add([r,height],[r,height],[r-k*r,height]);add([0,height-r+k*r],[0,height-r],[0,height-r]);add([0,r],[0,r],[0,r-k*r])}
 }
 const corners=([[0,0],[width,0],[width,height],[0,height]] as [number,number][]).map(p=>point(m,...p)),xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),r=style.cornerRadius
 return {vectorFill:{type:'color',color:{r:style.red*255,g:style.green*255,b:style.blue*255}},vectorMask:{paths:[{open:false,operation:'combine',fillRule:'non-zero',knots}]},vectorStroke:{strokeEnabled:false,fillEnabled:true},vectorOrigination:{keyDescriptorList:[{keyOriginType:style.kind==='Ellipse'?5:r?2:1,keyOriginResolution:72,keyOriginShapeBoundingBox:{left:px(Math.min(...xs)),right:px(Math.max(...xs)),top:px(Math.min(...ys)),bottom:px(Math.max(...ys))},keyOriginBoxCorners:corners.map(([x,y])=>({x,y})),...(r?{keyOriginRRectRadii:{topLeft:px(r),topRight:px(r),bottomLeft:px(r),bottomRight:px(r)}}:{})}]}}
}
