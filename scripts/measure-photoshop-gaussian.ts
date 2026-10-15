/** Measure actual Photoshop and project exports of the same opaque step/impulse.
 * No proprietary PS kernel is inferred as a universal radius mapping. */
import {PNG} from 'pngjs'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
const root=resolve('artifacts/photoshop-native'),file=resolve(root,'measurements/supplement/comparison.json'),comparison=JSON.parse(readFileSync(file,'utf8')) as {results:{case:string;reference:{path:string};project:{path:string};source:{path:string}}[]}
function raster(path:string){const bytes=readFileSync(path),raw=PNG.sync.read(bytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]),max=bytes[24]===16?65535:255,data=raw.data as unknown as Uint8Array|Uint16Array;return {width:raw.width,height:raw.height,max,hash:createHash('sha256').update(bytes).digest('hex'),at:(x:number,y:number)=>data[(x+y*raw.width)*4]/max}}
function measure(image:ReturnType<typeof raster>,source:ReturnType<typeof raster>){
 let peak=-1,px=0,py=0;for(let y=Math.floor(source.height/2);y<source.height;y++)for(let x=0;x<source.width;x++){const v=source.at(x,y);if(v>peak){peak=v;px=x;py=y}}
 if(peak!==1)throw Error('Expected opaque single white impulse');let whites=0;for(let y=Math.floor(source.height/2);y<source.height;y++)for(let x=0;x<source.width;x++)if(source.at(x,y)>0)whites++;if(whites!==1)throw Error('The lower half must contain a single impulse')
 // Horizontal centerline is separated by 32 pixels from the upper step.
 // A full 2D lower ROI would contain step tails at r=6 and cannot be called
 // impulse energy. Report only this slice, with its own quantization limit.
 const radius=24,points:{x:number;v:number}[]=[];let mass=0,mx=0;for(let x=Math.max(0,px-radius);x<=Math.min(source.width-1,px+radius);x++){const v=image.at(x,py);points.push({x,v});mass+=v;mx+=x*v}const cx=mx/mass;let vx=0;for(const p of points)vx+=(p.x-cx)**2*p.v;
 const y=16,row=Array.from({length:image.width},(_,x)=>image.at(x,y)),cross=(p:number)=>{for(let x=33;x<96;x++)if(row[x-1]<p&&row[x]>=p)return x-1+(p-row[x-1])/(row[x]-row[x-1]);return null};let dm=0,dc=0,dv=0;for(let x=33;x<96;x++){const v=row[x]-row[x-1];dm+=v;dc+=(x-.5)*v}dc/=dm;for(let x=33;x<96;x++)dv+=(x-.5-dc)**2*(row[x]-row[x-1]);
 return {sourceImpulse:[px,py],impulseHorizontalSlice:{windowRadius:radius,lineSum:mass,centroid:cx,sigma:Math.sqrt(vx/mass),centerValue:image.at(px,py)},step:{row:y,kernelMass:dm,centroid:dc,sigma:Math.sqrt(dv/dm),cross10:cross(.1),cross90:cross(.9),width10To90:cross(.9)!-cross(.1)!},sha256:image.hash}
}
const results=comparison.results.filter(r=>/step-gaussian/.test(r.case)).map(row=>{const source=raster(row.source.path);return {case:row.case,photoshop:measure(raster(row.reference.path),source),project:measure(raster(row.project.path),source)}})
writeFileSync(resolve(root,'measurements/supplement/gaussian-kernel-measurements.json'),JSON.stringify({scope:'Independent moment measurements of real PS exports and project outputs. Opaque step/impulse only, not alpha behavior or a universal Gaussian radius map. RGBA8 impulse rounding loses tail energy; RGBA16 is more informative. The horizontal impulse slice is 32px below the step; full 2D impulse mass is deliberately not measured because the bottom ROI is contaminated by upper-step tails.',comparisonSHA256:createHash('sha256').update(readFileSync(file)).digest('hex'),results},null,2)+'\n')
for(const r of results)console.log(`${r.case}\tstep sigma PS ${r.photoshop.step.sigma.toFixed(5)} project ${r.project.step.sigma.toFixed(5)}\timpulse horizontal sigma PS ${r.photoshop.impulseHorizontalSlice.sigma.toFixed(5)} project ${r.project.impulseHorizontalSlice.sigma.toFixed(5)}`)
