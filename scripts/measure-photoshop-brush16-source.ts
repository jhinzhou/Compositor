import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {readPsd} from 'ag-psd'
import {PNG} from 'pngjs'
import {decodeOriginalPhotoshop16Pixels} from '../src/core/photoshop-channel-validation'
const root='artifacts/photoshop-native/outputs/brush-study-v5',out='artifacts/photoshop-native/measurements/brush16-source';mkdirSync(out,{recursive:true})
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
const rows=[1,2,10,50].map(opacity=>{const name=`rgb16-d32-h100-dot-o${opacity}-f100-s25`,psdBytes=readFileSync(`${root}/${name}.psd`),pngBytes=readFileSync(`${root}/${name}.png`),psd=readPsd(psdBytes,{useImageData:true,useRawData:true,skipCompositeImageData:true,skipThumbnail:true}),source=decodeOriginalPhotoshop16Pixels(psd.children![0])!,png=PNG.sync.read(pngBytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]);let sourcePeak=0,pngPeak=0,nonzero=0;const values=new Set<number>();for(let i=3;i<source.data.length;i+=4){sourcePeak=Math.max(sourcePeak,source.data[i]);values.add(source.data[i]);if(source.data[i])nonzero++}for(let i=3;i<png.data.length;i+=4)pngPeak=Math.max(pngPeak,png.data[i]);return {name,opacity,psdBits:psd.bitsPerChannel,width:source.width,height:source.height,sourcePeak,pngPeak,mathematicalPeak:Math.round(opacity/100*65535),distinctSourceAlpha:values.size,nonzero,psdSHA256:sha(psdBytes),pngSHA256:sha(pngBytes),sourceRGBA16SHA256:sha(new Uint8Array(source.data.buffer))}})
writeFileSync(`${out}/comparison.json`,JSON.stringify({scope:'Actual native RGB16 source channels and PNG exports, no product modification. Native tool quantization is recorded, not forced on arbitrary command precision.',rows},null,2)+'\n');console.log(JSON.stringify(rows,null,2))
