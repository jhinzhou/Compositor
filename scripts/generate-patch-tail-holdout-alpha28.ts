/** New inputs for an independent alpha28 native gate; no native results used to tune a model. */
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
const width=320,height=240,ids=['slanted-aa','slanted-feather05','slanted-feather25','slanted-feather5','curved-aa','core-and-soft-island'],sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex'),byte=(v:number)=>Math.max(0,Math.min(255,Math.round(v))),png=new PNG({width,height})
const hash=(v:number)=>{v=Math.imul(v^(v>>>13),0x5bd1e995);v=Math.imul(v^(v>>>15),0x27d4eb2d);return(v^(v>>>14))>>>0}
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const texture=11*Math.sin(.43*x+.19*y)+7*Math.cos(.23*x-.47*y)+4*(hash(y*width+x)%1000/500-1),light=49+.32*x+.22*y+17*Math.sin(.041*y)*Math.cos(.016*x),ridge=10*Math.sin(.079*x+.043*y),at=(y*width+x)*4
 png.data.set([byte(light+texture+ridge),byte(39+.18*x+.36*y+texture*.8-ridge*.5),byte(71+.24*x+.12*y+texture*.6),255],at)
 if((x-216)**2+(y-88)**2<81)png.data.set([215,30,124,255],at)
 if((x-275)**2+(y-177)**2<9)png.data.set([25,211,75,255],at)
}
const encoded=PNG.sync.write(png),folder='artifacts/photoshop-native/inputs';await mkdir(folder,{recursive:true});await writeFile(folder+'/alpha28-patch-tail-holdout.png',encoded)
const inputs=[];for(const id of ids){const path=`${folder}/alpha28-probe-owned-${id}.png`;await writeFile(path,encoded);inputs.push({id,path,width,height,sourceSha:sha(png.data),encodedSha:sha(encoded)})}
const report={classification:'New alpha28 native output holdout; source is self-authored, outcomes withheld until mathematical candidate frozen',offset:[-104,24],healSmoothFactor:5,inputs};await writeFile(folder+'/alpha28-patch-tail-inputs.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
