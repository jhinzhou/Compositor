import type {Transform} from './contracts'
import type {StrokePoint} from './stroke-compaction'
import {compactStroke} from './stroke-compaction'
import {smoothStroke} from './interaction-geometry'

export interface BrushDynamics {
 tip?:'brush'|'pencil'
 flow?:number
 /** Distance between dabs as a fraction of the chosen diameter. An explicit
  * value selects the dab engine even at 100% Flow; absent keeps legacy strokes. */
 spacing?:number
 brushModel?:'compositor'|'photoshop'
 pressures?:number[]
 pressureSize?:boolean
 pressureOpacity?:boolean
}
export interface BrushGrid {width:number;height:number;transform:Transform;canvasWidth?:number;canvasHeight?:number}
const clamp=(value:number)=>Math.max(0,Math.min(1,value))
// A fixed Gaussian edge approximation measured on native round tips. These
// constants were selected from 32 px and validated at 8/16/31/33/64 px.
function normalCDF(value:number):number {
 const x=value/Math.SQRT2,a=Math.abs(x),t=1/(1+.3275911*a)
 const erf=(x<0?-1:1)*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-a*a))
 return clamp((1+erf)/2)
}
function photoshopHardEdge(radius:number,distance:number):number {
 return normalCDF((radius-.125-distance)/.75)
}
// A fixed document-pixel Gaussian AA filter applied to the near-hard shoulder.
// The closed form integrates a flat core followed by a Gaussian falloff against
// a normal distribution; it avoids per-pixel multi-sample filtering. The radial
// curvature term approximates the corresponding two-dimensional convolution.
function photoshopFilteredShoulder(radius:number,distance:number,hardness:number,core:number,sigma:number,geometryCorrection=0):number {
 return filteredShoulder(distance,core-radius*.25*hardness**8*(1-hardness)-geometryCorrection,sigma,.75*hardness)
}
function filteredShoulder(distance:number,core:number,sigma:number,aa:number):number {
 const q=distance-core+aa*aa/(2*Math.max(1,distance)),combined=Math.hypot(sigma,aa)
 return normalCDF(-q/aa)+sigma/combined*Math.exp(-q*q/(2*combined*combined))*normalCDF(q*sigma/(aa*combined))
}
// A resolved shoulder blended into a hard AA tip can gain an overly bright
// annulus. Shift both branches by the same bounded document-pixel geometry
// correction. The width gate preserves already unresolved tips; delayed blend
// weighting preserves the 90% transition and both endpoints. The quarter-pixel
// scale was retained over stronger alternatives after 48/96/128px holdouts.
// This is a measured approximation, not Photoshop's private tip algorithm.
function photoshopShoulderGeometryCorrection(sigma:number,hardness:number,hardBlend:number):number {
 const width=clamp((sigma-.375)/.375),widthGate=width*width*(3-2*width)
 return .25*widthGate*hardness**8*8*hardBlend*hardBlend*(1-hardBlend)
}
/** The measured Photoshop round shoulder family has a Gaussian tail outside
 * its nominal diameter. Reserve the entire four-sigma footprint when growing
 * image/mask rasters. The hard endpoint reserves the measured three-pixel AA tail. */
export function brushStrokeExtentDiameter(size:number,hardness:number,dynamics:BrushDynamics={}):number {
 if(dynamics.tip==='pencil')return size+2
 return dynamics.brushModel==='photoshop'?Math.max(size*(hardness<1?1.875:1),size+6):size
}

/** Mouse pressure is frequently reported as .5. Only pen samples enable dynamics. */
export function brushPointerPressure(event:{pointerType:string;pressure:number}):number|undefined {
 return event.pointerType==='pen'&&Number.isFinite(event.pressure)?clamp(event.pressure):undefined
}

/** Keep pressure paired with geometry, including samples inside the smoothing leash.
 * Spatial-only compaction must not remove pressure changes along a straight line. */
export function prepareBrushStroke(points:StrokePoint[],size:number,smoothing:number,pressures?:number[]):{points:StrokePoint[];pressures?:number[]} {
 if(!pressures)return {points:smoothStroke(compactStroke(points,Math.min(.125,size*.005)),smoothing)}
 if(pressures.length!==points.length||pressures.some(value=>!Number.isFinite(value)||value<0||value>1))throw Error('Each brush point requires a pressure between 0 and 1.')
 if(smoothing<=0)return {points:points.map(point=>[...point]),pressures:[...pressures]}
 const output:StrokePoint[]=[[...points[0]]],values=[pressures[0]];let anchor=points[0]
 for(let index=1;index<points.length;index++){
  const point=points[index],dx=point[0]-anchor[0],dy=point[1]-anchor[1],distance=Math.hypot(dx,dy)
  if(distance>smoothing){const step=(distance-smoothing)/distance;anchor=[anchor[0]+dx*step,anchor[1]+dy*step]}
  // Retain pressure changes even when geometry remains inside the smoothing leash.
  output.push([...anchor]);values.push(pressures[index])
 }
 const last=points.at(-1)!
 if(anchor[0]!==last[0]||anchor[1]!==last[1]){output.push([...last]);values.push(pressures.at(-1)!)}
 return {points:output,pressures:values}
}

