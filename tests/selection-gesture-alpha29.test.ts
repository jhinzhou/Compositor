import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import {transformSync} from 'esbuild'
import {ref,toRaw} from 'vue'
import {appendSelectionShape} from '../src/shared/selection-composition'
import {selectionCoverage} from '../src/shared/selection-coverage'
import {compactStroke} from '../src/shared/stroke-compaction'
import {rpcValue} from '../src/renderer/rpc-value'
import {useMagneticLasso} from '../src/renderer/use-magnetic-lasso'
import type {Selection} from '../src/shared/pixel-contracts'

const source=ts.createSourceFile('App.ts',parse(readFileSync('src/renderer/App.vue','utf8')).descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
function production(name:string):string{const fn=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name);assert.ok(fn,`Missing App handler ${name}`);return transformSync(fn.getText(source),{loader:'ts',format:'cjs'}).code}
const previous:Selection={inverted:false,antialiased:false,feather:0,canvasSize:[100,80],shapes:[{kind:'rectangle',operation:'replace',bounds:[10,10,30,30],feather:0}]}
function setup(tool='marquee',lassoMode='freehand'){
 const calls:{method:string;params:any}[]=[],selected=ref<any>({id:'layer',imageFile:'source.png'}),state=ref<any>({sessionId:'session',revision:0,selection:structuredClone(previous),manifest:{width:100,height:80,documentID:'document'}})
 const deps:any={tool:ref(tool),lassoMode:ref(lassoMode),state,selected,selectedId:ref('layer'),selectionOperation:ref('replace'),polygonOperation:ref('replace'),polygonPoints:ref([]),polygonRequest:ref(),polygonReady:ref(),rasterPoints:ref([]),rasterPressures:ref(),draftSelection:ref(),marqueeAxis:ref('area'),ellipseSelection:ref(false),selectionAA:ref(false),feather:ref(0),interactionProfile:ref('photoshop'),error:ref(),maskTarget:ref(false),quickMask:ref(false),busy:ref(false),spacePan:ref(false),zoom:ref(1),brushSize:ref(10),pressureSize:ref(false),pressureOpacity:ref(false),lastBrush:ref(),lastQuickMaskBrush:ref(),selectionBrushMode:ref('add'),quickOperation:ref('replace'),wandTolerance:ref(32),wandContiguous:ref(true),wandAllLayers:ref(false),wandSampleSize:ref('point'),infoTools:{active:ref(false)},pointerFinish:{active:false},switchingTool:false,document:{activeElement:null},HTMLInputElement:class {},identity:()=>({sessionId:'session',documentId:'document',expectedRevision:0,idempotencyKey:'gesture'}),documentPoint:(e:any)=>[e.clientX,e.clientY],request:async(method:string,params:any)=>{calls.push({method,params});return true},edit:(action:any)=>calls.push({method:'apply',params:{action}}),brushPointerPressure:()=>undefined,appendSelectionShape,selectionCoverage,compactStroke,toRaw,rpcValue,scheduleStrokePreview:()=>{}}
 for(const key of ['contentMoveDraft','contentMoveFinishing','rasterizePending','toolFlyout','showColorRange','showDistort','paletteTarget','canvas','viewportPlan','contextLayer'])deps[key]=ref()
 deps.viewport=ref({})
 const handlers=new Function(...Object.keys(deps),`let drag; ${production('selectionPointerOperation')} ${production('updateSelectionDraft')} ${production('pointerDown')} ${production('finishPolygon')} return {pointerDown,finishPolygon,updateSelectionDraft,drag:()=>drag}`)(...Object.values(deps))
 function click(x:number,y:number,modifiers:any={}){return {button:0,detail:1,clientX:x,clientY:y,pointerId:1,shiftKey:false,altKey:false,metaKey:false,ctrlKey:false,currentTarget:{setPointerCapture:()=>{},hasPointerCapture:()=>false},preventDefault:()=>{},...modifiers}}
 return {deps,handlers,calls,click}
}
test('actual Wand pointer route sends Shift+Option intersection and respects a selected panel mode',()=>{
 const a=setup('magic');a.handlers.pointerDown(a.click(25,25,{shiftKey:true,altKey:true}));assert.equal(a.calls[0].params.action.operation,'intersect')
 a.deps.selectionOperation.value='subtract';a.handlers.pointerDown(a.click(25,25));assert.equal(a.calls[1].params.action.operation,'subtract')
})
test('actual marquee and freehand routes freeze Shift+Option intersection with production selection composition',()=>{
 for(const tool of ['marquee','lasso']){const a=setup(tool);a.handlers.pointerDown(a.click(25,25,{shiftKey:true,altKey:true}));assert.equal(a.handlers.drag().operation,'intersect');a.deps.rasterPoints.value=tool==='marquee'?[[25,25],[60,60]]:[[25,25],[60,25],[60,60],[25,60]];a.handlers.updateSelectionDraft();assert.equal(selectionCoverage(a.deps.draftSelection.value,30.5,30.5),1);assert.equal(selectionCoverage(a.deps.draftSelection.value,15.5,15.5),0);assert.equal(selectionCoverage(a.deps.draftSelection.value,50.5,50.5),0);assert.deepEqual(toRaw(a.deps.state.value.selection),previous)}
})
test('actual Polygonal Lasso captures the first-click operation and releases its one lease at commit or cancellation',async()=>{
 const a=setup('lasso','polygon');a.handlers.pointerDown(a.click(25,25,{shiftKey:true,altKey:true}));a.deps.selectionOperation.value='add';a.handlers.pointerDown(a.click(60,25));a.handlers.pointerDown(a.click(60,60));a.handlers.pointerDown(a.click(25,60));await a.handlers.finishPolygon();const applied=a.calls.find(c=>c.method==='apply')!.params.action.selection;assert.equal(selectionCoverage(applied,30.5,30.5),1);assert.equal(selectionCoverage(applied,15.5,15.5),0);assert.equal(selectionCoverage(applied,50.5,50.5),0);assert.deepEqual(a.calls.filter(c=>c.method==='interaction').map(c=>c.params.busy),[true,false]);assert.equal(a.deps.polygonRequest.value,undefined);assert.equal(a.deps.polygonOperation.value,'replace')
 const b=setup('lasso','polygon');b.handlers.pointerDown(b.click(25,25,{altKey:true}));await b.handlers.finishPolygon(true);assert.equal(b.calls.some(c=>c.method==='apply'),false);assert.deepEqual(b.calls.filter(c=>c.method==='interaction').map(c=>c.params.busy),[true,false]);assert.equal(b.deps.polygonOperation.value,'replace')
})
test('Magnetic Lasso respects panel operation, captures it once, and lets modifiers override it',async()=>{
 for(const modifiers of [{},{shiftKey:true,altKey:true}]){const mode=ref<'replace'|'add'|'subtract'|'intersect'>('subtract'),commits:string[]=[],state=ref<any>({sessionId:'session',revision:0,manifest:{width:100,height:80,documentID:'document'}});const gesture=useMagneticLasso({state,selectedId:ref('layer'),options:()=>({width:24,contrast:.1,frequency:20,sampleAllLayers:false}),operation:()=>mode.value,canStart:()=>true,point:e=>[e.clientX,e.clientY],identity:()=>({sessionId:'session',documentId:'document',expectedRevision:0,idempotencyKey:'gesture'}),send:async<T>(method:string,params:any)=>method==='interaction'?{busy:params.busy} as T:{points:[[25,25],[60,25],[60,60],[25,60],[25,25]]} as T,commit:async(_id,_points,operation)=>{commits.push(operation)}});await gesture.start({button:0,detail:1,clientX:25,clientY:25,shiftKey:false,altKey:false,...modifiers} as MouseEvent);mode.value='add';await gesture.start({button:0,detail:1,clientX:60,clientY:60} as MouseEvent);await gesture.finish();assert.deepEqual(commits,[modifiers.shiftKey?'intersect':'subtract']);gesture.dispose()}
})
