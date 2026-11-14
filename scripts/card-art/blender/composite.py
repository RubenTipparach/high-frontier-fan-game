"""Finish the Blender card renders: put each face on its card's backdrop.

The renders come out of Cycles on a transparent film. This step decides what
sits behind them, by face colour:
- white (cream) faces stay TRANSPARENT, so the art lies on the cream card;
- black faces stay transparent too: the dark card face shows through;
- `space` faces (the black fronts of the M1 decks, GW/TW and freighters, user
  2026-11-14) go onto the SAME space backdrop as their vector front: the
  #141a2c -> #04050a radial (cx 50%, cy 45%, r 85%) and the exact starfield,
  read from the generated <cardId>-front.svg next to the PNG;
- purple (promoted) faces go onto the promoted purple wash (#655ca8 at the
  centre to #652d91 at the edge, the same radial the SVG backs use) with a
  faint seeded starfield.

Run with any Python that has Pillow:
    python3 scripts/card-art/blender/composite.py --src DIR --deck bernals \
        --map geo-front=ber_geo_elevator_bernal-front[:white|black|purple] ...
Writes assets/cards/<deck>/<cardId>-<front|back>-3d.png.
"""
import argparse
import math
import os
import random
import re

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


def purple_wash(w, h, seed):
    """Radial #655ca8 -> #652d91 (cx 50%, cy 44%, r 80%) plus faint stars."""
    c0, c1 = (0x65, 0x5c, 0xa8), (0x65, 0x2d, 0x91)
    small = Image.new('RGB', (w // 4, h // 4))
    px = small.load()
    sw, shh = small.size
    rmax = 0.8 * math.hypot(sw, shh) / math.sqrt(2)
    for y in range(shh):
        for x in range(sw):
            t = min(1.0, math.hypot(x - sw * 0.5, y - shh * 0.44) / rmax)
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
    img = small.resize((w, h), Image.BILINEAR).convert('RGBA')
    rnd = random.Random(seed)
    stars = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sp = stars.load()
    for _ in range(60):
        x, y = rnd.randrange(w), rnd.randrange(h)
        a = rnd.randint(50, 150)
        r = 2 if rnd.random() < 0.2 else 1
        for dy in range(-r + 1, r):
            for dx in range(-r + 1, r):
                if 0 <= x + dx < w and 0 <= y + dy < h:
                    sp[x + dx, y + dy] = (238, 240, 255, a)
    img.alpha_composite(stars)
    return img


def space_backdrop(svg_path, w, h):
    """The vector front's backdrop at w x h: its radial gradient plus the
    star circles (fill #eef0ff) parsed from the SVG, drawn 4x and averaged
    down so they stay soft like the vector ones."""
    c0, c1 = (0x14, 0x1a, 0x2c), (0x04, 0x05, 0x0a)
    small = Image.new('RGB', (w // 4, h // 4))
    px = small.load()
    sw, shh = small.size
    for y in range(shh):
        for x in range(sw):
            t = min(1.0, math.hypot((x / sw - 0.5) / 0.85, (y / shh - 0.45) / 0.85))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))
    img = small.resize((w, h), Image.BILINEAR).convert('RGBA')
    src = open(svg_path).read()
    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', src)
    sx, sy = w / float(vb.group(1)), h / float(vb.group(2))
    S = 4
    stars = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(stars)
    for c in re.findall(r'<circle [^>]*fill="#eef0ff"[^>]*/>', src):
        a = dict(re.findall(r'(\w+)="([^"]*)"', c))
        cx, cy, r = float(a['cx']) * sx * S, float(a['cy']) * sy * S, float(a['r']) * sx * S
        op = round(255 * float(a.get('opacity', 1)))
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(238, 240, 255, op))
    img.alpha_composite(stars.resize((w, h), Image.LANCZOS))
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--deck', required=True)
    ap.add_argument('--map', nargs='+', required=True)
    a = ap.parse_args()
    out_dir = os.path.join(ROOT, 'assets', 'cards', a.deck)
    for i, m in enumerate(a.map):
        key, rest = m.split('=')
        name, _, kind = rest.partition(':')
        kind = kind or ('purple' if name.endswith('-back') else 'white')
        im = Image.open(os.path.join(a.src, f'{key}.png')).convert('RGBA')
        if kind == 'space':
            bg = space_backdrop(os.path.join(out_dir, f'{name}.svg'), *im.size)
            bg.alpha_composite(im)
            im = bg
        elif kind == 'purple':
            bg = purple_wash(*im.size, seed=i + 7)
            bg.alpha_composite(im)
            im = bg
        dst = os.path.join(out_dir, f'{name}-3d.png')
        im.save(dst, optimize=True)
        print('wrote', os.path.relpath(dst, ROOT))


if __name__ == '__main__':
    main()
