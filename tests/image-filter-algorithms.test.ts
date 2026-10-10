import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gaussianLineConvolver,integratedGaussianKernel} from '../src/shared/image-filter-algorithms'
import {applyImageFilter} from '../src/shared/image-filters'
test('FFT Gaussian matches independent direct convolution for large kernels, transparent padding and clamped edges',()=>{
 for(const length of [7,129,513])for(const sigma of [6,64,250])for(const clamp of [false,true]){const input=Float32Array.from({length},(_,i)=>(i*73+17)%256),kernel=integratedGaussianKernel(sigma),radius=(kernel.length-1)/2,actual=gaussianLineConvolver(length,sigma,clamp)(input);let maximum=0;for(let x=0;x<length;x++){let value=0;for(let offset=-radius;offset<=radius;offset++){const at=x+offset;if(at>=0&&at<length)value+=input[at]*kernel[offset+radius];else if(clamp)value+=input[at<0?0:length-1]*kernel[offset+radius]}maximum=Math.max(maximum,Math.abs(actual[x]-value))}assert.ok(maximum<.00002,`${length}/${sigma}/${clamp}: ${maximum}`)}
 assert.throws(()=>gaussianLineConvolver(30001,1));assert.throws(()=>gaussianLineConvolver(1,NaN));assert.throws(()=>gaussianLineConvolver(2,1)(new Float32Array(3)))
})
test('large native Core Image Gaussian/Motion references bound premultiplied sample error for opaque and transparent surfaces',async()=>{
 const fixture=JSON.parse(await readFile('fixtures/parity/native-large-blur.json','utf8'));assert.equal(fixture.rows.length,14)
 const failures:string[]=[]
 for(const row of fixture.rows){const data=new Uint8ClampedArray(row.width*row.height*4);for(let y=0;y<row.height;y++)for(let x=0;x<row.width;x++){const at=(y*row.width+x)*4;if(row.pattern===0)data.set([x<row.width/2?230:30,y<row.height/2?40:190,(Math.floor(x/17)+Math.floor(y/23))%2===0?210:40,255],at);else if(x>=row.width/2-32&&x<row.width/2+32&&y>=row.height/2-32&&y<row.height/2+32)data.set([220,80,30,255],at)}const result=applyImageFilter({width:row.width,height:row.height,data},row.spec);let maximum=0;for(const [x,y,...expected] of row.samples){const at=(y*row.width+x)*4;for(let c=0;c<4;c++)maximum=Math.max(maximum,Math.abs(expected[c]-(c===3?result.data[at+3]:Math.round(result.data[at+c]*result.data[at+3]/255))))}if(maximum>2)failures.push(`${JSON.stringify(row.spec)} pattern=${row.pattern}: ${maximum}`)}
 assert.deepEqual(failures,[])
})
