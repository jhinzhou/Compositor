import type {Layer as PhotoshopLayer} from 'ag-psd'
import {PNG} from 'pngjs'
import {EditorError,LIMITS} from '../shared/contracts'
import type {ShapeStyle} from '../shared/content-style'
export function photoshopShapeStyle(source:PhotoshopLayer):ShapeStyle|undefined{
 const origin=source.vectorOrigination?.keyDescriptorList?.[0],type=origin?.keyOriginType
 if(![1,2,5].includes(type??0)||source.vectorFill?.type!=='color'||source.vectorStroke?.fillEnabled===false)return
 const color=source.vectorFill.color,rgb='r' in color?[color.r/255,color.g/255,color.b/255]:'fr' in color?[color.fr,color.fg,color.fb]:undefined
 if(!rgb)return
 const radii=origin?.keyOriginRRectRadii,values=radii?[radii.topLeft.value,radii.topRight.value,radii.bottomLeft.value,radii.bottomRight.value]:[0]
 if(values.some(value=>!Number.isFinite(value)||value<0)||Math.max(...values)-Math.min(...values)>.5)return
 return {kind:type===5?'Ellipse':'Rectangle',red:rgb[0],green:rgb[1],blue:rgb[2],cornerRadius:type===2?Math.max(...values):0}
}
/** Recover a basic live shape when Photoshop did not save its raster channels; no Cairo/native canvas. */
export function photoshopShapeFallback(source:PhotoshopLayer,remainingPixels:number):{png:PNG;origin:[number,number];style:ShapeStyle}|undefined{
 let style=photoshopShapeStyle(source),bounds=source.vectorOrigination?.keyDescriptorList?.[0]?.keyOriginShapeBoundingBox,left=bounds?.left.value,top=bounds?.top.value,right=bounds?.right.value,bottom=bounds?.bottom.value
 if(!style&&source.vectorFill?.type==='color'&&source.vectorMask?.paths.length===1){const path=source.vectorMask.paths[0],knots=path.knots;if(!path.open&&knots.length===4&&knots.every(knot=>knot.points.length===6&&Math.hypot(knot.points[0]-knot.points[2],knot.points[1]-knot.points[3])<=.5&&Math.hypot(knot.points[4]-knot.points[2],knot.points[5]-knot.points[3])<=.5)){const anchors=knots.map(knot=>[knot.points[2],knot.points[3]]),synthetic={...source,vectorOrigination:{keyDescriptorList:[{keyOriginType:1}]}};left=Math.min(...anchors.map(p=>p[0]));right=Math.max(...anchors.map(p=>p[0]));top=Math.min(...anchors.map(p=>p[1]));bottom=Math.max(...anchors.map(p=>p[1]));const corners=new Set(anchors.map(([x,y])=>`${Math.abs(x-left!)<=.5?0:Math.abs(x-right!)<=.5?1:2},${Math.abs(y-top!)<=.5?0:Math.abs(y-bottom!)<=.5?1:2}`));if(corners.size===4&&['0,0','1,0','0,1','1,1'].every(corner=>corners.has(corner)))style=photoshopShapeStyle(synthetic)}}
 if(!style)return
 left??=source.left;right??=source.right;top??=source.top;bottom??=source.bottom
 if([left,right,top,bottom].some(value=>typeof value!=='number'||!Number.isFinite(value)))return
 const origin:[number,number]=[Math.floor(left!),Math.floor(top!)],width=Math.ceil(right!)-origin[0],height=Math.ceil(bottom!)-origin[1]
 if(width<1||height<1)return
 if(width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>Math.min(LIMITS.maxSurfacePixels,remainingPixels))throw new EditorError('RESOURCE_LIMIT','The reconstructed Photoshop shape exceeds the surface/document budget.')
 const png=new PNG({width,height}),radius=Math.min(style.cornerRadius,width/2,height/2),inside=(x:number,y:number)=>{if(style!.kind==='Ellipse')return ((x-width/2)/(width/2))**2+((y-height/2)/(height/2))**2<=1;if(radius===0)return true;const dx=Math.max(radius-x,x-(width-radius),0),dy=Math.max(radius-y,y-(height-radius),0);return dx*dx+dy*dy<=radius*radius}
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let coverage=0;for(const sy of [.25,.75])for(const sx of [.25,.75])if(inside(x+sx,y+sy))coverage++;if(coverage)png.data.set([Math.round(style.red*255),Math.round(style.green*255),Math.round(style.blue*255),Math.round(coverage*255/4)],(y*width+x)*4)}
 return {png,origin,style}
}
