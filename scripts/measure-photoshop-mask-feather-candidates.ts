/** Read-only product/native study. All candidate kernels below are independent
 * implementations, with one formula per family for every radius. No GUI, native
 * fixture modification, coefficient search, or production mask modification. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {join} from 'node:path'
import {PNG} from 'pngjs'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask} from '../src/shared/mask-properties'
import type {Layer} from '../src/shared/contracts'

const fixturePath='fixtures/parity/photoshop-27.11-mask-feather-ui.json',nativeRoot='artifacts/photoshop-native/outputs/mask-feather-ui-study',out=process.env.COMPOSITOR_MEASUREMENT_OUTPUT??'artifacts/photoshop-native/measurements/mask-feather-candidates'
type Row={name:string;width:number;height:number;maskWidth:number;maskHeight:number;maskRGBAZlib:string;alphaZlib:string;alphaSHA256:string;pngSHA256:string;psdSHA256:string;layer:Layer}
const fixtureBytes=readFileSync(fixturePath),fixture=JSON.parse(fixtureBytes.toString()) as {provenance:Record<string,unknown>;rows:Row[]},hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex')
mkdirSync(out,{recursive:true})
if(fixture.rows.length!==16)throw Error('Expected sixteen separately verified UI feather references')
// Analytic pixel-area integration, independent of production Gaussian helper.
function erf(v:number):number{const sign=v<0?-1:1,x=Math.abs(v),t=1/(1+.3275911*x);return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x))}
const cdf=(x:number,sigma:number)=>.5*(1+erf(x/(Math.SQRT2*sigma)))
function gaussianIntegral(x:number,sigma:number):number{return x*cdf(x,sigma)+sigma*Math.exp(-x*x/(2*sigma*sigma))/Math.sqrt(2*Math.PI)}
function factorial(n:number):number{let value=1;for(let i=2;i<=n;i++)value*=i;return value}
function choose(n:number,k:number):number{return factorial(n)/(factorial(k)*factorial(n-k))}
/** Exact CDF of a sum of n independent Uniform[-a,a] variables. Variance is
 * n*a²/3. This is the continuous box convolution, not n rounded box passes. */
