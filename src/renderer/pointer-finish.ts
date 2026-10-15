/** Keep one pointer gesture owned until its asynchronous commit and lease release finish. */
export class PointerFinish {
  private pending?: Promise<void>
  private canceled = false
  get active(): boolean { return !!this.pending }
  wait(): Promise<void> { return this.pending ?? Promise.resolve() }
  run(finish: (canceled: () => boolean) => Promise<void>, cancel = false): Promise<void> {
    if (this.pending) { this.canceled ||= cancel; return this.pending }
    this.canceled = cancel
    // Install the guard before executing finish, even when it completes synchronously.
    const pending = Promise.resolve().then(() => finish(() => this.canceled)).finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
    this.pending = pending
    return pending
  }
}
