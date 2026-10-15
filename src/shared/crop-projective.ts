import {EditorError} from './errors'
import {LIMITS} from './limits'
import type {z} from 'zod'
import type {transformSchema} from './transform'
type Transform=z.infer<typeof transformSchema>
export type CropPoint=[number,number]
export type CropCorners=[CropPoint,CropPoint,CropPoint,CropPoint]
export interface CropRectangle {x:number;y:number;width:number;height:number}
export const cropCorners=(r:CropRectangle):CropCorners=>[[r.x,r.y],[r.x+r.width,r.y],[r.x+r.width,r.y+r.height],[r.x,r.y+r.height]]
export function validatePerspectiveCrop(corners:readonly CropPoint[],width:number,height:number):asserts corners is CropCorners {
 if(corners.length!==4||corners.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1_000_000)))throw new EditorError('INVALID_ARGUMENT','Perspective Crop requires four finite ordered corners.')
 let sign=0
 for(let i=0;i<4;i++){const a=corners[i],b=corners[(i+1)%4],c=corners[(i+2)%4],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<.01||Math.hypot(b[0]-a[0],b[1]-a[1])<1)throw new EditorError('INVALID_ARGUMENT','Perspective Crop requires a non-degenerate convex quadrilateral.');if(!sign)sign=Math.sign(cross);else if(sign!==Math.sign(cross))throw new EditorError('INVALID_ARGUMENT','Perspective Crop requires a non-degenerate convex quadrilateral.')}
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>LIMITS.maxSide||height>LIMITS.maxSide||width*height>LIMITS.maxSurfacePixels)throw new EditorError('RESOURCE_LIMIT','Crop dimensions exceed the supported canvas size.')
 // The denominator must have one nonzero sign over the whole output rectangle.
 const h=perspectiveCropMatrixUnchecked(corners as CropCorners),den=[h[8],h[6]+h[8],h[6]+h[7]+h[8],h[7]+h[8]]
 if(den.some(d=>!Number.isFinite(d)||Math.abs(d)<1e-8||Math.sign(d)!==Math.sign(den[0])))throw new EditorError('INVALID_ARGUMENT','Perspective Crop has a singular mapping.')
}
function perspectiveCropMatrixUnchecked([a,b,c,d]:CropCorners):number[]{
 const sx=a[0]-b[0]+c[0]-d[0],sy=a[1]-b[1]+c[1]-d[1];let g=0,h=0
 if(Math.abs(sx)>1e-10||Math.abs(sy)>1e-10){const x1=b[0]-c[0],x2=d[0]-c[0],y1=b[1]-c[1],y2=d[1]-c[1],det=x1*y2-x2*y1;if(Math.abs(det)<1e-12)throw new EditorError('INVALID_ARGUMENT','Perspective Crop has a singular mapping.');g=(sx*y2-x2*sy)/det;h=(x1*sy-sx*y1)/det}
 return [b[0]-a[0]+g*b[0],d[0]-a[0]+h*d[0],a[0],b[1]-a[1]+g*b[1],d[1]-a[1]+h*d[1],a[1],g,h,1]
}
/** Maps normalized output edge coordinates (0..1) back into the source document.
 * Destination pixel centers therefore use ((x+.5)/width,(y+.5)/height). */
