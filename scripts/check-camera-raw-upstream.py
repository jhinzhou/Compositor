"""Generate portable Camera Raw regression fixtures from the actual upstream C.
Run: python3 scripts/check-camera-raw-upstream.py [upstream repo]
No C/Swift compiler or upstream checkout is needed to run the resulting TS tests.
"""
from pathlib import Path
import ctypes as C, json, math, subprocess, sys, tempfile, zlib, lzma, hashlib, base64
root=Path(__file__).resolve().parents[1]; upstream=Path(sys.argv[1]) if len(sys.argv)>1 else root.parent/'Compositor_Upstream/d0ec2f3'
render=upstream/'Compositor/Rendering'; source=upstream/'Compositor/Resources/CameraRawTables.bin'
raw=source.read_bytes(); size=int.from_bytes(raw[4:6],'little');count=int.from_bytes(raw[6:8],'little');cells=size**3;entries=cells*3
assert size==17 and raw[:4] in (b'CRT2',b'CRT3')
quantum=int.from_bytes(raw[8:10],'little') if raw[:4]==b'CRT3' else 1
planes=lzma.decompress(raw[10:]) if raw[:4]==b'CRT3' else zlib.decompress(raw[8:],-15)
assert count==763 and len(planes)==count*entries, 'Use the pinned d0ec2f3 Camera Raw source; older resources cannot replace the current atlas.'
binary=bytearray(len(planes));levels=[int(i*255/16+.5) for i in range(17)]
for t in range(count):
 for ch in range(3):
  running=0
  for cell in range(cells):
   running=(running+planes[(t*3+ch)*cells+cell])&255;axis=cell//289 if ch==0 else cell//17%17 if ch==1 else cell%17
   binary[t*entries+cell*3+ch]=max(0,min(255,levels[axis]+(running if running<128 else running-256)*quantum)) if raw[:4]==b'CRT3' else (running+levels[axis])&255
