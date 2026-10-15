/** Bounded native-focus diagnosis. Launches and closes only its isolated child.
 * Does not modify the editor or acceptance harness, or touch existing apps. */
import {_electron as electron,expect,type ElectronApplication} from '@playwright/test'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'

const executable=process.env.COMPOSITOR_EXECUTABLE??resolve('release/0.3.0-alpha.26/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron')
const output=process.env.COMPOSITOR_SMOKE_OUTPUT??'artifacts/alpha26-native-focus-stages'
const directory=await mkdtemp(join(tmpdir(),'compositor-alpha26-focus-'))
const stages=['baseline','app-show','app-focus-steal','window-move-top','window-focus','webcontents-focus'] as const
type Stage=typeof stages[number]
let child:ElectronApplication|undefined,url=''
const samples:unknown[]=[],actions:unknown[]=[]
const snapshot=async(stage:Stage,delay:number)=>child!.evaluate(({app,BrowserWindow},{stage,delay,url})=>({stage,delay,at:new Date().toISOString(),pid:process.pid,version:app.getVersion(),packaged:app.isPackaged,executable:app.getPath('exe'),userData:app.getPath('userData'),appHidden:process.platform==='darwin'?app.isHidden():undefined,focusedWindowId:BrowserWindow.getFocusedWindow()?.id??null,targetUrl:url,windows:BrowserWindow.getAllWindows().map(window=>({id:window.id,url:window.webContents.getURL(),visible:window.isVisible(),focused:window.isFocused(),focusable:window.isFocusable(),minimized:window.isMinimized(),destroyed:window.isDestroyed(),webContentsFocused:window.webContents.isFocused(),loading:window.webContents.isLoading(),bounds:window.getBounds()}))}),{stage,delay,url})
await mkdir(output,{recursive:true})
try{
 child=await electron.launch({executablePath:executable,args:[],env:{...process.env,COMPOSITOR_PROFILE:join(directory,'profile'),COMPOSITOR_TEST:'1'},timeout:60000})
 await expect.poll(()=>child!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&window.webContents.getURL().startsWith('file:'))?.webContents.getURL()),{timeout:30000}).toBeTruthy()
 url=await child.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('render=1')&&window.webContents.getURL().startsWith('file:'))!.webContents.getURL())
 await expect.poll(()=>child!.evaluate(async({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!.webContents.executeJavaScript("document.querySelector('.editor-shell')?.getAttribute('data-ready')"),url),{timeout:60000}).toBe('true')
 for(const stage of stages){
  if(stage!=='baseline')actions.push(await child.evaluate(({app,BrowserWindow},{stage,url})=>{const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)!;if(stage==='app-show')app.show();else if(stage==='app-focus-steal')app.focus({steal:true});else if(stage==='window-move-top')window.moveTop();else if(stage==='window-focus')window.focus();else if(stage==='webcontents-focus')window.webContents.focus();return {stage,at:new Date().toISOString()}},{stage,url}))
  for(const delay of [0,200,500,1000]){if(delay)await new Promise(resolve=>setTimeout(resolve,delay));samples.push(await snapshot(stage,delay))}
 }
 await expect.poll(()=>child!.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()===url)?.isFocused(),url),{timeout:5000,message:'The isolated packaged main window must gain actual native focus; renderer focus cannot substitute'}).toBe(true)
 await writeFile(join(output,'report.json'),JSON.stringify({status:'PASS',executable,actions,samples,scope:'Sequential cumulative native activation actions on one isolated alpha26 process; no editing gestures. First success does not independently prove later actions necessary.'},null,2))
 console.log(JSON.stringify({status:'PASS',output,samples:samples.length}))
}catch(error){
 await writeFile(join(output,'report.json'),JSON.stringify({status:'FAIL',executable,actions,samples,error:String(error),scope:'Native focus failure is preserved, not bypassed.'},null,2))
 console.error(String(error));process.exitCode=1
}finally{
 await child?.evaluate(({app})=>app.exit(0)).catch(()=>{})
 await child?.close().catch(()=>{})
 await rm(directory,{recursive:true,force:true})
}
