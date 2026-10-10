import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isLocale, normalizeLocale, type Locale } from '../shared/i18n'

/** Separate from document/model settings: language never changes document data. */
export class LocaleSettingsStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private path: string) {}
  async load(systemLocale: unknown, testMode = false): Promise<Locale> {
    const fallback = testMode ? 'en' : normalizeLocale(systemLocale)
    try {
      const text = await readFile(this.path, 'utf8')
      if (text.length > 1024) return fallback
      const value: unknown = JSON.parse(text)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
      const saved = value as Record<string, unknown>
      return Object.keys(saved).length === 2 && saved.version === 1 && isLocale(saved.locale) ? saved.locale : fallback
    } catch { return fallback }
  }
  save(locale: Locale): Promise<void> {
    // Runtime validation protects this module even when called outside IPC.
    if (!isLocale(locale)) return Promise.reject(new Error('Unsupported application language.'))
    const data = JSON.stringify({ version: 1, locale })
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temp = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, data, { mode: 0o600, flag: 'wx' })
        await rename(temp, this.path)
      } finally { await rm(temp, { force: true }) }
    }
    const pending = this.tail.catch(() => {}).then(write)
    this.tail = pending
    return pending
  }
}
