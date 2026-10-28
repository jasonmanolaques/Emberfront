"""Resamples elevation onto a real-world map's grid of tiles, for tools/realmaps.ts.

The elevation is Mapzen's Terrarium tiles (from public data: SRTM, GMTED, ETOPO; see
github.com/tilezen/joerd), zoom 6, fetched from
  https://s3.amazonaws.com/elevation-tiles-prod/terrarium/6/{x}/{y}.png
into one folder as 6_{x}_{y}.png. Then:
  python3 tools/dem.py <tile folder> <out file> lon0 lon1 lat0 lat1 width height
writes the elevation in metres at the middle of every tile of that framing (plain latitude and
longitude, row by row from the north-west corner) as little-endian 16-bit integers.
With --fetch, it downloads the tiles it needs first. Needs Pillow."""
import math, os, struct, subprocess, sys
from PIL import Image

Z = 6
N = 2 ** Z

def main():
    args = [a for a in sys.argv[1:] if a != '--fetch']
    folder, out = args[0], args[1]
    lon0, lon1, lat0, lat1 = map(float, args[2:6])
    w, h = int(args[6]), int(args[7])
    # global pixel coordinates (Web Mercator, 256 a tile) of a place
    gx = lambda lon: (lon + 180) / 360 * N * 256
    gy = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N * 256
    tiles = {}
    def tile(x, y):
        k = (x, y)
        if k not in tiles:
            f = os.path.join(folder, f'{Z}_{x}_{y}.png')
            if not os.path.exists(f) and '--fetch' in sys.argv:
                subprocess.run(['curl', '-sS', '--max-time', '120', '-o', f,
                                f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png'], check=True)
            im = Image.open(f).convert('RGB')
            tiles[k] = im.load()
        return tiles[k]
    def height(px, py):
        x, y = int(px) % (N * 256), max(0, min(N * 256 - 1, int(py)))
        r, g, b = tile(x // 256, y // 256)[x % 256, y % 256]
        return r * 256 + g + b / 256 - 32768
    def sample(px, py):   # bilinear
        x0, y0 = math.floor(px - 0.5), math.floor(py - 0.5)
        fx, fy = px - 0.5 - x0, py - 0.5 - y0
        a, b = height(x0, y0), height(x0 + 1, y0)
        c, d = height(x0, y0 + 1), height(x0 + 1, y0 + 1)
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    data = bytearray()
    for r in range(h):
        lat = lat0 - (r + 0.5) / h * (lat0 - lat1)
        py = gy(lat)
        for c in range(w):
            lon = lon0 + (c + 0.5) / w * (lon1 - lon0)
            data += struct.pack('<h', max(-32768, min(32767, round(sample(gx(lon), py)))))
    with open(out, 'wb') as f:
        f.write(data)
    print(out, w, 'x', h)

main()
