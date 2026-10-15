/** Default reconstruction is the Mitchell B=C=1/3 kernel used by deep/HDR
 * composite and CanvasKit High quality. The crop caller explicitly selects
 * Lanczos3 only for isotropic affine minification and a guarded widened cubic
 * only after a whole-map enlargement proof. Samples are source edges; values
 * remain premultiplied until one final caller format quantization. */
export function cropMitchell(x:number):number{x=Math.abs(x);return x<1?((7*x-12)*x*x+16/3)/6:x<2?((-7/3*x+12)*x-20)*x/6+32/18:0}
export type CropReconstructionFilter='mitchell'|'lanczos3'|'catmull-rom-9/8'
export function cropLanczos3(x:number):number{x=Math.abs(x);if(x>=3)return 0;if(x<1e-12)return 1;const p=Math.PI*x;return Math.sin(p)/p*Math.sin(p/3)/(p/3)}
/** A scaled rotation/reflection has two equally long orthogonal Jacobian
 * columns. Select by source geometry alone, including rotated placements;
 * a sheared, anisotropic or projective mapping retains Mitchell. */
export function cropIsotropicAffineMinification(matrix:readonly number[],width:number,height:number):boolean{
 if(width<=0||height<=0||!Number.isFinite(width)||!Number.isFinite(height)||matrix.length!==9||matrix.some(v=>!Number.isFinite(v))||Math.abs(matrix[6])+Math.abs(matrix[7])>1e-12||Math.abs(matrix[8])<1e-12)return false
 const ax=matrix[0]/(matrix[8]*width),ay=matrix[3]/(matrix[8]*width),bx=matrix[1]/(matrix[8]*height),by=matrix[4]/(matrix[8]*height),a=ax*ax+ay*ay,b=bx*bx+by*by,tolerance=1e-9*Math.max(1,a,b)
 return Number.isFinite(a)&&Number.isFinite(b)&&a>1+2e-9&&Math.abs(a-b)<=tolerance&&Math.abs(ax*bx+ay*by)<=tolerance
}
export type CropSampleOptions={premultiplied:boolean;mask?:boolean;background?:number;footprint?:[number,number];filter?:CropReconstructionFilter}
/** Work includes out-of-image taps, whose alpha/background still participates. */
export function cropSampleTapCount(footprint?:[number,number],filter:CropReconstructionFilter='mitchell'):number{
 const [x,y]=footprint??[1,1]
 // 8x8 opacity/distance guard and wide reconstruction share source taps; a
 // boundary transition/fallback can require up to 16 additional Mitchell taps.
 if(filter==='catmull-rom-9/8')return 64+cropSampleTapCount(footprint,'mitchell')
 if(filter==='mitchell'&&x<=1+1e-9&&y<=1+1e-9)return 16
 const support=filter==='lanczos3'?3:2
 return 4*Math.ceil(support*Math.max(1,x))*Math.ceil(support*Math.max(1,y))
}
/** Source-space extents of one output pixel, from the inverse homography
 * Jacobian. A rotated/sheared crop can minify either source axis. */
export function cropSourceFootprint(matrix:number[],width:number,height:number,u:number,v:number):[number,number]{
 const denominator=matrix[6]*u+matrix[7]*v+matrix[8],x=matrix[0]*u+matrix[1]*v+matrix[2],y=matrix[3]*u+matrix[4]*v+matrix[5],square=denominator*denominator
 return [Math.max(1,Math.hypot((matrix[0]*denominator-x*matrix[6])/(square*width),(matrix[1]*denominator-x*matrix[7])/(square*height))),Math.max(1,Math.hypot((matrix[3]*denominator-y*matrix[6])/(square*width),(matrix[4]*denominator-y*matrix[7])/(square*height)))]
}
/** Only true local enlargement on both principal axes selects the optional
 * wider reconstruction. Equal scale, shear with one minified axis, masks and
 * aligned copies retain their existing paths. No fixture-dependent geometry. */
export function cropSourceIsMagnifying(matrix:readonly number[],width:number,height:number,u:number,v:number):boolean{
 if(matrix.length!==9||matrix.some(n=>!Number.isFinite(n))||width<=0||height<=0||!Number.isFinite(width)||!Number.isFinite(height))return false
 const q=matrix[6]*u+matrix[7]*v+matrix[8],nx=matrix[0]*u+matrix[1]*v+matrix[2],ny=matrix[3]*u+matrix[4]*v+matrix[5]
 if(!Number.isFinite(q)||Math.abs(q)<1e-14)return false
 const a=(matrix[0]*q-nx*matrix[6])/(q*q*width),b=(matrix[1]*q-nx*matrix[7])/(q*q*height),c=(matrix[3]*q-ny*matrix[6])/(q*q*width),d=(matrix[4]*q-ny*matrix[7])/(q*q*height),maximum=.5*(Math.hypot(a+d,c-b)+Math.hypot(a-d,c+b))
 return Number.isFinite(maximum)&&maximum<1-1e-9
}
/** Conservative proof over the entire unit output rectangle, not corner
 * sampling. In each of 16 parameter cells the Jacobian numerator is affine;
 * its extrema lie at vertices, while the denominator's absolute minimum also
 * lies there. Componentwise absolute upper bounds give an operator-norm bound.
 * A failed proof keeps the previous whole-image filter, including mixed scale. */
