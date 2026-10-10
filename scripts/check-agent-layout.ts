import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import { transformSync } from 'esbuild'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { chromium } from '@playwright/test'

const source = await readFile('src/renderer/AgentChat.vue', 'utf8')
const { descriptor } = parse(source, { filename: 'AgentChat.vue' })
const script = compileScript(descriptor, { id: 'data-v-agent-audit', inlineTemplate: true, templateOptions: { ssr: true } })
const module = { exports: {} as any }
new Function('module', 'exports', 'require', transformSync(script.content, { loader: 'ts', format: 'cjs' }).code)(module, module.exports, createRequire(import.meta.url))
module.exports.default.__scopeId = 'data-v-agent-audit'
const styles = compileStyle({ filename: 'AgentChat.vue', source: descriptor.styles[0].content, id: 'data-v-agent-audit', scoped: true }).code
const globalStyle = await readFile('src/renderer/style.css', 'utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results: unknown[] = []
await mkdir('artifacts/usability-audit', { recursive: true })
try {
  for (const [width, height] of [[420, 800], [320, 450], [280, 450]]) {
    const page = await browser.newPage({ viewport: { width: width + 40, height }, deviceScaleFactor: 1 })
    const markup = await renderToString(createSSRApp(module.exports.default, { conversation: [], tools: [], configured: false }))
    await page.setContent(`<style>${globalStyle}\n${styles}\n.audit-host{position:absolute;inset:10px;width:${width}px;overflow:hidden;background:#242424;border:1px solid #555}</style><div class="audit-host">${markup}</div>`)
    const metrics = await page.evaluate(() => {
      const settings = document.querySelector<HTMLElement>('.model-settings')!
      const select = document.querySelector<HTMLSelectElement>('[aria-label="Model protocol"]')!
      const style = getComputedStyle(select), rect = select.getBoundingClientRect()
      const host = document.querySelector<HTMLElement>('.audit-host')!, hostRect = host.getBoundingClientRect()
      const header = document.querySelector('header')!.getBoundingClientRect(), close = document.querySelector('[aria-label="Close Agent"]')!.getBoundingClientRect()
      return { width: host.clientWidth, contentHeight: rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth), lineHeight: parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4, scrollHeight: settings.scrollHeight, settingsHeight: settings.clientHeight, closeInHeader: close.top >= header.top && close.bottom <= header.bottom, maxHorizontalOverflow: Math.max(...[...document.querySelectorAll<HTMLElement>('header, .agent-status, .agent-composer, .model-settings')].map(element => element.scrollWidth - element.clientWidth)), footerInside: document.querySelector('.agent-composer')!.getBoundingClientRect().bottom <= hostRect.bottom }
    })
    assert.ok(metrics.contentHeight >= metrics.lineHeight, JSON.stringify(metrics))
    assert.ok(metrics.closeInHeader, JSON.stringify(metrics))
    assert.ok(metrics.maxHorizontalOverflow <= 1, JSON.stringify(metrics))
    assert.ok(metrics.footerInside, JSON.stringify(metrics))
    if (height <= 450) assert.ok(metrics.scrollHeight > metrics.settingsHeight, JSON.stringify(metrics))
    await page.screenshot({ path: `artifacts/usability-audit/agent-${width}x${height}.png` })
    results.push({ requestedWidth: width, height, ...metrics })
    await page.close()
  }
  await writeFile('artifacts/usability-audit/agent-layout.json', JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} finally { await browser.close() }
