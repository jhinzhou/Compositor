import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {inflateSync,deflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {PNG} from 'pngjs'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'

const root=resolve('artifacts/photoshop-native'),out=resolve(root,'measurements/brush-edge-candidates');mkdirSync(out,{recursive:true})
const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex'),clamp=(x:number)=>Math.min(1,Math.max(0,x))
const fixture=JSON.parse(readFileSync('fixtures/parity/photoshop-27.11-brush.json','utf8'))
interface Row {name:string;version:string;size:number;hardness:number;flow:number;spacing:number;opacity:number;count:number;points:[number,number][];width:number;height:number;depth:number;alphaLEZlib:string}
const erf=(x:number)=>{const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+.3275911*a);return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-a*a))}
const cdf=(x:number)=>(1+erf(x/Math.SQRT2))/2
function modelCoverage(row:Row,model:string):Uint8Array {
 const r=row.size/2,oldHard=(distance:number)=>clamp(r-distance+.5),tip=(x:number,y:number,cx:number,cy:number)=>{const distance=Math.hypot(x-cx,y-cy),sigma0=r*15/32,sigma=Math.max(.001,sigma0*(1-row.hardness)),core=r*(1-(1-row.hardness)**1.25),h=clamp((row.hardness-.9)/.1),blend=h*h*(3-2*h)
  let edge=oldHard(distance)
  if(model==='radial-cdf075'||model==='radial-cdf075-snap')edge=cdf((r-.125-distance)/.75)
  if(model==='radial-cdf075-curvature')edge=cdf((r-.125-distance-.75**2/(2*Math.max(1,distance)))/.75)
  if(model==='linear-two-pixel')edge=clamp((r-.125-distance)/2+.5)
  if(model==='area16'){let count=0;for(let sy=0;sy<16;sy++)for(let sx=0;sx<16;sx++)if((x-cx-.5+(sx+.5)/16)**2+(y-cy-.5+(sy+.5)/16)**2<=r*r)count++;edge=count/256}
  if(row.hardness>=1)return edge
  const shoulder=Math.exp(-(Math.max(0,distance-core)**2)/(2*sigma*sigma));return shoulder*(1-blend)+edge*blend
 }
 const density=new Float64Array(row.width*row.height),spacing=Math.max(.25,row.size*row.spacing),extent=Math.max(4*r*15/32,r+3),stamp=(cx:number,cy:number)=>{if(model==='radial-cdf075-snap'){cx=Math.floor(cx);cy=Math.floor(cy)}for(let y=Math.max(0,Math.floor(cy-extent));y<Math.min(row.height,Math.ceil(cy+extent));y++)for(let x=Math.max(0,Math.floor(cx-extent));x<Math.min(row.width,Math.ceil(cx+extent));x++){const value=tip(x+.5,y+.5,cx,cy)*row.flow;density[y*row.width+x]-=Math.log(Math.max(1-value,1e-9))}}
 stamp(...row.points[0]);let until=spacing
 for(let i=1;i<row.points.length;i++){const a=row.points[i-1],b=row.points[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);let traveled=until;while(traveled<=d+1e-9){const t=Math.min(1,traveled/d);stamp(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);traveled+=spacing}until=traveled-d}
 return Uint8Array.from(density,value=>Math.round(255*(1-Math.exp(-value))))
}
function values(coverage:Uint8Array,row:Row){return Uint8Array.from(coverage,value=>{const a=value/255*row.opacity;let p=0;for(let n=0;n<row.count;n++)p=Math.round(255*(a+p/255*(1-a)));return p})}
function metric(reference:Uint16Array,actual:Uint8Array){let sum=0,max=0,union=0,mass=0,refmass=0,changed=0;for(let i=0;i<actual.length;i++){const d=Math.abs(reference[i]-actual[i]);sum+=d;max=Math.max(max,d);if(reference[i]||actual[i])union++;if(d)changed++;mass+=actual[i];refmass+=reference[i]}return {unionMAE:sum/union,relativeL1:sum/refmass,max,absolute:sum,changed,mass,referenceMass:refmass,massRatio:mass/refmass,alphaSHA256:hash(actual)}}
const models=['radial-cdf075-snap','linear-two-pixel','radial-cdf075','radial-cdf075-curvature','area16'],results=[]
const v5Log=readFileSync(resolve(root,"outputs/brush-study-v5/native-results.tsv"),"utf8");const v5Rows:Row[]=v5Log.split(/\r\n|\r|\n/).filter(line=>line.endsWith("\tPASS")&&!line.startsWith("rgb16")).map(line=>{const name=line.split("\t")[0],m=name.match(/-d(\d+)-h(\d+).*?-o(\d+)-f(\d+)-s(\d+)/)!,png=PNG.sync.read(readFileSync(resolve(root,"outputs/brush-study-v5",name+".png"))),alpha=Buffer.alloc(png.width*png.height*2);for(let i=0;i<png.width*png.height;i++)alpha.writeUInt16LE(png.data[i*4+3],i*2);const offset=name.includes("-half-")?.5:name.includes("-quarter-")?.25:0;return {name,version:"v5",size:+m[1],hardness:+m[2]/100,opacity:+m[3]/100,flow:+m[4]/100,spacing:+m[5]/100,count:1,points:name.includes("-dot-")?[[128+offset,96+offset],[128.01+offset,96+offset]]:[[48,96],[208,96]],width:png.width,height:png.height,depth:8,alphaLEZlib:deflateSync(alpha).toString("base64")}});
for(const row of [...fixture.rows.filter((r:Row)=>r.version!=='v5'),...v5Rows] as Row[]){if(row.depth!==8)continue;const raw=inflateSync(Buffer.from(row.alphaLEZlib,'base64')),reference=Uint16Array.from({length:raw.length/2},(_,i)=>raw.readUInt16LE(i*2)),baseline=modelCoverage(row,'alpha18'),candidates=Object.fromEntries(models.map(model=>[model,metric(reference,values(modelCoverage(row,model),row))]));results.push({...row,alphaLEZlib:undefined,before:metric(reference,values(baseline,row)),candidates})}
const report={scope:'Independent fixed-width high-hardness edge hypotheses on archived actual Photoshop brush Alpha, including all current8bit references. Area16 is true pixel-area sharp disk AA; radial-CDF hypotheses approximate a fixed Gaussian edge convolution. Radius-.125 and sigma.75 are exploratory common constants from hard32 profile, NOT validated portable kernels until multi-size holdouts. No product file modified. Alpha18 baseline is reconstructed independently with the former linear hard edge and unaligned dabs, so later product changes do not alter the before values. V5 holds out 8/16/31/33/64 px, fractional path positions and dense Flow20 strokes.',provenance:{scriptSHA256:hash(readFileSync('scripts/measure-photoshop-brush-edge-candidates.ts')),fixtureSHA256:hash(readFileSync('fixtures/parity/photoshop-27.11-brush.json')),productDynamicsSHA256:hash(readFileSync('src/shared/brush-dynamics.ts'))},results}
writeFileSync(resolve(out,'comparison.json'),JSON.stringify(report,null,2)+'\n')
for(const row of results.filter(r=>r.hardness>=.9))console.log(`${row.version}/${row.name}: old ${row.before.unionMAE.toFixed(3)} max${row.before.max} | ${models.map(m=>`${m} ${row.candidates[m].unionMAE.toFixed(3)} max${row.candidates[m].max}`).join(' | ')}`)
