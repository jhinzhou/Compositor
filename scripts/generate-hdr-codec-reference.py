#!/usr/bin/env python3
"""Independent OpenEXR fixtures via OpenCV's upstream OpenEXR codec; no product dependency."""
import os
os.environ['OPENCV_IO_ENABLE_OPENEXR'] = '1'
import cv2
import numpy as np
from pathlib import Path
import json,hashlib

root=Path(__file__).resolve().parents[1]
folder=root/'fixtures'/'hdr-codec';folder.mkdir(exist_ok=True)
height,width=19,11
rgba=np.zeros((height,width,4),dtype=np.float32)
for y in range(height):
 for x in range(width):
  p=y*width+x;alpha=[1,.25,2**-14,0][p%4]
  straight=[[-.01,.003,1,2,4,16][p%6],[.003,1,2,4,16,-.01][p%6],[1,2,4,16,-.01,.003][p%6]]
  rgba[y,x,:3]=np.asarray(straight,dtype=np.float32)*alpha;rgba[y,x,3]=alpha
rows=[]
for kind,type_id in [('half',cv2.IMWRITE_EXR_TYPE_HALF),('float',cv2.IMWRITE_EXR_TYPE_FLOAT)]:
 for method,compression in [('none',0),('rle',1),('zips',2),('zip',3)]:
  name=f'openexr-{kind}-{method}.exr';path=folder/name
  cv2.imwrite(str(path),rgba[:,:,[2,1,0,3]],[cv2.IMWRITE_EXR_TYPE,type_id,cv2.IMWRITE_EXR_COMPRESSION,compression])
  decoded=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)[:,:,[2,1,0,3]]
  rows.append({'file':name,'pixelType':kind,'compression':method,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'linearPremultipliedRGBA':decoded.reshape(-1).astype(float).tolist()})
for kind,type_id in [('half',cv2.IMWRITE_EXR_TYPE_HALF),('float',cv2.IMWRITE_EXR_TYPE_FLOAT)]:
 name=f'openexr-{kind}-rgb.exr';path=folder/name
 rgb=rgba[:,:,:3].copy();cv2.imwrite(str(path),rgb[:,:,::-1],[cv2.IMWRITE_EXR_TYPE,type_id,cv2.IMWRITE_EXR_COMPRESSION,3])
 decoded=cv2.imread(str(path),cv2.IMREAD_UNCHANGED)[:,:,::-1];result=np.dstack((decoded,np.ones((height,width),np.float32)))
 rows.append({'file':name,'pixelType':kind,'compression':'zip','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'linearPremultipliedRGBA':result.reshape(-1).astype(float).tolist()})
record={'generator':'OpenCV OpenEXR codec, independent of compositor hdr-codecs.ts','opencvVersion':cv2.__version__,'width':width,'height':height,'rows':rows}
(folder/'reference.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'count':len(rows),'opencv':cv2.__version__,'fixtureDirectory':str(folder)}))
