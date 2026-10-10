import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ExternalChange, ExternalProjectStatus } from '../shared/external-project'
interface Source { sessionId: string; title: string; projectPath?: string }
interface Entry { source: Source; watchers: FSWatcher[]; timer?: ReturnType<typeof setTimeout>; running: boolean; again: boolean; ignored?: string; change?: ExternalChange }
/** File-event-driven checks. No periodic manifest/asset hashing runs while files are unchanged. */
export class SourceWatch {
  private entries = new Map<string, Entry>()
  constructor(private check: (sessionId: string) => Promise<ExternalProjectStatus>, private reload: (sessionId: string, revision: number, fingerprint: string) => Promise<unknown>, private busy: (sessionId: string) => boolean, private notify: () => void, private debounceMs = 350) {}
  update(sources: Source[]): void {
    const ids = new Set(sources.filter(source => source.projectPath).map(source => source.sessionId))
    for (const [id, entry] of this.entries) if (!ids.has(id)) { this.closeEntry(entry); this.entries.delete(id) }
    for (const source of sources) {
      if (!source.projectPath) continue
      const old = this.entries.get(source.sessionId)
      if (old?.source.projectPath === source.projectPath) { old.source = source; continue }
      if (old) this.closeEntry(old)
      const entry: Entry = { source, watchers: [], running: false, again: false }; this.entries.set(source.sessionId, entry); this.arm(entry)
    }
  }
  snapshot(): ExternalChange[] { return [...this.entries.values()].flatMap(entry => entry.change ? [structuredClone(entry.change)] : []) }
  keep(sessionId: string): void { const entry = this.entries.get(sessionId); if (!entry) return; entry.ignored = entry.change?.fingerprint; entry.change = undefined; this.notify() }
  requestCheck(sessionId: string): void { const entry = this.entries.get(sessionId); if (entry) this.schedule(entry) }
  async reloaded(sessionId: string): Promise<void> { const entry = this.entries.get(sessionId); if (entry) { entry.ignored = undefined; entry.change = undefined; this.notify(); this.arm(entry) } }
  private arm(entry: Entry): void {
    for (const watcher of entry.watchers) watcher.close(); entry.watchers = []
    const path = entry.source.projectPath!
    for (const [directory, filter] of [[dirname(path), basename(path)], [path, undefined], [join(path, 'images'), undefined]] as const) {
      try { const watcher = watch(directory, { persistent: false }, (_event, filename) => { if (filter && filename && filename.toString() !== filter) return; this.schedule(entry) }); watcher.on('error', () => this.schedule(entry)); entry.watchers.push(watcher) } catch { /* The parent directory watcher still reports replacement/deletion. */ }
    }
  }
  private schedule(entry: Entry): void { clearTimeout(entry.timer); entry.timer = setTimeout(() => void this.inspect(entry), this.debounceMs); entry.timer.unref() }
  private async inspect(entry: Entry): Promise<void> {
    if (this.entries.get(entry.source.sessionId) !== entry) return
    if (entry.running) { entry.again = true; return }
    if (this.busy(entry.source.sessionId)) { this.schedule(entry); return }
    entry.running = true
    try {
      const status = await this.check(entry.source.sessionId)
      if (this.entries.get(entry.source.sessionId) !== entry) return
      this.arm(entry)
      if (!status.changed && status.readable) { entry.change = undefined; entry.ignored = undefined; this.notify(); return }
      if (status.readable && status.fingerprint === entry.ignored) return
      if (this.busy(status.sessionId)) { this.schedule(entry); return }
      if (status.changed && status.readable && !status.modified && status.fingerprint && !this.busy(status.sessionId)) {
        try { await this.reload(status.sessionId, status.revision, status.fingerprint); entry.change = undefined; entry.ignored = undefined; this.notify(); return } catch (error) { entry.change = { ...status, title: entry.source.title, status: 'busy', error: error instanceof Error ? error.message : String(error) }; this.notify(); return }
      }
      entry.change = { ...status, title: entry.source.title, status: status.readable ? 'changed' : 'unavailable' }; this.notify()
    } catch (error) {
      entry.change = { sessionId: entry.source.sessionId, revision: 0, projectPath: entry.source.projectPath, modified: true, changed: true, readable: false, title: entry.source.title, status: 'unavailable', error: error instanceof Error ? error.message : String(error) }; this.notify()
    } finally { entry.running = false; if (entry.again) { entry.again = false; this.schedule(entry) } }
  }
  private closeEntry(entry: Entry): void { clearTimeout(entry.timer); for (const watcher of entry.watchers) watcher.close() }
  dispose(): void { for (const entry of this.entries.values()) this.closeEntry(entry); this.entries.clear() }
}
