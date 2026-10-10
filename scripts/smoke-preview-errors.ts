import {_electron as electron,expect} from '@playwright/test'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import type {EditorState} from '../src/shared/contracts'
const directory=await mkdtemp(join(tmpdir(),'compositor-preview-errors-')),checks:string[]=[],errors:string[]=[]
const app=await electron.launch({args:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(directory,'profile')}}),page=await app.firstWindow()
page.on('pageerror',e=>errors.push(e.message))
try{
 await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready','true',{timeout:30000})
 async function rpc<T=any>(method:string,params?:unknown):Promise<T>{const r=await page.evaluate(({method,params})=>window.compositor.request(method,params),{method,params});assert.equal(r.ok,true,JSON.stringify(r));return (r as {ok:true;value:T}).value}
 const state=()=>rpc<EditorState>('state'),identity=(s:EditorState)=>({sessionId:s.sessionId,documentId:s.manifest.documentID,expectedRevision:s.revision,idempotencyKey:randomUUID()})
 await rpc('newDocument');await rpc('create',{sessionId:(await state()).sessionId,width:128,height:96});let s=await state();await rpc('apply',{...identity(s),action:{type:'layer.fill',layerId:s.manifest.layers[0].id,color:[.5,.2,.1,1],target:'image'}})
 async function open(){await page.getByRole('button',{name:'Search commands',exact:true}).click();await page.locator('.command-palette input').fill('Exposure');await page.locator('.command-results button').filter({has:page.getByText('Exposure',{exact:true})}).first().click();await expect(page.getByRole('dialog',{name:'Exposure',exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'Exposure',exact:true}).getByRole('button',{name:'Apply',exact:true})).toBeEnabled()}
 await open();s=await state();const hash=s.assets[0].hash;await rpc('apply',{...identity(s),action:{type:'layer.rename',layerId:s.manifest.layers[0].id,name:'Independent user edit'}})
 const panel=page.getByRole('dialog',{name:'Exposure',exact:true});await panel.getByLabel('Exposure',{exact:true}).fill('1');await expect(panel.getByRole('alert')).toContainText('The filter source has changed');await expect(panel.locator('.filter-updating')).toHaveCount(0);await expect(panel.getByRole('button',{name:'Apply',exact:true})).toBeDisabled();assert.equal((await state()).assets[0].hash,hash);checks.push('A real stale filter preview shows its RPC error in the panel, stops the spinner, and blocks Apply without changing pixels')
 await panel.getByRole('button',{name:'Cancel',exact:true}).click();await open();const ready=await state();await page.getByRole('dialog',{name:'Exposure',exact:true}).getByLabel('Exposure',{exact:true}).fill('1');await expect(page.getByRole('dialog',{name:'Exposure',exact:true}).getByRole('button',{name:'Apply',exact:true})).toBeEnabled();await page.getByRole('dialog',{name:'Exposure',exact:true}).getByRole('button',{name:'Apply',exact:true}).click();await expect.poll(async()=>(await state()).revision).toBe(ready.revision+1);assert.equal((await state()).manifest.layers[0].name,'Independent user edit');assert.notEqual((await state()).assets[0].hash,hash);checks.push('Reopening binds a fresh revision and applies the filter while preserving the independent user edit')
 assert.deepEqual(errors,[]);await mkdir('artifacts/usability-audit',{recursive:true});await writeFile('artifacts/usability-audit/preview-errors.json',JSON.stringify({status:'PASS',checks,errors},null,2));console.log(JSON.stringify({status:'PASS',checks,errors},null,2))
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(directory,{recursive:true,force:true})}
