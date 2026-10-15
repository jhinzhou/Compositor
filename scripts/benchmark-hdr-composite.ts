import {performance} from 'node:perf_hooks'
import {mkdir,writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {compositeHDRDocument,inspectHDRComposite,type HDRCompositeAsset} from '../src/core/hdr-composite'
import type {Manifest,Layer} from '../src/shared/contracts'
const directory=process.argv[2]??'artifacts/hdr-composite-benchmark';await mkdir(directory,{recursive:true});const results=[]
for(const [width,height] of [[1024,512],[2048,1024],[3840,2160]]){
 const id=randomUUID().toUpperCase(),file=id+'.exr',hdr=new Float32Array(width*height*4)
 for(let i=0;i<hdr.length;i+=4)hdr.set([2.125,-.125,.8125,1],i)
 // Already-decoded asset benchmark isolates composition; no codec cost is hidden.
 const asset={file,width,height,bytes:Buffer.alloc(0),hash:'benchmark',bitDepth:16,hdr} as HDRCompositeAsset
 const layer:Layer={id,name:'HDR source',imageFile:file,isVisible:true,isGroup:false,opacity:1,blendMode:'Normal',transform:{origin:[0,0],size:[width,height],rotation:0,flipX:false,flipY:false,sampling:'High quality'}}
 const manifest:Manifest={format:'com.compositor.project',version:13,colorSpace:'sRGB',documentID:randomUUID(),resolution:72,width,height,layers:[layer]},assets=new Map([[file,asset]]),inspection=inspectHDRComposite(manifest,assets),before=process.memoryUsage(),start=performance.now()
 if(!inspection.supported){results.push({width,height,status:'REFUSED',inspection});continue}
 const image=compositeHDRDocument(manifest,assets),milliseconds=performance.now()-start,after=process.memoryUsage();let exact=true;for(let i=0;i<image.data.length;i++)if(image.data[i]!==hdr[i]){exact=false;break}
 results.push({width,height,status:exact?'PASS':'FAIL',milliseconds,inspection,memoryBefore:before,memoryAfter:after,sourceBytes:hdr.byteLength,outputBytes:image.data.byteLength})
}
await writeFile(directory+'/results.json',JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,scope:'single decoded HDR layer; exact Float32 source/output check; process counters are retained snapshots, not peak RSS',results},null,2));console.log(JSON.stringify(results.map(({width,height,status,milliseconds,inspection})=>({width,height,status,milliseconds,estimatedMiB:inspection.estimatedWorkingBytes/1048576})),null,2))
