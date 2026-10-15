import type {BrushGrid,BrushDynamics} from './brush-dynamics'
/** Binary, document-pixel-aligned pencil marks. Opacity/selection are applied by
 * the existing compositor; pressure-opacity changes strength, never edge AA. */
export function pencilStrokeCoverage(grid:BrushGrid,points:[number,number][],size:number,dynamics:BrushDynamics):Uint8Array {
 const {width,height,transform:t}=grid,output=new Uint8Array(width*height),angle=t.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle)
 const source=(x:number,y:number):[number,number]=>{const dx=x-t.origin[0]-t.size[0]/2,dy=y-t.origin[1]-t.size[1]/2;return [((dx*cos+dy*sin)*(t.flipX?-1:1)/t.size[0]+.5)*width,((-dx*sin+dy*cos)*(t.flipY?-1:1)/t.size[1]+.5)*height]}
 let visits=0,dabs=0
 const stamp=(x:number,y:number,pressure:number)=>{
  if(++dabs>200_000)throw Error('Pencil stroke exceeds its geometry budget.')
  const radius=Math.max(.5,size/2*(dynamics.pressures&&dynamics.pressureSize!==false?pressure:1)),strength=dynamics.pressures&&dynamics.pressureOpacity?pressure:1
  if(pressure===0&&dynamics.pressures&&dynamics.pressureSize!==false||strength<=0)return
  x=Math.floor(x)+.5;y=Math.floor(y)+.5;const [sx,sy]=source(x,y),rx=radius*width/t.size[0],ry=radius*height/t.size[1],left=Math.max(0,Math.floor(sx-rx)),right=Math.min(width,Math.ceil(sx+rx)),top=Math.max(0,Math.floor(sy-ry)),bottom=Math.min(height,Math.ceil(sy+ry))
  visits+=Math.max(0,right-left)*Math.max(0,bottom-top);if(visits>80_000_000)throw Error('Pencil stroke exceeds the compute budget; use a shorter stroke.')
  for(let row=top;row<bottom;row++)for(let column=left;column<right;column++){
   const u=((column+.5)/width-.5)*t.size[0]*(t.flipX?-1:1),v=((row+.5)/height-.5)*t.size[1]*(t.flipY?-1:1),px=t.origin[0]+t.size[0]/2+u*cos-v*sin,py=t.origin[1]+t.size[1]/2+u*sin+v*cos
   if(grid.canvasWidth!==undefined&&(px<0||px>=grid.canvasWidth)||grid.canvasHeight!==undefined&&(py<0||py>=grid.canvasHeight))continue
   if((px-x)**2+(py-y)**2<radius*radius+1e-9)output[row*width+column]=Math.max(output[row*width+column],Math.round(strength*255))
  }
 }
 stamp(...points[0],dynamics.pressures?.[0]??1)
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],steps=Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1])));if(!steps){stamp(...b,dynamics.pressures?.[i]??1);continue}for(let step=1;step<=steps;step++){const f=step/steps,p=(dynamics.pressures?.[i-1]??1)+((dynamics.pressures?.[i]??1)-(dynamics.pressures?.[i-1]??1))*f;stamp(a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,p)}}
 return output
}
