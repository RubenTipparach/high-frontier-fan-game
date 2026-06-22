#!/usr/bin/env python3
"""Extract marker blobs (sites/nodes) from a pixel-art map layer.
Connected-component labelling on the alpha mask; per blob reports centroid,
bbox, pixel count, and dominant opaque colour."""
import sys, json
from collections import deque, Counter
from PIL import Image

def components(path, amin=40, min_px=3):
    im = Image.open(path).convert('RGBA')
    W,H = im.size
    px = im.load()
    seen = [[False]*W for _ in range(H)]
    blobs = []
    for y0 in range(H):
        for x0 in range(W):
            if seen[y0][x0]: continue
            if px[x0,y0][3] < amin:
                seen[y0][x0]=True; continue
            # BFS
            q=deque([(x0,y0)]); seen[y0][x0]=True
            pts=[]; cols=Counter()
            while q:
                x,y=q.popleft(); pts.append((x,y))
                r,g,b,a=px[x,y]; cols[(r//16*16,g//16*16,b//16*16)]+=1
                for dx in(-1,0,1):
                    for dy in(-1,0,1):
                        nx,ny=x+dx,y+dy
                        if 0<=nx<W and 0<=ny<H and not seen[ny][nx] and px[nx,ny][3]>=amin:
                            seen[ny][nx]=True; q.append((nx,ny))
            if len(pts)<min_px: continue
            xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
            cx=sum(xs)/len(xs); cy=sum(ys)/len(ys)
            dom=cols.most_common(1)[0][0]
            blobs.append({'cx':round(cx,1),'cy':round(cy,1),'n':len(pts),
                'bbox':[min(xs),min(ys),max(xs),max(ys)],
                'w':max(xs)-min(xs)+1,'h':max(ys)-min(ys)+1,
                'color':'#%02x%02x%02x'%dom})
    return W,H,blobs

if __name__=='__main__':
    path=sys.argv[1]
    minpx=int(sys.argv[2]) if len(sys.argv)>2 else 3
    W,H,blobs=components(path,min_px=minpx)
    blobs.sort(key=lambda b:-b['n'])
    print(f'# {path}: {W}x{H}, {len(blobs)} blobs')
    # colour summary
    cc=Counter(b['color'] for b in blobs)
    print('# colours:', dict(cc.most_common(20)))
    for b in blobs:
        print(f"  ({b['cx']:.0f},{b['cy']:.0f}) n={b['n']} {b['w']}x{b['h']} {b['color']}")
