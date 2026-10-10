import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { EditorError, type Manifest } from '../shared/contracts'
import { fingerprintProject, saveProject, writeDurable, type Asset } from './project-io'

const journalSchema = z.object({ id: z.string().uuid(), destination: z.string(), oldHash: z.string().regex(/^[a-f0-9]{64}$/), newHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
type Journal = z.infer<typeof journalSchema>
export interface SaveRecovery { id: string; destination: string; status: 'recovered' | 'attention'; message?: string }
function paths(journal: Journal) {
  const destination = resolve(journal.destination)
  if (destination !== journal.destination || !destination.endsWith('.comp')) throw new EditorError('INVALID_PROJECT', 'Invalid save journal destination.')
  const prefix = join(dirname(destination), `.${basename(destination)}.${journal.id}`)
  return { destination, staging: `${prefix}.new.comp`, backup: `${prefix}.previous.comp`, lock: join(dirname(destination), `.${basename(destination)}.save-lock`) }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}
async function acquireLock(path: string, id: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify({ id, pid: process.pid })); await handle.sync() } finally { await handle.close() }
      return async () => { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const before = await lstat(path)
      if (before.isSymbolicLink() || !before.isFile() || before.size > 1024) throw new EditorError('SAVE_BUSY', 'This project is locked by another writer.')
      let lock: { pid: number; id: string }
      try { lock = z.object({ pid: z.number().int().positive(), id: z.string().uuid() }).parse(JSON.parse(await readFile(path, 'utf8'))) }
      catch { throw new EditorError('SAVE_BUSY', 'The project lock needs attention.') }
      if (alive(lock.pid)) throw new EditorError('SAVE_BUSY', 'This project is being saved by another process.')
      const after = await lstat(path)
      if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) throw new EditorError('SAVE_BUSY', 'The project lock changed.')
      await unlink(path)
    }
  }
  throw new EditorError('SAVE_BUSY', 'Could not acquire the project lock.')
}
async function hashIfPresent(path: string): Promise<string | undefined> { return await exists(path) ? fingerprintProject(path) : undefined }
async function recoverOne(journal: Journal, journalFile: string): Promise<void> {
  const { destination, staging, backup } = paths(journal)
  const targetHash = await hashIfPresent(destination), backupHash = await hashIfPresent(backup)
  if (backupHash && backupHash !== journal.oldHash) throw new EditorError('SAVE_CONFLICT', 'The save backup was modified; it has been preserved.')
  if (targetHash && targetHash !== journal.oldHash && targetHash !== journal.newHash) throw new EditorError('SAVE_CONFLICT', 'The project changed during recovery; all candidates have been preserved.')
  if (!targetHash) {
    if (backupHash === journal.oldHash) await rename(backup, destination)
    else if (await hashIfPresent(staging) === journal.newHash) await rename(staging, destination)
    else throw new EditorError('SAVE_RECOVERY_FAILED', 'No complete project candidate was found.')
  }
  if (await exists(backup)) await rm(backup, { recursive: true })
  if (await exists(staging)) await rm(staging, { recursive: true })
  await unlink(journalFile)
}

export async function replaceProject(destination: string, manifest: Manifest, assets: Map<string, Asset>, expectedHash: string, journalDirectory: string,
  onPhase?: (phase: 'prepared' | 'backed_up' | 'installed') => Promise<void>,previewJPEG?:Buffer): Promise<string> {
  destination = resolve(destination)
  const id = randomUUID(), template = { id, destination, oldHash: expectedHash, newHash: expectedHash }
  const location = paths(template)
  await mkdir(journalDirectory, { recursive: true })
  const release = await acquireLock(location.lock, id), journalFile = join(journalDirectory, `${id}.json`)
  let journal: Journal | undefined
  try {
    if (await fingerprintProject(destination) !== expectedHash) throw new EditorError('SAVE_CONFLICT', 'The project was modified outside this application. Save a copy or reopen it.')
    await saveProject(location.staging, manifest, assets,previewJPEG)
    journal = { ...template, newHash: await fingerprintProject(location.staging) }
    await writeDurable(journalFile, JSON.stringify(journal))
    await onPhase?.('prepared')
    if (await fingerprintProject(destination) !== expectedHash) throw new EditorError('SAVE_CONFLICT', 'The project changed while saving. Your edits are still open.')
    await rename(destination, location.backup)
    await onPhase?.('backed_up')
    await rename(location.staging, destination)
    await onPhase?.('installed')
    await recoverOne(journal, journalFile)
    return destination
  } catch (error) {
    if (journal) {
      try {
        await recoverOne(journal, journalFile)
        if (await fingerprintProject(destination) === journal.newHash && journal.newHash !== journal.oldHash) return destination
      } catch { /* Keep journal and complete candidates for startup recovery. */ }
    } else await rm(location.staging, { recursive: true, force: true })
    throw error
  } finally { await release() }
}

export async function recoverSaveJournals(directory: string): Promise<SaveRecovery[]> {
  await mkdir(directory, { recursive: true })
  const results: SaveRecovery[] = []
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue
    let destination = ''
    try {
      const path = join(directory, file), stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid save journal.')
      const journal = journalSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (file !== `${journal.id}.json`) throw new Error('Save journal identity mismatch.')
      destination = journal.destination
      const release = await acquireLock(paths(journal).lock, journal.id)
      try { await recoverOne(journal, path) } finally { await release() }
      results.push({ id: journal.id, destination, status: 'recovered' })
    } catch (error) { results.push({ id: file.slice(0, -5), destination, status: 'attention', message: error instanceof Error ? error.message : String(error) }) }
  }
  return results
}
