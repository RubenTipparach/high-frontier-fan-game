#!/usr/bin/env python3
"""Generate data/rat-frontier/alpha-centauri-map.js in the SAME shape the
original game's planner map uses (js/game/planner-map.js -> loadPlannerMap),
so the original MapRenderer draws it with no renderer changes.

Nodes come from the pixel-art aseprite layers:
  PLANETS / Asteroids / star layers -> real sites (hex markers, spectral type
    from blob hue), the prospectable bodies.
  'nodes' layer -> the delta-v graph: bright-red dots (#b4202a) are BURN nodes,
    orange rings (#fa6a0a) are LAGRANGE points, white squares are hub/orbit
    nodes, and the dark-maroon thin lines (#3b1725) are the route EDGES.

Edges are traced by sampling the straight segment between nearby nodes against
the dark route-line mask (now reliable because the burn/lagrange waypoints make
adjacency local + straight). Coords are normalised to the 1400x900 world space.
"""
import json, math, colorsys
from collections import deque, Counter
from PIL import Image

LAYERS = '/tmp/aclayers'
OUT = '/home/user/high-frontier-fan-game/data/rat-frontier/alpha-centauri-map.js'
SRC_W, SRC_H = 523, 352
VIEW_W, VIEW_H = 1400, 900

def nx(px): return round(px / SRC_W * VIEW_W, 1)
def ny(py): return round(py / SRC_H * VIEW_H, 1)

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def classify(hexc):
    r, g, b = [v/255 for v in hex2rgb(hexc)]
    h, s, v = colorsys.rgb_to_hsv(r, g, b); hue = h*360
    if s < 0.18:          return 'T', 'M'
    if 20 <= hue < 70:    return 'C', 'C'
    if 70 <= hue < 170:   return 'H', 'H'
    if 170 <= hue < 200:  return 'H', 'D'
    if 200 <= hue < 260:  return 'B', 'B'
    if 260 <= hue < 320:  return 'A', 'V'
    return 'A', 'A'

