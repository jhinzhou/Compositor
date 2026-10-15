"""Independent unchanged C split/merge oracle; byte operations are synthetic, not Core Image Camera Raw."""
import argparse,base64,ctypes,hashlib,json,pathlib,struct,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--source',default='/Users/zhoujin/Documents/PS/Compositor_Upstream/f5ae5ba/Compositor/Rendering');p.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');a=p.parse_args();s=pathlib.Path(a.source);root=pathlib.Path(__file__).resolve().parents[1];flags=['-O2','-ffp-contract=off','-fblocks','-dynamiclib']
def enc(v,k):return base64.b64encode(struct.pack('<'+k*len(v),*v)).decode()
def operation(v,kind):
 out=list(v)
 for i in range(0,len(v),4):
  r,g,b,alpha=v[i:i+4]
  colors=[r,g,b] if kind=='identity' else [alpha-r,alpha-g,alpha-b] if kind=='invert' else [min(alpha,(r*5+g*2+b)//7),min(alpha,(r+g*6+b*2)//8),min(alpha,(r*3+g+b*6)//9)] if kind=='mix' else [min(alpha,max(0,(x-80)*7)) for x in [r,g,b]]
  out[i:i+3]=colors
 return out
with tempfile.TemporaryDirectory(prefix='deep-filter-reference-') as d:
 target=pathlib.Path(d)/'deep.dylib';subprocess.run(['xcrun','clang','-isysroot',a.sdk,*flags,str(s/'DeepPixels.c'),'-o',str(target)],check=True);lib=ctypes.CDLL(str(target));u16=ctypes.POINTER(ctypes.c_uint16);u8=ctypes.POINTER(ctypes.c_uint8);size=ctypes.c_size_t;ptr3=u8*3
 lib.deep_split.argtypes=[u16,size,u8,size,size,size,ctypes.c_int,ctypes.c_int];lib.deep_merge.argtypes=[u16,size,u8,ptr3,ptr3,ptr3,size,u16,size,size,size,ctypes.c_int];rows=[]
 for seed in range(4):
  w,h=(11,73) if seed==3 else (19,7);values=[]
  for y in range(h):
   for x in range(w):
    i=y*w+x;alpha=[0,1,127,256,337,701,8193,16381,32767,49151,65535][(i+seed)%11];colors=[(i*701+seed*337)%(alpha+1),(i*997+seed*193)%(alpha+1),(i*337+seed*701)%(alpha+1)];values.extend(colors+[alpha])
  original=(ctypes.c_uint16*len(values))(*values)
  for kind in ['identity','invert','mix','bend','cameraRaw']:
   mixes=kind in ['mix','cameraRaw'];specs=[(0,-1)]+[(step,c) for step in [1,2,4] for c in ([0,1,2] if mixes else [-1])];runs=[];probes=[]
   for step,c in specs:
    probe=(ctypes.c_uint8*len(values))();lib.deep_split(original,w*8,probe,w*4,w,h,step,c);probes.append(dict(step=step,channel=c,bytes=enc(probe,'B')));runs.append((ctypes.c_uint8*len(values))(*operation(probe,kind)))
   filter=dict(kind='cameraRaw',temperature=23-seed*7,tint=-13+seed*5,saturation=17,contrast=13,exposure=-.3+seed*.1)
   if kind=='cameraRaw':
    callback=subprocess.run([str(root/'node_modules/.bin/tsx'),str(root/'scripts/deep-filter-byte-callback.ts')],input=json.dumps(dict(width=w,height=h,filter=filter,probes=[v['bytes'] for v in probes])),text=True,capture_output=True,check=True);runs=[(ctypes.c_uint8*len(values))(*base64.b64decode(v)) for v in json.loads(callback.stdout)]
   n=3 if mixes else 1;near=ptr3(*[ctypes.cast(v,u8) for v in runs[1:1+n]]);mid=ptr3(*[ctypes.cast(v,u8) for v in runs[1+n:1+2*n]]);far=ptr3(*[ctypes.cast(v,u8) for v in runs[1+2*n:1+3*n]]);result=(ctypes.c_uint16*len(values))();lib.deep_merge(original,w*8,runs[0],near,mid,far,w*4,result,w*8,w,h,int(mixes));rows.append(dict(name=kind+'-'+str(seed),kind=kind,mixes=mixes,width=w,height=h,input=enc(values,'H'),probes=probes,filter=filter if kind=='cameraRaw' else None,expected=enc(result,'H')))
 path=root/'fixtures/parity/native-f5ae5ba-deep-filter.json';path.write_text(json.dumps(dict(commit='f5ae5bad0b25b32dda9f254e62d2f07f59478698',sdk=a.sdk,flags=flags,sourceSHA256={n:hashlib.sha256((s/n).read_bytes()).hexdigest() for n in ['DeepPixels.c','DeepPixels.h']},rows=rows),separators=(',',':'))+'\n');print('Wrote',len(rows),'C cases',path)
