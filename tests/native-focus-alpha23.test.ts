import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import {transformSync} from 'esbuild'
test('real App native-focus action cancels canvas, magnetic and info leases before command enablement checks',()=>{
 const filename='src/renderer/App.vue',{descriptor}=parse(readFileSync(filename,'utf8'))
 const source=ts.createSourceFile(filename,descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='action');assert.ok(node)
 const calls:string[]=[],code=transformSync(node.getText(source),{loader:'ts',format:'cjs'}).code
 const action=new Function('loseWindowFocus','magnetic','infoTools',`${code};return action`)(()=>calls.push('canvas'),{finish:(cancel:boolean)=>calls.push('magnetic:'+cancel)},{cancel:()=>calls.push('info')})
 // Other command/UI bindings are deliberately absent: native focus handling
 // must run even while disabled tools or a held pointer would block commands.
 action('windowFocusLost');assert.deepEqual(calls,['canvas','magnetic:true','info'])
})
