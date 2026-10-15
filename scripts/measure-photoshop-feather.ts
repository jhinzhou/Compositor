import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
import {PNG} from 'pngjs'
import {createHash} from 'node:crypto'
import {selectionCoverage} from '../src/shared/selection-coverage'
import type {Selection} from '../src/shared/pixel-contracts'
const root=resolve('artifacts/photoshop-native'),out=resolve(root,'measurements/feather-study');mkdirSync(out,{recursive:true})
const log=readFileSync(resolve(root,'outputs/feather-study/native-results.tsv'),'utf8'),names=log.split(/\r?\n|\r/).filter(line=>line.endsWith('\tPASS')).map(line=>line.split('\t')[0])
const results=[]
for(const name of names){
 const amount=Number(name.match(/-f(\d+)/)![1]),kind=name.split('-')[0],bounds:[number,number,number,number]=kind==='edge'?[0,32,80,80]:kind==='hole'?[64,32,128,128]:kind==='tiny'?[126,94,4,4]:[88,56,80,80]
 const refBytes=readFileSync(resolve(root,'outputs/feather-study',name+'.png')),png=PNG.sync.read(refBytes)
 function selection(factor:number):Selection{return {inverted:kind==='inverse',antialiased:false,feather:amount*factor*(kind==='repeat'?Math.SQRT2:1),canvasSize:[png.width,png.height],shapes:[{kind:'rectangle',bounds,operation:'replace',feather:0},...(kind==='hole'?[{kind:'rectangle' as const,bounds:[112,80,32,32] as [number,number,number,number],operation:'subtract' as const,feather:0}]:[])]}}
 const candidates=[]
 for(const factor of [1,2]){
  const s=selection(factor),data=new Uint8Array(png.width*png.height);let absolute=0,max=0,refMass=0,mass=0,refPeak=0,peak=0,changed=0
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){const at=y*png.width+x,r=png.data[at*4+3],p=Math.round(selectionCoverage(s,x+.5,y+.5)*255);data[at]=p;const d=Math.abs(r-p);absolute+=d;max=Math.max(max,d);changed+=d!==0?1:0;mass+=p;refMass+=r;peak=Math.max(peak,p);refPeak=Math.max(refPeak,r)}
  candidates.push({legacyAmountMultiplier:factor,MAE:absolute/data.length,max,changed,mass,refMass,peak,refPeak,coverageSHA256:createHash('sha256').update(data).digest('hex')})
 }
 results.push({name,amount,bounds,referenceSHA256:createHash('sha256').update(refBytes).digest('hex'),candidates})
}
writeFileSync(resolve(out,'comparison.json'),JSON.stringify({scope:'Actual Photoshop opaque-white selection exports; output Alpha is final selection coverage. Multiplier2 is an experimental candidate, not a product change or private kernel equivalence.',nativeLogSHA256:createHash('sha256').update(log).digest('hex'),results},null,2)+'\n')
for(const r of results)console.log(`${r.name}: ${r.candidates.map(c=>`factor${c.legacyAmountMultiplier} MAE=${c.MAE.toFixed(4)} max=${c.max} peak=${c.peak}/PS${c.refPeak}`).join(' | ')}`)
