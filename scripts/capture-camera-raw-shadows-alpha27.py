"""Capture pinned upstream C Shadows and its new Light ordering, never old fixtures.
Usage: python3 scripts/capture-camera-raw-shadows-alpha27.py [upstream checkout]
Requires macOS developer clang only for capture; checked-in tests need no native code.
"""
from pathlib import Path
import base64,ctypes as C,hashlib,json,lzma,math,struct,subprocess,sys,tempfile,zlib

root=Path(__file__).resolve().parents[1]
upstream=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'Compositor_Upstream/git-review-alpha27'
revision='43d691b67995e924965bcd520f8b300f96b7d5b8'
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=upstream,text=True).strip()==revision
render=upstream/'Compositor/Rendering';resource=(upstream/'Compositor/Resources/CameraRawShadows.bin').read_bytes()
assert hashlib.sha256(resource).hexdigest()=='76578539bc45a32817aff669c4e41523d7040f3c691ad35adf0723a70a89a705'
sets,amounts,x_count,k_count,terms=struct.unpack_from('<5h',resource,4)
normal_from,x_low,x_step,k_low,k_step=struct.unpack_from('<5f',resource,14)
amount_values=struct.unpack_from('<'+str(amounts)+'f',resource,34);per=x_count*k_count*terms
floats=struct.unpack_from('<'+str(sets*amounts*per)+'f',resource,34+amounts*4)
def f(v):return C.c_float(v).value
def coefficients(amount,scale,w,h):
 which=1 if max(w,h)/scale>=normal_from else 0
 points=[(a,floats[(which*amounts+i)*per:(which*amounts+i+1)*per]) for i,a in enumerate(amount_values)]+[(0,None)]
 points.sort(key=lambda p:p[0]);v=max(points[0][0],min(points[-1][0],amount));index=0
 while index<len(points)-2 and v>points[index+1][0]:index+=1
 low,lower=points[index];high,upper=points[index+1];t=f((v-low)/(high-low))
 return [f(f((lower[i] if lower else 0)*f(1-t))+f((upper[i] if upper else 0)*t)) for i in range(per)]
def packed(raw):return {'rgbaZlib':base64.b64encode(zlib.compress(bytes(raw),9)).decode(),'sha256':hashlib.sha256(bytes(raw)).hexdigest()}
U8=C.c_ubyte;F=C.c_float;D=C.c_double
class Stage(C.Structure):_fields_=[('table',C.POINTER(U8)*8),('weight',F*8)]
atlas=(upstream/'Compositor/Resources/CameraRawTables.bin').read_bytes();dimension=struct.unpack_from('<h',atlas,4)[0];table_count=struct.unpack_from('<h',atlas,6)[0];quantum=struct.unpack_from('<h',atlas,8)[0]
assert atlas[:4]==b'CRT3' and dimension==17 and table_count==763
planes=lzma.decompress(atlas[10:]);cells=dimension**3;entries=cells*3;decoded=bytearray(len(planes));levels=[int(i*255/16+.5) for i in range(17)]
for t in range(table_count):
 for channel in range(3):
  running=0
  for cell in range(cells):
   running=(running+planes[(t*3+channel)*cells+cell])&255;axis=cell//289 if channel==0 else cell//17%17 if channel==1 else cell%17
   decoded[t*entries+cell*3+channel]=max(0,min(255,levels[axis]+(running if running<128 else running-256)*quantum))
