import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { loadProject, saveProject, writeDurable } from './project-io'
import { Editor } from './editor'
import { EditorError } from '../shared/contracts'

const entrySchema = z.object({ id: z.string().uuid(), sessionId: z.string().uuid(), title: z.string().max(4096), savedAt: z.string(), revision: z.number().int().nonnegative(), bytes: z.number().int().nonnegative().default(0) }).strict()
export type RecoveryEntry = z.infer<typeof entrySchema>
export class RecoveryStore {
  constructor(private directory: string) {}
  private file(id: string, extension: string): string { return join(this.directory, `${z.string().uuid().parse(id)}.${extension}`) }
  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const files = new Set(await readdir(this.directory))
    for (const file of files) {
      if (!/^[a-f0-9-]{36}\.comp$/.test(file)) continue
      const id = file.slice(0, -5)
      if (!z.string().uuid().safeParse(id).success || files.has(`${id}.json`)) continue
      const temporary = this.file(id, 'tmp')
      if (files.has(`${id}.tmp`)) {
        try {
          const stat = await lstat(temporary)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid checkpoint metadata.')
          const entry = entrySchema.parse(JSON.parse(await readFile(temporary, 'utf8')))
          if (entry.id !== id) throw new Error('Checkpoint identity mismatch.')
          await loadProject(this.file(id, 'comp'))
          await rename(temporary, this.file(id, 'json'))
          continue
        } catch { /* An unpublished, incomplete checkpoint has no recoverable content. */ }
      }
      await rm(this.file(id, 'comp'), { recursive: true, force: true })
      await rm(temporary, { force: true })
    }
  }
  async list(): Promise<RecoveryEntry[]> {
    await mkdir(this.directory, { recursive: true })
    const entries: RecoveryEntry[] = []
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue
      try {
        const path = join(this.directory, file), stat = await lstat(path)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) continue
        const entry = entrySchema.parse(JSON.parse(await readFile(path, 'utf8')))
        if (file !== `${entry.id}.json`) continue
        const packageStat = await lstat(this.file(entry.id, 'comp'))
        if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) continue
        entries.push(entry)
      } catch { /* Incomplete checkpoints do not become recoverable documents. */ }
    }
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }
  async checkpoint(editor: Editor): Promise<void> {
    const state = editor.state(), entries = await this.list(), previous = entries.filter(entry => entry.sessionId === state.sessionId)
    if (!state.modified) { for (const entry of previous) await this.discard(entry.id); return }
    if (previous.some(entry => entry.revision === state.revision && entry.title === state.title)) return
    const id = randomUUID(), snapshot = editor.snapshot()
    const bytes = Buffer.byteLength(JSON.stringify(snapshot.manifest, null, 2)) + [...snapshot.assets.values()].reduce((sum, asset) => sum + asset.bytes.length, 0)
    if (entries.length >= 32 && !previous.length || entries.reduce((sum, entry) => sum + entry.bytes, 0) + bytes > 512 * 1024 * 1024) throw new EditorError('RECOVERY_LIMIT', 'Recovery copies reached the 512 MiB or 32-document limit. Save your work and discard unwanted recovery copies.')
    await saveProject(this.file(id, 'comp'), snapshot.manifest, snapshot.assets)
    const entry: RecoveryEntry = { id, sessionId: state.sessionId, title: state.title, revision: state.revision, savedAt: new Date().toISOString(), bytes }
    const temporary = this.file(id, 'tmp')
    await writeDurable(temporary, JSON.stringify(entry))
    await rename(temporary, this.file(id, 'json'))
    for (const old of previous) await this.discard(old.id)
  }
  async get(id: string): Promise<{ entry: RecoveryEntry; path: string }> {
    const entry = entrySchema.parse(JSON.parse(await readFile(this.file(id, 'json'), 'utf8')))
    if (entry.id !== id) throw new Error('Recovery identity mismatch.')
    return { entry, path: this.file(id, 'comp') }
  }
  async discard(id: string): Promise<void> {
    await rm(this.file(id, 'json'), { force: true })
    await rm(this.file(id, 'comp'), { recursive: true, force: true })
  }
  async discardSession(sessionId: string): Promise<void> {
    for (const entry of await this.list()) if (entry.sessionId === sessionId) await this.discard(entry.id)
  }
}
