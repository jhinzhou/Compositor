/** Compare captured host/Electron PNGs without using GUI or changing pixels. */
import {readFileSync,writeFileSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {PNG} from 'pngjs'
const actualPath=process.argv[2]??'artifacts/alpha27-development-final/perspective-alpha27/affine-8-actual.png',expectedPath=process.argv[3]??'artifacts/alpha27-development-final/perspective-alpha27/affine-8-expected.png'
const actual=readFileSync(actualPath),expected=readFileSync(expectedPath),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex')
function chunks(bytes:Buffer){let p=8;const idat:Buffer[]=[],metadata:{type:string;sha256:string}[]=[];while(p+12<=bytes.length){const n=bytes.readUInt32BE(p),type=bytes.toString('ascii',p+4,p+8),data=bytes.subarray(p+8,p+8+n);assert.ok(p+12+n<=bytes.length);if(type==='IDAT')idat.push(data);else metadata.push({type,sha256:sha(data)});p+=n+12}assert.equal(p,bytes.length);return {metadata,filtered:inflateSync(Buffer.concat(idat))}}
const a=PNG.sync.read(actual),e=PNG.sync.read(expected),ac=chunks(actual),ec=chunks(expected)
assert.equal(a.width,e.width);assert.equal(a.height,e.height)
let channelsDiffer=0,maxDelta=0;const firstDifferences:{x:number;y:number;c:number;actual:number;expected:number}[]=[]
for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]-e.data[i]);if(d){channelsDiffer++;maxDelta=Math.max(maxDelta,d);if(firstDifferences.length<12)firstDifferences.push({x:Math.floor(i/4)%a.width,y:Math.floor(i/4/a.width),c:i%4,actual:a.data[i],expected:e.data[i]})}}
const encodedStreamsEqual=actual.equals(expected),metadataEqual=JSON.stringify(ac.metadata)===JSON.stringify(ec.metadata),inflatedFilterBytesEqual=ac.filtered.equals(ec.filtered)
const report={status:channelsDiffer?'DECODED_RGBA_DIFFERS':'DECODED_RGBA_EXACT',actualPath,expectedPath,actualBytes:actual.length,expectedBytes:expected.length,actualSHA256:sha(actual),expectedSHA256:sha(expected),actualDecodedRGBA_SHA256:sha(a.data),expectedDecodedRGBA_SHA256:sha(e.data),channelsDiffer,maxDelta,firstDifferences,encodedStreamsEqual,metadataEqual,inflatedFilterBytesEqual,diagnosis:channelsDiffer?'True decoded pixel differences: cannot attribute solely to compression':encodedStreamsEqual?'Encoded PNG bytes and decoded pixels are identical':inflatedFilterBytesEqual&&metadataEqual?'Identical PNG metadata, scanline filters and RGBA: only lossless IDAT deflate stream differs':'Decoded RGBA exact; PNG filter/chunk representation also differs, still lossless'}
writeFileSync(process.argv[4]??'artifacts/alpha27-perspective/png-encoding-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
if(channelsDiffer)process.exitCode=1
