import {z} from 'zod'
const finite=z.number().finite()
export const transformSchema = z.object({
  origin: z.tuple([finite.min(-1_000_000).max(1_000_000), finite.min(-1_000_000).max(1_000_000)]),
  size: z.tuple([finite.min(1).max(300_000), finite.min(1).max(300_000)]),
  rotation: finite.default(0), flipX: z.boolean().default(false), flipY: z.boolean().default(false),
  sampling: z.enum(['High quality', 'Smooth', 'Nearest']).default('High quality')
}).passthrough()
