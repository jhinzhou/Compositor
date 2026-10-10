import { randomUUID } from 'node:crypto'
import { EditorError } from '../shared/contracts'

export interface AgentTask {
  taskId: string; sessionId: string; documentId: string; label: string; startedRevision: number; revision: number
  state: 'running' | 'completed' | 'cancelled' | 'failed' | 'undone'
  transactions: string[]; startedAt: string; expiresAt: number; message?: string
}
export class TaskRegistry {
  private tasks = new Map<string, AgentTask>()
  clear(): void { this.tasks.clear() }
  private expire(): void {
    for (const task of this.tasks.values()) if (task.state === 'running' && task.expiresAt <= Date.now()) { task.state = 'cancelled'; task.message = 'The task execution budget expired.' }
  }
  begin(sessionId: string, documentId: string, revision: number, label: string): AgentTask {
    this.expire()
    if ([...this.tasks.values()].some(task => task.state === 'running')) throw new EditorError('TASK_BUSY', 'Another Agent task is running in this document.')
    const task: AgentTask = { taskId: randomUUID(), sessionId, documentId, label, startedRevision: revision, revision, state: 'running', transactions: [], startedAt: new Date().toISOString(), expiresAt: Date.now() + 300_000 }
    this.tasks.set(task.taskId, task)
    if (this.tasks.size > 200) this.tasks.delete(this.tasks.keys().next().value!)
    return structuredClone(task)
  }
  get(taskId: string): AgentTask {
    this.expire()
    const task = this.tasks.get(taskId)
    if (!task) throw new EditorError('TASK_NOT_FOUND', 'The task is no longer in this document session.')
    return structuredClone(task)
  }
  assertWritable(taskId?: string): void {
    this.expire()
    if (taskId) {
      if (this.get(taskId).state !== 'running') throw new EditorError('TASK_STOPPED', 'This Agent task has stopped. No further edits are accepted.')
    } else if ([...this.tasks.values()].some(task => task.state === 'running')) throw new EditorError('TASK_BUSY', 'Carry the active taskId into Agent edits.')
  }
  record(taskId: string, revision: number, transactionId?: string): void {
    const task = this.tasks.get(taskId)!
    task.revision = revision
    if (transactionId) task.transactions.push(transactionId)
  }
  stop(taskId: string, state: AgentTask['state'], message?: string): AgentTask {
    const task = this.get(taskId), current = this.tasks.get(taskId)!
    if (state === 'cancelled' && task.state !== 'running') return task
    if (state !== 'undone' && task.state !== 'running') throw new EditorError('TASK_STOPPED', 'This task already stopped.')
    current.state = state; current.message = message
    return structuredClone(current)
  }
}
