"""Independent latest Compositor PatchPixels/HealPixels C oracle (macOS).
The production TypeScript is never called; existing 1.4.8 fixtures are untouched.
"""
import argparse,base64,ctypes,hashlib,json,math,pathlib,subprocess,tempfile
parser=argparse.ArgumentParser()
parser.add_argument('--source',default='/Users/zhoujin/Documents/PS/Compositor_Upstream/6aea90a/Compositor/Rendering')
parser.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
args=parser.parse_args();source=pathlib.Path(args.source);root=pathlib.Path(__file__).resolve().parents[1]
sdk=args.sdk if pathlib.Path(args.sdk).exists() else subprocess.check_output(['xcrun','--show-sdk-path'],text=True).strip()
def encode(values):return base64.b64encode(bytes(values)).decode()
cases=[('cropped-roi',240,192,9,7,255,0),('edge-hole',64,48,9,7,255,0),('transparent-hole',64,48,9,7,255,0),('texture-small-hole',64,48,9,7,255,0),('multiscale-gradient',96,80,33,29,255,1),('irregular-disconnected',64,64,7,11,255,2),('transparent-donors',64,48,9,7,170,0),('no-seven-pixel-source',8,8,3,3,255,0)]
with tempfile.TemporaryDirectory(prefix='patch-oracle-') as directory:
 libpath=pathlib.Path(directory)/'patch.dylib'
 flags=['-O2','-ffp-contract=off','-fblocks','-dynamiclib']
 subprocess.run(['xcrun','clang','-isysroot',sdk,*flags,str(source/'PatchPixels.c'),str(source/'HealPixels.c'),'-o',str(libpath)],check=True)
 lib=ctypes.CDLL(str(libpath));ptr=ctypes.POINTER(ctypes.c_uint8)
 lib.patch_fill.argtypes=[ptr,ctypes.c_size_t,ptr,ctypes.c_size_t,ctypes.c_int,ctypes.c_int,ctypes.c_uint32]
 lib.spot_heal.argtypes=[ptr,ptr,ctypes.c_size_t,ctypes.c_size_t,ctypes.c_size_t,ctypes.c_float,ctypes.c_int,ctypes.c_uint32]
 rows=[];heal=[]
 for name,w,h,hw,hh,alpha,pattern in cases:
  rgba=[];hole=[]
  for y in range(h):
   for x in range(w):
    if pattern==1:color=[(x*2+y)%256,(x+y*2)%256,(x*3+y*2)%256]
    else:color=[(x*13+y*7+31)%256,(x*5+y*19+73)%256,(x*11+y*3+119)%256]
    inside=abs(x-w//2)<hw//2+1 and abs(y-h//2)<hh//2+1
    if name=='edge-hole':inside=x<7 and y<5
    if pattern==2:inside=(x in range(9,14) and y in range(8,16)) or (x in range(35,42) and y in range(34,42))
    a=alpha if name=='transparent-donors' else 0 if name=='transparent-hole' and inside else 255
    if inside:color=[235,21,53]
    rgba.extend([math.floor(v*a/255+.5) for v in color]+[a]);hole.append(255 if inside else 0)
  for seed in ([0,148,987] if name=='texture-small-hole' else [148]):
   data=(ctypes.c_uint8*len(rgba))(*rgba);mask=(ctypes.c_uint8*len(hole))(*hole);status=lib.patch_fill(data,w*4,mask,w,w,h,seed)
   rows.append(dict(name=name,width=w,height=h,seed=seed,inputRGBA=encode(rgba),coverage=encode(hole),status=status,expectedRGBA=encode(data)))
  for mode,mode_name in enumerate(['content-aware','create-texture','proximity-match']):
   data=(ctypes.c_uint8*len(rgba))(*rgba);coverage=[128 if p and alpha<255 else p for p in hole];mask=(ctypes.c_uint8*len(coverage))(*coverage);opacity=.6 if alpha<255 else 1
   status=lib.spot_heal(data,mask,w,h,w*4,opacity,mode,148)
   heal.append(dict(name=name,width=w,height=h,seed=148,mode=mode_name,opacity=opacity,inputRGBA=encode(rgba),coverage=encode(coverage),status=status,expectedRGBA=encode(data)))
 metadata=dict(commit='6aea90a7ca88bfd8d38c26e858a3835a458afae1',generator='Unmodified latest PatchPixels.c + HealPixels.c compiled with clang; explicit float contraction disabled for portable Float32 oracle',flags=flags,sdk=sdk,sourceSHA256={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in ['PatchPixels.c','HealPixels.c']})
 (root/'fixtures/parity/native-6aea90a-patch.json').write_text(json.dumps(dict(**metadata,rows=rows),separators=(',',':')))
 (root/'fixtures/parity/native-6aea90a-healing.json').write_text(json.dumps(dict(**metadata,rows=heal),separators=(',',':')))
 print('Wrote independent latest C references:',len(rows),'PatchFill and',len(heal),'Heal')