with tempfile.TemporaryDirectory(prefix='camera-shadows-alpha27-') as directory:
 library=Path(directory)/'native.dylib';args=['clang','-shared','-fPIC','-fblocks','-O2',str(render/'AdjustPixels.c'),str(render/'LensPixels.c'),'-o',str(library),'-lm']
 sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
 if sdk.exists():args[1:1]=['-isysroot',str(sdk)]
 subprocess.run(args,check=True);lib=C.CDLL(str(library));table=(U8*len(decoded)).from_buffer_copy(decoded)
 def between(v,points):
  v=max(points[0],min(points[-1],v));index=0
  while index<len(points)-2 and v>points[index+1]:index+=1
  return index,(v-points[index])/(points[index+1]-points[index])
 def stage(ids,weights):
  ptr=lambda i:C.cast(C.byref(table,i*entries),C.POINTER(U8))
  return Stage((C.POINTER(U8)*8)(*[ptr(i) for i in ids],*[None]*(8-len(ids))),(F*8)(*weights,*[0]*(8-len(weights))))
 def regular(start,v,lo,step,n):
  p=max(0,min(n-1,(v-lo)/step));i=min(n-2,int(p));up=p-i;return stage([start+i,start+i+1],[1-up,up])
 def adaptive(start,v,level):
  r,down=between(level,[53,80,104,130,160,190,224]);c,across=between(v,[-100,-50,-25,0,25,50,100]);base=start+r*7+c
  return stage([base,base+1,base+7,base+8],[(1-down)*(1-across),(1-down)*across,down*(1-across),down*across])
 def light_stages(settings,brightness):
  before=[];after=[]
  for i,key in enumerate(['redHue','redSaturation','greenHue','greenSaturation','blueHue','blueSaturation']):
   if settings.get('calibration',{}).get(key):before.append(regular(405+i*5,settings['calibration'][key],-100,50,5))
  if settings.get('exposure'):before.append(regular(81,settings['exposure'],-5,.5,21))
  if settings.get('temperature') or settings.get('tint'):
   r,down=between(settings.get('temperature',0),list(range(-100,101,25)));c,across=between(settings.get('tint',0),list(range(-100,101,25)));base=r*9+c
   before.append(stage([base,base+1,base+9,base+10],[(1-down)*(1-across),(1-down)*across,down*(1-across),down*across]))
  for key,start,index in [('contrast',138,0),('highlights',187,2)]:
   if settings.get(key):before.append(adaptive(start,settings[key],brightness[index]))
  for key,start in [('whites',102),('blacks',111),('saturation',120),('vibrance',129)]:
   if settings.get(key):after.append(regular(start,settings[key],-100,25,9))
  return before,after
 def run_shadows(data,w,h,amount,scale=1):
  values=(F*per)(*coefficients(amount,scale,w,h));lib.adjust_camera_raw_shadows(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),values,C.c_int(x_count),F(x_low),F(x_step),C.c_int(k_count),F(k_low),F(k_step))
 def run_light(source,w,h,settings):
  data=(U8*len(source)).from_buffer_copy(source);stats=(D*3)();lib.camera_raw_statistics(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),stats);before,after=light_stages(settings,[v*255 for v in stats])
  for stages,shadows_after in [(before,True),(after,False)]:
   if stages:
    out=(F*(33**3*3))();lib.camera_raw_compose(out,C.c_int(33),(Stage*len(stages))(*stages),C.c_int(len(stages)),C.c_int(17));lib.adjust_camera_raw(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),out,C.c_int(33),C.c_int(0))
   if shadows_after:run_shadows(data,w,h,settings['shadows'])
  return bytes(data)
 # Preserve historic files. These seven same-input expectations replace ONLY old Shadows behavior in their test.
 old=json.loads((root/'tests/fixtures/camera-raw-upstream.json').read_text());replacements={}
 for case in old['cases']:
  if not case['settings'].get('shadows'):continue
  source=bytearray(case['input'])
  if case.get('premultipliedExpected'):
   for at in range(0,len(source),4):
    for c in range(3):source[at+c]=int(source[at+c]*source[at+3]/255+.5)
  result=run_light(source,case['width'],case['height'],case['settings'])
  replacements[case['name']]={'inputSHA256':hashlib.sha256(bytes(case['input'])).hexdigest(),'expected':list(result),'premultipliedExpected':bool(case.get('premultipliedExpected'))}
 # Independent colored, alpha and flat-region probes, with both original-size coefficient sets.
 probes=[]
 w,h=80,64;source=bytearray(w*h*4)
 for y in range(h):
  for x in range(w):
   at=(y*w+x)*4;sky=y<h//2;value=150+(x*7+y*11)%65 if sky else 6+(x*13+y*17)%30;alpha=255 if x<60 else [0,64,128,192][x%4]
   source[at:at+4]=bytes([int(min(255,value+d)*alpha/255+.5) for d in [0,5,11]]+[alpha])
 for amount in [-100,-73,-50,-1,25,50,68,100]:
  for scale in [1,.05]:
   data=(U8*len(source)).from_buffer_copy(source);run_shadows(data,w,h,amount,scale)
   probes.append({'name':f'texture-alpha-{amount}-scale-{scale}','width':w,'height':h,'amount':amount,'samplingScale':scale,'source':packed(source),'expected':packed(data)})
 for name,w,h,color in [('flat-gray',31,17,[32,32,32,255]),('flat-black',13,9,[0,0,0,255]),('fully-transparent',9,7,[0,0,0,0]),('thin-panorama',1100,1,[15,26,38,255])]:
  source=bytes(color)*(w*h);data=(U8*len(source)).from_buffer_copy(source);run_shadows(data,w,h,100)
  probes.append({'name':name,'width':w,'height':h,'amount':100,'samplingScale':1,'source':packed(source),'expected':packed(data)})
 # The >=768px short side also executes native downsampled guided-plane mapping.
 w,h=1200,800;source=bytearray(w*h*4)
 for y in range(h):
  for x in range(w):
   v=145+(x*7+y*11)%80 if y<h//2 else 7+(x*13+y*17)%38
   source[(y*w+x)*4:(y*w+x)*4+4]=bytes([v,min(255,v+3),min(255,v+9),255])
 for amount in [-73,68]:
  data=(U8*len(source)).from_buffer_copy(source);run_shadows(data,w,h,amount)
  probes.append({'name':f'normal-downsampled-plane-{amount}','width':w,'height':h,'amount':amount,'samplingScale':1,'source':packed(source),'expected':packed(data)})
 pipeline_probes=[]
 ramp=bytes([channel for v in range(256) for channel in [v,v,v,255]])
 for settings in [{'shadows':100},{'shadows':-100},{'shadows':80,'highlights':-90}]:
  result=run_light(ramp,256,1,settings)
  falls=[[v,result[(v-1)*4],result[v*4]] for v in range(1,256) if result[v*4]<result[(v-1)*4]]
  pipeline_probes.append({'name':'gray-ramp-'+str(settings),'width':256,'height':1,'settings':settings,'source':packed(ramp),'expected':packed(result),'nativeFalls':falls})
 fixture={'referenceKind':'upstream-native-C','upstream':revision,'algorithmCommit':'735c2cc23c0efe7c2c2f85a66741b253e053cf2b','kernelSHA256':hashlib.sha256((render/'AdjustPixels.c').read_bytes()).hexdigest(),'resourceSHA256':hashlib.sha256(resource).hexdigest(),'license':'MIT','limits':'C RGBA8 transfer reference, not independent Photoshop pixel parity or native RGB16/HDR reference. Historic raw fixture unchanged.','legacyCaseReplacements':replacements,'cases':probes,'pipelineCases':pipeline_probes}
 output=root/'fixtures/parity/native-735c2cc-camera-raw-shadows-alpha27.json';output.write_text(json.dumps(fixture,separators=(',',':'))+'\n');print(output,len(probes),'actual C probes and',len(replacements),'same-input pipeline replacements')
