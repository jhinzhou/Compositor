/** Kept separate from the Electron main bundle so codecs remain replaceable runtime files. */
export const FOREIGN_WORKER_SOURCE = String.raw`
const {parentPort,workerData,Worker}=require('node:worker_threads');
const fs=require('node:fs');const{pathToFileURL}=require('node:url');
const children=[];let raw;
const check=(w,h)=>{if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>workerData.maxSide||h>workerData.maxSide||w*h>workerData.maxPixels)throw Error('Image dimensions exceed resource limits')};
const srgb=x=>x<=.0031308?12.92*x:1.055*Math.max(0,x)**(1/2.4)-.055;
const gamma=x=>workerData.color.transfer===8?x:workerData.color.transfer===13||workerData.color.transfer===undefined?(x<=.04045?x/12.92:((x+.055)/1.055)**2.4):(x<.081?x/4.5:((x+.099)/1.099)**(1/.45));
const convert=(rgba)=>{const c=workerData.color;if(!c.matrix&&!c.primaries)return;const matrix=c.matrix||(c.primaries===12?[1.224745,-.224904,0,-.042058,1.042081,0,-.019642,-.078655,1.098537]:[1,0,0,0,1,0,0,0,1]);for(let i=0;i<rgba.length;i+=4){const rgb=[0,1,2].map(k=>c.curves?c.curves[k][rgba[i+k]]:gamma(rgba[i+k]/255));for(let k=0;k<3;k++)rgba[i+k]=Math.round(Math.max(0,Math.min(1,srgb(matrix[k*3]*rgb[0]+matrix[k*3+1]*rgb[1]+matrix[k*3+2]*rgb[2])))*255)}};
(async()=>{
 let result;
 if(workerData.format==='raw'){
  // libraw-wasm is built for web/worker. Map its optional pthread workers to Node worker_threads.
  globalThis.WorkerGlobalScope=class{};globalThis.self=globalThis;globalThis.name='';
  globalThis.Worker=class{
   constructor(url,options){const source="const{parentPort,workerData}=require('node:worker_threads');globalThis.WorkerGlobalScope=class{};globalThis.self=globalThis;globalThis.name='em-pthread';globalThis.postMessage=(data,transfer)=>parentPort.postMessage(data,transfer);let pending=[];parentPort.on('message',data=>{if(globalThis.onmessage)globalThis.onmessage({data});else pending.push(data)});import(workerData.url).then(()=>{for(const data of pending)globalThis.onmessage?.({data});pending=[]}).catch(error=>{throw error});";this.worker=new Worker(source,{eval:true,workerData:{url:String(url)}});children.push(this.worker);this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}
   postMessage(data,transfer){this.worker.postMessage(data,transfer)}terminate(){return this.worker.terminate()}
   addEventListener(type,fn){if(type==='message')this.onmessage=fn;else if(type==='error')this.onerror=fn}
  };
  const factory=(await import(pathToFileURL(workerData.rawModule).href)).default;
  const module=await factory({wasmBinary:new Uint8Array(fs.readFileSync(workerData.rawWasm)),wasmMemory:new WebAssembly.Memory({initial:4096,maximum:8192,shared:true}),printErr:()=>{}});
  raw=new module.LibRaw();const opts=workerData.raw;
  raw.open(workerData.bytes,{outputColor:1,outputBps:16,gamm:[1,1],userFlip:-1,useCameraMatrix:1,useCameraWb:opts.whiteBalance==='camera',useAutoWb:opts.whiteBalance==='auto',halfSize:opts.halfSize,noAutoBright:!opts.autoBright,expCorrec:true,expShift:2**opts.exposureEV,expPreser:1,highlight:opts.highlightMode,userQual:3});
  const metadata=raw.metadata(false);check(metadata.width,metadata.height);check(metadata.raw_width,metadata.raw_height);if(metadata.raw_width*metadata.raw_height*20+workerData.bytes.length>workerData.wasmBytes)throw Error('RAW sensor exceeds the 512 MiB decoder memory budget; reduce the source sensor size outside this editor');
  parentPort.postMessage({type:'metadata',width:metadata.width,height:metadata.height,metadata});if(workerData.metadataOnly){parentPort.postMessage({type:'metadata-result',width:metadata.width,height:metadata.height,metadata});return;}
  const image=raw.imageData();if(!image||image.bits!==16||image.colors!==3||image.data.length!==image.width*image.height*3)throw Error('RAW decoder did not return linear RGB16');check(image.width,image.height);
  const rgba=new Uint8Array(image.width*image.height*4);
  for(let i=0,j=0;i<image.data.length;i+=3,j+=4){rgba[j]=Math.round(Math.max(0,Math.min(1,srgb(image.data[i]/65535)))*255);rgba[j+1]=Math.round(Math.max(0,Math.min(1,srgb(image.data[i+1]/65535)))*255);rgba[j+2]=Math.round(Math.max(0,Math.min(1,srgb(image.data[i+2]/65535)))*255);rgba[j+3]=255}
  result={width:image.width,height:image.height,rgba,metadata,colorProfile:'LibRaw linear sRGB → RGBA8 sRGB',orientationApplied:true,warnings:['RAW white balance, demosaic, exposure, orientation and sRGB conversion are baked into an RGBA8 layer; original sensor precision and RAW editability are not retained.']};
 }else{
  const module=await require(workerData.heifModule)({wasmBinary:fs.readFileSync(workerData.heifWasm),print:()=>{},printErr:()=>{}});
  const allocate=module.heif_context_alloc;module.heif_context_alloc=()=>{const context=allocate();const ptr=module._heif_context_get_security_limits(context.$$.ptr);const view=new DataView(module.HEAPU8.buffer);if(!ptr||view.getUint8(ptr)!==4)throw Error('Unsupported libheif security-limits ABI');view.setBigUint64(ptr+8,BigInt(Math.min(workerData.maxPixels,workerData.decoderPixels)),true);view.setBigUint64(ptr+16,4096n,true);view.setUint32(ptr+28,4096,true);view.setUint32(ptr+32,1024*1024,true);view.setBigUint64(ptr+40,BigInt(workerData.wasmBytes/2),true);view.setUint32(ptr+60,16384,true);view.setBigUint64(ptr+64,BigInt(workerData.wasmBytes),true);view.setUint32(ptr+80,64,true);view.setUint32(ptr+84,64,true);return context};
  const decoder=new module.HeifDecoder(),images=decoder.decode(workerData.bytes);
  if(!images.length||images.length>64)throw Error('HEIF has no decodable still or too many top-level images');
  const image=images.find(image=>image.is_primary())||images[0];const width=image.get_width(),height=image.get_height();check(width,height);if(width*height>workerData.decoderPixels)throw Error('HEIF primary image exceeds the 512 MiB decoder memory budget');
  parentPort.postMessage({type:'metadata',width,height,metadata:{imageCount:images.length}});
  const display=await new Promise((resolve,reject)=>image.display({data:new Uint8ClampedArray(width*height*4),width,height},data=>data?resolve(data):reject(Error('HEIF pixel decoding failed'))));
  const rgba=new Uint8Array(display.data.buffer,display.data.byteOffset,display.data.byteLength);if(image.is_premultiplied_alpha()){for(let i=0;i<rgba.length;i+=4){const alpha=rgba[i+3];for(let k=0;k<3;k++)rgba[i+k]=alpha?Math.min(255,Math.round(rgba[i+k]*255/alpha)):0}}convert(rgba);
  result={width,height,rgba,metadata:{imageCount:images.length,hasAlpha:image.has_alpha_channel()},colorProfile:workerData.color.label,orientationApplied:true,warnings:[...workerData.color.warnings,'Only the HEIF primary still is imported as RGBA8; sequences, depth maps, gain maps and original high-bit-depth samples are not retained.']};
  for(const item of images)item.free();module.heif_context_free(decoder.decoder);
 }
 if(workerData.pngjs){const{PNG}=require(workerData.pngjs);const png=new PNG({width:result.width,height:result.height});png.data=Buffer.from(result.rgba);const bytes=PNG.sync.write(png);parentPort.postMessage({type:'result',...result,png:bytes},[result.rgba.buffer]);}else parentPort.postMessage({type:'result',...result},[result.rgba.buffer]);
})().catch(error=>parentPort.postMessage({type:'error',message:error instanceof Error?error.message:String(error)})).finally(async()=>{try{raw?.delete()}catch{}await Promise.all(children.map(worker=>worker.terminate()));parentPort.close()});
`
