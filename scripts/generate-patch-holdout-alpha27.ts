/** Fresh deterministic inputs; native outputs remain withheld until candidate freeze. */
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
const w=256,h=192,ids=['slanted-aa','curved-polygon-aa','slanted-feather2','slanted-feather6','lowpeak6-feather8','lowpeak14-feather8'],sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),byte=(v:number)=>Math.max(0,Math.min(255,Math.round(v)))
const hash=(n:number)=>{n=Math.imul(n^(n>>>15),0x2c1b3c6d);n=Math.imul(n^(n>>>12),0x297a2d39);return(n^(n>>>15))>>>0}
const folder='artifacts/photoshop-native/inputs';await mkdir(folder,{recursive:true});const inputs=[]
for(const id of ids){const png=new PNG({width:w,height:h}),alternate=id==='lowpeak14-feather8'
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const texture=12*Math.sin(.39*x-.51*y)+8*Math.cos(.17*x+.31*y)+5*(hash(y*w+x)%1000/500-1),ridge=19*Math.cos(.095*x+.041*y),light=70+.34*x+.13*y+19*Math.sin(.024*x)*Math.cos(.027*y),at=(y*w+x)*4
  png.data.set(alternate?[byte(162-.22*x+texture),byte(39+.55*x+ridge+texture),byte(95+.2*y+texture*.6),255]:[byte(light+texture+ridge),byte(light*.72+texture*.8+9),byte(light*.51+texture*.6+20),255],at)
  if((x-172)**2+(y-74)**2<49)png.data.set(alternate?[26,220,72,255]:[32,55,224,255],at)
 }
 const encoded=PNG.sync.write(png),path=`${folder}/alpha27-probe-owned-${id}.png`;await writeFile(path,encoded);inputs.push({id,path,width:w,height:h,sourceSha:sha(png.data),encodedSha:sha(encoded),alternateBackground:alternate})
 if(id===ids[0])await writeFile(`${folder}/alpha27-soft-domain-holdout.png`,encoded)
}
const manifest={classification:'Fresh alpha27 independent outputs must remain withheld until candidate freeze; self-authored procedural inputs',offset:[-108,28],healSmoothFactor:5,inputs};await writeFile(`${folder}/alpha27-holdout-inputs.json`,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2))
