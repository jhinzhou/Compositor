import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from '@vue/compiler-sfc'
import {transformSync} from 'esbuild'
import ts from 'typescript'
import {ref} from 'vue'
import {CAMERA_RAW_SECTIONS,cameraRawDefaults,resetCameraRawSection,isCameraRawSectionDefault,visibleCameraRawSettings,cameraRawScalarLimits,type CameraRawSettings} from '../src/shared/camera-raw-sections'
import {imageFilterSchema,applyCameraRawPreview} from '../src/shared/image-filters'
function edited():CameraRawSettings {
  const settings=cameraRawDefaults()
  Object.assign(settings,{exposure:.7,contrast:15,highlights:-30,shadows:25,whites:5,blacks:-5,whiteBalance:'Auto',temperature:12,tint:-8,vibrance:20,saturation:-10,texture:10,clarity:12,dehaze:4,glow:30,glowStyle:'Bloom',glowRange:10,glowSpread:-5,glowWarmth:7,vignetteAmount:-20,vignetteStyle:'Paint Overlay',vignetteMidpoint:40,vignetteRoundness:10,vignetteFeather:60,vignetteHighlights:5,grainAmount:15,grainSize:30,grainRoughness:40,seed:42})
  settings.curve.shadows=10;settings.curve.shadowSplit=30;settings.mixer.hue[2]=15;settings.grading.blending=70;settings.detail.sharpenAmount=40;settings.optics.enableLensProfile=true;settings.geometry.vertical=10;settings.calibration.redHue=12
  return imageFilterSchema.parse(settings) as CameraRawSettings
}
test('ten Camera Raw groups cover every supported parameter exactly once, including Electron grain seed',()=>{
  assert.equal(CAMERA_RAW_SECTIONS.find(section=>section.id==='light')?.title,'Tonal Adjustments');const fields=CAMERA_RAW_SECTIONS.flatMap(section=>[...section.fields]);assert.equal(new Set(fields).size,fields.length);assert.deepEqual([...fields].sort(),Object.keys(cameraRawDefaults()).filter(key=>key!=='kind').sort())
})
for(const section of CAMERA_RAW_SECTIONS)test(`reset ${section.id} restores enums, arrays and nonzero defaults while other sections retain their exact values`,()=>{
  const original=edited(),before=structuredClone(original),reset=resetCameraRawSection(original,section.id),defaults=cameraRawDefaults();assert.equal(isCameraRawSectionDefault(original,section.id),false);assert.equal(isCameraRawSectionDefault(reset,section.id),true);assert.deepEqual(original,before)
  for(const other of CAMERA_RAW_SECTIONS)for(const key of other.fields)assert.deepEqual(reset[key],other.id===section.id?defaults[key]:original[key])
  imageFilterSchema.parse(reset)
})
test('reset all groups yields actual schema defaults including Effects choices/midpoints and global grain seed',()=>{
  let settings=edited();for(const section of CAMERA_RAW_SECTIONS)settings=resetCameraRawSection(settings,section.id);assert.deepEqual(settings,cameraRawDefaults());assert.equal(settings.vignetteMidpoint,50);assert.equal(settings.vignetteFeather,50);assert.equal(settings.grainSize,25);assert.equal(settings.grainRoughness,50);assert.equal(settings.whiteBalance,'Custom');assert.equal(settings.seed,0)
})
test('hidden section output is a private defaulted copy; toggling restores kept settings and other group pixels',()=>{
  const settings=edited(),before=structuredClone(settings),visible=visibleCameraRawSettings(settings,['light','effects']);assert.equal(isCameraRawSectionDefault(visible,'light'),true);assert.equal(isCameraRawSectionDefault(visible,'effects'),true);assert.deepEqual(visible.curve,settings.curve);visible.mixer.hue[0]=99;assert.deepEqual(settings,before);assert.deepEqual(visibleCameraRawSettings(settings,[]),settings)
  const image={width:2,height:2,data:new Uint8ClampedArray([40,80,120,255,128,64,24,255,180,200,220,255,210,40,10,255])},light=cameraRawDefaults();light.exposure=1.4
  assert.notDeepEqual(applyCameraRawPreview(image,light,{}).data,image.data);assert.deepEqual(applyCameraRawPreview(image,visibleCameraRawSettings(light,['light']),{}).data,applyCameraRawPreview(image,cameraRawDefaults(),{}).data);assert.equal(light.exposure,1.4)
})
test('default detection compares semantic nested objects rather than object insertion order',()=>{const settings=cameraRawDefaults();settings.geometry=Object.fromEntries(Object.entries(settings.geometry).reverse()) as CameraRawSettings['geometry'];assert.equal(isCameraRawSectionDefault(settings,'geometry'),true);settings.geometry.guides.push({startX:.2,startY:.1,endX:.2,endY:.9});assert.equal(isCameraRawSectionDefault(settings,'geometry'),false)})
test('Raw scalar controls keep signed halo/grading fields, exposure EV and seed range rather than generic 0-100',()=>{assert.deepEqual(cameraRawScalarLimits('exposure'),{min:-5,max:5,step:.1});for(const field of ['glowRange','glowSpread','glowWarmth','vignetteRoundness','vibrance'])assert.equal(cameraRawScalarLimits(field).min,-100);assert.equal(cameraRawScalarLimits('seed').max,0xffffffff);assert.equal(cameraRawScalarLimits('grainAmount').min,0)})
function actualFunction(file:string,name:string,deps:Record<string,unknown>){const {descriptor}=parse(readFileSync(file,'utf8')),source=ts.createSourceFile('Component.ts',descriptor.scriptSetup!.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),declaration=source.statements.find(statement=>ts.isFunctionDeclaration(statement)&&statement.name?.text===name);assert.ok(declaration);const code=transformSync(declaration.getText(source),{loader:'ts',format:'cjs'}).code;return new Function(...Object.keys(deps),`${code};return ${name}`)(...Object.values(deps))}
test('actual panel reset makes a hidden group visible, cancels mixer/geometry private state and ignores commit-time writes',()=>{
  const settings=edited(),props={committing:false},spec=ref<Record<string,unknown>>(settings),parsed=ref({success:true,data:settings}),hiddenCameraSections=ref(['effects','mixer','geometry']),cameraResetSignals=ref({mixer:0,geometry:0}),reset=actualFunction('src/renderer/FiltersPanel.vue','resetCameraSection',{props,parsed,spec,hiddenCameraSections,cameraResetSignals,resetCameraRawSection,kind:ref('cameraRaw')})
  reset('effects');assert.equal(isCameraRawSectionDefault(spec.value as CameraRawSettings,'effects'),true);assert.deepEqual(hiddenCameraSections.value,['mixer','geometry']);reset('mixer');reset('geometry');assert.deepEqual(cameraResetSignals.value,{mixer:1,geometry:1});assert.deepEqual(hiddenCameraSections.value,[]);props.committing=true;const before=structuredClone(settings);reset('light');assert.equal(spec.value.exposure,before.exposure)
})
test('actual panel section Reset repairs invalid input without requiring a successful preview parse',()=>{const settings=cameraRawDefaults();settings.exposure=9;const props={committing:false},spec=ref<Record<string,unknown>>(settings),hiddenCameraSections=ref(['light']),cameraResetSignals=ref({mixer:0,geometry:0}),reset=actualFunction('src/renderer/FiltersPanel.vue','resetCameraSection',{props,kind:ref('cameraRaw'),spec,hiddenCameraSections,cameraResetSignals,resetCameraRawSection});reset('light');assert.equal(spec.value.exposure,0);assert.deepEqual(hiddenCameraSections.value,[]);imageFilterSchema.parse(spec.value)})
test('actual filter Apply is single-flight and unlocks controls after backend rejection',async()=>{
  const filterCommitting=ref(false),showFilters=ref(true),lastFilter=ref(),filterIdentity=ref({sessionId:'owned',expectedRevision:4}),filterAdjustment=ref(false),filterLayerId=ref('layer'),selected=ref(undefined),calls:unknown[]=[],filter=cameraRawDefaults();let finish:()=>void=()=>{};const request=async(method:string,payload:unknown)=>{calls.push([method,payload]);await new Promise<void>(resolve=>finish=resolve);return undefined};const apply=actualFunction('src/renderer/App.vue','applyFilter',{filterCommitting,showFilters,lastFilter,filterIdentity,filterAdjustment,filterLayerId,selected,request,FILTER_NAMES:{}});const first=apply(filter);assert.equal(filterCommitting.value,true);await apply(filter);assert.equal(calls.length,1);finish();await first;assert.equal(filterCommitting.value,false);assert.equal(showFilters.value,true)
})
