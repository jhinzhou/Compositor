"""Compile unmodified upstream deep/dither C; never call the TypeScript implementation."""
import argparse, base64, ctypes, hashlib, json, pathlib, struct, subprocess, tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', default='/Users/zhoujin/Documents/PS/Compositor_Upstream/f01e298/Compositor/Rendering')
parser.add_argument('--sdk', default='/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk')
args = parser.parse_args()
source = pathlib.Path(args.source)
root = pathlib.Path(__file__).resolve().parents[1]
flags = ['-O2', '-ffp-contract=off', '-fblocks', '-dynamiclib']
def encoded(values, kind):
    return base64.b64encode(struct.pack('<' + kind * len(values), *values)).decode()

with tempfile.TemporaryDirectory(prefix='deep-oracle-') as directory:
    library = pathlib.Path(directory) / 'deep.dylib'
    subprocess.run(['xcrun', 'clang', '-isysroot', args.sdk, *flags, str(source / 'DeepPixels.c'), str(source / 'DitherPixels.c'), '-o', str(library)], check=True)
    lib = ctypes.CDLL(str(library))
    u16 = ctypes.POINTER(ctypes.c_uint16)
    lib.dither_quantize16.argtypes = [u16, ctypes.POINTER(ctypes.c_uint8), ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
    lib.deep_cube_apply.argtypes = [u16, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.POINTER(ctypes.c_float), ctypes.c_int]
    rows = []
    for name, width, height in [('opaque-gradient', 257, 3), ('alpha-gradient', 17, 19), ('low-alpha', 31, 5), ('hard-boundary', 8, 8), ('parallel-rows', 9, 73)]:
        pixels = []
        for y in range(height):
            for x in range(width):
                alpha = 65535 if name == 'opaque-gradient' else [0, 1, 64, 127, 128, 129, 256, 257, 258, 511, 512, 513][(x+y) % 12] if name == 'low-alpha' else ((x * 8191 + y * 3001) % 65536)
                color = [(x * 251 + y * 997) % 65536, (x * 997 + y * 251) % 65536, (x * 701 + y * 1999) % 65536]
                if name == 'hard-boundary': color = [65535 if x >= 4 else 0, 65535 if y >= 4 else 0, 32768]
                pixels.extend([(value * alpha + 32767) // 65535 for value in color] + [alpha])
        deep = (ctypes.c_uint16 * len(pixels))(*pixels)
        out = (ctypes.c_uint8 * len(pixels))()
        lib.dither_quantize16(deep, out, width, height, width * 4)
        rows.append(dict(name=name, operation='quantize', width=width, height=height, inputRGBA16LE=encoded(pixels, 'H'), expectedPremultipliedRGBA8=encoded(out, 'B')))
        for cube_name, dimension in [('identity', 2), ('cross-channel', 5), ('out-of-range', 3)]:
            cube = []
            for b in range(dimension):
                for g in range(dimension):
                    for r in range(dimension):
                        rr, gg, bb = [v / (dimension - 1) for v in [r, g, b]]
                        cube.extend([rr, gg, bb, 1] if cube_name == 'identity' else [gg*.6+bb*.4, rr*.7+bb*.3, rr*.2+gg*.8, .5] if cube_name == 'cross-channel' else [rr*1.5-.2, gg*1.4-.1, bb*1.6-.3, 0])
            native_cube = (ctypes.c_float * len(cube))(*cube)
            deep = (ctypes.c_uint16 * len(pixels))(*pixels)
            lib.deep_cube_apply(deep, width * 8, width, height, native_cube, dimension)
            rows.append(dict(name=name+'-'+cube_name, operation='cube', width=width, height=height, inputRGBA16LE=encoded(pixels, 'H'), dimension=dimension, cubeFloat32LE=encoded(native_cube, 'f'), expectedRGBA16LE=encoded(deep, 'H')))
    metadata = dict(commit='f01e2980fb76eb085d3f8ac96070a1c0c4a9afa9', generator='Unmodified DeepPixels.c and DitherPixels.c via independent ctypes', flags=flags, sdk=args.sdk, sourceSHA256={name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in ['DeepPixels.c', 'DeepPixels.h', 'DitherPixels.c', 'DitherPixels.h']})
    target = root / 'fixtures/parity/native-f01e298-deep.json'
    target.write_text(json.dumps(dict(**metadata, rows=rows), separators=(',', ':')) + '\n')
    print('Wrote', len(rows), 'independent deep C references to', target)
