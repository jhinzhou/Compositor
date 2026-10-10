import {createRequire} from 'node:module'
import {readFile,writeFile,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import * as ResEdit from 'resedit'
const require=createRequire(import.meta.url),asar=require('@electron/asar'),pkg=JSON.parse(await readFile('package.json','utf8'))
const root=resolve(process.argv[2]??`release/${pkg.version}/win-unpacked`),checks:{name:string;status:'PASS';evidence:unknown}[]=[]
function record(name:string,evidence:unknown){checks.push({name,status:'PASS',evidence})}
async function x64(relative:string){const file=join(root,relative),bytes=await readFile(file);assert.equal(bytes.toString('ascii',0,2),'MZ');const offset=bytes.readUInt32LE(60);assert.equal(bytes.toString('ascii',offset,offset+4),'PE\0\0');assert.equal(bytes.readUInt16LE(offset+4),0x8664);assert.equal(bytes.readUInt16LE(offset+24),0x20b);return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}
record('Application executable is Windows AMD64 PE32+',await x64('Compositor Electron.exe'))
const archive=join(root,'resources/app.asar'),metadata=JSON.parse(asar.extractFile(archive,'package.json').toString());assert.equal(metadata.version,pkg.version);assert.equal(metadata.main,'out/main/index.js');record('Application archive declares the current version and main entry',{version:metadata.version,main:metadata.main})
const resource=ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(await readFile(join(root,'Compositor Electron.exe')))),infos=ResEdit.Resource.VersionInfo.fromEntries(resource.entries);assert.ok(infos.length);for(const info of infos)for(const language of info.getAvailableLanguages()){const values=info.getStringValues(language);assert.equal(values.ProductVersion,pkg.version);assert.equal(values.ProductName,pkg.build.productName)}record('EXE product version and name match the packaged application',{version:pkg.version,name:pkg.build.productName})
const native=join('resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/win32/x64');for(const name of ['onnxruntime_binding.node','onnxruntime.dll','DirectML.dll','dxcompiler.dll','dxil.dll'])record(`Bundled ${name} targets Windows x64`,await x64(join(native,name)))
for(const [source,destination] of [['scripts/windows-runtime-setup.ps1','Install-VisualCppRuntime.ps1'],['docs/WINDOWS-RELEASE.md','Windows-Readme.md']]){assert.deepEqual(await readFile(join(root,destination)),await readFile(source));record(`${destination} matches current source`,{destination,bytes:(await stat(join(root,destination))).size})}
assert.ok(resource.entries.some(entry=>entry.type===14));record('Application icon resources are present',{iconGroups:resource.entries.filter(entry=>entry.type===14).length})
const result={status:'STATIC_PASS_NATIVE_PENDING',version:pkg.version,checkedAt:new Date().toISOString(),host:process.platform,target:'win32-x64',root,scope:'Binary/metadata/resource inspection only. No Windows EXE, N-API binding, model inference or installer was executed.',checks}
await writeFile('artifacts/windows-package-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
