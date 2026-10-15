import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {parse,compileScript} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import ts from 'typescript'
import * as Vue from 'vue'
import {photoshopPerspectiveCropCorners,photoshopPerspectiveCropGeometry,type CropCorners} from '../src/shared/crop-projective'
import {PointerFinish} from '../src/renderer/pointer-finish'

// Execute the actual component handlers with only DOM and lifecycle APIs replaced.
// The crop geometry, owner checks, rollback and emitted lease events are production code.
function overlay(){
 const filename=resolve('src/renderer/CropOverlay.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),module={exports:{} as any},localRequire=createRequire(filename)
 const mounted:(()=>void)[]=[],unmounted:(()=>void)[]=[],listeners=new Map<string,()=>void>(),emitted:{event:string;value:unknown}[]=[]
 const previous={window:globalThis.window,document:globalThis.document}
 Object.assign(globalThis,{window:{addEventListener:(name:string,fn:()=>void)=>listeners.set(name,fn),removeEventListener:(name:string)=>listeners.delete(name)},document:{addEventListener(){},removeEventListener(){}}})
 const require=(specifier:string)=>specifier==='vue'?{...Vue,onMounted:(fn:()=>void)=>mounted.push(fn),onBeforeUnmount:(fn:()=>void)=>unmounted.push(fn)}:specifier==='./i18n'?{useI18n:()=>({t:(s:string)=>s,tm:(s:string)=>s})}:localRequire(specifier)
 const code=transformSync(compileScript(descriptor,{id:'crop-lifecycle'}).content,{loader:'ts',format:'cjs'}).code
 new Function('module','exports','require',code)(module,module.exports,require)
 const props={draft:{x:20,y:20,width:80,height:60},zoom:1,snap:{enabled:false,zoom:1,document:{width:160,height:120}}},initial={...props.draft};let before={...initial},api:any
 const setup=module.exports.default.setup(props,{expose:(value:unknown)=>api=value,emit:(event:string,value:unknown)=>{emitted.push({event,value});if(event==='update')props.draft=value as typeof initial;if(event==='interaction'&&value)before={...props.draft};if(event==='cancel')props.draft={...before}}})
 for(const fn of mounted)fn()
 const captures=new Set<number>(),target={setPointerCapture:(id:number)=>captures.add(id),hasPointerCapture:(id:number)=>captures.has(id),releasePointerCapture:(id:number)=>captures.delete(id)}
 const event=(id:number,x=100,y=80)=>({button:0,pointerId:id,clientX:x,clientY:y,currentTarget:target,altKey:false,ctrlKey:false,preventDefault(){}})
 return {setup,api,props,initial,emitted,captures,event,listeners,restore(){for(const fn of unmounted)fn();Object.assign(globalThis,previous)}}
}

test('crop overlay ignores another pointer up/cancel/lost capture and only releases its owner',()=>{
 const instance=overlay()
 try{const {setup,event,emitted,captures,props}=instance;setup.start(event(1),'se');setup.move(event(1,120,100));assert.equal(props.draft.width,100)
  setup.finish(event(2,130,110));setup.cancelPointer(event(2));assert.equal(captures.has(1),true);assert.deepEqual(emitted.filter(item=>item.event==='interaction').map(item=>item.value),[true])
  setup.move(event(1,125,105));setup.finish(event(1,130,110));assert.equal(props.draft.width,110);assert.equal(captures.has(1),false);assert.deepEqual(emitted.filter(item=>item.event==='interaction').map(item=>item.value),[true,false]);assert.equal(emitted.some(item=>item.event==='cancel'),false)
 }finally{instance.restore()}
})

test('crop focus loss restores the preceding draft and releases exactly one lease before another handle drag',()=>{
 const instance=overlay()
 try{const {setup,event,props,listeners,captures,emitted,initial}=instance;setup.start(event(1),'se');setup.move(event(1,130,110));assert.notDeepEqual(props.draft,initial);listeners.get('blur')!();assert.deepEqual(props.draft,initial);assert.equal(captures.size,0)
  setup.finish(event(1));setup.cancelPointer(event(1));assert.deepEqual(emitted.filter(item=>item.event==='interaction').map(item=>item.value),[true,false]);assert.equal(emitted.filter(item=>item.event==='cancel').length,1)
  setup.start(event(3),'e');setup.move(event(3,110,80));setup.finish(event(3,110,80));assert.equal(props.draft.width,90);assert.deepEqual(emitted.filter(item=>item.event==='interaction').map(item=>item.value),[true,false,true,false])
 }finally{instance.restore()}
})

function actualApplyCrop(environment:Record<string,unknown>):()=>Promise<void>{
 environment={error:Vue.ref(),interactionProfile:Vue.ref('compositor'),perspectiveManualSize:Vue.ref(true),photoshopPerspectiveCropCorners,photoshopPerspectiveCropGeometry,cropAspect:()=>undefined,perspectiveReady:Vue.ref(true),cropGeometryOverlay:Vue.ref(),cropMode:Vue.ref('crop'),cropAngle:Vue.ref(0),perspectiveCorners:Vue.ref(),resetCropGeometry(){},...environment}
 const filename=resolve('src/renderer/App.vue'),{descriptor}=parse(readFileSync(filename,'utf8'),{filename}),source=ts.createSourceFile(filename,descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='applyCrop');assert.ok(fn)
 const code=transformSync(fn.getText(source),{loader:'ts',format:'cjs'}).code
 return new Function(...Object.keys(environment),`${code};return applyCrop`)(...Object.values(environment))
}

test('Enter during crop creation waits for gesture and overlay lease release before one apply, leaving no stale draft',async()=>{
 const order:string[]=[],busy=Vue.ref(false),cropDraft=Vue.ref<{x:number;y:number;width:number;height:number}>({x:10,y:10,width:60,height:40}),cropRequest=Vue.ref({sessionId:'source',documentId:'doc',expectedRevision:3,idempotencyKey:'crop'}),pointerFinish=new PointerFinish()
 let release!:()=>void,leased=true;const done=new Promise<void>(resolve=>release=resolve),drag={mode:'raster:crop'}
 const environment={drag,pointerFinish,pointerUp:()=>pointerFinish.run(async()=>{order.push('finish-pointer');await done;leased=false;order.push('release-pointer')}),cropOverlay:{value:{finish(){order.push('finish-overlay')}}},cropOverlaySettled:Promise.resolve().then(()=>order.push('release-overlay')),busy,cropDraft,cropRequest,captureCropView:()=>({zoom:1}),request:async(method:string,params:unknown)=>{assert.equal(leased,false,'A crop mutation must not run while the creation lease remains owned');order.push(method);assert.equal((params as any).action.deleteCroppedPixels,false);return {status:'applied'}},toRaw:Vue.toRaw,nextTick:Vue.nextTick,fit:()=>order.push('fit'),state:Vue.ref({undoTransactionId:'crop-undo'}),cropViews:new Map()}
 const apply=actualApplyCrop(environment),first=apply(),second=apply();await Promise.resolve();assert.equal(order.includes('apply'),false);assert.equal(busy.value,false);release();await Promise.all([first,second]);assert.equal(order.filter(item=>item==='apply').length,1);assert.ok(order.indexOf('release-pointer')<order.indexOf('apply'));assert.equal(cropDraft.value,undefined);assert.equal(cropRequest.value,undefined);assert.equal(pointerFinish.active,false);assert.equal(busy.value,false)
})

test('failed crop keeps the exact pending frame and request for retry after releasing the gesture',async()=>{
 const draft={x:-5,y:8,width:80,height:60},request={sessionId:'s',expectedRevision:2,idempotencyKey:'retry'},cropDraft=Vue.ref(draft),cropRequest=Vue.ref(request),busy=Vue.ref(false)
 const apply=actualApplyCrop({drag:undefined,pointerFinish:new PointerFinish(),pointerUp:async()=>{},cropOverlay:{value:{finish(){}}},cropOverlaySettled:Promise.resolve(),busy,cropDraft,cropRequest,captureCropView:()=>({}),request:async()=>undefined,toRaw:Vue.toRaw,nextTick:Vue.nextTick,fit(){throw new Error('Failed crop must not fit the view')},state:Vue.ref({}),cropViews:new Map()})
 await apply();assert.deepEqual(cropDraft.value,draft);assert.deepEqual(cropRequest.value,request);assert.equal(busy.value,false)
})
test('actual App applyCrop dispatches straighten and perspective through existing atomic Apply boundary',async()=>{for(const mode of ['straighten','perspective']){const corners=[[0,0],[4,0],[3,4],[1,4]],draft={x:1,y:1,width:2,height:2},cropDraft=Vue.ref(draft),cropRequest=Vue.ref({sessionId:'s',expectedRevision:2,idempotencyKey:'identity'});let actual:any,released=false,reset=false
 const apply=actualApplyCrop({drag:undefined,pointerFinish:new PointerFinish(),pointerUp:async()=>{},cropOverlay:Vue.ref(),cropGeometryOverlay:Vue.ref({finish(){released=true}}),cropOverlaySettled:Promise.resolve(),busy:Vue.ref(false),cropDraft,cropRequest,cropMode:Vue.ref(mode),cropAngle:Vue.ref(mode==='straighten'?-7.125:0),perspectiveCorners:Vue.ref(corners),perspectiveWidth:Vue.ref(2),perspectiveHeight:Vue.ref(3),rpcValue:Vue.toRaw,captureCropView:()=>({}),request:async(method:string,p:any)=>{assert.equal(released,true);assert.equal(method,'apply');actual=p;return {status:'applied'}},toRaw:Vue.toRaw,nextTick:Vue.nextTick,fit(){},state:Vue.ref({}),cropViews:new Map(),resetCropGeometry(){reset=true}})
 await apply();assert.equal(actual.idempotencyKey,'identity');assert.equal(reset,true);assert.deepEqual(actual.action,mode==='straighten'?{type:'document.straighten',angle:-7.125,crop:draft}:{type:'document.perspective_crop',corners,width:2,height:3,sampling:'High quality'});assert.equal(cropDraft.value,undefined)
}})

test('incomplete perspective four-point input refuses Apply before releasing or mutating the draft',async()=>{
 let touched=false;const apply=actualApplyCrop({perspectiveReady:Vue.ref(false),cropMode:Vue.ref('perspective'),pointerUp(){touched=true},request(){touched=true},cropGeometryOverlay:Vue.ref({finish(){touched=true}})})
 await apply();assert.equal(touched,false)
})

test('actual Photoshop profile crop forwards native edge coordinates once and leaves the draft handles untouched',async()=>{const corners:CropCorners=[[40,35],[430,45],[425,275],[35,260]],original=structuredClone(corners),cropDraft=Vue.ref({x:35,y:35,width:401,height:241});let action:any;const apply=actualApplyCrop({interactionProfile:Vue.ref('photoshop'),drag:undefined,pointerFinish:new PointerFinish(),pointerUp:async()=>{},cropOverlay:Vue.ref(),cropOverlaySettled:Promise.resolve(),busy:Vue.ref(false),cropDraft,cropRequest:Vue.ref({sessionId:'s',expectedRevision:2,idempotencyKey:'crop'}),cropMode:Vue.ref('perspective'),perspectiveCorners:Vue.ref(corners),perspectiveWidth:Vue.ref(401),perspectiveHeight:Vue.ref(241),rpcValue:Vue.toRaw,captureCropView:()=>({}),request:async(_method:string,p:any)=>{action=p.action;return {}},toRaw:Vue.toRaw,nextTick:Vue.nextTick,fit(){},state:Vue.ref({}),cropViews:new Map()});await apply();assert.deepEqual(action.corners,corners);assert.deepEqual(corners,original)})


test('actual auto Photoshop crop applies extent phase without moving visible handles; manual dimensions preserve their mapping',async()=>{
 const corners:CropCorners=[[74.5,52],[540.5,82],[459.5,359],[114.5,379]],original=structuredClone(corners),manifest={width:641,height:480},native=photoshopPerspectiveCropGeometry(corners,manifest.width,manifest.height)
 for(const manual of [false,true]){let actual:any;const apply=actualApplyCrop({interactionProfile:Vue.ref('photoshop'),perspectiveManualSize:Vue.ref(manual),drag:undefined,pointerFinish:new PointerFinish(),cropOverlay:Vue.ref(),cropOverlaySettled:Promise.resolve(),busy:Vue.ref(false),cropDraft:Vue.ref({x:0,y:0,...native.extent}),cropRequest:Vue.ref({sessionId:'s',expectedRevision:2,idempotencyKey:'phase'}),cropMode:Vue.ref('perspective'),perspectiveCorners:Vue.ref(corners),perspectiveWidth:Vue.ref(native.extent.width),perspectiveHeight:Vue.ref(native.extent.height),rpcValue:Vue.toRaw,captureCropView:()=>({}),request:async(_method:string,p:any)=>{actual=p.action;return {}},toRaw:Vue.toRaw,nextTick:Vue.nextTick,fit(){},state:Vue.ref({manifest}),cropViews:new Map()});await apply();assert.deepEqual(actual.corners,manual?corners:native.corners);assert.equal(actual.width,native.extent.width);assert.equal(actual.height,native.extent.height);assert.deepEqual(corners,original)}
})
