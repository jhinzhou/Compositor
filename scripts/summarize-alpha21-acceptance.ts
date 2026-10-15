import assert from 'node:assert/strict'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// Read actual child reports. A successful parent exit alone does not establish
// a check count, absence of renderer errors, or native pixel equivalence.
const version=JSON.parse(await readFile('package.json','utf8')).version
assert.equal(version,'0.3.0-alpha.21')
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'))
async function stage(mode:'development'|'packaged',name:'photoshop'|'high-depth'){
 const path=`artifacts/alpha21-${mode}/${name}/acceptance.json`,parent=await json(path)
 assert.equal(parent.status,'PASS',path);assert.equal(parent.version,version);assert.equal(parent.mode,mode)
 assert.equal(parent.reports.length,name==='photoshop'?15:5)
 const suites=[]
 for(const row of parent.reports){
  assert.equal(row.exitCode,0,row.directory)
  const candidates=[]
  for(const file of await readdir(row.directory))if(file.endsWith('.json')){
   const child=await json(join(row.directory,file))
   if(child&&Array.isArray(child.checks))candidates.push({file,child})
  }
  assert.equal(candidates.length,1,`One authoritative check report required: ${row.directory}`)
  const {file,child}=candidates[0]!
  assert.ok(['PASS','passed'].includes(child.status),`${row.directory}/${file}`)
  assert.ok(child.checks.length>0);assert.deepEqual(child.errors,[])
  if(Array.isArray(child.screenshotFallbacks))assert.deepEqual(child.screenshotFallbacks,[])
  if(child.version)assert.equal(child.version,version)
  suites.push({name:row.name??row.script,report:join(row.directory,file),checks:child.checks.length,durationMs:row.durationMs,reusedPassedReport:!!row.reusedPassedReport})
 }
 return {status:'PASS',report:path,suiteCount:suites.length,checkCount:suites.reduce((n,s)=>n+s.checks,0),executable:parent.executable,suites}
}
const runtimes=[]
for(const mode of ['development','packaged'] as const){
 const photoshop=await stage(mode,'photoshop'),highDepth=await stage(mode,'high-depth')
 if(mode==='packaged')assert.equal(photoshop.executable,highDepth.executable)
 runtimes.push({mode,suiteCount:photoshop.suiteCount+highDepth.suiteCount,checkCount:photoshop.checkCount+highDepth.checkCount,photoshop,highDepth})
}
const checkLog=await readFile('artifacts/alpha21-check.log','utf8')
const count=(name:string)=>{const match=checkLog.match(new RegExp(`^(?:#|ℹ) ${name} (\\d+)$`,'m'));assert.ok(match,name);return Number(match[1])}
const source={status:'PASS',report:'artifacts/alpha21-check.log',tests:count('tests'),passed:count('pass'),failed:count('fail'),postHarnessTypecheck:'artifacts/alpha21-final-typecheck.log',diffCheck:'artifacts/alpha21-diff-check.log'}
assert.equal(source.tests,source.passed);assert.equal(source.failed,0)
const integrity=await json('artifacts/release-integrity.json');assert.equal(integrity.status,'PASS');assert.equal(integrity.version,version);assert.equal(integrity.packages.length,1);assert.equal(integrity.packages[0].platform,'mac-arm64');assert.equal(integrity.zips.length,1)
const brush=await json('artifacts/photoshop-native/measurements/alpha21-near-hard/comparison.json'),mask=await json('artifacts/photoshop-native/measurements/mask-alpha21/comparison.json'),crop=await json('artifacts/photoshop-native/measurements/crop-alpha21/comparison.json')
const brushRows=brush.results
assert.equal(brushRows.length,158);assert.equal(mask.rows.length,31)
const nearHard={references:brushRows.length,improved:brushRows.filter((r:any)=>r.adopted.unionMAE<r.before.unionMAE).length,unchanged:brushRows.filter((r:any)=>r.adopted.unionMAE===r.before.unionMAE).length,minorMAERegressions:brushRows.filter((r:any)=>r.adopted.unionMAE>r.before.unionMAE).length,report:'artifacts/photoshop-native/measurements/alpha21-near-hard/comparison.json'}
assert.deepEqual([nearHard.improved,nearHard.unchanged,nearHard.minorMAERegressions],[15,142,1])
const layoutDiagnostics=[]
for(const directory of ['artifacts/alpha21-layout-diagnostic','artifacts/alpha21-layout-development-diagnostic','artifacts/alpha21-layout-packaged-diagnostic-2']){
 const path=directory+'/report.json',report=await json(path)
 assert.equal(report.status,'passed');assert.equal(report.checks.length,52);assert.deepEqual(report.errors,[]);assert.deepEqual(report.screenshotFallbacks,[])
 layoutDiagnostics.push({report:path,checks:52,status:'PASS'})
}
const result={status:'PASS',version,createdAt:new Date().toISOString(),scope:'Source, serial actual macOS Electron development/packaged UI, precision/history/persistence and distinct native Photoshop effect measurements. Repeated runtime checks are not independent features.',source,runtimes,layoutDiagnostics,unresolvedFindings:[{scope:'One isolated packaged layout run cleared the active selection after13 checks; not reproduced in3 diagnostic reruns plus final full high-depth rerun. Trigger/source remains unassigned; this is not claimed fixed.',failureReport:'artifacts/alpha21-packaged-layout-first-failure/report.json',firstFailedStage:'artifacts/alpha21-packaged-high-depth-first-failure-acceptance.json'}],native:{nearHard,maskFeather:{outputs:mask.rows.length,worstBefore:mask.worstBefore,worstAfter:mask.worstAfter,maxRegressions:mask.regressions,report:'artifacts/photoshop-native/measurements/mask-alpha21/comparison.json'},crop:{captures:3,straightenAngleAndIntegerDimensionsMatch:true,automaticPerspectiveDimensionsMatch:false,controlledPerspective:crop,report:'artifacts/photoshop-native/measurements/crop-alpha21/comparison.json'}},release:{report:'artifacts/release-integrity.json',...integrity},priorPassedBeforePreviewLayering:['artifacts/alpha21-development-before-preview-layering/photoshop/acceptance.json','artifacts/alpha21-development-before-preview-layering/high-depth/acceptance.json','artifacts/alpha21-packaged-before-preview-layering/photoshop/acceptance.json','artifacts/alpha21-packaged-before-preview-layering/high-depth/acceptance.json'],preservedFailedHarnessAttempts:['artifacts/alpha21-development-before-preview-layering/photoshop-first-run','artifacts/alpha21-development-before-preview-layering/photoshop-second-run','artifacts/alpha21-development-before-preview-layering/photoshop-third-run'],remainingLimits:['Near-hard and large hard tips retain native coverage differences; strokePath references do not establish tablet/freehand parity.','Small-radius heldout mask differences remain; arbitrary native mask transformations and deep grayscale are unverified.','Perspective suggested size differs from Photoshop and RGB resampling retains substantial high-frequency differences. Perspective source replacement is undoable only in session, not persistently nondestructive.','Windows, code signing/notarization, HDR monitor output and arbitrary external complex PSD remain separate gates.']}
await writeFile('artifacts/alpha21-final-acceptance.json',JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({status:result.status,version,sourceTests:source.tests,runtimes:runtimes.map(r=>({mode:r.mode,suites:r.suiteCount,checks:r.checkCount})),native:result.native,release:integrity},null,2))
