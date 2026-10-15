import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {transformSync} from 'esbuild'
// Isolated serialization regression only. Native-window stand-ins below are not
// product focus acceptance; the real Electron smoke must still observe blur.
test('focus telemetry callback survives keepNames and runs in a context with no tsx __name helper',async()=>{
 const source=readFileSync('scripts/smoke-info-tools-alpha23.ts','utf8'),file=ts.createSourceFile('smoke.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 let call:ts.CallExpression|undefined
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='nativeFocus'&&node.initializer&&ts.isAwaitExpression(node.initializer)&&ts.isCallExpression(node.initializer.expression))call=node.initializer.expression;ts.forEachChild(node,visit)};visit(file)
 assert.ok(call);const wrapper=call.arguments[0],payload=call.arguments[1];assert.ok(ts.isArrowFunction(wrapper));assert.ok(ts.isObjectLiteralExpression(payload))
 const body=payload.properties.find(property=>ts.isPropertyAssignment(property)&&property.name.getText(file)==='body') as ts.PropertyAssignment
 assert.ok(body&&ts.isTaggedTemplateExpression(body.initializer));const literal=body.initializer
 assert.ok(ts.isNoSubstitutionTemplateLiteral(literal.template))
 // Compile the exact outer callback and literal payload using keepNames, then
 // serialize only the outer callback as Playwright's function path does. The
 // payload is a function BODY which explicitly invokes and returns its IIFE.
 const transformed=transformSync(`module.exports={callback:${wrapper.getText(file)},body:${literal.getText(file)}}`,{loader:'ts',format:'cjs',keepNames:true}).code,module={exports:{} as {callback:(...args:unknown[])=>unknown;body:string}}
 runInNewContext(transformed,{module});assert.equal(typeof module.exports.callback,'function');assert.equal(typeof module.exports.body,'string');assert.equal(module.exports.body.includes('__name('),false)
 const callback=runInNewContext(`(${module.exports.callback.toString()})`,{setTimeout:(resolve:()=>void)=>{resolve();return 1}})
 let mainFocused=true,probeFocused=false,minimized=false;const listeners=new Set<()=>void>(),lose=()=>{if(mainFocused){mainFocused=false;for(const handler of listeners)handler()}}
 const main={webContents:{getURL:()=> 'file://editor'},on:(_event:string,handler:()=>void)=>listeners.add(handler),removeListener:(_event:string,handler:()=>void)=>listeners.delete(handler),isFocused:()=>mainFocused,isMinimized:()=>minimized,minimize:()=>{minimized=true;lose()}}
 class Probe{async loadURL(_url:string){}show(){}focus(){probeFocused=true;lose()}isFocused(){return probeFocused}static getAllWindows(){return [main]}}
 const result=await callback({BrowserWindow:Probe,app:{focus(){}}},{body:module.exports.body,url:'file://editor'});assert.ok(result&&typeof result.mainFocused==='boolean','The exact function wrapper must invoke its body and return telemetry');assert.equal(result.blur,1);assert.equal(result.mainFocused,false);assert.equal(result.probeFocused,true);assert.equal(listeners.size,0)
})
