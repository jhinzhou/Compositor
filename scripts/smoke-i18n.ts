import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EditorState, PreviewResult } from '../src/shared/contracts'
import { translate, type Locale } from '../src/shared/i18n'

// Only temporary profiles/documents. Pointer/keyboard smoke scripts run serially.
const root = process.cwd(), temp = await mkdtemp(join(tmpdir(), 'compositor-i18n-'))
const profile = join(temp, 'profile'), output = 'artifacts/i18n', checks: string[] = [], errors: string[] = []
let app: ElectronApplication | undefined
async function launch() {
  app = await electron.launch({ args: [root], env: { ...process.env, COMPOSITOR_TEST: '1', COMPOSITOR_PROFILE: profile }, timeout: 60000 })
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready', 'true', { timeout: 60000 })
  return page
}
async function stop() {
  if (!app) return
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {}); app = undefined
}
try {
  await mkdir(output, { recursive: true })
  const page = await launch()
  let locale: Locale = 'en'
  const label = (source: string) => translate(locale, source)
  async function rpc<T = any>(method: string, params?: unknown): Promise<T> {
    const result = await page.evaluate(({ method, params }) => window.compositor.request(method, params), { method, params })
    assert.equal(result.ok, true, JSON.stringify(result))
    return (result as { ok: true; value: T }).value
  }
  const state = () => rpc<EditorState>('state')
  const identity = (s: EditorState) => ({ sessionId: s.sessionId, documentId: s.manifest.documentID, expectedRevision: s.revision, idempotencyKey: randomUUID() })
  async function apply(action: unknown) { return rpc('apply', { ...identity(await state()), action }) }
  async function switchTo(next: Locale, nativeMenu = false) {
    if (nativeMenu) await app!.evaluate(({ Menu }, next) => { const item = Menu.getApplicationMenu()!.getMenuItemById(`locale:${next}`)!; item.click(item, undefined, {} as any) }, next)
    else if (locale !== next) await page.locator('.interface-language').click()
    locale = next
    await expect(page.locator('html')).toHaveAttribute('lang', next)
    await expect(page.getByRole('button', { name: label('Search commands'), exact: true })).toBeVisible()
    await expect.poll(async () => (await rpc('localeGet')).locale).toBe(next)
  }
  async function command(source: string, query = source) {
    await page.getByRole('button', { name: label('Search commands'), exact: true }).click()
    await page.getByRole('combobox', { name: label('Search commands'), exact: true }).fill(query)
    await page.locator('.command-results button').filter({ has: page.getByText(label(source), { exact: true }) }).first().click()
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('.interface-language span.active')).toHaveText('EN')
  await page.locator('.interface-language').screenshot({ path: join(output, 'toggle-english.png') })
  await page.locator('.interface-language').focus(); await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.locator('.interface-language')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.interface-language')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  checks.push('Focused language button uses Enter and Space for one toggle each without triggering canvas panning')
  await page.screenshot({ path: join(output, 'welcome-english.png') })
  await rpc('newDocument'); await rpc('create', { sessionId: (await state()).sessionId, width: 96, height: 64 })
  const layerId = (await state()).manifest.layers[0]!.id
  await apply({ type: 'layer.rename', layerId, name: 'Opacity · 用户图层' })
  await apply({ type: 'layer.fill', layerId, target: 'image', color: [.2, .6, .9, 1] })
  const before = await state(), preview = await rpc<PreviewResult>('preview', { sessionId: before.sessionId, expectedRevision: before.revision, maxDimension: 128 })
  await rpc('setShortcuts', { new: 'Primary+Alt+N' })
  await switchTo('zh-CN')
  const after = await state()
  for (const key of ['manifest', 'assets', 'revision', 'activity', 'selection', 'title'] as const) assert.deepEqual(after[key], before[key], key)
  const translatedPreview = await rpc<PreviewResult>('preview', { sessionId: after.sessionId, expectedRevision: after.revision, maxDimension: 128 })
  assert.equal(translatedPreview.data, preview.data)
  await expect(page.getByText('Opacity · 用户图层', { exact: true })).toBeVisible()
  const menus = await app!.evaluate(({ Menu }) => ({ labels: Menu.getApplicationMenu()!.items.map(item => item.label), accelerator: Menu.getApplicationMenu()!.getMenuItemById('new')!.accelerator, invert: Menu.getApplicationMenu()!.getMenuItemById('invert-selection')!.label }))
  assert.ok(menus.labels.includes('文件')); assert.ok(menus.labels.includes('编辑')); assert.equal(menus.invert, '反选选区')
  assert.equal(String(menus.accelerator).toLowerCase(), 'cmdorctrl+alt+n')
  checks.push('Chinese switch updates renderer/native menus and preserves custom shortcuts, complete document state and byte-identical rendered PNG')
  const activeStyle = await page.locator('.interface-language span.active').evaluate(node => ({ weight: getComputedStyle(node).fontWeight, color: getComputedStyle(node).color }))
  assert.equal(activeStyle.weight, '700'); assert.equal(activeStyle.color, 'rgb(245, 245, 245)')
  await expect(page.locator('.interface-language span.active')).toHaveText('ZH')
  await page.locator('.interface-language').screenshot({ path: join(output, 'toggle-chinese.png') })
  await page.screenshot({ path: join(output, 'editor-chinese.png') })
  for (const query of ['Color Range', '色彩范围']) {
    await command('Color Range', query)
    await expect(page.getByAltText(label('Color Range selection preview'))).toBeVisible()
    await page.locator('.feature-panel').filter({ has: page.getByText(label('Color Range'), { exact: true }) }).getByRole('button', { name: label('Cancel'), exact: true }).click()
    assert.equal((await state()).revision, before.revision)
  }
  checks.push('English and Chinese command searches open the same Color Range preview; Cancel preserves history')
  await command('Image Size', '图像大小')
  let imageDialog = page.getByRole('dialog', { name: label('Image Size'), exact: true })
  await expect(imageDialog).toBeVisible()
  await imageDialog.getByLabel(label('Image sampling'), { exact: true }).selectOption('Nearest')
  assert.equal(await imageDialog.getByLabel(label('Image sampling'), { exact: true }).inputValue(), 'Nearest')
  await imageDialog.getByLabel(label('Image size units')).selectOption('Percent')
  await imageDialog.getByLabel(label('Image width'), { exact: true }).fill('50')
  await imageDialog.getByLabel(label('Image width'), { exact: true }).blur()
  await expect(imageDialog.getByLabel(label('Image height'), { exact: true })).toHaveValue('50')
  await switchTo('en', true)
  imageDialog = page.getByRole('dialog', { name: 'Image Size', exact: true })
  await expect(imageDialog).toBeVisible(); await expect(imageDialog.getByLabel('Image width', { exact: true })).toHaveValue('50')
  await imageDialog.getByRole('button', { name: 'Resize', exact: true }).click()
  await expect.poll(async () => [(await state()).manifest.width, (await state()).manifest.height]).toEqual([48, 32])
  await rpc('history', { ...identity(await state()), direction: 'undo' })
  assert.deepEqual((await state()).manifest, before.manifest)
  checks.push('An open Image Size dialog switches language without losing its draft; canonical sampling/unit values resize correctly and Undo restores exact metadata')
  await page.getByRole('button', { name: 'Agent chat', exact: true }).click()
  await page.getByLabel('Model service URL', { exact: true }).fill('https://example.invalid/v1')
  await page.getByLabel('Model name', { exact: true }).fill('deepseek-chat')
  await switchTo('zh-CN')
  await expect(page.getByLabel(label('Model service URL'), { exact: true })).toHaveValue('https://example.invalid/v1')
  await expect(page.getByLabel(label('Model name'), { exact: true })).toHaveValue('deepseek-chat')
  await expect(page.getByLabel(label('Model protocol'), { exact: true })).toHaveValue('openai-compatible')
  const metrics = await page.getByLabel(label('Model protocol'), { exact: true }).evaluate(node => {
    const s = getComputedStyle(node); return { height: node.clientHeight, fontSize: parseFloat(s.fontSize), padding: parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) }
  })
  assert.ok(metrics.height - metrics.padding >= metrics.fontSize * 1.4)
  await page.screenshot({ path: join(output, 'agent-chinese.png') })
  await page.getByRole('button', { name: label('Close Agent'), exact: true }).click()
  checks.push('Open Agent settings localize live while preserving provider URL, model and protocol; protocol text has sufficient line height')
  await command('Camera Raw Filter', 'Camera Raw')
  const camera = page.getByRole('dialog', { name: label('Camera Raw Filter'), exact: true })
  await expect(camera).toBeVisible(); await expect(camera.getByRole('button', { name: label('Apply'), exact: true })).toBeEnabled()
  await camera.getByRole('button', { name: label('Cancel'), exact: true }).click()
  checks.push('Chinese Camera Raw opens its real filter preview and cancels without applying')
  await app!.evaluate(({ dialog }) => {
    // tsx names nested functions with this helper; the target JS context does
    // not load the test runner's helpers.
    ;(globalThis as any).__name = (fn: unknown) => fn
    ;(globalThis as any).__i18nDialogs = []
    const capture = async (...args: any[]) => { (globalThis as any).__i18nDialogs.push(args.at(-1)); return { canceled: true, filePaths: [] } }
    dialog.showOpenDialog = capture as any; dialog.showSaveDialog = capture as any
  })
  await rpc('openDialog'); await rpc('importDialog'); await rpc('saveDialog')
  const dialogs = await app!.evaluate(() => (globalThis as any).__i18nDialogs)
  assert.deepEqual(dialogs.map((d: any) => d.title), ['打开 Compositor 工程', '导入图像', '工程另存为'])
  assert.equal(dialogs[2].defaultPath, `${before.title}.comp`)
  assert.ok(dialogs[1].filters[0].extensions.includes('webp'))
  checks.push('Native open/import/save dialog options are Chinese while filenames and format extensions retain canonical values')
  const invalid = await page.evaluate(() => window.compositor.request('localeSet', { locale: 'fr' }))
  assert.equal(invalid.ok, false); assert.equal((await rpc('localeGet')).locale, 'zh-CN')
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'language-settings.json'), 'utf8')), { version: 1, locale: 'zh-CN' })
  await stop()
  const restarted = await launch()
  await expect(restarted.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(restarted.locator('.interface-language span.active')).toHaveText('ZH')
  await app!.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu()!.getMenuItemById('locale:en')!; item.click(item, undefined, {} as any) })
  await expect(restarted.locator('html')).toHaveAttribute('lang', 'en')
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'language-settings.json'), 'utf8')), { version: 1, locale: 'en' })
  checks.push('Invalid locale is rejected; saved Chinese survives restart, and the native Help language menu updates and persists English')
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'desktop.json'), JSON.stringify({ status: 'PASS', checks, errors, metrics }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks, errors, metrics }, null, 2))
} catch (cause) {
  if (app) { const page = await app.firstWindow(); await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {}); console.error(await page.locator('body').innerText()) }
  await writeFile(join(output, 'desktop.json'), JSON.stringify({ status: 'FAIL', checks, errors, failure: String(cause) }, null, 2)); throw cause
} finally { await stop(); await rm(temp, { recursive: true, force: true }) }
