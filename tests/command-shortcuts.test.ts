import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import ts from 'typescript'
import {commandForKey,eventChord,loadShortcuts,normalizeChord,normalizePlatformChord,saveShortcuts,shortcutFor,shortcutProblem,SHORTCUT_STORAGE_KEY,type WorkspaceCommand} from '../src/renderer/command-shortcuts'
import {profileCommands} from '../src/renderer/interaction-profile'
import {TEXT_EDIT_COMMANDS} from '../src/renderer/text-edit-commands'
import {FILTER_NAMES,NATIVE_ADJUSTMENT_KINDS} from '../src/shared/image-filters'

const event = (key:string,changes:Record<string,unknown>={}) => ({key,metaKey:false,ctrlKey:false,altKey:false,shiftKey:false,...changes})
function storage(initial:unknown={}) {
 const values=new Map([[SHORTCUT_STORAGE_KEY,JSON.stringify(initial)]])
 return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}
}
const commands:WorkspaceCommand[]=[{id:'undo',title:'Undo',shortcut:'Primary+z'},{id:'save',title:'Save',shortcut:'Primary+s'},{id:'brush',title:'Brush',shortcut:'b'},{id:'proof',title:'Proof Colors'},{id:'gamut',title:'Gamut Warning'},{id:'text:tracking',title:'Tracking',shortcut:'Alt+arrowright'}]

test('loading isolates invalid, removed and reserved entries without erasing valid custom keys and clears',()=>{
 const persisted=storage({undo:'Cmd+y',brush:'',save:'Primary+q',gone:'x','text:tracking':'Shift+k',proof:'Primary+Alt+p',gamut:'bad+key'})
 assert.deepEqual(loadShortcuts(persisted,commands,'mac'),{brush:'',proof:'Primary+Alt+p',undo:'Primary+y'})
 assert.equal(persisted.values.get(SHORTCUT_STORAGE_KEY),JSON.stringify({undo:'Cmd+y',brush:'',save:'Primary+q',gone:'x','text:tracking':'Shift+k',proof:'Primary+Alt+p',gamut:'bad+key'}),'Read does not mutate original storage')
})
test('custom duplicate resolution is stable regardless of saved JSON insertion order',()=>{
 const first=loadShortcuts(storage({proof:'Primary+p',gamut:'Cmd+p',undo:'Primary+y'}),commands,'mac')
 const second=loadShortcuts(storage({undo:'Primary+y',gamut:'Cmd+p',proof:'Primary+p'}),commands,'mac')
 assert.deepEqual(first,second);assert.deepEqual(first,{gamut:'Primary+p',undo:'Primary+y'})
 assert.equal(shortcutProblem(commands,first,'mac'),undefined)
})
test('loading preserves valid simultaneous swaps even beside an invalid entry and a cleared default frees its key',()=>{
 assert.deepEqual(loadShortcuts(storage({save:'Primary+z',undo:'Primary+s',proof:'Primary+q'}),commands,'mac'),{save:'Primary+z',undo:'Primary+s'})
 const loaded=loadShortcuts(storage({undo:'',proof:'Primary+z'}),commands,'mac')
 assert.deepEqual(loaded,{proof:'Primary+z',undo:''});assert.equal(commandForKey(commands,loaded,event('z',{metaKey:true}),'mac')?.id,'proof')
 assert.equal(commandForKey(commands,loaded,event('z',{ctrlKey:true}),'other')?.id,'proof')
})
test('loading prunes dependencies of rejected overrides while retaining unrelated keys',()=>{
 const loaded=loadShortcuts(storage({undo:'Primary+s',save:'Primary+q',proof:'Primary+y',brush:''}),commands,'mac')
 assert.deepEqual(loaded,{brush:'',proof:'Primary+y'});assert.equal(shortcutProblem(commands,loaded,'mac'),undefined)
})
test('platform aliases match actual key events, detect duplicate modifiers and collide with Primary',()=>{
 assert.equal(normalizePlatformChord('Command+Shift+S','mac'),'Primary+Shift+s')
 assert.equal(normalizePlatformChord('Control+Shift+S','other'),'Primary+Shift+s')
 assert.equal(normalizePlatformChord('Primary+Meta+s','mac'),undefined)
 assert.equal(normalizePlatformChord('Primary+Ctrl+s','other'),undefined)
 assert.equal(normalizePlatformChord('Primary+Ctrl+f','mac'),'Primary+Ctrl+f')
 assert.equal(commandForKey(commands,{save:'Meta+s'},event('s',{metaKey:true}),'mac')?.id,'save')
 assert.equal(commandForKey(commands,{save:'Ctrl+s'},event('s',{ctrlKey:true}),'other')?.id,'save')
 assert.match(shortcutProblem(commands,{proof:'Meta+s'},'mac')!,/same shortcut/)
 assert.match(shortcutProblem(commands,{proof:'Ctrl+s'},'other')!,/same shortcut/)
})
test('platform reserved keys and text typing cannot be assigned but text escape remains contextual',()=>{
 for(const chord of ['Cmd+q','Cmd+,','Cmd+Option+m'])assert.match(shortcutProblem(commands,{proof:chord},'mac')!,/reserved/)
 assert.match(shortcutProblem(commands,{proof:'Alt+f4'},'other')!,/reserved/)
 assert.match(shortcutProblem(commands,{'text:tracking':'Shift+b'},'mac')!,/Invalid/)
 assert.equal(shortcutProblem(commands,{'text:tracking':'Ctrl+b'},'mac'),undefined)
 assert.equal(shortcutProblem([{id:'cancel-draft',title:'Cancel Text Edit',category:'Text',shortcut:'escape'}],{},'mac'),undefined)
 for(const key of ['\u0000','\u007f','\u200b','\t'])assert.equal(normalizeChord(key),undefined)
})
test('Shift punctuation and macOS Option composition resolve the underlying shortcut without accepting dead/IME events',()=>{
 for(const [key,base] of Object.entries({':':';','"':"'",'?':'/','~':'`','<':',','>':'.'}))assert.equal(eventChord(event(key,{shiftKey:true}),'mac'),`Shift+${base}`)
 assert.equal(eventChord(event('∫',{altKey:true,code:'KeyB'}),'mac'),'Alt+b')
 assert.equal(eventChord(event('“',{altKey:true,metaKey:true,code:'BracketLeft'}),'mac'),'Primary+Alt+[')
 assert.equal(eventChord(event('Dead',{altKey:true,code:'KeyE'}),'mac'),undefined)
 assert.equal(eventChord(event('b',{isComposing:true,code:'KeyB'}),'mac'),undefined)
 assert.equal(eventChord(event('',{code:'KeyB'}),'mac'),undefined)
})
test('save is atomic on conflict, preserves explicit clears on reopen, and strips stale IDs',()=>{
 const persisted=storage({undo:'Primary+y'}),before=persisted.values.get(SHORTCUT_STORAGE_KEY)
 assert.throws(()=>saveShortcuts(persisted,commands,{save:'Primary+z'},'mac'),/same shortcut/)
 assert.equal(persisted.values.get(SHORTCUT_STORAGE_KEY),before)
 saveShortcuts(persisted,commands,{undo:'',proof:'Cmd+z',gone:'x'},'mac')
 const reopened=loadShortcuts(persisted,commands,'mac')
 assert.deepEqual(reopened,{proof:'Primary+z',undo:''});assert.equal(shortcutFor(commands[0],reopened,'mac'),undefined)
})
test('Photoshop additions are conflict-free on both platforms and do not create commands or alter compositor defaults',()=>{
 const additions:Record<string,string>={reselect:'Primary+Shift+d',grid:"Primary+'",guides:'Primary+;','filter:hsl':'Primary+u','filter:colorBalance':'Primary+b','filter:blackWhite':'Primary+Alt+Shift+b'}
 const raw=Object.keys(additions).map(id=>({id,title:id}))
 for(const platform of ['mac','other'] as const){const profile=profileCommands(raw,'photoshop',{},platform);assert.equal(shortcutProblem(profile,{},platform),undefined);for(const command of profile)assert.equal(command.shortcut,additions[command.id])}
 assert.deepEqual(profileCommands(raw,'compositor'),raw.map(command=>({...command,shortcut:undefined})))
 assert.deepEqual(profileCommands([],'photoshop'),[])
 const ps=profileCommands([...raw,{id:'custom',title:'Custom'}],'photoshop',{custom:'Meta+u'},'mac')
 assert.equal(ps.find(command=>command.id==='filter:hsl')?.shortcut,'');assert.equal(shortcutProblem(ps,{custom:'Meta+u'},'mac'),undefined)
 assert.equal(commandForKey(ps,{custom:'Meta+u'},event('u',{metaKey:true}),'mac')?.id,'custom')
 const defaults=profileCommands(raw,'photoshop',{},'mac')
 assert.equal(commandForKey(defaults,{},event('"',{metaKey:true,shiftKey:true}),'mac'),undefined)
 assert.equal(commandForKey(defaults,{},event(';',{metaKey:true}),'mac')?.id,'guides')
})