export function perspectiveCropMatrix(corners:CropCorners,width:number,height:number):number[]{validatePerspectiveCrop(corners,width,height);return perspectiveCropMatrixUnchecked(corners)}
export function mapCropPoint(h:readonly number[],x:number,y:number):CropPoint{const w=h[6]*x+h[7]*y+h[8];return [(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w]}
/** Historical approximation retained for callers and older fixture geometry.
 * It interprets the supplied points as inclusive source pixel-center markers,
 * expands them into the public edge-coordinate quad and samples the midpoint
 * on a one-pixel axis. This is NOT current Photoshop GUI event semantics:
 * alpha.26 native perspectiveCrop descriptors provide source EDGE corners
 * directly, so those corners must not pass through this extra expansion.
 * The command/MCP contract remains unchanged; legacy callers opt in explicitly. */
export function photoshopPerspectiveCropCorners(corners:CropCorners,width:number,height:number):CropCorners {
 validatePerspectiveCrop(corners,width,height)
 const centers=corners.map(([x,y])=>[x+.5,y+.5]) as CropCorners,matrix=perspectiveCropMatrixUnchecked(centers)
 const left=width>1?-.5/(width-1):0,right=width>1?1+.5/(width-1):1,top=height>1?-.5/(height-1):0,bottom=height>1?1+.5/(height-1):1
 const result=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([u,v])=>mapCropPoint(matrix,u,v)) as CropCorners
 validatePerspectiveCrop(result,width,height)
 return result
}
/** Default output follows the mean length of opposite edges, in document pixels. */
export function perspectiveCropSize(corners:CropCorners,aspect?:number):{width:number;height:number}{const length=(a:CropPoint,b:CropPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);const width=Math.max(1,Math.round((length(corners[0],corners[1])+length(corners[3],corners[2]))/2)),height=Math.max(1,Math.round(aspect&&aspect>0?width/aspect:(length(corners[0],corners[3])+length(corners[1],corners[2]))/2));validatePerspectiveCrop(corners,width,height);return {width,height}}
/** Photoshop-profile automatic size for source EDGE corners. REA geometry
 * evidence ev_9b782e07baa573a43ed31571e662b742c15f1882e68fbd2dc833ff9e925e7be2:
 * rectify the camera plane, then use the greatest source/rectified length ratio
 * from the eight endpoint 10% edge segments. Captured native outputs establish
 * the subsequent center-phase extent. This does not establish pixel sampling.
 * Explicit ratios keep the previous longest-span sizing; command/MCP explicit
 * output dimensions never call this UI helper. Dangerous inferred cameras keep
 * the existing four-span/area bound and a conservative finite fallback. */
export function photoshopPerspectiveCropSize(corners:CropCorners,sourceWidth:number,sourceHeight:number,aspect?:number,sourceCenter:CropPoint=[sourceWidth/2,sourceHeight/2]):{width:number;height:number} {
 validatePerspectiveCrop(corners,1,1)
 if(!Number.isFinite(sourceWidth)||!Number.isFinite(sourceHeight)||sourceWidth<=0||sourceHeight<=0||sourceCenter.length!==2||sourceCenter.some(value=>!Number.isFinite(value)||Math.abs(value)>1_000_000))throw new EditorError('INVALID_ARGUMENT','Perspective Crop requires finite source dimensions and principal point.')
 const length=(a:CropPoint,b:CropPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1])
 const lengths=corners.map((point,index)=>length(point,corners[(index+1)%4])),longestWidth=Math.max(lengths[0],lengths[2]),longestHeight=Math.max(lengths[1],lengths[3]),sourceAspect=longestWidth/longestHeight
 let rawWidth=longestWidth,rawHeight=longestHeight
 if(aspect!==undefined){
  if(!Number.isFinite(aspect)||aspect<=0)throw new EditorError('INVALID_ARGUMENT','Crop ratio must be positive and finite.')
  rawWidth=Math.max(longestWidth,longestHeight*aspect);rawHeight=Math.max(longestHeight,longestWidth/aspect)
 }else{
  const h=perspectiveCropMatrixUnchecked(corners),g=h[6],j=h[7],a=h[0]-sourceCenter[0]*g,d=h[3]-sourceCenter[1]*g,b=h[1]-sourceCenter[0]*j,e=h[4]-sourceCenter[1]*j
  // Preserve the old near-affine threshold and inferred aspect/area guards.
  // An infinite or invalid-focal vanishing point uses longest source spans.
  if(Math.abs(g*j)>1e-12){
   const focalSquared=-(a*b+d*e)/(g*j)
   if(Number.isFinite(focalSquared)&&focalSquared>0){
    const candidate=Math.sqrt((a*a+d*d+focalSquared*g*g)/(b*b+e*e+focalSquared*j*j))
    if(Number.isFinite(candidate)&&candidate>=sourceAspect/4&&candidate<=sourceAspect*4){
     rawWidth=Math.max(longestWidth,longestHeight*candidate);rawHeight=Math.max(longestHeight,longestWidth/candidate)
     const determinant=h[0]*(h[4]-h[5]*j)-h[1]*(h[3]-h[5]*g)+h[2]*(h[3]*j-h[4]*g),denominators=[1,1+g,1+g+j,1+j]
     const area=Math.max(...denominators.map(denominator=>Math.abs(determinant/denominator**3))),areaWidth=Math.sqrt(area*candidate),areaHeight=Math.sqrt(area/candidate)
     if(Number.isFinite(areaWidth)&&Number.isFinite(areaHeight)&&areaWidth<=4*longestWidth&&areaHeight<=4*longestHeight){
      const native=rectifiedPerspectiveSize(corners,sourceCenter,lengths)
      if(native&&native[0]<=4*longestWidth&&native[1]<=4*longestHeight){[rawWidth,rawHeight]=native}
     }
    }
   }
  }
 }
 const roundedWidth=Math.max(1,Math.floor(rawWidth+.5)),roundedHeight=Math.max(1,Math.floor(rawHeight+.5))
 // The rounded rectangle is translated by the original center before outward
 // canvas extent conversion. This depends on center phase, not source parity.
 // User ratios retain their old sizing and do not receive automatic phase.
 const width=aspect===undefined?Math.ceil(sourceCenter[0]+roundedWidth)-Math.floor(sourceCenter[0]):roundedWidth,height=aspect===undefined?Math.ceil(sourceCenter[1]+roundedHeight)-Math.floor(sourceCenter[1]):roundedHeight
 validatePerspectiveCrop(corners,width,height)
 return {width,height}
}
export interface PerspectiveCropGeometry {
 roundedSize:{width:number;height:number}
 extent:{width:number;height:number}
 phase:CropPoint
 /** Source edge quad covering the integer canvas extent, including phase padding. */
 corners:CropCorners
}
/** Automatic Photoshop output frame. Keep the user-facing source quad intact;
 * apply this derived quad only when committing automatic dimensions. Explicit
 * ratios have no center phase and preserve their existing edge mapping. */
