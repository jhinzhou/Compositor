import {createRequire} from 'node:module'
import {readdir,readFile,writeFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const version=JSON.parse(await readFile('package.json','utf8')).version,root=join('release',version)
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex')
async function files(directory:string):Promise<string[]>{const all:string[]=[];for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name==='.DS_Store')continue;const path=join(directory,entry.name);if(entry.isDirectory())all.push(...await files(path));else if(entry.isFile())all.push(path)}return all.sort()}
const requestedPlatforms=process.argv.slice(2);assert.ok(requestedPlatforms.every(p=>['mac-arm64','win-x64'].includes(p)),'Unsupported platform');
const runtime=await files('out'),packages=[]
for(const [platform,resource] of [['mac-arm64',join(root,'mac-arm64/Compositor Electron.app/Contents/Resources')],['win-x64',join(root,'win-unpacked/resources')]]){
 if(requestedPlatforms.length&&!requestedPlatforms.includes(platform!))continue
 const archive=join(resource!,'app.asar'),metadata=JSON.parse(asar.extractFile(archive,'package.json').toString())
 assert.equal(metadata.version,version);let bundles=0
 for(const path of runtime){assert.equal(digest(asar.extractFile(archive,path)),digest(await readFile(path)),`${platform}: ${path}`);bundles++}
 for(const relative of ['models/u2netp.onnx','models/u2netp.metadata.json','icon.png']){
  const source=relative.startsWith('models/')?join('fixtures',relative):'build/icon.png'
  assert.equal(digest(await readFile(join(resource!,relative))),digest(await readFile(source)),`${platform}: ${relative}`)
 }
 const licenses=await files('licenses');for(const path of ['LICENSE','THIRD_PARTY_NOTICES.md',...licenses])assert.equal(digest(asar.extractFile(archive,path)),digest(await readFile(path)),`${platform}: ${path}`)
 packages.push({platform,version,bundles,licenseFiles:licenses.length+2,asarSha256:digest(await readFile(archive)),modelSha256:digest(await readFile(join(resource!,'models/u2netp.onnx')))})
}
const sources:string[]=[];for(const dir of ['src','scripts','tests','fixtures','docs','build','licenses'])sources.push(...await files(dir));sources.push('electron.vite.config.ts','tsconfig.json','package.json','package-lock.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md')
const sourceSnapshot=[];for(const path of sources.sort())sourceSnapshot.push({path,bytes:(await stat(path)).size,sha256:digest(await readFile(path))})
const zips=[];for(const name of await readdir(root)){if(name.endsWith('.zip')){const path=join(root,name),hash=digest(await readFile(path));const stored=(await readFile(path+'.sha256','utf8')).trim().split(/\s+/)[0];assert.equal(hash,stored);zips.push({path,bytes:(await stat(path)).size,sha256:hash})}}
const result={status:'PASS',version,createdAt:new Date().toISOString(),scope:`Verified ${packages.map(p=>p.platform).join(', ')} packages contain byte-identical current runtime bundles, model, icon and licenses; SHA256 of actual zip files. Package integrity is separate from native platform execution.`,packages,zips,sources:sourceSnapshot}
await writeFile(join(root,'SOURCE_MANIFEST.json'),JSON.stringify(result,null,2));await writeFile('artifacts/release-integrity.json',JSON.stringify({...result,sources:undefined,sourceFiles:sourceSnapshot.length},null,2));console.log(JSON.stringify({...result,sources:undefined,sourceFiles:sourceSnapshot.length},null,2))
