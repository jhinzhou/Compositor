import {PNG} from 'pngjs'
import {EditorError,LIMITS,type Layer,type Transform} from '../shared/contracts'
import {documentPoint,sourcePoint} from './raster-edit'
import {prepareLayerSampleSource} from './document-sampler'

export interface ImageSizePlacement {transform:Transform;bounds:[number,number,number,number]}
/** Native ImageResizer bakes each scaled document-space quadrilateral into an
 * upright grid: a rotated layer stretched unevenly must retain its shear. */
export function imageSizePlacement(placement:Transform,sx:number,sy:number,sampling:Transform['sampling']='High quality'):ImageSizePlacement {
 if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<=0||sy<=0)throw new EditorError('INVALID_ARGUMENT','Image scaling needs positive finite factors.')
 const layer={transform:{...placement,flipX:false,flipY:false}} as Layer,corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>{const p=documentPoint(layer,x,y,1,1);return [p[0]*sx,p[1]*sy]}),left=Math.floor(Math.min(...corners.map(p=>p[0]))),top=Math.floor(Math.min(...corners.map(p=>p[1]))),width=Math.ceil(Math.max(...corners.map(p=>p[0])))-left,height=Math.ceil(Math.max(...corners.map(p=>p[1])))-top
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new EditorError('RESOURCE_LIMIT','The resized layer placement is invalid.')
 return {bounds:[left,top,width,height],transform:{origin:[left,top],size:[width,height],rotation:0,flipX:false,flipY:false,sampling}}
}
export function bakeImageSizeRaster(source:PNG,placement:Transform,sx:number,sy:number,sampling:Transform['sampling']='High quality',mask=false):{png:PNG;transform:Transform} {
 const output=imageSizePlacement(placement,sx,sy,sampling),[left,top,width,height]=output.bounds
 if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','A resized raster exceeds the pixel budget.')
 const png=new PNG({width,height}),layer={transform:placement} as Layer,nearest=sampling==='Nearest',angle=placement.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),uHalo=(Math.abs(c/sx)+Math.abs(s/sy))*source.width/placement.size[0]/2,vHalo=(Math.abs(s/sx)+Math.abs(c/sy))*source.height/placement.size[1]/2
 // Masks use native drawCoverage directly; color rasters use the shared
 // sharp halvings. Rounded odd sizes retain exactly 2^level source-pixel phase.
 const prepared=!nearest&&!mask?prepareLayerSampleSource(source,placement.size[0]*sx/source.width,sampling):null,sample=prepared?.source??source,scale=prepared?.scale??1,extentW=sample.width*scale,extentH=sample.height*scale,copyFinal=!mask&&placement.rotation===0&&Math.abs(placement.size[0]*sx/source.width*scale-1)<.001
 const uv=(x:number,y:number)=>sourcePoint(layer,x/sx,y/sy,source.width,source.height)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  // Core Graphics's aliased image coverage fills intersecting destination
  // pixels, sampling nearest at their centers with edge clamping. The two
  // source-axis projections are the separating axes for that pixel footprint.
  const [u,v]=uv(left+x+.5,top+y+.5),inside=nearest?u>=-uHalo-1e-9&&v>=-vHalo-1e-9&&u<=source.width+uHalo+1e-9&&v<=source.height+vHalo+1e-9:u>=0&&v>=0&&u<extentW&&v<extentH
  let coverage=inside?1:0
  if(!nearest&&!(inside&&u>=uHalo&&v>=vHalo&&u<extentW-uHalo&&v<extentH-vHalo)){
   coverage=0;for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++){const [a,b]=uv(left+x+(xx+.5)/4,top+y+(yy+.5)/4);if(a>=0&&b>=0&&a<extentW&&b<extentH)coverage+=1/16}
  }
  const at=(y*width+x)*4
  if(coverage===0){if(mask)png.data[at+3]=255;continue}
  if(nearest){const ix=Math.max(0,Math.min(source.width-1,Math.floor(u+1e-9))),iy=Math.max(0,Math.min(source.height-1,Math.floor(v+1e-9))),i=(iy*source.width+ix)*4;if(mask){const gray=source.data[i];png.data.set([gray,gray,gray,255],at)}else source.data.copy(png.data,at,i,i+4);continue}
  if(copyFinal){const i=(Math.max(0,Math.min(sample.height-1,Math.floor(v/scale+1e-9)))*sample.width+Math.max(0,Math.min(sample.width-1,Math.floor(u/scale+1e-9))))*4,alpha=sample.data[i+3];for(let channel=0;channel<3;channel++)png.data[at+channel]=alpha?Math.round(Math.min(255,sample.data[i+channel]*255/alpha)):0;png.data[at+3]=Math.round(alpha*coverage);continue}
  const px=Math.max(0,Math.min(sample.width-1,u/scale-.5)),py=Math.max(0,Math.min(sample.height-1,v/scale-.5)),ix=Math.floor(px),iy=Math.floor(py),tx=px-ix,ty=py-iy,values=[0,0,0,0]
  for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){const i=(Math.min(sample.height-1,iy+yy)*sample.width+Math.min(sample.width-1,ix+xx))*4,weight=(xx?tx:1-tx)*(yy?ty:1-ty);values[3]+=(mask?255:sample.data[i+3])*weight;for(let channel=0;channel<3;channel++)values[channel]+=sample.data[i+(mask?0:channel)]*weight}
  if(mask){const gray=Math.round(values[0]*coverage);png.data.set([gray,gray,gray,255],at)}else {for(let channel=0;channel<3;channel++)png.data[at+channel]=values[3]?Math.round(Math.min(255,values[channel]*255/values[3])):0;png.data[at+3]=Math.round(values[3]*coverage)}
 }
 return {png,transform:output.transform}
}
