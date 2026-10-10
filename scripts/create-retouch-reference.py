"""Regenerate independent Compositor 1.4.8 HealPixels.c references (macOS clang).
No production TypeScript is called. Original source must be the exact 1.4.8 checkout.
"""
import argparse,ctypes,json,math,pathlib,subprocess,tempfile
parser=argparse.ArgumentParser();parser.add_argument('--source',default=str(pathlib.Path(__file__).resolve().parents[2]/'Compositor/Compositor/Rendering'));parser.add_argument('--sdk',default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='native-heal-') as directory:
 libpath=pathlib.Path(directory)/'heal.dylib';subprocess.run(['xcrun','clang','-isysroot',args.sdk,'-O2','-dynamiclib',str(pathlib.Path(args.source)/'HealPixels.c'),'-o',str(libpath)],check=True)
 lib=ctypes.CDLL(str(libpath));lib.spot_heal.argtypes=[ctypes.POINTER(ctypes.c_uint8),ctypes.POINTER(ctypes.c_uint8),ctypes.c_size_t,ctypes.c_size_t,ctypes.c_size_t,ctypes.c_float,ctypes.c_int,ctypes.c_uint32]
 rows=[]
 for width,height,hole,alpha in [(64,48,5,255),(64,48,5,160),(80,72,18,255)]:
  rgba=[];coverage=[]
  for y in range(height):
   for x in range(width):
    a=alpha if (x+y)%7 else max(0,alpha-64);color=[(x*13+y*7+31)%256,(x*5+y*19+73)%256,(x*11+y*3+119)%256]
    if abs(x-width//2)<hole and abs(y-height//2)<hole:color=[235,21,53]
    rgba.extend([math.floor(v*a/255+.5) for v in color]+[a]);coverage.append(255 if abs(x-width//2)<hole and abs(y-height//2)<hole else 0)
  for mode,name in enumerate(['content-aware','create-texture','proximity-match']):
   opacity=.6 if alpha<255 else 1;data=(ctypes.c_uint8*len(rgba))(*rgba);mask=(ctypes.c_uint8*len(coverage))(*coverage);status=lib.spot_heal(data,mask,width,height,width*4,opacity,mode,148);assert status==0
   rows.append(dict(width=width,height=height,rgba=rgba,coverage=coverage,opacity=opacity,mode=name,seed=148,expected=list(data)))
 (root/'fixtures/parity/native-1.4.8-healing.json').write_text(json.dumps(dict(commit='24ef2885daae750537ec8d094f33e8556a8dfc9a',generator='Original HealPixels.c compiled unmodified with clang -O2; premultiplied RGBA8',rows=rows),separators=(',',':')))
 print('Wrote',len(rows),'native healing references')
