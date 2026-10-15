import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {transformSync} from 'esbuild'
import type {EditorState} from '../../src/shared/contracts'
import type {decodePhotoshop} from '../../src/core/photoshop-io'

type Document=ReturnType<typeof decodePhotoshop>
let engineModule:Promise<any>|undefined
async function moduleForRender(){
 return engineModule??= (async()=>{
  const require=createRequire(import.meta.url),kit=await require('canvaskit-wasm')({locateFile:(file:string)=>require.resolve(`canvaskit-wasm/bin/${file}`)})
  kit.MakeSWCanvasSurface=(element:{width:number;height:number})=>kit.MakeSurface(element.width,element.height)
  const file=resolve('src/renderer/canvas-engine.ts'),source=transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,local=createRequire(file),module={exports:{} as any}
  new Function('require','module','exports',source)((specifier:string)=>specifier==='canvaskit-wasm'?()=>Promise.resolve(kit):specifier.endsWith('.wasm?url')?'':local(specifier),module,module.exports)
  return module.exports
 })()
}
export async function renderCorpusDocument(document:Document):Promise<Buffer>{
 const module=await moduleForRender(),manifest=structuredClone(document.manifest)
 const assets=[...document.assets.values()].map(asset=>{const file=`data:image/png;base64,${asset.bytes.toString('base64')}`;for(const layer of manifest.layers){if(layer.imageFile===asset.file)layer.imageFile=file;if(layer.maskFile===asset.file)layer.maskFile=file}return {file,width:asset.width,height:asset.height,hash:asset.hash}})
 const state:EditorState={sessionId:randomUUID(),revision:0,manifest,assets,title:'Independent PSD corpus',modified:false,canUndo:false,canRedo:false,warnings:document.warnings,activity:[]},engine=new module.CanvasEngine()
 engine.setFullResolutionEffects(true)
 try{await engine.draw({} as HTMLCanvasElement,state,manifest.width,manifest.height);return Buffer.from(engine.png())}finally{engine.dispose()}
}
