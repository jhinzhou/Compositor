"""Independent Python Float32 scalar reference for native MetalWarp shader equations.
This does NOT run Metal: fixtures must never be described as native GPU output.
The reference emulates rgba16Unorm texture reads, Float32 carried/offset state,
normalized color interpolation, and immutable-original Liquify sampling.
"""
import base64,ctypes,hashlib,json,math,pathlib,struct
root=pathlib.Path(__file__).resolve().parents[1];native=pathlib.Path('/Users/zhoujin/Documents/PS/Compositor_Upstream/f01e298/Compositor')
f=lambda x:ctypes.c_float(x).value
clamp=lambda x,a,b:max(a,min(b,x))
rnd=lambda x:math.floor(x+.5) if x>=0 else -math.floor(-x+.5)
def mix(a,b,t):return f(a+f(f(b-a)*t))
def norm(v):return f(v/65535)
def unit(v):return f(norm(v)*65535)
def encoded(values,kind):return base64.b64encode(struct.pack('<'+kind*len(values),*values)).decode()
def scalar(data,width,height,option):
 pixels=data[:];size=max(2,option['size']);radius=math.ceil(size/2);side=radius*2+1;strength=f(max(.01,option['strength']));hard=f(min(.98,option['hardness']));inverse=f(1/f(size/2));spacing=max(1,size*(.005 if option['mode']=='smudge' else .025));carried=[0.]*(side*side*4);offsets=[0.]*(width*height*2);last=option['points'][0];dabs=[]
 if option['mode']=='smudge':
  for dy in range(-radius,radius+1):
   for dx in range(-radius,radius+1):
    x,y=rnd(last[0])+dx,rnd(last[1])+dy
    if 0<=x<width and 0<=y<height:
     held=((dy+radius)*side+dx+radius)*4;p=(y*width+x)*4;carried[held:held+4]=[unit(v) for v in pixels[p:p+4]]
 for point in option['points'][1:]:
  distance=math.hypot(point[0]-last[0],point[1]-last[1])
  if distance<spacing:continue
  steps=math.ceil(distance/spacing);previous=last
  for step in range(1,steps+1):
   t=step/steps;center=[last[0]+(point[0]-last[0])*t,last[1]+(point[1]-last[1])*t];move=[f(f(center[c]-previous[c])*strength) for c in range(2)];previous=center;dabs.append(center);cx,cy=map(rnd,center);margin=math.ceil(max(map(abs,move)))+2;x0=max(0,cx-radius-margin);y0=max(0,cy-radius-margin);x1=min(width-1,cx+radius+margin);y1=min(height-1,cy+radius+margin);cw=x1-x0+1;ch=y1-y0+1;before=offsets[:]
   for dy in range(-radius,radius+1):
    for dx in range(-radius,radius+1):
     x,y=cx+dx,cy+dy
     if x<0 or y<0 or x>=width or y>=height:continue
     u=f(f(math.sqrt(f(dx*dx+dy*dy)))*inverse)
     if u>=1:continue
     if u<=hard:weight=1.
     else:
      q=f(f(1-u)/f(1-hard));weight=f(f(q*q)*f(3-f(2*q)))
     p=(y*width+x)*4
     if option['mode']=='smudge':
      held=((dy+radius)*side+dx+radius)*4
      for c in range(4):
       under=unit(pixels[p+c]);painted=f(under+f(f(f(carried[held+c]-under)*weight)*strength));pixels[p+c]=clamp(rnd(painted),0,65535);carried[held+c]=painted
     else:
      if cw<2 or ch<2:continue
      sx=clamp(f(x-x0-f(move[0]*weight)),0,cw-1);sy=clamp(f(y-y0-f(move[1]*weight)),0,ch-1);ix=min(cw-2,int(sx));iy=min(ch-2,int(sy));fx=f(sx-ix);fy=f(sy-iy);o=[]
      for c in range(2):
       at=((y0+iy)*width+x0+ix)*2;o.append(f(mix(mix(before[at+c],before[at+2+c],fx),mix(before[at+width*2+c],before[at+width*2+2+c],fx),fy)-f(move[c]*weight)))
      offsets[(y*width+x)*2:(y*width+x)*2+2]=o;sx=clamp(f(x+o[0]),0,width-1);sy=clamp(f(y+o[1]),0,height-1);ix=min(width-2,int(sx));iy=min(height-2,int(sy));fx=f(sx-ix);fy=f(sy-iy)
      if ix<0 or iy<0:continue
      at=(iy*width+ix)*4
      for c in range(4):pixels[p+c]=clamp(rnd(f(mix(mix(norm(data[at+c]),norm(data[at+4+c]),fx),mix(norm(data[at+width*4+c]),norm(data[at+width*4+4+c]),fx),fy)*65535)),0,65535)
     for c in range(3):pixels[p+c]=min(pixels[p+c],pixels[p+3])
  last=point
 return pixels,dabs
rows=[]
for seed in range(8):
 for mode in ['smudge','liquify']:
  width=13;height=11;data=[]
  for y in range(height):
   for x in range(width):
    alpha=65535 if seed<4 else [0,1,128,257,30003,65535][(x+y+seed)%6];color=[(x*8191+y*701+seed*337)%65536,(x*257+y*1001+seed*717)%65536,65535 if (x+y)%2 else 0];data.extend([(v*alpha+32767)//65535 for v in color]+[alpha])
  option=dict(mode=mode,points=[[2.3,3.2],[6.7,4.1],[4.3,7.9],[10.2,6.2]] if seed%2 else [[2,5],[5,5],[9,5]],size=[2,3,5,7][seed%4],hardness=[0,.25,.7,1][seed%4],strength=[.13,.35,.67,1][seed%4]);expected,dabs=scalar(data,width,height,option);rows.append(dict(name=mode+'-'+str(seed),width=width,height=height,inputRGBA16LE=encoded(data,'H'),options=option,expectedRGBA16LE=encoded(expected,'H'),dabs=dabs))
target=root/'fixtures/parity/scalar-f01e298-deep-warp.json';target.write_text(json.dumps(dict(commit='f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9',generator='Independent Python Float32 scalar port; NOT native GPU execution',sourceSHA256={str(p):hashlib.sha256((native/p).read_bytes()).hexdigest() for p in [pathlib.Path('Rendering/MetalWarp.swift'),pathlib.Path('Document/SmudgeLiquify.swift')]},rows=rows),separators=(',',':'))+'\n');print('Wrote',len(rows),'scalar warp references:',target)
