import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'
import {ModelSettingsStore} from '../src/main/model-settings'
test('model endpoint and model persist while API credentials are encrypted and can be cleared',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'compositor-settings-')),key=randomBytes(32),iv=randomBytes(16)
 const cipher={available:()=>true,encrypt:(text:string)=>{const c=createCipheriv('aes-256-cbc',key,iv);return Buffer.concat([c.update(text),c.final()])},decrypt:(bytes:Buffer)=>{const c=createDecipheriv('aes-256-cbc',key,iv);return Buffer.concat([c.update(bytes),c.final()]).toString()}}
 try{const path=join(dir,'settings.json'),store=new ModelSettingsStore(path,cipher),config={protocol:'openai-compatible' as const,endpoint:'https://example.invalid/v1',model:'custom-provider-model',apiKey:'test-only-secret'}
 assert.equal(await store.load(),undefined);await store.save(config);assert.deepEqual(await store.load(),config);assert.equal((await readFile(path,'utf8')).includes(config.apiKey),false);assert.equal((await stat(path)).mode&0o777,0o600)
 await store.save({...config,apiKey:undefined});assert.equal((await store.load())!.apiKey,undefined)
 const unavailable=new ModelSettingsStore(path,{...cipher,available:()=>false});await assert.rejects(async()=>unavailable.save(config),/cannot encrypt/);assert.equal((await store.load())!.apiKey,undefined)
 }finally{await rm(dir,{recursive:true,force:true})}
})
