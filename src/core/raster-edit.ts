import {brushStrokeCoverage} from '../shared/brush-coverage'
import {LIMITS} from '../shared/limits'
import { PNG } from 'pngjs'
import type { Layer } from '../shared/contracts'
import type { RGBA, Selection } from '../shared/pixel-contracts'

export function documentPoint(layer: Layer, x: number, y: number, width: number, height: number): [number,number] {
  const t=layer.transform, a=t.rotation*Math.PI/180
  const u=(x/width-.5)*t.size[0]*(t.flipX?-1:1), v=(y/height-.5)*t.size[1]*(t.flipY?-1:1)
  return [t.origin[0]+t.size[0]/2+u*Math.cos(a)-v*Math.sin(a),t.origin[1]+t.size[1]/2+u*Math.sin(a)+v*Math.cos(a)]
}
export {selectionCoverage,sourcePoint} from '../shared/selection-coverage'
import {selectionCoverage} from '../shared/selection-coverage'
export function blankPNG(width:number,height:number,gray?:number):PNG {
  const png=new PNG({width,height})
  if(gray!==undefined)for(let i=0;i<png.data.length;i+=4)png.data.set([gray,gray,gray,255],i)
  return png
}
export function encodeRaster(png:PNG,mask=false):Buffer {
  if(!mask)return PNG.sync.write(png)
  // Native masks must be 8-bit grayscale without alpha.
  const gray=Buffer.alloc(png.width*png.height)
  for(let i=0;i<gray.length;i++)gray[i]=png.data[i*4]
  return PNG.sync.write({width:png.width,height:png.height,data:gray} as PNG,{colorType:0,inputColorType:0,bitDepth:8})
}
function blend(png:PNG,index:number,color:RGBA,coverage:number,erase:boolean,mask:boolean):void {
  if(coverage<=0)return
  if(mask){const value=png.data[index]*(1-coverage)+color[0]*255*coverage;png.data.set([value,value,value,255],index);return}
  const sa=color[3]*coverage,da=png.data[index+3]/255
  if(erase){png.data[index+3]=Math.round(da*(1-sa)*255);if(!png.data[index+3])png.data.fill(0,index,index+3);return}
  const a=sa+da*(1-sa)
  if(a<=0)return
  for(let c=0;c<3;c++)png.data[index+c]=Math.round((color[c]*sa+png.data[index+c]/255*da*(1-sa))/a*255)
  png.data[index+3]=Math.round(a*255)
}
export function paintRaster(png:PNG,layer:Layer,points:[number,number][],color:RGBA,size:number,hardness:number,opacity:number,erase:boolean,selection:Selection|null,mask=false,canvasSize?:[number,number]):void {
  const coverage=brushStrokeCoverage({width:png.width,height:png.height,transform:layer.transform,...(canvasSize?{canvasWidth:canvasSize[0],canvasHeight:canvasSize[1]}:{})},points,size,hardness)
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const i=y*png.width+x;if(!coverage[i])continue;const point=documentPoint(layer,x+.5,y+.5,png.width,png.height);blend(png,i*4,color,coverage[i]/255*selectionCoverage(selection,...point)*opacity,erase,mask)}
}
export function fillRaster(png:PNG,layer:Layer,color:RGBA,selection:Selection|null,mask=false):void {
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const p=documentPoint(layer,x+.5,y+.5,png.width,png.height);blend(png,(y*png.width+x)*4,color,selectionCoverage(selection,...p),false,mask)}
}
export function gradientRaster(png:PNG,layer:Layer,start:[number,number],end:[number,number],from:RGBA,to:RGBA,radial:boolean,selection:Selection|null,opacity=1,mask=false,canvasSize?:[number,number]):void {
  const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.max(.001,dx*dx+dy*dy)
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const p=documentPoint(layer,x+.5,y+.5,png.width,png.height)
    if(canvasSize&&(p[0]<0||p[1]<0||p[0]>=canvasSize[0]||p[1]>=canvasSize[1]))continue
    const t=Math.min(1,Math.max(0,radial?Math.hypot(p[0]-start[0],p[1]-start[1])/Math.sqrt(length):((p[0]-start[0])*dx+(p[1]-start[1])*dy)/length))
    const rgba=from.map((v,i)=>v+(to[i]-v)*t) as RGBA
    blend(png,(y*png.width+x)*4,rgba,selectionCoverage(selection,...p)*opacity*(mask?rgba[3]:1),false,mask)
  }
}
export function resizeRaster(source:PNG,width:number,height:number):PNG {
  const target=blankPNG(width,height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=(x+.5)*source.width/width-.5,sy=(y+.5)*source.height/height-.5,x0=Math.floor(sx),y0=Math.floor(sy),tx=sx-x0,ty=sy-y0
    let alpha=0;const channels=[0,0,0]
    for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){
      const i=(Math.min(source.height-1,Math.max(0,y0+yy))*source.width+Math.min(source.width-1,Math.max(0,x0+xx)))*4,weight=(xx?tx:1-tx)*(yy?ty:1-ty),a=source.data[i+3]/255
      alpha+=a*weight;for(let c=0;c<3;c++)channels[c]+=source.data[i+c]*a*weight
    }
    const i=(y*width+x)*4;for(let c=0;c<3;c++)target.data[i+c]=alpha?Math.round(channels[c]/alpha):0;target.data[i+3]=Math.round(alpha*255)
  }
  return target
}