export function photoshopPerspectiveCropGeometry(corners:CropCorners,sourceWidth:number,sourceHeight:number,aspect?:number,sourceCenter:CropPoint=[sourceWidth/2,sourceHeight/2]):PerspectiveCropGeometry {
 const extent=photoshopPerspectiveCropSize(corners,sourceWidth,sourceHeight,aspect,sourceCenter)
 const phase:CropPoint=aspect===undefined?[sourceCenter[0]-Math.floor(sourceCenter[0]),sourceCenter[1]-Math.floor(sourceCenter[1])]:[0,0]
 const roundedSize={width:extent.width-(phase[0]>0?1:0),height:extent.height-(phase[1]>0?1:0)}
 return {roundedSize,extent,phase,corners:perspectiveCropExtentCorners(corners,roundedSize,extent,phase)}
}
/** Extend the source homography to the outward-rounded canvas. Existing raster
 * and channel/mask samplers can then retain their public edge-coordinate map:
 * (x+.5)/extent becomes (x+.5-phase)/roundedSize in the original quad. */
export function perspectiveCropExtentCorners(corners:CropCorners,roundedSize:{width:number;height:number},extent:{width:number;height:number},phase:CropPoint):CropCorners {
 validatePerspectiveCrop(corners,roundedSize.width,roundedSize.height)
 validatePerspectiveCrop(corners,extent.width,extent.height)
 if(phase.length!==2||phase.some(value=>!Number.isFinite(value)||value<0||value>=1)||extent.width!==roundedSize.width+(phase[0]>0?1:0)||extent.height!==roundedSize.height+(phase[1]>0?1:0))throw new EditorError('INVALID_ARGUMENT','Perspective Crop requires a consistent finite output phase.')
 if(phase[0]===0&&phase[1]===0)return corners.map(point=>[...point]) as CropCorners
 const matrix=perspectiveCropMatrixUnchecked(corners)
 const left=-phase[0]/roundedSize.width,right=(extent.width-phase[0])/roundedSize.width,top=-phase[1]/roundedSize.height,bottom=(extent.height-phase[1])/roundedSize.height
 // Even a valid source quad may approach a pole just outside its frame. Check
 // the expanded normalized bounds BEFORE dividing so extrapolation cannot
 // silently jump over a horizon and happen to produce a second convex quad.
 const denominators=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>matrix[6]*x+matrix[7]*y+matrix[8])
 if(denominators.some(value=>!Number.isFinite(value)||Math.abs(value)<1e-8||Math.sign(value)!==Math.sign(matrix[8])))throw new EditorError('INVALID_ARGUMENT','Perspective Crop output phase has a singular mapping.')
 const result=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([x,y])=>mapCropPoint(matrix,x,y)) as CropCorners
 validatePerspectiveCrop(result,extent.width,extent.height)
 return result
}
/** Finite positive-camera route recovered from native instructions. Undefined
 * means numerical geometry is unsafe; the caller keeps its bounded fallback. */
