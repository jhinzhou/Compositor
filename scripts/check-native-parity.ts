import {spawn} from 'node:child_process'
import {mkdir,writeFile,readdir,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'

// Own development runtime only; every smoke creates a throwaway profile/project.
// Keep all pointer/keyboard processes serial to avoid foreground focus interference.
const directory=process.argv[2]??'artifacts/native-parity-final';await mkdir(directory,{recursive:true})
const scripts=['smoke-upstream-delta.ts','smoke-native-parity.ts','smoke-image-size.ts','smoke-interaction.ts','smoke-pointer-brush.ts','smoke-parity-protocol.ts','smoke-parity-subject.ts','smoke-camera-preview.ts','smoke-parity-render.ts','smoke-upstream.ts']
const reports:{script:string;exitCode:number|null;durationMs:number;log:string}[]=[]
await writeFile(join(directory,'acceptance.json'),JSON.stringify({status:'RUNNING',startedAt:new Date().toISOString(),reports},null,2))
for(const script of scripts){const start=Date.now(),chunks:Buffer[]=[];console.log(`Starting ${script}`)
 const env={...process.env};delete env.COMPOSITOR_APP_EXECUTABLE;delete env.COMPOSITOR_EXECUTABLE
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',join('scripts',script)],{env,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',(data:Buffer)=>chunks.push(data));child.stderr.on('data',(data:Buffer)=>chunks.push(data))
 const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
 const log=join(directory,script.replace(/\.ts$/,'.log'));await writeFile(log,Buffer.concat(chunks));reports.push({script,exitCode:code,durationMs:Date.now()-start,log});console.log(`${code===0?'PASS':'FAIL'} ${script}`)
 await writeFile(join(directory,'progress.json'),JSON.stringify(reports,null,2));if(code!==0){await writeFile(join(directory,'acceptance.json'),JSON.stringify({status:'FAIL',reports,failedScript:script},null,2));throw new Error(`${script} failed; see ${log}`)}
}
async function files(dir:string):Promise<string[]>{const result:string[]=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())result.push(...await files(path));else if(entry.isFile())result.push(path)}return result.sort()}
const bundles=[];for(const path of await files('out'))bundles.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})
const version=JSON.parse(await readFile('package.json','utf8')).version
await writeFile(join(directory,'acceptance.json'),JSON.stringify({status:'PASS',version,completedAt:new Date().toISOString(),scope:'Serial isolated macOS development Electron UI/IPC/MCP validation; no clipboard or user app/profile access. Package runtime integrity and execution recorded separately.',reports,bundles},null,2));console.log(`PASS ${reports.length} desktop scripts for ${version}`)
