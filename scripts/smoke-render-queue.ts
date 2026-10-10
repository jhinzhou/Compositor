import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import type { BridgeInfo, EditorState } from '../src/shared/contracts'

// Delay only this disposable process's hidden renderer. No user app or profile is touched.
const directory = await mkdtemp(join(tmpdir(), 'compositor-render-queue-'))
const checks: string[] = []
const passed = (check: string) => { checks.push(check); process.stdout.write(`PASS ${check}\n`) }
let desktop: ElectronApplication | undefined, page: Page | undefined
async function ui<T = unknown>(method: string, params?: unknown): Promise<T> {
  const result = await page!.evaluate(({method, params}) => window.compositor.request(method, params), {method, params})
  assert.equal(result.ok, true, JSON.stringify(result)); return (result as {ok: true; value: T}).value
}
const state = () => ui<EditorState>('state')
const identity = (s: EditorState) => ({sessionId: s.sessionId, documentId: s.manifest.documentID, expectedRevision: s.revision, idempotencyKey: randomUUID()})
async function opacity(value: number): Promise<EditorState> {
  const s = await state()
  await ui('apply', {...identity(s), action: {type: 'layer.set_opacity', layerId: s.manifest.layers[1].id, opacity: value}})
  return state()
}
async function delayedPreview(s: EditorState) {
  const before = await desktop!.evaluate(() => (globalThis as any).__delayedRenders)
  const pending = page!.evaluate(({sessionId, revision}) => window.compositor.request('preview', {sessionId, expectedRevision: revision}), s)
  await expect.poll(() => desktop!.evaluate(() => (globalThis as any).__delayedRenders)).toBe(before + 1)
  return {pending}
}
try {
  desktop = await electron.launch({args: [process.cwd()], env: {...process.env, COMPOSITOR_PROFILE: join(directory, 'profile'), COMPOSITOR_TEST: '1'}, timeout: 60_000})
  page = await desktop.firstWindow(); await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready', 'true', {timeout: 30_000})
  const project = join(directory, 'Queued.comp')
  await desktop.evaluate(({dialog}, path) => {dialog.showSaveDialog = async () => ({canceled: false, filePath: path})}, project)
  await ui('saveDialog', {sessionId: (await state()).sessionId})
  await desktop.evaluate(({BrowserWindow}) => {
    const hidden = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('render=1'))!
    const original = hidden.webContents.send.bind(hidden.webContents)
    ;(globalThis as any).__delayedRenders = 0
    hidden.webContents.send = (channel: string, ...args: any[]) => {
      if (channel !== 'renderer:render') { original(channel, ...args); return }
      ;(globalThis as any).__delayedRenders++
      setTimeout(() => original(channel, ...args), 300)
    }
  })

  let s = await opacity(.61)
  let preview = await delayedPreview(s)
  const save = ui('saveCurrent', {sessionId: s.sessionId})
  assert.equal((await preview.pending).ok, true); await save
  assert.equal((await state()).modified, false)
  assert.equal(JSON.parse(await readFile(join(project, 'manifest.json'), 'utf8')).layers[1].opacity, .61)
  passed('Save immediately after a short preview waits and writes the current exact opacity')

  s = await opacity(.27); preview = await delayedPreview(s)
  const undo = ui('history', {...identity(s), direction: 'undo', transactionId: s.undoTransactionId})
  assert.equal((await preview.pending).ok, true); await undo
  assert.equal((await state()).manifest.layers[1].opacity, .61)
  passed('Undo during a short preview waits and restores the prior transaction')

  s = await state(); preview = await delayedPreview(s)
  const second = page.evaluate(({sessionId, revision}) => window.compositor.request('preview', {sessionId, expectedRevision: revision}), s)
  assert.equal((await preview.pending).ok, true); assert.equal((await second).ok, true)
  passed('Two concurrent previews serialize successfully through the single hidden renderer')

  s = await state(); preview = await delayedPreview(s)
  await ui('interaction', {sessionId: s.sessionId, interactionId: 'render-smoke', busy: true})
  const begin = Date.now()
  const busy = await page.evaluate(({sessionId}) => window.compositor.request('saveCurrent', {sessionId}), s)
  assert.equal(busy.ok, false); if (!busy.ok) assert.equal(busy.error.code, 'DOCUMENT_BUSY')
  assert.ok(Date.now() - begin < 250, 'A user interaction must not wait for the rendering queue')
  await ui('interaction', {sessionId: s.sessionId, interactionId: 'render-smoke', busy: false})
  assert.equal((await preview.pending).ok, true)
  passed('Active user interactions remain immediately protected while a render is pending')

  s = await state(); preview = await delayedPreview(s)
  const waitingSave = page.evaluate(({sessionId}) => window.compositor.request('saveCurrent', {sessionId}), s)
  await page.waitForTimeout(100)
  await ui('interaction', {sessionId: s.sessionId, interactionId: 'render-smoke-late', busy: true})
  assert.equal((await preview.pending).ok, true)
  const lateBusy = await waitingSave
  assert.equal(lateBusy.ok, false); if (!lateBusy.ok) assert.equal(lateBusy.error.code, 'DOCUMENT_BUSY')
  await ui('interaction', {sessionId: s.sessionId, interactionId: 'render-smoke-late', busy: false})
  passed('Interactions begun during a short render wait are rechecked before Save continues')

  s = await state(); preview = await delayedPreview(s)
  const stale = page.evaluate(({sessionId, revision}) => window.compositor.request('preview', {sessionId, expectedRevision: revision}), s)
  await opacity(.43)
  assert.equal((await preview.pending).ok, true)
  const expired = await stale; assert.equal(expired.ok, false); if (!expired.ok) assert.equal(expired.error.code, 'SNAPSHOT_EXPIRED')
  passed('Queued previews revalidate revision after acquiring the renderer and reject stale snapshots')

  await page.evaluate(() => {const input = document.createElement('textarea'); input.id = 'native-text-edit-smoke'; input.value = '40'; document.body.append(input); input.focus(); input.setSelectionRange(2, 2)})
  assert.deepEqual(await ui('textEdit', {command: 'selectAll'}), {edited: true})
  await expect.poll(() => page!.evaluate(() => {const input = document.querySelector('#native-text-edit-smoke') as HTMLTextAreaElement; return [input.selectionStart, input.selectionEnd]})).toEqual([0, 2])
  const invalid = await page.evaluate(() => window.compositor.request('textEdit', {command: 'executeJavaScript'}))
  assert.equal(invalid.ok, false)
  await page.evaluate(() => document.querySelector('#native-text-edit-smoke')?.remove())
  passed('Focused text editing uses native WebContents selectAll and rejects commands outside the allowlist')

  const bridge = await ui<BridgeInfo>('bridgeInfo')
  const connection = JSON.parse(await readFile(bridge.connectionFile, 'utf8'))
  const remote = await fetch(`http://127.0.0.1:${connection.port}/rpc`, {method: 'POST', headers: {'Authorization': `Bearer ${connection.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({method: 'textEdit', params: {command: 'selectAll'}})})
  const remoteEdit = await remote.json() as {ok: boolean}
  assert.equal(remoteEdit.ok, false)
  passed('Automation bridge rejects text-edit commands; native editing remains local to the renderer')

  await mkdir('artifacts', {recursive: true})
  await writeFile('artifacts/usability-render-queue.json', JSON.stringify({status: 'PASS', checks}, null, 2)+'\n')
  process.stdout.write(`PASS ${checks.length} rendering and text-edit checks\n`)
} finally {
  if (desktop) {await desktop.evaluate(() => process.exit(0)).catch(() => {}); await desktop.close().catch(() => {})}
  await rm(directory, {recursive: true, force: true})
}