export const CROP_MAGNIFICATION_BOUND_PROBES=64
export function cropMappingIsMagnifying(matrix:readonly number[],width:number,height:number):boolean{
 if(matrix.length!==9||matrix.some(n=>!Number.isFinite(n))||width<=0||height<=0||!Number.isFinite(width)||!Number.isFinite(height))return false
 for(let cy=0;cy<4;cy++)for(let cx=0;cx<4;cx++){
  const bounds=[0,0,0,0];let minimum=Infinity,positive=false,negative=false
  for(const u of [cx/4,(cx+1)/4])for(const v of [cy/4,(cy+1)/4]){
   const q=matrix[6]*u+matrix[7]*v+matrix[8],x=matrix[0]*u+matrix[1]*v+matrix[2],y=matrix[3]*u+matrix[4]*v+matrix[5]
   if(q>0)positive=true;else if(q<0)negative=true;else return false
   // Pad lower/upper bounds outwards for the finite arithmetic used to form
   // each affine numerator. Ill-conditioned cancellation declines the profile.
   const eps=Number.EPSILON,qError=4*eps*(Math.abs(matrix[6]*u)+Math.abs(matrix[7]*v)+Math.abs(matrix[8])),xError=4*eps*(Math.abs(matrix[0]*u)+Math.abs(matrix[1]*v)+Math.abs(matrix[2])),yError=4*eps*(Math.abs(matrix[3]*u)+Math.abs(matrix[4]*v)+Math.abs(matrix[5]))
   minimum=Math.min(minimum,Math.abs(q)-qError)
   const numerators=[matrix[0]*q-x*matrix[6],matrix[1]*q-x*matrix[7],matrix[3]*q-y*matrix[6],matrix[4]*q-y*matrix[7]],first=[matrix[0],matrix[1],matrix[3],matrix[4]],second=[matrix[6],matrix[7],matrix[6],matrix[7]],coordinate=[x,x,y,y],coordinateError=[xError,xError,yError,yError]
   for(let i=0;i<4;i++){const error=Math.abs(first[i])*qError+Math.abs(second[i])*coordinateError[i]+8*eps*(Math.abs(first[i]*q)+Math.abs(coordinate[i]*second[i]));bounds[i]=Math.max(bounds[i],Math.abs(numerators[i])+error)}
  }
  if(positive&&negative||minimum<1e-14)return false
  const square=minimum*minimum,a=bounds[0]/(square*width),b=bounds[1]/(square*height),c=bounds[2]/(square*width),d=bounds[3]/(square*height),upper=.5*(Math.hypot(a+d,c-b)+Math.hypot(a-d,c+b))
  if(!Number.isFinite(upper)||upper>=1-1e-9)return false
 }
 return true
}
/** Standard B=0,C=1/2 cubic, widened in source space by 9/8. The format
 * alpha maximum remains native (255/65535/1); no RGB16/HDR byte projection. */
