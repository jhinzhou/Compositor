import {z} from 'zod'
const unit = z.number().finite().min(0).max(1)
export const fontName = z.string().min(1).max(200).refine(value => !/[\r\n\u2028\u2029]/.test(value), 'Font names cannot contain newlines.')
const range = { location: z.number().int().nonnegative(), length: z.number().int().positive() }
export const textStyleSchema = z.object({
  content: z.string().max(100_000), fontName, fontSize: z.number().finite().min(1).max(2000),
  red: unit, green: unit, blue: unit, alignment: z.enum(['Left', 'Center', 'Right']),
  tracking: z.number().finite().min(-100).max(1000), leading: z.number().finite().min(0).max(5000),
  boxSize: z.tuple([z.number().finite().min(16).max(30_000), z.number().finite().min(16).max(30_000)]).optional(),
  colorRuns: z.array(z.object({ ...range, red: unit, green: unit, blue: unit })).min(1).optional(),
  fontRuns: z.array(z.object({ ...range, fontName })).min(1).optional()
}).passthrough().superRefine((style, ctx) => {
  if (style.boxSize && style.boxSize[0] * style.boxSize[1] > 200_000_000) ctx.addIssue({ code: 'custom', path: ['boxSize'], message: 'The text box exceeds the source surface budget.' })
  for (const field of ['colorRuns', 'fontRuns'] as const) {
    let end = 0
    for (const [index, run] of (style[field] ?? []).entries()) {
      if (run.location < end || run.location + run.length > style.content.length) ctx.addIssue({ code: 'custom', path: [field, index], message: 'UTF-16 runs must be sorted, non-overlapping and inside the text.' })
      end = run.location + run.length
    }
  }
})
export const shapeStyleSchema = z.object({
  kind: z.enum(['Rectangle', 'Ellipse', 'Line']), red: unit, green: unit, blue: unit,
  cornerRadius: z.number().finite().nonnegative(), lineWidth: z.number().finite().nonnegative().optional(),
  start: z.tuple([unit, unit]).optional(), end: z.tuple([unit, unit]).optional()
}).passthrough()
export type TextStyle = z.infer<typeof textStyleSchema>
export type ShapeStyle = z.infer<typeof shapeStyleSchema>
export const validateTextStyle = (input: unknown): TextStyle => textStyleSchema.parse(input)
export const validateShapeStyle = (input: unknown): ShapeStyle => shapeStyleSchema.parse(input)
