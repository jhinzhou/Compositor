import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import type { EditorState } from '../src/shared/contracts'

const version = JSON.parse(await readFile('package.json', 'utf8')).version
const executable = resolve(process.argv[2] ?? `release/${version}/mac-arm64/Compositor Electron.app/Contents/MacOS/Compositor Electron`)
const directory = await mkdtemp(join(tmpdir(), 'compositor-packed-i18n-')), profile = join(directory, 'profile')
let app: ElectronApplication | undefined
const checks: string[] = []
async function read<T = any>(source: string): Promise<T> {
  return app!.evaluate(({ BrowserWindow }, source) => BrowserWindow.getAllWindows().find(window => window.isVisible())!.webContents.executeJavaScript(source), source)
}
async function launch() {
  app = await electron.launch({ executablePath: executable, args: [], env: { ...process.env, COMPOSITOR_TEST: '1', COMPOSITOR_PROFILE: profile }, timeout: 60000 })
  await expect.poll(() => read("document.querySelector('.editor-shell')?.dataset.ready"), { timeout: 60000 }).toBe('true')
  assert.deepEqual(await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged })), { version, packaged: true })
}
async function stop() {
  if (!app) return
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); app = undefined
}
async function captureButton(locale: string) {
  const rect = await read("(()=>{const b=document.querySelector('.interface-language').getBoundingClientRect();return {x:Math.floor(b.x),y:Math.floor(b.y),width:Math.ceil(b.width),height:Math.ceil(b.height)}})()")
  const bytes = await app!.evaluate(async ({ BrowserWindow }, rect) => Array.from((await BrowserWindow.getAllWindows().find(window => window.isVisible())!.webContents.capturePage(rect)).toPNG()), rect)
  await writeFile(`artifacts/i18n/toggle-${locale}.png`, Buffer.from(bytes))
}
try {
  await mkdir('artifacts/i18n', { recursive: true })
  await launch()
  const before = await read("window.compositor.request('state')")
  assert.equal(before.ok, true)
  assert.equal(await read("document.documentElement.lang"), 'en')
  assert.equal(await read("document.querySelector('.interface-language span.active').textContent"), 'EN')
  await captureButton('english')
  await read("document.querySelector('.interface-language').click(); undefined")
  await expect.poll(() => read('document.documentElement.lang')).toBe('zh-CN')
  const after = await read("window.compositor.request('state')")
  for (const key of ['manifest', 'assets', 'revision', 'activity', 'selection', 'title'] as const) assert.deepEqual((after.value as EditorState)[key], (before.value as EditorState)[key])
  const button = await read("(()=>{const el=document.querySelector('.interface-language span.active');return {text:el.textContent,weight:getComputedStyle(el).fontWeight,color:getComputedStyle(el).color}})()")
  assert.deepEqual(button, { text: 'ZH', weight: '700', color: 'rgb(245, 245, 245)' })
  await captureButton('chinese')
  const menus = await app!.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label))
  assert.ok(menus.includes('文件')); assert.ok(menus.includes('帮助'))
  const png = await app!.evaluate(async ({ BrowserWindow }) => Array.from((await BrowserWindow.getAllWindows().find(window => window.isVisible())!.webContents.capturePage()).toPNG()))
  await writeFile('artifacts/i18n/packaged-chinese.png', Buffer.from(png))
  checks.push('Actual alpha.7 packaged executable single-click switches EN to ZH, highlights correctly and translates native menus without changing the document')
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'language-settings.json'), 'utf8')), { version: 1, locale: 'zh-CN' })
  await stop(); await launch()
  assert.equal(await read('document.documentElement.lang'), 'zh-CN')
  assert.equal(await read("document.querySelector('.interface-language span.active').textContent"), 'ZH')
  await app!.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu()!.getMenuItemById('locale:en')!; item.click(item, undefined, {} as any) })
  await expect.poll(() => read('document.documentElement.lang')).toBe('en')
  assert.equal(await read("document.querySelector('.interface-language span.active').textContent"), 'EN')
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'language-settings.json'), 'utf8')), { version: 1, locale: 'en' })
  checks.push('The real packaged app preserves Chinese after restart and updates its active EN indicator when the native menu changes language')
  await writeFile('artifacts/i18n/packaged.json', JSON.stringify({ status: 'PASS', version, executable, checks }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', version, checks }, null, 2))
} catch (cause) {
  await writeFile('artifacts/i18n/packaged.json', JSON.stringify({ status: 'FAIL', version, executable, checks, failure: String(cause) }, null, 2)); throw cause
} finally { await stop(); await rm(directory, { recursive: true, force: true }) }
