import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PNG} from 'pngjs'
import {createHash} from 'node:crypto'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
const root=resolve('artifacts/photoshop-native'),out=resolve(root,'measurements/brush-study');mkdirSync(out,{recursive:true})
const log=readFileSync(resolve(root,'outputs/brush-study/native-results.tsv'),'utf8'),names=log.split(/\r?\n|\r/).filter(line=>line.endsWith('\tPASS')).map(line=>line.split('\t')[0]).filter(name=>!name.endsWith('16'))
const results=[]
for(const name of names){
 const [,opacityText,flowText,spacingText]=name.match(/-o([\d.]+)-f(\d+)-s(\d+)/)!,opacity=Number(opacityText)/100,flow=Number(flowText)/100,spacing=Number(spacingText)/100,hardness=name.startsWith('hard')?1:0,count=name.endsWith('twice')?2:1
 const bytes=readFileSync(resolve(root,'outputs/brush-study',name+'.png')),png=PNG.sync.read(bytes),grid={width:png.width,height:png.height,transform:{origin:[0,0] as [number,number],size:[png.width,png.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}}
 const candidates=[]
 for(const explicitSpacing of [false,true]){
  const coverage=brushStrokeCoverage(grid,[[48,96],[208,96]],32,hardness,{flow,...explicitSpacing?{spacing}:{}}),values=new Uint8Array(coverage.length);let absolute=0,max=0,mass=0,refMass=0,peak=0,refPeak=0,visibleError=0,visiblePixels=0
  for(let i=0;i<coverage.length;i++){let p=0;for(let n=0;n<count;n++)p=Math.round(255*(opacity*coverage[i]/255+p/255*(1-opacity*coverage[i]/255)));values[i]=p;const r=png.data[i*4+3],d=Math.abs(r-p);absolute+=d;max=Math.max(max,d);mass+=p;refMass+=r;peak=Math.max(peak,p);refPeak=Math.max(refPeak,r);if(r||p){visibleError+=d;visiblePixels++}}
  candidates.push({explicitSpacing,MAE:absolute/coverage.length,visibleMAE:visibleError/visiblePixels,max,mass,refMass,peak,refPeak,coverageSHA256:createHash('sha256').update(values).digest('hex')})
 }
 results.push({name,opacity,flow,spacing,hardness,count,referenceSHA256:createHash('sha256').update(bytes).digest('hex'),candidates})
}
writeFileSync(resolve(out,'comparison.json'),JSON.stringify({scope:'Actual Photoshop path-stroked round brush on self-authored transparent input. Compare Alpha only; pressure/texture and freehand input latency are separate gates.',nativeLogSHA256:createHash('sha256').update(log).digest('hex'),results},null,2)+'\n')
for(const r of results)console.log(`${r.name}: ${r.candidates.map(c=>`spacing=${c.explicitSpacing?'explicit':'legacy'} MAE=${c.MAE.toFixed(4)} visibleMAE=${c.visibleMAE.toFixed(4)} max=${c.max} peak=${c.peak}/PS${c.refPeak}`).join(' | ')}`)
