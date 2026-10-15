import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'

// Independent exploratory models only. No product file is modified or fitted.
const root=resolve('artifacts/photoshop-native'),out=resolve(root,'measurements/soft-tip-candidates');mkdirSync(out,{recursive:true})
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex')
interface Settings {size:number;spacing:number;flow:number;opacity:number;dot:boolean;count:number}
interface Metric {fullMAE:number;unionMAE:number;referenceSupportMAE:number;max:number;absolute:number;mass:number;referenceMass:number;massRatio:number;relativeL1:number;peak:number;referencePeak:number;unionPixels:number;alphaSHA256:string}
function gaussian(width:number,height:number,settings:Settings,ratio:number,cutoff:number,forceEndpoint:boolean):Uint8Array {
 const {size,spacing,flow,dot}=settings,sigma=size*ratio,radius=cutoff*sigma,density=new Float64Array(width*height),step=Math.max(.25,size*spacing),start=dot?[128,96]:[48,96],end=dot?[128.01,96]:[208,96],distance=end[0]-start[0],dabs:[[number,number]]=[[start[0],start[1]]]
 let traveled=step;while(traveled<=distance+1e-9){dabs.push([start[0]+Math.min(distance,traveled),start[1]]);traveled+=step}
 if(forceEndpoint&&distance-(traveled-step)>1e-6)dabs.push([end[0],end[1]])
 for(const [cx,cy] of dabs)for(let y=Math.max(0,Math.floor(cy-radius));y<Math.min(height,Math.ceil(cy+radius));y++)for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(width,Math.ceil(cx+radius));x++){
  const squared=(x+.5-cx)**2+(y+.5-cy)**2;if(squared>radius*radius)continue
  const tip=Math.exp(-squared/(2*sigma*sigma));density[y*width+x]-=Math.log(Math.max(1-tip*flow,1e-9))
 }
 return Uint8Array.from(density,value=>Math.round(255*(1-Math.exp(-value))))
}
function opacityPasses(coverage:Uint8Array,settings:Settings):Uint8Array {
 return Uint8Array.from(coverage,value=>{const a=settings.opacity*value/255;let p=0;for(let i=0;i<settings.count;i++)p=Math.round(255*(a+p/255*(1-a)));return p})
}
function measure(reference:Uint8Array,actual:Uint8Array):Metric {
 let absolute=0,max=0,mass=0,referenceMass=0,unionPixels=0,referencePixels=0,referenceAbsolute=0,peak=0,referencePeak=0
 for(let i=0;i<actual.length;i++){const r=reference[i],p=actual[i],d=Math.abs(r-p);absolute+=d;max=Math.max(max,d);mass+=p;referenceMass+=r;peak=Math.max(peak,p);referencePeak=Math.max(referencePeak,r);if(r||p)unionPixels++;if(r){referencePixels++;referenceAbsolute+=d}}
 return {fullMAE:absolute/actual.length,unionMAE:absolute/unionPixels,referenceSupportMAE:referenceAbsolute/referencePixels,max,absolute,mass,referenceMass,massRatio:mass/referenceMass,relativeL1:absolute/referenceMass,peak,referencePeak,unionPixels,alphaSHA256:hash(actual)}
}
const records:{version:string;name:string;settings:Settings;width:number;height:number;referenceSHA256:string;nativeLogSHA256:string;candidates:Record<string,Metric>}[]=[]
for(const version of ['v2','v3']){
 const logBytes=readFileSync(resolve(root,`outputs/brush-study-${version}/native-results.tsv`)),log=logBytes.toString(),names=log.split(/\r\n|\r|\n/).filter(line=>line.endsWith('\tPASS')).map(line=>line.split('\t')[0]).filter(name=>name.startsWith('soft-'))
 for(const name of names){
  if(!log.includes(`${name}\tverified-options`))throw Error(`Unverified native settings: ${name}`)
  const match=name.match(/-o([\d.]+)-f(\d+)-s(\d+)/)!,settings:Settings={size:Number(name.match(/-d(\d+)/)?.[1]??32),opacity:Number(match[1])/100,flow:Number(match[2])/100,spacing:Number(match[3])/100,dot:name.includes('-dot-'),count:name.includes('-twice')?2:1},file=resolve(root,`outputs/brush-study-${version}/${name}.png`),bytes=readFileSync(file),png=PNG.sync.read(bytes),reference=Uint8Array.from({length:png.width*png.height},(_,i)=>png.data[i*4+3]),grid={width:png.width,height:png.height,transform:{origin:[0,0] as [number,number],size:[png.width,png.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}},points:[number,number][]=settings.dot?[[128,96],[128.01,96]]:[[48,96],[208,96]]
  const candidates:Record<string,Metric>={}
  for(const explicit of [false,true]){const c=brushStrokeCoverage(grid,points,settings.size,0,{flow:settings.flow,...explicit?{spacing:settings.spacing}:{}});candidates[explicit?'current-explicit-spacing':'legacy-no-spacing']=measure(reference,opacityPasses(c,settings))}
  for(const ratio of [.234,.234375,.235])for(const cutoff of [3.5,4])for(const endpoint of [false,true]){
   const id=`gaussian-${ratio}-cut${cutoff}-${endpoint?'force-end':'spacing-only'}`;candidates[id]=measure(reference,opacityPasses(gaussian(png.width,png.height,settings,ratio,cutoff,endpoint),settings))
  }
  records.push({version,name,settings,width:png.width,height:png.height,referenceSHA256:hash(bytes),nativeLogSHA256:hash(logBytes),candidates})
 }
}
const keys=Object.keys(records[0].candidates),summary=Object.fromEntries(keys.map(key=>{const selected=records.filter(r=>r.version==='v3'),all=records.map(r=>r.candidates[key]);return [key,{allMeanUnionMAE:all.reduce((s,r)=>s+r.unionMAE,0)/all.length,allRelativeL1:all.reduce((s,r)=>s+r.absolute,0)/all.reduce((s,r)=>s+r.referenceMass,0),holdoutMeanUnionMAE:selected.reduce((s,r)=>s+r.candidates[key].unionMAE,0)/selected.length,improvesOverExplicit:records.filter(r=>r.candidates[key].relativeL1<r.candidates['current-explicit-spacing'].relativeL1).length,total:records.length}]}))
const result={scope:'Actual Photoshop 27.11.0 path-stroked soft round Alpha only. Frozen preset input, verified Opacity/Flow options. No private PS brush source; candidate is an independent measured approximation. Sizes 48/64 (v3) are holdout: no per-size fit, no medium/hard fit, no dynamic-pressure/texture claim.',geometry:'Dot [128,96] to [128.01,96]; line [48,96] to [208,96]; pixel centers x+.5,y+.5. sigma=diameter*fixedRatio; radial Gaussian truncated at fixed sigma multiple. Flow dabs accumulated in log-density. Output coverage then Opacity matches current PNG8 boundary.',provenance:{scriptSHA256:hash(readFileSync(resolve('scripts/measure-photoshop-soft-tip-candidates.ts'))),brushCoverageSHA256:hash(readFileSync(resolve('src/shared/brush-coverage.ts'))),brushDynamicsSHA256:hash(readFileSync(resolve('src/shared/brush-dynamics.ts')))},summary,records}
writeFileSync(resolve(out,'comparison.json'),JSON.stringify(result,null,2)+'\n')
const preferred='gaussian-0.234375-cut4-spacing-only',lines=['# Photoshop soft round candidate comparison','','Exploratory numerical comparison only; product is unchanged. Gaussian width is fixed across 32/48/64 px; 48/64 references are holdout. Alpha only, no medium/hard or pressure fitting.','', '| Native case | Legacy MAE* | Explicit MAE* | Gaussian MAE* | Explicit max / Gaussian max | Explicit relative L1 / Gaussian relative L1 | Gaussian mass / PS |','|---|---:|---:|---:|---:|---:|---:|']
for(const r of records){const a=r.candidates['legacy-no-spacing'],b=r.candidates['current-explicit-spacing'],g=r.candidates[preferred];lines.push(`| ${r.version}/${r.name} | ${a.unionMAE.toFixed(4)} | ${b.unionMAE.toFixed(4)} | ${g.unionMAE.toFixed(4)} | ${b.max} / ${g.max} | ${b.relativeL1.toFixed(4)} / ${g.relativeL1.toFixed(4)} | ${g.massRatio.toFixed(4)} |`);console.log(`${r.name}: explicit unionMAE ${b.unionMAE.toFixed(4)} L1 ${b.relativeL1.toFixed(4)} => Gaussian ${g.unionMAE.toFixed(4)} L1 ${g.relativeL1.toFixed(4)}, max ${g.max}`)}
lines.push('','*MAE is measured over union of nonzero native/candidate Alpha pixels; full-canvas MAE and reference-support MAE are in comparison.json. Relative L1 divides absolute Alpha error by native Alpha mass. Uniform empty background cannot dilute these metrics.','','Preferred illustrative rule: sigma=diameter*0.234375, cutoff 4 sigma, spacing dabs only (no forced endpoint). The parameter family is reported in JSON; this rule is not a declaration of exact Photoshop reproduction. A short non-airbrush segment should not necessarily stamp its final point again; forced endpoint is measured as a separate model.','The 32 px Flow20 Spacing10 sample retains max Alpha error 36. Its path length 160 is an exact multiple of the 3.2 px spacing, so force-end and spacing-only outputs are identical. This residual cannot be attributed to the terminal stamp; native dab phase/step behavior requires further evidence.','',JSON.stringify(summary,null,2),'')
writeFileSync(resolve(out,'comparison.md'),lines.join('\n'))
