import { build } from 'esbuild'
await build({ entryPoints: ['src/mcp/server.ts'], outfile: 'out/mcp/server.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, sourcemap: true })
