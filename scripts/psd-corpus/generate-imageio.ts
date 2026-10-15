import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {inspectRasterPSD} from './independent-raster-reader'

// All source pixels are authored here. No downloaded or user-owned image is used.
// The independent PSD writer/reader is macOS Apple ImageIO through /usr/bin/sips.
if(process.platform!=='darwin')throw new Error('Fixture generation requires macOS sips; committed fixtures can be tested on other platforms.')
const exec=promisify(execFile),directory=resolve('fixtures/photoshop-corpus/imageio')
await mkdir(directory,{recursive:true})
const version=(await exec('/usr/bin/sips',['-v'])).stdout.trim()
const system=(await exec('/usr/bin/sw_vers',[])).stdout.trim()
const patterns=[
 {id:'C01',name:'opaque-color-grid',color:(x:number,y:number):number[]=>[x*32,y*40,(x+y)*16,255]},
 {id:'C02',name:'alpha-coverage',color:(x:number,y:number):number[]=>[180,y*35,80,[0,1,64,127,128,192,254,255][x]]},
 {id:'C03',name:'hard-edge-checker',color:(x:number,y:number):number[]=>{const v=(x+y)%2?255:0;return [v,255-v,v,255]}},
 {id:'C04',name:'transparent-border',color:(x:number,y:number):number[]=>[30+x*20,60+y*25,180,x===0||x===7||y===0||y===5?0:255]}
]
const records=[]
for(const pattern of patterns){
 const png=new PNG({width:8,height:6})
 for(let y=0;y<6;y++)for(let x=0;x<8;x++)png.data.set(pattern.color(x,y),(y*8+x)*4)
 const source=join(directory,`${pattern.name}.source.png`),psd=join(directory,`${pattern.name}.psd`),reference=join(directory,`${pattern.name}.imageio.png`)
 await writeFile(source,PNG.sync.write(png))
 await exec('/usr/bin/sips',['-s','format','psd',source,'--out',psd])
 await exec('/usr/bin/sips',['-s','format','png',psd,'--out',reference])
 const hash=async(file:string)=>createHash('sha256').update(await readFile(file)).digest('hex')
 const validation=inspectRasterPSD(await readFile(psd))
 records.push({id:pattern.id,name:pattern.name,origin:'independent-application',generator:'Apple ImageIO via sips',source:`${pattern.name}.source.png`,file:`${pattern.name}.psd`,reference:`${pattern.name}.imageio.png`,license:'Original synthetic pixels, licensed under the repository MIT LICENSE; no third-party image content.',expected:{width:8,height:6,layerCount:1,bitsPerChannel:8},layerValidation:{valid:validation.layers.every(layer=>!layer.errors.length),errors:validation.layers.flatMap(layer=>layer.errors)},sha256:{source:await hash(source),file:await hash(psd),reference:await hash(reference)}})
}
await writeFile(join(directory,'provenance.json'),JSON.stringify({schemaVersion:1,generatedAt:new Date().toISOString(),generatorVersion:version,system,commands:['sips -s format psd <original-synthetic.png> --out <fixture.psd>','sips -s format png <fixture.psd> --out <independent-reference.png>'],limitations:['Single raster layer only. Not Photoshop-authored or Photoshop visual acceptance.','This sips build produced malformed layer PackBits rows; check layerValidation. These are independent negative inputs, not successful compatibility specimens.','sips may attach a profile or transform low-alpha RGB. Reference is decoded from the PSD independently, not assumed identical to source PNG.','These four files do not exercise groups, vector paths, text, styles, adjustment layers or smart objects.'],records},null,2)+'\n')
console.log(`Generated ${records.length} independently encoded ImageIO fixtures at ${directory} (${version}).`)
