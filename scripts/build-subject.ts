import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
const output = process.env.COMPOSITOR_SUBJECT_WORKER_OUT ?? 'out/main/subject.worker.cjs'
await mkdir(output.slice(0, Math.max(0, output.lastIndexOf('/'))) || '.', { recursive: true })
await build({ entryPoints: ['src/core/subject-worker.ts'], outfile: output, platform: 'node', target: 'node24', format: 'cjs', bundle: true, external: ['onnxruntime-node'], sourcemap: true })
console.log(`Subject and content-fill worker built: ${output}`)
