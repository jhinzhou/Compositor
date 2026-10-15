"""Independent C mixed-channel lattice and extracted unmodified Swift HSL oracle."""
import base64,ctypes,hashlib,json,pathlib,struct,subprocess,tempfile
root=pathlib.Path(__file__).resolve().parents[1];source=root.parent/'Compositor_Upstream/f01e298/Compositor';sdk='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
def enc(v,kind):return base64.b64encode(struct.pack('<'+kind*len(v),*v)).decode()
def block(text,needle):
 start=text.index(needle);op=text.index('{',start);count=1;i=op+1
 while count:
  count+= (text[i]=='{')-(text[i]=='}');i+=1
 return text[start:i]
specs=[dict(kind='hsl',hue=47,saturation=38,lightness=-12),dict(kind='hsl',hue=-23,saturation=-30,lightness=15,activeRange='Reds',invertRange=True,hueRanges=[dict(range='Reds',hue=21,saturation=40,lightness=-7,band=[315,345,15,45])]),dict(kind='hsl',hue=40,saturation=30,lightness=8,colorize=True),dict(kind='blackWhite'),dict(kind='blackWhite',weights=[80,20,110,-20,55,90],tint=True,tintHue=210,tintSaturation=37),dict(kind='colorBalance',shadows=[30,-15,9],midtones=[-12,23,-8],highlights=[7,-17,22]),dict(kind='colorBalance',shadows=[-40,20,10],midtones=[5,-9,17],highlights=[35,-22,9],preserveLuminosity=False),dict(kind='gradientMap',shadows='#12345a',highlights='#ffe7b0'),dict(kind='gradientMap',shadows='#234987',highlights='#eadfcc',reversed=True)]
with tempfile.TemporaryDirectory(prefix='deep-color-oracle-') as td:
 td=pathlib.Path(td);flags=['-O2','-ffp-contract=off','-fblocks','-dynamiclib'];libpath=td/'color.dylib'
 subprocess.run(['xcrun','clang','-isysroot',sdk,*flags,*[str(source/'Rendering'/p) for p in ['DeepPixels.c','AdjustPixels.c','LensPixels.c']],'-o',str(libpath)],check=True)
 lib=ctypes.CDLL(str(libpath));u8=ctypes.POINTER(ctypes.c_uint8);flt=ctypes.POINTER(ctypes.c_float);u16=ctypes.POINTER(ctypes.c_uint16);size=ctypes.c_size_t
 lib.deep_cube_apply.argtypes=[u16,size,size,size,flt,ctypes.c_int]
 lib.adjust_black_white.argtypes=[u8,size,size,size,flt,ctypes.c_int,ctypes.c_double,ctypes.c_double]
 lib.adjust_color_balance.argtypes=[u8,size,size,size,flt,flt,flt,ctypes.c_int]
 lib.adjust_gradient_map.argtypes=[u8,size,size,size,u8]
 hue=(source/'Document/HueSaturation.swift').read_text();swift='import Foundation\n'+ '\n'.join(block(hue,n) for n in ['nonisolated enum ColorRange:', 'nonisolated struct HueBand:', 'nonisolated struct RangeAdjustment:', 'nonisolated struct HueSaturationSettings:'])
 swift+='\nnonisolated enum HueSaturationFilter {static let dimension = 33\ntypealias HueResponse = (shift: Double, saturation: Double, lightness: Double)\n'+'\n'.join(block(hue,n).replace('private static','static') for n in ['static func hueResponse(', 'private static func buildCube(', 'static func adjust(', 'static func adjustedSaturation(', 'private static func toHSL(', 'private static func toRGB('])+'\n}\n'
 swift+='''let inputs = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String:Any]]
var output = [String]()
for input in inputs {
 let active = ColorRange(rawValue: input["activeRange"] as? String ?? "Master")!
 var settings = HueSaturationSettings(hue: input["hue"] as? Double ?? 0, saturation: input["saturation"] as? Double ?? 0, lightness: input["lightness"] as? Double ?? 0, colorize: input["colorize"] as? Bool ?? false)
 settings.range = active; settings.invertRange = input["invertRange"] as? Bool ?? false
 for r in input["hueRanges"] as? [[String:Any]] ?? [] {
  let name = ColorRange(rawValue:r["range"] as! String)!, b = r["band"] as! [Double]
  settings.adjustments[name] = RangeAdjustment(hue:r["hue"] as! Double,saturation:r["saturation"] as! Double,lightness:r["lightness"] as! Double)
  settings.bands[name] = HueBand(falloffStart:b[0],rangeStart:b[1],rangeEnd:b[2],falloffEnd:b[3])
 }
 output.append(HueSaturationFilter.buildCube(settings).base64EncodedString())
}
print(String(data:try! JSONSerialization.data(withJSONObject:output),encoding:.utf8)!)
'''
 (td/'hsl.swift').write_text(swift);(td/'inputs.json').write_text(json.dumps(specs[:3]));subprocess.run(['xcrun','swiftc','-O','-sdk',sdk,str(td/'hsl.swift'),'-o',str(td/'hsl')],check=True)
 hsl=json.loads(subprocess.check_output([str(td/'hsl'),str(td/'inputs.json')],text=True))
 rows=[];width=257;height=2;pixels=[]
 for y in range(height):
  for x in range(width):
   a=[65535,32768,257,129,0][x%5];pixels.extend([(v*a+32767)//65535 for v in [(x*251+y*83)%65536,(x*997+y*1999)%65536,(x*701+y*383)%65536]]+[a])
 for index,s in enumerate(specs):
  if s['kind']=='hsl':cube=struct.unpack('<'+ 'f'*(33**3*4),base64.b64decode(hsl[index]))
  else:
   lattice=[]
   for b in range(33):
    for g in range(33):
     for r in range(33):lattice.extend([int(v*255/32+.5) for v in [r,g,b]]+[255])
   data=(ctypes.c_uint8*len(lattice))(*lattice)
   if s['kind']=='blackWhite':
    weights=(ctypes.c_float*6)(*[v/100 for v in s.get('weights',[40,60,40,60,20,80])]);lib.adjust_black_white(data,33*33,33,33*33*4,weights,s.get('tint',False),s.get('tintHue',40),s.get('tintSaturation',20)/100)
   elif s['kind']=='colorBalance':
    values=[(ctypes.c_float*3)(*[v/100 for v in s[k]]) for k in ['shadows','midtones','highlights']];lib.adjust_color_balance(data,33*33,33,33*33*4,*values,s.get('preserveLuminosity',True))
   else:
    colors=[[int(s[k][i:i+2],16)/255 for i in [1,3,5]] for k in ['shadows','highlights']]
    if s.get('reversed'):colors.reverse()
    table=[]
    for at in range(256):table.extend([int((colors[0][c]+(colors[1][c]-colors[0][c])*at/255)*255+.5) for c in range(3)])
    lib.adjust_gradient_map(data,33*33,33,33*33*4,(ctypes.c_uint8*len(table))(*table))
   cube=[ctypes.c_float(v/255).value for v in data]
  native_cube=(ctypes.c_float*len(cube))(*cube);deep=(ctypes.c_uint16*len(pixels))(*pixels);lib.deep_cube_apply(deep,width*8,width,height,native_cube,33)
  rows.append(dict(name=s['kind']+'-'+str(index),settings=s,width=width,height=height,inputRGBA16LE=enc(pixels,'H'),cubeSHA256=hashlib.sha256(struct.pack('<'+'f'*len(native_cube),*native_cube)).hexdigest(),expectedRGBA16LE=enc(deep,'H')))
 meta=dict(commit='f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9',flags=flags,sdk=sdk,generator='Unmodified native C kernels plus original Swift HSL method bodies extracted unchanged; shim only assembles inputs',sourceSHA256={p:hashlib.sha256((source/p).read_bytes()).hexdigest() for p in ['Rendering/DeepPixels.c','Rendering/AdjustPixels.c','Rendering/LensPixels.c','Document/HueSaturation.swift','Rendering/GPUCanvas.swift']})
 target=root/'fixtures/parity/native-f01e298-deep-color.json';target.write_text(json.dumps(dict(**meta,rows=rows),separators=(',',':'))+'\n');print('Wrote',len(rows),'deep color references')
