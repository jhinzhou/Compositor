import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Script,createContext} from 'node:vm'

const candidate=(centered=false)=>readFileSync(new URL(`../scripts/native-reference/photoshop-perspective-size-alpha26-actionmanager${centered?'-centered':''}.jsx`,import.meta.url),'utf8').replace(/^#target[^\n]*\n/,'')
function experiment(failAt=Infinity,centered=false){
 const files=new Map<string,string>(),actions:any[]=[],opened:any[]=[],closed:any[]=[],initial={name:'User document',activeLayer:{name:'Do not edit'}}
 class File {fsName:string;encoding='';constructor(path:string){this.fsName=path}get exists(){return true}open(){files.set(this.fsName,'');return true}write(text:string){files.set(this.fsName,text)}close(){}}
 class Folder {fsName:string;constructor(path:string){this.fsName=path}get exists(){return true}create(){return true}}
 class ActionDescriptor {values:Record<string,unknown>={};putUnitDouble(key:string,unit:string,value:number){this.values[key]={unit,value}}putObject(key:string,type:string,value:ActionDescriptor){this.values[key]={type,value:value.values}}}
 const app:any={version:'27.11',documents:[initial],activeDocument:initial,displayDialogs:'original',open(file:File){const document={name:file.fsName,activeLayer:{name:'Background'},selection:{deselect(){}},width:{as:()=>512},height:{as:()=>320},activeHistoryState:{name:'Perspective Crop'},saveAs(){},close(){closed.push(document)}};opened.push(document);app.activeDocument=document;return document}}
 const context=createContext({app,File,Folder,ActionDescriptor,PNGSaveOptions:class{},DialogModes:{NO:'none'},SaveOptions:{DONOTSAVECHANGES:'discard'},Extension:{LOWERCASE:'lower'},stringIDToTypeID:(s:string)=>s,executeAction(event:string,descriptor:ActionDescriptor){actions.push({event,values:descriptor.values});if(actions.length===failAt)throw Error('Native action unavailable')}})
 return {app,initial,files,actions,opened,closed,run(){new Script(candidate(centered)).runInContext(context)}}
}
test('native action candidate supplies only exact quadrilateral; every source is fresh and user state is restored',()=>{
 const env=experiment();env.run();assert.equal(env.actions.length,9);assert.equal(env.opened.length,9);assert.equal(env.closed.length,9);assert.equal(env.app.activeDocument,env.initial);assert.equal(env.initial.activeLayer.name,'Do not edit');assert.equal(env.app.displayDialogs,'original')
 for(const action of env.actions){assert.equal(action.event,'perspectiveCrop');assert.deepEqual(Object.keys(action.values),['to']);assert.equal(action.values.to.type,'quadrilateral');assert.deepEqual(Object.keys(action.values.to.value),['center','quadCorner0','quadCorner1','quadCorner2','quadCorner3']);assert.equal(action.values.to.value.center.value.horizontal.value,0)}
 const record=JSON.parse([...env.files.values()].at(-1)!);assert.equal(record.referenceKind,'native-actionmanager');assert.equal(record.cases.length,9);assert.deepEqual(record.cases[2].corners,[[60,40],[430,55],[400,280],[75,260]])
})
test('native action failure stops measurement, closes only owned source and restores user state',()=>{
 const env=experiment(2);assert.throws(()=>env.run(),/Native action unavailable/);assert.equal(env.actions.length,2);assert.equal(env.closed.length,2);assert.equal(env.app.activeDocument,env.initial);assert.equal(env.app.displayDialogs,'original');const record=JSON.parse([...env.files.values()].at(-1)!);assert.equal(record.cases.length,1);assert.match(record.error,/Native action unavailable/)
})
test('centered experiment matches actual GUI paint principal point without overwriting center-zero evidence',()=>{
 const env=experiment(Infinity,true);env.run();assert.equal(env.actions.length,9)
 for(const action of env.actions){assert.deepEqual(Object.keys(action.values),['to']);const center=action.values.to.value.center;assert.equal(center.type,'paint');assert.equal(center.value.horizontal.value,256);assert.equal(center.value.vertical.value,160)}
 for(const path of env.files.keys())assert.match(path,/perspective-size-alpha26-actionmanager-centered\/cohort\.json$/)
 assert.equal(env.app.activeDocument,env.initial);assert.equal(env.app.displayDialogs,'original')
})
