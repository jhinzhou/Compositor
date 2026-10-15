import {readFile,writeFile} from 'node:fs/promises'
import {deflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
const sourcePath='artifacts/photoshop-native/outputs/tools-alpha24/capture-1791880124463.png',cohort=JSON.parse(await readFile('artifacts/alpha24-perspective-cohort.json','utf8'))
const rgba=async(path:string)=>{const raw=await readFile(path),image=PNG.sync.read(raw);return{width:image.width,height:image.height,pngSHA256:createHash('sha256').update(raw).digest('hex'),sha256:createHash('sha256').update(image.data).digest('hex'),rgbaZlib:deflateSync(image.data).toString('base64')}}
const fixture={photoshopVersion:'27.11.0',scope:'Two actual native Photoshop UI perspective crops on a self-authored diagnostic RGB8 source; integer rectangle and opposite-tilt quad. Not natural-photo/deep/HDR parity.',source:{path:sourcePath,...await rgba(sourcePath)},screenOrigin:[742,711],zoom:1,cornersConvention:'Actual pointer document-coordinate pixel positions; native internal homography not available.',cases:await Promise.all(cohort.cases.map(async(reference:any)=>({...reference,maximumRGBMAE:reference.name.startsWith('rectangle')?.03:.4,...await rgba(reference.nativePath)})))}
await writeFile('fixtures/parity/photoshop-27.11-perspective-alpha24.json',JSON.stringify(fixture,null,2)+'\n')
