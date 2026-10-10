import {_electron as electron} from '@playwright/test'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const directory=await mkdtemp(join(tmpdir(),'compositor-startup-'))
const app=await electron.launch({args:[process.cwd()],env:{...process.env,COMPOSITOR_TEST:'1',COMPOSITOR_PROFILE:join(directory,'profile')}})
app.process().stdout?.on('data',d=>console.log('STDOUT',d.toString()));app.process().stderr?.on('data',d=>console.log('STDERR',d.toString()))
try{const page=await app.firstWindow();page.on('pageerror',e=>console.log('PAGEERROR',e.message));page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));await page.waitForTimeout(15000);console.log('WINDOWS',await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL(),loading:w.webContents.isLoading(),visible:w.isVisible()}))));console.log('BODY',await page.locator('body').innerText());console.log('RPC',await page.evaluate(async()=>typeof window.compositor==='undefined'?'missing':await window.compositor.request('state')))}finally{await app.close();await rm(directory,{recursive:true,force:true})}
