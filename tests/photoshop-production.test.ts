import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {build} from 'esbuild'
import {writePsdBuffer} from 'ag-psd'
const exec=promisify(execFile)
test('production Node ESM resolves pinned Photoshop adapter deep imports and decodes an actual adjustment PSD',async()=>{
 const artifacts=resolve('artifacts');await mkdir(artifacts,{recursive:true});const temporary=await mkdtemp(join(artifacts,'photoshop-production-'))
 try{const entry=join(temporary,'photoshop.mjs'),fixture=join(temporary,'fixture.psd');await build({entryPoints:[resolve('src/core/photoshop-io.ts')],outfile:entry,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});await writeFile(fixture,writePsdBuffer({width:16,height:12,children:[{name:'Levels',adjustment:{type:'levels'}}]},{noBackground:true}));const {stdout}=await exec(process.execPath,['--input-type=module','-e',`import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';const module=await import(pathToFileURL(process.argv[1]).href);const decoded=module.decodePhotoshop(await readFile(process.argv[2]));console.log(JSON.stringify(decoded.manifest.layers.map(layer=>layer.adjustment?.kind)))`,entry,fixture]);assert.deepEqual(JSON.parse(stdout),['Levels'])}
 finally{await rm(temporary,{recursive:true,force:true})}
})
