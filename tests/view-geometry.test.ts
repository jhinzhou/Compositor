import assert from 'node:assert/strict'
import test from 'node:test'
import { centerCanvasOrigin, fitRect, gridLines, navigatorPoint, navigatorSize, navigatorViewport, normalizeGrid, rulerTicks, snapGuide, snapRect, snapTargets, visibleDocumentRect } from '../src/renderer/view-geometry'
import { commandForKey, eventChord, loadShortcuts, normalizeChord, saveShortcuts, searchCommands, SHORTCUT_STORAGE_KEY, shortcutFor, shortcutLabel, shortcutProblem } from '../src/renderer/command-shortcuts'
import type { WorkspaceCommand } from '../src/renderer/command-shortcuts'
const document = { width: 1920, height: 1080 }
test('navigator preserves image proportions and original 126 × 90 bounds', () => {
  assert.deepEqual(navigatorSize(document), { width: 126, height: 71 })
  assert.deepEqual(navigatorSize({ width: 1080, height: 1920 }), { width: 51, height: 90 })
  assert.deepEqual(fitRect({ width: 200, height: 100 }, { width: 100, height: 100 }), { x: 0, y: 25, width: 100, height: 50 })
})
test('navigator letterboxing converts clicks and clamps beyond document edges', () => {
  const box = { width: 100, height: 100 }, image = { width: 200, height: 100 }
  assert.deepEqual(navigatorPoint({ x: 50, y: 50 }, image, box), { x: 100, y: 50 })
  assert.deepEqual(navigatorPoint({ x: -30, y: 200 }, image, box), { x: 0, y: 100 })
})
test('navigator clips viewport rectangle when canvas reaches beyond document', () => {
  assert.deepEqual(navigatorViewport({ width: 200, height: 100 }, { width: 100, height: 100 }, { x: -20, y: 20, width: 100, height: 100 }), { x: 0, y: 35, width: 40, height: 40 })
})
test('viewport coordinates and center navigation remain inverses at high zoom', () => {
  const viewport = { width: 1000, height: 700 }, point = { x: 840, y: 300 }, zoom = 8
  const origin = centerCanvasOrigin(point, viewport, zoom), visible = visibleDocumentRect(viewport, origin, zoom)
  assert.equal(visible.x + visible.width / 2, point.x); assert.equal(visible.y + visible.height / 2, point.y)
})
test('invalid empty navigator dimensions are safe', () => {
  assert.deepEqual(navigatorSize({ width: 0, height: 0 }), { width: 0, height: 0 })
  assert.deepEqual(navigatorPoint({ x: 1, y: 1 }, { width: 0, height: 0 }, { width: 100, height: 100 }), { x: 0, y: 0 })
})
test('grid clamps upstream ranges and never draws subpixel subdivision spacing', () => {
  assert.deepEqual(normalizeGrid({ spacing: 1, subdivisions: 64, color: 'bad', opacity: 0 }), { spacing: 2, subdivisions: 2, color: '#b3b3b3', opacity: 1, style: 'lines' })
  assert.equal(normalizeGrid({ spacing: 99999 }).spacing, 4096)
})
test('uneven subdivision spacing is rounded from origin without accumulating drift', () => {
  assert.deepEqual(gridLines(0, 20, { spacing: 10, subdivisions: 3 }), [{ position: 0, major: true }, { position: 3, major: false }, { position: 7, major: false }, { position: 10, major: true }, { position: 13, major: false }, { position: 17, major: false }, { position: 20, major: true }])
})
test('grid enumerates only visible range and bounds work for large canvases', () => {
  const visible = gridLines(25000, 25100, { spacing: 64, subdivisions: 8 })
  assert.ok(visible.every(line => line.position >= 25000 && line.position <= 25100))
  assert.ok(gridLines(0, 30000, { spacing: 2, subdivisions: 2 }).length <= 4096)
})
test('rulers retain negative coordinates and adaptive readable major intervals', () => {
  const ticks = rulerTicks(-100, 400, 1)
  assert.ok(ticks.some(tick => tick.position === -100 && tick.major))
  assert.deepEqual(ticks.filter(tick => tick.major).map(tick => tick.position), [-100, 0, 100, 200, 300, 400])
  assert.ok(rulerTicks(0, 10, 20).some(tick => tick.position === 5 && tick.major))
})
test('snap excludes moving and hidden layers and hidden guides', () => {
  const targets = snapTargets({ enabled: true, zoom: 1, document, canvas: false, guidesVisible: false, movingIds: ['moving'], layers: [{ id: 'moving', x: 10, y: 10, width: 20, height: 20 }, { id: 'hidden', visible: false, x: 50, y: 50, width: 20, height: 20 }, { id: 'visible', x: 100, y: 200, width: 40, height: 60 }], guides: [{ id: 'g', axis: 'vertical', position: 800 }] })
  assert.deepEqual(targets, { xs: [100, 140, 120], ys: [200, 260, 230] })
})
test('snap tolerance stays fixed in screen points and can be bypassed', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 }, delta = { x: 98, y: 40 }
  const options = { enabled: true, zoom: 1, document, canvas: false, guides: [{ id: 'g', axis: 'vertical' as const, position: 100 }] }
  assert.equal(snapRect(rect, delta, options).delta.x, 100)
  assert.equal(snapRect(rect, delta, { ...options, zoom: 4 }).delta.x, 98)
  assert.deepEqual(snapRect(rect, delta, { ...options, enabled: false }), { delta })
})
test('grid snapping uses nearby analytical lines rather than large document arrays', () => {
  const options = { enabled: true, zoom: 1, document, canvas: false, layerBounds: false, guideBounds: false, grid: normalizeGrid({ spacing: 64, subdivisions: 8 }), gridVisible: true }
  assert.equal(snapGuide(29999, 'vertical', options), 30000)
  assert.equal(snapGuide(29999, 'vertical', { ...options, gridVisible: false }), 29999)
})
test('guide drag ignores itself and still snaps to another guide', () => {
  const options = { enabled: true, zoom: 1, document, canvas: false, guides: [{ id: 'self', axis: 'vertical' as const, position: 42 }, { id: 'other', axis: 'vertical' as const, position: 45 }] }
  assert.equal(snapGuide(42, 'vertical', options, 'self'), 45)
})
const commands: WorkspaceCommand[] = [{ id: 'save', title: 'Save Project', category: 'File', shortcut: 'Primary+s' }, { id: 'save-copy', title: 'Save a Copy', category: 'File', shortcut: 'Primary+Alt+s', keywords: ['duplicate', 'export'] }, { id: 'zoom', title: 'Zoom In', category: 'View', shortcut: 'Primary+=' }, { id: 'crop', title: 'Crop Canvas', category: 'Image', enabled: false }]
test('command search requires every term, searches categories and keywords, and ranks titles', () => {
  assert.deepEqual(searchCommands(commands, 'save').map(command => command.id), ['save', 'save-copy'])
  assert.deepEqual(searchCommands(commands, 'file duplicate').map(command => command.id), ['save-copy'])
  assert.deepEqual(searchCommands(commands, '  ZOOM  ').map(command => command.id), ['zoom'])
  assert.deepEqual(searchCommands(commands, 'missing'), [])
})
test('shortcuts normalize modifiers and map primary across macOS and Windows', () => {
  assert.equal(normalizeChord('shift + cmdorctrl + S'), 'Primary+Shift+s')
  assert.equal(normalizeChord('Primary+Primary+s'), undefined)
  assert.equal(eventChord({ key: 'S', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }, 'mac'), 'Primary+Shift+s')
  assert.equal(eventChord({ key: 's', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }, 'other'), 'Primary+s')
  assert.equal(eventChord({ key: 'Shift', metaKey: false, ctrlKey: false, shiftKey: true, altKey: false }, 'other'), undefined)
})
test('shortcut conflicts include defaults and disabled commands and reserve system chords', () => {
  assert.match(shortcutProblem(commands, { zoom: 'Primary+s' })!, /same shortcut/)
  assert.match(shortcutProblem(commands, { crop: 'Primary+s' })!, /same shortcut/)
  assert.match(shortcutProblem(commands, { save: 'Primary+q' })!, /reserved/)
  assert.equal(shortcutProblem(commands, { zoom: 'Primary+Shift+z' }), undefined)
})
test('shortcut overrides may disable a default and disabled commands cannot execute', () => {
  assert.equal(shortcutFor(commands[0]!, { save: '' }), undefined)
  const event = { key: 's', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }
  assert.equal(commandForKey(commands, {}, event, 'other')?.id, 'save')
  assert.equal(commandForKey(commands, { save: '' }, event, 'other'), undefined)
  assert.equal(commandForKey(commands, { crop: 'Primary+c' }, { ...event, key: 'c' }, 'other'), undefined)
})
test('shortcut storage validates persisted data and rejects conflicts before saving', () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  saveShortcuts(storage, commands, { save: 'Primary+Shift+s', unknown: 'x' })
  assert.deepEqual(loadShortcuts(storage, commands), { save: 'Primary+Shift+s' })
  assert.throws(() => saveShortcuts(storage, commands, { zoom: 'Primary+s' }), /same shortcut/)
  values.set(SHORTCUT_STORAGE_KEY, '{corrupt'); assert.deepEqual(loadShortcuts(storage, commands), {})
  values.set(SHORTCUT_STORAGE_KEY, JSON.stringify({ save: 'Primary+q' })); assert.deepEqual(loadShortcuts(storage, commands), {})
})
test('shortcut display translates semantic primary modifier without changing stored data', () => {
  assert.equal(shortcutLabel('Primary+Shift+s', 'mac'), '⌘⇧S')
  assert.equal(shortcutLabel('Primary+Shift+s', 'other'), 'Ctrl+Shift+S')
})
