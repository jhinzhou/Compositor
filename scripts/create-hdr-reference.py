"""Compile unchanged f5ae5ba DeepPixels.c HDR kernels; no production TS calls."""
import argparse,base64,ctypes,hashlib,json,pathlib,struct,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--source',default='/Users/zhoujin/Documents/PS/Compositor_Upstream/f5ae5ba/Compositor/Rendering');p.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');a=p.parse_args();source=pathlib.Path(a.source);root=pathlib.Path(__file__).resolve().parents[1];flags=['-O2','-ffp-contract=off','-fblocks','-dynamiclib']
def enc(values,kind):return base64.b64encode(struct.pack('<'+kind*len(values),*values)).decode()
def half(v):return struct.unpack('<H',struct.pack('<e',v))[0]
with tempfile.TemporaryDirectory(prefix='hdr-native-reference-') as d:
 target=pathlib.Path(d)/'deep.dylib';subprocess.run(['xcrun','clang','-isysroot',a.sdk,*flags,str(source/'DeepPixels.c'),'-o',str(target)],check=True);lib=ctypes.CDLL(str(target));u16=ctypes.POINTER(ctypes.c_uint16);u8=ctypes.POINTER(ctypes.c_uint8);f32=ctypes.POINTER(ctypes.c_float);size=ctypes.c_size_t
 lib.deep_hdr_normalize.argtypes=[u16,size,u16,size,f32,size,size];lib.deep_hdr_restore.argtypes=[u16,size,f32,u16,size,size,size];lib.deep_hdr_exposure.argtypes=[u16,size,size,size,ctypes.c_float,ctypes.c_float,ctypes.c_float];lib.deep_take_painted_hdr.argtypes=[u16,size,u8,u8,size,size,size];lib.deep_extract_alpha_hdr.argtypes=[u16,size,f32,size,size];lib.deep_restore_alpha_hdr.argtypes=[u16,size,f32,size,size];lib.deep_half_peak.argtypes=[u16,size,size,size];lib.deep_half_peak.restype=ctypes.c_float
 rows=[]
 for seed in range(8):
  w,h=(11,73) if seed==7 else (13,7);values=[];base=[];paint=[]
  for y in range(h):
   for x in range(w):
    i=y*w+x;alpha=[0,2**-24,2**-14,.125,.5,1][(i+seed)%6];color=[((i*337+seed*701)%170)/20-.25,((i*701+seed*997)%130)/25,((i*193+seed*337)%230)/40];values.extend([half(v*alpha) for v in color]+[half(alpha)]);b=[0,0,0,0] if not alpha else [27,31,51,100];base.extend(b);paint.extend([13,29,47,157] if i%3==0 else b)
  original=(ctypes.c_uint16*len(values))(*values);normal=(ctypes.c_uint16*len(values))();scales=(ctypes.c_float*(w*h))();lib.deep_hdr_normalize(original,w*8,normal,w*8,scales,w,h);restored=(ctypes.c_uint16*len(values))();lib.deep_hdr_restore(normal,w*8,scales,restored,w*8,w,h);peak=lib.deep_half_peak(original,w*8,w,h)
  exposure=[-3,-1,0,.5,1,2,-2,-4][seed];offset=[0,.05,-.03,0,.1,-.04,0,0][seed];gamma=[1,1,1,1.2,.8,1,1.4,1][seed];exposed=(ctypes.c_uint16*len(values))(*values);lib.deep_hdr_exposure(exposed,w*8,w,h,2**exposure,offset,1/gamma)
  painted=(ctypes.c_uint16*len(values))(*values);b=(ctypes.c_uint8*len(base))(*base);q=(ctypes.c_uint8*len(paint))(*paint);lib.deep_take_painted_hdr(painted,w*8,q,b,w*4,w,h)
  extracted=(ctypes.c_uint16*len(values))(*values);alpha=(ctypes.c_float*(w*h))();lib.deep_extract_alpha_hdr(extracted,w*8,alpha,w,h);unclipped=list(extracted);lib.deep_restore_alpha_hdr(extracted,w*8,alpha,w,h)
  rows.append(dict(name='native-hdr-'+str(seed),width=w,height=h,inputHalfLE=enc(values,'H'),peak=peak,normalizedRGBA16LE=enc(normal,'H'),scalesFloat32LE=enc(scales,'f'),restoredHalfLE=enc(restored,'H'),exposure=dict(exposure=exposure,offset=offset,gamma=gamma),exposedHalfLE=enc(exposed,'H'),basePremultipliedRGBA8=enc(base,'B'),paintedPremultipliedRGBA8=enc(paint,'B'),paintedHalfLE=enc(painted,'H'),alphaExtractedHalfLE=enc(unclipped,'H'),alphaFloat32LE=enc(alpha,'f'),alphaRestoredHalfLE=enc(extracted,'H')))
 target=root/'fixtures/parity/native-f5ae5ba-hdr.json';target.write_text(json.dumps(dict(commit='f5ae5bad0b25b32dda9f254e62d2f07f59478698',generator='Unchanged native C HDR kernels via ctypes',flags=flags,sdk=a.sdk,sourceSHA256={n:hashlib.sha256((source/n).read_bytes()).hexdigest() for n in ['DeepPixels.c','DeepPixels.h']},rows=rows),separators=(',',':'))+'\n');print('Wrote',len(rows),'independent native HDR cases:',target)
