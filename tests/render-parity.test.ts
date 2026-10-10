import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reactive} from 'vue'
import {expandedContentTransform,resizedParagraphBox} from '../src/shared/content-transform'
import {setInstalledFontCatalog,resolvedFont,fontAvailable} from '../src/renderer/content-raster'
import {lineContentGeometry} from '../src/renderer/content-interaction'

test('local effect padding remains centred through non-uniform scale, rotation and flips',()=>{
 const t={origin:[10,20] as [number,number],size:[200,60] as [number,number],rotation:90,flipX:true,flipY:false,sampling:'High quality' as const}
 const expanded=expandedContentTransform(t,[100,60],8)
 assert.deepEqual(expanded.origin,[-6,12]);assert.deepEqual(expanded.size,[232,76])
 assert.deepEqual([expanded.origin[0]+expanded.size[0]/2,expanded.origin[1]+expanded.size[1]/2],[110,50])
 assert.equal(expanded.rotation,90);assert.equal(expanded.flipX,true)
})

test('installed font catalog maps native PostScript faces to browser family with weight/style',()=>{
 setInstalledFontCatalog([{family:'Arial',postscriptName:'Arial-BoldItalicMT',fullName:'Arial Bold Italic',style:'Bold Italic'}])
 assert.deepEqual(resolvedFont('Arial-BoldItalicMT'),{family:'Arial',weight:'bold',fontStyle:'italic'})
 assert.equal(resolvedFont('Missing Native Font').family,'Missing Native Font')
 let value='';const context={set font(next:string){value=next},get font(){return value},measureText:()=>({width:value.includes('Arial')?80:value.includes('monospace')?100:120})}
 assert.equal(fontAvailable('Arial-BoldItalicMT',context),true)
 setInstalledFontCatalog([])
})

test('live line geometry covers all eight drag directions without switching diagonal at release',()=>{
 for(const [dx,dy] of [[30,0],[30,30],[0,30],[-30,30],[-30,0],[-30,-30],[0,-30],[30,-30]]){
  const start:[number,number]=[50,50],end:[number,number]=[50+dx,50+dy],g=lineContentGeometry(start,end,6)
  assert.ok(g.size.every(v=>v>0));assert.deepEqual(g.start.map((v,i)=>Math.round(g.origin[i]+v*g.size[i])),start)
  assert.deepEqual(g.end.map((v,i)=>Math.round(g.origin[i]+v*g.size[i])),end)
 }
})

test('paragraph resizing uses physical handle anchors through flipped text',()=>{
 const old={origin:[0,0] as [number,number],size:[200,160] as [number,number],rotation:0,flipX:true,flipY:true,sampling:'High quality' as const}
 const value=resizedParagraphBox(old,[100,80],[0,0],[100,80]);assert.deepEqual(value.transform.origin,[100,80]);assert.deepEqual(value.transform.size,[100,80]);assert.deepEqual(value.size,[50,40])
 const rotated=resizedParagraphBox({...old,rotation:90},[100,80],[0,0],[-80,100]);assert.deepEqual(rotated.transform.size,[100,80]);assert.deepEqual(rotated.transform.origin,[10,90])
})

test('local effects accept the reactive renderer transform without cloning a Vue proxy',()=>{
 const transform=reactive({origin:[10,20] as [number,number],size:[100,50] as [number,number],rotation:0,flipX:false,flipY:false,sampling:'High quality' as const})
 const value=expandedContentTransform(transform,[100,50],5);assert.deepEqual(value.origin,[5,15]);assert.deepEqual(value.size,[110,60]);assert.deepEqual(transform.origin,[10,20])
})
