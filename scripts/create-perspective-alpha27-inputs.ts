/** Deterministic authored probes, no user images. Root runs native Photoshop separately. */
import {mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
const directory='artifacts/alpha27-perspective/inputs';await mkdir(directory,{recursive:true})
const width=384,height=256,records=[]
for(const variant of ['calibration-opaque','holdout-alpha'] as const){
 const png=new PNG({width,height})
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let rgba:number[]
  if(variant==='holdout-alpha'){
   const edge=Math.min(x,y,width-1-x,height-1-y),alpha=edge<12?Math.round(edge/12*255):255
   // Distinct frequencies/directions and colors, not a recoloring of calibration.
   rgba=[(Math.floor((x+2*y)/3)%2)*255,(Math.floor((2*x-y+height)/5)%2)*255,Math.round((x+y)/(width+height-2)*255),alpha]
  }else if(y<64){const value=(Math.floor((x<128?x:x<256?y:x+y)/(x<128?1:x<256?2:4))%2)*255;rgba=[value,value,value,255]}
  else if(y<128){const pitch=x<192?3:5,value=((Math.floor(x/pitch)+Math.floor(y/pitch))%2)*255;rgba=[value,255-value,value,255]}
  else if(y<192){const impulse=(x===61&&y===155)||(x===244&&y===169),step=x<192?8:247;rgba=[impulse?255:0,step,impulse?255:0,255]}
  else rgba=[Math.round(x/(width-1)*255),Math.round((y-192)/63*255),Math.round((x+2*y)/(width+2*height-3)*255),255]
  png.data.set(rgba,(y*width+x)*4)
 }
 const bytes=PNG.sync.write(png),path=`${directory}/${variant}.png`;await writeFile(path,bytes)
 records.push({variant,path,width,height,rgbaSHA256:createHash('sha256').update(png.data).digest('hex'),pngSHA256:createHash('sha256').update(bytes).digest('hex'),origin:'Self-authored deterministic directional stripes, impulses, hard step, ramps and independent fractional-alpha edge probe'})
}
await writeFile(directory+'/inputs.json',JSON.stringify(records,null,2)+'\n');console.log(JSON.stringify(records,null,2))
