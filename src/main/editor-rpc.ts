import { randomUUID } from 'node:crypto'
import { EditorError, failure, type RpcResult } from '../shared/contracts'

/** Resolves every request even when the utility process exits or posting fails. */
export class EditorRpc {
  private stopped = false
  private calls = new Map<string, { resolve: (value: RpcResult<any>) => void; timer: NodeJS.Timeout }>()
  constructor(private postMessage: (message: { id: string; method: string; params?: unknown }) => void) {}
  request<T = unknown>(method: string, params?: unknown, timeout?: number): Promise<RpcResult<T>> {
    if (this.stopped) return Promise.resolve(this.unavailable())
    return new Promise(resolve => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.calls.delete(id)
        resolve(failure(new EditorError('TIMEOUT', 'The editor did not respond. Read state before retrying.')))
      }, timeout ?? (['save', 'saveCopy', 'saveAs', 'open', 'reload'].includes(method) ? 120_000 : 30_000))
      this.calls.set(id, { resolve, timer })
      try { this.postMessage({ id, method, params }) }
      catch { this.stop() }
    })
  }
  receive(id: string, result: RpcResult<unknown>): void {
    const call = this.calls.get(id)
    if (!call) return
    clearTimeout(call.timer); this.calls.delete(id); call.resolve(result)
  }
  stop(): void {
    this.stopped = true
    for (const call of this.calls.values()) { clearTimeout(call.timer); call.resolve(this.unavailable()) }
    this.calls.clear()
  }
  private unavailable(): RpcResult<never> {
    return failure(new EditorError('ENGINE_UNAVAILABLE', 'The editor process stopped. Restart the application. Existing recovery files have been kept.'))
  }
}
