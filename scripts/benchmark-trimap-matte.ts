import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {PNG} from 'pngjs'
import {trimapFixtures,trimapError} from './fixtures/trimap-matte-fixtures'
import {refineTrimapMatte} from '../src/shared/trimap-matte'
const target=resolve(process.argv[2]??'artifacts/trimap-matte'),fixtures=trimapFixtures(),width=fixtures[0].mask.width,height=fixtures[0].mask.height,gap=8,columns=['Source encoded-sRGB composite','Known alpha reference','Coarse binary mask','Refined mask','Original RGB over black','Original RGB over white','Original RGB over checker'],grid=new PNG({width:columns.length*(width+gap)+gap,height:fixtures.length*(height+gap)+gap})
grid.data.fill(35)
const hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex'),rows=[]
for(let row=0;row<fixtures.length;row++){
 const fixture=fixtures[row],original={source:hash(fixture.guide.data),mask:hash(fixture.mask.coverage),trimap:hash(fixture.trimap)},start=performance.now(),result=refineTrimapMatte(fixture.mask,fixture.guide,fixture.trimap,{sampleRadius:32}),elapsedMs=performance.now()-start,error=trimapError(fixture,result.mask.coverage),baseline=trimapError(fixture,fixture.mask.coverage)
 let constraintErrors=0;for(let i=0;i<fixture.trimap.length;i++)if(fixture.trimap[i]!==128&&result.mask.coverage[i]!==fixture.trimap[i])constraintErrors++
 const sourceUnchanged=original.source===hash(fixture.guide.data)&&original.mask===hash(fixture.mask.coverage)&&original.trimap===hash(fixture.trimap)
 rows.push({name:fixture.name,expected:fixture.expected,reason:fixture.reason,...error,baselineAlphaMAE:baseline.alphaMAE,threshold:.03,qualityPass:error.alphaMAE<=.03,constraintErrors,sourceUnchanged,elapsedMs,...result.report,sourceHash:original.source})
 for(let col=0;col<columns.length;col++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=y*width+x,targetIndex=((gap+row*(height+gap)+y)*grid.width+gap+col*(width+gap)+x)*4
  for(let channel=0;channel<3;channel++){
   let value:number
   if(col===0)value=fixture.guide.data[i*4+channel]
   else if(col===1)value=Math.round(fixture.truth[i]*255)
   else if(col===2)value=fixture.mask.coverage[i]
   else if(col===3)value=result.mask.coverage[i]
   else{const alpha=result.mask.coverage[i]/255,background=col===4?0:col===5?255:((Math.floor(x/8)+Math.floor(y/8))%2?180:230);value=Math.round(fixture.guide.data[i*4+channel]*alpha+background*(1-alpha))}
   grid.data[targetIndex+channel]=value
  }
  grid.data[targetIndex+3]=255
 }
}
// A separate 1MP case checks full-frame work rather than extrapolating tiny
// fixtures. RSS is an observed process high-water mark, not an exact allocator
// attribution; the deterministic budget is separately included in the report.
const perfWidth=1024,perfHeight=1024,perfCount=perfWidth*perfHeight,perfData=new Uint8Array(perfCount*4),perfMask=new Uint8Array(perfCount),perfTrimap=new Uint8Array(perfCount)
for(let y=0;y<perfHeight;y++)for(let x=0;x<perfWidth;x++){const i=y*perfWidth+x,a=Math.min(1,Math.max(0,(516-x)/8));perfMask[i]=a>=.5?255:0;perfTrimap[i]=a===0?0:a===1?255:128;for(let c=0;c<3;c++)perfData[i*4+c]=Math.round(220-180*a);perfData[i*4+3]=255}
const perfSourceHash=hash(perfData),perfStart=performance.now(),perfResult=refineTrimapMatte({width:perfWidth,height:perfHeight,coverage:perfMask},{width:perfWidth,height:perfHeight,data:perfData},perfTrimap),performanceCase={pixels:perfCount,elapsedMs:performance.now()-perfStart,processMaxRSSKiB:process.resourceUsage().maxRSS,sourceUnchanged:hash(perfData)===perfSourceHash,report:perfResult.report}
await mkdir(target,{recursive:true});await writeFile(join(target,'comparison.png'),PNG.sync.write(grid))
const positiveRows=rows.filter(row=>row.expected==='supported'),negativeRows=rows.filter(row=>row.expected==='unsupported'),report={stage:'C1 independent trimap prototype; not integrated into the editor',status:positiveRows.every(row=>row.qualityPass&&row.constraintErrors===0&&row.sourceUnchanged)&&performanceCase.sourceUnchanged?'PASS_BOUNDED_SYNTHETIC_CASES':'FAIL',colorDomain:'encoded-sRGB',options:{sampleRadius:32,guidedRadius:2,guidedBlend:.1,minimumColorDistance:.05},columns,rows,totalMs:rows.reduce((sum,row)=>sum+row.elapsedMs,0),performanceCase,negativeCasesFailingTarget:negativeRows.filter(row=>!row.qualityPass).length,limitations:['Only opaque RGB guides are accepted. The translucent fixture is a flattened opaque composite with known object alpha, not a transparent PNG guide.','No natural-photo or Photoshop reference validation.','Constant known F/B colors are a restricted synthetic reference, not a physical linear-light model.','Missing anchors and low contrast preserve original unknown coverage. Spatially varying colors can produce wrong alpha.','RGB is preserved, so black/white/checker cutouts can still show flattened-background color contamination. No decontamination is implemented.','The core does not change current UI, history, project schema, or runtime capability declarations.']}
await writeFile(join(target,'acceptance.json'),JSON.stringify(report,null,2)+'\n')
await writeFile(join(target,'README.md'),'# C1 独立 trimap 细化基准\n\n'+`状态：${report.status}。参考与投影均在 encoded-sRGB 域，非 Photoshop 实测或物理线性光验证。\n\n`+'从上到下：'+rows.map(row=>row.name).join('；')+'。\n\n从左到右：'+columns.join('；')+'。\n\n| 夹具 | 预期范围 | unknown 区 alpha MAE | 原始 MAE | ≤0.03 | 说明 |\n| --- | --- | --- | --- | --- | --- |\n'+rows.map(row=>`| ${row.name} | ${row.expected} | ${row.alphaMAE.toFixed(5)} | ${row.baselineAlphaMAE.toFixed(5)} | ${row.qualityPass?'PASS':'FAIL'} | ${row.reason} |`).join('\n')+'\n\n原型仅接收 alpha 全为255的不透明 RGB guide；半透明夹具已合成到背景，不等于透明 PNG guide。原图 RGB 未去色边，因此黑白棋盘合成仍可能带原背景色污染。未知区颜色与锚点不一致时模型会失败；缺锚点/低对比会保留原覆盖率。尚无自然图30张、桌面交互、取消/Undo UI及 Photoshop 本体一致性证据。\n')
console.log(JSON.stringify({status:report.status,rows:rows.map(row=>({name:row.name,alphaMAE:row.alphaMAE,qualityPass:row.qualityPass,fallbackPixels:row.fallbackPixels,elapsedMs:row.elapsedMs})),performanceCase,comparison:join(target,'comparison.png'),report:join(target,'acceptance.json')},null,2))
if(report.status==='FAIL')process.exitCode=1
