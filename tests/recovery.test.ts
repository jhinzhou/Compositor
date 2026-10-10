import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, rename, mkdir, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Editor } from '../src/core/editor'
import { DocumentManager } from '../src/core/document-manager'
import { RecoveryStore } from '../src/core/recovery-store'
import { fingerprintProject, loadProject } from '../src/core/project-io'
import { replaceProject, recoverSaveJournals } from '../src/core/save-journal'
import { EditorError } from '../src/shared/contracts'
const fixture = resolve('fixtures/demo.comp')
const code = (expected: string) => (error: unknown) => error instanceof EditorError && error.code === expected
async function sandbox(run: (directory: string) => Promise<void>) { const directory = await mkdtemp(join(tmpdir(), 'compositor-save-')); try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) } }

test('Save updates existing project; Save Copy preserves association and dirty baseline; external edits conflict', async () => sandbox(async directory => {
  const editor = new Editor({ journalDirectory: join(directory, 'journals') })
  await editor.open(fixture)
  await editor.saveAs(join(directory, '中文工程.comp'))
  const path = editor.state().projectPath!, id = editor.state().manifest.layers[0].id
  editor.apply({ ...editor.identity(), action: { type: 'layer.rename', layerId: id, name: 'Changed sky' } })
  await editor.saveCopy(join(directory, 'copy.comp'))
  assert.equal(editor.state().projectPath, path)
  assert.equal(editor.state().modified, true)
  assert.equal((await loadProject(path)).manifest.layers[0].name, 'Sky')
  await editor.save()
  assert.equal(editor.state().modified, false)
  assert.equal((await loadProject(path)).manifest.layers[0].name, 'Changed sky')
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'))
  manifest.layers[0].name = 'External writer'
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest))
  editor.apply({ ...editor.identity(), action: { type: 'layer.rename', layerId: id, name: 'My unsaved sky' } })
  await assert.rejects(() => editor.save(), code('SAVE_CONFLICT'))
  assert.equal(editor.state().modified, true)
  assert.equal((await loadProject(path)).manifest.layers[0].name, 'External writer')
}))

test('failure after old package backup restores the previous complete project', async () => sandbox(async directory => {
  const editor = new Editor()
  await editor.open(fixture); await editor.saveAs(join(directory, 'project.comp'))
  const path = editor.state().projectPath!, before = await fingerprintProject(path)
  editor.apply({ ...editor.identity(), action: { type: 'layer.rename', layerId: editor.state().manifest.layers[0].id, name: 'New content' } })
  const snapshot = editor.snapshot()
  await assert.rejects(() => replaceProject(path, snapshot.manifest, snapshot.assets, before, join(directory, 'journals'), async phase => {
    if (phase === 'backed_up') throw new Error('Simulated rename failure')
  }), /Simulated rename failure/)
  assert.equal(await fingerprintProject(path), before)
  assert.deepEqual(await recoverSaveJournals(join(directory, 'journals')), [])
}))

for (const phase of ['prepared', 'backed_up', 'installed'] as const) {
  test(`hard process exit at ${phase} leaves a complete recoverable project`, async () => sandbox(async directory => {
    const editor = new Editor(); await editor.open(fixture); await editor.saveAs(join(directory, 'project.comp'))
    const path = editor.state().projectPath!, journals = join(directory, 'journals')
    const source = `import { Editor } from ${JSON.stringify(resolve('src/core/editor.ts'))}; import { replaceProject } from ${JSON.stringify(resolve('src/core/save-journal.ts'))}; import { fingerprintProject } from ${JSON.stringify(resolve('src/core/project-io.ts'))};
      const editor = new Editor(); await editor.open(${JSON.stringify(path)}); const old = await fingerprintProject(${JSON.stringify(path)}); editor.apply({...editor.identity(), action:{type:'layer.rename',layerId:editor.state().manifest.layers[0].id,name:'Committed new sky'}}); const s=editor.snapshot(); await replaceProject(${JSON.stringify(path)},s.manifest,s.assets,old,${JSON.stringify(journals)},async p=>{if(p===${JSON.stringify(phase)}) process.exit(73)});`
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 })
    assert.equal(child.status, 73, child.stderr)
    const results = await recoverSaveJournals(journals)
    assert.equal(results.length, 1); assert.equal(results[0].status, 'recovered', JSON.stringify(results))
    assert.equal((await loadProject(path)).manifest.layers[0].name, phase === 'installed' ? 'Committed new sky' : 'Sky')
    assert.deepEqual(await recoverSaveJournals(journals), [])
  }))
}

