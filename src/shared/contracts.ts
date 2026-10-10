import { z } from 'zod'
import { pixelActionOptions, type Selection } from './pixel-contracts'

export const MCP_TOOLS = ['app.get_capabilities', 'document.get_state', 'document.list', 'document.preview', 'document.apply', 'document.apply_batch', 'history.undo', 'task.begin', 'task.get_status', 'task.cancel', 'task.finish', 'history.undo_task'] as const
export const BLEND_MODES = ['Normal', 'Darken', 'Multiply', 'Color Burn', 'Linear Burn', 'Lighten', 'Screen', 'Color Dodge', 'Linear Dodge (Add)', 'Overlay', 'Soft Light', 'Hard Light', 'Vivid Light', 'Linear Light', 'Pin Light', 'Hard Mix', 'Difference', 'Exclusion', 'Subtract', 'Divide', 'Hue', 'Saturation', 'Color', 'Luminosity'] as const
import {LIMITS} from './limits'
export {LIMITS} from './limits'
const finite = z.number().finite()
import {transformSchema} from './transform'
export {transformSchema} from './transform'
export const layerSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(4096), isVisible: z.boolean(),
  transform: transformSchema, imageFile: z.string().optional(), parentID: z.string().uuid().optional(),
  isGroup: z.boolean().default(false), opacity: finite.min(0).max(1).default(1), blendMode: z.string().default('Normal'),
  maskFile: z.string().optional(), maskEnabled: z.boolean().optional(), maskSourceID: z.string().uuid().optional(), maskLinked: z.boolean().optional(), maskPlacement: transformSchema.optional(),
  adjustment: z.unknown().optional(), effects: z.unknown().optional(), text: z.unknown().optional(), shape: z.unknown().optional()
}).passthrough()
export const manifestSchema = z.object({
  format: z.literal('com.compositor.project'), version: z.number().int().min(1).max(11), colorSpace: z.literal('sRGB'),
  documentID: z.string().uuid(), width: z.number().int().min(1).max(LIMITS.maxSide),
  height: z.number().int().min(1).max(LIMITS.maxSide), resolution: finite.min(1).max(9600).default(72),
  guides: z.array(z.object({id: z.string().uuid(),axis: z.enum(['horizontal','vertical']),position: finite.min(-1_000_000).max(1_000_000)}).strict()).max(1000).optional(),
  activeLayerID: z.string().uuid().nullable().optional(), layers: z.array(layerSchema).max(LIMITS.maxLayers)
}).passthrough()
export type Transform = z.infer<typeof transformSchema>
export type Layer = z.infer<typeof layerSchema>
export type Manifest = z.infer<typeof manifestSchema>
const clientRef = z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).optional()
function actionOptions<T extends z.ZodType>(target: T) { return [
  z.object({ type: z.literal('layer.rename'), layerId: target, name: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ type: z.literal('layer.set_visibility'), layerId: target, visible: z.boolean() }).strict(),
  z.object({ type: z.literal('layer.set_opacity'), layerId: target, opacity: finite.min(0).max(1) }).strict(),
  z.object({ type: z.literal('layer.set_blend'), layerId: target, blendMode: z.enum(BLEND_MODES) }).strict(),
  z.object({ type: z.literal('layer.set_transform'), layerId: target, transform: transformSchema }).strict(),
  z.object({ type: z.literal('layer.delete'), layerId: target }).strict(),
  z.object({ type: z.literal('layer.duplicate'), layerId: target, clientRef }).strict(),
  z.object({ type: z.literal('group.ungroup'), layerId: target }).strict(),
  z.object({ type: z.literal('layer.reorder'), layerId: target, direction: z.enum(['up', 'down']) }).strict(),
  z.object({ type: z.literal('layer.set_parent'), layerId: target, parentId: target.nullable() }).strict(),
  z.object({ type: z.literal('layer.move'), layerIds: z.array(target).min(1).max(LIMITS.maxLayers), parentId: target.nullable(), beforeLayerId: target.nullable() }).strict(),
  z.object({ type: z.literal('group.add'), name: z.string().trim().min(1).max(4096), clientRef }).strict(),
  z.object({ type: z.literal('layer.add_blank'), name: z.string().trim().min(1).max(4096), clientRef }).strict(),
  ...pixelActionOptions(target)
] as const }
export const actionSchema = z.discriminatedUnion('type', actionOptions(z.string().uuid()))
const referenceSchema = z.union([z.string().uuid(), z.object({ ref: clientRef.unwrap() }).strict()])
export const batchActionSchema = z.discriminatedUnion('type', actionOptions(referenceSchema))
export type EditAction = z.infer<typeof actionSchema>
export const mutationSchema = z.object({
  sessionId: z.string().uuid(), documentId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(200), taskId: z.string().uuid().optional(), action: actionSchema
}).strict()
export const batchSchema = mutationSchema.omit({ action: true }).extend({
  actions: z.array(batchActionSchema).min(1).max(100), label: z.string().trim().min(1).max(200).optional()
}).strict()
export type BatchMutation = z.infer<typeof batchSchema>
export const taskBeginSchema = mutationSchema.omit({ action: true, taskId: true }).extend({ label: z.string().trim().min(1).max(200) }).strict()
export const taskReadSchema = z.object({ sessionId: z.string().uuid(), taskId: z.string().uuid() }).strict()
export const taskCancelSchema = mutationSchema.omit({ action: true, expectedRevision: true }).extend({ taskId: z.string().uuid() }).strict()
export const taskFinishSchema = taskCancelSchema.extend({ state: z.enum(['completed', 'failed']), message: z.string().max(2000).optional() }).strict()
export const taskUndoSchema = mutationSchema.omit({ action: true }).extend({ taskId: z.string().uuid() }).strict()
export const historySchema = z.object({
  sessionId: z.string().uuid(), documentId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(200), transactionId: z.string().uuid().optional(), direction: z.enum(['undo', 'redo'])
}).strict()
export type Mutation = z.infer<typeof mutationSchema>
export type HistoryRequest = z.infer<typeof historySchema>
export interface EditResult { status: 'applied' | 'no_change'; revision: number; previousRevision: number; transactionId?: string; undoable: boolean; createdIds?: Record<string, string> }
export interface AssetInfo { file: string; hash: string; width: number; height: number }
export interface Activity { id: string; label: string; source: 'user' | 'agent' | 'system'; revision: number; at: string }
export interface EditorState {
  sessionId: string; revision: number; manifest: Manifest; title: string; projectPath?: string;
  modified: boolean; canUndo: boolean; canRedo: boolean; undoTransactionId?: string; redoTransactionId?: string;
  warnings: string[]; assets: AssetInfo[]; activity: Activity[]
  workspace?: WorkspaceState
  recoveryError?: string
  selection?: Selection | null
}
export interface DocumentSummary { sessionId: string; documentId: string; title: string; revision: number; modified: boolean; projectPath?: string; width: number; height: number; empty: boolean }
export interface WorkspaceState { activeSessionId: string; documents: DocumentSummary[]; retainedPixels: number }
export interface BridgeInfo { connectionFile: string; mcpCommand: string; mcpArgs: string[]; port: number }
export interface PreviewResult { data: string; mimeType: 'image/png'; revision: number; previewId: string; width: number; height: number; canvasSize: [number, number]; scale: number }
export type RpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details?: unknown } }
import {EditorError} from './errors'
export {EditorError} from './errors'
export function failure(error: unknown): RpcResult<never> {
  if (error instanceof EditorError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'The request or project metadata is invalid.', details: error.issues } }
  return { ok: false, error: { code: 'IO_ERROR', message: error instanceof Error ? error.message : String(error) } }
}
export interface DesktopAPI {
  platform: string
  onAction(callback: (action: string) => void): () => void
  request<T = unknown>(method: string, params?: unknown): Promise<RpcResult<T>>
  onAgent(callback: (state: unknown) => void): () => void
  onState(callback: (state: EditorState) => void): () => void
  renderComplete(id: string, result: RpcResult<PreviewResult>): void
  onRender(callback: (request: { id: string; state: EditorState; maxDimension: number; fullSize: boolean;content?:Extract<EditAction,{type:'layer.text'|'layer.shape'}> }) => void): () => void
}
