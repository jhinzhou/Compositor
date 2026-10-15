/** Residual segmentation only: source-local directional variation and Jacobian
 * angle/shear categories; does not select or tune production by image identity. */
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {mapCropPoint,perspectiveCropMatrix} from '../src/shared/crop-projective'
const output='artifacts/alpha28-sampling-research/directional';await mkdir(output,{recursive:true})
const f=JSON.parse(await readFile('fixtures/parity/photoshop-27.11-perspective-projective-holdout-alpha27.json','utf8')),source=inflateSync(Buffer.from(f.source.rgbaZlib,'base64')),rows=[]
for(const reference of f.cases){const native=inflateSync(Buffer.from(reference.rgbaZlib,'base64')),production=PNG.sync.read(await readFile(`artifacts/alpha27-perspective/projective-holdout/${reference.name}-current.png`)).data,m=perspectiveCropMatrix(reference.corners,reference.width,reference.height),groups:Record<string,{pixels:number;rgbSum:number;rgbMax:number;premultSum:number;alphaMax:number}>={},peaks=[]
 for(let y=0;y<reference.height;y++)for(let x=0;x<reference.width;x++){
  const u=(x+.5)/reference.width,v=(y+.5)/reference.height,[sx,sy]=mapCropPoint(m,u,v),ix=Math.floor(sx),iy=Math.floor(sy),p=(y*reference.width+x)*4;let dx=0,dy=0
  const value=(x:number,y:number,c:number)=>source[(Math.max(0,Math.min(f.source.height-1,y))*f.source.width+Math.max(0,Math.min(f.source.width-1,x)))*4+c]
  for(let c=0;c<3;c++)for(const distance of [-2,-1,1,2]){dx=Math.max(dx,Math.abs(value(ix+distance,iy,c)-value(ix,iy,c)));dy=Math.max(dy,Math.abs(value(ix,iy+distance,c)-value(ix,iy,c)))}
  const orientation=Math.max(dx,dy)<16?'low-variation':dx>dy*2?'horizontal-variation':dy>dx*2?'vertical-variation':'two-dimensional-variation',q=m[6]*u+m[7]*v+m[8],nx=m[0]*u+m[1]*v+m[2],ny=m[3]*u+m[4]*v+m[5],a=(m[0]*q-nx*m[6])/(q*q*reference.width),b=(m[1]*q-nx*m[7])/(q*q*reference.height),c=(m[3]*q-ny*m[6])/(q*q*reference.width),d=(m[4]*q-ny*m[7])/(q*q*reference.height),offDiagonal=Math.hypot(b,c)/Math.max(1e-12,Math.hypot(a,d)),key=orientation+' / '+(offDiagonal>.15?'rotated-or-sheared':'near-axis'),g=groups[key]??={pixels:0,rgbSum:0,rgbMax:0,premultSum:0,alphaMax:0};g.pixels++;let max=0
  for(let channel=0;channel<3;channel++){const delta=Math.abs(production[p+channel]-native[p+channel]);g.rgbSum+=delta;g.rgbMax=Math.max(g.rgbMax,delta);max=Math.max(max,delta);g.premultSum+=Math.abs(production[p+channel]*production[p+3]/255-native[p+channel]*native[p+3]/255)}g.alphaMax=Math.max(g.alphaMax,Math.abs(production[p+3]-native[p+3]));if(peaks.length<12||max>peaks.at(-1)!.max){peaks.push({x,y,sourcePoint:[sx,sy],sourceVariation:[dx,dy],jacobian:[a,b,c,d],orientation,max,actual:[...production.subarray(p,p+4)],native:[...native.subarray(p,p+4)]});peaks.sort((a,b)=>b.max-a.max);peaks.length=Math.min(12,peaks.length)}
 }
 rows.push({name:reference.name,groups:Object.fromEntries(Object.entries(groups).map(([k,g])=>[k,{pixels:g.pixels,rgbMAE:g.rgbSum/(g.pixels*3),rgbMax:g.rgbMax,premultRGBMAE:g.premultSum/(g.pixels*3),alphaMax:g.alphaMax}])),peaks})
}
await writeFile(output+'/comparison.json',JSON.stringify({status:'RESIDUAL_DIAGNOSTIC',productionChanged:false,limits:['Old source/output cohorts are known regression evidence, not new independent references.','Direction classification uses local forward/backward1/2-pixel variation to retain Nyquist stripes.','Source-axis footprint extents do not represent a full rotated elliptic filter; no candidate from this analysis is applied.'],rows},null,2)+'\n');console.log(JSON.stringify(rows.map(r=>({name:r.name,groups:r.groups})),null,2))
