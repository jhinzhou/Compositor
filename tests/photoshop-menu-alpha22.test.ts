import test from 'node:test'
import assert from 'node:assert/strict'
import { editorMenuTemplate, nativeAccelerator } from '../src/main/editor-menu'
import { translate } from '../src/shared/i18n'
import type { MenuItemConstructorOptions } from 'electron'

function children(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] { return Array.isArray(item.submenu) ? item.submenu : [] }
function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] { return items.flatMap(item => [item, ...flat(children(item))]) }
const template = () => editorMenuTemplate('darwin', () => {}, () => {})
test('implemented Photoshop menus keep native order on both platforms', () => {
  const order = ['File', 'Edit', 'Image', 'Layer', 'Type', 'Select', 'Filter', 'View', 'Window', 'Help']
  assert.deepEqual(template().slice(1).map(item => item.label), order)
  assert.deepEqual(editorMenuTemplate('win32', () => {}, () => {}).map(item => item.label), order)
})
test('canvas keys never become global native accelerators', () => {
  for (const key of ['backspace', 'delete', 'tab', 'enter', 'escape', 'space', 'b', 'Shift+b', 'Shift+f5', 'Shift+f6', 'Shift+[']) assert.equal(nativeAccelerator(key), undefined, key)
  assert.equal(nativeAccelerator('Primary+Shift+s'), 'CmdOrCtrl+Shift+s')
  assert.equal(nativeAccelerator('Alt+backspace'), 'Alt+backspace')
  assert.equal(nativeAccelerator('bad+key'), undefined)
  assert.equal(flat(template()).find(item => item.id === 'delete')?.accelerator, undefined)
})
test('adjustments, selection modification, content fill and free transform use familiar locations', () => {
  const menu = template()
  const edit = children(menu.find(item => item.label === 'Edit')!)
  assert.ok(edit.some(item => item.id === 'content-fill'))
  assert.ok(edit.some(item => item.id === 'transform-selection'))
  const image = children(menu.find(item => item.label === 'Image')!)
  assert.ok(children(image.find(item => item.label === 'Adjustments')!).some(item => item.id === 'filter:hsl'))
  assert.ok(image.findIndex(item => item.id === 'image-size') < image.findIndex(item => item.id === 'canvas-size'))
  const select = children(menu.find(item => item.label === 'Select')!)
  assert.deepEqual(children(select.find(item => item.label === 'Modify')!).map(item => item.id), ['selection-smooth', 'selection-border', 'selection-expand', 'selection-contract', 'selection-feather'])
  assert.ok(!select.some(item => item.id === 'content-fill'))
  assert.deepEqual(select.slice(0, 4).map(item => item.id), ['select-all', 'deselect', 'reselect', 'invert-selection'])
})
test('every command has one native location and grouped filters preserve all implemented kinds', () => {
  const entries = flat(template()), ids = entries.map(item => item.id).filter(Boolean)
  assert.equal(new Set(ids).size, ids.length)
  const filterMenu = children(template().find(item => item.label === 'Filter')!)
  assert.equal(filterMenu[0].id, 'repeat-filter')
  assert.ok(children(filterMenu.find(item => item.label === 'Blur')!).some(item => item.id === 'filter:gaussianBlur'))
  for (const entry of entries) if (entry.label && !['Compositor Electron', '简体中文', 'English'].includes(entry.label)) assert.notEqual(translate('zh-CN', entry.label), entry.label, entry.label)
})