test('actual renderer catalog has unique command IDs and conflict-free defaults in both profiles/platforms',()=>{
 const {descriptor}=parse(readFileSync('src/renderer/App.vue','utf8')),source=ts.createSourceFile('App.ts',descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const declarations=source.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations])
 const raw=declarations.find(declaration=>declaration.name.getText(source)==='rawCommands')!.initializer!
 assert.ok(ts.isCallExpression(raw));const create=raw.arguments[0];assert.ok(ts.isArrowFunction(create))
 const tools=declarations.find(declaration=>declaration.name.getText(source)==='canvasTools')!.initializer!;assert.ok(ts.isArrayLiteralExpression(tools))
 const canvasTools=tools.elements.map(element=>{assert.ok(ts.isObjectLiteralExpression(element));return Object.fromEntries(element.properties.filter(ts.isPropertyAssignment).filter(property=>['name','mode'].includes(property.name.getText(source))).map(property=>{assert.ok(ts.isStringLiteral(property.initializer));return [property.name.getText(source),property.initializer.text]}))})
 const refs=new Set<string>();const visit=(node:ts.Node)=>{if(ts.isPropertyAccessExpression(node)&&node.name.text==='value'&&ts.isIdentifier(node.expression))refs.add(node.expression.text);ts.forEachChild(node,visit)};visit(create)
 const env:Record<string,unknown>=Object.fromEntries([...refs].map(name=>[name,{value:undefined}]))
 Object.assign(env,{TEXT_EDIT_COMMANDS,FILTER_NAMES,NATIVE_ADJUSTMENT_KINDS,canvasTools,selectedIds:{value:[]},showNew:{value:false}})
 const code=transformSync(`const getCommands=${create.getText(source)}`,{loader:'ts',format:'cjs'}).code
 const actual:WorkspaceCommand[]=new Function(...Object.keys(env),`${code};return getCommands()`)(...Object.values(env))
 assert.equal(new Set(actual.map(command=>command.id)).size,actual.length)
 for(const profile of ['photoshop','compositor'] as const)for(const platform of ['mac','other'] as const)assert.equal(shortcutProblem(profileCommands(actual,profile,{},platform),{},platform),undefined,`${profile}/${platform} defaults conflict`)
})
