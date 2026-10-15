/** Research candidate, not production. Freeze this mechanism before new native
 * holdouts: metric 3D nearest-depth density adds only a conservative floor. */
import {perspectiveCropMatrix,photoshopPerspectiveCropSize,type CropCorners,type CropPoint} from '../../src/shared/crop-projective'
export function nearestDepthPerspectiveSize(corners:CropCorners,sourceWidth:number,sourceHeight:number,aspect?:number,sourceCenter:CropPoint=[sourceWidth/2,sourceHeight/2]):{width:number;height:number}{
 const baseline=photoshopPerspectiveCropSize(corners,sourceWidth,sourceHeight,aspect,sourceCenter)
 if(aspect!==undefined)return baseline
 const h=perspectiveCropMatrix(corners,1,1),g=h[6],j=h[7]
 if(Math.abs(g*j)<=1e-12)return baseline
 const a=h[0]-sourceCenter[0]*g,d=h[3]-sourceCenter[1]*g,b=h[1]-sourceCenter[0]*j,e=h[4]-sourceCenter[1]*j,f2=-(a*b+d*e)/(g*j)
 if(!Number.isFinite(f2)||f2<=0)return baseline
 const W=Math.sqrt(a*a+d*d+f2*g*g),H=Math.sqrt(b*b+e*e+f2*j*j),ratio=W/H,length=(a:CropPoint,b:CropPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]),sourceW=Math.max(length(corners[0],corners[1]),length(corners[3],corners[2])),sourceH=Math.max(length(corners[0],corners[3]),length(corners[1],corners[2])),sourceRatio=sourceW/sourceH
 if(!Number.isFinite(ratio)||ratio<sourceRatio/4||ratio>sourceRatio*4)return baseline
 // K^-1 H gives physical plane edges W/f and H/f. The minimum positive
 // camera depth of its four corners is Dmin, so a fronto-parallel plane at
 // that depth has pixel density f/Dmin: its lengths are W/Dmin and H/Dmin.
 const minDepth=Math.min(...[1,1+g,1+g+j,1+j].map(Math.abs)),width=W/minDepth,height=H/minDepth
 if(!Number.isFinite(width)||!Number.isFinite(height)||width>4*sourceW||height>4*sourceH)return baseline
 const result={width:Math.max(baseline.width,Math.round(width)),height:Math.max(baseline.height,Math.round(height))}
 // Reuse the public dimension/resource and mapping validation without changing
 // explicit command dimensions or the legacy mean-edge size helper.
 perspectiveCropMatrix(corners,result.width,result.height)
 return result
}
