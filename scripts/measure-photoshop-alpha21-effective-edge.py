"""Analysis only: infer apparent Gaussian edge parameters; never a product lookup."""
import json,base64,zlib,struct,math
from pathlib import Path
out=Path('artifacts/photoshop-native/measurements/alpha21-near-hard')
rows=[]
for f in ['photoshop-27.11-brush.json','photoshop-27.11-brush-v6.json','photoshop-27.11-brush-v7.json']:
 rows += json.load(open('fixtures/parity/'+f))['rows']
results=[]
for r in rows:
 if r['depth']!=8 or r['hardness']<.85 or r['flow']!=1 or r['opacity']!=1 or 'dot' not in r['name']:continue
 a=struct.unpack('<'+'H'*(r['width']*r['height']),zlib.decompress(base64.b64decode(r['alphaLEZlib'])))
 cx,cy=map(math.floor,r['points'][0]);R=r['size']/2
 samples=[(math.hypot(i%r['width']+.5-cx,i//r['width']+.5-cy),v) for i,v in enumerate(a) if 5<=v<=250]
 best=(float('inf'),0,0)
 for si in range(45,181,3):
  sigma=si/100
  for ri in range(-100,41,2):
   offset=ri/100
   e=sum((255*(1+math.erf((R+offset-d)/(sigma*math.sqrt(2))))/2-v)**2 for d,v in samples)/len(samples)
   if e<best[0]:best=(e,offset,sigma)
 row={'version':r['version'],'name':r['name'],'size':r['size'],'hardness':r['hardness'],'fitRMSE':math.sqrt(best[0]),'apparentRadiusOffset':best[1],'apparentAA':best[2]};results.append(row)
 print(r['version'],r['size'],r['hardness'],round(math.sqrt(best[0]),2),best[1],best[2])
(out/'effective-edge.json').write_text(json.dumps(results,indent=2)+'\n')
