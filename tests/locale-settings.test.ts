import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocaleSettingsStore } from '../src/main/locale-settings'

test('locale preference persists atomically and wins over system/test defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compositor-locale-'))
  try {
    const path = join(dir, 'language.json'), store = new LocaleSettingsStore(path)
    assert.equal(await store.load('zh-Hans-CN'), 'zh-CN')
    assert.equal(await store.load('zh-CN', true), 'en')
    assert.equal(await store.load('de-DE'), 'en')
    await Promise.all([store.save('zh-CN'), store.save('en'), store.save('zh-CN')])
    assert.equal(await new LocaleSettingsStore(path).load('en', true), 'zh-CN')
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, locale: 'zh-CN' })
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.deepEqual(await readdir(dir), ['language.json'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('malformed or unsupported saved preferences safely fall back without overwriting files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compositor-locale-'))
  try {
    const path = join(dir, 'language.json'), store = new LocaleSettingsStore(path)
    for (const text of ['{', 'null', '[]', '{"version":2,"locale":"zh-CN"}', '{"version":1,"locale":"fr"}', '{"version":1,"locale":"zh-CN","apiKey":"not-language-settings"}', 'x'.repeat(1025)]) {
      await writeFile(path, text)
      assert.equal(await store.load('zh-CN'), 'zh-CN')
      assert.equal(await store.load('zh-CN', true), 'en')
      assert.equal(await readFile(path, 'utf8'), text)
    }
    await assert.rejects(store.save('fr' as never), /Unsupported/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('failed locale save cleans its temporary file and later saves still work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compositor-locale-'))
  try {
    const path = join(dir, 'language.json'), store = new LocaleSettingsStore(path)
    await mkdir(path)
    await assert.rejects(store.save('zh-CN'))
    assert.deepEqual(await readdir(dir), ['language.json'])
    await rm(path, { recursive: true })
    await store.save('en')
    assert.equal(await store.load('zh-CN'), 'en')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
