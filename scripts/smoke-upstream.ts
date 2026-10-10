import { _electron as electron, expect, type ElectronApplication } from '@playwright/test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { BLEND_MODES, type BridgeInfo, type EditorState, type Manifest, type BatchMutation } from '../src/shared/contracts'

const root = process.cwd(), directory = await mkdtemp(join(tmpdir(), 'compositor-upstream-'))
const executablePath = process.env.COMPOSITOR_APP_EXECUTABLE
const runtimeVersion=JSON.parse(await readFile('package.json','utf8')).version
const artifactPrefix = `upstream-${runtimeVersion}${executablePath?'-packaged':''}`
const checks: string[] = [], errors: string[] = [], metrics: { mode: string; maximumPremulDelta: number }[] = []
let desktop: ElectronApplication | undefined, client: Client | undefined
try {
  const references = JSON.parse(await readFile('fixtures/parity/native-1.4.8-blends.json', 'utf8')) as {
    samples: { mode: string; destination: number[]; source: number[]; opacity: number; expectedPremul: number[] }[]
  }
  const cases = references.samples.filter(row => row.mode === 'Normal'), project = join(directory, 'Native blend matrix.comp')
  await mkdir(join(project, 'images'), { recursive: true })
  const bottomId = randomUUID().toUpperCase(), topIds = cases.map(() => randomUUID().toUpperCase())
  const bottom = new PNG({ width: cases.length, height: 1 })
  cases.forEach((row, x) => bottom.data.set(row.destination, x * 4))
  await writeFile(join(project, 'images', `${bottomId}.png`), PNG.sync.write(bottom))
  for (const [i, row] of cases.entries()) {
    const png = new PNG({ width: 1, height: 1 }); png.data.set(row.source)
    await writeFile(join(project, 'images', `${topIds[i]}.png`), PNG.sync.write(png))
  }
  const transform = { origin: [0, 0] as [number, number], size: [cases.length, 1] as [number, number], rotation: 0, flipX: false, flipY: false, sampling: 'Nearest' as const }
  const manifest: Manifest = { format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: randomUUID().toUpperCase(), width: cases.length, height: 1, resolution: 72, activeLayerID: topIds[0], layers: [
    { id: bottomId, name: 'Backdrop', imageFile: `${bottomId}.png`, isVisible: true, isGroup: false, opacity: 1, blendMode: 'Normal', transform },
    ...cases.map((row, i) => ({ id: topIds[i], name: `Sample ${i + 1}`, imageFile: `${topIds[i]}.png`, isVisible: true, isGroup: false, opacity: row.opacity, blendMode: 'Normal', transform: { ...transform, origin: [i, 0] as [number, number], size: [1, 1] as [number, number] } }))
  ] }
  await writeFile(join(project, 'manifest.json'), JSON.stringify(manifest))
  desktop = await electron.launch({ executablePath, args: executablePath ? [] : [root], env: { ...process.env, COMPOSITOR_PROFILE: join(directory, 'profile'), COMPOSITOR_TEST: '1' } })
  // Packaged Electron does not expose its existing window to Playwright's page
  // registry reliably. Exercise the real renderer IPC and MCP through its main
  // process; pointer/keyboard interactions are covered by the development run.
  const page = executablePath ? undefined : await desktop.firstWindow()
  if (page) {
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready', 'true',{timeout:60000})
  } else {
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible())!?.webContents.getURL() ?? ''),{timeout:60000}).toContain('/index.html')
    await expect.poll(() => desktop!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible())!.webContents.executeJavaScript("document.querySelector('.editor-shell')?.dataset.ready")),{timeout:60000}).toBe('true')
  }
  async function ui<T>(method: string, params?: unknown): Promise<T> {
    const result = page
      ? await page.evaluate(({ method, params }) => window.compositor.request(method, params), { method, params })
      : await desktop!.evaluate(({ BrowserWindow }, input) => BrowserWindow.getAllWindows().find(window => window.isVisible())!.webContents.executeJavaScript(`window.compositor.request(${JSON.stringify(input.method)},${JSON.stringify(input.params ?? null)})`), { method, params })
    assert.equal(result.ok, true, JSON.stringify(result)); return (result as { ok: true; value: T }).value
  }
  await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, project)
  await ui('openDialog')
  const info = await ui<BridgeInfo>('bridgeInfo')
  client = new Client({ name: 'upstream-parity', version: '1.0.0' })
  await client.connect(new StdioClientTransport({ command: info.mcpCommand, args: info.mcpArgs, env: { ...Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => typeof pair[1] === 'string')), ELECTRON_RUN_AS_NODE: '1' } }))
  async function state(): Promise<EditorState> { const result = await client!.callTool({ name: 'document.get_state', arguments: {} }); assert.notEqual(result.isError, true); return result.structuredContent as EditorState }
  async function apply(actions: BatchMutation['actions']): Promise<any> {
    const current = await state(), result = await client!.callTool({ name: 'document.apply_batch', arguments: { sessionId: current.sessionId, documentId: current.manifest.documentID, expectedRevision: current.revision, idempotencyKey: randomUUID(), actions } })
    assert.notEqual(result.isError, true, JSON.stringify(result)); return result.structuredContent
  }
  async function preview(): Promise<PNG> {
    const current = await state(), result = await client!.callTool({ name: 'document.preview', arguments: { sessionId: current.sessionId, expectedRevision: current.revision, maxDimension: 64 } })
    assert.notEqual(result.isError, true, JSON.stringify(result))
    const image = (result.content as { type: string; data: string }[]).find(item => item.type === 'image')!
    return PNG.sync.read(Buffer.from(image.data, 'base64'))
  }
  const caps = await client.callTool({ name: 'app.get_capabilities', arguments: {} })
  assert.equal((caps.structuredContent as { version: string }).version, JSON.parse(await readFile('package.json','utf8')).version)
  assert.deepEqual((caps.structuredContent as { blendModes: string[] }).blendModes, [...BLEND_MODES])
  for (const mode of BLEND_MODES) {
    await apply(topIds.map(layerId => ({ type: 'layer.set_blend', layerId, blendMode: mode })))
    const output = await preview(), expected = references.samples.filter(row => row.mode === mode)
    assert.equal(output.width, cases.length); assert.equal(output.height, 1)
    let max = 0
    for (const [x, row] of expected.entries()) {
      const pixel = [...output.data.subarray(x * 4, x * 4 + 4)]
      const premul = pixel.map((value, i) => i === 3 ? value : Math.round(value * pixel[3] / 255))
      const delta = Math.max(...premul.map((value, i) => Math.abs(value - row.expectedPremul[i])))
      assert.ok(delta <= 2, `${mode} sample ${x}: expected=${row.expectedPremul} actual=${premul} delta=${delta}`)
      max = Math.max(max, delta)
    }
    metrics.push({ mode, maximumPremulDelta: max })
  }
  checks.push('Real MCP edits and CanvasKit PNGs match 192 upstream v1.4.8 reference pixels across all 24 modes')
  if (page) {
  await page.getByRole('listitem').filter({ hasText: 'Sample 1' }).click()
  await page.getByRole('combobox', { name: 'Blend mode' }).click()
  await expect(page.getByRole('listbox', { name: 'Blend modes' }).getByRole('option')).toHaveCount(24)
  const prior = await state()
  const displayedBefore = await page.getByTestId('editor-canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.getByRole('option', { name: 'Linear Burn', exact: true }).hover()
  await expect.poll(() => page.getByTestId('editor-canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(displayedBefore)
  assert.equal((await state()).revision, prior.revision)
  await page.getByRole('combobox', { name: 'Blend mode' }).press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect.poll(() => page.getByTestId('editor-canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).toBe(displayedBefore)
  assert.equal((await state()).revision, prior.revision)
  await page.getByRole('combobox', { name: 'Blend mode' }).click()
  await page.getByRole('option', { name: 'Linear Burn', exact: true }).click()
  await expect.poll(async () => (await state()).manifest.layers.find(layer => layer.id === topIds[0])!.blendMode).toBe('Linear Burn')
  await page.locator('.status-bar').click()
  await page.keyboard.press('Shift++')
  await expect.poll(async () => (await state()).manifest.layers.find(layer => layer.id === topIds[0])!.blendMode).toBe('Lighten')
  checks.push('Blend menu has 24 options; hover and Escape do not commit; choosing and Shift-plus commit')
  const created = await apply([{ type: 'group.add', name: 'Test folder', clientRef: 'folder' }, { type: 'layer.move', layerIds: topIds.slice(0, 2), parentId: { ref: 'folder' }, beforeLayerId: null }])
  const folder = created.createdIds.folder as string
  await expect(page.getByRole('button', { name: 'Collapse Test folder', exact: true })).toBeVisible()
  const collapseState = await state()
  await page.getByRole('button', { name: 'Collapse Test folder', exact: true }).click()
  await expect(page.locator(`[data-layer-id="${topIds[0]}"]`)).toHaveCount(0)
  assert.equal((await state()).revision, collapseState.revision)
  await page.getByRole('button', { name: 'Expand Test folder', exact: true }).click()
  await expect(page.locator(`[data-layer-id="${topIds[0]}"]`)).toBeVisible()
  checks.push('Folder collapse and expand hide only rows and create no document edit')
  await page.locator(`[data-layer-id="${folder}"]`).click({ button: 'right' })
  await page.getByRole('button', { name: 'Duplicate folder', exact: true }).click()
  await expect.poll(async () => (await state()).manifest.layers.length).toBe(13)
  const duplicateState = await state(), copy = duplicateState.manifest.layers.find(layer => layer.name === 'Test folder copy')!
  assert.equal(duplicateState.manifest.layers.filter(layer => layer.parentID === copy.id).length, 2)
  checks.push('Right-click folder duplicate copies children through the shared transaction service')
  await apply([{ type: 'group.ungroup', layerId: copy.id }])
  const ungrouped = await state(); assert.equal(ungrouped.manifest.layers.length, 12)
  const undo = await client.callTool({ name: 'history.undo', arguments: { sessionId: ungrouped.sessionId, documentId: ungrouped.manifest.documentID, expectedRevision: ungrouped.revision, idempotencyKey: randomUUID(), transactionId: ungrouped.undoTransactionId } })
  assert.notEqual(undo.isError, true)
  assert.deepEqual((await state()).manifest, duplicateState.manifest)
  checks.push('MCP ungroup and one-step undo restore the complete copied tree')
  await ui('demo')
  await page.getByRole('combobox', { name: 'Blend mode' }).click()
  await page.screenshot({ path: `artifacts/${artifactPrefix}-desktop.png` })
  } else {
    const created = await apply([{ type: 'group.add', name: 'Packed folder', clientRef: 'folder' }, { type: 'layer.move', layerIds: topIds.slice(0, 2), parentId: { ref: 'folder' }, beforeLayerId: null }, { type: 'layer.duplicate', layerId: { ref: 'folder' }, clientRef: 'copy' }])
    const before = await state(), copy = created.createdIds.copy as string
    assert.equal(before.manifest.layers.filter(layer => layer.parentID === copy).length, 2)
    await apply([{ type: 'group.ungroup', layerId: copy }])
    const after = await state()
    const undone = await client.callTool({ name: 'history.undo', arguments: { sessionId: after.sessionId, documentId: after.manifest.documentID, expectedRevision: after.revision, idempotencyKey: randomUUID(), transactionId: after.undoTransactionId } })
    assert.notEqual(undone.isError, true)
    assert.deepEqual((await state()).manifest, before.manifest)
    checks.push('Packaged MCP folder tree duplication, ungroup, and one-step undo preserve parent references and complete state')
    await ui('demo')
    const screenshot = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible())!.capturePage().then(image => image.toPNG().toString('base64')))
    await writeFile(`artifacts/${artifactPrefix}-desktop.png`, Buffer.from(screenshot, 'base64'))
  }
  assert.deepEqual(errors, [])
  await writeFile(`artifacts/${artifactPrefix}-validation.json`, JSON.stringify({ status: 'PASS', packaged: !!executablePath, version: JSON.parse(await readFile('package.json','utf8')).version, upstream: 'v1.4.8', platform: process.platform, architecture: process.arch, checks, metrics, rendererErrors: errors }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks, samples: references.samples.length }, null, 2))
} catch (error) {
  await desktop?.windows()[0]?.screenshot({ path: `artifacts/${artifactPrefix}-failure.png` }).catch(() => {})
  await writeFile(`artifacts/${artifactPrefix}-validation.json`, JSON.stringify({ status: 'FAIL', checks, metrics, rendererErrors: errors, error: String(error) }, null, 2))
  throw error
} finally { await client?.close().catch(() => {}); await desktop?.close().catch(() => {}); await rm(directory, { recursive: true, force: true }) }
