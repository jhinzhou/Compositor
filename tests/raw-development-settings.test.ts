import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PNG} from 'pngjs'
import {decodeForeign,normalizeRawSettings,DEFAULT_RAW_SETTINGS} from '../src/core/foreign-import'
import {ForeignController} from '../src/main/foreign-controller'
const fixture=()=>readFile(new URL('./fixtures/foreign-import/sample.dng',import.meta.url))
async function ready(controller:ForeignController){const started=Date.now();while(controller.snapshot().status!=='awaiting'){if(controller.snapshot().status==='error'||Date.now()-started>15000)throw Error(JSON.stringify(controller.snapshot()));await new Promise(resolve=>setTimeout(resolve,10))}}
test('RAW new settings preserve previous defaults, validate threshold/rebuild limits and reject unsupported lens claims',()=>{
 assert.equal(DEFAULT_RAW_SETTINGS.noiseReductionThreshold,0);assert.equal(DEFAULT_RAW_SETTINGS.highlightMode,0);assert.deepEqual(normalizeRawSettings({}),DEFAULT_RAW_SETTINGS)
 for(let mode=0;mode<=9;mode++)assert.equal(normalizeRawSettings({highlightMode:mode as 0}).highlightMode,mode)
 for(const input of [{highlightMode:-1},{highlightMode:10},{highlightMode:1.5},{noiseReductionThreshold:-1},{noiseReductionThreshold:1001},{noiseReductionThreshold:NaN},{noiseReductionThreshold:Infinity},{noiseReductionThreshold:'30'},{lensCorrection:true},null,[]])assert.throws(()=>normalizeRawSettings(input as any),/Invalid RAW import settings/)
 assert.equal(normalizeRawSettings({noiseReductionThreshold:1000}).noiseReductionThreshold,1000)
})
test('real RAW production worker applies wavelet and high-recovery settings to RGBA8 without modifying source bytes',async()=>{
 const bytes=await fixture(),sourceHash=createHash('sha256').update(bytes).digest('hex'),base=await decodeForeign(bytes,'sample.dng',{raw:{halfSize:true}}),disabled=await decodeForeign(bytes,'sample.dng',{raw:{halfSize:true,noiseReductionThreshold:0,highlightMode:0}}),noise=await decodeForeign(bytes,'sample.dng',{raw:{halfSize:true,noiseReductionThreshold:1000}}),recovered=await decodeForeign(bytes,'sample.dng',{raw:{halfSize:true,highlightMode:9}})
 assert.deepEqual(disabled.rgba,base.rgba);assert.notDeepEqual(noise.rgba,base.rgba);assert.notDeepEqual(recovered.rgba,base.rgba);for(const result of [base,noise,recovered]){assert.equal(result.width,960);assert.equal(result.height,409);assert.ok(result.rgba.every((value,i)=>i%4!==3||value===255));assert.match(result.warnings.join(' '),/RGBA8.*precision/)}assert.equal(createHash('sha256').update(bytes).digest('hex'),sourceHash)
})
test('configured RAW controller preview and import have the same noise/recovery pixels and cancellation remains read-only',async()=>{
 const calls:Uint8Array[]=[],controller=new ForeignController(()=>{},async(_session,bytes)=>{calls.push(bytes);return 'imported'}),input=await fixture(),pending=controller.start(input,'sample.dng','session','raw');await ready(controller);const settings={halfSize:true,noiseReductionThreshold:500,highlightMode:3 as const};controller.preview(settings);await ready(controller);const state=controller.snapshot();assert.equal(state.settings!.noiseReductionThreshold,500);assert.equal(state.settings!.highlightMode,3);const preview=PNG.sync.read(Buffer.from(state.preview!.split(',')[1],'base64'));assert.equal(calls.length,0);controller.confirm(settings);assert.equal(await pending,'imported');assert.equal(calls.length,1);const imported=PNG.sync.read(Buffer.from(calls[0]));assert.deepEqual(imported.data,preview.data)
 const canceled=controller.start(input,'again.dng','session','raw');await ready(controller);controller.preview(settings);controller.cancel();assert.equal(await canceled,null);assert.equal(calls.length,1);assert.equal(controller.snapshot().status,'idle')
})
