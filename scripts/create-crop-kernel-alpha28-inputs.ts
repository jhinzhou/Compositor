/** Self-authored low-amplitude reconstruction/anti-alias probes.
 * Native output capture is root-owned and must use a fresh source per operation.
 * Only opaque-calibration is offered to model selection; the other outputs are
 * independent validation sources, whose Photoshop results must remain withheld. */
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
const directory=process.argv[2]??'artifacts/alpha28-sampling-inputs',width=512,height=384
await mkdir(directory,{recursive:true})
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),entries=[]
for(const role of ['opaque-calibration','opaque-holdout','alpha-holdout'] as const){
 const png=new PNG({width,height}),holdout=role!=='opaque-calibration',phase=holdout?.37:0,shift=holdout?11:0
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let red=127,green=127,blue=127
  if(x<256&&y<192){
   // Isolated signed impulses allow negative lobes to remain visible, without clipping.
   if(x===64+shift&&y===64+shift)red+=32
   if(x===156-shift&&y===124-shift)red-=32
   green=x<128+shift?95:159;blue=y<96-shift?95:159
  }else if(x>=256&&y<192){
   // Smooth chirp in x and two fixed-frequency controls; all remain 127±32.
   const q=x-256,f0=holdout?.025:.015,f1=holdout?.465:.445
   red=127+32*Math.cos(2*Math.PI*(f0*q+(f1-f0)*q*q/(2*255)+phase))
   green=127+32*Math.sin(2*Math.PI*(q*(holdout?.193:.173)+phase))
   blue=127+32*Math.cos(2*Math.PI*(y*(holdout?.317:.293)+phase))
  }else if(x<256){
   const q=y-192,edge=holdout?x*.625+17:x*.5+32
   red=q<edge?95:159;green=q<96+shift?159:95;blue=x<128-shift?95:159
  }else{
   const q=x-256,r=y-192,pitch=holdout?3:2
   red=127+32*((Math.floor(q/pitch)+Math.floor(r/pitch))%2?1:-1)
   green=127+32*Math.sin(2*Math.PI*(q*(holdout?.089:.071)+r*.053+phase))
   blue=127+32*Math.cos(2*Math.PI*(q*.137-r*(holdout?.151:.119)+phase))
  }
  // Alpha-zero hidden RGB deliberately survives source generation. Native PNG
  // export canonicalization must be checked in premultiplied space separately.
  const alpha=role==='alpha-holdout'?(x<24||y<16?0:Math.round(255*Math.min(1,Math.max(0,(x-24)/240))*(y>=352?.45:1))):255
  png.data.set([Math.round(red),Math.round(green),Math.round(blue),alpha],(y*width+x)*4)
 }
 const bytes=PNG.sync.write(png),path=`${directory}/${role}.png`;await writeFile(path,bytes)
 entries.push({role,path,width,height,pngSHA256:sha(bytes),rgbaSHA256:sha(png.data),sourceLicense:'Project self-authored procedural probe',regions:['TL: 127±32 signed red impulses / green horizontal step / blue vertical step','TR: horizontal chirp + distinct x/y frequencies','BL: slanted red edge + horizontal/vertical steps','BR: checker + 2D low/high frequency sinusoids'],alpha:role==='alpha-holdout'?'zero boundary, horizontal ramp and fractional bottom band; hidden RGB nonzero':'opaque'})
}
const manifest={version:1,purpose:'Independent alpha28 Photoshop sampling investigation; native results for holdouts withheld until model freeze',calibrationSource:'opaque-calibration',width,height,perspectiveCorners:[[24,18],[482,37],[455,351],[39,330]],requestedSizes:[[256,192],[768,576]],imageSizeInterpolation:['bicubic','bicubicSharper','bicubicSmoother','bicubicAutomatic'],captureContract:['Fresh physical source for every operation','Read effective interpolation enum, exact crop event and resulting dimensions','Save native before and output; separately account for alpha-zero hidden RGB canonicalization','Opaque-holdout and alpha-holdout native results stay root-owned until candidate model freeze'],entries}
await writeFile(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2))
