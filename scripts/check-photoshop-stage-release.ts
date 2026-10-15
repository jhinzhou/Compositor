import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// Root owns desktop input. Every child runs serially with its own disposable
// profile; native Photoshop references were authored separately, not here.
const output=process.argv[2]??'artifacts/photoshop-stage-release'
const fixture='fixtures/photoshop-corpus/photoshop-27.11.0-rgb16/'
const suites=[
 {name:'brush-alpha21',script:'smoke-photoshop-brush-alpha21.ts',args:[]},
 {name:'mask-feather-alpha21',script:'smoke-mask-feather-alpha21.ts',args:[]},
 {name:'crop-alpha21',script:'smoke-crop-alpha21.ts',args:[]},
 {name:'brush-alpha20',script:'smoke-photoshop-brush-alpha20.ts',args:[]},
 {name:'brush',script:'smoke-photoshop-brush.ts',args:[]},
 {name:'selection-ux',script:'smoke-photoshop-selection-ux.ts',args:[]},
 {name:'synthetic-rle16',script:'smoke-photoshop-channel-import.ts',args:[]},
 {name:'native-psd16',script:'smoke-photoshop-channel-import.ts',args:[fixture+'rgb16-layered.psd']},
 {name:'native-psb16',script:'smoke-photoshop-channel-import.ts',args:[fixture+'precision-rgb16-native.psb']},
 {name:'mask-feather-ui',script:'smoke-mask-feather-ui.ts',args:[]},
 {name:'crop-lifecycle',script:'smoke-crop-lifecycle.ts',args:[]},
 {name:'mask-boundaries',script:'smoke-mask-boundaries.ts',args:[]},
 {name:'common',script:'smoke-photoshop-common.ts',args:[]},
 {name:'workflow',script:'smoke-photoshop-workflow.ts',args:[]},
 {name:'interaction',script:'smoke-interaction.ts',args:[]}
]
const mode=process.env.COMPOSITOR_EXECUTABLE?'packaged':'development',version=JSON.parse(await readFile('package.json','utf8')).version
const reports:{name:string;script:string;args:string[];directory:string;durationMs:number;exitCode:number|null;reusedPassedReport?:boolean}[]=[]
await mkdir(output,{recursive:true})
const resume=process.argv.includes('--resume-passed')
let resumedFromStatus:string|undefined
if(resume){
 const prior=JSON.parse(await readFile(join(output,'acceptance.json'),'utf8'))
 assert.equal(prior.version,version);assert.equal(prior.mode,mode);assert.equal(prior.executable,process.env.COMPOSITOR_EXECUTABLE)
 assert.ok(['FAIL','RUNNING'].includes(prior.status));resumedFromStatus=prior.status
 for(const row of prior.reports){
  if(row.exitCode!==0)break
  const suite=suites[reports.length];assert.ok(suite);assert.equal(row.name,suite.name);assert.equal(row.script,suite.script);assert.deepEqual(row.args,suite.args)
  const checks=[]
  for(const file of await readdir(row.directory))if(file.endsWith('.json')){
   const value=JSON.parse(await readFile(join(row.directory,file),'utf8'))
   if(Array.isArray(value.checks))checks.push(value)
  }
  assert.equal(checks.length,1);assert.ok(['PASS','passed'].includes(checks[0].status));assert.deepEqual(checks[0].errors,[])
  reports.push({...row,reusedPassedReport:true})
 }
 console.log(`Reusing ${reports.length} completed ${mode} suites; failed/unstarted suites will run serially`)
}
const save=(status:string)=>writeFile(join(output,'acceptance.json'),JSON.stringify({status,version,mode,resumedFromStatus,executable:process.env.COMPOSITOR_EXECUTABLE,updatedAt:new Date().toISOString(),scope:'Serial isolated desktop input, readonly/native-authored16 references, import report/cancel, project save/reopen, selection/rasterization and existing workflows. No claim of arbitrary Photoshop appearance or Windows equivalence.',reports},null,2)+'\n')
await save('RUNNING')
for(const suite of suites.slice(reports.length)){
 const started=Date.now(),directory=join(output,suite.name),chunks:Buffer[]=[]
 console.log(`Starting ${mode} ${suite.name}`)
 const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs',join('scripts',suite.script),...suite.args],{env:{...process.env,COMPOSITOR_SMOKE_OUTPUT:directory},stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',(data:Buffer)=>chunks.push(data));child.stderr.on('data',(data:Buffer)=>chunks.push(data))
 const exitCode=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)})
 await writeFile(join(output,suite.name+'.log'),Buffer.concat(chunks))
 reports.push({...suite,directory,durationMs:Date.now()-started,exitCode});await save(exitCode===0?'RUNNING':'FAIL')
 console.log(`${exitCode===0?'PASS':'FAIL'} ${suite.name}`)
 if(exitCode!==0)throw new Error(`Inspect ${join(output,suite.name+'.log')}`)
}
await save('PASS');console.log(`PASS ${suites.length} ${mode} Photoshop-stage suites`)
