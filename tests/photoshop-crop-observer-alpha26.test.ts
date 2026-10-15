import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Script,createContext} from 'node:vm'
const script=(name:string)=>readFileSync(new URL(`../scripts/native-reference/photoshop-crop-events-alpha26${name}.jsx`,import.meta.url),'utf8').replace(/^#target[^\n]*\n/,'')
const owned='/Users/zhoujin/Documents/PS/Compositor_Electron/scripts/native-reference/photoshop-crop-events-alpha26.jsx'
const state='/Users/zhoujin/Documents/PS/Compositor_Electron/artifacts/photoshop-native/outputs/crop-events-alpha26/observer-state.txt'
function environment(enabled:boolean){
 const files=new Map<string,string>(),folders=new Set<string>()
 class File {fsName:string;encoding='';mode='';constructor(path:string){this.fsName=path}get exists(){return files.has(this.fsName)}open(mode:string){this.mode=mode;if(mode==='w')files.set(this.fsName,'');return mode==='w'||this.exists}write(text:string){files.set(this.fsName,(files.get(this.fsName)??'')+text)}read(){return files.get(this.fsName)??''}close(){}remove(){return files.delete(this.fsName)}}
 class Folder {fsName:string;constructor(path:string){this.fsName=path}get exists(){return folders.has(this.fsName)}create(){folders.add(this.fsName);return true}}
 const notifiers:any[]=[];Object.assign(notifiers,{add(event:string,file:File){const notifier={event,eventFile:file,remove(){notifiers.splice(notifiers.indexOf(notifier),1)}};notifiers.push(notifier);return notifier}})
 ;(notifiers as any).add('Crop',new File('/user/custom-crop-handler.jsx'));(notifiers as any).add('Trnf',new File(owned+'.user'))
 const app:any={notifiersEnabled:enabled,notifiers,documents:[{}],version:'27.11.0',activeDocument:{name:'owned.png',activeLayer:{name:'alpha26-tools-owned'},width:{as:()=>202},height:{as:()=>135},activeHistoryState:{name:'Perspective Crop'}}}
 const context=createContext({app,File,Folder,arguments:[],typeIDToStringID:(id:any)=>String(id),typeIDToCharID:(id:any)=>String(id),DescValueType:{BOOLEANTYPE:'bool',INTEGERTYPE:'int',LARGEINTEGERTYPE:'large',DOUBLETYPE:'double',STRINGTYPE:'string',ENUMERATEDTYPE:'enum',UNITDOUBLE:'unit',CLASSTYPE:'class',OBJECTTYPE:'object',LISTTYPE:'list',ALIASTYPE:'alias',RAWTYPE:'raw',REFERENCETYPE:'reference'}})
 return {files,app,context,run(name:string){new Script(script(name)).runInContext(context)}}
}
for(const enabled of [false,true])test(`actual scoped observer installer/remover retain user notifiers and restore initial enabled=${enabled}`,()=>{
 const env=environment(enabled),userEntries=[...env.app.notifiers];env.run('-install');assert.equal(env.app.notifiersEnabled,true);assert.equal(env.app.notifiers.length,5);assert.equal(env.files.get(state),String(enabled));env.run('-install');assert.equal(env.app.notifiers.length,5);assert.equal(env.files.get(state),String(enabled));env.run('-remove');assert.equal(env.app.notifiersEnabled,enabled);assert.deepEqual([...env.app.notifiers],userEntries);assert.equal(env.files.has(state),false);env.run('-remove');assert.equal(env.app.notifiersEnabled,enabled);assert.deepEqual([...env.app.notifiers],userEntries)
})
test('actual owned Crop observer records native geometry units and omits alias/raw/reference data',()=>{
 const env=environment(false),keys=['width','height','sourceFile','privateRaw','targetReference'],types=['unit','int','alias','raw','reference'],descriptor={count:keys.length,getKey:(i:number)=>keys[i],getType:(key:string)=>types[keys.indexOf(key)],getUnitDoubleType:()=> 'pixelsUnit',getUnitDoubleValue:()=>201.25,getInteger:()=>135,getPath(){throw Error('Alias must not be read')},getData(){throw Error('Raw must not be read')},getReference(){throw Error('Reference must not be read')}}
 ;(env.context as any).arguments=[descriptor,'crop'];env.run('');const output=[...env.files.entries()].find(([path])=>/crop-event-\d+\.json$/.test(path));assert.ok(output);const record=JSON.parse(output[1]);assert.deepEqual(record.descriptor.width,{unit:'pixelsUnit',value:201.25});assert.equal(record.descriptor.height,135);assert.deepEqual(record.descriptor.sourceFile,{omitted:'alias'});assert.deepEqual(record.descriptor.privateRaw,{omitted:'raw'});assert.deepEqual(record.descriptor.targetReference,{omitted:'reference'});assert.equal(record.event,'crop');assert.equal(record.width,202)
})
test('actual observer ignores unrelated user documents and does not install or change notifiers',()=>{
 const env=environment(false);env.app.activeDocument.activeLayer.name='User layer';(env.context as any).arguments=[{count:0},'crop'];env.run('');assert.equal(env.files.size,0);assert.equal(env.app.notifiers.length,2);assert.equal(env.app.notifiersEnabled,false)
})
