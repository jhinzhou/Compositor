import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EditorError } from '../shared/contracts'
import type { ModelConfig } from './model-client'
export interface CredentialCipher { available():boolean; encrypt(text:string):Buffer; decrypt(bytes:Buffer):string }
// Only the Electron main process can read this file. Renderer snapshots omit apiKey.
export class ModelSettingsStore {
 private tail:Promise<unknown>=Promise.resolve()
 constructor(private path:string,private cipher:CredentialCipher){}
 async load():Promise<ModelConfig|undefined>{
  let text:string
  try{text=await readFile(this.path,'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  const value=JSON.parse(text) as {version:number;config:ModelConfig;encryptedKey?:string}
  if(value.version!==1||!value.config||typeof value.config.endpoint!=='string'||typeof value.config.model!=='string')throw new EditorError('INVALID_ARGUMENT','Saved model settings are invalid. Reconfigure the service.')
  const config={...value.config};delete config.apiKey
  if(value.encryptedKey){if(!this.cipher.available())throw new EditorError('CREDENTIAL_STORAGE_UNAVAILABLE','The system credential service is unavailable. Enter the model key again.');config.apiKey=this.cipher.decrypt(Buffer.from(value.encryptedKey,'base64'))}
  return config
 }
 save(config:ModelConfig):Promise<void>{
  const {apiKey,...publicConfig}=config
  if(apiKey&&!this.cipher.available())throw new EditorError('CREDENTIAL_STORAGE_UNAVAILABLE','The system credential service cannot encrypt your key. It has not been saved.')
  const data=JSON.stringify({version:1,config:publicConfig,...(apiKey?{encryptedKey:this.cipher.encrypt(apiKey).toString('base64')}:{})})
  const write=async()=>{await mkdir(dirname(this.path),{recursive:true});const temp=`${this.path}.${randomUUID()}.tmp`;try{await writeFile(temp,data,{mode:0o600,flag:'wx'});await rename(temp,this.path)}finally{await rm(temp,{force:true})}}
  const pending=this.tail.catch(()=>{}).then(write);this.tail=pending;return pending
 }
}