/** Fixed arc-length dabs make Flow independent of pointer event frequency. Coverage
 * builds within a stroke; opacity is applied once by paintRaster, as the ceiling. */
export function dynamicBrushCoverage(grid:BrushGrid,points:StrokePoint[],size:number,hardness:number,dynamics:BrushDynamics):Uint8Array {
 const {width,height,transform:t}=grid,flow=dynamics.flow??1,pressures=dynamics.pressures
 if(!Number.isFinite(flow)||flow<0||flow>1||dynamics.spacing!==undefined&&(!Number.isFinite(dynamics.spacing)||dynamics.spacing<.01||dynamics.spacing>10)||pressures&&(pressures.length!==points.length||pressures.some(value=>!Number.isFinite(value)||value<0||value>1)))throw Error('Invalid brush dynamics.')
 const output=new Uint8Array(width*height)
 if(!flow)return output
 const photoshop=dynamics.brushModel==='photoshop',shoulderTip=photoshop&&hardness<1,spacing=Math.max(.25,photoshop?Math.fround(size*(dynamics.spacing??.25)):size*(dynamics.spacing??.1)),angle=t.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),antialias=Math.max(.001,Math.min(t.size[0]/width,t.size[1]/height)),expEdge=Math.exp(-2.5)
 const source=(x:number,y:number):StrokePoint=>{const dx=x-t.origin[0]-t.size[0]/2,dy=y-t.origin[1]-t.size[1]/2;return [((dx*cos+dy*sin)*(t.flipX?-1:1)/t.size[0]+.5)*width,((-dx*sin+dy*cos)*(t.flipY?-1:1)/t.size[1]+.5)*height]}
 let roiLeft=width,roiTop=height,roiRight=0,roiBottom=0
 // Pixel alignment can move a dab by up to sqrt(2) document pixels. The
 // global source ROI must contain that displacement even on scaled rasters.
 const extent=brushStrokeExtentDiameter(size,hardness,dynamics)/2+(photoshop?Math.SQRT2:0),rx=(extent+antialias)*width/t.size[0],ry=(extent+antialias)*height/t.size[1]
 for(const point of points){const [x,y]=source(...point);roiLeft=Math.min(roiLeft,Math.max(0,Math.floor(x-rx)));roiRight=Math.max(roiRight,Math.min(width,Math.ceil(x+rx)));roiTop=Math.min(roiTop,Math.max(0,Math.floor(y-ry)));roiBottom=Math.max(roiBottom,Math.min(height,Math.ceil(y+ry)))}
 const roiWidth=Math.max(0,roiRight-roiLeft),roiHeight=Math.max(0,roiBottom-roiTop),density=new Float32Array(roiWidth*roiHeight),ceilings=pressures&&dynamics.pressureOpacity?new Float32Array(roiWidth*roiHeight):undefined
 let visits=0,dabs=0
 const stamp=(x:number,y:number,pressure:number)=>{
  // Native computed round dabs use document-pixel aligned origins. Keep arc
  // length continuous; align each dab, rather than compacting pointer geometry.
  if(photoshop){x=Math.floor(x);y=Math.floor(y)}
  if(++dabs>200_000)throw Error('Stroke path exceeds its geometry budget.')
  const radius=size/2*(pressures&&dynamics.pressureSize!==false?pressure:1),strength=flow*(pressures&&dynamics.pressureOpacity?pressure:1)
  if(radius<=0||strength<=0)return
  const [sx,sy]=source(x,y)
  // Rotation can project a circular footprint on either scaled source axis.
  const sigma0=radius*15/32,sigma=Math.max(.001,sigma0*(1-hardness)),core=radius*(1-(1-hardness)**1.25),blend=clamp((hardness-.9)/.1),hardBlend=blend*blend*(3-2*blend),geometryCorrection=photoshop?photoshopShoulderGeometryCorrection(sigma,hardness,hardBlend):0,aaTransition=clamp((hardness-.75)/.15),aaWeight=aaTransition*aaTransition*(3-2*aaTransition),unresolved=clamp((1.5-sigma)/.75),softTransition=clamp(2*hardness),pixelWeight=unresolved*unresolved*(3-2*unresolved)*softTransition*softTransition*(3-2*softTransition),footprint=photoshop?Math.max(shoulderTip?4*sigma0:radius,radius+3):radius,rx=(footprint+antialias)*width/t.size[0],ry=(footprint+antialias)*height/t.size[1],left=Math.max(0,Math.floor(sx-rx)),right=Math.min(width,Math.ceil(sx+rx)),top=Math.max(0,Math.floor(sy-ry)),bottom=Math.min(height,Math.ceil(sy+ry))
  visits+=Math.max(0,right-left)*Math.max(0,bottom-top)
  if(visits>80_000_000)throw Error('Brush coverage exceeds the compute budget; use shorter strokes.')
  for(let row=top;row<bottom;row++)for(let column=left;column<right;column++){
   const u=((column+.5)/width-.5)*t.size[0]*(t.flipX?-1:1),v=((row+.5)/height-.5)*t.size[1]*(t.flipY?-1:1),px=t.origin[0]+t.size[0]/2+u*cos-v*sin,py=t.origin[1]+t.size[1]/2+u*sin+v*cos
   if(grid.canvasWidth!==undefined&&(px<0||px>=grid.canvasWidth)||grid.canvasHeight!==undefined&&(py<0||py>=grid.canvasHeight))continue
   const distance=Math.hypot(px-x,py-y),hardEdge=photoshop?(hardBlend>0||hardness>=1?photoshopHardEdge(radius-geometryCorrection,distance):0):clamp((radius-distance)/antialias+.5)
   // Fixed shoulder family measured at 32 px and checked at 64 px. The
   // smooth blend reaches the measured soft AA endpoint without a 0→1% jump.
   const unfilteredShoulder=shoulderTip&&distance<=footprint?Math.exp(-(Math.max(0,distance-core)**2)/(2*sigma*sigma)):0
   // Retain the verified low/intermediate shoulder; blend continuously into
   // the filtered near-hard family. Constants were proposed at32px, then
   // checked across8/16/31/33/64px and fresh95%/low-Flow holdouts.
   // A shoulder narrower than two AA widths is not resolved on the pixel
   // grid. Apply the same fixed-pixel filter and quarter-pixel core correction
   // continuously by its width, rather than by a diameter-specific lookup.
   // The soft transition retains the exact h0 endpoint even for tiny tips.
   const pixelShoulder=pixelWeight>0&&shoulderTip&&distance<=footprint?unfilteredShoulder*(1-pixelWeight)+filteredShoulder(distance,Math.max(0,core-.25),sigma,.75)*pixelWeight:unfilteredShoulder
   const shoulder=aaWeight>0&&shoulderTip&&distance<=footprint?pixelShoulder*(1-aaWeight)+photoshopFilteredShoulder(radius,distance,hardness,core,sigma,geometryCorrection)*aaWeight:pixelShoulder
   const edge=shoulderTip?shoulder*(1-hardBlend)+hardEdge*hardBlend:hardness>=1?hardEdge:Math.max(0,(Math.exp(-2.5*clamp((distance/radius-hardness)/(1-hardness))**2)-expEdge)/(1-expEdge)),coverage=Math.min(1,edge*strength),at=(row-roiTop)*roiWidth+column-roiLeft
   density[at]=Math.min(20,density[at]-Math.log(Math.max(1-coverage,1e-9)))
   if(ceilings)ceilings[at]=Math.max(ceilings[at],edge*pressure)
  }
 }
 stamp(...points[0],pressures?.[0]??1)
 // Native computed-tip spacing is a single-precision distance. For example,
 //32*.1 is3.200000047683716: a160px path has50dabs, while8px spacing
 // includes its exact terminal dab. Preserve the public ratio; do not round it
 // to the integer-percent granularity of Photoshop's settings UI.
 let untilNext=spacing
 for(let index=1;index<points.length;index++){
  const a=points[index-1],b=points[index],dx=b[0]-a[0],dy=b[1]-a[1],distance=Math.hypot(dx,dy)
  if(!distance){if(pressures&&pressures[index]>pressures[index-1])stamp(...b,pressures[index]);continue}
  let traveled=untilNext
  while(traveled<=distance+1e-9){const ratio=Math.min(1,traveled/distance),pressure=(pressures?.[index-1]??1)+((pressures?.[index]??1)-(pressures?.[index-1]??1))*ratio;stamp(a[0]+dx*ratio,a[1]+dy*ratio,pressure);traveled+=spacing}
  untilNext=traveled-distance
 }
 if(!photoshop&&spacing-untilNext>1e-6&&points.length>1)stamp(...points.at(-1)!,pressures?.at(-1)??1)
 for(let row=roiTop;row<roiBottom;row++)for(let column=roiLeft;column<roiRight;column++){const local=(row-roiTop)*roiWidth+column-roiLeft;output[row*width+column]=Math.round(255*Math.min(1-Math.exp(-density[local]),ceilings?.[local]??1))}
 return output
}

export const BRUSH_PRESETS=[
 {id:'hard-round',label:'Hard Round',hardness:1,flow:1,pressureSize:false,pressureOpacity:false},
 {id:'soft-round',label:'Soft Round',hardness:0,flow:1,pressureSize:false,pressureOpacity:false},
 {id:'pressure-round',label:'Pressure Round',hardness:1,flow:1,pressureSize:true,pressureOpacity:false}
] as const
