import { Worker } from 'node:worker_threads'
import { EditorError, LIMITS } from '../shared/contracts'
import type { PhotoshopSnapshot } from './photoshop.worker'
export type { PhotoshopSnapshot } from './photoshop.worker'
export interface PhotoshopWorkerOptions { workerPath:string;signal?:AbortSignal;timeoutMs?:number }
/** Each immutable conversion is isolated; cancellation kills its codec thread before any document mutation. */
function run<T>(data:object,options:PhotoshopWorkerOptions):Promise<T>{
 if(options.signal?.aborted)return Promise.reject(new EditorError('CANCELED','Photoshop conversion canceled.'))
 const timeout=options.timeoutMs??90000;if(!Number.isFinite(timeout)||timeout<1||timeout>300000)return Promise.reject(new EditorError('INVALID_ARGUMENT','Invalid Photoshop conversion timeout.'))
 return new Promise((resolve,reject)=>{let settled=false;const worker=new Worker(options.workerPath,{workerData:{role:'compositor-photoshop',...data},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:768}})
 const finish=(error?:Error,value?:T)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(error);else resolve(value!)}
 const abort=()=>finish(new EditorError('CANCELED','Photoshop conversion canceled.')),timer=setTimeout(()=>finish(new EditorError('TIMEOUT','Photoshop conversion exceeded its time limit.')),timeout)
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort()
 worker.on('message',reply=>{if(reply.ok)finish(undefined,reply.value);else finish(new EditorError(reply.error.code,reply.error.message))});worker.on('error',error=>finish(error instanceof Error?error:new Error(String(error))));worker.on('exit',code=>{if(!settled)finish(new EditorError('WORKER_STOPPED',`Photoshop conversion worker stopped (${code}).`))})
 })
}
export function decodePhotoshopAsync(bytes:Uint8Array,options:PhotoshopWorkerOptions):Promise<PhotoshopSnapshot>{if(bytes.length>LIMITS.maxAssetBytes)return Promise.reject(new EditorError('RESOURCE_LIMIT','PSD/PSB exceeds the encoded input budget.'));return run({operation:'decode',bytes:Uint8Array.from(bytes)},options)}
export function encodePhotoshopAsync(snapshot:PhotoshopSnapshot,compositePNG:Uint8Array,psb:boolean,options:PhotoshopWorkerOptions):Promise<{bytes:Uint8Array;warnings:string[]}>{return run({operation:'encode',snapshot,compositePNG,psb},options)}
