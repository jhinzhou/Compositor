/** Native 1.4.8 MetalBrushCoverage continuousBrush translated to portable CPU math (MIT).
 * Produces stroke-wide coverage before selection/opacity. No pointer-event-dependent dabs. */
import {pencilStrokeCoverage} from './pencil-coverage'
import {compactStroke,strokeSegments} from './stroke-compaction'
import {LIMITS} from './limits'
import {dynamicBrushCoverage,type BrushDynamics,type BrushGrid} from './brush-dynamics'
const clamp=(v:number,lo=0,hi=1)=>Math.min(hi,Math.max(lo,v))
export function brushStrokeCoverage(grid:BrushGrid,points:[number,number][],size:number,hardness:number,dynamics:BrushDynamics={}):Uint8Array {
 const {width,height,transform:t}=grid
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels||!points.length||points.length>100_000||points.some(p=>p.some(v=>!Number.isFinite(v)))||!Number.isFinite(size)||size<1||size>4096||!Number.isFinite(hardness)||hardness<0||hardness>1)throw Error('Invalid brush coverage parameters.')
 if(dynamics.flow!==undefined&&(!Number.isFinite(dynamics.flow)||dynamics.flow<0||dynamics.flow>1))throw Error('Invalid brush flow.')
 if(dynamics.spacing!==undefined&&(!Number.isFinite(dynamics.spacing)||dynamics.spacing<.01||dynamics.spacing>10))throw Error('Invalid brush spacing.')
 if(dynamics.brushModel!==undefined&&dynamics.brushModel!=='compositor'&&dynamics.brushModel!=='photoshop')throw Error('Invalid brush model.')
 if(dynamics.pressures&&(dynamics.pressures.length!==points.length||dynamics.pressures.some(value=>!Number.isFinite(value)||value<0||value>1)))throw Error('Invalid brush pressure.')
 if(dynamics.tip==='pencil')return pencilStrokeCoverage(grid,points,size,dynamics)
 if(dynamics.brushModel==='photoshop'||dynamics.spacing!==undefined||dynamics.flow!==undefined&&dynamics.flow!==1||dynamics.pressures&&(dynamics.pressureSize!==false||dynamics.pressureOpacity))return dynamicBrushCoverage(grid,points,size,hardness,dynamics)
 const radius=size/2,antialias=Math.max(.001,Math.min(t.size[0]/width,t.size[1]/height)),spacing=Math.max(.25,size*(hardness>=1?.015:.025)),radiusSquared=radius*radius,angle=t.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),output=new Uint8Array(width*height),expEdge=Math.exp(-2.5),nodes=[.1834346425,.5255324099,.7966664774,.9602898565],weights=[.3626837834,.3137066459,.2223810345,.1012285363]
 const compacted=compactStroke(points,Math.min(.125,size*.005)),segments=strokeSegments(compacted,Math.max(8,size))
 const source=(x:number,y:number):[number,number]=>{const dx=x-t.origin[0]-t.size[0]/2,dy=y-t.origin[1]-t.size[1]/2;return [((dx*cos+dy*sin)*(t.flipX?-1:1)/t.size[0]+.5)*width,((-dx*sin+dy*cos)*(t.flipY?-1:1)/t.size[1]+.5)*height]}
 let roiLeft=width,roiTop=height,roiRight=0,roiBottom=0
 const rx=(radius+antialias)*width/t.size[0],ry=(radius+antialias)*height/t.size[1]
 for(const [x,y] of compacted){const [sx,sy]=source(x,y);roiLeft=Math.min(roiLeft,Math.max(0,Math.floor(sx-rx)));roiRight=Math.max(roiRight,Math.min(width,Math.ceil(sx+rx)));roiTop=Math.min(roiTop,Math.max(0,Math.floor(sy-ry)));roiBottom=Math.max(roiBottom,Math.min(height,Math.ceil(sy+ry)))}
 const roiWidth=Math.max(0,roiRight-roiLeft),roiHeight=Math.max(0,roiBottom-roiTop),density=hardness<1?new Float32Array(roiWidth*roiHeight):undefined
 const coverage=(d2:number)=>{const distance=Math.sqrt(d2);if(hardness>=1)return clamp((radius-distance)/antialias+.5);const u=clamp((distance/radius-hardness)/(1-hardness));return Math.max(0,(Math.exp(-2.5*u*u)-expEdge)/(1-expEdge))},tipDensity=(d2:number)=>-Math.log(Math.max(1-coverage(d2),.001))
 let visits=0
 for(const [ax,ay,bx,by] of segments){const [a0,a1]=source(ax,ay),[b0,b1]=source(bx,by),rx=(radius+antialias)*width/t.size[0],ry=(radius+antialias)*height/t.size[1],left=Math.max(0,Math.floor(Math.min(a0,b0)-rx)),right=Math.min(width,Math.ceil(Math.max(a0,b0)+rx)),top=Math.max(0,Math.floor(Math.min(a1,b1)-ry)),bottom=Math.min(height,Math.ceil(Math.max(a1,b1)+ry)),vx=bx-ax,vy=by-ay,lengthSquared=vx*vx+vy*vy,length=Math.sqrt(lengthSquared)
  visits+=(right-left)*(bottom-top);if(visits>80_000_000)throw Error('Brush coverage exceeds the compute budget; use shorter strokes.')
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const u=((x+.5)/width-.5)*t.size[0]*(t.flipX?-1:1),v=((y+.5)/height-.5)*t.size[1]*(t.flipY?-1:1),px=t.origin[0]+t.size[0]/2+u*cos-v*sin,py=t.origin[1]+t.size[1]/2+u*sin+v*cos;if(grid.canvasWidth!==undefined&&(px<0||px>=grid.canvasWidth)||grid.canvasHeight!==undefined&&(py<0||py>=grid.canvasHeight))continue;const p=y*width+x,dx=px-ax,dy=py-ay
   if(hardness>=1){const projection=clamp((dx*vx+dy*vy)/Math.max(lengthSquared,1e-12)),distanceSquared=(dx-projection*vx)**2+(dy-projection*vy)**2;output[p]=Math.max(output[p],Math.round(255*coverage(distanceSquared)));continue}
   let added=0
   if(length<1e-6)added=tipDensity(dx*dx+dy*dy)
   else{const directionX=vx/length,directionY=vy/length,projection=dx*directionX+dy*directionY,perpendicularSquared=(dx-projection*directionX)**2+(dy-projection*directionY)**2;if(perpendicularSquared>=radiusSquared)continue;const reach=Math.sqrt(radiusSquared-perpendicularSquared),lo=Math.max(0,projection-reach),hi=Math.min(length,projection+reach);if(hi<=lo)continue;const midpoint=(lo+hi)/2,half=(hi-lo)/2;for(let i=0;i<4;i++){const a=midpoint-half*nodes[i]-projection,b=midpoint+half*nodes[i]-projection;added+=weights[i]*(tipDensity(perpendicularSquared+a*a)+tipDensity(perpendicularSquared+b*b))}added*=half/spacing}
   const local=(y-roiTop)*roiWidth+x-roiLeft;density![local]=Math.min(20,density![local]+added)
  }
 }
 if(density)for(let y=roiTop;y<roiBottom;y++)for(let x=roiLeft;x<roiRight;x++)output[y*width+x]=Math.round(255*(1-Math.exp(-density[(y-roiTop)*roiWidth+x-roiLeft])))
 return output
}
