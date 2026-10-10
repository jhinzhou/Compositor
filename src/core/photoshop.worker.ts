import { parentPort, workerData } from 'node:worker_threads'
import { decodePhotoshop, encodePhotoshop } from './photoshop-io'
import type { Manifest } from '../shared/contracts'
import type { Asset } from './project-io'
import { EditorError } from '../shared/contracts'
export interface PhotoshopSnapshot { manifest: Manifest; assets: [string, Asset][]; warnings?: string[] }
if (parentPort && workerData?.role === 'compositor-photoshop') {
  try {
    if (workerData.operation === 'decode') {
      const value = decodePhotoshop(Buffer.from(workerData.bytes))
      parentPort.postMessage({ok:true,value:{manifest:value.manifest,assets:[...value.assets],warnings:value.warnings}})
    } else if (workerData.operation === 'encode') {
      const input=workerData.snapshot as PhotoshopSnapshot,warnings:string[]=[]
      const assets=new Map(input.assets.map(([file,asset])=>[file,{...asset,bytes:Buffer.from(asset.bytes)}]))
      const bytes=encodePhotoshop(input.manifest,assets,{psb:!!workerData.psb,compositePNG:workerData.compositePNG,onWarning:warning=>warnings.push(warning)})
      parentPort.postMessage({ok:true,value:{bytes,warnings}})
    } else throw new EditorError('INVALID_ARGUMENT','Unknown Photoshop codec operation.')
  } catch(error) {parentPort.postMessage({ok:false,error:{code:error instanceof EditorError?error.code:'INVALID_IMAGE',message:error instanceof Error?error.message:String(error)}})}
}
