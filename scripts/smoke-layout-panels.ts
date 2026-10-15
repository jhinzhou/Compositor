import { _electron as electron, chromium, expect, type Browser, type ElectronApplication, type Page } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { translate, type Locale } from '../src/shared/i18n'
import type { EditorState } from '../src/shared/contracts'

// Runs only against a disposable profile. The parent acceptance process owns UI execution.
const root = process.cwd()
const temp = await realpath(await mkdtemp(join(tmpdir(), 'compositor-layout-panels-')))
const output = process.env.COMPOSITOR_SMOKE_OUTPUT ?? 'artifacts/layout-panels'
const checks: string[] = [], errors: string[] = [], geometry: unknown[] = [], screenshotFallbacks: { path: string; reason: string }[] = []
const stateCheckpoints: unknown[]=[],controlKeys:unknown[]=[]
let app: ElectronApplication | undefined, browser: Browser | undefined, page: Page | undefined
try {
  await mkdir(output, { recursive: true })
  let debugPort: number | undefined
  if (process.env.COMPOSITOR_EXECUTABLE) {
    const listener = createServer()
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
    debugPort = (listener.address() as { port: number }).port
    await new Promise<void>(resolve => listener.close(() => resolve()))
  }
  app = await electron.launch({
    executablePath: process.env.COMPOSITOR_EXECUTABLE,
    args: debugPort ? [`--remote-debugging-port=${debugPort}`] : [root],
    env: { ...process.env, COMPOSITOR_TEST: '1', COMPOSITOR_PROFILE: join(temp, 'profile') },
    timeout: 60000,
  })
  await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('render=1') && /^(file:|https?:)/.test(window.webContents.getURL()))?.webContents.getURL()), { timeout: 30000 }).toBeTruthy()
  const mainURL = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('render=1') && /^(file:|https?:)/.test(window.webContents.getURL()))!.webContents.getURL())
  if (debugPort) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
    page = browser.contexts()[0].pages().find(item => item.url() === mainURL)
    assert.ok(page)
  } else {
    await expect.poll(() => app!.windows().map(item => item.url()), { timeout: 30000 }).toContain(mainURL)
    page = app.windows().find(item => item.url() === mainURL)
    assert.ok(page)
  }
  const visible = page
  visible.on('pageerror', error => errors.push(error.message))
  visible.on('console',message=>{const text=message.text();if(text.startsWith('ALPHA21_CONTROL:'))controlKeys.push(JSON.parse(text.slice('ALPHA21_CONTROL:'.length)))})
  await visible.evaluate(()=>document.addEventListener('keydown',event=>{if(['Enter','Backspace','Delete','Tab','Escape'].includes(event.key)){const target=event.target as HTMLElement;console.log('ALPHA21_CONTROL:'+JSON.stringify({key:event.key,target:target?.tagName,type:(target as HTMLInputElement)?.type,role:target?.getAttribute?.('role'),trusted:event.isTrusted}))}},true))
  await expect(visible.locator('.editor-shell')).toHaveAttribute('data-ready', 'true', { timeout: 60000 })
  async function screenshot(path: string) {
    await app!.evaluate(({ BrowserWindow }, url) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)
      if (!window) throw new Error('Main screenshot window is unavailable.')
      window.show(); window.focus()
    }, visible.url())
    try { await visible.screenshot({ path, animations: 'disabled', timeout: 10000 }) }
    catch (error) {
      // Capture the same actual renderer, bypassing Playwright's stalled compositor-frame wait.
      const encoded = await app!.evaluate(async ({ BrowserWindow }, url) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)
        if (!window) throw new Error('Main screenshot window is unavailable.')
        const image = await window.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true })
        if (image.isEmpty()) throw new Error('The layout screenshot is empty.')
        return image.toPNG().toString('base64')
      }, visible.url())
      await writeFile(path, Buffer.from(encoded, 'base64'))
      screenshotFallbacks.push({ path, reason: String(error) })
    }
  }
  async function rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    const result = await visible.evaluate(({ method, params }) => window.compositor.request(method, params), { method, params })
    assert.equal(result.ok, true, JSON.stringify(result))
    return (result as { ok: true; value: T }).value
  }
  const state = () => rpc<EditorState>('state')
  const stable = (s: EditorState) => ({ sessionId: s.sessionId, revision: s.revision, manifest: s.manifest, assets: s.assets })
  async function apply(action: unknown) {
    const s = await state()
    return rpc('apply', { sessionId: s.sessionId, documentId: s.manifest.documentID, expectedRevision: s.revision, idempotencyKey: randomUUID(), action })
  }
  async function command(title: string, locale: Locale) {
    await visible.getByRole('button', { name: translate(locale, 'Search commands'), exact: true }).click()
    await visible.getByRole('combobox', { name: translate(locale, 'Search commands'), exact: true }).fill(translate(locale, title))
    await visible.getByRole('option').filter({ has: visible.getByText(translate(locale, title), { exact: true }) }).click()
  }
  async function measurePanel(selector: string, actions: string, tag: string, name: string) {
    const panel = visible.locator(selector)
    await expect(panel).toBeVisible()
    await panel.locator(actions).last().scrollIntoViewIfNeeded()
    const result = await panel.evaluate((element, actions) => {
      const bounds = element.getBoundingClientRect()
      const buttons = Array.from(element.querySelectorAll(actions)).map(button => {
        const r = button.getBoundingClientRect(), css = getComputedStyle(button)
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, background: css.backgroundColor, radius: parseFloat(css.borderTopLeftRadius), border: parseFloat(css.borderTopWidth) }
      })
      const controls = Array.from(element.querySelectorAll('select,input:not([type=checkbox]):not([type=range]):not([type=color])')).map(control => {
        const r = control.getBoundingClientRect(), css = getComputedStyle(control)
        return { label: control.getAttribute('aria-label') ?? '', x: r.x, right: r.right, height: r.height, contentHeight: r.height - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - parseFloat(css.borderTopWidth) - parseFloat(css.borderBottomWidth), lineHeight: css.lineHeight === 'normal' ? parseFloat(css.fontSize) * 1.2 : parseFloat(css.lineHeight) }
      })
      return { dialog: { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom }, viewport: { width: innerWidth, height: innerHeight }, overflow: element.scrollWidth > element.clientWidth + 1, buttons, controls }
    }, actions)
    assert.equal(result.overflow, false, `${name} must not overflow horizontally`)
    assert.ok(result.dialog.x >= 0 && result.dialog.y >= 0 && result.dialog.right <= result.viewport.width + 1 && result.dialog.bottom <= result.viewport.height + 1, `${name} panel must fit in viewport`)
    for (const button of result.buttons) {
      assert.ok(button.height >= 23 && button.border >= 1 && button.radius >= 4 && button.background !== 'rgba(0, 0, 0, 0)', `${name} actions need visible button styles`)
      assert.ok(button.x >= result.dialog.x && button.right <= result.dialog.right + 1 && button.y >= result.dialog.y && button.bottom <= result.dialog.bottom + 1, `${name} actions must remain reachable`)
    }
    for (let i = 0; i < result.buttons.length; i++) for (let j = i + 1; j < result.buttons.length; j++) {
      const a = result.buttons[i], b = result.buttons[j]
      assert.ok(Math.min(a.right, b.right) <= Math.max(a.x, b.x) || Math.min(a.bottom, b.bottom) <= Math.max(a.y, b.y), `${name} actions overlap`)
    }
    for (const control of result.controls) {
      assert.ok(control.contentHeight + .5 >= control.lineHeight, `${name} ${control.label} line-height must fit inside padding/borders`)
      assert.ok(control.x >= result.dialog.x && control.right <= result.dialog.right + 1, `${name} controls must fit horizontally`)
    }
    geometry.push({ tag, panel: name, ...result })
    await screenshot(join(output, `${name}-${tag}.png`))
    checks.push(`${tag}: ${name} fields have sufficient text height; action buttons fit, stay reachable and do not overlap`)
  }
  await rpc('newDocument')
  await rpc('create', { sessionId: (await state()).sessionId, width: 320, height: 240 })
  await apply({ type: 'layer.fill', layerId: (await state()).manifest.activeLayerID, color: [.2, .45, .7, 1], target: 'image' })
  await apply({ type: 'layer.mask', layerId: (await state()).manifest.activeLayerID, operation: 'reveal' })
  await apply({ type: 'selection.set', selection: { inverted: false, feather: 0, shapes: [{ kind: 'rectangle', operation: 'replace', bounds: [20, 20, 80, 60], feather: 0 }] } })
  await apply({ type: 'selection.save_named', name: '中文长名称与 English layout fixture selection' })
  const initial = stable(await state())
  async function checkpoint(stage:string){
    const current=await state()
    stateCheckpoints.push({stage,revision:current.revision,activity:current.activity.slice(0,3)})
    assert.deepEqual(stable(current),initial,`${stage}; latest activity ${JSON.stringify(current.activity.slice(0,3))}`)
  }

  for (const size of [{ width: 1050, height: 720 }, { width: 1440, height: 840 }]) {
    await app.evaluate(({ BrowserWindow }, request) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === request.url)
      if (!window) throw new Error('Main layout window is unavailable.')
      window.show(); window.setContentSize(request.size.width, request.size.height); window.focus()
    }, { size, url: visible.url() })
    await expect.poll(() => visible.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(size)
    for (const locale of ['zh-CN', 'en'] as Locale[]) {
      const t = (message: string) => translate(locale, message)
      await rpc('localeSet', { locale })
      await expect(visible.locator('html')).toHaveAttribute('lang', locale)
      const tag = `${locale}-${size.width}x${size.height}`

      await visible.getByRole('button', { name: t('Recent projects'), exact: true }).click()
      const recent = visible.locator('.recent-dialog')
      await expect(recent).toBeVisible()
      await expect(recent.locator('.recent-empty')).toHaveText(t('No recent projects yet.'))
      await expect(recent.getByRole('button', { name: t('Clear recent projects'), exact: true })).toBeDisabled()
      const recentGeometry = await recent.evaluate(element => {
        const regions = Object.fromEntries(['header', '.recent-dialog-body', 'footer'].map(selector => {
          const bounds = element.querySelector(selector)!.getBoundingClientRect()
          return [selector, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, bottom: bounds.bottom, right: bounds.right }]
        })) as Record<string, { x: number; y: number; width: number; height: number; bottom: number; right: number }>
        const dialog = element.getBoundingClientRect()
        const buttons = Array.from(element.querySelectorAll('footer button')).map(button => {
          const bounds = button.getBoundingClientRect(), css = getComputedStyle(button)
          return { x: bounds.x, y: bounds.y, height: bounds.height, right: bounds.right, background: css.backgroundColor, border: parseFloat(css.borderTopWidth), radius: parseFloat(css.borderTopLeftRadius), nowrap: css.whiteSpace }
        })
        return { viewport: { width: innerWidth, height: innerHeight }, dialog: { x: dialog.x, y: dialog.y, right: dialog.right, bottom: dialog.bottom }, header: regions.header, body: regions['.recent-dialog-body'], footer: regions.footer, buttons, overflow: element.scrollWidth > element.clientWidth }
      })
      assert.ok(recentGeometry.header.bottom <= recentGeometry.body.y)
      assert.ok(recentGeometry.body.bottom <= recentGeometry.footer.y)
      assert.equal(recentGeometry.overflow, false)
      assert.ok(recentGeometry.dialog.x >= 0 && recentGeometry.dialog.y >= 0 && recentGeometry.dialog.right <= size.width && recentGeometry.dialog.bottom <= size.height)
      assert.equal(recentGeometry.buttons.length, 2)
      assert.ok(Math.abs(recentGeometry.buttons[0].y - recentGeometry.buttons[1].y) <= 1)
      for (const button of recentGeometry.buttons) assert.ok(button.height >= 32 && button.border >= 1 && button.radius >= 5 && button.background !== 'rgba(0, 0, 0, 0)' && button.nowrap === 'nowrap')
      assert.notEqual(recentGeometry.buttons[0].background, recentGeometry.buttons[1].background)
      geometry.push({ tag, panel: 'recent', ...recentGeometry })
      await screenshot(join(output, `recent-${tag}.png`))
      await recent.getByRole('button', { name: t('Close'), exact: true }).click()
      await expect(recent).toBeHidden()
      await visible.getByRole('button', { name: t('Recent projects'), exact: true }).click()
      await visible.locator('.modal-backdrop').click({ position: { x: 8, y: 8 } })
      await expect(recent).toBeHidden()
      checks.push(`${tag}: empty Recent title/body/actions stay on separate rows, buttons retain disabled/close/backdrop semantics`)

      const foreground = visible.locator('.foreground-swatch')
      const originalColor = await foreground.evaluate(element => getComputedStyle(element).backgroundColor)
      const nextColor = originalColor === 'rgb(51, 102, 153)' ? '#cc8844' : '#336699'
      const nextChannels = nextColor === '#cc8844' ? ['204', '136', '68'] : ['51', '102', '153']
      await foreground.click()
      const picker = visible.locator('.color-picker-panel')
      await expect(picker).toBeVisible()
      const pickerGeometry = await picker.evaluate(element => {
        const fields = element.querySelector('.color-picker-fields')!, hex = fields.querySelector('label:last-child')!, title = hex.querySelector('span')!, input = hex.querySelector('input')!
        const regions = Object.fromEntries([['dialog', element], ['header', element.querySelector('header')!], ['fields', fields], ['hexLabel', title], ['hexInput', input], ['sv', element.querySelector('.sv')!], ['hue', element.querySelector('.hue-control')!], ['footer', element.querySelector('footer')!]].map(([name, target]) => {
          const r = (target as Element).getBoundingClientRect()
          return [name, { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }]
        })) as Record<string, { x: number; y: number; width: number; height: number; right: number; bottom: number }>
        const range = document.createRange(); range.selectNodeContents(title)
        const text = range.getBoundingClientRect()
        const buttons = Array.from(element.querySelectorAll('footer button')).map(button => { const css = getComputedStyle(button), r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, background: css.backgroundColor, radius: parseFloat(css.borderTopLeftRadius), border: parseFloat(css.borderTopWidth) } })
        return { dialog: regions.dialog, header: regions.header, fields: regions.fields, hexLabel: regions.hexLabel, hexText: { width: text.width, height: text.height }, hexInput: regions.hexInput, sv: regions.sv, hue: regions.hue, footer: regions.footer, buttons, overflow: element.scrollWidth > element.clientWidth, viewport: { width: innerWidth, height: innerHeight }, fontSize: parseFloat(getComputedStyle(title).fontSize) }
      })
      assert.equal(pickerGeometry.overflow, false)
      assert.ok(pickerGeometry.dialog.x >= 0 && pickerGeometry.dialog.y >= 0 && pickerGeometry.dialog.right <= size.width && pickerGeometry.dialog.bottom <= size.height)
      assert.ok(pickerGeometry.hexText.height < pickerGeometry.fontSize * 1.8, 'Hex label must remain one line')
      assert.ok(pickerGeometry.hexText.width <= pickerGeometry.hexLabel.width + 1)
      assert.ok(pickerGeometry.hexLabel.right < pickerGeometry.hexInput.x)
      assert.ok(pickerGeometry.hexInput.width >= 75)
      assert.ok(pickerGeometry.hue.y >= pickerGeometry.sv.bottom)
      assert.ok(pickerGeometry.fields.right <= pickerGeometry.dialog.right)
      assert.ok(pickerGeometry.footer.y > pickerGeometry.fields.bottom)
      assert.ok(Math.abs(pickerGeometry.buttons[0].y - pickerGeometry.buttons[1].y) <= 1)
      for (const button of pickerGeometry.buttons) assert.ok(button.height >= 32 && button.radius >= 5 && button.border >= 1 && button.background !== 'rgba(0, 0, 0, 0)')
      assert.notEqual(pickerGeometry.buttons[0].background, pickerGeometry.buttons[1].background)
      geometry.push({ tag, panel: 'color-picker', ...pickerGeometry })
      const hexInput = picker.getByRole('textbox', { name: t('Color hex'), exact: true })
      await hexInput.fill(nextColor)
      await hexInput.press('Tab')
      for (const [index, channel] of ['R', 'G', 'B'].entries()) await expect(picker.getByRole('spinbutton', { name: translate(locale, 'Color {channel}', { channel }), exact: true })).toHaveValue(nextChannels[index])
      await screenshot(join(output, `color-picker-${tag}.png`))
      await picker.getByRole('button', { name: t('Cancel'), exact: true }).click()
      await expect(picker).toBeHidden()
      assert.equal(await foreground.evaluate(element => getComputedStyle(element).backgroundColor), originalColor)
      await foreground.click()
      await picker.getByRole('textbox', { name: t('Color hex'), exact: true }).fill(nextColor)
      await picker.getByRole('button', { name: t('OK'), exact: true }).click()
      await expect(picker).toBeHidden()
      assert.equal(await foreground.evaluate(element => getComputedStyle(element).backgroundColor), `rgb(${nextChannels.join(', ')})`)
      checks.push(`${tag}: Hex/RGB fields fit without wrapping; Cancel preserves color and OK applies the same color`)

      await visible.getByRole('button', { name: t('Zoom (Z)'), exact: true }).click()
      const zoomInput = visible.getByRole('spinbutton', { name: t('Zoom percentage'), exact: true })
      for (const value of ['0.1', '25', '100']) {
        await zoomInput.fill(value)
        await zoomInput.press('Enter')
        await expect(visible.getByTestId('zoom-status')).toHaveText(`${Number(value).toFixed(1)}%`)
        await expect(zoomInput).toHaveValue(value)
      }
      const zoomGeometry = await visible.locator('.zoom-control').evaluate(element => {
        const input = element.querySelector('input')!.getBoundingClientRect(), unit = element.querySelector('.zoom-unit')!.getBoundingClientRect(), label = element.getBoundingClientRect(), toolbar = element.closest('.navigation-toolbar')!.getBoundingClientRect()
        return { label: { x: label.x, y: label.y, right: label.right, bottom: label.bottom }, input: { x: input.x, y: input.y, right: input.right, height: input.height }, unit: { x: unit.x, y: unit.y, height: unit.height, text: element.querySelector('.zoom-unit')!.textContent }, toolbar: { y: toolbar.y, right: toolbar.right, bottom: toolbar.bottom } }
      })
      assert.equal(zoomGeometry.unit.text, '%')
      assert.ok(zoomGeometry.unit.x > zoomGeometry.input.right)
      assert.ok(Math.abs(zoomGeometry.input.y + zoomGeometry.input.height / 2 - zoomGeometry.unit.y - zoomGeometry.unit.height / 2) <= 1)
      assert.ok(zoomGeometry.label.y >= zoomGeometry.toolbar.y && zoomGeometry.label.bottom <= zoomGeometry.toolbar.bottom && zoomGeometry.label.right <= zoomGeometry.toolbar.right)
      geometry.push({ tag, panel: 'zoom', ...zoomGeometry })
      await screenshot(join(output, `zoom-${tag}.png`))
      assert.deepEqual(stable(await state()), initial)
      checks.push(`${tag}: 0.1 / 25 / 100 mean percentages, percent unit stays beside input; document pixels/history stay unchanged`)

      await visible.getByRole('button', { name: t('Agent chat'), exact: true }).click()
      if(!await visible.locator('.model-settings').isVisible())await visible.getByRole('button', { name: t('Model settings'), exact: true }).click()
      await visible.getByRole('combobox', { name: t('Model protocol'), exact: true }).selectOption('anthropic')
      await visible.getByRole('combobox', { name: t('Model protocol'), exact: true }).selectOption('openai-compatible')
      await measurePanel('.agent-chat', '.settings-actions button', tag, 'agent-settings')
      await visible.locator('.model-settings').getByRole('button', { name: t('Cancel'), exact: true }).click()
      await visible.getByRole('button', { name: t('Close Agent'), exact: true }).click()
      await checkpoint(`${tag}: after await visible.getByRole('button', { name: t('Close Agent'), exact: true }).click()`)

      await command('Image Size', locale)
      await visible.getByRole('combobox', { name: t('Image size units'), exact: true }).selectOption('Centimeters')
      await measurePanel('.image-size-dialog', 'footer button', tag, 'image-size')
      await visible.locator('.image-size-dialog').getByRole('button', { name: t('Cancel'), exact: true }).click()
      await checkpoint(`${tag}: after await visible.locator('.image-size-dialog').getByRole('button', { name: t('Cancel'), exact: true }).click()`)

      await command('Exposure', locale)
      await expect(visible.locator('.filter-panel button[type=submit]')).toBeEnabled({ timeout: 30000 })
      await measurePanel('.filter-panel', 'footer button', tag, 'filters')
      await visible.locator('.filter-panel').getByRole('button', { name: t('Cancel'), exact: true }).click()
      await checkpoint(`${tag}: after await visible.locator('.filter-panel').getByRole('button', { name: t('Cancel'), exact: true }).click()`)

      await command('Export As', locale)
      await expect(visible.locator('.export-panel button[type=submit]')).toBeEnabled({ timeout: 30000 })
      await visible.locator('.export-more > button').click();await visible.locator('.export-format-menu button').filter({hasText:'PDF'}).click()
      await expect(visible.locator('.export-panel button[type=submit]')).toBeEnabled({ timeout: 30000 })
      await measurePanel('.export-panel', 'footer button', tag, 'export')
      await visible.locator('.export-panel').getByRole('button', { name: t('Cancel'), exact: true }).click()
      await checkpoint(`${tag}: after await visible.locator('.export-panel').getByRole('button', { name: t('Cancel'), exact: true }).click()`)

      await command('Fill Selection', locale)
      await visible.getByRole('combobox', { name: t('Fill contents'), exact: true }).selectOption('background')
      await measurePanel('.fill-dialog', 'footer button', tag, 'fill')
      await visible.locator('.fill-dialog').getByRole('button', { name: t('Cancel'), exact: true }).click()
      await checkpoint(`${tag}: after await visible.locator('.fill-dialog').getByRole('button', { name: t('Cancel'), exact: true }).click()`)

      await command('Keyboard Shortcuts', locale)
      await visible.getByRole('textbox', { name: t('Search shortcuts'), exact: true }).fill(t('Zoom'))
      await measurePanel('.shortcut-dialog', 'footer button', tag, 'shortcuts')
      await visible.locator('.shortcut-dialog').getByRole('button', { name: t('Cancel'), exact: true }).click()
      await checkpoint(`${tag}: after await visible.locator('.shortcut-dialog').getByRole('button', { name: t('Cancel'), exact: true }).click()`)

      await command('Named Selections', locale)
      await visible.locator('.named-selections select').selectOption('intersect')
      await measurePanel('.feature-panel:has(.named-selections)', '.named-selections form:last-child button', tag, 'named-selections')
      await visible.locator('.feature-panel:has(.named-selections) .drawer-heading button').click()
      await checkpoint(`${tag}: after await visible.locator('.feature-panel:has(.named-selections) .drawer-heading button').click()`)

      await command('Layer Transform and Merge', locale)
      await measurePanel('.feature-panel:has(.mask-panel)', '.mask-panel > fieldset .mask-buttons button', tag, 'mask')
      await visible.locator('.feature-panel:has(.mask-panel) .drawer-heading button').click()
      await checkpoint(`${tag}: after await visible.locator('.feature-panel:has(.mask-panel) .drawer-heading button').click()`)
      await command('Select Subject / Object / Remove Background', locale)
      await visible.getByRole('combobox', { name: t('Matte Quality'), exact: true }).selectOption('advanced')
      await measurePanel('.feature-panel:has(.object-selection-tools)', '.object-selection-tools .row:first-child button', tag, 'subject-controls')
      await visible.locator('.feature-panel:has(.object-selection-tools) .drawer-heading button').click()
      await checkpoint(`${tag}: after await visible.locator('.feature-panel:has(.object-selection-tools) .drawer-heading button').click()`)
      const layerFooter = await visible.locator('.layer-footer').evaluate(element => {
        const r = element.getBoundingClientRect()
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, overflow: element.scrollWidth > element.clientWidth + 1, buttons: Array.from(element.querySelectorAll('button')).map(button => { const b = button.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom } }) }
      })
      assert.equal(layerFooter.overflow, false)
      assert.equal(layerFooter.buttons.length, 6)
      for (const b of layerFooter.buttons) assert.ok(b.x >= layerFooter.x && b.right <= layerFooter.right && b.y >= layerFooter.y && b.bottom <= layerFooter.bottom)
      geometry.push({ tag, panel: 'layer-toolbar', ...layerFooter })
      checks.push(`${tag}: all six bottom layer toolbar buttons fit the sidebar`)
      assert.deepEqual(stable(await state()), initial)
    }
  }
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'passed', checks, geometry, errors, screenshotFallbacks,stateCheckpoints,controlKeys }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, output }))
} catch (error) {
  await mkdir(output, { recursive: true })
  await page?.screenshot({ path: join(output, 'failure.png'), timeout: 10000 }).catch(() => undefined)
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'failed', checks, geometry, errors, screenshotFallbacks,stateCheckpoints,controlKeys, failure: String(error) }, null, 2))
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await app?.close().catch(() => undefined)
  await rm(temp, { recursive: true, force: true })
}
