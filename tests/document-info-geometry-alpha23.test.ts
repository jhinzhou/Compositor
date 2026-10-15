import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Editor} from '../src/core/editor'
import {readDocumentInfoSamples} from '../src/core/document-info'
import {makeDeepAsset} from '../src/core/project-io'
import {emptyDocumentInfo, rulerMeasurement, type InfoPoint} from '../src/shared/document-info'
import type {Layer, Manifest} from '../src/shared/contracts'

const colors = [[51001, 2003, 4007], [1001, 53003, 6007], [7001, 8003, 55007]]
const landmarks: InfoPoint[] = [[4.5, 3.5], [10.5, 3.5], [4.5, 8.5]]

// Self-authored colored landmarks are independent of the metadata transform.
// Reading the actual transformed pixels catches a correct-looking point map
// that does not follow the layer placement or the baked raster.
function fixture(points: InfoPoint[] = landmarks) {
  const width = 16, height = 12, id = randomUUID().toUpperCase(), file = `${id}.png`
  const pixels = new Uint16Array(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set([1103, 2207, 3301, 65535], i * 4)
  points.slice(0, 3).forEach(([cx, cy], index) => {
    for (let y = Math.floor(cy) - 1; y <= Math.floor(cy) + 1; y++) {
      for (let x = Math.floor(cx) - 1; x <= Math.floor(cx) + 1; x++) {
        if (x >= 0 && y >= 0 && x < width && y < height) pixels.set([...colors[index], 65535], (y * width + x) * 4)
      }
    }
  })
  const layer: Layer = {
    id, name: '16-bit geometry landmarks', imageFile: file, isVisible: true,
    isGroup: false, opacity: 1, blendMode: 'Normal',
    transform: {origin: [0, 0], size: [width, height], rotation: 0, flipX: false, flipY: false, sampling: 'Nearest'}
  }
  const manifest: Manifest = {
    format: 'com.compositor.project', version: 12, colorSpace: 'sRGB',
    documentID: randomUUID(), width, height, resolution: 72, activeLayerID: id, layers: [layer],
    documentInfo: {
      ...emptyDocumentInfo(), sampleTarget: 'current', unit: 'in',
      samples: points.map((position, index) => ({id: index + 1, position: [...position]})),
      ruler: {start: [...points[0]], end: [...points[1]], third: [...points[2]]}
    }
  }
  const asset = makeDeepAsset(file, width, height, pixels), editor = new Editor()
  editor.importDocument(manifest, new Map([[file, asset]]), 'Document information geometry fixture')
  return {editor, asset}
}

const edit = (editor: Editor, action: unknown) => editor.apply({...editor.identity(), action})

function assertPoint(actual: InfoPoint, expected: InfoPoint, label: string) {
  for (let axis = 0; axis < 2; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-9, `${label}: ${actual} != ${expected}`)
}

function assertPoints(editor: Editor, expected: InfoPoint[]) {
  const info = editor.state().manifest.documentInfo!
  assert.deepEqual(info.samples.map(sample => sample.id), expected.map((_, index) => index + 1), 'Sample numbers must remain stable')
  info.samples.forEach((sample, index) => assertPoint(sample.position, expected[index], `Sample ${sample.id}`))
  assertPoint(info.ruler!.start, expected[0], 'Ruler start')
  assertPoint(info.ruler!.end, expected[1], 'Ruler end')
  assertPoint(info.ruler!.third!, expected[2], 'Protractor endpoint')
  assert.equal(info.sampleSize, 1)
  assert.equal(info.sampleTarget, 'current')
  assert.equal(info.unit, 'in')
}

function assertLandmarkColors(editor: Editor) {
  const {manifest, assets} = editor.snapshot()
  // Both canonical current-layer sampling and the real document compositor
  // must see the same distinct landmarks at the persisted sample positions.
  for (const sampleTarget of ['current', 'merged'] as const) {
    const readings = readDocumentInfoSamples({...manifest, documentInfo: {...manifest.documentInfo!, sampleTarget}}, assets)
    readings.slice(0, 3).forEach((sample, index) => {
      assert.equal(sample.sourcePrecision, 'uint16')
      assert.equal(sample.reading?.precision, 'uint16')
      assert.equal(sample.reading?.alpha, 1)
      assert.deepEqual(sample.reading?.rgb, colors[index], `${sampleTarget} sample ${sample.id} must follow its image landmark, including low bits`)
    })
  }
}

async function assertLifecycle(editor: Editor, action: unknown, expected: InfoPoint[], sourceUnchanged: boolean) {
  const before = editor.snapshot(), result = edit(editor, action), after = editor.snapshot()
  assert.equal(result.status, 'applied')
  assert.equal(result.undoable, true)
  assertPoints(editor, expected)
  assertLandmarkColors(editor)
  if (sourceUnchanged) assert.deepEqual(after.assets, before.assets, 'Metadata/placement geometry must preserve all source bytes and deep samples')
  editor.history({...editor.identity(), direction: 'undo', transactionId: result.transactionId})
  assert.deepEqual(editor.snapshot(), before, 'One Undo must restore pixels, placements and every persisted info point together')
  editor.history({...editor.identity(), direction: 'redo'})
  assert.deepEqual(editor.snapshot(), after, 'One Redo must restore the complete geometry transaction')
  const directory = await mkdtemp(join(tmpdir(), 'compositor-info-geometry23-'))
  try {
    const path = join(directory, 'Geometry.comp')
    await editor.saveAs(path)
    const reopened = new Editor()
    await reopened.open(path)
    const loaded = reopened.snapshot()
    // JSON project metadata canonicalizes signed zero (a horizontal flip can
    // leave rotation=-0). Compare its serialized value, but source bytes/deep
    // pixels and all Info coordinates still have their own exact assertions.
    assert.deepEqual(loaded.manifest, JSON.parse(JSON.stringify(after.manifest)), 'Save/reopen must retain serialized geometry metadata')
    assert.deepEqual(loaded.assets, after.assets, 'Save/reopen must retain the canonical 16-bit source exactly')
    assertPoints(reopened, expected)
    assertLandmarkColors(reopened)
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}

const cases: {name: string; action: unknown; expected: InfoPoint[]; sourceUnchanged: boolean; dimensions: [number, number]}[] = [
  {name: 'top-left Canvas Size', action: {type: 'document.canvas_size', width: 20, height: 18, anchor: 'top-left'}, expected: [[4.5, 3.5], [10.5, 3.5], [4.5, 8.5]], sourceUnchanged: true, dimensions: [20, 18]},
  {name: 'center Canvas Size', action: {type: 'document.canvas_size', width: 20, height: 18, anchor: 'center'}, expected: [[6.5, 6.5], [12.5, 6.5], [6.5, 11.5]], sourceUnchanged: true, dimensions: [20, 18]},
  {name: 'bottom-right Canvas Size', action: {type: 'document.canvas_size', width: 20, height: 18, anchor: 'bottom-right'}, expected: [[8.5, 9.5], [14.5, 9.5], [8.5, 14.5]], sourceUnchanged: true, dimensions: [20, 18]},
  {name: 'non-destructive inset Crop', action: {type: 'document.crop', x: 2, y: 1, width: 12, height: 10, deleteCroppedPixels: false}, expected: [[2.5, 2.5], [8.5, 2.5], [2.5, 7.5]], sourceUnchanged: true, dimensions: [12, 10]},
  {name: 'Crop that extends outside the old canvas', action: {type: 'document.crop', x: -2, y: -1, width: 20, height: 16, deleteCroppedPixels: false}, expected: [[6.5, 4.5], [12.5, 4.5], [6.5, 9.5]], sourceUnchanged: true, dimensions: [20, 16]},
  {name: 'Image Size without resampling', action: {type: 'document.image_size', width: 8, height: 6, resolution: 144, resample: false}, expected: [[4.5, 3.5], [10.5, 3.5], [4.5, 8.5]], sourceUnchanged: true, dimensions: [16, 12]},
  {name: 'nonuniform resampled Image Size', action: {type: 'document.image_size', width: 32, height: 36, resolution: 72, resample: true, sampling: 'Nearest'}, expected: [[9, 10.5], [21, 10.5], [9, 25.5]], sourceUnchanged: false, dimensions: [32, 36]},
  {name: 'horizontal Flip', action: {type: 'document.flip', axis: 'horizontal'}, expected: [[11.5, 3.5], [5.5, 3.5], [11.5, 8.5]], sourceUnchanged: true, dimensions: [16, 12]},
  {name: 'vertical Flip', action: {type: 'document.flip', axis: 'vertical'}, expected: [[4.5, 8.5], [10.5, 8.5], [4.5, 3.5]], sourceUnchanged: true, dimensions: [16, 12]},
  {name: 'clockwise quarter Rotation', action: {type: 'document.rotate', clockwise: true}, expected: [[8.5, 4.5], [8.5, 10.5], [3.5, 4.5]], sourceUnchanged: true, dimensions: [12, 16]},
  {name: 'counterclockwise quarter Rotation', action: {type: 'document.rotate', clockwise: false}, expected: [[3.5, 11.5], [3.5, 5.5], [8.5, 11.5]], sourceUnchanged: true, dimensions: [12, 16]}
]

for (const row of cases) test(`${row.name}: sample/ruler landmarks follow actual image geometry, Undo/Redo and save/reopen`, async () => {
  const {editor} = fixture()
  assertLandmarkColors(editor)
  await assertLifecycle(editor, row.action, row.expected, row.sourceUnchanged)
  assert.deepEqual([editor.state().manifest.width, editor.state().manifest.height], row.dimensions)
  if (row.name === 'Image Size without resampling') {
    assert.equal(rulerMeasurement(editor.state().manifest.documentInfo!.ruler!, 144, 'in').length, 6 / 144, 'Only the physical ruler scale changes with DPI')
  }
})

test('Straighten plus crop rotates both protractor arms and samples with the actual untouched source', async () => {
  const {editor} = fixture([[8, 6], [12, 6], [8, 9]])
  // A 3-4-5 reference triangle gives independently known rotated landmarks.
  await assertLifecycle(editor, {type: 'document.straighten', angle: Math.atan2(3, 4) * 180 / Math.PI, crop: {x: 1, y: 1, width: 14, height: 10}}, [[7, 5], [10.2, 7.4], [5.2, 7.4]], true)
  const measurement = rulerMeasurement(editor.state().manifest.documentInfo!.ruler!, 72, 'px')
  assert.ok(Math.abs(measurement.length - 4) < 1e-9)
  assert.ok(Math.abs(measurement.secondLength! - 3) < 1e-9)
  assert.ok(Math.abs(measurement.includedAngle! - 90) < 1e-9)
})

test('Perspective Crop maps trapezoid samples and ruler onto the baked image, including exact boundary corners', async () => {
  // These three points lie at quarter positions in a symmetric trapezoid.
  // Expected target positions are specified independently of the homography
  // implementation; four extra samples verify edge coordinates are not clamped.
  const {editor} = fixture([[4.8, 4.8], [11.2, 4.8], [40 / 7, 72 / 7], [0, 0], [16, 0], [12, 12], [4, 12]])
  await assertLifecycle(editor, {type: 'document.perspective_crop', corners: [[0, 0], [16, 0], [12, 12], [4, 12]], width: 16, height: 12, sampling: 'Nearest'}, [[4, 3], [12, 3], [4, 9], [0, 0], [16, 0], [16, 12], [0, 12]], false)
  const {manifest, assets} = editor.snapshot(), readings = readDocumentInfoSamples(manifest, assets)
  assert.equal(readings[4].reading, null, 'A sample on the exclusive right boundary must stay out of bounds')
  assert.equal(readings[5].reading, null)
  assert.equal(readings[6].reading, null)
})

test('cropped-away samples keep their coordinates and source so extending the canvas restores their merged reading', () => {
  const {editor, asset} = fixture([...landmarks, [1.5, 1.5]])
  const original = editor.snapshot()
  edit(editor, {type: 'document.crop', x: 2, y: 1, width: 12, height: 10, deleteCroppedPixels: false})
  assertPoints(editor, [[2.5, 2.5], [8.5, 2.5], [2.5, 7.5], [-.5, .5]])
  const cropped = editor.snapshot()
  assert.equal(readDocumentInfoSamples({...cropped.manifest, documentInfo: {...cropped.manifest.documentInfo!, sampleTarget: 'merged'}}, cropped.assets)[3].reading, null)
  assert.deepEqual(cropped.assets.get(asset.file), original.assets.get(asset.file))
  edit(editor, {type: 'document.crop', x: -2, y: -1, width: 16, height: 12, deleteCroppedPixels: false})
  assert.deepEqual(editor.snapshot(), original)
  const restored = editor.snapshot()
  assert.deepEqual(readDocumentInfoSamples({...restored.manifest, documentInfo: {...restored.manifest.documentInfo!, sampleTarget: 'merged'}}, restored.assets)[3].reading?.rgb, [1103, 2207, 3301])
})

test('document.info edits and their Undo/Redo preserve the cached fractional inverted selection for Reselect', () => {
  const {editor} = fixture(), original = editor.snapshot()
  const selection = {inverted: true, antialiased: true, shapes: [{kind: 'rectangle', bounds: [2.25, 1.5, 5.75, 4.5], operation: 'replace', feather: 1.25}]}
  edit(editor, {type: 'selection.set', selection})
  const selected = editor.state().selection
  edit(editor, {type: 'selection.set', selection: null})
  assert.equal(editor.state().canReselect, true)
  const info = {...editor.state().manifest.documentInfo!, sampleSize: 3, unit: 'mm', samples: [{id: 7, position: [9.5, 7.5]}]}
  const changed = edit(editor, {type: 'document.info', info})
  assert.equal(editor.state().canReselect, true)
  assert.equal(editor.state().selection, null)
  assert.deepEqual(editor.snapshot().assets, original.assets)
  editor.history({...editor.identity(), direction: 'undo', transactionId: changed.transactionId})
  assert.deepEqual(editor.state().manifest.documentInfo, original.manifest.documentInfo)
  assert.equal(editor.state().canReselect, true)
  editor.history({...editor.identity(), direction: 'redo'})
  assert.deepEqual(editor.state().manifest.documentInfo, info)
  assert.equal(editor.state().canReselect, true)
  const reselected = edit(editor, {type: 'selection.reselect'})
  assert.equal(reselected.status, 'applied')
  assert.deepEqual(editor.state().selection, selected, 'The precise inverted and feathered selection must survive metadata-only history')
  assert.deepEqual(editor.state().manifest.documentInfo, info)
  assert.deepEqual(editor.snapshot().assets, original.assets)
})
