import {spawn} from 'node:child_process'
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const output=process.argv[2]??'artifacts/alpha29-runtime',version=JSON.parse(await readFile('package.json','utf8')).version,mode=process.env.COMPOSITOR_EXECUTABLE?'packaged':'development'
assert.equal(version,'0.3.0-alpha.29','Build the alpha.29 runtime before acceptance')
const allJobs:[string,string,string,string[]?][]=[
 ['perspective-alpha29','smoke-perspective-alpha29.ts','report.json'],
 ['patch-rea-alpha29','smoke-patch-tail-alpha28.ts','report.json'],
 ['toolbar-alpha29','smoke-toolbar-alpha29.ts','report.json'],
 ['vector-frame-alpha29','smoke-vector-frame-alpha29.ts','report.json'],
 ['eraser-regression','smoke-eraser-alpha29.ts','report.json'],
 ['layout-panels','smoke-layout-panels.ts','report.json']]
const jobs=allJobs
async function digestTree(dir:string):Promise<string>{const entries=await readdir(dir,{withFileTypes:true}),values:string[]=[];for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,e.name);values.push(path+':'+(e.isDirectory()?await digestTree(path):createHash('sha256').update(await readFile(path)).digest('hex')))}return createHash('sha256').update(values.join('\n')).digest('hex')}
const runtimeSHA256=await digestTree('out'),reports:any[]=[];await mkdir(output,{recursive:true})
const save=(status:string)=>writeFile(join(output,'acceptance.json'),JSON.stringify({status,version,mode,focused:true,fullRuntimeSuitesNotRun:['Historical unaffected suites; this run verifies changed functionality and eraser/layout regressions'],runtimeSHA256,executable:process.env.COMPOSITOR_EXECUTABLE,updatedAt:new Date().toISOString(),suites:reports.length,checks:reports.reduce((n,r)=>n+r.checks,0),scope:'Serial real isolated Electron inputs; no concurrent Photoshop automation. Source, native reference and platform gates remain separate.',reports},null,2))
if(process.argv.includes('--resume-passed')){const prior=JSON.parse(await readFile(join(output,'acceptance.json'),'utf8'));assert.equal(prior.version,version);assert.equal(prior.mode,mode);assert.equal(prior.runtimeSHA256,runtimeSHA256);assert.equal(prior.executable,process.env.COMPOSITOR_EXECUTABLE);for(const row of prior.reports){if(row.status!=='PASS')break;const job=jobs[reports.length];assert.equal(row.name,job[0]);const r=JSON.parse(await readFile(row.report,'utf8'));assert.ok(['PASS','passed'].includes(r.status));assert.deepEqual(r.errors??[],[]);reports.push({...row,reusedPassedReport:true})}}
const seedIndex=process.argv.indexOf('--seed-passed'),seeded=new Map<string,any>()
if(seedIndex>=0){
 const seedPath=process.argv[seedIndex+1];assert.ok(seedPath,'Provide a completed acceptance.json for --seed-passed')
 const seed=JSON.parse(await readFile(seedPath,'utf8'));assert.equal(seed.status,'PASS');assert.equal(seed.version,version);assert.equal(seed.mode,mode);assert.equal(seed.runtimeSHA256,runtimeSHA256);assert.equal(seed.executable,process.env.COMPOSITOR_EXECUTABLE)
 for(const row of seed.reports){const job=jobs.find(j=>j[0]===row.name);assert.ok(job,'Seeded suite must belong to this runner');assert.equal(row.script,job[1]);assert.deepEqual(row.args,job[3]??[]);assert.equal(row.status,'PASS');const report=JSON.parse(await readFile(row.report,'utf8'));assert.ok(['PASS','passed'].includes(report.status));assert.deepEqual(report.errors??[],[]);assert.deepEqual(report.screenshotFallbacks??[],[]);assert.equal(row.checks,report.checks?.length??0);seeded.set(row.name,{...row,reusedPassedReport:true,seededFrom:seedPath})}
}
await save('RUNNING')
for(const [name,script,file,args=[]] of jobs.slice(reports.length)){
 if(seeded.has(name)){assert.equal(await digestTree('out'),runtimeSHA256);reports.push(seeded.get(name));await save('RUNNING');continue}

 assert.equal(await digestTree('out'),runtimeSHA256,'Runtime changed before acceptance suite')
 const started=Date.now(),directory=join(output,name),chunks:Buffer[]=[];console.log(`Starting ${mode} ${name}`)
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',join('scripts',script),...args],{env:{...process.env,COMPOSITOR_SMOKE_OUTPUT:directory},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b))
 const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});await writeFile(join(output,name+'.log'),Buffer.concat(chunks))
 let report:any;try{report=JSON.parse(await readFile(join(directory,file),'utf8'))}catch{}
 const pass=code===0&&['PASS','passed'].includes(report?.status)&&(report.errors??[]).length===0&&(report.screenshotFallbacks??[]).length===0
 reports.push({name,script,args,report:join(directory,file),checks:report?.checks?.length??0,status:pass?'PASS':'FAIL',exitCode:code,durationMs:Date.now()-started,errors:report?.errors??[],screenshotFallbacks:report?.screenshotFallbacks??[]});await save(pass?'RUNNING':'FAIL');console.log(`${pass?'PASS':'FAIL'} ${name}`)
 assert.equal(await digestTree('out'),runtimeSHA256,'Runtime changed during acceptance; rebuild and rerun required');if(!pass)throw Error(`Inspect ${join(output,name+'.log')}`)
}
await save('PASS');console.log(`PASS ${jobs.length} ${mode} suites`)
