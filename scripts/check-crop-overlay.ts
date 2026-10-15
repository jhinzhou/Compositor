import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {parse,compileScript,compileStyle} from '@vue/compiler-sfc'
import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {PNG} from 'pngjs'

// Isolated browser fixture: it neither starts Electron nor opens a user profile.
const filename=resolve('src/renderer/CropOverlay.vue')
const {descriptor}=parse(await readFile(filename,'utf8'),{filename})
const id='data-v-crop-audit'
const component=compileScript(descriptor,{id,inlineTemplate:true}).content.replace('export default','const CropOverlay =')
const source=`import {createApp,h,reactive} from 'vue';\n${component}\n
CropOverlay.__scopeId='${id}';
const state=reactive({draft:{x:80,y:60,width:160,height:120},zoom:1,spacePan:false,interaction:false,updates:0,backgroundClicks:0,cancels:0,before:null});
window.cropAudit=state;
createApp({render:()=>h('div',{class:'canvas-wrap audit-canvas',style:{width:320*state.zoom+'px',height:240*state.zoom+'px'},onPointerdown:()=>state.backgroundClicks++},[h(CropOverlay,{draft:state.draft,zoom:state.zoom,spacePan:state.spacePan,snap:{document:{width:320,height:240}},onUpdate:rect=>{state.draft=rect;state.updates++},onCancel:()=>{state.cancels++;if(state.before)state.draft=state.before},onInteraction:active=>{if(active)state.before=JSON.parse(JSON.stringify(state.draft));state.interaction=active;if(!active)state.before=null}})])}).mount('#app');`
const bundle=await build({stdin:{contents:source,loader:'ts',resolveDir:resolve('src/renderer')},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}})
const styles=compileStyle({filename,source:descriptor.styles[0].content,id,scoped:true})
assert.equal(styles.errors.length,0)
const globalStyle=await readFile('src/renderer/style.css','utf8')
await mkdir('artifacts/usability-audit',{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const results:unknown[]=[]
try {
 const page=await browser.newPage({viewport:{width:700,height:550}})
 await page.setContent(`<style>${globalStyle}\n${styles.code}\n.audit-canvas{position:absolute;left:50px;top:50px;background:#c8c8c8;box-shadow:none}</style><div id="app"></div>`)
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 for(const zoom of [1,1.5]){
  await page.evaluate(zoom=>{(window as any).cropAudit.zoom=zoom},zoom)
  await page.waitForFunction(zoom=>document.querySelector('.crop-shade')?.getAttribute('width')===String(320*zoom),zoom)
  const metrics=await page.evaluate(()=>{
   const handle=document.querySelector<HTMLElement>('.crop-handle.se')!,rect=handle.getBoundingClientRect(),visible=getComputedStyle(handle,'::after'),shade=document.querySelector<SVGElement>('.crop-shade')!
   return {hitWidth:rect.width,hitHeight:rect.height,visibleWidth:parseFloat(visible.width),visibleHeight:parseFloat(visible.height),shadePointerEvents:getComputedStyle(shade).pointerEvents,thirds:document.querySelectorAll('.crop-thirds span').length,transparentHit:document.elementFromPoint(rect.x+1,rect.y+1)===handle}
  })
  assert.equal(metrics.hitWidth,12);assert.equal(metrics.hitHeight,12);assert.equal(metrics.visibleWidth,4);assert.equal(metrics.visibleHeight,4);assert.equal(metrics.shadePointerEvents,'none');assert.equal(metrics.thirds,4);assert.equal(metrics.transparentHit,true)
  const image=PNG.sync.read(await page.screenshot({path:`artifacts/usability-audit/crop-zoom-${zoom}.png`}))
  const pixel=(x:number,y:number)=>Array.from(image.data.subarray((Math.round(y)*image.width+Math.round(x))*4,(Math.round(y)*image.width+Math.round(x))*4+3))
  assert.deepEqual(pixel(50+20*zoom,50+20*zoom),[80,80,80])
  assert.deepEqual(pixel(50+100*zoom,50+80*zoom),[200,200,200])
  assert.deepEqual(pixel(20,20),[27,27,27])
  results.push({zoom,...metrics,outside:[80,80,80],inside:[200,200,200]})
 }
 // Start from the transparent part of a handle; retain pointer capture and Escape rollback.
 const handle=await page.locator('.crop-handle.se').boundingBox();assert.ok(handle)
 await page.keyboard.down('Control')
 await page.mouse.move(handle.x+1,handle.y+1);await page.mouse.down();await page.mouse.move(handle.x+16,handle.y+16)
 await page.waitForFunction(()=>(window as any).cropAudit.draft.width===170)
 assert.equal(await page.evaluate(()=>(window as any).cropAudit.interaction),true)
 await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Control')
 assert.equal(await page.evaluate(()=>(window as any).cropAudit.draft.width),160)
 assert.equal(await page.evaluate(()=>(window as any).cropAudit.interaction),false)
 assert.equal(await page.evaluate(()=>(window as any).cropAudit.cancels),1)
 await page.mouse.click(80,80)
 assert.equal(await page.evaluate(()=>(window as any).cropAudit.backgroundClicks),1)
 await page.evaluate(()=>{const state=(window as any).cropAudit;state.zoom=1;state.draft={x:-20,y:40,width:140,height:120};state.spacePan=true})
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.crop-frame')!).pointerEvents==='none')
 assert.equal(await page.locator('.crop-handle.se').evaluate(element=>getComputedStyle(element).pointerEvents),'none')
 const expanded=PNG.sync.read(await page.screenshot({path:'artifacts/usability-audit/crop-expanded.png'}))
 const expandedPixel=(x:number,y:number)=>Array.from(expanded.data.subarray((y*expanded.width+x)*4,(y*expanded.width+x)*4+3))
 assert.deepEqual(expandedPixel(70,120),[200,200,200]);assert.deepEqual(expandedPixel(250,230),[80,80,80]);assert.deepEqual(expandedPixel(20,20),[27,27,27])
 results.push({interaction:'transparent hit resize, Escape rollback, outside shade passthrough, space pan passthrough, expanded crop clipping',passed:true})
 await writeFile('artifacts/usability-audit/crop-overlay.json',JSON.stringify(results,null,2))
 console.log(JSON.stringify(results,null,2))
} finally {await browser.close()}
