/** Clean source-copy typecheck: current tracked + unignored untracked sources,
 * no out/release/artifacts/.git, and no GUI. Dependencies are explicitly reused
 * through one node_modules symlink: this is not npm-ci/platform/runtime proof.
 * Run only after the agents freeze source; mutations during capture/check fail.
 * --prepare only materializes; --keep preserves our own temp copy for diagnosis. */
import assert from 'node:assert/strict'
import {execFile as execFileCallback} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,realpath,lstat,readFile,readlink,copyFile,symlink,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join,dirname,relative,extname} from 'node:path'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const execFile=promisify(execFileCallback),root=await realpath(process.cwd()),prepare=process.argv.includes('--prepare'),keep=process.argv.includes('--keep'),output=resolve(process.env.COMPOSITOR_CLEAN_SOURCE_OUTPUT??'artifacts/alpha28-clean-source-types')
const directory=await realpath(await mkdtemp(join(tmpdir(),'compositor-alpha28-source-types-'))),sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),blocked=new Set(['artifacts','out','release','dist','.git','node_modules'])
await mkdir(output,{recursive:true})
const gitRoot=await realpath((await execFile('git',['rev-parse','--show-toplevel'],{cwd:root})).stdout.trim());assert.equal(root,gitRoot,'Run from the Electron repository root')
async function paths(){const {stdout}=await execFile('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,maxBuffer:5_000_000});return [...new Set(stdout.split('\0').filter(Boolean))].filter(path=>!blocked.has(path.split('/')[0])).sort()}
async function digest(path:string){const s=await lstat(path);return s.isSymbolicLink()?sha('symlink:'+await readlink(path)):s.isFile()?sha(await readFile(path)):undefined}
function moduleImports(path:string,content:string){
 if(extname(path)==='.vue')content=[...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]).join('\n')
 const tree=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true),imports:string[]=[]
 function visit(node:ts.Node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))imports.push(node.moduleSpecifier.text)
  else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))imports.push(node.arguments[0].text)
  else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteralLike(node.argument.literal))imports.push(node.argument.literal.text)
  ts.forEachChild(node,visit)
 }
 visit(tree);return imports
}
const snapshot:Record<string,string>={},ignoredImports:unknown[]=[],outsideLinks:unknown[]=[],skippedMissing:string[]=[];let diagnostics='',status='FAIL'
try{
 const originalPaths=await paths()
 for(const path of originalPaths){
  const source=join(root,path),destination=join(directory,path);let info
  try{info=await lstat(source)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){skippedMissing.push(path);continue}throw error}
  if(info.isDirectory())throw new Error(`Uncaptured submodule/directory source ${path}; materialize it before claiming a clean source check`)
  await mkdir(dirname(destination),{recursive:true})
  if(info.isSymbolicLink()){
   const target=await readlink(source),resolved=resolve(dirname(source),target),inside=relative(root,resolved);assert.ok(!inside.startsWith('..')&&!blocked.has(inside.split('/')[0]),`Source symlink escapes clean source or points into runtime artifacts: ${path}`)
   // Convert absolute in-repository links into equivalent relative copy links.
   await symlink(relative(dirname(destination),join(directory,inside)),destination);snapshot[path]=sha('symlink:'+target)
  }else{
   const bytes=await readFile(source);snapshot[path]=sha(bytes);await copyFile(source,destination);assert.equal(await digest(destination),snapshot[path],`Source changed while copying ${path}`)
   if(/\.(?:ts|tsx|mts|cts|vue)$/.test(path))for(const specifier of moduleImports(path,bytes.toString('utf8'))){
    if(!specifier.startsWith('.')&&!specifier.startsWith('/'))continue
    const resolved=resolve(dirname(source),specifier),inside=relative(root,resolved)
    if(inside.startsWith('..'))outsideLinks.push({path,specifier})
    else if(blocked.has(inside.split('/')[0])&&inside.split('/')[0]!=='node_modules')ignoredImports.push({path,specifier})
   }
  }
 }
 assert.deepEqual(ignoredImports,[],'Source imports compiled/ignored artifacts: a clean checkout must typecheck without them')
 assert.deepEqual(outsideLinks,[],'Relative/absolute imports escape the clean source snapshot')
 const dependencyRoot=await realpath(join(root,'node_modules'));await symlink(dependencyRoot,join(directory,'node_modules'),'dir')
 // Only dependency reuse is external; no generated application source is linked.
 for(const name of ['artifacts','out','release','dist','.git'])await assert.rejects(lstat(join(directory,name)),{code:'ENOENT'})
 if(!prepare){
  try{const result=await execFile(process.execPath,[join(dependencyRoot,'vue-tsc','bin','vue-tsc.js'),'--noEmit','-p',join(directory,'tsconfig.json')],{cwd:directory,timeout:120000,maxBuffer:5_000_000});diagnostics=result.stdout+result.stderr}catch(error){const e=error as Error&{stdout?:string;stderr?:string};diagnostics=(e.stdout??'')+(e.stderr??'');throw error}
 }
 const afterPaths=await paths();assert.deepEqual(afterPaths,originalPaths,'Source paths changed during capture/typecheck; retry after freeze')
 for(const [path,hash] of Object.entries(snapshot))assert.equal(await digest(join(root,path)),hash,`Source changed during typecheck: ${path}`)
 status=prepare?'PREPARED':'PASS'
 const report={status,sourceFiles:Object.keys(snapshot).length,sourceSnapshotSHA256:sha(JSON.stringify(snapshot)),skippedMissing,ignoredImports,outsideLinks,sourceOnly:true,dependencies:'Existing node_modules symlink; no dependency installation verification',runtime:'No Electron/Photoshop launch, no packaged or platform verification',cleanCopy:keep?directory:'removed after validation',diagnostics}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(output,'source-snapshot.json'),JSON.stringify(snapshot,null,2)+'\n');await writeFile(join(output,'typecheck.log'),diagnostics);console.log(JSON.stringify(report,null,2))
}catch(error){await writeFile(join(output,'report.json'),JSON.stringify({status,error:String(error),diagnostics,ignoredImports,outsideLinks,skippedMissing,sourceFiles:Object.keys(snapshot).length,cleanCopy:keep?directory:'removed after failure',scope:'Clean source copy only; actual source/dependencies remain untouched'},null,2)+'\n');await writeFile(join(output,'typecheck.log'),diagnostics);throw error}
finally{if(!keep)await rm(directory,{recursive:true,force:true})}
