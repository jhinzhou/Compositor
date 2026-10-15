import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {parse} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import ts from 'typescript'
import {ref} from 'vue'
import {actionSchema} from '../src/shared/contracts'
import {compactStroke} from '../src/shared/stroke-compaction'
import {toolGroup,toolGroupForTool,selectedToolGroupEntry,displayedToolGroupEntry} from '../src/renderer/tool-groups'
import {editorToolIcon} from '../src/renderer/editor-tool-icons'
import {profileCommands} from '../src/renderer/interaction-profile'
const descriptor=parse(readFileSync('src/renderer/App.vue','utf8')).descriptor,source=ts.createSourceFile('App.ts',descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
function actualFunction(name:string,deps:Record<string,unknown>):(...args:any[])=>any{
 const declaration=source.statements.find(v=>ts.isFunctionDeclaration(v)&&v.name?.text===name);assert.ok(declaration,`Missing actual App function ${name}`)
 const code=transformSync(declaration.getText(source),{loader:'ts',format:'cjs'}).code
 return new Function(...Object.keys(deps),`${code};return ${name}`)(...Object.values(deps))
}
test('E group has three distinct implemented icons and remembers its outer tool while B remains separate',()=>{
 const group=toolGroup('E');assert.deepEqual(group.entries.map(e=>e.tool),['eraser','background-eraser','magic-eraser']);const remembered=group.entries[2]
 assert.equal(toolGroupForTool('brush')?.id,'B');assert.equal(toolGroupForTool('magic-eraser')?.id,'E')
 assert.equal(displayedToolGroupEntry('E',{tool:'brush'},remembered).id,'magic-eraser');assert.equal(displayedToolGroupEntry('E',{tool:'eraser'},remembered).id,'eraser')
 const icons=group.entries.map(e=>editorToolIcon(e.tool,e.id));assert.ok(icons.every(Boolean));assert.equal(new Set(icons.map(i=>i!.key)).size,3);assert.equal(new Set(icons.map(i=>JSON.stringify(i!.strokes))).size,3)
 assert.equal(displayedToolGroupEntry('E',{tool:'brush'},{id:'removed'}).id,'eraser')
})
test('Actual App Shift E cycles all three modes, B cycles Brush and Pencil, and busy/held interaction blocks cycling',async()=>{
 const tool=ref('brush'),busy=ref(false),chosen:string[]=[],modeRefs={ellipseSelection:ref(false),lassoMode:ref('freehand'),cropMode:ref('crop'),marqueeAxis:ref('area'),retouchMode:ref('spot-heal')}
 const deps={tool,busy,...modeRefs,toolGroup,selectedToolGroupEntry,chooseToolGroupEntry:async(e:{id:string;tool:string})=>{chosen.push(e.id);tool.value=e.tool},chooseTool:async(t:string)=>{chosen.push(t);tool.value=t},cycleShapeKind:async()=>{}}
 const cycle=actualFunction('cyclePhotoshopGroup',{...deps,drag:undefined});for(let i=0;i<4;i++)await cycle('e');assert.deepEqual(chosen,['eraser','background-eraser','magic-eraser','eraser'])
 await cycle('b');assert.equal(tool.value,'brush');await cycle('b');assert.equal(tool.value,'pencil');busy.value=true;const count=chosen.length;await cycle('e');assert.equal(chosen.length,count);busy.value=false
 await actualFunction('cyclePhotoshopGroup',{...deps,drag:{mode:'raster'}})('e');assert.equal(chosen.length,count)
 const commands=profileCommands([{id:'tool:brush',title:'Brush',shortcut:'b'},{id:'tool:eraser',title:'Eraser',shortcut:'e'},{id:'cycle-group:e',title:'Cycle E'},{id:'tool:rotate-view',title:'Rotate View'}],'photoshop')
 assert.deepEqual(commands.map(c=>c.shortcut),['b','e','Shift+e','r'])
})
test('Actual UI background erase producer converts percent tolerance/color once, fixes native strength and excludes unsupported Flow/Mask/All-Layers',()=>{
 const deps={rasterPoints:ref([[4,5],[15,16]]),brushSize:ref(24),hardness:ref(.6),paintOpacity:ref(.35),backgroundEraseTolerance:ref(50),backgroundEraseSampling:ref('once'),backgroundEraseLimits:ref('discontiguous'),backgroundEraseProtectForeground:ref(true),foreground:ref('#c86432'),background:ref('#147d28'),interactionProfile:ref('photoshop'),smoothing:ref(4),zoom:ref(.5),compactStroke, color:actualFunction('color',{}),magicEraseTolerance:ref(32),magicEraseContiguous:ref(true),magicEraseAA:ref(true),magicEraseAllLayers:ref(false)}
 const producer=actualFunction('eraserAction',deps),layerId=randomUUID(),action=actionSchema.parse(producer('background-eraser',layerId))
 assert.equal(action.type,'layer.background_erase');if(action.type!=='layer.background_erase')return
 assert.equal(action.tolerance,127.5);assert.equal(action.opacity,1,'Background Eraser UI follows native fixed-strength behavior independently of previous brush opacity');assert.equal(action.hardness,.6);assert.equal(action.smoothing,8);assert.equal(action.sampling,'once');assert.equal(action.limits,'discontiguous');assert.equal(action.protectForeground,true);assert.equal(action.sampleAllLayers,false);assert.deepEqual(action.foreground,[200/255,100/255,50/255,1]);assert.deepEqual(action.background,[20/255,125/255,40/255,1]);assert.equal('flow' in action,false);assert.equal('target' in action,false)
 deps.rasterPoints.value[0][0]=99;assert.equal(action.points[0][0],4,'Captured action must not alias live pointer data')
 assert.equal(actionSchema.safeParse({...action,limits:'find-edges'}).success,false);assert.equal(actionSchema.safeParse({...action,sampleAllLayers:true}).success,false)
})
test('Actual UI magic erase producer uses first clicked point and own selection parameters; captured action does not alias live point',()=>{
 const points=ref([[17,23],[40,56]]),deps={rasterPoints:points,magicEraseTolerance:ref(42),magicEraseContiguous:ref(false),magicEraseAA:ref(false),paintOpacity:ref(.4),magicEraseAllLayers:ref(true)},producer=actualFunction('eraserAction',deps),action=actionSchema.parse(producer('magic-eraser',randomUUID()))
 assert.equal(action.type,'layer.magic_erase');if(action.type!=='layer.magic_erase')return
 assert.deepEqual(action.point,[17,23]);assert.equal(action.tolerance,42);assert.equal(action.contiguous,false);assert.equal(action.antialiased,false);assert.equal(action.opacity,.4);assert.equal(action.sampleAllLayers,true);assert.equal(action.target,'image');points.value[0][0]=99;assert.equal(action.point[0],17);assert.equal('flow'in action,false);assert.equal('size'in action,false)
})
test('Background Eraser ignores opacity digits rather than editing layer opacity or hidden Brush strength',()=>{
 const paintOpacity=ref(.35),handler=actualFunction('setOpacityDigit',{tool:ref('background-eraser'),paintOpacity,opacityDigit:()=>{throw Error('Native Background Eraser has no opacity digit control')},edit:()=>{throw Error('Opacity digits must not accidentally edit its layer')}})
 handler(0);handler(5);assert.equal(paintOpacity.value,.35)
})