revision='d0ec2f35b6358108ac3e59593da1688deb83a559' if count==763 else '75147a27d90c681215151a6301373dd2b07b7aa2'
data_source=root/'src/shared/camera-raw-table-data.ts'
data_source.write_text('// Generated from Compositor '+revision+' CameraRawTables.bin (MIT). '+str(count)+' measured 17-cube RGB tables.\n// Source SHA256 '+hashlib.sha256(raw).hexdigest()+'; decoded SHA256 '+hashlib.sha256(binary).hexdigest()+'\nexport const CAMERA_RAW_TABLE_METADATA = '+json.dumps({'size':size,'count':count,'step':quantum,'format':3 if raw[:4]==b'CRT3' else 2})+'\nexport const CAMERA_RAW_TABLE_PLANES_ZLIB = '+json.dumps(base64.b64encode(zlib.compress(planes,9)).decode())+'\n')
U8=C.c_ubyte; D=C.c_double; F=C.c_float
class Stage(C.Structure): _fields_=[('table',C.POINTER(U8)*8),('weight',F*8)]
with tempfile.TemporaryDirectory(prefix='compositor-camera-c-') as tmp:
 libpath=Path(tmp)/'upstream.dylib';args=['clang','-shared','-fPIC','-fblocks','-O2',str(render/'AdjustPixels.c'),str(render/'LensPixels.c'),'-o',str(libpath),'-lm']
 sdk=Path('/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
 if sdk.exists():args[1:1]=['-isysroot',str(sdk)]
 subprocess.run(args,check=True); lib=C.CDLL(str(libpath))
 table=(U8*len(binary)).from_buffer_copy(binary)
 def pointer(index):return C.cast(C.byref(table,index*entries),C.POINTER(U8))
 def stage(ids,weights):return Stage((C.POINTER(U8)*8)(*[pointer(i) if i>=0 else None for i in ids],*[None]*(8-len(ids))),(F*8)(*weights,*[0]*(8-len(weights))))
 def between(value,points):
  v=max(points[0],min(points[-1],value));i=0
  while i<len(points)-2 and v>points[i+1]:i+=1
  return i,(v-points[i])/(points[i+1]-points[i])
 def white(temp,tint):
  r,d=between(temp,list(range(-100,101,25)));c,a=between(tint,list(range(-100,101,25)));base=r*9+c
  return stage([base,base+1,base+9,base+10],[(1-d)*(1-a),(1-d)*a,d*(1-a),d*a])
 def regular(start,v,lo,step,n):
  p=max(0,min(n-1,(v-lo)/step));i=min(n-2,int(p));f=p-i;return stage([start+i,start+i+1],[1-f,f])
 def adaptive(start,v,brightness):
  r,d=between(brightness,[53,80,104,130,160,190,224]);c,a=between(v,[-100,-50,-25,0,25,50,100]);base=start+r*7+c
  return stage([base,base+1,base+7,base+8],[(1-d)*(1-a),(1-d)*a,d*(1-a),d*a])
 def stats(image,w,h):
  data=(U8*len(image))(*image);out=(D*3)();lib.camera_raw_statistics(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),out);return [x*255 for x in out]
 def mixer(s):
  result=[]
  for kind,key in enumerate(['luminance','saturation','hue']):
   for color,value in enumerate(s.get(key,[0]*8)):
    if value:result.append(regular(285+(kind*8+color)*5,value,-100,50,5))
  return result
 def grading(s):
  result=[];wheels=[s.get(key,{}) for key in ['shadows','midtones','highlights','global']]
  for i,wheel in enumerate(wheels):
   if wheel.get('luminance'):result.append(regular(743+i*5,wheel['luminance'],-100,50,5))
  balance=s.get('balance',0)/100;highlightShare=max(0,1+1.4*balance if balance<0 else 1+2*balance);shadowShare=max(0,1-1.2*balance if balance<0 else 1-1.4*balance);blendLow,blendUp=between(s.get('blending',50),[0,50,100])
  def section(blend,wheel):return 455+(wheel*36 if blend==0 else 72+wheel*36 if blend==1 else 216+wheel*36)
  for i,share,blends in [(3,1,False),(2,1,False),(1,highlightShare,True),(0,shadowShare,True)]:
   color=wheels[i];sat=color.get('saturation',0)*share
   if sat<=0:continue
   position=color.get('hue',0)%360/30;first=int(position)%12;around=position-int(position);level,up=between(sat,[0,25,50,100]);ids=[];weights=[]
   for blend,bw in [(blendLow,1-blendUp),(blendLow+1,blendUp)] if blends else [(1,1)]:
    for hue,hw in [(first,1-around),((first+1)%12,around)]:
     for saturation,sw in [(level,1-up),(level+1,up)]:ids.append(-1 if saturation==0 else section(blend,i)+hue*3+saturation-1);weights.append(bw*hw*sw)
   result.append(stage(ids,weights))
  return result
 def curves(s):
  linear=[{'x':0,'y':0},{'x':1,'y':1}]
  def point(x,points):
   i=0
   while i<len(points)-2 and points[i+1]['x']<=x:i+=1
   d=[(b['y']-a['y'])/(b['x']-a['x']) for a,b in zip(points,points[1:])]
   def slope(j):return d[0] if j==0 else d[-1] if j==len(points)-1 else 0 if d[j-1]*d[j]<=0 else 2/(1/d[j-1]+1/d[j])
   h=points[i+1]['x']-points[i]['x'];t=max(0,min(1,(x-points[i]['x'])/h))
   return max(0,min(1,(2*t**3-3*t*t+1)*points[i]['y']+(t**3-2*t*t+t)*h*slope(i)+(-2*t**3+3*t*t)*points[i+1]['y']+(t**3-t*t)*h*slope(i+1)))
  def bend(t,lower,low,upper,high):return lower*(t/lower)**(2**(-low/100*1.66)) if t<lower and lower>0 else 1-(1-upper)*((1-t)/(1-upper))**(2**(high/100*1.66)) if t>upper and upper<1 else t
  measured=s.get('shadowSplit',25)==25 and s.get('darkSplit',50)==50 and s.get('lightSplit',75)==75 and s.get('refineSaturation',0)==0
  anchors=[{'x':i/32,'y':bend(bend(i/32,s.get('shadowSplit',25)/100,s.get('shadows',0),s.get('lightSplit',75)/100,s.get('highlights',0)),s.get('darkSplit',50)/100,s.get('darks',0),s.get('darkSplit',50)/100,s.get('lights',0))} for i in range(33)]
  tone=(F*256)(*[point(i/255 if measured else point(i/255,anchors),s.get('rgb',linear)) for i in range(256)])
  return tone,[(F*256)(*[point(i/255,s.get(channel,linear)) for i in range(256)]) for channel in ['red','green','blue']],measured
 def light(image,w,h,s,clip=0):
  bright=stats(image,w,h);stages=[]
  calibration=s.get('calibration',{})
  for i,k in enumerate(['redHue','redSaturation','greenHue','greenSaturation','blueHue','blueSaturation']):
   if calibration.get(k):stages.append(regular(405+i*5,calibration[k],-100,50,5))
  if s.get('exposure'):stages.append(regular(81,s['exposure'],-5,.5,21))
  if s.get('temperature') or s.get('tint'):stages.append(white(s.get('temperature',0),s.get('tint',0)))
  for key,start,index in [('contrast',138,0),('highlights',187,2),('shadows',236,1)]:
   if s.get(key):stages.append(adaptive(start,s[key],bright[index]))
  for key,start in [('whites',102),('blacks',111),('saturation',120),('vibrance',129)]:
   if s.get(key):stages.append(regular(start,s[key],-100,25,9))
  curve=s.get('curve',{});tone,channels,measured=curves(curve)
  for i,k in enumerate(['shadows','darks','lights','highlights']):
   if measured and curve.get(k):stages.append(regular(435+i*5,curve[k],-100,50,5))
  out=(F*(33**3*3))();packed=(Stage*len(stages))(*stages);lib.camera_raw_compose(out,C.c_int(33),packed,C.c_int(len(stages)),C.c_int(17))
  folded=not s.get('mixer',{}).get('points') and curve.get('refineSaturation',0)==0
  color_stages=mixer(s.get('mixer',{}))+grading(s.get('grading',{}));color_packed=(Stage*len(color_stages))(*color_stages)
  if folded:
   lib.camera_raw_table_curves(out,C.c_int(33),tone,*channels)
   if color_stages:lib.camera_raw_compose_onto(out,C.c_int(33),color_packed,C.c_int(len(color_stages)),C.c_int(17))
  data=(U8*len(image))(*image);lib.adjust_camera_raw(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),out if stages or color_stages or curve else None,C.c_int(33),C.c_int(clip))
  if not folded:
   def compose(stages):
    if not stages:return None
    table=(F*(33**3*3))();lib.camera_raw_compose(table,C.c_int(33),(Stage*len(stages))(*stages),C.c_int(len(stages)),C.c_int(17));return table
   points=s.get('mixer',{}).get('points',[]);point_values=[]
   for p in points:point_values += [p.get('hue',0)/360,p.get('saturation',0),p.get('luminance',0),p.get('hueShift',0)/100,p.get('saturationShift',0)/100,p.get('luminanceShift',0)/100,p.get('hueRange',30)/360,p.get('saturationRange',.4),p.get('luminanceRange',.4)]
   lib.adjust_camera_raw_curve_color(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),tone,*channels,D(curve.get('refineSaturation',0)/100),(F*24)(),C.c_int(len(points)),(F*len(point_values))(*point_values),(F*12)(),D(s.get('grading',{}).get('blending',50)/100),D(s.get('grading',{}).get('balance',0)/100),C.c_int(-1),compose(mixer(s.get('mixer',{}))),compose(grading(s.get('grading',{}))),C.c_int(33))
  return list(data)

 def effect(image,w,h,s):
  keys=['texture','clarity','dehaze','glow','glowStyle','glowRange','glowSpread','glowWarmth','vignetteAmount','vignetteMidpoint','vignetteRoundness','vignetteFeather','vignetteHighlights','vignetteStyle'];defaults={'vignetteMidpoint':50,'vignetteFeather':50}
  vals=[C.c_int(s.get(k,0)) if k in ('glowStyle','vignetteStyle') else D(s.get(k,defaults.get(k,0))) for k in keys]
  data=(U8*len(image))(*image);lib.adjust_camera_raw_effects(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),*vals,D(1));return list(data)
 def optics(image,w,h,s):
  data=(U8*len(image))(*image);lib.adjust_camera_raw_optics(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),C.c_int(0),C.c_int(0),D(100),D(100),D(0),D(0),D(270),D(310),D(0),D(60),D(120),D(s.get('vignetteAmount',0)),D(s.get('vignetteMidpoint',50)),D(1),pointer(81),C.c_int(17));return list(data)
 def detail(image,w,h,s):
  keys=['sharpenAmount','sharpenRadius','sharpenDetail','sharpenMasking','noiseLuminance','noiseLuminanceDetail','noiseLuminanceContrast','noiseColor','noiseColorDetail','noiseColorSmoothness'];defaults={'sharpenRadius':10,'sharpenDetail':25,'noiseLuminanceDetail':50,'noiseColorDetail':50,'noiseColorSmoothness':50}
  data=(U8*len(image))(*image);lib.adjust_camera_raw_detail(data,C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),*[D(s.get(k,defaults.get(k,0))) for k in keys],D(1));return list(data)
 w,h=11,9;image=[]
 for y in range(h):
  for x in range(w):image += [(x*37+y*17)%256,(x*13+y*43)%256,(x*71+y*5)%256,255]
 cases=[]
 for name,s in [('identity',{}),('warm-tint',{'temperature':37,'tint':-13}),('exposure',{'exposure':1.23}),('adaptive',{'contrast':37,'highlights':-63,'shadows':42}),('all',{'exposure':-.6,'temperature':-37,'tint':12,'contrast':24,'highlights':-43,'shadows':66,'whites':-23,'blacks':42,'saturation':-32,'vibrance':56})]:cases.append({'name':name,'kind':'light','width':w,'height':h,'input':image,'settings':s,'expected':light(image,w,h,s)})
 if count==763:
  for name,setting in [('mixer-orange-saturation',{'mixer':{'saturation':[0,-60,0,0,0,0,0,0]}}),('mixer-red-hue',{'mixer':{'hue':[60,0,0,0,0,0,0,0]}}),('mixer-blue-luminance',{'mixer':{'luminance':[0,0,0,0,0,60,0,0]}}),('calibration-blue-saturation',{'calibration':{'blueSaturation':-60}}),('calibration-red-hue',{'calibration':{'redHue':60}}),('parametric-darks',{'curve':{'darks':-60}})]:cases.append({'name':name,'kind':'grade','width':w,'height':h,'input':image,'settings':setting,'expected':light(image,w,h,setting)})
  extra=[('folded-pointcurves',{'curve':{'darks':-31,'rgb':[{'x':0,'y':0},{'x':.25,'y':.17},{'x':.75,'y':.83},{'x':1,'y':1}],'red':[{'x':0,'y':0},{'x':.61,'y':.72},{'x':1,'y':1}]},'mixer':{'saturation':[17,0,0,0,0,-32,0,0]},'grading':{'global':{'hue':351,'saturation':37}}}),('moved-dividers',{'curve':{'darks':-61,'shadows':32,'lights':21,'shadowSplit':17,'darkSplit':39,'lightSplit':83}}),('nonfold-refine-positive',{'curve':{'darks':-31,'refineSaturation':43},'mixer':{'hue':[0,0,0,0,0,31,0,0]},'grading':{'midtones':{'hue':73,'saturation':31}}}),('nonfold-refine-negative',{'curve':{'darks':-31,'refineSaturation':-61},'grading':{'shadows':{'hue':174,'saturation':53}}}),('nonfold-pointcolor',{'curve':{'darks':-31},'mixer':{'hue':[31,0,0,0,0,0,0,0],'points':[{'hue':30,'saturation':.61,'luminance':.47,'hueShift':33,'saturationShift':-23,'luminanceShift':13,'hueRange':55,'saturationRange':.71,'luminanceRange':.83}]},'grading':{'global':{'hue':245,'saturation':31}}})]
  for name,setting in extra:cases.append({'name':name,'kind':'pipeline','width':w,'height':h,'input':image,'settings':setting,'expected':light(image,w,h,setting)})
  for name,setting in [('lens-vignette-positive',{'vignetteAmount':100}),('lens-vignette-negative',{'vignetteAmount':-100}),('lens-vignette-midpoint',{'vignetteAmount':61,'vignetteMidpoint':27})]:cases.append({'name':name,'kind':'optics','width':w,'height':h,'input':image,'settings':{'optics':setting},'expected':optics(image,w,h,setting)})
  for amount,style in [(-60,0),(61,0),(-83,1),(43,2)]:
   setting={'vignetteAmount':amount,'vignetteStyle':style,'vignetteRoundness':-37,'vignetteMidpoint':41,'vignetteFeather':73,'vignetteHighlights':29}
   cases.append({'name':f'postcrop-vignette-{amount}-style{style}','kind':'effects','width':w,'height':h,'input':image,'settings':setting,'expected':effect(image,w,h,setting)})
  for blending in [0,17,50,83,100]:
   for balance in [-50,0,50]:
    setting={'grading':{'blending':blending,'balance':balance,'shadows':{'hue':353,'saturation':17,'luminance':-25},'midtones':{'hue':71,'saturation':47,'luminance':12},'highlights':{'hue':192,'saturation':61,'luminance':19},'global':{'hue':245,'saturation':31,'luminance':-8}}}
    cases.append({'name':f'grading-4wheel-b{blending}-balance{balance}','kind':'grade','width':w,'height':h,'input':image,'settings':setting,'expected':light(image,w,h,setting)})
 for brightness in [21,73,170,230]:
  uniform=[brightness,brightness,brightness,255]*12;s={'contrast':63,'highlights':-35,'shadows':53};cases.append({'name':f'adaptive-{brightness}','kind':'light','width':4,'height':3,'input':uniform,'settings':s,'expected':light(uniform,4,3,s)})
 for name,s in [('dehaze-positive',{'dehaze':73}),('dehaze-negative',{'dehaze':-61}),('texture',{'texture':79}),('clarity',{'clarity':-73}),('effects-combined',{'texture':32,'clarity':61,'dehaze':41,'glow':23,'glowRange':-31,'glowSpread':39,'vignetteAmount':-25}),('halation',{'glow':83,'glowStyle':2,'glowWarmth':-31})]:cases.append({'name':name,'kind':'effects','width':w,'height':h,'input':image,'settings':s,'expected':effect(image,w,h,s)})
 for name,s in [('sharpen-unmasked',{'sharpenAmount':90}),('sharpen-masked',{'sharpenAmount':83,'sharpenMasking':71,'sharpenDetail':62}),('chroma-noise',{'noiseColor':87,'noiseColorDetail':42}),('luma-noise',{'noiseLuminance':71,'noiseLuminanceDetail':28,'noiseLuminanceContrast':43}),('detail-combined',{'noiseColor':64,'noiseLuminance':33,'sharpenAmount':74})]:cases.append({'name':name,'kind':'detail','width':w,'height':h,'input':image,'settings':s,'expected':detail(image,w,h,s)})
 uniform=[95,133,151,255]*12;cases.append({'name':'uniform-dehaze-unchanged','kind':'effects','width':4,'height':3,'input':uniform,'settings':{'dehaze':100},'expected':effect(uniform,4,3,{'dehaze':100})})
 # Choose channels exactly representable in premultiplied storage, so input quantization is controlled.
 alpha_input=[];alpha_straight=[]
 for i in range(w*h):
  alpha=[0,85,170,255][i%4];color=[(i*7%85)*3,(i*13%85)*3,(i*23%85)*3] if alpha else [0,0,0]
  alpha_straight += color+[alpha];alpha_input += [int(c*alpha/255+.5) for c in color]+[alpha]
 for kind,s in [('light',{'temperature':33,'tint':-14,'contrast':41,'highlights':-52,'shadows':68}),('effects',{'texture':59,'clarity':-63,'dehaze':58}),('detail',{'noiseColor':73,'noiseColorDetail':64,'sharpenAmount':89})]:
  expected=light(alpha_input,w,h,s) if kind=='light' else effect(alpha_input,w,h,s) if kind=='effects' else detail(alpha_input,w,h,s)
  cases.append({'name':f'alpha-{kind}','kind':kind,'premultipliedExpected':True,'width':w,'height':h,'input':alpha_straight,'settings':s,'expected':expected})
 def neutral(red,green,blue):
  def cast(temp,tint):
   st=white(temp,tint);color=(D*3)(red,green,blue);lib.camera_raw_stage_color(C.byref(st),C.c_int(17),color);return max(color)-min(color)
  best=(0,0,cast(0,0))
  for step,reach in [(10,100),(2,10),(.5,2)]:
   center=best;t=center[0]-reach
   while t<=center[0]+reach:
    tint=center[1]-reach
    while tint<=center[1]+reach:
     if abs(t)<=100 and abs(tint)<=100:
      found=cast(t,tint)
      if found<best[2]:best=(t,tint,found)
     tint+=step
    t+=step
  return {'temperature':best[0],'tint':best[1]}
 neutralizations=[{'rgb':rgb,'expected':neutral(*rgb)} for rgb in [[.7,.5,.4],[.3,.7,.6],[.3,.3,.3],[.14,.23,.4]]]
 scopeBins=(D*768)();scopeCells=(D*(16*16))();lib.camera_raw_scope((U8*len(alpha_input))(*alpha_input),C.c_size_t(w),C.c_size_t(h),C.c_size_t(w*4),C.c_int(2),scopeBins,scopeCells,C.c_int(16))
 fixture={'kernelSha256':hashlib.sha256((render/'AdjustPixels.c').read_bytes()).hexdigest(),'scope':{'input':alpha_straight,'width':w,'height':h,'bins':list(scopeBins),'cells':list(scopeCells)},'tableCount':count,'upstream':revision,'sourceSha256':hashlib.sha256(raw).hexdigest(),'decodedSha256':hashlib.sha256(binary).hexdigest(),'cases':cases,'statistics':{'width':w,'height':h,'input':image,'expected':stats(image,w,h)},'neutralizations':neutralizations}
 path=root/'tests/fixtures/camera-raw-upstream.json';path.write_text(json.dumps(fixture,separators=(',',':'))+'\n');print(path,len(cases),'C image cases and',len(neutralizations),'white-balance searches')
