/** Fixture callback only: independent native C owns source splitting/merging.
 * This invokes the existing portable Camera Raw byte operator, not Core Image. */
import {readFileSync} from 'node:fs'
import {applyImageFilter} from '../src/shared/image-filters'
const input=JSON.parse(readFileSync(0,'utf8'))
const results=input.probes.map((encoded:string)=>{
 const premul=Buffer.from(encoded,'base64'),straight=new Uint8ClampedArray(premul.length)
 for(let i=0;i<premul.length;i+=4){const alpha=premul[i+3];for(let c=0;c<3;c++)straight[i+c]=alpha?Math.round(premul[i+c]*255/alpha):0;straight[i+3]=alpha}
 const filtered=applyImageFilter({width:input.width,height:input.height,data:straight},input.filter),out=new Uint8Array(straight.length)
 for(let i=0;i<out.length;i+=4){const alpha=filtered.data[i+3];for(let c=0;c<3;c++)out[i+c]=Math.round(filtered.data[i+c]*alpha/255);out[i+3]=alpha}
 return Buffer.from(out).toString('base64')
})
process.stdout.write(JSON.stringify(results))
