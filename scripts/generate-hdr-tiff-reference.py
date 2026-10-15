"""Reference fixtures: tifffile + imagecodecs/libtiff-compatible float codecs.
Run with isolated reference venv; these are not product dependencies.
"""
import hashlib,json,pathlib,struct
import numpy as np
import tifffile,imagecodecs
root=pathlib.Path(__file__).resolve().parent.parent/'fixtures'/'hdr-tiff'
root.mkdir(parents=True,exist_ok=True)
data=np.zeros((7,19,4),dtype=np.float32)
for y in range(7):
    for x in range(19):
        alpha=[1,.25,2**-14,0][(x+y)%4]
        data[y,x]=[[-.01,.003,1,2,4,16][(x+y)%6],(.1+x/19),(.003+y/7),alpha]
records=[]
for depth in [16,32,64]:
    for planar in [False,True]:
        for compression,predictor in [('none',1),('deflate',1),('deflate',3),('lzw',3)]:
            for endian in ['<','>']:
                if depth==16 and compression!='none':continue
                dtype=np.dtype(endian+{16:'f2',32:'f4',64:'f8'}[depth])
                stored=data.astype(dtype)
                if planar:stored=np.moveaxis(stored,-1,0)
                name=f'float{depth}-{"planar" if planar else "chunky"}-{compression}-p{predictor}-{"le" if endian=="<" else "be"}.tif'
                path=root/name
                tifffile.imwrite(path,stored,photometric='rgb',planarconfig='separate' if planar else 'contig',extrasamples='unassalpha',rowsperstrip=3,compression=None if compression=='none' else compression,predictor=predictor if compression!='none' else None,metadata=None,byteorder=endian,extratags=[(274,'H',1,1,False)])
                actual=tifffile.imread(path)
                if planar:actual=np.moveaxis(actual,0,-1)
                assert np.array_equal(actual, data.astype(dtype))
                records.append({'file':name,'width':19,'height':7,'linearRGBA':actual.astype(np.float32).flatten().tolist(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
def linear_icc(gamma=None):
    # D50-adapted standard sRGB matrix and either identity or gamma2 TRCs.
    xyz=[[.4360747,.2225045,.0139322],[.3850649,.7168786,.0971045],[.1430804,.0606169,.7141733]]
    tags=[]
    for name,values in zip(['rXYZ','gXYZ','bXYZ'],xyz):tags.append((name,b'XYZ '+bytes(4)+b''.join(struct.pack('>i',round(v*65536)) for v in values)))
    for name in ['rTRC','gTRC','bTRC']:tags.append((name,b'curv'+bytes(4)+struct.pack('>I',0 if gamma is None else 1)+(b'' if gamma is None else struct.pack('>H',round(gamma*256)))))
    base=132+12*len(tags);header=bytearray(base);header[16:20]=b'RGB ';header[20:24]=b'XYZ ';header[36:40]=b'acsp';struct.pack_into('>I',header,128,len(tags));payload=bytearray()
    for i,(name,value) in enumerate(tags):header[132+12*i:136+12*i]=name.encode();struct.pack_into('>II',header,136+12*i,base+len(payload),len(value));payload.extend(value);payload.extend(bytes((-len(payload))%4))
    struct.pack_into('>I',header,0,len(header)+len(payload));return bytes(header+payload)
for label,gamma in [('linear',None),('nonlinear',2)]:
    profile=linear_icc(gamma);tifffile.imwrite(root/f'float32-icc-{label}.tif',data,photometric='rgb',extrasamples='unassalpha',metadata=None,extratags=[(34675,'B',len(profile),profile,False)])
(root/'reference.json').write_text(json.dumps({'producer':{'tifffile':tifffile.__version__,'imagecodecs':imagecodecs.__version__,'numpy':np.__version__},'fixtures':records},indent=2)+'\n')
print('Generated',len(records),'independently decoded float TIFF fixtures')