export function cropCatmullRom(x:number):number{x=Math.abs(x);return x<1?(9*x**3-15*x*x+6)/6:x<2?(-3*x**3+15*x*x-24*x+12)/6:0}
function sampleCropMagnification(data:Uint8Array|Uint16Array|Float32Array,width:number,height:number,u:number,v:number,options:CropSampleOptions):number[]{
 const previous=()=>sampleCropBicubic(data,width,height,u,v,{...options,filter:'mitchell'})
 if(options.mask||(options.footprint?.[0]??1)>1+1e-9||(options.footprint?.[1]??1)>1+1e-9)return previous()
 const scale=9/8,left=Math.floor(u-.5),top=Math.floor(v-.5),tx=u-.5-left,ty=v-.5-top,opaque=data instanceof Uint16Array?65535:data instanceof Float32Array?1:255,xWeights:number[]=[],yWeights:number[]=[],out=[0,0,0,0];let sumX=0,sumY=0,distance=Infinity
 for(let x=-2;x<=3;x++){const weight=cropCatmullRom((x-tx)/scale)/scale;xWeights.push(weight);sumX+=weight}
 for(let y=-2;y<=3;y++){const weight=cropCatmullRom((y-ty)/scale)/scale;yWeights.push(weight);sumY+=weight}
 const normalization=sumX*sumY
 // Include an outer ring for a continuous guard. New-support radius2.25 to
 // ceil(radius)=3 gives a .75-source-pixel transition, independent of samples.
 // At positive blend, neither cubic touches a nonopaque or outside source tap.
 for(let yy=-3;yy<=4;yy++)for(let xx=-3;xx<=4;xx++){
  const sx=left+xx,sy=top+yy,inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,alpha=inside?data[at+3]:0
  if(alpha!==opaque)distance=Math.min(distance,Math.max(Math.abs(sx+.5-u),Math.abs(sy+.5-v)))
  if(xx<-2||xx>3||yy<-2||yy>3)continue
  const weight=xWeights[xx+2]*yWeights[yy+2]/normalization;out[3]+=alpha*weight
  for(let c=0;c<3;c++){const color=inside?data[at+c]:options.background??0;out[c]+=color*(options.premultiplied?1:alpha/255)*weight}
 }
 const blend=Math.max(0,Math.min(1,(distance-2.25)/.75))
 if(!blend)return previous()
 if(blend===1)return out
 const baseline=previous();for(let c=0;c<4;c++)out[c]=baseline[c]+(out[c]-baseline[c])*blend
 return out
}
export function sampleCropBicubic(data:Uint8Array|Uint16Array|Float32Array,width:number,height:number,u:number,v:number,options:CropSampleOptions):number[]{
 if(options.filter==='catmull-rom-9/8')return sampleCropMagnification(data,width,height,u,v,options)
 const px=u-.5,py=v-.5,left=Math.floor(px),top=Math.floor(py),tx=px-left,ty=py-top,out=[0,0,0,0]
 const scaleX=Math.max(1,options.footprint?.[0]??1),scaleY=Math.max(1,options.footprint?.[1]??1)
 if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY))throw new RangeError('Invalid cubic sampling footprint.')
 if(scaleX>1+1e-9||scaleY>1+1e-9||options.filter==='lanczos3'){
  // A reconstruction kernel also needs a low-pass footprint when one output
  // pixel covers several source pixels. Normalize the complete support (not
  // just the in-image taps), so transparent/mask boundaries keep their meaning.
  const kernel=options.filter==='lanczos3'?cropLanczos3:cropMitchell,support=options.filter==='lanczos3'?3:2,radiusX=Math.ceil(support*scaleX),radiusY=Math.ceil(support*scaleY),xWeights=[],yWeights=[];let sumX=0,sumY=0
  for(let x=1-radiusX;x<=radiusX;x++){const weight=kernel((x-tx)/scaleX)/scaleX;xWeights.push(weight);sumX+=weight}
  for(let y=1-radiusY;y<=radiusY;y++){const weight=kernel((y-ty)/scaleY)/scaleY;yWeights.push(weight);sumY+=weight}
  const normalization=sumX*sumY
  for(let yy=1-radiusY;yy<=radiusY;yy++)for(let xx=1-radiusX;xx<=radiusX;xx++){
   const sx=left+xx,sy=top+yy,inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,weight=xWeights[xx+radiusX-1]*yWeights[yy+radiusY-1]/normalization,alpha=inside?data[at+3]:options.mask?255:0
   out[3]+=alpha*weight
   for(let c=0;c<3;c++){const color=inside?data[at+c]:options.background??0;out[c]+=color*(options.premultiplied?1:alpha/255)*weight}
  }
  return out
 }
 // Typed high-depth sources keep the original loop: local benchmarks show
 // weight arrays can offset the arithmetic saving when the call site becomes
 // polymorphic across Uint16 and Float32 sources.
 if(options.premultiplied){
  for(let yy=-1;yy<=2;yy++)for(let xx=-1;xx<=2;xx++){
   const sx=left+xx,sy=top+yy,inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,weight=cropMitchell(xx-tx)*cropMitchell(yy-ty),alpha=inside?data[at+3]:options.mask?255:0
   out[3]+=alpha*weight
   for(let c=0;c<3;c++)out[c]+=(inside?data[at+c]:options.background??0)*weight
  }
  return out
 }
 // Each separable axis has four distinct weights. Reuse them for all 16
 // taps without changing multiplication or accumulation order. Keeping the
 // axis weights separate avoids repeated evaluation inside the tap loop.
 const xWeights=[cropMitchell(-1-tx),cropMitchell(-tx),cropMitchell(1-tx),cropMitchell(2-tx)]
 const yWeights=[cropMitchell(-1-ty),cropMitchell(-ty),cropMitchell(1-ty),cropMitchell(2-ty)]
 for(let yy=-1;yy<=2;yy++){
 const yw=yWeights[yy+1]
 for(let xx=-1;xx<=2;xx++){
  const sx=left+xx,sy=top+yy,inside=sx>=0&&sy>=0&&sx<width&&sy<height,at=(sy*width+sx)*4,weight=xWeights[xx+1]*yw,alpha=inside?data[at+3]:options.mask?255:0
  out[3]+=alpha*weight
  for(let c=0;c<3;c++){const color=inside?data[at+c]:options.background??0;out[c]+=color*(alpha/255)*weight}
 }
 }
 return out
}
