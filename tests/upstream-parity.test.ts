import test from 'node:test'
import assert from 'node:assert/strict'
import CanvasKitInit from 'canvaskit-wasm'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BlendPainter } from '../src/renderer/blend-modes'
import { BLEND_MODES, EditorError, type EditAction } from '../src/shared/contracts'
import { Editor } from '../src/core/editor'
import { hierarchyOrder, descendants } from '../src/core/manifest'
import { loadProject } from '../src/core/project-io'

function apply(editor: Editor, action: EditAction) { return editor.apply({ ...editor.identity(), action }) }
async function fixture() { const editor = new Editor(); await editor.open('fixtures/demo.comp'); return editor }

test('all 24 blend modes render against native v1.4.8 premultiplied pixels', async () => {
  const require = createRequire(import.meta.url)
  const kit = await CanvasKitInit({ locateFile: file => require.resolve(`canvaskit-wasm/bin/${file}`) })
  const references = JSON.parse(await readFile('fixtures/parity/native-1.4.8-blends.json', 'utf8')) as {
    commit: string; samples: { mode: typeof BLEND_MODES[number]; destination: number[]; source: number[]; opacity: number; expectedPremul: number[] }[]
  }
  assert.equal(references.commit, '24ef2885daae750537ec8d094f33e8556a8dfc9a')
  assert.deepEqual([...new Set(references.samples.map(row => row.mode))], [...BLEND_MODES])
  const blends = new BlendPainter(), differences: string[] = []
  try {
    for (const row of references.samples) {
      const surface = kit.MakeSurface(1, 1)!, canvas = surface.getCanvas(), paint = new kit.Paint()
      try {
        canvas.clear(kit.TRANSPARENT)
        paint.setColor(kit.Color(row.destination[0], row.destination[1], row.destination[2], row.destination[3] / 255))
        canvas.drawRect(kit.XYWHRect(0, 0, 1, 1), paint)
        paint.setColor(kit.Color(row.source[0], row.source[1], row.source[2], row.source[3] / 255)); paint.setAlphaf(row.source[3] / 255 * row.opacity)
        blends.apply(kit, paint, row.mode); canvas.drawRect(kit.XYWHRect(0, 0, 1, 1), paint)
        const actual = canvas.readPixels(0, 0, { width: 1, height: 1, alphaType: kit.AlphaType.Premul, colorType: kit.ColorType.RGBA_8888, colorSpace: kit.ColorSpace.SRGB })!
        const delta = Math.max(...row.expectedPremul.map((value, i) => Math.abs(value - actual[i])))
        if (delta > 2) differences.push(`${row.mode} dest=${row.destination} src=${row.source} opacity=${row.opacity}: expected=${row.expectedPremul} actual=${[...actual]} delta=${delta}`)
      } finally { paint.delete(); surface.delete() }
    }
    assert.deepEqual(differences, [], 'Native RGBA8 premultiplied channel tolerance is two levels for rounding only.')
  } finally { blends.dispose() }
})

