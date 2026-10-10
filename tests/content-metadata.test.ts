import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultTextStyle, layoutTextLines, replaceTextCharacters, setTextColor, setTextFont, textColorAt, textFontAt, textSpans, validateShapeStyle, validateTextStyle } from '../src/renderer/content-raster'

test('original text metadata uses tuple paragraph bounds and UTF-16 run offsets', () => {
  const style = validateTextStyle({ ...defaultTextStyle(), content: 'A😀中B', boxSize: [120, 80], colorRuns: [{ location: 1, length: 2, red: 1, green: 0, blue: 0 }], fontRuns: [{ location: 3, length: 1, fontName: 'PingFangSC-Regular' }] })
  assert.equal(style.content.length, 5); assert.deepEqual(style.boxSize, [120, 80]); assert.deepEqual(textColorAt(style, 2), [1, 0, 0]); assert.equal(textFontAt(style, 3), 'PingFangSC-Regular')
  assert.deepEqual(textSpans(style).map(span => [span.text, span.offset]), [['A', 0], ['😀', 1], ['中', 3], ['B', 4]])
  assert.throws(() => validateTextStyle({ ...style, boxSize: { width: 120, height: 80 } }))
})

test('invalid overlapping, empty, unsorted and outside UTF-16 runs are rejected', () => {
  const base = { ...defaultTextStyle(), content: 'abcd' }
  for (const fontRuns of [[], [{ location: 3, length: 2, fontName: 'Arial' }], [{ location: 2, length: 1, fontName: 'Arial' }, { location: 1, length: 1, fontName: 'Arial' }], [{ location: 0, length: 3, fontName: 'Arial' }, { location: 2, length: 1, fontName: 'Arial' }]]) assert.throws(() => validateTextStyle({ ...base, fontRuns }))
  assert.throws(() => validateTextStyle({ ...base, fontName: 'Arial\nInjected' }))
  assert.throws(() => validateTextStyle({ ...base, tracking: 1001 }))
})

test('range font/color edits compact runs and whole-range edits reset overrides', () => {
  let style = { ...defaultTextStyle(), content: 'A😀BC' }
  style = setTextColor(style, 1, 2, [1, 0, 0]); style = setTextFont(style, 3, 2, 'Arial')
  assert.deepEqual(style.colorRuns, [{ location: 1, length: 2, red: 1, green: 0, blue: 0 }]); assert.deepEqual(style.fontRuns, [{ location: 3, length: 2, fontName: 'Arial' }])
  style = setTextColor(style, 0, 0, [0, 1, 0]); assert.equal(style.colorRuns, undefined); assert.equal(style.green, 1)
  style = setTextFont(style, 0, style.content.length, 'Georgia'); assert.equal(style.fontRuns, undefined); assert.equal(style.fontName, 'Georgia')
})

test('typing inherits preceding UTF-16 styles and deletion shifts later runs', () => {
  let style = setTextColor({ ...defaultTextStyle(), content: 'AB😀C' }, 1, 3, [1, 0, 0]); style = setTextFont(style, 1, 3, 'Arial')
  const inserted = replaceTextCharacters(style, 4, 0, 'xy')
  assert.equal(inserted.content, 'AB😀xyC'); assert.deepEqual(inserted.colorRuns, [{ location: 1, length: 5, red: 1, green: 0, blue: 0 }]); assert.equal(textFontAt(inserted, 5), 'Arial')
  const deleted = replaceTextCharacters(inserted, 1, 5, '')
  assert.equal(deleted.content, 'AC'); assert.equal(deleted.colorRuns, undefined); assert.equal(deleted.fontRuns, undefined)
})

test('paragraph layout wraps at spaces and preserves empty lines and source offsets', () => {
  const style = { ...defaultTextStyle(), content: 'ab cd\n\n😀x', tracking: 1 }
  const lines = layoutTextLines(style, 4, text => Array.from(text).length)
  assert.deepEqual(lines.map(line => [style.content.slice(line.start, line.end), line.start]), [['ab', 0], ['cd', 3], ['', 6], ['😀x', 7]])
})

test('shape metadata preserves native kind, RGB, radius and tuple line endpoints', () => {
  const line = validateShapeStyle({ kind: 'Line', red: 1, green: 0, blue: 0, cornerRadius: 0, lineWidth: 5, start: [.1, .2], end: [.9, .8] })
  assert.deepEqual(line.start, [.1, .2]); assert.equal(line.lineWidth, 5)
  assert.throws(() => validateShapeStyle({ ...line, start: [2, 0] }))
  assert.throws(() => validateShapeStyle({ ...line, kind: 'RoundedRectangle' }))
  assert.throws(() => validateShapeStyle({ ...line, red: Number.NaN }))
})
