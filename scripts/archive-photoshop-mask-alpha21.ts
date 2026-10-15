/** Archive new real UI references only. Native files and alpha20 fixture immutable. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
import {decodePhotoshop} from '../src/core/photoshop-io'
import {effectiveMaskPixels,effectiveMaskTransform,sampleEffectiveMask} from '../src/shared/mask-properties'
const root='artifacts/photoshop-native/outputs/mask-feather-ui-study-alpha21',out='artifacts/photoshop-native/measurements/mask-alpha21-archive',fixturePath='fixtures/parity/photoshop-27.11-mask-feather-ui-alpha21.json',hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex'),log=readFileSync(root+'/native-results.tsv','utf8'),expected=[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1,1.2,1.5,2,3],seen=new Set<number>()
// An existing archive is immutable. Re-running verifies raw evidence rather
// than rewriting its historical alpha20 baseline with the current product.
if(existsSync(fixturePath)){
 const archived=JSON.parse(readFileSync(fixturePath,'utf8')) as {provenance:{logSHA256:string};rows:{name:string;psdSHA256:string;pngSHA256:string}[]}
 if(archived.provenance.logSHA256!==hash(log)||archived.rows.length!==15)throw Error('Archived native capture/log changed')
 for(const row of archived.rows)if(hash(readFileSync(`${root}/${row.name}.psd`))!==row.psdSHA256||hash(readFileSync(`${root}/${row.name}.png`))!==row.pngSHA256)throw Error('Archived native evidence changed: '+row.name)
 console.log('Verified existing fifteen-row immutable alpha21 archive; no fixture or baseline rewritten.');process.exit(0)
}
const rows=log.split(/\r\n|\r|\n/).filter(l=>l.includes('\tPASS\t')).map(line=>{
 const name=line.split('\t')[0],match=name.match(/^center-densityByte255-feather([\d.]+)$/);if(!match||!expected.includes(Number(match[1]))||seen.has(Number(match[1])))throw Error('Unexpected/duplicate reference: '+name);seen.add(Number(match[1]))
 if(!log.includes(name+'\tPARAMS\tPhotoshop=27.11.0\tdensityByte=255\tfeather='+match[1]))throw Error('Missing actual descriptor readback: '+name)
 const psdBytes=readFileSync(`${root}/${name}.psd`),pngBytes=readFileSync(`${root}/${name}.png`),reference=PNG.sync.read(pngBytes),decoded=decodePhotoshop(psdBytes),layer=decoded.manifest.layers.find(l=>l.maskFile);if(!layer||Math.abs((layer.maskDensity??1)-1)>1e-8||(layer.maskFeather??0)!==Number(match[1]))throw Error('PSD descriptor disagrees with actual UI: '+name)
 const source=decoded.assets.get(layer.maskFile!)!,mask=PNG.sync.read(source.bytes);if(reference.width!==256||reference.height!==192||mask.width!==256||mask.height!==192)throw Error('Unexpected source-grid dimensions')
 const alpha=Uint8Array.from({length:reference.width*reference.height},(_,i)=>reference.data[i*4+3]),image={width:mask.width,height:mask.height,data:new Uint8ClampedArray(mask.data)},effective=effectiveMaskPixels(image,{...layer,maskFeatherModel:'photoshop',maskFeatherEdgeMode:'clamp'}),placement=effectiveMaskTransform(layer.maskPlacement??layer.transform,image,effective.inset);let max=0,sum=0,union=0;for(let y=0;y<reference.height;y++)for(let x=0;x<reference.width;x++){const actual=sampleEffectiveMask(effective,placement,x+.5,y+.5),expectedAlpha=alpha[y*reference.width+x],delta=Math.abs(actual-expectedAlpha);max=Math.max(max,delta);sum+=delta;if(actual||expectedAlpha)union++}
 return {name,width:reference.width,height:reference.height,layer,maskWidth:mask.width,maskHeight:mask.height,maskRGBAZlib:deflateSync(mask.data).toString('base64'),alphaZlib:deflateSync(alpha).toString('base64'),alphaSHA256:hash(alpha),maskSHA256:hash(source.bytes),psdSHA256:hash(psdBytes),pngSHA256:hash(pngBytes),alpha20Baseline:{max,absoluteL1:sum,unionMAE:sum/union}}
});if(rows.length!==expected.length)throw Error('Expected fifteen UI-confirmed actual native samples')
const report={provenance:{application:'Adobe Photoshop 27.11.0',method:'Root edited actual native Properties UI; capture reads userMaskDensity/userMaskFeather descriptor and saves independent PSD/PNG. Same disposable self-authored 256x192 white input, center80x80mask at[88,56]. Independent fractional radii0/.1/.2/.3/.4/.5/.6/.7/.8/.9/1/1.2/1.5/2/3.',nativeRoot:root,prepareSHA256:hash(readFileSync('scripts/native-reference/photoshop-mask-feather-ui-study-alpha21.jsx')),captureSHA256:hash(readFileSync('scripts/native-reference/photoshop-mask-feather-ui-capture-alpha21.jsx')),logSHA256:hash(log),archiveSHA256:hash(readFileSync('scripts/archive-photoshop-mask-alpha21.ts')),alpha20KernelSHA256:hash(readFileSync('src/shared/mask-feather.ts'))},rows};mkdirSync(out,{recursive:true});writeFileSync(out+'/comparison.json',JSON.stringify(report,null,2)+'\n');writeFileSync(fixturePath,JSON.stringify(report,null,2)+'\n');console.log(rows.map(r=>({name:r.name,...r.alpha20Baseline})))
