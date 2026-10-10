import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { chromium } from '@playwright/test'

async function component(filename: string, id: string, props: Record<string, unknown>) {
  const { descriptor } = parse(await readFile(filename, 'utf8'), { filename })
  const script = compileScript(descriptor, { id, inlineTemplate: true, templateOptions: { ssr: true } })
  const module = { exports: {} as any }
  new Function('module', 'exports', 'require', transformSync(script.content, { loader: 'ts', format: 'cjs' }).code)(module, module.exports, createRequire(import.meta.url))
  module.exports.default.__scopeId = id
  return { markup: await renderToString(createSSRApp(module.exports.default, props)), styles: compileStyle({ filename, source: descriptor.styles[0].content, id, scoped: true }).code }
}
const globalStyle = await readFile('src/renderer/style.css', 'utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results: unknown[] = []
await mkdir('artifacts/usability-audit', { recursive: true })
try {
  for (const [width, height] of [[800, 700], [360, 450]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    const raw = await component('src/renderer/RawImportPanel.vue', 'data-v-raw-audit', { open: true, filename: 'example.dng', metadata: { width: 4000, height: 3000 }, preview: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220"><rect width="300" height="220" fill="slategray"/></svg>').toString('base64') })
    await page.setContent(`<style>${globalStyle}\n${raw.styles}</style>${raw.markup}`)
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.raw-import')!, select = document.querySelector<HTMLSelectElement>('[aria-label="White balance"]')!, style = getComputedStyle(select), rect = panel.getBoundingClientRect()
      return { contentHeight: select.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth), lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3, panelCSSHeight:getComputedStyle(panel).height, backdropHeight:panel.parentElement!.getBoundingClientRect().height, backdropTop:panel.parentElement!.getBoundingClientRect().top, panelTop: rect.top, panelBottom: rect.bottom, viewportHeight: innerHeight, overflow: panel.scrollWidth - panel.clientWidth, scrollHeight: panel.scrollHeight, panelHeight: panel.clientHeight }
    })
    assert.ok(metrics.contentHeight >= metrics.lineHeight, JSON.stringify(metrics))
    assert.ok(metrics.panelTop >= 19 && metrics.panelBottom <= height - 19, JSON.stringify(metrics))
    assert.ok(metrics.overflow <= 1, JSON.stringify(metrics))
    if (height < 500) assert.ok(metrics.scrollHeight > metrics.panelHeight)
    await page.screenshot({ path: `artifacts/usability-audit/raw-${width}x${height}.png` })
    results.push({ case: 'raw', width, height, ...metrics }); await page.close()
  }
  for (const sampling of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } })
    const brush = await component('src/renderer/BrushCursor.vue', 'data-v-brush-audit', { point: [100, 80], diameter: 24, zoom: 2, tool: 'brush', hardness: .5, showHardness: true, sampling })
    await page.setContent(`<style>${globalStyle}\n${brush.styles}.canvas-wrap-audit{position:absolute;left:0;top:0;width:400px;height:300px;background:#777}</style><div class="canvas-wrap-audit">${brush.markup}</div>`)
    const metrics = await page.evaluate(() => {
      const cursor = document.querySelector<SVGElement>('.brush-cursor')!, rect = cursor.getBoundingClientRect()
      return { centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2, width: rect.width, radius: Number(cursor.querySelector('circle')?.getAttribute('r')), mode: cursor.dataset.mode, pointerEvents: getComputedStyle(cursor).pointerEvents, circles: cursor.querySelectorAll('circle').length }
    })
    assert.equal(metrics.centerX, 200); assert.equal(metrics.centerY, 160); assert.equal(metrics.pointerEvents, 'none')
    assert.equal(metrics.mode, sampling ? 'sample' : 'brush')
    if (!sampling) { assert.equal(metrics.radius, 24); assert.equal(metrics.circles, 4) } else assert.equal(metrics.width, 22)
    await page.screenshot({ path: `artifacts/usability-audit/brush-${sampling ? 'sample' : 'circle'}.png` })
    results.push({ case: 'brush', sampling, ...metrics }); await page.close()
  }
  const eyedropper = await component('src/renderer/BrushCursor.vue', 'data-v-brush-audit', { point: [1, 2], diameter: 24, zoom: 1, tool: 'eyedropper' })
  assert.ok(eyedropper.markup.includes('data-mode="sample"'))
  const hidden = await component('src/renderer/BrushCursor.vue', 'data-v-brush-audit', { point: [1, 2], diameter: 24, zoom: 1, tool: 'move' })
  assert.ok(!hidden.markup.includes('<svg'))
  await writeFile('artifacts/usability-audit/raw-brush-layout.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
