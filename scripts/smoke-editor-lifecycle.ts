import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import type { EditorState } from '../src/shared/contracts'

// All fault injection is confined to an independent process and disposable profile.
const directory = await mkdtemp(join(tmpdir(), 'compositor-engine-lifecycle-')), profile = join(directory, 'profile')
const checks: string[] = []
const passed = (check: string) => { checks.push(check); process.stdout.write(`PASS ${check}\n`) }
let desktop: ElectronApplication | undefined, page: Page | undefined
const ui = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
  const result = await page!.evaluate(({method, params}) => window.compositor.request(method, params), {method, params})
  assert.equal(result.ok, true, JSON.stringify(result)); return (result as {ok: true; value: T}).value
}
async function launch() {
  desktop = await electron.launch({args: [process.cwd()], env: {...process.env, COMPOSITOR_PROFILE: profile, COMPOSITOR_TEST: '0'}, timeout: 60_000})
  page = await desktop.firstWindow(); await expect(page.locator('.editor-shell')).toHaveAttribute('data-ready', 'true', {timeout: 30_000})
}
async function quit(response: number) {
  await desktop!.evaluate(({dialog}, response) => { dialog.showMessageBox = async (...args: any[]) => { (globalThis as any).__closeDialog = args.at(-1); return {response, checkboxChecked: false} } }, response)
  const exited = new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Application failed to exit after its explicit close choice')), 10_000); desktop!.process().once('exit', () => {clearTimeout(timeout); resolve()}) })
  await desktop!.evaluate(({app}) => app.quit()).catch(error => {if (!String(error).includes('closed')) throw error})
  await exited; desktop = undefined; page = undefined
}
try {
  await launch()
  const untouched = await ui<EditorState>('state')
  assert.equal(untouched.modified, false)
  assert.equal(untouched.workspace?.documents[0].empty, true)
  assert.equal((await ui<{entries: unknown[]}>('checkpoint')).entries.length, 0)
  passed('An untouched welcome tab is clean and creates no unnecessary crash-recovery copy')
  const actualPlatform = await desktop!.evaluate(() => process.platform)
  for (const [response, properties] of [[1, ['openFile']], [0, ['openDirectory', 'treatPackageAsDirectory']]] as const) {
    await desktop!.evaluate(({dialog}, response) => {
      Object.defineProperty(process, 'platform', {value: 'win32', configurable: true})
      dialog.showMessageBox = async () => ({response, checkboxChecked: false})
      dialog.showOpenDialog = async (...args: any[]) => { (globalThis as any).__openOptions = args.at(-1); return {canceled: true, filePaths: []} }
    }, response)
    assert.equal(await ui('openDialog'), null)
    const options = await desktop!.evaluate(() => (globalThis as any).__openOptions)
    assert.deepEqual(options.properties, [...properties])
    if (response === 1) assert.deepEqual(options.filters[0].extensions, ['psd', 'psb'])
  }
  await desktop!.evaluate(({}, platform) => { Object.defineProperty(process, 'platform', {value: platform, configurable: true}) }, actualPlatform)
  passed('Windows dispatch branches select PSD/PSB files or .comp directories correctly (dialog options checked on the isolated macOS process; native Windows remains pending)')
  await desktop!.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}) })
  await ui('demo')
  let state = await ui<EditorState>('state')
  await ui('interaction', {sessionId: state.sessionId, interactionId: 'lifecycle-new-tab', busy: true})
  const blockedNew = await page!.evaluate(() => window.compositor.request('newDocument'))
  assert.equal(blockedNew.ok, false)
  if (!blockedNew.ok) assert.equal(blockedNew.error.code, 'DOCUMENT_BUSY')
  assert.equal((await ui<EditorState>('state')).sessionId, state.sessionId)
  assert.equal((await ui<EditorState>('state')).workspace!.documents.length, 1)
  await ui('interaction', {sessionId: state.sessionId, interactionId: 'lifecycle-new-tab', busy: false})
  passed('New document rejects a live interaction lease and keeps the active session and tab count unchanged')
  const targetSession = state.sessionId, beforeImport = state.manifest.layers.length
  const other = await ui<EditorState>('newDocument')
  const png = new PNG({width: 2, height: 2}); png.data.fill(255)
  const imageA = join(directory, 'first.png'), imageB = join(directory, 'second.png')
  await writeFile(imageA, PNG.sync.write(png)); await writeFile(imageB, PNG.sync.write(png))
  await desktop!.evaluate(({dialog}, paths) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: paths}) }, [imageA, imageB])
  await ui('importDialog', {sessionId: targetSession})
  assert.equal((await ui<EditorState>('state', {sessionId: targetSession})).manifest.layers.length, beforeImport + 2)
  assert.equal((await ui<EditorState>('state', {sessionId: other.sessionId})).manifest.layers.length, 0)
  await ui('switchDocument', {sessionId: targetSession}); await ui('closeDocument', {sessionId: other.sessionId})
  state = await ui<EditorState>('state')
  passed('A two-image import remains bound to its requested document even when another tab is active')
  const welcome = await ui<EditorState>('newDocument')
  let emptyProject = await ui<EditorState>('create', {sessionId: welcome.sessionId, width: 16, height: 16})
  await desktop!.evaluate(({dialog}, filePath) => {dialog.showSaveDialog = async () => ({canceled: false, filePath})}, join(directory, 'last-layer.comp'))
  await ui('saveCurrent', {sessionId: emptyProject.sessionId})
  emptyProject = await ui<EditorState>('state')
  await ui('apply', {sessionId: emptyProject.sessionId, documentId: emptyProject.manifest.documentID, expectedRevision: emptyProject.revision, idempotencyKey: randomUUID(), action: {type: 'layer.delete', layerId: emptyProject.manifest.layers[0].id}})
  await desktop!.evaluate(({dialog}) => {dialog.showMessageBox = async () => ({response: 2, checkboxChecked: false})})
  assert.equal(await ui('closeDocument', {sessionId: emptyProject.sessionId}), null)
  const retainedEmpty = await ui<EditorState>('state', {sessionId: emptyProject.sessionId})
  assert.equal(retainedEmpty.modified, true); assert.equal(retainedEmpty.manifest.layers.length, 0)
  const emptyCheckpoint = await ui<{entries: {sessionId: string}[]}>('checkpoint')
  assert.ok(emptyCheckpoint.entries.some(entry => entry.sessionId === emptyProject.sessionId), 'A modified empty project still requires a crash-recovery checkpoint')
  await desktop!.evaluate(({dialog}) => {dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false})})
  await ui('closeDocument', {sessionId: emptyProject.sessionId})
  state = await ui<EditorState>('state')
  passed('Deleting the final layer still prompts Save/Discard/Cancel; Cancel keeps the modified empty project open')
  await ui('apply', {sessionId: state.sessionId, documentId: state.manifest.documentID, expectedRevision: state.revision, idempotencyKey: randomUUID(), action: {type: 'layer.set_opacity', layerId: state.manifest.layers[1].id, opacity: .37}})
  state = await ui<EditorState>('state')
  const checkpoint = await ui<{entries: {id: string; sessionId: string}[]}>('checkpoint')
  assert.ok(checkpoint.entries.some(entry => entry.sessionId === state.sessionId))
  const engine = await desktop!.evaluate(({app}) => app.getAppMetrics().find(metric => metric.name === 'Compositor Editor')?.pid)
  assert.ok(engine, 'Only the isolated application engine may be fault-injected')
  process.kill(engine, 'SIGTERM')
  const start = Date.now()
  await expect.poll(async () => {
    const result = await page!.evaluate(() => window.compositor.request('saveCurrent'))
    return result.ok ? 'unexpected success' : result.error.code
  }, {timeout: 5_000}).toBe('ENGINE_UNAVAILABLE')
  assert.ok(Date.now() - start < 5_000)
  passed('A stopped editor fails Save immediately with ENGINE_UNAVAILABLE instead of destroyed-object errors or a 120-second wait')
  await desktop!.evaluate(({dialog}) => { dialog.showMessageBox = async (...args: any[]) => { (globalThis as any).__closeDialog = args.at(-1); return {response: 0, checkboxChecked: false} } })
  await desktop!.evaluate(({app}) => app.quit())
  await expect.poll(() => desktop!.evaluate(() => (globalThis as any).__closeDialog?.buttons)).toEqual(['Keep application open', 'Quit and keep recovery files'])
  passed('A failed close explains the fault and leaves the document visible until an explicit decision')
  await quit(1)
  const recoveryFiles = await readdir(join(profile, 'recovery')); assert.ok(recoveryFiles.some(file => file.endsWith('.json')))
  passed('Explicit quit after editor failure terminates the app without clearing persisted recovery')
  await launch()
  const recoveries = await ui<{entries: {id: string; sessionId: string}[]}>('recoveryList')
  assert.ok(recoveries.entries.length)
  await ui('recoverDocument', {id: recoveries.entries[0].id})
  const restored = await ui<EditorState>('state')
  assert.equal(restored.manifest.layers[1].opacity, .37)
  assert.equal(restored.manifest.layers.length, state.manifest.layers.length)
  passed('Restart restores the checkpointed layers and exact edited opacity in an independent profile')
  await quit(1)
  assert.equal((await readdir(join(profile, 'recovery'))).filter(file => file.endsWith('.json')).length, 0)
  passed('Healthy discard-and-quit clears only open-session recovery after the close decision')
  await mkdir('artifacts', {recursive: true})
  await writeFile('artifacts/usability-editor-lifecycle.json', JSON.stringify({status: 'PASS', checks}, null, 2)+'\n')
  process.stdout.write(`PASS ${checks.length} lifecycle checks\n${checks.join('\n')}\n`)
} finally {
  if (desktop) {await desktop.evaluate(() => process.exit(0)).catch(() => {}); await desktop.close().catch(() => {})}
  await rm(directory, {recursive: true, force: true})
}
