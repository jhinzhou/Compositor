import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as i18n from '../src/renderer/i18n'
const { applyLocale } = i18n

function component(name: string) {
  const filename=resolve(`src/renderer/${name}.vue`), {descriptor}=parse(readFileSync(filename,'utf8'),{filename})
  const code=transformSync(compileScript(descriptor,{id:`locale-${name}`,inlineTemplate:true}).content,{loader:'ts',format:'cjs'}).code
  const module={exports:{} as any}, require=createRequire(filename)
  new Function('require','module','exports',code)((id:string)=>id==='./i18n'?i18n:require(id),module,module.exports)
  return module.exports.default
}

test('Agent settings and message chrome translate while model protocol and user content are preserved',async()=>{
  try {
    const chat=component('AgentChat')
    applyLocale('zh-CN')
    const settings=await renderToString(createSSRApp(chat,{conversation:[],configured:false}))
    assert.match(settings,/模型设置/)
    assert.match(settings,/服务 URL/)
    assert.match(settings,/value="openai-compatible"/)
    assert.match(settings,/value="anthropic"/)
    assert.match(settings,/API 密钥/)
    applyLocale('en')
    const english=await renderToString(createSSRApp(chat,{conversation:[],configured:false}))
    assert.match(english,/Model settings/)
    assert.match(english,/value="openai-compatible"/)
    applyLocale('zh-CN')
    const text='User content: English + 中文不改',model='provider-exact-model-v1'
    const transcript=await renderToString(createSSRApp(chat,{conversation:[{id:'user',role:'user',content:text}],configured:true,config:{model,protocol:'openai-compatible',endpoint:'https://provider.example/v1'}}))
    assert.ok(transcript.includes(text))
    assert.ok(transcript.includes(model))
    assert.match(transcript,/清空对话/)
    assert.match(transcript,/智能助手/)
  } finally {applyLocale('en')}
})

test('Image Size units and sampling translate without altering canonical values',async()=>{
  try {
    const dialog=component('ImageSizeDialog')
    applyLocale('zh-CN')
    const html=await renderToString(createSSRApp(dialog,{width:128,height:96,resolution:72,shortcutOverrides:{},shortcutPlatform:'mac'}))
    assert.match(html,/图像大小/)
    assert.match(html,/value="Pixels"[^>]*>像素/)
    assert.match(html,/value="Inches"[^>]*>英寸/)
    assert.match(html,/value="High quality"[^>]*>高质量/)
    assert.match(html,/value="Nearest"[^>]*>最近邻/)
    assert.match(html,/结果：128 × 96 像素/)
    applyLocale('en')
    const english=await renderToString(createSSRApp(dialog,{width:128,height:96,resolution:72,shortcutOverrides:{},shortcutPlatform:'mac'}))
    assert.match(english,/Image Size/)
    assert.match(english,/value="Inches"[^>]*>Inches/)
    assert.match(english,/Result: 128 × 96 pixels/)
  } finally {applyLocale('en')}
})
