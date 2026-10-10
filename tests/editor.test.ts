import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { Editor } from '../src/core/editor'
import { validateManifest } from '../src/core/manifest'
import { loadProject, makeAsset } from '../src/core/project-io'
import { LIMITS, EditorError, type EditAction, type Manifest } from '../src/shared/contracts'

const fixture = join(process.cwd(), 'fixtures/demo.comp')
async function loaded(): Promise<Editor> { const editor = new Editor(); await editor.open(fixture); return editor }
function request(editor: Editor, action: EditAction) { return { ...editor.identity(), action } }
function code(expected: string) { return (error: unknown): boolean => error instanceof EditorError && error.code === expected }

test('loads the v11 fixture with immutable metadata snapshots', async () => {
  const editor = await loaded(), state = editor.state()
  assert.equal(state.manifest.layers.length, 5); assert.equal(state.modified, false)
  state.manifest.layers[0].name = 'Changed externally'
  assert.equal(editor.state().manifest.layers[0].name, 'Sky')
})
test('editing, undo and redo advance a monotonic revision; undo restores saved state', async () => {
  const editor = await loaded(), layer = editor.state().manifest.layers[1]
  const result = editor.apply(request(editor, { type: 'layer.set_opacity', layerId: layer.id, opacity: .5 }))
  assert.equal(result.revision, 1); assert.equal(editor.state().modified, true)
  editor.history({ ...editor.identity(), direction: 'undo', transactionId: result.transactionId })
  assert.equal(editor.state().revision, 2); assert.equal(editor.state().modified, false)
  editor.history({ ...editor.identity(), direction: 'redo' })
  assert.equal(editor.state().revision, 3); assert.equal(editor.state().manifest.layers[1].opacity, .5)
})
test('a stale agent request cannot pass after a user edits then undoes', async () => {
  const editor = await loaded(), id = editor.state().manifest.layers[1].id
  const stale = request(editor, { type: 'layer.rename', layerId: id, name: 'Agent' })
  editor.apply(request(editor, { type: 'layer.rename', layerId: id, name: 'User' }))
  editor.history({ ...editor.identity(), direction: 'undo' })
  assert.throws(() => editor.apply(stale, 'agent'), code('REVISION_CONFLICT'))
  assert.equal(editor.state().manifest.layers[1].name, 'Sun')
})
test('retries are idempotent and parameter reuse is rejected', async () => {
  const editor = await loaded(), id = editor.state().manifest.layers[0].id
  const input = request(editor, { type: 'layer.rename', layerId: id, name: 'New sky' })
  const first = editor.apply(input, 'agent')
  assert.deepEqual(editor.apply(input, 'agent'), first); assert.equal(editor.state().revision, 1)
  assert.throws(() => editor.apply({ ...input, action: { ...input.action, name: 'Another sky' } }), code('IDEMPOTENCY_CONFLICT'))
})
test('an unchanged edit preserves redo history', async () => {
  const editor = await loaded(), id = editor.state().manifest.layers[0].id
  editor.apply(request(editor, { type: 'layer.set_opacity', layerId: id, opacity: .2 }))
  editor.history({ ...editor.identity(), direction: 'undo' })
  const result = editor.apply(request(editor, { type: 'layer.set_opacity', layerId: id, opacity: 1 }))
  assert.equal(result.status, 'no_change'); assert.equal(editor.state().canRedo, true)
})
test('agent undo cannot undo through a later user transaction', async () => {
  const editor = await loaded(), id = editor.state().manifest.layers[0].id
  const agent = editor.apply(request(editor, { type: 'layer.rename', layerId: id, name: 'Agent edit' }), 'agent')
  editor.apply(request(editor, { type: 'layer.set_opacity', layerId: id, opacity: .4 }))
  assert.throws(() => editor.history({ ...editor.identity(), direction: 'undo', transactionId: agent.transactionId }, 'agent'), code('UNDO_CONFLICT'))
  assert.equal(editor.state().manifest.layers[0].opacity, .4)
})
test('opening a new document expires old handles even when document IDs match', async () => {
  const editor = await loaded(), stale = request(editor, { type: 'layer.rename', layerId: editor.state().manifest.layers[0].id, name: 'Old window' })
  await editor.open(fixture)
  assert.throws(() => editor.apply(stale), code('SESSION_EXPIRED'))
})
test('invalid or unsupported files do not replace the live document', async () => {
  const editor = await loaded(), before = editor.state(), dir = await mkdtemp(join(tmpdir(), 'compositor-invalid-'))
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...before.manifest, activeLayerID: before.manifest.layers[0].id, layers: [{ ...before.manifest.layers[0], imageFile:undefined, adjustment: { kind: 'Unsupported Future Adjustment' } }] }))
    await assert.rejects(editor.open(dir), code('UNSUPPORTED_FEATURE'))
    assert.equal(editor.state().sessionId, before.sessionId)
    await writeFile(join(dir, 'manifest.json'), '{')
    await assert.rejects(editor.open(dir), code('INVALID_PROJECT'))
    assert.equal(editor.state().manifest.documentID, before.manifest.documentID)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('hierarchy changes are validated; deleting a group deletes its descendants as one edit', async () => {
  const editor = await loaded(), child = editor.state().manifest.layers[0].id
  editor.apply(request(editor, { type: 'group.add', name: 'Folder' }))
  const group = editor.state().manifest.layers.at(-1)!.id
  editor.apply(request(editor, { type: 'layer.set_parent', layerId: child, parentId: group }))
  assert.throws(() => editor.apply(request(editor, { type: 'layer.set_parent', layerId: group, parentId: group })), code('INVALID_PROJECT'))
  assert.equal(editor.state().manifest.layers[0].parentID, group)
  editor.apply(request(editor, { type: 'layer.delete', layerId: group }))
  assert.equal(editor.state().manifest.layers.some(layer => layer.id === child), false)
  editor.history({ ...editor.identity(), direction: 'undo' })
  assert.equal(editor.state().manifest.layers.find(layer => layer.id === child)?.parentID, group)
})
test('save as round-trips metadata and source PNG bytes and protects existing destinations', async () => {
  const editor = await loaded(), dir = await mkdtemp(join(tmpdir(), 'compositor-save-'))
  try {
    const id = editor.state().manifest.layers[1].id
    editor.apply(request(editor, { type: 'layer.rename', layerId: id, name: '太阳 ☀' }))
    const output = join(dir, '中文工程.comp')
    await editor.saveAs(output)
    const loaded = await loadProject(output)
    assert.deepEqual(loaded.manifest, editor.state().manifest)
    for (const asset of editor.state().assets) assert.equal(loaded.assets.get(asset.file)?.hash, asset.hash)
    const original = await readFile(join(output, 'manifest.json'))
    await assert.rejects(editor.saveAs(output), code('DESTINATION_EXISTS'))
    assert.deepEqual(await readFile(join(output, 'manifest.json')), original)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('unknown additive metadata and raster text fallbacks survive save as', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compositor-fallback-'))
  try {
    const source = await loadProject(fixture), layer = source.manifest.layers[0]
    layer.text = { content: 'hello', fontName: 'Example', custom: 'preserved' }
    layer.customData = { retained: true }
    const editor = new Editor(), input = join(dir, 'input.comp')
    await mkdir(join(input, 'images'), { recursive: true })
    for (const asset of source.assets.values()) await writeFile(join(input, 'images', asset.file), asset.bytes)
    await writeFile(join(input, 'manifest.json'), JSON.stringify(source.manifest))
    await editor.open(input); assert.equal(editor.state().warnings.length, 1)
    await editor.saveAs(join(dir, 'output.comp'))
    const output = await loadProject(join(dir, 'output.comp'))
    assert.deepEqual(output.manifest.layers[0].text, layer.text)
    assert.deepEqual(output.manifest.layers[0].customData, { retained: true })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('rejects path traversal, duplicate IDs, future versions and invalid parents', async () => {
  const base = (await loadProject(fixture)).manifest
  assert.throws(() => validateManifest({ ...base, layers: [{ ...base.layers[0], imageFile: '../image.png' }] }), code('INVALID_PROJECT'))
  assert.throws(() => validateManifest({ ...base, layers: [base.layers[0], base.layers[0]] }), code('INVALID_PROJECT'))
  assert.throws(() => validateManifest({ ...base, version: 12 }))
  assert.throws(() => validateManifest({ ...base, layers: [{ ...base.layers[0], parentID: randomUUID() }] }), code('INVALID_PROJECT'))
})
test('PNG validation checks CRC and pixel limits before decoding', () => {
  const png = PNG.sync.write(new PNG({ width: 2, height: 2 }))
  const asset = makeAsset(`${randomUUID().toUpperCase()}.png`, png)
  assert.equal(asset.width, 2)
  const corrupted = Buffer.from(png); corrupted[corrupted.length - 1] ^= 1
  assert.throws(() => makeAsset('bad.png', corrupted), code('INVALID_PROJECT'))
  const oversized = Buffer.from(png); oversized.writeUInt32BE(LIMITS.maxSide + 1, 16)
  assert.throws(() => makeAsset('big.png', oversized), code('RESOURCE_LIMIT'))
})
test('symlink resources cannot escape the project package', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compositor-symlink-'))
  try {
    const source = await loadProject(fixture), layer = source.manifest.layers[0]
    await mkdir(join(dir, 'images'))
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...source.manifest, activeLayerID: layer.id, layers: [layer] }))
    await symlink(join(fixture, 'images', layer.imageFile!), join(dir, 'images', layer.imageFile!))
    await assert.rejects(loadProject(dir), code('INVALID_PROJECT'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('blank layers are transparent, retain document geometry and can be undone', async () => {
  const editor = new Editor()
  editor.create(1920, 1080)
  editor.apply({ ...editor.identity(), action: { type: 'layer.add_blank', name: 'Layer 1' } })
  const state = editor.state(), layer = state.manifest.layers[0]
  assert.deepEqual(layer.transform.size, [1920, 1080])
  assert.equal(state.manifest.activeLayerID, layer.id)
  assert.equal(layer.imageFile, undefined)
  assert.equal(state.assets.length, 0)
  editor.history({ ...editor.identity(), direction: 'undo', transactionId: state.undoTransactionId })
  assert.equal(editor.state().manifest.layers.length, 0)
})
test('a rejected duplicate at the layer limit does not retain a phantom asset', async () => {
  const editor = new Editor()
  await editor.open(fixture)
  const id = editor.state().manifest.layers[0].id
  const snapshot=editor.snapshot(),template=snapshot.manifest.layers[0]
  for(let i=snapshot.manifest.layers.length;i<LIMITS.maxLayers;i++)snapshot.manifest.layers.push({...structuredClone(template),id:randomUUID().toUpperCase(),imageFile:undefined,text:undefined,shape:undefined,name:'Empty layer'})
  editor.importDocument(snapshot.manifest,snapshot.assets,'Layer capacity fixture')
  const before = editor.state()
  const assets = Reflect.get(editor, 'assets') as Map<string, unknown>, count = assets.size
  assert.throws(() => editor.apply({ ...editor.identity(), action: { type: 'layer.duplicate', layerId: id } }))
  assert.deepEqual(editor.state(), before)
  assert.equal(assets.size, count)
})
