import test from 'node:test'
import assert from 'node:assert/strict'
import {catalogs,translate,translateMessage} from '../src/shared/i18n'
import {toolsAlpha23ZhCN} from '../src/shared/locales/tools-alpha23.zh-CN'
import {TOOL_GROUPS} from '../src/renderer/tool-groups'
import {editorMenuTemplate,nativeAccelerator} from '../src/main/editor-menu'
import type {MenuItemConstructorOptions} from 'electron'

test('alpha23 translations add messages without overriding any earlier catalog',()=>{
 const prior=new Set(catalogs.filter(catalog=>catalog!==toolsAlpha23ZhCN).flatMap(catalog=>Object.keys(catalog)))
 for(const [source,chinese] of Object.entries(toolsAlpha23ZhCN)){
  assert.equal(prior.has(source),false,source);assert.equal(translate('en',source),source);assert.equal(translate('zh-CN',source),chinese)
  assert.deepEqual([...source.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]),[...chinese.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]))
 }
 for(const group of TOOL_GROUPS)for(const entry of group.entries)assert.notEqual(translate('zh-CN',entry.label),entry.label,entry.label)
})
test('new resource and source-precision errors translate while preserving protocol error codes',()=>{
 assert.equal(translateMessage('zh-CN','UNSUPPORTED_FEATURE: Patch currently requires RGB8 pixels. The original high-depth pixels and history have been kept.'),'UNSUPPORTED_FEATURE: 修补目前需要 RGB8 像素，原始高位深像素和历史记录已保留。')
 assert.equal(translateMessage('zh-CN','Magnetic width is outside its supported range.'),'Magnetic width 超出支持范围。')
 assert.equal(translateMessage('en','The original high-depth sample pixels are unavailable.'),'The original high-depth sample pixels are unavailable.')
})
test('Window Info has a real F8 action on both platforms without making bare canvas keys global',()=>{
 for(const platform of ['darwin','win32']){
  const actions:string[]=[],menu=editorMenuTemplate(platform,action=>actions.push(action),()=>{}),window=menu.find(item=>item.label==='Window')!
  const entries=window.submenu as MenuItemConstructorOptions[],info=entries.find(item=>item.id==='info-tools')!
  assert.equal(info.label,'Info');assert.equal(info.accelerator,'f8');assert.ok(entries.indexOf(info)<entries.findIndex(item=>item.id==='navigator'))
  info.click?.({} as never,undefined,{} as never);assert.deepEqual(actions,['info-tools']);assert.equal(translate('zh-CN',info.label!),'信息')
 }
 assert.equal(nativeAccelerator('F8'),'f8');for(const chord of ['backspace','delete','b','Shift+b','Shift+f5','Shift+f6','Shift+f8'])assert.equal(nativeAccelerator(chord),undefined,chord)
})
