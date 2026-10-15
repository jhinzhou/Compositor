import {PNG} from 'pngjs'
import {mkdir,writeFile} from 'node:fs/promises'
const directory='artifacts/alpha27-camera-raw-native'
await mkdir(directory,{recursive:true})
const image=new PNG({width:256,height:128})
for(let y=0;y<128;y++)for(let x=0;x<256;x++)image.data.set([x,x,x,255],(y*256+x)*4)
await writeFile(directory+'/gray-source.png',PNG.sync.write(image))
