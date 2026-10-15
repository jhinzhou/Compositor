"""Independent paint merge oracle: compile the unchanged native C, no TS calls."""
import argparse,base64,ctypes,hashlib,json,pathlib,struct,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--source',default='/Users/zhoujin/Documents/PS/Compositor_Upstream/f01e298/Compositor/Rendering');p.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');a=p.parse_args();source=pathlib.Path(a.source);root=pathlib.Path(__file__).resolve().parents[1]
flags=['-O2','-ffp-contract=off','-fblocks','-dynamiclib']
def encode(values,kind):return base64.b64encode(struct.pack('<'+kind*len(values),*values)).decode()
with tempfile.TemporaryDirectory(prefix='deep-paint-oracle-') as d:
 libpath=pathlib.Path(d)/'deep.dylib';subprocess.run(['xcrun','clang','-isysroot',a.sdk,*flags,str(source/'DeepPixels.c'),'-o',str(libpath)],check=True);lib=ctypes.CDLL(str(libpath));lib.deep_take_painted.argtypes=[ctypes.POINTER(ctypes.c_uint16),ctypes.c_size_t,ctypes.POINTER(ctypes.c_uint8),ctypes.POINTER(ctypes.c_uint8),ctypes.c_size_t,ctypes.c_size_t,ctypes.c_size_t]
 rows=[]
 for name,w,h in [(kind+'-'+str(seed),w,h) for seed in range(8) for kind,w,h in [('mixed-alpha',13,7),('parallel-rows',7,73),('hard-bounds',11,11),('all-unchanged',9,3)]]:
  deep=[];base=[];paint=[]
  for y in range(h):
   for x in range(w):
    i=y*w+x;seed=int(name.rsplit('-',1)[1]);alpha=[0,1,64,128,257,30003,65535][(i+seed)%7];color=[(i*701+10001+seed*337)%65536,(i*997+20002+seed*701)%65536,(i*2999+30003+seed*1001)%65536];deep.extend([(v*alpha+32767)//65535 for v in color]+[alpha]);b=[round(v*alpha/65535/257) for v in color]+[round(alpha/257)];b[:3]=[min(v,b[3]) for v in b[:3]];base.extend(b);q=b[:]
    if not name.startswith('all-unchanged'):
     if i%4==1:q=[0,0,0,0]
     elif i%4==2:q=[47,71,93,173]
     elif i%4==3:q[0]=max(0,q[0]-1) if q[0] else min(q[3],1)
    paint.extend(q)
  native=(ctypes.c_uint16*len(deep))(*deep);b=(ctypes.c_uint8*len(base))(*base);q=(ctypes.c_uint8*len(paint))(*paint);lib.deep_take_painted(native,w*8,q,b,w*4,w,h);rows.append(dict(name=name,width=w,height=h,inputRGBA16LE=encode(deep,'H'),basePremultipliedRGBA8=encode(base,'B'),paintedPremultipliedRGBA8=encode(paint,'B'),expectedRGBA16LE=encode(native,'H')))
 target=root/'fixtures/parity/native-f01e298-deep-paint.json';target.write_text(json.dumps(dict(commit='f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9',generator='Unchanged native DeepPixels.c deep_take_painted via ctypes',flags=flags,sdk=a.sdk,sourceSHA256={n:hashlib.sha256((source/n).read_bytes()).hexdigest() for n in ['DeepPixels.c','DeepPixels.h']},rows=rows),separators=(',',':'))+'\n');print('Wrote',len(rows),'native C paint references:',target)
