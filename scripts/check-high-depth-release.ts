import {spawn} from 'node:child_process'
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'

// One owner runs actual desktop input serially, with each child owning its
// disposable profile. Packaged runs use the exact supplied executable.
const output=process.argv[2]??'artifacts/high-depth-release'
const scripts=['smoke-hdr-upstream.ts','smoke-upstream-ui.ts','smoke-deep-composite.ts','smoke-deep-tools.ts','smoke-layout-panels.ts']
const reports:{script:string;exitCode:number|null;durationMs:number;directory:string}[]=[]
await mkdir(output,{recursive:true})
const version=JSON.parse(await readFile('package.json','utf8')).version
const mode=process.env.COMPOSITOR_EXECUTABLE?'packaged':'development'
const save=async(status:string)=>writeFile(join(output,'acceptance.json'),JSON.stringify({status,version,mode,executable:process.env.COMPOSITOR_EXECUTABLE,updatedAt:new Date().toISOString(),reports},null,2))
await save('RUNNING')
for(const script of scripts){
 const started=Date.now(),directory=join(output,script.replace(/^smoke-|\.ts$/g,'')),chunks:Buffer[]=[]
 console.log(`Starting ${mode} ${script}`)
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',join('scripts',script)],{env:{...process.env,COMPOSITOR_SMOKE_OUTPUT:directory},stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',(data:Buffer)=>chunks.push(data));child.stderr.on('data',(data:Buffer)=>chunks.push(data))
 const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
 await writeFile(join(output,script.replace(/\.ts$/,'.log')),Buffer.concat(chunks))
 reports.push({script,exitCode,durationMs:Date.now()-started,directory});await save(exitCode===0?'RUNNING':'FAIL')
 console.log(`${exitCode===0?'PASS':'FAIL'} ${script}`)
 if(exitCode!==0)throw new Error(`${script} failed; inspect ${output}`)
}
async function files(path:string):Promise<string[]>{const result:string[]=[];for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())result.push(...await files(file));else if(entry.isFile())result.push(file)}return result.sort()}
const bundles=[];for(const file of await files('out'))bundles.push({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})
await writeFile(join(output,'acceptance.json'),JSON.stringify({status:'PASS',version,mode,executable:process.env.COMPOSITOR_EXECUTABLE,completedAt:new Date().toISOString(),scope:'Isolated Electron UI, worker, deep sources, previews, persistence and real stdio MCP. Desktop clipboard tests use process-local doubles. Native Photoshop/Metal equality, HDR monitor output and Windows remain separate gates.',reports,bundles},null,2))
console.log(`PASS ${reports.length} ${mode} desktop suites`)