test('folder duplication remaps the complete tree and saves immutable source PNG bytes', async () => {
  const editor = await fixture(), ids = editor.state().manifest.layers.map(layer => layer.id)
  editor.applyBatch({ ...editor.identity(), actions: [
    { type: 'group.add', name: 'Outer', clientRef: 'outer' },
    { type: 'group.add', name: 'Inner', clientRef: 'inner' },
    { type: 'layer.set_parent', layerId: { ref: 'inner' }, parentId: { ref: 'outer' } },
    { type: 'layer.set_parent', layerId: ids[0], parentId: { ref: 'inner' } },
    { type: 'layer.set_parent', layerId: ids[1], parentId: { ref: 'outer' } }
  ] })
  const before = editor.state(), outer = before.manifest.layers.find(layer => layer.name === 'Outer')!
  const result = apply(editor, { type: 'layer.duplicate', layerId: outer.id })
  const copied = editor.state(), root = copied.manifest.layers.find(layer => layer.name === 'Outer copy')!
  const tree = hierarchyOrder(copied.manifest).filter(layer => descendants(copied.manifest, root.id).has(layer.id))
  assert.equal(tree.length, 4); assert.ok(tree.every(layer => !before.manifest.layers.some(original => original.id === layer.id)))
  assert.deepEqual(tree.map(layer => layer.name), ['Outer copy', 'Sun', 'Inner', 'Sky'])
  for (const copy of tree.filter(layer => layer.imageFile)) {
    const original = before.manifest.layers.find(layer => layer.name === copy.name)!
    assert.equal(copy.imageFile, `${copy.id}.png`)
    assert.equal(copied.assets.find(asset => asset.file === copy.imageFile)?.hash, before.assets.find(asset => asset.file === original.imageFile)?.hash)
  }
  const directory = await mkdtemp(join(tmpdir(), 'compositor-tree-copy-'))
  try {
    await editor.saveCopy(join(directory, 'copy.comp'))
    const loaded = await loadProject(join(directory, 'copy.comp'))
    for (const copy of tree.filter(layer => layer.imageFile)) {
      const original = before.manifest.layers.find(layer => layer.name === copy.name)!
      assert.deepEqual(loaded.assets.get(copy.imageFile!)!.bytes, await readFile(join('fixtures/demo.comp/images', original.imageFile!)))
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
  editor.history({ ...editor.identity(), direction: 'undo', transactionId: result.transactionId })
  assert.deepEqual(editor.state().manifest, before.manifest)
  editor.history({ ...editor.identity(), direction: 'redo' })
  assert.deepEqual(editor.state().manifest, copied.manifest)
})

test('ungroup lifts direct children at the folder position and discards folder appearance like native', async () => {
  const editor = await fixture(), ids = editor.state().manifest.layers.map(layer => layer.id)
  editor.applyBatch({ ...editor.identity(), actions: [
    { type: 'group.add', name: 'Folder', clientRef: 'g' },
    { type: 'layer.set_parent', layerId: ids[0], parentId: { ref: 'g' } },
    { type: 'layer.set_parent', layerId: ids[1], parentId: { ref: 'g' } },
    { type: 'layer.set_opacity', layerId: { ref: 'g' }, opacity: .4 }
  ] })
  const before = editor.state(), folder = before.manifest.layers.find(layer => layer.isGroup)!
  const result = apply(editor, { type: 'group.ungroup', layerId: folder.id }), after = editor.state()
  assert.equal(after.manifest.layers.length, 5)
  assert.deepEqual(after.manifest.layers.map(layer => layer.id), [...ids.slice(2), ids[0], ids[1]])
  assert.equal(after.manifest.layers.at(-1)?.parentID, undefined)
  assert.equal(after.manifest.layers.at(-1)?.opacity, 1)
  editor.history({ ...editor.identity(), direction: 'undo', transactionId: result.transactionId })
  assert.deepEqual(editor.state().manifest, before.manifest)
  assert.throws(() => apply(editor, { type: 'group.ungroup', layerId: ids[0] }), (error: unknown) => error instanceof EditorError && error.code === 'INVALID_ARGUMENT')
})

test('failed batch after tree duplication retains no copied assets, tree, or history', async () => {
  const editor = await fixture(), id = editor.state().manifest.layers[0].id
  apply(editor, { type: 'group.add', name: 'Folder' })
  const folder = editor.state().manifest.layers.at(-1)!.id
  apply(editor, { type: 'layer.set_parent', layerId: id, parentId: folder })
  const before = editor.state(), count = (Reflect.get(editor, 'assets') as Map<string, unknown>).size
  assert.throws(() => editor.applyBatch({ ...editor.identity(), actions: [
    { type: 'layer.duplicate', layerId: folder, clientRef: 'copy' },
    { type: 'layer.rename', layerId: randomUUID(), name: 'Missing' }
  ] }))
  assert.deepEqual(editor.state(), before)
  assert.equal((Reflect.get(editor, 'assets') as Map<string, unknown>).size, count)
})
