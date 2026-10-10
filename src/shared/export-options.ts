import {LIMITS} from './limits'
import { z } from 'zod'

export const EXPORT_FORMATS = ['png', 'jpeg', 'pdf'] as const
export const exportOptionsSchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  width: z.number().int().min(1).max(LIMITS.maxSide),
  height: z.number().int().min(1).max(LIMITS.maxSide),
  resolution: z.number().finite().min(1).max(9600).default(72),
  quality: z.number().finite().min(0).max(1).default(.85),
  background: z.string().regex(/^#[\da-f]{6}$/i).nullable().default('#ffffff')
}).strict().refine(value => value.width * value.height <= LIMITS.maxSurfacePixels, 'Export exceeds the 200 megapixel limit.')
export type ExportOptions = z.infer<typeof exportOptionsSchema>
export type ExportPreview = { requestId: number; url: string; bytes: number; error?: string }

