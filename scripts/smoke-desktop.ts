import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import type { BridgeInfo, EditorState } from '../src/shared/contracts'

const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'compositor-desktop-'))
await mkdir('artifacts', { recursive: true })
let desktop: ElectronApplication | undefined, client: Client | undefined
const errors: string[] = []
const checks: string[] = []
try {
  // Let Playwright inject its ready-event loader before Electron creates windows.
  desktop = await electron.launch({ args: [root], env: { ...process.env, COMPOSITOR_PROFILE: join(directory, 'profile'), COMPOSITOR_TEST: '1' }, timeout: 60_000 })
  desktop.process().stderr?.on('data', data => { const value = String(data); if (!value.includes('WARNING')) process.stderr.write(value) })
  const page = await desktop.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.getByText('Mountain', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByTestId('editor-canvas')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByLabel('Layer opacity', { exact: true }).fill('80')
  await page.getByLabel('Layer opacity', { exact: true }).press('Tab')
  await expect(page.getByLabel('Layer opacity', { exact: true })).toHaveValue('80')
  const uiState = await page.evaluate(async () => {
    const result = await window.compositor.request<EditorState>('state')
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  })
  assert.equal(uiState.revision, 1); assert.equal(uiState.manifest.layers[1].opacity, .8)
  checks.push('UI edits commit through the shared utility-process editor')
  await page.getByRole('button', { name: 'Automation', exact: true }).click()
  await expect(page.getByText('Local bridge ready')).toBeVisible()
  const info = await page.evaluate(async () => {
    const result = await window.compositor.request<BridgeInfo>('bridgeInfo')
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  })
  const connection = JSON.parse(await readFile(info.connectionFile, 'utf8'))
  const unauthorized = await fetch(`http://127.0.0.1:${connection.port}/rpc`, { method: 'POST', body: '{}' })
  assert.equal(unauthorized.status, 403)
  const invalidOrigin = await fetch(`http://127.0.0.1:${connection.port}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, Origin: 'https://example.com' }, body: '{}' })
  assert.equal(invalidOrigin.status, 403)
  checks.push('Local bridge rejects unauthenticated and browser-origin requests')
  client = new Client({ name: 'desktop-smoke', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: info.mcpCommand, args: info.mcpArgs, env: { ...Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string')), ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' })
  transport.stderr?.on('data', data => process.stderr.write(data))
  await client.connect(transport)
  const tools = await client.listTools()
  assert.equal(tools.tools.length, 12)
  async function state(): Promise<EditorState> {
    const result = await client!.callTool({ name: 'document.get_state', arguments: {} })
    assert.equal(result.isError, false)
    return result.structuredContent as EditorState
  }
  async function preview(current: EditorState) {
    const result = await client!.callTool({ name: 'document.preview', arguments: { sessionId: current.sessionId, expectedRevision: current.revision, maxDimension: 1024 } })
    assert.notEqual(result.isError, true, JSON.stringify(result))
    const content = result.content as { type: string; data?: string }[]
    const image = content.find(item => item.type === 'image')!
    assert.ok(image.data); return Buffer.from(image.data, 'base64')
  }
  const current = await state()
  const before = await preview(current)
  const decoded = PNG.sync.read(before)
  assert.equal(decoded.width, 1024); assert.equal(decoded.height, 768)
  assert.ok(decoded.data.some(channel => channel > 0))
  await writeFile('artifacts/mcp-preview.png', before)
  checks.push('MCP stdio client discovers twelve tools and receives a real CanvasKit PNG')
  const layer = current.manifest.layers[1]
  const input = { sessionId: current.sessionId, documentId: current.manifest.documentID, expectedRevision: current.revision,
    idempotencyKey: randomUUID(), action: { type: 'layer.set_opacity', layerId: layer.id, opacity: .25 } }
  const changed = await client.callTool({ name: 'document.apply', arguments: input })
  assert.notEqual(changed.isError, true)
  const transaction = changed.structuredContent as { transactionId: string; revision: number }
  const retried = await client.callTool({ name: 'document.apply', arguments: input })
  assert.deepEqual(retried.structuredContent, transaction)
  const edited = await state()
  assert.equal(edited.revision, current.revision + 1)
  assert.notDeepEqual(PNG.sync.read(await preview(edited)).data, decoded.data)
  const stale = await client.callTool({ name: 'document.apply', arguments: { ...input, idempotencyKey: randomUUID() } })
  assert.equal(stale.isError, true); assert.equal((stale.structuredContent as { code: string }).code, 'REVISION_CONFLICT')
  const undone = await client.callTool({ name: 'history.undo', arguments: { sessionId: edited.sessionId, documentId: edited.manifest.documentID,
    expectedRevision: edited.revision, idempotencyKey: randomUUID(), transactionId: transaction.transactionId } })
  assert.notEqual(undone.isError, true)
  const restored = await state()
  assert.equal(restored.revision, edited.revision + 1)
  assert.deepEqual(PNG.sync.read(await preview(restored)).data, decoded.data)
  checks.push('Agent edits update pixels; retries deduplicate; stale edits fail; undo restores pixels')
  await page.getByRole('button', { name: 'Close automation', exact: true }).click()
  await expect(page.getByLabel('Layer opacity')).toHaveValue('80')
  const box = await page.getByTestId('editor-canvas').boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.waitForTimeout(150)
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await state()).revision).toBe(restored.revision + 1)
  const moved = await state(); assert.notEqual(moved.manifest.layers[1].transform.origin[0], 0)
  checks.push('Real pointer drag commits one undoable transform')
  await expect(page.locator('.editor-shell')).toHaveAttribute('data-dragging', 'false')
  const savePath = join(directory, 'roundtrip.comp'), exportPath = join(directory, 'output.png')
  await desktop.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, savePath)
  const saved = await page.evaluate(() => window.compositor.request('saveDialog'))
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const savedManifest = JSON.parse(await readFile(join(savePath, 'manifest.json'), 'utf8'))
  assert.equal(savedManifest.documentID, moved.manifest.documentID)
  assert.deepEqual(savedManifest.layers[1].transform, moved.manifest.layers[1].transform)
  await desktop.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, exportPath)
  const exported = await page.evaluate(() => window.compositor.request('exportDialog'))
  assert.equal(exported.ok, true, JSON.stringify(exported))
  const output = PNG.sync.read(await readFile(exportPath))
  assert.equal(output.width, 1200); assert.equal(output.height, 900)
  checks.push('Native dialog paths save a compatible .comp and export a full-size PNG')
  await page.screenshot({ path: 'artifacts/desktop-layers.png' })
  await page.getByRole('button', { name: 'Automation', exact: true }).click()
  await page.screenshot({ path: 'artifacts/desktop-automation.png' })
  await page.getByRole('button', { name: 'Close automation', exact: true }).click()
  async function undoTop() {
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-dragging', 'false')
    const current = await state()
    const result = await client!.callTool({ name: 'history.undo', arguments: { sessionId: current.sessionId, documentId: current.manifest.documentID,
      expectedRevision: current.revision, idempotencyKey: randomUUID(), transactionId: current.undoTransactionId } })
    assert.notEqual(result.isError, true, JSON.stringify(result))
  }
  const handle = await page.getByRole('button', { name: 'Resize se', exact: true }).boundingBox()
  assert.ok(handle)
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + 25, handle.y + handle.height / 2 + 20, { steps: 5 }); await page.mouse.up()
  await expect.poll(async () => (await state()).manifest.layers[1].transform.size[0]).toBeGreaterThan(1200)
  const resized = (await state()).manifest.layers[1].transform.size
  assert.ok(Math.abs(resized[0] / resized[1] - 4 / 3) < .001)
  await undoTop()
  const rotation = await page.getByRole('button', { name: 'Rotate layer', exact: true }).boundingBox()
  assert.ok(rotation)
  await page.mouse.move(rotation.x + rotation.width / 2, rotation.y + rotation.height / 2); await page.mouse.down()
  await page.mouse.move(rotation.x + rotation.width / 2 + 25, rotation.y + rotation.height / 2 + 5, { steps: 5 }); await page.mouse.up()
  await expect.poll(async () => Math.abs((await state()).manifest.layers[1].transform.rotation)).toBeGreaterThan(1)
  await undoTop()
  checks.push('Resize handles preserve the linked aspect ratio; rotation handles commit undoable edits')

  const legacy = spawn(info.mcpCommand, info.mcpArgs, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const legacyResponses: any[] = []
  let lines = ''
  legacy.stdout.on('data', data => { lines += String(data); const parts = lines.split('\n'); lines = parts.pop()!; for (const line of parts) if (line) legacyResponses.push(JSON.parse(line)) })
  legacy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-smoke', version: '1.0.0' } } }) + '\n')
  await expect.poll(() => legacyResponses.find(item => item.id === 1), { timeout: 15_000 }).toBeTruthy()
  assert.equal(legacyResponses.find(item => item.id === 1).result.protocolVersion, '2025-11-25')
  legacy.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  legacy.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
  await expect.poll(() => legacyResponses.find(item => item.id === 2), { timeout: 15_000 }).toBeTruthy()
  assert.equal(legacyResponses.find(item => item.id === 2).result.tools.length, 12)
  legacy.stdin.end()
  checks.push('Legacy 2025-11-25 initialization also discovers the same twelve tools')
  await page.getByRole('button', { name: 'Close project', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New canvas', exact: true })).toBeVisible()
  await expect(page.getByLabel('Canvas width')).toHaveValue('1920')
  await expect(page.getByLabel('Canvas height')).toHaveValue('1080')
  await page.screenshot({ path: 'artifacts/desktop-new-canvas.png' })
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click()
  await expect(page.getByText('Layer 1', { exact: true })).toBeVisible()
  const blankState = await state(), blankPreview = PNG.sync.read(await preview(blankState))
  assert.equal(blankState.manifest.layers.length, 1)
  assert.ok(blankPreview.data.every(channel => channel === 0))
  checks.push('Native-style new canvas page creates a transparent document with one blank layer')
  assert.deepEqual(errors, [])
  await writeFile('artifacts/desktop-validation.json', JSON.stringify({ status: 'PASS', platform: process.platform, architecture: process.arch, checks, rendererErrors: errors }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks }, null, 2))
} catch (error) {
  await desktop?.windows()[0]?.screenshot({ path: 'artifacts/desktop-failure.png' }).catch(() => {})
  await writeFile('artifacts/desktop-validation.json', JSON.stringify({ status: 'FAIL', checks, rendererErrors: errors, error: String(error) }, null, 2))
  throw error
} finally {
  await client?.close().catch(() => {})
  await desktop?.close().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
