import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {ref,shallowRef,toRaw} from 'vue'
import {appendSelectionShape} from '../src/shared/selection-composition'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {compactStroke} from '../src/shared/stroke-compaction'
import type {Selection} from '../src/shared/pixel-contracts'

/** Run the production App handler with real compaction, composition and coverage.
 * Only its reactive inputs are supplied here; the selection algorithm and guard
 * conditions are extracted from App.vue instead of copied into this test. */
function freehand(previous:Selection|null=null,operation:'replace'|'add'|'subtract'='replace'){
 const {descriptor}=parse(readFileSync('src/renderer/App.vue','utf8')),source=ts.createSourceFile('App.ts',descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const declaration=source.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text==='updateSelectionDraft');assert.ok(declaration,'Production selection draft handler must be available')
 const code=transformSync(declaration.getText(source),{loader:'ts',format:'cjs'}).code
 const rasterPoints=ref<[number,number][]>([]),state=shallowRef<{selection:Selection|null;manifest:{width:number;height:number}}|undefined>({selection:previous,manifest:{width:256,height:192}}),draftSelection=shallowRef<Selection>(),error=shallowRef<{message:string}>()
 const dependencies={drag:{mode:'raster:lasso',operation},rasterPoints,state,draftSelection,error,compactStroke,appendSelectionShape,toRaw,marqueeAxis:ref('area'),ellipseSelection:ref(false),feather:ref(0),selectionAA:ref(true),interactionProfile:ref('photoshop')}
 const update=new Function('dependencies',`const {${Object.keys(dependencies).join(',')}}=dependencies;${code};return updateSelectionDraft`)(dependencies) as ()=>void
 return {update,rasterPoints,state,draftSelection,error}
}
const rectangle=(bounds:[number,number,number,number]):Selection=>({inverted:false,antialiased:true,feather:0,canvasSize:[256,192],shapes:[{kind:'rectangle',operation:'replace',bounds,feather:0}]})

test('actual App closed freehand/Patch lasso selects the full interior when first and last points are identical',()=>{
 const a=freehand();a.rasterPoints.value=[[170,65],[210,65],[210,105],[170,105],[170,65]];a.update();assert.equal(a.error.value,undefined);assert.ok(a.draftSelection.value)
 assert.equal(selectionCoverage(a.draftSelection.value,190.5,85.5),1)
 assert.equal(selectionCoverage(a.draftSelection.value,169.5,85.5),0)
 assert.equal(selectionCoverage(a.draftSelection.value,210.5,85.5),0)
 assert.equal(selectionCoverage(a.draftSelection.value,190.5,105.5),0)
 assert.equal(a.state.value!.selection,null,'Preview must not write the persisted selection')
})

test('actual App freehand bounds retain concave geometry instead of clipping to its coincident endpoints',()=>{
 const a=freehand();a.rasterPoints.value=[[20,20],[80,20],[80,40],[40,40],[40,80],[20,80],[20,20]];a.update();assert.equal(a.error.value,undefined)
 assert.equal(selectionCoverage(a.draftSelection.value,30.5,70.5),1,'Vertical leg must remain selected')
 assert.equal(selectionCoverage(a.draftSelection.value,70.5,30.5),1,'Horizontal leg must remain selected')
 assert.equal(selectionCoverage(a.draftSelection.value,70.5,70.5),0,'Concave cut-out must not turn into a bounding rectangle')
 assert.equal(selectionCoverage(a.draftSelection.value,90.5,30.5),0)
})

test('actual App first/two freehand points never publish a polygon with missing points or change the previous selection',()=>{
 const previous=rectangle([10,10,20,20]),frozen=structuredClone(previous),a=freehand(previous)
 for(const points of [[[50,50]],[[50,50],[70,50]]] as [number,number][][]){a.rasterPoints.value=points;a.update();assert.equal(a.draftSelection.value,undefined);assert.equal(a.error.value,undefined);assert.deepEqual(a.state.value!.selection,frozen);assert.equal(selectionCoverage(a.state.value!.selection,20.5,20.5),1)}
 a.rasterPoints.value.push([70,70]);a.update();assert.ok(a.draftSelection.value);assert.equal(a.error.value,undefined);assert.deepEqual(a.state.value!.selection,frozen)
})

test('actual App Shift-add composition keeps the preceding selection and fills only the additional freehand interior',()=>{
 const previous=rectangle([10,10,20,20]),frozen=structuredClone(previous),a=freehand(previous,'add')
 a.rasterPoints.value=[[50,50],[70,50],[70,70],[50,70],[50,50]];a.update();assert.equal(a.error.value,undefined)
 assert.equal(selectionCoverage(a.draftSelection.value,20.5,20.5),1)
 assert.equal(selectionCoverage(a.draftSelection.value,60.5,60.5),1)
 assert.equal(selectionCoverage(a.draftSelection.value,40.5,40.5),0)
 assert.deepEqual(a.state.value!.selection,frozen)
})

test('actual App Alt-subtract composition removes the freehand interior while retaining selected surrounding pixels',()=>{
 const previous=rectangle([10,10,80,80]),frozen=structuredClone(previous),a=freehand(previous,'subtract')
 a.rasterPoints.value=[[30,30],[50,30],[50,50],[30,50],[30,30]];a.update();assert.equal(a.error.value,undefined)
 assert.equal(selectionCoverage(a.draftSelection.value,40.5,40.5),0)
 assert.equal(selectionCoverage(a.draftSelection.value,20.5,40.5),1)
 assert.equal(selectionCoverage(a.draftSelection.value,70.5,70.5),1)
 assert.equal(selectionCoverage(a.draftSelection.value,100.5,40.5),0)
 assert.deepEqual(a.state.value!.selection,frozen)
})
