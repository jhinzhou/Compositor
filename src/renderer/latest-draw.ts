type DrawIdentity = {sessionId: string; revision: number}

/** Coalesce redraws and publish results/errors only for the captured current view. */
export class LatestDraw<T extends DrawIdentity> {
  private drawing = false
  private pending = false
  private epoch = 0
  constructor(
    private current: () => T | undefined,
    private draw: (snapshot: T, isCurrent: () => boolean) => Promise<void>,
    private failed: (cause: unknown) => void
  ) {}
  get active(): boolean { return this.drawing }

  async request(): Promise<void> {
    this.pending = true
    this.epoch++
    if (this.drawing) return
    this.drawing = true
    try {
      while (this.pending) {
        this.pending = false
        const snapshot = this.current()
        if (!snapshot) continue
        const epoch = this.epoch, sessionId = snapshot.sessionId, revision = snapshot.revision
        const isCurrent = () => {
          const current = this.current()
          return !!current && epoch === this.epoch && current === snapshot && current.sessionId === sessionId && current.revision === revision
        }
        try { await this.draw(snapshot, isCurrent) }
        catch (cause) { if (isCurrent()) this.failed(cause) }
      }
    } finally { this.drawing = false }
  }
}
