import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {photoshopPerspectiveCropSize,type CropCorners} from '../src/shared/crop-projective'
test('six recorded alpha27 native automatic sizes now match the REA edge-ratio model',()=>{
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/parity/photoshop-27.11-perspective-size-validation-alpha27.json',import.meta.url),'utf8'));assert.equal(fixture.cases.length,6);let error=0,exact=0
 for(const reference of fixture.cases){assert.equal(reference.geometryVerified,true);const result=photoshopPerspectiveCropSize(reference.corners as CropCorners,reference.sourceWidth,reference.sourceHeight),dx=Math.abs(result.width-reference.width),dy=Math.abs(result.height-reference.height);error+=dx+dy;if(!dx&&!dy)exact++;assert.ok(dx<=2);assert.ok(dy<=1)}
 assert.equal(exact,6);assert.equal(error,0,'Size-only regression; this does not test resampling pixels')
})
