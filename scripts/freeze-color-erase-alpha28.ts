/** Copies the explicitly authorized native GUI probes into immutable source fixtures.
 * Never executes Photoshop or changes a native input/output file. */
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {PNG} from 'pngjs'
const nativeRoot='artifacts/photoshop-native/outputs',dir=`${nativeRoot}/gui-alpha28`
const sha=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex')
const sourcePath=`${dir}/alpha28-gui-owned-magic-eraser-source.png`,sourcePNG=readFileSync(sourcePath),source=PNG.sync.read(sourcePNG)
if(source.width!==240||source.height!==160)throw Error('Unexpected native eraser source dimensions.')
const aaResidual=process.argv.includes('--aa-residual')
const probes=aaResidual?[{name:'magic-t32-aa1-contig1',antialiased:true,contiguous:true,optionsFile:'tool-options-1791964923778.json'}]:[{name:'magic-t32-aa0-contig0',antialiased:false,contiguous:false,optionsFile:'tool-options-1791964267544.json'},{name:'magic-t32-aa0-contig1',antialiased:false,contiguous:true,optionsFile:'tool-options-1791964603892.json'}]
const cases=probes.map(c=>{
 const pngPath=`${dir}/${c.name}.png`,historyPath=`${dir}/${c.name}.txt`,optionsPath=`${nativeRoot}/eraser-options-alpha28/${c.optionsFile}`,pngBytes=readFileSync(pngPath),rgba=PNG.sync.read(pngBytes),history=readFileSync(historyPath,'utf8'),optionsText=readFileSync(optionsPath,'utf8'),options=JSON.parse(optionsText),tool=options.currentToolOptions.value
 if(rgba.width!==source.width||rgba.height!==source.height||options.tool.enumType!=='magicEraserTool'||tool.opacity!==100||tool.BckT!==32||tool.BckA!==c.antialiased||tool.BckS!==false||tool.contiguous!==c.contiguous||!history.includes('history=魔术橡皮擦'))throw Error(`Unexpected native probe parameters: ${c.name}`)
 return {name:c.name,method:'actual Photoshop GUI mouse click, not an internal editor command',sourceVariant:'magic-owned',params:{point:[12,14],tolerance:32,opacity:1,antialiased:c.antialiased,contiguous:c.contiguous,sampleAllLayers:false},width:rgba.width,height:rgba.height,rgbaSHA256:sha(rgba.data),rgbaZlib:deflateSync(rgba.data).toString('base64'),nativePNG_SHA256:sha(pngBytes),nativePNGPath:pngPath,history,historySHA256:sha(history),toolOptions:options,toolOptionsSHA256:sha(optionsText),gate:{alphaExact:true,premultipliedRGBExact:true,visibleRGBExact:true,hiddenRGBCompared:false}}
})
const fixture={schemaVersion:1,photoshopVersion:'27.11.0',capturedDate:'2026-10-14',frozenAt:new Date().toISOString(),provenance:'Root agent created an owned 240x160 test image, restored a clean duplicate for each GUI operation, selected Magic Eraser and recorded actual options and a single tool history state. Click coordinates are root-recorded GUI coordinates; history and tool descriptors are preserved below.',sources:{'magic-owned':{width:source.width,height:source.height,rgbaSHA256:sha(source.data),rgbaZlib:deflateSync(source.data).toString('base64'),pngSHA256:sha(sourcePNG),nativePath:sourcePath}},cases}
const path=aaResidual?'fixtures/parity/photoshop-27.11-color-erase-aa-residual-alpha28.json':'fixtures/parity/photoshop-27.11-color-erase-alpha28.json'
writeFileSync(path,JSON.stringify(fixture,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({fixture:path,fixtureSHA256:sha(readFileSync(path)),cases:cases.map(c=>c.name)}))
