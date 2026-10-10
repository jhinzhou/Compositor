import packageInfo from '../../package.json'
import { readFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { batchSchema, taskBeginSchema, taskReadSchema, taskCancelSchema, taskFinishSchema, taskUndoSchema, historySchema, mutationSchema, type RpcResult, type PreviewResult } from '../shared/contracts'

const connectionIndex = process.argv.indexOf('--connection')
const connectionFile = connectionIndex >= 0 ? process.argv[connectionIndex + 1] : process.env.COMPOSITOR_CONNECTION_FILE
if (!connectionFile) { console.error('Provide --connection <automation.json> from the running editor.'); process.exit(1) }

async function rpc(method: string, params?: unknown): Promise<RpcResult<any>> {
  try {
    const connection = z.object({ port: z.number().int().min(1).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(JSON.parse(await readFile(connectionFile!, 'utf8')))
    const response = await fetch(`http://127.0.0.1:${connection.port}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(135_000) })
    if (!response.ok) return { ok: false, error: { code: 'CONNECTION_REJECTED', message: 'The application rejected the automation connection.' } }
    return await response.json() as RpcResult
  } catch(cause) { return { ok:false,error:cause instanceof Error&&cause.name==='TimeoutError'?{code:'REQUEST_TIMEOUT',message:'The editor request timed out. Inspect current state and task status before retrying a write.'}:{code:'APP_NOT_RUNNING',message:'Start Compositor Electron and use its current automation connection file.'}} }
}
function toolResult(result: RpcResult<any>) {
  const value = result.ok ? result.value : result.error
  return { isError: !result.ok, content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }
}
serveStdio(() => {
  const server = new McpServer({ name: 'compositor-electron', version:packageInfo.version })
  server.registerTool('app.get_capabilities', { description: 'Read editor capabilities and limits before editing.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, async () => toolResult(await rpc('capabilities')))
  server.registerTool('document.get_state', { description: 'Read the live document handle, monotonic revision, layers and top undo transaction. Carry this handle and revision into subsequent edits.', inputSchema: z.object({ sessionId: z.string().uuid().optional() }).strict(), annotations: { readOnlyHint: true } }, async params => toolResult(await rpc('state', params)))
  server.registerTool('document.list', { description: 'List open document sessions without switching the active tab.', inputSchema: z.object({}).strict(), annotations: { readOnlyHint: true } }, async () => toolResult(await rpc('documents')))
  server.registerTool('document.apply', { description: 'Apply one typed layer edit. Coordinates are document pixels, rotation is clockwise about the layer center. Requires current revision and a unique retry key. Updates are visible in the editor and undoable.', inputSchema: mutationSchema, annotations: { readOnlyHint: false, destructiveHint: false } }, async params => toolResult(await rpc('apply', params)))
  server.registerTool('document.apply_batch', { description: 'Atomically apply up to 100 typed actions to one session. Use clientRef on new objects and {ref: name} in later layerId/parentId fields. One revision and undo entry; any failure changes nothing.', inputSchema: batchSchema, annotations: { destructiveHint: false } }, async params => toolResult(await rpc('applyBatch', params)))
  server.registerTool('task.begin', { description: 'Begin one Agent task bound to a document session. Carry the returned taskId into edits. Tasks have a five-minute execution budget.', inputSchema: taskBeginSchema }, async params => toolResult(await rpc('taskBegin', params)))
  server.registerTool('task.get_status', { description: 'Read task status and committed transaction IDs. A timeout does not prove failure; query before retrying.', inputSchema: taskReadSchema, annotations: { readOnlyHint: true } }, async params => toolResult(await rpc('taskStatus', params)))
  server.registerTool('task.cancel', { description: 'Stop future edits for a task without undoing committed edits. No expectedRevision is required because cancellation does not mutate document pixels.', inputSchema: taskCancelSchema }, async params => toolResult(await rpc('taskCancel', params)))
  server.registerTool('task.finish', { description: 'Finish the task as completed or failed after checking the actual resulting state and preview.', inputSchema: taskFinishSchema }, async params => toolResult(await rpc('taskFinish', params)))
  server.registerTool('history.undo_task', { description: 'Undo all committed task transactions only when they are contiguous at the history top. Later user edits block rollback.', inputSchema: taskUndoSchema, annotations: { destructiveHint: false } }, async params => toolResult(await rpc('undoTask', params)))
  server.registerTool('history.undo', { description: 'Undo only the current top transaction. Read state first; never undo through later user edits.', inputSchema: historySchema.omit({ direction: true }).extend({ transactionId: z.string().uuid() }), annotations: { destructiveHint: false } }, async params => toolResult(await rpc('history', { ...params, direction: 'undo' })))
  server.registerTool('document.preview', { description: 'Render the current immutable document snapshot as PNG. Returns image content and document-coordinate scale. Only the current revision can be captured.', inputSchema: z.object({ sessionId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), maxDimension: z.number().int().min(64).max(2048).default(1024) }).strict(), annotations: { readOnlyHint: true } }, async params => {
    const result = await rpc('preview', params)
    if (!result.ok) return toolResult(result)
    const { data, ...info } = result.value as PreviewResult
    return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }, { type: 'text' as const, text: JSON.stringify(info) }], structuredContent: info }
  })
  return server
}, { legacy: 'serve', onerror: error => console.error(error.message) })
