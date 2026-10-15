import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {inflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {Editor} from '../src/core/editor'
import {preparePatch} from '../src/core/patch-edit'
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),fixturePath='fixtures/parity/photoshop-27.11-patch-alpha24.json'
const stored=JSON.parse(await readFile(fixturePath,'utf8')),source=new PNG({width:stored.width,height:stored.height}),native=new PNG({width:stored.width,height:stored.height}),mask=new PNG({width:stored.width,height:stored.height})
source.data=inflateSync(Buffer.from(stored.sourceRGBA,'base64'));native.data=inflateSync(Buffer.from(stored.nativeRGBA,'base64'))
if(sha(source.data)!==stored.sourceSha||sha(native.data)!==stored.nativeSha)throw Error('Reference hash mismatch')
// The first capture's valid selection was the same hard 50x50 rectangle.
for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++){const value=x>=335&&x<385&&y>=135&&y<185?255:0;mask.data.set([value,value,value,255],(y*mask.width+x)*4)}
if(source.width!==512||source.height!==320||native.width!==512||native.height!==320)throw Error('Unexpected reference dimensions')
let maskNonGray=0,maskArea=0,outsideChanges=0,nativeChanged=0
for(let p=0;p<512*320;p++){const at=p*4,x=p%512,y=Math.floor(p/512);if(mask.data[at]!==mask.data[at+1]||mask.data[at]!==mask.data[at+2]||mask.data[at+3]!==255)maskNonGray++;maskArea+=mask.data[at]/255;const changed=[0,1,2,3].some(c=>native.data[at+c]!==source.data[at+c]);if(changed){nativeChanged++;if(x<335||x>=385||y<135||y>=185)outsideChanges++}}
const editor=new Editor();editor.importPNG(PNG.sync.write(source),'Native Patch');const stage={...editor.snapshot(),selection:{inverted:false,antialiased:false,shapes:[{kind:'rectangle' as const,bounds:[335,135,50,50] as [number,number,number,number],feather:0,operation:'replace' as const}]}},id=stage.manifest.layers[0].id
const candidates=[]
for(const adaptation of [0,.25,.5,.75,1]){const prepared=preparePatch(stage,{type:'layer.patch',layerId:id,offset:[-160,0],mode:'source',adaptation}),result=PNG.sync.read(prepared.png);let abs=0,max=0,different=0;for(let y=135;y<185;y++)for(let x=335;x<385;x++)for(let c=0;c<3;c++){const delta=Math.abs(result.data[(y*512+x)*4+c]-native.data[(y*512+x)*4+c]);abs+=delta;max=Math.max(max,delta);if(delta)different++}candidates.push({adaptation,mae:abs/7500,max,differentChannels:different});await mkdir('artifacts/photoshop-native/measurements/patch-alpha24',{recursive:true});await writeFile(`artifacts/photoshop-native/measurements/patch-alpha24/adaptation-${adaptation}.png`,prepared.png)}
const report={version:'Photoshop 27.11.0',operation:{selection:[335,135,50,50],offset:[-160,0],mode:'Normal Source',diffusion:5,transparent:false},sourceSha:sha(source.data),nativeSha:sha(native.data),maskNonGray,maskArea,maskValid:maskNonGray===0&&maskArea===2500,nativeEffectValid:nativeChanged>0&&outsideChanges===0,invalidReason:nativeChanged===0?'Native output is byte-identical to source: operation not committed or capture invalid. This is not an effect oracle.':undefined,outsideChanges,nativeChanged,candidates,limitation:'One synthetic native sample; parameter sweep is diagnostic only, not an independent validation set.'}
await writeFile('artifacts/photoshop-native/measurements/patch-alpha24/comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
// The committed fixture is immutable evidence; measurement never rewrites it.
