import {validatePerspectiveCrop,type CropCorners,type CropPoint} from '../shared/crop-projective'
/** Shift locks a corner to its original document-space horizontal/vertical axis,
 * independent of view rotation; whole-frame translation never uses this helper. */
export function constrainCropCorner(initial:CropPoint,next:CropPoint,shift:boolean):CropPoint {
 if(!shift)return [...next]
 return Math.abs(next[0]-initial[0])>=Math.abs(next[1]-initial[1])?[next[0],initial[1]]:[initial[0],next[1]]
}
export function clockwiseCropPoints(points:readonly CropPoint[],width:number,height:number):CropCorners|undefined {
 if(points.length!==4)return
 const corners=points.map(p=>[...p]) as CropCorners
 try{validatePerspectiveCrop(corners,width,height)}catch{return}
 // Display/document y points down: TL -> TR -> BR -> BL has positive cross.
 const [a,b,c]=corners
 if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<=0)return
 return corners
}
/** SDR feedback only. Edge-coordinate sampling uses premultiplied interpolation;
 * hidden RGB and off-raster pixels cannot inject colored fringes. */
export function sampleCropFeedback(data:Uint8ClampedArray,width:number,height:number,u:number,v:number):[number,number,number,number] {
 const left=Math.floor(u-.5),top=Math.floor(v-.5),fx=u-.5-left,fy=v-.5-top,out:[number,number,number,number]=[0,0,0,0]
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const x=left+dx,y=top+dy;if(x<0||y<0||x>=width||y>=height)continue
  const at=(y*width+x)*4,weight=(dx?fx:1-fx)*(dy?fy:1-fy),alpha=data[at+3]/255
  out[3]+=alpha*weight;for(let c=0;c<3;c++)out[c]+=data[at+c]*alpha*weight
 }
 const alpha=out[3];for(let c=0;c<3;c++)out[c]=alpha?Math.round(out[c]/alpha):0;out[3]=Math.round(alpha*255);return out
}