function boxCDF(x:number,sigma:number,n:number):number{
 const a=sigma*Math.sqrt(3/n),t=(x+n*a)/(2*a);if(t<=0)return 0;if(t>=n)return 1
 // Use symmetry to avoid cancellation near the upper tail.
 if(t>n/2)return 1-boxCDF(-x,sigma,n)
 let sum=0;for(let k=0;k<=Math.floor(t);k++)sum+=(k%2?-1:1)*choose(n,k)*(t-k)**n
 return Math.max(0,Math.min(1,sum/factorial(n)))
}
const effectiveSigma=(f:number)=>Math.sqrt(f*f+Math.min(1/6,2*f*f/3)),varianceEighth=(f:number)=>Math.sqrt(f*f+Math.min(1/8,f*f/2)),varianceTwelfth=(f:number)=>Math.sqrt(f*f+Math.min(1/12,f*f/3))
type Candidate={name:string;definition:string;kind:'integrated'|'point'|'double-integrated'|'box';sigma:(f:number)=>number;support:number;n?:number;quantizePass?:boolean}
const candidates:Candidate[]=[
 {name:'gaussian-area-3sigma',definition:'Gaussian sigma=f; each coefficient integrates one source pixel; support3sigma',kind:'integrated',sigma:f=>f,support:3},
 {name:'gaussian-area-4sigma',definition:'Gaussian sigma=f; integrate one pixel; support4sigma',kind:'integrated',sigma:f=>f,support:4},
 {name:'gaussian-point-4sigma',definition:'Point-sampled Gaussian sigma=f, normalized; support4sigma',kind:'point',sigma:f=>f,support:4},
 {name:'gaussian-area-effective-variance-1_6',definition:'Integrated Gaussian sigma=sqrt(f²+min(1/6,2f²/3)), continuous at0; support4sigma',kind:'integrated',sigma:effectiveSigma,support:4},
 {name:'gaussian-area-effective-variance-1_8',definition:'Integrated Gaussian sigma=sqrt(f²+min(1/8,f²/2)), continuous at0; support4sigma',kind:'integrated',sigma:varianceEighth,support:4},
 {name:'gaussian-point-effective-variance-1_6',definition:'Point Gaussian sigma=sqrt(f²+min(1/6,2f²/3)); support4sigma',kind:'point',sigma:effectiveSigma,support:4},
 {name:'gaussian-two-pixel-area',definition:'Gaussian sigma=f convolved with source and destination unit-pixel footprints; triangular integration, support4sigma+1',kind:'double-integrated',sigma:f=>f,support:4},
 {name:'gaussian-two-pixel-area-effective-variance-1_12',definition:'Double pixel integration with sigma=sqrt(f²+min(1/12,f²/3)); support4sigma+1',kind:'double-integrated',sigma:varianceTwelfth,support:4},
 {name:'box3-continuous-area',definition:'Exact continuous convolution of three Uniform[-f,f] kernels; one pixel-area integration, support3f',kind:'box',sigma:f=>f,support:3,n:3},
 {name:'box3-continuous-effective-variance-1_6',definition:'Exact continuous box3 with sigma=sqrt(f²+min(1/6,2f²/3)); single pixel-area integration; support3sigma',kind:'box',sigma:effectiveSigma,support:3,n:3},
 {name:'box4-continuous-area',definition:'Exact continuous box4; a=f*sqrt(3/4) gives variance f²; one pixel-area integration',kind:'box',sigma:f=>f,support:Math.sqrt(12),n:4},
 {name:'box4-continuous-effective-variance-1_6',definition:'Exact continuous box4 with the same effective variance1/6 correction; no radius-dependent kernel switch',kind:'box',sigma:effectiveSigma,support:Math.sqrt(12),n:4},
 {name:'box6-continuous-area',definition:'Exact continuous box6; a=f/sqrt(2) gives variance f²; one pixel-area integration',kind:'box',sigma:f=>f,support:Math.sqrt(18),n:6},
 {name:'box3-effective-quantized-horizontal',definition:'Same box3 effective-variance1/6, but round horizontal pass to byte before vertical; distinguishes pass quantization',kind:'box',sigma:effectiveSigma,support:3,n:3,quantizePass:true}
]
function kernel(f:number,candidate:Candidate){
 if(!f)return {radius:0,weights:Float64Array.of(1),sigma:0}
 const sigma=candidate.sigma(f),radius=Math.ceil(sigma*candidate.support+(candidate.kind==='double-integrated'?1:candidate.kind==='box'?.5:0)),weights=new Float64Array(radius*2+1)
 let sum=0;for(let k=-radius;k<=radius;k++){
  const weight=candidate.kind==='point'?Math.exp(-k*k/(2*sigma*sigma)):candidate.kind==='integrated'?cdf(k+.5,sigma)-cdf(k-.5,sigma):candidate.kind==='double-integrated'?gaussianIntegral(k+1,sigma)-2*gaussianIntegral(k,sigma)+gaussianIntegral(k-1,sigma):boxCDF(k+.5,sigma,candidate.n!)-boxCDF(k-.5,sigma,candidate.n!)
  weights[k+radius]=Math.max(0,weight);sum+=weights[k+radius]
 }
 for(let i=0;i<weights.length;i++)weights[i]/=sum
 return {radius,weights,sigma}
}
function convolve(input:Uint8Array,width:number,height:number,f:number,candidate:Candidate,background:number){
 const {radius,weights,sigma}=kernel(f,candidate),estimatedOps=width*height*(Math.min(width,2*radius+1)+Math.min(height,2*radius+1))
 if(width*height>2_000_000||radius>2000||estimatedOps>100_000_000)throw Error('Independent measurement exceeds its fixed operation budget')
 const horizontal=new Float64Array(input.length),output=new Float64Array(input.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let value=background;for(let k=Math.max(-radius,-x);k<=Math.min(radius,width-1-x);k++)value+=(input[y*width+x+k]-background)*weights[k+radius]
  horizontal[y*width+x]=candidate.quantizePass?Math.round(value):value
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let value=background;for(let k=Math.max(-radius,-y);k<=Math.min(radius,height-1-y);k++)value+=(horizontal[(y+k)*width+x]-background)*weights[k+radius]
  output[y*width+x]=value
 }
 return {values:output,sigma,radius,estimatedOps}
}
function metrics(actual:ArrayLike<number>,expected:Uint8Array){
 let max=0,sum=0,square=0,union=0,changed=0,mass=0,referenceMass=0,worst=-1
 for(let i=0;i<expected.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta>max){max=delta;worst=i}sum+=delta;square+=delta*delta;if(actual[i]||expected[i])union++;if(delta)changed++;mass+=actual[i];referenceMass+=expected[i]}
 return {max,unionMAE:union?sum/union:0,fullMAE:sum/expected.length,rmse:Math.sqrt(square/expected.length),changed,union,absoluteL1:sum,massRatio:mass/referenceMass,worstIndex:worst}
}
function edgeMoments(alpha:Uint8Array,width:number,height:number){
 // Rectangle's left edge, y=center. The right opposing edge contaminates wide
 // sigma profiles, so moment/sigma inference is deliberately limited to f<=3.
 const y=Math.floor(height/2),center=87.5,start=80,end=96;let mass=0,mean=0,variance=0
 for(let x=start;x<=end;x++){const weight=alpha[y*width+x]-alpha[y*width+x-1];mass+=weight;mean+=(x-.5)*weight}
 mean/=mass;for(let x=start;x<=end;x++)variance+=((x-.5)-mean)**2*(alpha[y*width+x]-alpha[y*width+x-1])
 return {window:[start,end],row:y,expectedBoundary:center,mass,centroid:mean,variance:variance/mass,sigma:Math.sqrt(variance/mass),values:Array.from(alpha.subarray(y*width+83,y*width+94)),differences:Array.from({length:11},(_,i)=>alpha[y*width+83+i]-alpha[y*width+82+i])}
}
const results=fixture.rows.map(row=>{
 const source=inflateSync(Buffer.from(row.maskRGBAZlib,'base64')),reference=new Uint8Array(inflateSync(Buffer.from(row.alphaZlib,'base64'))),pngBytes=readFileSync(join(nativeRoot,row.name+'.png')),psdBytes=readFileSync(join(nativeRoot,row.name+'.psd')),nativePNG=PNG.sync.read(pngBytes)
 if(hash(reference)!==row.alphaSHA256||hash(pngBytes)!==row.pngSHA256||hash(psdBytes)!==row.psdSHA256)throw Error('Native fixture evidence hash changed: '+row.name)
 const rawNative=Uint8Array.from({length:row.width*row.height},(_,i)=>nativePNG.data[i*4+3]);if(hash(rawNative)!==row.alphaSHA256)throw Error('Fixture Alpha differs from actual exported PNG: '+row.name)
 if(row.width!==row.maskWidth||row.height!==row.maskHeight||row.layer.transform.rotation!==0||row.layer.transform.origin.some(v=>v!==0)||row.layer.transform.size[0]!==row.width||row.layer.transform.size[1]!==row.height)throw Error('This source-grid study cannot measure transformed raster sampling')
 const input=Uint8Array.from({length:row.maskWidth*row.maskHeight},(_,i)=>source[i*4]),image={width:row.maskWidth,height:row.maskHeight,data:new Uint8ClampedArray(source)},effective=effectiveMaskPixels(image,{...row.layer,maskFeatherModel:'compositor'} as Layer),placement=effectiveMaskTransform(row.layer.maskPlacement??row.layer.transform,image,effective.inset),baseline=Uint8Array.from({length:reference.length},(_,i)=>sampleEffectiveMask(effective,placement,i%row.width+.5,Math.floor(i/row.width)+.5)),f=row.layer.maskFeather??0,density=row.layer.maskDensity??1,background=typeof row.layer.photoshopMaskDefault==='number'?row.layer.photoshopMaskDefault:0
 const evaluated=Object.fromEntries(candidates.map(candidate=>{
  const {values,sigma,radius,estimatedOps}=convolve(input,row.width,row.height,f,candidate,background),rounded=Uint8Array.from(values,v=>Math.round(255+(Math.round(v)-255)*density)),once=Uint8Array.from(values,v=>Math.round(255+(v-255)*density))
  return [candidate.name,{sigma,radius,estimatedOps,...metrics(rounded,reference),singleFinalQuantization:metrics(once,reference),edgeProfile:Array.from(rounded.subarray(96*row.width+83,96*row.width+94)),center:rounded[96*row.width+128]}]
 }))
 return {name:row.name,feather:f,density,width:row.width,height:row.height,baseline:{...metrics(baseline,reference),edgeProfile:Array.from(baseline.subarray(96*row.width+83,96*row.width+94)),center:baseline[96*row.width+128]},native:{edgeProfile:Array.from(reference.subarray(96*row.width+83,96*row.width+94)),center:reference[96*row.width+128],...(f<=3?{edgeMoments:edgeMoments(reference,row.width,row.height)}:{})},candidates:evaluated}
})
const aggregate=Object.fromEntries(candidates.map(candidate=>{const all=results.map(row=>row.candidates[candidate.name]),heldout=results.filter(row=>row.feather>=3).map(row=>row.candidates[candidate.name]);return [candidate.name,{max:Math.max(...all.map(value=>value.max)),absoluteL1:all.reduce((sum,v)=>sum+v.absoluteL1,0),heldoutMax:Math.max(...heldout.map(value=>value.max)),heldoutAbsoluteL1:heldout.reduce((sum,v)=>sum+v.absoluteL1,0)}]}))
const baselineAggregate={max:Math.max(...results.map(row=>row.baseline.max)),absoluteL1:results.reduce((sum,row)=>sum+row.baseline.absoluteL1,0)}
const recommendation='A single continuous box4 effective-variance1/6 family bounds all six measured masks to max3/255; it improves five cases but f3 max goes2→3. Box3 effective is substantially closer at f10/20/50 and density10 (all max1), but f3 worsens2→4. Neither is uniformly superior to the current implementation at every radius. New1/2/4/6 and grayscale/inverse/transformed controls are needed before selecting a production kernel. No per-radius fit or kernel switch is recommended by this measurement.'
const report={baselineAggregate,recommendation,scope:'Exploratory independent source-grid kernel measurement of six actual Photoshop 27.11.0 UI-confirmed raster mask exports. Only f0.5 proposes subpixel correction; f3/10/20/50 and densityByte128f10 are holdouts. No per-radius parameter search, no private Photoshop algorithm equivalence, no transformed/1px/inverse/group mask claim. Product is unchanged.',candidateDefinitions:candidates.map(({name,definition})=>({name,definition})),quantization:'Main metric rounds the final blur to byte, then blends toward white for density and rounds again, matching current product order. singleFinalQuantization blends the unrounded blur toward white and rounds only once. Horizontal quantization is a separate explicit candidate.',zeroContinuity:'All sigma formulas tend to0 as feather tends to0. The radius/effectiveSigma formula does not introduce a finite-width blur at arbitrarily positive feather. A separate production identity branch would remain required at exactly0.',provenance:{fixtureSHA256:hash(fixtureBytes),native:fixture.provenance,scriptSHA256:hash(readFileSync('scripts/measure-photoshop-mask-feather-candidates.ts')),maskPropertiesSHA256:hash(readFileSync('src/shared/mask-properties.ts')),imageFiltersSHA256:hash(readFileSync('src/shared/image-filters.ts'))},aggregate,results}
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
const preferred='box3-continuous-effective-variance-1_6',lines=['# Photoshop raster mask feather: independent kernel candidates','','Product code is unchanged. Native PSD/PNG and decompressed Alpha hashes are checked. A generic continuous three-box convolution and the proposed continuous small-radius variance correction are measured at all radii; no per-radius coefficients are optimized.','', '| Actual native UI case | Product max / MAE* | Gaussian effective max / MAE* | Box3 effective max / MAE* | Box3 L1 / product L1 |','|---|---:|---:|---:|---:|']
for(const row of results){const g=row.candidates['gaussian-area-effective-variance-1_6'],b=row.candidates[preferred];lines.push(`| ${row.name} | ${row.baseline.max} / ${row.baseline.unionMAE.toFixed(4)} | ${g.max} / ${g.unionMAE.toFixed(4)} | ${b.max} / ${b.unionMAE.toFixed(4)} | ${b.absoluteL1} / ${row.baseline.absoluteL1} |`);console.log(JSON.stringify({name:row.name,baseline:row.baseline.max,gaussian:g.max,box3:b.max,box3MAE:b.unionMAE,baselineMAE:row.baseline.unionMAE,box3L1:b.absoluteL1,baselineL1:row.baseline.absoluteL1}))}
lines.push('',recommendation,'','MAE* uses the union of nonzero actual and reference coverage; full MAE, RMSE, mass ratios, worst pixels and all alternative candidates are in report.json. The candidate computes coefficients from the analytic Irwin–Hall CDF: sum of three Uniform[-a,a], a=sigma, sampled by integrating each pixel interval. Its variance is sigma²; sigma=sqrt(f²+min(1/6,2f²/3)) is shared across every radius and remains continuous at zero. This is an approximation hypothesis from edge profiles, not an implementation discovered inside Photoshop.','','At f0.5, the native edge Alpha at x86..89 is [1,56,199,254], whose derivative has a compact [1,55,143,55,1] shape. Point/area Gaussian families and double pixel integration distinguish possible pixel resampling from a discrete blur width. Higher radii test whether the same proposed variance correction plus box convolution generalizes. Rounded horizontal passes and one-versus-two final quantizations distinguish blur shape errors from byte rounding; maximum errors of several Alpha units cannot generally be attributed to a single last rounding.','','Native small-radius profile moments (only f<=3, where the opposite edge is negligible):','```json',JSON.stringify(results.filter(row=>row.feather<=3).map(row=>({name:row.name,...row.native.edgeMoments})),null,2),'```','','Remaining gates before a product change: fractional radii around0/0.25/1/2, non-rectangular masks, low gray impulses and inverted/default-white masks, feather outside layer bounds, transformed/independent and group masks, source pixels with 16-bit/HDR images, UI Undo/save and preview equality, and the fixed resource budgets. Do not call this full Photoshop mask equivalence.','')
writeFileSync(join(out,'report.md'),lines.join('\n'))