def components(path, test, min_px=3):
    im = Image.open(path).convert('RGBA'); W, H = im.size; px = im.load()
    seen = [[False]*W for _ in range(H)]; out = []
    for y0 in range(H):
        for x0 in range(W):
            if seen[y0][x0]: continue
            seen[y0][x0] = True
            if not test(px[x0, y0]): continue
            q = deque([(x0, y0)]); pts = [(x0, y0)]; cols = Counter()
            while q:
                x, y = q.popleft()
                p = px[x, y]; cols[(p[0]//16*16, p[1]//16*16, p[2]//16*16)] += 1
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        a, b = x+dx, y+dy
                        if 0 <= a < W and 0 <= b < H and not seen[b][a] and test(px[a, b]):
                            seen[b][a] = True; q.append((a, b)); pts.append((a, b))
            if len(pts) < min_px: continue
            xs = [a for a, b in pts]; ys = [b for a, b in pts]
            dom = cols.most_common(1)[0][0]
            out.append({'cx': sum(xs)/len(xs), 'cy': sum(ys)/len(ys), 'n': len(pts),
                        'w': max(xs)-min(xs)+1, 'h': max(ys)-min(ys)+1,
                        'color': '#%02x%02x%02x' % dom})
    return out

def near(p, t, tol): return p[3] > 60 and all(abs(p[i]-t[i]) <= tol for i in range(3))

def line_mask(dilate=1):
    im = Image.open(f'{LAYERS}/L6_nodes.png').convert('RGBA'); W, H = im.size; px = im.load()
    def is_line(p):
        if p[3] < 60: return False
        r, g, b, _ = p
        return r > 40 and r - b > 12 and g < 120
    base = [[is_line(px[x, y]) for x in range(W)] for y in range(H)]
    m = [[False]*W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            if base[y][x]:
                for dy in range(-dilate, dilate+1):
                    for dx in range(-dilate, dilate+1):
                        a, b = x+dx, y+dy
                        if 0 <= a < W and 0 <= b < H: m[b][a] = True
    return m, W, H

def seg_frac(x0, y0, x1, y1, mask, W, H):
    n = int(max(abs(x1-x0), abs(y1-y0))) + 1
    if n < 2: return 1.0
    hit = 0
    for i in range(n+1):
        t = i/n; x = int(round(x0+(x1-x0)*t)); y = int(round(y0+(y1-y0)*t))
        if 0 <= x < W and 0 <= y < H and mask[y][x]: hit += 1
    return hit/(n+1)

def main():
    nodes = []
    star_names = ['Centauri A', 'Centauri B', 'Proxima Centauri']
    stars = sorted(components(f'{LAYERS}/L3_Layer 1.png',
                   lambda p: near(p, (240, 240, 240), 40), min_px=40),
                   key=lambda b: -b['n'])
    for i, b in enumerate(stars):
        nm = star_names[i] if i < len(star_names) else f'Star {i+1}'
        nodes.append({'id': f'ac_sun_{i+1}', 'name': nm, 'type': 'sun',
                      'cx': b['cx'], 'cy': b['cy'], 'isWaypoint': True})

    planets = sorted(components(f'{LAYERS}/L4_PLANETS.png',
                     lambda p: p[3] > 120, min_px=20), key=lambda b: -b['n'])
    for i, b in enumerate(planets):
        sp, cls = classify(b['color']); big = b['n'] >= 250
        nodes.append({'id': f'ac_planet_{i+1}', 'name': f'AC-{i+1:02d}',
                      'type': 'planet' if big else 'moon', 'cx': b['cx'], 'cy': b['cy'],
                      'spectralType': sp, 'cls': cls, 'isWaypoint': False,
                      'hydration': {'H':4,'D':3,'B':2,'C':1,'A':1,'M':0}.get(cls, 1),
                      'siteSize': 5 if big else 3, 'landing': 1})

    roids = sorted(components(f'{LAYERS}/L5_Asteroids.png',
                   lambda p: p[3] > 120, min_px=8), key=lambda b: -b['n'])
    for i, b in enumerate(roids):
        sp, cls = classify(b['color'])
        nodes.append({'id': f'ac_roid_{i+1}', 'name': f'Belt {i+1:03d}',
                      'type': 'asteroid', 'cx': b['cx'], 'cy': b['cy'],
                      'spectralType': sp, 'cls': cls, 'isWaypoint': False,
                      'hydration': {'H':3,'D':2,'B':1,'C':1,'A':0,'M':0}.get(cls, 0),
                      'siteSize': 2, 'landing': 1})

    burns = [b for b in components(f'{LAYERS}/L6_nodes.png',
             lambda p: near(p, (180, 32, 42), 40) or near(p, (223, 62, 35), 40), min_px=4)
             if 3 <= b['w'] <= 16 and 3 <= b['h'] <= 16 and 0.45 <= b['w']/b['h'] <= 2.2]
    for i, b in enumerate(burns):
        nodes.append({'id': f'ac_burn_{i+1}', 'name': '', 'type': 'burn',
                      'cx': b['cx'], 'cy': b['cy'], 'isWaypoint': True})

    lags = components(f'{LAYERS}/L6_nodes.png',
                      lambda p: near(p, (250, 106, 10), 30), min_px=2)
    for i, b in enumerate(lags):
        nodes.append({'id': f'ac_lag_{i+1}', 'name': '', 'type': 'lagrange',
                      'cx': b['cx'], 'cy': b['cy'], 'isWaypoint': True})

    hubs = components(f'{LAYERS}/L6_nodes.png',
                      lambda p: near(p, (255, 255, 255), 25), min_px=3)
    for i, b in enumerate(hubs):
        nodes.append({'id': f'ac_hub_{i+1}', 'name': f'Hub {i+1}', 'type': 'orbit',
                      'cx': b['cx'], 'cy': b['cy'], 'isWaypoint': True})

    mask, MW, MH = line_mask(dilate=1)
    R = 42.0; MIN = 4.0; THRESH = 0.6
    edges = []; seen = set()
    pts = [(n['cx'], n['cy'], n['id']) for n in nodes]
    cell = 42; grid = {}
    for i, (x, y, _id) in enumerate(pts):
        grid.setdefault((int(x//cell), int(y//cell)), []).append(i)
    for i, (x0, y0, ida) in enumerate(pts):
        gx, gy = int(x0//cell), int(y0//cell); cand = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cand += grid.get((gx+dx, gy+dy), [])
        for j in cand:
            if j <= i: continue
            x1, y1, idb = pts[j]; d = math.hypot(x1-x0, y1-y0)
            if d < MIN or d > R: continue
            if seg_frac(x0, y0, x1, y1, mask, MW, MH) < THRESH: continue
            key = (ida, idb)
            if key in seen: continue
            seen.add(key); edges.append([ida, idb])

    deg = {}
    for a, b in edges:
        deg[a] = deg.get(a, 0)+1; deg[b] = deg.get(b, 0)+1
    isolated = [n['id'] for n in nodes if n['type'] != 'sun' and deg.get(n['id'], 0) == 0]

    sites = []
    for n in nodes:
        rec = {'id': n['id'], 'id2': n['id'],
               'serverId': None if n.get('isWaypoint') else n['id'],
               'name': n['name'], 'type': n['type'], 'isWaypoint': bool(n.get('isWaypoint')),
               'x': nx(n['cx']), 'y': ny(n['cy']), 'srcPx': [round(n['cx'], 1), round(n['cy'], 1)]}
        for k in ('spectralType', 'hydration', 'siteSize', 'landing', 'cls'):
            if k in n: rec[k] = n[k]
        sites.append(rec)

    counts = {}
    for n in nodes: counts[n['type']] = counts.get(n['type'], 0) + 1
    out = {'meta': {'src': 'alpha_centari.aseprite', 'srcSize': [SRC_W, SRC_H],
                    'view': [VIEW_W, VIEW_H], 'counts': counts,
                    'edges': len(edges), 'isolated': len(isolated)},
           'sites': sites, 'edges': edges}
    js = ("// AUTO-GENERATED by scripts/gen-alpha-centauri-map.py from the\n"
          "// alpha_centari.aseprite pixel-art layers. Shape matches the original\n"
          "// game's planner map (loadPlannerMap) so the ORIGINAL MapRenderer draws\n"
          "// it unchanged: real sites (hex markers) + waypoints (burn nodes,\n"
          "// lagrange points, orbit hubs) + route edges. Coords are in the\n"
          "// renderer's 1400x900 world space.\n\n"
          "export const ALPHA_CENTAURI_MAP = " + json.dumps(out, indent=2) + ";\n\n"
          "export const ALPHA_CENTAURI_SITES = ALPHA_CENTAURI_MAP.sites;\n"
          "export const ALPHA_CENTAURI_EDGES = ALPHA_CENTAURI_MAP.edges;\n")
    open(OUT, 'w').write(js)
    print('counts', counts, 'edges', len(edges), 'isolated', len(isolated))

if __name__ == '__main__':
    main()
