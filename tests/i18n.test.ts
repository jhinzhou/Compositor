import test from 'node:test'
import assert from 'node:assert/strict'
import { computed } from 'vue'
import { catalogs, interpolate, isLocale, normalizeLocale, translate, translateMessage } from '../src/shared/i18n'
import { applyLocale, useI18n } from '../src/renderer/i18n'
import { BLEND_MODES, mutationSchema } from '../src/shared/contracts'

const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort()
test('Both language catalogs use consistent shared terms and preserve all message placeholders', () => {
  const seen = new Map<string, string>()
  for (const catalog of catalogs) for (const [source, translated] of Object.entries(catalog)) {
    assert.ok(source && translated.trim(), `Empty translation: ${source}`)
    assert.deepEqual(placeholders(translated), placeholders(source), source)
    if (seen.has(source)) assert.equal(translated, seen.get(source), `Conflicting translation: ${source}`)
    seen.set(source, translated)
  }
})
test('Locale normalization accepts Chinese system variants and limits stored values to supported languages', () => {
  for (const value of ['zh', 'zh-CN', 'zh-TW', 'zh-Hans-CN', 'ZH_cn']) assert.equal(normalizeLocale(value), 'zh-CN')
  for (const value of ['en-US', 'fr', null, {}, 'zhinvalid']) assert.equal(normalizeLocale(value), 'en')
  assert.equal(isLocale('zh-CN'), true); assert.equal(isLocale('en'), true)
  assert.equal(isLocale('en-US'), false); assert.equal(isLocale('zh'), false)
})
test('Interpolation preserves literal user data and safe English fallback without treating values as replacement syntax', () => {
  assert.equal(interpolate('Import {name}', { name: '$& ${endpoint} Opacity.png' }), 'Import $& ${endpoint} Opacity.png')
  assert.equal(interpolate('Import {name}', {}), 'Import {name}')
  assert.equal(translate('en', 'Import {name}', { name: '中文图.png' }), 'Import 中文图.png')
  assert.equal(translate('zh-CN', 'Import {name}', { name: 'Opacity.png' }), '导入 Opacity.png')
  assert.equal(translate('zh-CN', 'Unknown provider text'), 'Unknown provider text')
  for (const key of ['constructor', 'toString', '__proto__']) assert.equal(translate('zh-CN', key), key)
})
test('Known diagnostic display keeps the error code and uses the specific parameterized warning', () => {
  assert.equal(translateMessage('zh-CN', 'DOCUMENT_BUSY: Finish the current interaction first.'), 'DOCUMENT_BUSY: 请先完成当前交互。')
  const message = 'Example: smart object imported as a raster; linked/embedded source files are not imported.'
  const output = translateMessage('zh-CN', message)
  assert.ok(output.startsWith('Example'), output); assert.ok(/智能对象/.test(output), output)
  assert.equal(translateMessage('en', message), message)
  assert.equal(translateMessage('zh-CN', 'Provider XYZ returned a new diagnostic'), 'Provider XYZ returned a new diagnostic')
})
test('Language changes update already-mounted reactive labels while protocol identifiers and user document content remain stable', () => {
  const { t, locale } = useI18n(), caption = computed(() => t('Layers'))
  const request = { sessionId: '00000000-0000-4000-8000-000000000001', documentId: '00000000-0000-4000-8000-000000000002', expectedRevision: 0, idempotencyKey: 'language-test', action: { type: 'layer.set_blend', layerId: '00000000-0000-4000-8000-000000000003', blendMode: 'Multiply' } }
  const before = mutationSchema.parse(request), modes = [...BLEND_MODES]
  applyLocale('en'); assert.equal(caption.value, 'Layers')
  applyLocale('zh-CN'); assert.equal(locale.value, 'zh-CN'); assert.equal(caption.value, '图层')
  assert.deepEqual(mutationSchema.parse(request), before); assert.deepEqual(BLEND_MODES, modes)
  applyLocale('en'); assert.equal(caption.value, 'Layers')
})
