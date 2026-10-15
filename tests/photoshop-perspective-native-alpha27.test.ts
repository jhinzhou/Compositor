import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {Script,createContext} from 'node:vm'
const source=readFileSync(new URL('../scripts/native-reference/photoshop-perspective-alpha27.jsx',import.meta.url),'utf8').replace(/^#target[^\n]*\n/,'')
function experiment(failAt=Infinity,controls=false){
 const files=new Map<string,string>(),actions:any[]=[],resizes:any[]=[],opened:any[]=[],closed:any[]=[],saved:string[]=[],initial={activeLayer:{name:'User unsaved pixels'}}
 class File{encoding='';constructor(public fsName:string){}get exists(){return !this.fsName.includes('alpha27-owned-input-')}copy(){return true}open(){files.set(this.fsName,'');return true}write(text:string){files.set(this.fsName,text)}close(){}}
 class Folder{constructor(public fsName:string){}get exists(){return true}create(){return true}}
 class Descriptor{values:Record<string,any>={};putUnitDouble(key:string,unit:string,value:number){this.values[key]={unit,value}}putObject(key:string,type:string,value:Descriptor){this.values[key]={type,value:value.values}}putEnumerated(key:string,type:string,value:string){this.values[key]={type,value}}hasKey(key:string){return key in this.values}getEnumerationType(key:string){return this.values[key].type}getEnumerationValue(key:string){return this.values[key].value}}
 const prefs={interpolation:'BICUBICAUTOMATIC'},app:any={version:'27.11',documents:[initial],activeDocument:initial,displayDialogs:'user',preferences:new Proxy(prefs,{set(){throw Error('User preferences must not be written')}}),open(file:File){
  const layer:any={name:'Background',isBackgroundLayer:controls?false:!file.fsName.includes('holdout-alpha'),duplicate(){return {name:'Copy',isBackgroundLayer:false}},remove(){}},doc:any={activeLayer:layer,selection:{deselect(){}},width:{as:()=>384},height:{as:()=>256},activeHistoryState:{name:'Perspective Crop'},saveAs(output:File){saved.push(output.fsName)},resizeImage(width:any,height:any,_resolution:any,method:string){resizes.push({width:width.value,height:height.value,method});doc.width={as:()=>width.value};doc.height={as:()=>height.value}},close(){closed.push(doc)}};app.activeDocument=doc;opened.push(doc);return doc
 }}
 const context=createContext({app,File,Folder,ActionDescriptor:Descriptor,PNGSaveOptions:class{},UnitValue:class{constructor(public value:number,public unit:string){}},ResampleMethod:{BICUBIC:'BICUBIC',BICUBICSHARPER:'BICUBICSHARPER',BICUBICSMOOTHER:'BICUBICSMOOTHER'},DialogModes:{NO:'none'},SaveOptions:{DONOTSAVECHANGES:'discard'},Extension:{LOWERCASE:'lower'},stringIDToTypeID:(s:string)=>s,typeIDToStringID:(s:string)=>s,executeAction(event:string,descriptor:Descriptor){actions.push({event,values:descriptor.values});if(actions.length===failAt)throw Error('Rejected candidate');return new Descriptor()}})
 return {app,initial,files,actions,resizes,opened,closed,saved,run(){new Script(controls?readFileSync(new URL('../scripts/native-reference/photoshop-perspective-controls-alpha27.jsx',import.meta.url),'utf8').replace(/^#target[^\n]*\n/,''):source).runInContext(context)},record(){return JSON.parse([...files.values()].at(-1)!)}}
}
test('bounded alpha27 native experiment opens 20 fresh sources, captures before bytes, changes no user preference and restores active document/dialogs',()=>{
 const env=experiment();env.run();assert.equal(env.actions.length,20);assert.equal(env.opened.length,20);assert.equal(env.closed.length,20);assert.equal(env.saved.length,40);assert.equal(env.app.activeDocument,env.initial);assert.equal(env.app.displayDialogs,'user');assert.equal(env.initial.activeLayer.name,'User unsaved pixels');assert.equal(env.record().userPreferenceUnchanged,true)
 for(const action of env.actions){assert.equal(action.event,'perspectiveCrop');const center=action.values.to.value.center;assert.equal(center.type,'paint');assert.equal(center.value.horizontal.value,192);assert.equal(center.value.vertical.value,128)}
})
test('explicit interpolation names remain unproven; size holdouts have no target or interpolation field and unseen alpha is separately labeled',()=>{
 const env=experiment();env.run();const record=env.record();assert.equal(record.cases.filter((c:any)=>c.referenceRole==='size-holdout').length,6);assert.equal(record.cases.filter((c:any)=>c.referenceRole==='holdout').length,1)
 for(let i=0;i<record.cases.length;i++){const row=record.cases[i];assert.equal(row.interpolationFieldStatus,'UNPROVEN_UNTIL_OUTPUT_COMPARISON');assert.equal(row.returnedInterpolation,null);if(row.referenceRole==='size-holdout')assert.deepEqual(Object.keys(env.actions[i].values),['to'])}
 assert.deepEqual([...new Set(env.actions.slice(0,12).map(a=>a.values.interpolation.value))],['bicubicAutomatic','bicubic','bicubicSharper','bicubicSmoother']);assert.equal(record.cases[0].backgroundAtOpen,true);assert.equal(record.cases[0].backgroundBeforeCrop,true);assert.equal(record.cases[12].backgroundAtOpen,true);assert.equal(record.cases[12].backgroundBeforeCrop,false)
})
test('rejected optional native field is recorded, owned source closed, remaining independent cases collected without masking failure',()=>{
 const env=experiment(2);env.run();assert.equal(env.closed.length,20);assert.equal(env.record().cases[1].status,'NATIVE_CASE_FAILED');assert.match(env.record().cases[1].error,/Rejected candidate/);assert.equal(env.record().cases[2].status,'NATIVE_OUTPUT_CAPTURED');assert.equal(env.app.activeDocument,env.initial);assert.equal(env.app.displayDialogs,'user')
})

test('native controls retain true background class and separate six explicit DOM resizes from two direct perspective requests',()=>{
 const env=experiment(Infinity,true);env.run();const record=env.record();assert.equal(env.opened.length,8);assert.equal(env.closed.length,8);assert.equal(env.actions.length,2);assert.equal(env.resizes.length,6);assert.equal(record.userPreferenceUnchanged,true);assert.equal(env.app.activeDocument,env.initial)
 for(const row of record.cases){assert.equal(row.status,'NATIVE_OUTPUT_CAPTURED');if(row.operation==='resizeImage'){assert.equal(row.referenceKind,'native-dom-image-size');assert.equal(row.interpolationFieldStatus,'SUPPORTED_DOM_EXPLICIT_RESAMPLE_METHOD');assert.equal(row.backgroundBeforeCrop,false)}else assert.equal(row.backgroundBeforeCrop,true)}
 assert.deepEqual(env.resizes.map(r=>r.method),['BICUBIC','BICUBICSHARPER','BICUBICSMOOTHER','BICUBIC','BICUBICSHARPER','BICUBICSMOOTHER']);assert.equal(env.saved.length,16)
})
