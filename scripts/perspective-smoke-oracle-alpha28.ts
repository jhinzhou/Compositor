/** Standalone same-runtime core oracle: run only with ELECTRON_RUN_AS_NODE.
 * Uses captured physical source bytes and public crop parameters, never GUI. */
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {makeAsset} from '../src/core/project-io'
import {decodeDeepPNG} from '../src/core/deep-assets'
import {decodeEXR} from '../src/core/hdr-codecs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import type {Layer} from '../src/shared/contracts'
import type {CropCorners} from '../src/shared/crop-projective'
const job=JSON.parse(readFileSync(process.argv[2],'utf8')) as {sourcePath:string;assetFile:string;outputPath:string;reportPath:string;placement:Layer['transform'];corners:CropCorners;width:number;height:number;sampling:Layer['transform']['sampling']}
const source=makeAsset(job.assetFile,readFileSync(job.sourcePath),{allow16:true,allowHDR:true}),result=perspectiveCropRaster(source,job.placement,job.corners,job.width,job.height,job.sampling),decoded=result.hdr?decodeEXR(result.bytes).hdr:result.deep?decodeDeepPNG(result.bytes).deep:PNG.sync.read(result.bytes).data
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
writeFileSync(job.outputPath,result.bytes);writeFileSync(job.reportPath,JSON.stringify({runtime:process.versions,sourceSHA256:sha(source.bytes),outputEncodedSHA256:sha(result.bytes),decodedSHA256:sha(new Uint8Array(decoded.buffer,decoded.byteOffset,decoded.byteLength)),parameters:{placement:job.placement,corners:job.corners,width:job.width,height:job.height,sampling:job.sampling}},null,2))
