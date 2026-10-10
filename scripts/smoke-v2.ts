import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import type { BridgeInfo, EditorState } from '../src/shared/contracts'

const directory = await mkdtemp(join(tmpdir(), 'compositor-v2-')), profile = join(directory, 'profile'), root = process.cwd()
const checks: string[] = [], errors: string[] = []
let desktop: ElectronApplication | undefined, client: Client | undefined, page: Page | undefined
await mkdir('artifacts', { recursive: true })
async function ui<T = unknown>(method: string, params?: unknown): Promise<T> {
  const result = await page!.evaluate(({ method, params }) => window.compositor.request(method, params), { method, params })
  assert.equal(result.ok, true, JSON.stringify(result))
  return (result as { ok: true; value: T }).value
}
const state = (sessionId?: string) => ui<EditorState>('state', sessionId ? { sessionId } : {})
const identity = (s: EditorState) => ({ sessionId: s.sessionId, documentId: s.manifest.documentID, expectedRevision: s.revision, idempotencyKey: randomUUID() })
async function launch(test: boolean): Promise<void> {
  desktop = await electron.launch({ args: [root], env: { ...process.env, COMPOSITOR_PROFILE: profile, COMPOSITOR_TEST: test ? '1' : '0' }, timeout: 60_000 })
  page = await desktop.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready', 'true')
}
async function setSavePath(path: string, delay = 0): Promise<void> {
  await desktop!.evaluate(({ dialog }, { path, delay }) => { dialog.showSaveDialog = async () => { await new Promise(resolve => setTimeout(resolve, delay)); return { canceled: false, filePath: path } } }, { path, delay })
}
async function undo(): Promise<void> {
  const s = await state(); await ui('history', { ...identity(s), direction: 'undo', transactionId: s.undoTransactionId })
}
try {
  await launch(true)
  const initial = await state(), a = initial.sessionId, original = initial.manifest.documentID
  const saveA = join(directory, '中文 V2 工程.comp')
  await setSavePath(saveA); await ui('saveDialog', { sessionId: a })
  const sun = initial.manifest.layers.find(layer => layer.name === 'Sun')!, mountain = initial.manifest.layers.find(layer => layer.name === 'Mountain')!
  await page!.getByLabel('Auto Select', { exact: true }).check()
  const box = await page!.getByTestId('editor-canvas').boundingBox(); assert.ok(box)
  await page!.mouse.click(box.x + box.width * 100 / 1200, box.y + box.height * 100 / 900)
  await expect(page!.locator('.layer-row.selected .layer-name>span')).toHaveText('Sky')
  await page!.mouse.click(box.x + box.width * 815 / 1200, box.y + box.height * 285 / 900)
  await expect(page!.locator('.layer-row.selected .layer-name>span')).toHaveText('Sun')
  await expect(page!.locator('.editor-shell')).toHaveAttribute('data-dragging', 'false')
  await page!.getByLabel('Auto Select', { exact: true }).uncheck()
  checks.push('Auto Select samples source Alpha and selects the lower layer through transparent pixels')

  await page!.locator(`[data-layer-id="${sun.id}"]`).click()
  await page!.locator(`[data-layer-id="${mountain.id}"]`).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await expect(page!.locator('.layer-row.selected')).toHaveCount(2)
  const beforeOpacity = await state()
  await page!.getByLabel('Layer opacity', { exact: true }).fill('50'); await page!.getByLabel('Layer opacity', { exact: true }).press('Tab')
  await expect.poll(async () => (await state()).revision).toBe(beforeOpacity.revision + 1)
  const faded = await state()
  for (const id of [sun.id, mountain.id]) assert.equal(faded.manifest.layers.find(layer => layer.id === id)?.opacity, .5)
  const moveBox = await page!.getByTestId('editor-canvas').boundingBox(); assert.ok(moveBox)
  await page!.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2); await page!.mouse.down()
  await page!.mouse.move(moveBox.x + moveBox.width / 2 + 25, moveBox.y + moveBox.height / 2 + 15, { steps: 4 }); await page!.mouse.up()
  await expect(page!.locator('.editor-shell')).toHaveAttribute('data-dragging', 'false')
  const moved = await state(); assert.equal(moved.revision, faded.revision + 1)
  for (const id of [sun.id, mountain.id]) assert.ok(moved.manifest.layers.find(layer => layer.id === id)!.transform.origin[0] > faded.manifest.layers.find(layer => layer.id === id)!.transform.origin[0])
  await page!.getByRole('button', { name: 'New folder', exact: true }).click()
  await expect.poll(async () => (await state()).manifest.layers.length).toBe(6)
  const grouped = await state(), folder = grouped.manifest.layers.find(layer => layer.isGroup)!
  for (const id of [sun.id, mountain.id]) assert.equal(grouped.manifest.layers.find(layer => layer.id === id)?.parentID, folder.id)
  await undo(); assert.deepEqual((await state()).manifest, moved.manifest)
  checks.push('Multi-selection opacity, pointer move and grouping commit once each and undo restores the complete group operation')

  await page!.locator(`[data-layer-id="${mountain.id}"]`).click()
  await page!.locator(`[data-layer-id="${mountain.id}"]`).dragTo(page!.locator(`[data-layer-id="${sun.id}"]`))
  await expect.poll(async () => { const s = await state(); return s.manifest.layers.findIndex(layer => layer.id === mountain.id) < s.manifest.layers.findIndex(layer => layer.id === sun.id) }).toBe(true)
  await undo()
  checks.push('Real layer drag reorders siblings and remains undoable')
  await page!.getByRole('button', { name: '100%', exact: true }).click()
  await page!.locator('.viewport').evaluate(element => { element.scrollLeft = 70; element.scrollTop = 80 })
  const viewA = await page!.locator('.viewport').evaluate(element => [element.scrollLeft, element.scrollTop])
  await page!.getByRole('button', { name: 'New canvas', exact: true }).click()
  await page!.getByLabel('Canvas width').fill('512'); await page!.getByLabel('Canvas height').fill('288')
  await page!.getByRole('button', { name: 'Create canvas', exact: true }).click()
  await expect(page!.getByText('Layer 1', { exact: true })).toBeVisible()
  const bState = await state(), b = bState.sessionId
  const cState = await ui<EditorState>('demo'), c = cState.sessionId
  assert.equal(cState.manifest.documentID, original); assert.notEqual(c, a)
  await expect(page!.getByRole('tab')).toHaveCount(3)
  await page!.locator(`[role="tab"][data-session-id="${a}"]`).click()
  await expect(page!.getByTestId('zoom-status')).toHaveText('100.0%')
  await expect(page!.locator(`[data-layer-id="${mountain.id}"]`)).toHaveClass(/selected/)
  assert.deepEqual(await page!.locator('.viewport').evaluate(element => [element.scrollLeft, element.scrollTop]), viewA)
  checks.push('Three real tabs preserve independent selection, zoom and scroll; two instances of the same project use different sessions')

  const info = await ui<BridgeInfo>('bridgeInfo')
  client = new Client({ name: 'v2-smoke', version: '0.2.0' })
  await client.connect(new StdioClientTransport({ command: info.mcpCommand, args: info.mcpArgs, env: { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' }))
  const changed = await client.callTool({ name: 'document.apply', arguments: { ...identity(bState), action: { type: 'layer.rename', layerId: bState.manifest.layers[0].id, name: 'Background edited by MCP' } } })
  assert.notEqual(changed.isError, true, JSON.stringify(changed))
  const queried = await client.callTool({ name: 'document.get_state', arguments: { sessionId: b } })
  assert.equal((queried.structuredContent as EditorState).manifest.layers[0].name, 'Background edited by MCP')
  assert.equal((await state()).sessionId, a)
  const preview = await client.callTool({ name: 'document.preview', arguments: { sessionId: b, expectedRevision: bState.revision + 1, maxDimension: 512 } })
  assert.notEqual(preview.isError, true, JSON.stringify(preview))
  assert.equal((await state()).sessionId, a)
  checks.push('Real MCP edits and previews a background tab without changing the active document')

  const beforeTask = await state(b)
  const began = await client.callTool({ name: 'task.begin', arguments: { ...identity(beforeTask), label: 'Create and adjust a temporary group' } })
  assert.notEqual(began.isError, true, JSON.stringify(began))
  const taskId = (began.structuredContent as { taskId: string }).taskId
  const batchArgs = { ...identity(beforeTask), taskId, actions: [
    { type: 'group.add', name: 'Agent group', clientRef: 'folder' },
    { type: 'layer.move', layerIds: [beforeTask.manifest.layers[0].id], parentId: { ref: 'folder' }, beforeLayerId: null }
  ] }
  const batch = await client.callTool({ name: 'document.apply_batch', arguments: batchArgs })
  assert.notEqual(batch.isError, true, JSON.stringify(batch))
  const replayed = await client.callTool({ name: 'document.apply_batch', arguments: batchArgs })
  assert.deepEqual(replayed.structuredContent, batch.structuredContent)
  const afterBatch = await state(b)
  assert.equal(afterBatch.revision, beforeTask.revision + 1)
  const status = await client.callTool({ name: 'task.get_status', arguments: { sessionId: b, taskId } })
  assert.equal((status.structuredContent as { transactions: string[] }).transactions.length, 1)
  const cancelled = await client.callTool({ name: 'task.cancel', arguments: { sessionId: b, documentId: beforeTask.manifest.documentID, idempotencyKey: randomUUID(), taskId } })
  assert.equal((cancelled.structuredContent as { state: string }).state, 'cancelled')
  const stopped = await client.callTool({ name: 'document.apply', arguments: { ...identity(afterBatch), taskId, action: { type: 'layer.rename', layerId: beforeTask.manifest.layers[0].id, name: 'Should not commit' } } })
  assert.equal((stopped.structuredContent as { code: string }).code, 'TASK_STOPPED')
  const rolledBack = await client.callTool({ name: 'history.undo_task', arguments: { ...identity(afterBatch), taskId } })
  assert.notEqual(rolledBack.isError, true, JSON.stringify(rolledBack))
  assert.deepEqual((await state(b)).manifest, beforeTask.manifest)
  assert.equal((await state()).sessionId, a)
  const listed = await client.callTool({ name: 'document.list', arguments: {} })
  assert.equal((listed.structuredContent as { documents: unknown[] }).documents.length, 3)
  assert.equal((await client.listTools()).tools.length, 12)
  checks.push('Real stdio MCP batch refs commit once, retries are idempotent, cancelled tasks reject edits and task undo restores the complete background operation')

  const copyPath = join(directory, 'copy.comp')
  await setSavePath(copyPath, 400)
  const copying = ui<EditorState>('saveCopyDialog', { sessionId: a })
  await page!.locator(`[role="tab"][data-session-id="${c}"]`).click()
  const copied = await copying
  assert.equal(copied.projectPath, saveA); assert.equal(copied.modified, true)
  assert.equal((await state()).sessionId, c)
  assert.equal(JSON.parse(await readFile(join(copyPath, 'manifest.json'), 'utf8')).documentID, original)
  await ui('saveCurrent', { sessionId: a })
  assert.equal((await state(a)).modified, false)
  assert.equal(JSON.parse(await readFile(join(saveA, 'manifest.json'), 'utf8')).layers.find((layer: { id: string }) => layer.id === sun.id).opacity, .5)
  checks.push('Save Copy and Save remain bound to their captured session even while the active tab changes')

  await desktop!.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }) })
  await ui('closeDocument', { sessionId: b }); assert.equal((await state()).workspace?.documents.length, 3)
  const saveB = join(directory, 'closed-after-save.comp')
  await setSavePath(saveB)
  await desktop!.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }) })
  await ui('closeDocument', { sessionId: b }); assert.equal((await state()).workspace?.documents.length, 2)
  assert.equal(JSON.parse(await readFile(join(saveB, 'manifest.json'), 'utf8')).layers[0].name, 'Background edited by MCP')
  const expired = await client.callTool({ name: 'document.get_state', arguments: { sessionId: b } })
  assert.equal((expired.structuredContent as { code: string }).code, 'SESSION_EXPIRED')
  checks.push('Close Cancel retains the tab; Close Save writes content and expires the closed document handle')

  const activeA = await state(a)
  await ui('apply', { ...identity(activeA), action: { type: 'layer.rename', layerId: sun.id, name: 'Recovered Sun' } })
  await desktop!.evaluate(({ dialog, app }) => {
    delete process.env.COMPOSITOR_TEST
    dialog.showMessageBox = async () => { await new Promise(resolve => setTimeout(resolve, 1000)); return { response: 2, checkboxChecked: false } }
    app.quit()
  })
  const duringQuit = await state(a)
  const closeRace = await client.callTool({ name: 'document.apply', arguments: { ...identity(duringQuit), action: { type: 'layer.rename', layerId: sun.id, name: 'Edit during quit' } } })
  assert.equal((closeRace.structuredContent as { code: string }).code, 'DOCUMENT_BUSY')
  await page!.waitForTimeout(1100)
  assert.deepEqual((await state(a)).manifest, duringQuit.manifest)
  checks.push('Real app.quit waits for the dirty-document decision, blocks racing Agent edits and Cancel keeps the application alive')
  const checkpoint = await ui<{ entries: { id: string; sessionId: string }[]; recoveryError?: string }>('checkpoint')
  assert.equal(checkpoint.recoveryError, undefined)
  assert.ok(checkpoint.entries.some(entry => entry.sessionId === a))
  await page!.locator(`[role="tab"][data-session-id="${a}"]`).click()
  await page!.screenshot({ path: 'artifacts/desktop-v2-tabs.png' })
  await client.close(); client = undefined
  // A hard exit bypasses close prompts and leaves only the persisted recovery copy.
  await desktop!.evaluate(() => process.exit(74)).catch(() => {})
  await desktop!.close().catch(() => {}); desktop = undefined
  await launch(false)
  await page!.getByRole('button', { name: 'Recovery', exact: true }).click()
  const entry = page!.locator('.recovery-entry').filter({ hasText: '中文 V2 工程' })
  await entry.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page!.getByText('Recovered Sun', { exact: true })).toBeVisible()
  const recovered = await state()
  assert.notEqual(recovered.sessionId, a); assert.equal(recovered.modified, true); assert.equal(recovered.projectPath, undefined)
  assert.equal(JSON.parse(await readFile(join(saveA, 'manifest.json'), 'utf8')).layers.find((layer: { id: string }) => layer.id === sun.id).name, 'Sun')
  await page!.getByRole('button', { name: 'Close recovery' }).click()
  await page!.screenshot({ path: 'artifacts/desktop-v2-recovery.png' })
  checks.push('A hard application exit followed by relaunch restores the persisted draft into a new session without overwriting the original project')
  assert.deepEqual(errors, [])
  await writeFile('artifacts/desktop-v2-validation.json', JSON.stringify({ status: 'PASS', platform: process.platform, architecture: process.arch, checks, rendererErrors: errors }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2))
} catch (error) {
  await page?.screenshot({ path: 'artifacts/desktop-v2-failure.png' }).catch(() => {})
  await writeFile('artifacts/desktop-v2-validation.json', JSON.stringify({ status: 'FAIL', checks, rendererErrors: errors, error: String(error) }, null, 2))
  throw error
} finally {
  await client?.close().catch(() => {})
  if (desktop) { await desktop.evaluate(() => process.exit(0)).catch(() => {}); await desktop.close().catch(() => {}) }
  await rm(directory, { recursive: true, force: true })
}
