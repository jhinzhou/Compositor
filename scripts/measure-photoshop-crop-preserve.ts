/** Archives verified native output; compares native controls before writing evidence. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
import {decodePhotoshop} from '../src/core/photoshop-io'
const root='artifacts/photoshop-native',dir=root+'/outputs/crop-preserve-study',hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),sourceBytes=readFileSync(root+'/inputs/crop-alpha20-source.png'),source=PNG.sync.read(sourceBytes),log=readFileSync(dir+'/native-results.tsv','utf8')
assert.match(log,/Photoshop\t27\.11\.0/);assert.match(log,/preserve\tPASS\tdeleteCroppedPixels=false/);assert.match(log,/delete\tPASS\tdeleteCroppedPixels=true/)
const rows=[]
for(const kind of ['preserve','delete']){
 const croppedBytes=readFileSync(`${dir}/${kind}-cropped.png`),restoredBytes=readFileSync(`${dir}/${kind}-restored.png`),psdBytes=readFileSync(`${dir}/${kind}-cropped.psd`),cropped=PNG.sync.read(croppedBytes),restored=PNG.sync.read(restoredBytes),decoded=decodePhotoshop(psdBytes);assert.equal(cropped.width,300);assert.equal(cropped.height,200);assert.equal(restored.width,512);assert.equal(restored.height,320)
 const expectedCrop=Buffer.alloc(300*200*4);for(let y=0;y<200;y++)source.data.copy(expectedCrop,y*300*4,((y+40)*512+60)*4,((y+40)*512+360)*4);assert.deepEqual(cropped.data,expectedCrop)
 let differences=0;for(let i=0;i<source.data.length;i++)if(source.data[i]!==restored.data[i])differences++
 if(kind==='preserve')assert.deepEqual(restored.data,source.data);else assert.ok(differences>0)
 rows.push({kind,deleteCroppedPixels:kind==='delete',croppedWidth:300,croppedHeight:200,restoredWidth:512,restoredHeight:320,croppedRGBAZlib:deflateSync(cropped.data).toString('base64'),restoredRGBAZlib:deflateSync(restored.data).toString('base64'),croppedRGBASHA256:hash(cropped.data),restoredRGBASHA256:hash(restored.data),croppedPNGSHA256:hash(croppedBytes),restoredPNGSHA256:hash(restoredBytes),psdSHA256:hash(psdBytes),layer:decoded.manifest.layers[0],sourceDifferences:differences})
}
const result={application:'Adobe Photoshop 27.11.0',method:'Actual native Crop action with DeleteCroppedPixels false and true controls, own512x320 diagnostic document, native PSD saved/closed/reopened, canvas extended and retained layer translated back. Existing user documents untouched.',sourceWidth:512,sourceHeight:320,sourcePNGSHA256:hash(sourceBytes),sourceRGBASHA256:hash(source.data),sourceRGBAZlib:deflateSync(source.data).toString('base64'),crop:{x:60,y:40,width:300,height:200},scriptSHA256:hash(readFileSync('scripts/native-reference/photoshop-crop-preserve-study.jsx')),logSHA256:hash(log),rows}
mkdirSync(root+'/measurements/crop-preserve',{recursive:true});writeFileSync('fixtures/parity/photoshop-27.11-crop-preserve.json',JSON.stringify(result,null,2)+'\n');writeFileSync(root+'/measurements/crop-preserve/comparison.json',JSON.stringify(result,null,2)+'\n');console.log(rows.map(r=>({kind:r.kind,differences:r.sourceDifferences,layerSize:r.layer.transform.size,origin:r.layer.transform.origin})))
