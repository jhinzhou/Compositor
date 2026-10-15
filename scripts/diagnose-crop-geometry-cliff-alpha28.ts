/** Same source phase, analytically neighboring Jacobians across unit scale.
 * Identity/aligned-copy shortcuts are deliberately absent from this probe. */
import {sampleCropBicubic,cropSourceIsMagnifying} from '../src/core/crop-sampling'
const w=32,h=32,data=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set([127+Math.round(32*Math.sin(x*1.83+y*.37)),127+Math.round(32*Math.cos(y*1.43)),127,255],(y*w+x)*4)
const rows=[1-1e-6,1+1e-6].map(scale=>{const m=[w*scale,0,0,0,h*scale,0,0,0,1],magnifying=cropSourceIsMagnifying(m,w,h,.5,.5),filter=magnifying?'catmull-rom-9/8':'mitchell',value=sampleCropBicubic(data,w,h,12.137,15.269,{premultiplied:false,filter});return {scale,magnifying,filter,value}});console.log(JSON.stringify({status:'DIAGNOSTIC',rows,difference:rows[0].value.map((n,c)=>Math.abs(n-rows[1].value[c])),limit:'Same source phase, full opacity, fractional point; demonstrates profile selection continuity, not native Photoshop effect'},null,2))
