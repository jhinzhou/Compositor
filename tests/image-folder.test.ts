import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises'
import {join,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {expandImageImports} from '../src/main/image-folder'

test('folder import selects only direct visible image files, naturally ordered, without following child links',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'compositor-folder-'))
  try{
    for(const name of ['10.png','2.PNG','1.jpeg','.hidden.png','notes.txt','camera.HIF'])await writeFile(join(dir,name),'source')
    await mkdir(join(dir,'nested'));await writeFile(join(dir,'nested','inside.png'),'source');await symlink(join(dir,'1.jpeg'),join(dir,'linked.png'))
    const result=await expandImageImports([dir]);assert.deepEqual(result.paths.map(path=>basename(path)),['1.jpeg','2.PNG','10.png','camera.HIF']);assert.deepEqual(result.emptyFolders,[])
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('multiple input order is retained, project packages are not expanded, and empty folders are reported',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'compositor-folder-'))
  try{
    await mkdir(join(dir,'empty'));await mkdir(join(dir,'project.comp'));await writeFile(join(dir,'project.comp','hidden.png'),'source');await writeFile(join(dir,'standalone.png'),'source')
    const result=await expandImageImports([join(dir,'standalone.png'),join(dir,'empty'),join(dir,'project.comp')]);assert.deepEqual(result.paths,[join(dir,'standalone.png'),join(dir,'project.comp')]);assert.deepEqual(result.emptyFolders,['empty'])
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('more than 256 image children rejects before returning a partial import list',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'compositor-folder-'))
  try{await Promise.all(Array.from({length:257},(_,i)=>writeFile(join(dir,`${i}.png`),'source')));await assert.rejects(expandImageImports([dir]),{code:'RESOURCE_LIMIT'})}
  finally{await rm(dir,{recursive:true,force:true})}
})
