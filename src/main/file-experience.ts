import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EditorError } from '../shared/contracts'
export interface RecentProject { id: string; title: string; location: string; format: 'comp' | 'psd' | 'psb'; openedAt: string }
interface StoredRecent { id: string; path: string; openedAt: string }
export const PROJECT_EXTENSIONS = ['comp', 'psd', 'psb'] as const
/** Paths are private capabilities: the GUI opens an opaque recorded ID, never an arbitrary path. */
export class FileExperience {
  private entries: StoredRecent[] = []
  constructor(private storePath: string, private onChange: () => void = () => {}) {}
  async initialize(): Promise<void> {
    try { const stat = await lstat(this.storePath); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) return; const value: unknown = JSON.parse(await readFile(this.storePath, 'utf8')); if (!Array.isArray(value)) return; const seen = new Set<string>(); this.entries = value.filter((entry): entry is StoredRecent => !!entry && typeof entry === 'object' && typeof entry.id === 'string' && /^[\da-f-]{36}$/i.test(entry.id) && typeof entry.path === 'string' && entry.path.length <= 8192 && isAbsolute(entry.path) && PROJECT_EXTENSIONS.includes(extname(entry.path).slice(1).toLowerCase() as typeof PROJECT_EXTENSIONS[number]) && typeof entry.openedAt === 'string' && Number.isFinite(Date.parse(entry.openedAt))).filter(entry => { if (seen.has(entry.path)) return false; seen.add(entry.path); return true }).slice(0, 20) } catch { this.entries = [] }
  }
  snapshot(): RecentProject[] { return this.entries.map(entry => ({ id: entry.id, title: basename(entry.path).replace(/\.[^.]+$/, ''), location: dirname(entry.path), format: extname(entry.path).slice(1).toLowerCase() as RecentProject['format'], openedAt: entry.openedAt })) }
  async record(path: string): Promise<void> {
    const canonical = await validateProjectPath(path), previous = this.entries.find(entry => entry.path === canonical)
    this.entries = [{ id: previous?.id ?? randomUUID(), path: canonical, openedAt: new Date().toISOString() }, ...this.entries.filter(entry => entry.path !== canonical)].slice(0, 20); await this.persist(); this.onChange()
  }
  async pathFor(id: string): Promise<string> { const entry = this.entries.find(entry => entry.id === id); if (!entry) throw new EditorError('INVALID_ARGUMENT', 'This recent project is no longer in the list.'); return validateProjectPath(entry.path) }
  async clear(): Promise<void> { this.entries = []; await this.persist(); this.onChange() }
  private async persist(): Promise<void> { await mkdir(dirname(this.storePath), { recursive: true }); const temporary = `${this.storePath}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(this.entries), { mode: 0o600 }); await rename(temporary, this.storePath) }
}
export async function validateProjectPath(path: string): Promise<string> {
  if (typeof path !== 'string' || path.length > 8192 || !isAbsolute(path) || path.includes('\0')) throw new EditorError('INVALID_ARGUMENT', 'Invalid project file path.')
  const extension = extname(path).slice(1).toLowerCase(); if (!PROJECT_EXTENSIONS.includes(extension as typeof PROJECT_EXTENSIONS[number])) throw new EditorError('INVALID_ARGUMENT', 'Select a .comp project, PSD or PSB file.')
  const stat = await lstat(path).catch(() => { throw new EditorError('IO_ERROR', 'This project has moved or is no longer available.') })
  if (stat.isSymbolicLink() || (extension === 'comp' ? !stat.isDirectory() : !stat.isFile())) throw new EditorError('INVALID_ARGUMENT', 'Projects must be regular .comp directories or Photoshop files.')
  return realpath(path)
}
/** Used only for trusted OS launch/second-instance arguments, not renderer/MCP requests. */
export function launchFilePaths(args: string[], cwd: string): string[] { return [...new Set(args.filter(value => typeof value === 'string' && !value.startsWith('-') && value.length <= 8192 && /\.(comp|psd|psb)$/i.test(value)).map(value => isAbsolute(value) ? value : resolve(cwd, value)))].slice(0, 8) }
