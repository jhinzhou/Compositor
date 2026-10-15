import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from '@vue/compiler-sfc'
import {computed,ref} from 'vue'
import ts from 'typescript'
import {transformSync} from 'esbuild'

test('actual rotated-frame boundary preview uses canonical clip placement and never mutates source state',()=>{
 const {descriptor}=parse(readFileSync('src/renderer/App.vue','utf8')),source=ts.createSourceFile('App.ts',descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 let initializer:ts.Expression|undefined
 for(const node of source.statements)if(ts.isVariableStatement(node))for(const declaration of node.declarationList.declarations)if(declaration.name.getText(source)==='displayState')initializer=declaration.initializer
 assert.ok(initializer)
 const code=transformSync(`const displayState=${initializer.getText(source)}`,{loader:'ts',format:'cjs'}).code
 const layer={id:'frame',frame:{kind:'ellipse',bounds:[7,4,6,10]},maskFile:'clip.png',maskPlacement:{origin:[5,6],size:[10,6],rotation:90,flipX:true,flipY:false,sampling:'Smooth'},transform:{origin:[0,0],size:[32,24],rotation:90,flipX:false,flipY:false,sampling:'High quality'}},input={sessionId:'session',revision:3,manifest:{width:24,height:32,layers:[layer]},assets:[{file:'clip.png',hash:'immutable',width:10,height:6}]},snapshot=structuredClone(input),state=ref(input)
 const environment={computed,state,tool:ref('frame'),frameCreateNew:ref(false),selected:ref(layer),frameContentDraft:ref(),frameDraft:ref({kind:'ellipse',bounds:[2,3,8,12]}),rpcValue:(value:unknown)=>JSON.parse(JSON.stringify(value))}
 const view=new Function(...Object.keys(environment),`${code};return displayState`)(...Object.values(environment)).value
 assert.deepEqual(view.manifest.layers[0].maskPlacement,{origin:[2,3],size:[8,12],rotation:0,flipX:false,flipY:false,sampling:'Smooth'})
 assert.deepEqual(view.manifest.layers[0].frame,{kind:'ellipse',bounds:[2,3,8,12]});assert.deepEqual(view.manifest.layers[0].transform,layer.transform);assert.deepEqual(view.assets,input.assets);assert.deepEqual(input,snapshot)
})
