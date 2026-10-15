/** Archive already captured, post-freeze native pixels as portable tests.
 * Does not execute Photoshop or overwrite a previous immutable fixture. */
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {perspectiveCropRaster} from '../src/core/crop-actions'
import {makeAsset} from '../src/core/project-io'
import type {CropCorners} from '../src/shared/crop-projective'
const [metadataPath,validationPath,fixturePath='fixtures/parity/photoshop-27.11-perspective-axis-rea-alpha30.json']=process.argv.slice(2)
assert.ok(metadataPath&&validationPath,'Pass native cohort and independent validation JSON paths.')
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),metadataBytes=await readFile(metadataPath),validationBytes=await readFile(validationPath),metadata=JSON.parse(metadataBytes.toString()),validation=JSON.parse(validationBytes.toString())
assert.equal(validation.status,'PASS_INDEPENDENT')
assert.equal(validation.candidateSHA,'46241bed8604c76269682a06b35dd8e3eb9e1860c4fa99ebbba6eb0660a94e27')
assert.equal(validation.nativeMetadataSHA,sha(metadataBytes))
const sources:Record<string,unknown>={},cases=[]
for(const reference of metadata.cases){
 const measurement=validation.rows.find((row:{name:string})=>row.name===reference.name)
 assert.ok(measurement);assert.equal(reference.status,'NATIVE_OUTPUT_CAPTURED');assert.deepEqual(measurement.regressed,[])
 const bytes=await readFile(reference.sourcePath),source=PNG.sync.read(bytes),native=PNG.sync.read(await readFile(reference.nativePath)),before=PNG.sync.read(await readFile(reference.nativeSourcePath)),work={samples:0}
 assert.equal(sha(source.data),measurement.sourceSHA);assert.equal(sha(native.data),measurement.nativeSHA)
 for(let at=0;at<source.data.length;at+=4){assert.equal(before.data[at+3],source.data[at+3]);if(source.data[at+3])assert.deepEqual(before.data.subarray(at,at+3),source.data.subarray(at,at+3))}
 const placement={origin:[0,0] as [number,number],size:[source.width,source.height] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const},actual=PNG.sync.read(perspectiveCropRaster(makeAsset('owned.png',bytes),placement,reference.corners as CropCorners,reference.width,reference.height,'High quality',false,0,work).bytes)
 assert.equal(sha(actual.data),measurement.candidateSHA,'Production must match frozen candidate/fallback bytes.')
 if(measurement.accepted)assert.deepEqual(actual.data,native.data)
 else assert.equal(sha(actual.data),measurement.baselineSHA,'Declined candidate must keep previous pixels.')
 sources[reference.sourceVariant]={width:source.width,height:source.height,sha256:sha(source.data),rgbaZlib:deflateSync(source.data).toString('base64'),license:'Project-authored procedural source; native source visible RGB and alpha verified.'}
 cases.push({name:reference.name,sourceVariant:reference.sourceVariant,width:reference.width,height:reference.height,corners:reference.corners,accepted:measurement.accepted,declineReason:measurement.declineReason,nativeRGBA_SHA256:sha(native.data),nativeRGBAZlib:deflateSync(native.data).toString('base64'),nativeBeforeRGBA_SHA256:sha(before.data),backgroundBeforeCrop:reference.backgroundBeforeCrop,history:reference.history,baselineRGBA_SHA256:measurement.baselineSHA,baselineRGBAZlib:measurement.accepted?undefined:deflateSync(actual.data).toString('base64'),baseline:measurement.baseline,candidate:measurement.candidate,sourceVerification:measurement.sourceVerification,productionWork:work.samples})
}
const fixture={version:1,photoshopVersion:metadata.photoshopVersion,referenceKind:'Photoshop post-freeze native axis Smoother independent cohort',referenceRole:'Independent for frozen research v3; disclosed regression for production implementation',frozenCandidateSHA256:validation.candidateSHA,nativeMetadataSHA256:sha(metadataBytes),independentValidationSHA256:sha(validationBytes),counts:validation.counts,limits:['Only full-source RGB8 strict two-axis enlargement with integer source center and proved alpha-color/bounds eligibility.','Odd/half-phase and textured internal A0 cases retain baseline exactly.','These native RGB8 outputs establish no general projective, minification, fractional crop, RGBA16/HDR, GUI or packaged gate.','Source/native hashes preserve provenance; baselineRGBA is archived only for rejected dispatch to verify byte-exact fallback.'],sources,cases}
await writeFile(fixturePath,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({fixturePath,sha256:sha(Buffer.from(JSON.stringify(fixture,null,2)+'\n')),counts:fixture.counts},null,2))
