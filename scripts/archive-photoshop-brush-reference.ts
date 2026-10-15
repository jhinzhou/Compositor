import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {brushStrokeCoverage} from '../src/shared/brush-coverage'
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex'),root='artifacts/photoshop-native',rows=[]
const evidence:Record<string,string>={}
for(const version of ['v2','v3','v4','v5']){
 const logPath=`${root}/outputs/brush-study-${version}/native-results.tsv`,script=`scripts/native-reference/photoshop-brush-study-${version}.jsx`,log=readFileSync(logPath);evidence[logPath]=hash(log);evidence[script]=hash(readFileSync(script))
 for(const line of log.toString().split(/\r\n|\r|\n/).filter(line=>line.endsWith('\tPASS'))){
  const name=line.split('\t')[0],match=name.match(/-o([\d.]+)-f(\d+)-s(\d+)/)!,opacity=Number(match[1])/100,flow=Number(match[2])/100,spacing=Number(match[3])/100,size=Number(name.match(/-d(\d+)/)?.[1]??32),hardness=name.includes('-h')?Number(name.match(/-h(\d+)/)![1])/100:name.startsWith('soft')?0:name.startsWith('medium')?.5:1,count=name.includes('twice')?2:1,offset=name.includes('-half-')?.5:name.includes('-quarter-')?.25:0,points:[number,number][]=name.includes('-dot-')?[[128+offset,96+offset],[128.01+offset,96+offset]]:[[48,96],[208,96]]
  if(!log.toString().includes(`${name}\tverified-options\topacity=${opacity*100}\tflow=${flow*100}`))throw Error(`Unverified settings ${name}`)
  if(version==='v5'){for(const [key,value] of [['diameter',size],['hardness',hardness*100],['spacing',spacing*100]] as const)if(!log.toString().includes(`${name}.actual.brush.${key}\tDescValueType.UNITDOUBLE\t${value}`))throw Error(`Unverified tip ${name}/${key}`)}
  const bytes=readFileSync(`${root}/outputs/brush-study-${version}/${name}.png`),depth=bytes[24],png=PNG.sync.read(bytes,{skipRescale:true} as Parameters<typeof PNG.sync.read>[1]),maximum=depth===16?65535:255,reference=Uint16Array.from({length:png.width*png.height},(_,i)=>png.data[i*4+3]),encoded=Buffer.alloc(reference.length*2);reference.forEach((v,i)=>encoded.writeUInt16LE(v,i*2))
  const coverage=brushStrokeCoverage({width:png.width,height:png.height,transform:{origin:[0,0],size:[png.width,png.height],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const}},points,size,hardness,{flow,spacing,brushModel:'photoshop'})
  let sum=0,max=0,union=0,peak=0,refPeak=0
  for(let i=0;i<coverage.length;i++){let value=0;for(let n=0;n<count;n++)value=Math.round(maximum*(coverage[i]/255*opacity+value/maximum*(1-coverage[i]/255*opacity)));const delta=Math.abs(value-reference[i]);sum+=delta;max=Math.max(max,delta);union+=value||reference[i]?1:0;peak=Math.max(peak,value);refPeak=Math.max(refPeak,reference[i])}
  rows.push({version,name,size,opacity,flow,spacing,hardness,count,points,width:png.width,height:png.height,depth,pngSHA256:hash(bytes),alphaSHA256:hash(encoded),alphaLEZlib:deflateSync(encoded).toString('base64'),measured:{fullMAE:sum/coverage.length,unionMAE:sum/union,max,peak,refPeak}})
 }
}
const sourcePath=`${root}/inputs/brush-study-transparent.png`,source=readFileSync(sourcePath)
writeFileSync('fixtures/parity/photoshop-27.11-brush.json',JSON.stringify({provenance:{application:'Adobe Photoshop 27.11.0',date:'2026-10-12',method:'File > Scripts > Browse; actual native path.strokePath(BRUSH,false); computed round tip; explicit Opacity/Flow readback; smoothing/pressure/texture/scatter disabled; foreground 200/40/100.',rights:'Diagnostic transparent source and straight paths authored for this project. No third-party artwork.',scope:'8-bit Alpha comparisons, multi-size hard-tip and fractional path positions; RGB16 brush records remaining PS tool quantization. No arbitrary hardness, hardware pressure, airbrush, ICC or freehand latency equivalence.',source:{path:sourcePath,pngSHA256:hash(source),width:256,height:192,rgbaZlib:deflateSync(PNG.sync.read(source).data).toString('base64')},evidence},rows},null,2)+'\n')
for(const row of rows)console.log(`${row.version}/${row.name}: alpha${row.depth} max=${row.measured.max}, unionMAE=${row.measured.unionMAE.toFixed(4)}, peak=${row.measured.peak}/PS${row.measured.refPeak}`)
