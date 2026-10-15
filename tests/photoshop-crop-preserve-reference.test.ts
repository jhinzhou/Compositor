import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {compositeDeepDocument} from '../src/core/deep-composite'
const f=JSON.parse(readFileSync('fixtures/parity/photoshop-27.11-crop-preserve.json','utf8')),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
test('same native crop/save/reopen/restore procedure preserves the complete original source and rendered pixels',async()=>{
 const source=inflateSync(Buffer.from(f.sourceRGBAZlib,'base64'));assert.equal(hash(source),f.sourceRGBASHA256)
 const native=f.rows.find((row:{kind:string})=>row.kind==='preserve'),deleted=f.rows.find((row:{kind:string})=>row.kind==='delete');assert.equal(native.sourceDifferences,0);assert.ok(deleted.sourceDifferences>0)
 const e=new Editor(),png=new PNG({width:f.sourceWidth,height:f.sourceHeight});png.data=source;e.importPNG(PNG.sync.write(png),'Native crop source');const before=e.snapshot();e.apply({...e.identity(),action:{type:'document.crop',...f.crop,deleteCroppedPixels:false}})
 function rendered(editor:Editor){const s=editor.snapshot(),deep=compositeDeepDocument(s.manifest,s.assets);return Buffer.from(Uint8Array.from(deep.data,v=>Math.round(v/257)))}
 const crop=inflateSync(Buffer.from(native.croppedRGBAZlib,'base64'));assert.equal(hash(crop),native.croppedRGBASHA256);assert.deepEqual(rendered(e),crop)
 const dir=await mkdtemp(join(tmpdir(),'native-crop-'));try{const path=join(dir,'cropped.comp');await e.saveAs(path);const reopened=new Editor();await reopened.open(path);reopened.apply({...reopened.identity(),action:{type:'document.crop',x:-f.crop.x,y:-f.crop.y,width:f.sourceWidth,height:f.sourceHeight,deleteCroppedPixels:false}});const restored=inflateSync(Buffer.from(native.restoredRGBAZlib,'base64'));assert.equal(hash(restored),native.restoredRGBASHA256);assert.deepEqual(rendered(reopened),restored);assert.deepEqual(reopened.snapshot().assets,before.assets)}finally{await rm(dir,{recursive:true,force:true})}
})