function rectifiedPerspectiveSize(corners:CropCorners,center:CropPoint,lengths:readonly number[]):CropPoint|undefined {
 type V3=[number,number,number]
 const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
 const line=(a:CropPoint,b:CropPoint)=>cross([a[0],a[1],1],[b[0],b[1],1])
 const points=corners.map(([x,y])=>[x-center[0],y-center[1]]) as CropCorners
 const U=cross(line(points[0],points[1]),line(points[2],points[3])),V=cross(line(points[1],points[2]),line(points[3],points[0]))
 if(U[2]===0||V[2]===0)return
 const u:CropPoint=[U[0]/U[2],U[1]/U[2]],v:CropPoint=[V[0]/V[2],V[1]/V[2]],focalSquared=-(u[0]*v[0]+u[1]*v[1]),focal=Math.sqrt(focalSquared)
 if(!Number.isFinite(focal)||focal<=0)return
 const normal=cross([u[0],u[1],focal],[v[0],v[1],focal]),norm=Math.hypot(...normal),[nx,ny,nz]=normal.map(value=>value/norm),xy=nx*nx+ny*ny
 if(!Number.isFinite(norm)||norm<=0||!Number.isFinite(xy)||xy<1e-14)return
 const denominators=points.map(([x,y])=>nx*x+ny*y+nz*focal),scale=Math.max(...denominators.map(Math.abs))
 if(!Number.isFinite(scale)||scale===0||denominators.some(value=>!Number.isFinite(value)||Math.abs(value)<scale*1e-8||Math.sign(value)!==Math.sign(denominators[0])))return
 const m00=(ny*ny+nx*nx*nz)/xy,m11=(nx*nx+ny*ny*nz)/xy,m01=nx*ny*(nz-1)/xy
 const rectify=([x,y]:CropPoint):CropPoint=>{const z=focalSquared*nz/(nx*x+ny*y+nz*focal),rx=x*z/focal,ry=y*z/focal;return [m00*rx+m01*ry-nx*z,m01*rx+m11*ry-ny*z]}
 const rectified=points.map(rectify),distance=(a:CropPoint,b:CropPoint)=>Math.hypot(a[0]-b[0],a[1]-b[1]);let maximum=0
 for(let i=0;i<4;i++){
  const j=(i+1)%4,p=points[i],q=points[j]
  // Distinct native double constants: 1-.9 is .09999999999999998.
  const nearP=rectify([.9*p[0]+(1-.9)*q[0],.9*p[1]+(1-.9)*q[1]]),nearQ=rectify([.1*p[0]+.9*q[0],.1*p[1]+.9*q[1]])
  const ratios=[lengths[i]*.1/distance(rectified[i],nearP),lengths[i]*.1/distance(rectified[j],nearQ)]
  if(ratios.some(value=>!Number.isFinite(value)||value<=0))return
  maximum=Math.max(maximum,...ratios)
 }
 const width=.5*(distance(rectified[0],rectified[1])+distance(rectified[2],rectified[3]))*maximum,height=.5*(distance(rectified[1],rectified[2])+distance(rectified[3],rectified[0]))*maximum
 return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0?[width,height]:undefined
}
export function straightenAngle(start:CropPoint,end:CropPoint):number{if(start.some(v=>!Number.isFinite(v))||end.some(v=>!Number.isFinite(v))||Math.hypot(end[0]-start[0],end[1]-start[1])<1)throw new EditorError('INVALID_ARGUMENT','Draw a longer straighten reference line.');const a=Math.atan2(end[1]-start[1],end[0]-start[0])*180/Math.PI;return -(a-Math.round(a/90)*90)}
export function rotateCropPoint(point:CropPoint,center:CropPoint,angle:number):CropPoint{const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=point[0]-center[0],y=point[1]-center[1];return [center[0]+c*x-s*y,center[1]+s*x+c*y]}
export function straightenPlacement(t:Transform,width:number,height:number,angle:number,crop?:CropRectangle):Transform{const p=rotateCropPoint([t.origin[0]+t.size[0]/2,t.origin[1]+t.size[1]/2],[width/2,height/2],angle);return {...t,origin:[p[0]-t.size[0]/2-(crop?.x??0),p[1]-t.size[1]/2-(crop?.y??0)],rotation:t.rotation+angle}}
/** Centered axis-aligned inner frame with the original aspect ratio. The scale
 * is chosen by inverse-rotating its four corners, so no transparent wedges remain. */
export function straightenCrop(width:number,height:number,angle:number,aspect=width/height):CropRectangle{if(!Number.isFinite(aspect)||aspect<=0)throw new EditorError('INVALID_ARGUMENT','Crop ratio must be positive and finite.');const a=Math.abs(angle)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a)),extent=Math.min(width/(aspect*c+s),height/(aspect*s+c));const w=Math.max(1,Math.round(aspect*extent)),h=Math.max(1,Math.round(extent));return {x:Math.ceil((width-w)/2),y:Math.ceil((height-h)/2),width:w,height:h}}
