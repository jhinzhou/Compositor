import { EditorError } from '../shared/contracts'

type Ticket = { sessionId: string; resolve: (release: () => void) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
type Waiter = { sessionId: string; resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
/** One hidden renderer, bounded queuing, and per-document waits for short snapshots. */
export class RenderQueue {
  private active?: Ticket
  private queued: Ticket[] = []
  private waiters = new Set<Waiter>()
  constructor(private waitMilliseconds = 3000) {}
  acquire(sessionId: string): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const ticket: Ticket = { sessionId, resolve, reject }
      if (!this.active) { this.start(ticket); return }
      ticket.timer = setTimeout(() => {
        this.queued = this.queued.filter(queued => queued !== ticket)
        reject(this.busy()); this.notifyIdle()
      }, this.waitMilliseconds)
      this.queued.push(ticket)
    })
  }
  waitIdle(sessionId: string): Promise<void> {
    if (!this.busyFor(sessionId)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { sessionId, resolve, reject, timer: setTimeout(() => { this.waiters.delete(waiter); reject(this.busy()) }, this.waitMilliseconds) }
      this.waiters.add(waiter)
    })
  }
  private busyFor(sessionId: string): boolean { return this.active?.sessionId === sessionId || this.queued.some(ticket => ticket.sessionId === sessionId) }
  private start(ticket: Ticket): void {
    clearTimeout(ticket.timer); this.active = ticket
    ticket.resolve(() => {
      if (this.active !== ticket) return
      this.active = undefined
      const next = this.queued.shift(); if (next) this.start(next)
      this.notifyIdle()
    })
  }
  private notifyIdle(): void {
    for (const waiter of this.waiters) if (!this.busyFor(waiter.sessionId)) { clearTimeout(waiter.timer); this.waiters.delete(waiter); waiter.resolve() }
  }
  private busy(): EditorError { return new EditorError('DOCUMENT_BUSY', 'A preview is still rendering. Try again shortly.') }
}
