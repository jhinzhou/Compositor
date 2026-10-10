import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

// electron-vite's import regex can mistake messages such as "Continue import"
// for imports and insert its shim inside a string. Insert the same shim at the
// chunk boundary first so its built-in shim recognises it and skips insertion.
// Our Electron runtime supports import.meta.filename/dirname (Node >= 20.11).
function safeEsmShim(): Plugin {
  const shim = `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`
  return { name: 'compositor:safe-esm-shim', renderChunk: { order: 'pre', handler(code, _chunk, options) {
    if (options.format !== 'es' || !/__filename|__dirname|require\(|require\.resolve\(/.test(code)) return null
    return { code: shim + code, map: null }
  } } }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), safeEsmShim()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          editor: resolve('src/main/editor.worker.ts'),
          photoshop: resolve('src/core/photoshop.worker.ts')
        }
      }
    }
  },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { plugins: [vue()], build: { assetsInlineLimit: 0 } }
})