test('recovery checkpoints survive a new store, preserve pixels, deduplicate revision and discard by session', async () => sandbox(async directory => {
  const editor = new Editor(); await editor.open(fixture)
  editor.apply({ ...editor.identity(), action: { type: 'layer.set_opacity', layerId: editor.state().manifest.layers[0].id, opacity: .4 } })
  const store = new RecoveryStore(join(directory, 'recovery'))
  await store.checkpoint(editor); await store.checkpoint(editor)
  const reopened = new RecoveryStore(join(directory, 'recovery')), entries = await reopened.list()
  assert.equal(entries.length, 1)
  const saved = await reopened.get(entries[0].id), loaded = await loadProject(saved.path)
  assert.equal(loaded.manifest.layers[0].opacity, .4)
  const snapshot = editor.snapshot()
  for (const [file, asset] of snapshot.assets) assert.deepEqual(loaded.assets.get(file)?.bytes, asset.bytes)
  const restored = new Editor(); restored.restore(loaded.manifest, loaded.assets, saved.entry.title)
  assert.notEqual(restored.state().sessionId, editor.state().sessionId)
  assert.equal(restored.state().modified, true); assert.equal(restored.state().projectPath, undefined)
  await reopened.discardSession(editor.state().sessionId)
  assert.deepEqual(await reopened.list(), [])
}))

test('startup publishes a complete temporary checkpoint and removes only unpublished UUID packages', async () => sandbox(async directory => {
  const editor = new Editor(); await editor.open(fixture)
  editor.apply({ ...editor.identity(), action: { type: 'layer.rename', layerId: editor.state().manifest.layers[0].id, name: 'Recovered checkpoint' } })
  const store = new RecoveryStore(directory)
  await store.checkpoint(editor)
  const [entry] = await store.list()
  await rename(join(directory, `${entry.id}.json`), join(directory, `${entry.id}.tmp`))
  const orphan = join(directory, `${randomUUID()}.comp`), unrelated = join(directory, 'user-project.comp')
  await mkdir(orphan); await mkdir(unrelated)
  const reopened = new RecoveryStore(directory); await reopened.initialize()
  assert.equal((await reopened.list())[0].id, entry.id)
  assert.equal((await loadProject((await reopened.get(entry.id)).path)).manifest.layers[0].name, 'Recovered checkpoint')
  await assert.rejects(() => access(orphan))
  await access(unrelated)
}))

test('deleting the last layer retains a recovery checkpoint for the modified empty document', async () => sandbox(async directory => {
  const editor = new Editor()
  editor.create(16, 12)
  editor.apply({ ...editor.identity(), action: { type: 'layer.add_blank', name: 'Only layer' } })
  await editor.saveAs(join(directory, 'empty-after-edit.comp'))
  editor.apply({ ...editor.identity(), action: { type: 'layer.delete', layerId: editor.state().manifest.layers[0].id } })
  assert.equal(editor.state().modified, true)
  const store = new RecoveryStore(join(directory, 'recovery'))
  await store.checkpoint(editor)
  const entries = await store.list()
  assert.equal(entries.length, 1)
  const saved = await store.get(entries[0].id), loaded = await loadProject(saved.path)
  assert.equal(loaded.manifest.layers.length, 0)
  const restored = new Editor(); restored.restore(loaded.manifest, loaded.assets, saved.entry.title)
  assert.equal(restored.state().modified, true)
  assert.equal(restored.state().manifest.width, 16)
  assert.equal(restored.state().manifest.height, 12)
  const manager = new DocumentManager(), recovered = await manager.restore(saved.path, saved.entry.title)
  assert.equal(recovered.workspace?.documents[0].empty, false, 'Recovered edits must not be classified as a replaceable welcome tab')
  assert.throws(() => manager.create(100, 100, recovered.sessionId), /Create a new tab/)
  manager.newDocument()
  assert.equal(manager.workspace().documents.length, 2)
  assert.equal(manager.state(recovered.sessionId).modified, true)
}))
