"""Trace a transparent-background render into a layered, flat-colour SVG group.

The colonist card art is SVG. Its people are posed and rendered in Blender
(scripts/blender/colonist_people.py) and then drawn as vector art from that
render: the opaque pixels are clustered into K flat colours (k-means in Lab-ish
space), each colour's region is traced with potrace, and the layers stack from
largest to smallest so a figure reads as cel-shaded paint, not a photo.

  python3 scripts/trace_render.py IN.png OUT.svg [--k 9] [--scale 0.5] [--smooth 1.0]

OUT.svg is a standalone SVG whose single <g id="figure"> is what the card
generator inlines. --scale maps render pixels to card units (600 px -> 300).
"""
import sys, os, subprocess, tempfile, re
import numpy as np
from PIL import Image, ImageFilter

args = sys.argv[1:]
src, dst = args[0], args[1]
opt = lambda k, d: type(d)(args[args.index(k) + 1]) if k in args else d
K = opt("--k", 9)
SCALE = opt("--scale", 0.5)
SMOOTH = opt("--smooth", 1.0)

im = Image.open(src).convert("RGBA")
W, H = im.size
a = np.asarray(im).astype(np.float32)
alpha = a[..., 3] > 127
rgb = a[..., :3]
pix = rgb[alpha]

# k-means (deterministic init: quantiles of luminance)
lum = pix @ np.array([0.299, 0.587, 0.114])
order = np.argsort(lum)
cent = pix[order[np.linspace(0, len(order) - 1, K).astype(int)]].copy()
for _ in range(25):
    d = ((pix[:, None, :] - cent[None, :, :]) ** 2).sum(-1)
    lab = d.argmin(1)
    for k in range(K):
        sel = pix[lab == k]
        if len(sel):
            cent[k] = sel.mean(0)
labels = np.full(alpha.shape, -1)
labels[alpha] = lab


def trace(mask):
    """potrace one boolean mask; returns path d strings in render pixel space."""
    with tempfile.TemporaryDirectory() as t:
        pbm = os.path.join(t, "m.pbm")
        Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert("1").save(pbm)
        out = os.path.join(t, "m.svg")
        subprocess.run(["potrace", pbm, "-s", "-o", out, "--turdsize", "6", "--alphamax", str(SMOOTH), "--opttolerance", "0.4", "--flat"], check=True)
        txt = open(out).read()
    tf = re.search(r'<g transform="([^"]+)"', txt)
    ds = re.findall(r'<path d="([^"]+)"', txt)
    return tf.group(1) if tf else "", ds


# Stack: the whole silhouette first in the darkest-but-one colour (closes gaps
# between layers), then each colour, largest area first.
counts = [(int((labels == k).sum()), k) for k in range(K)]
layers = []
sil_tf, sil = trace(alpha)
sil_col = cent[int(np.argsort([c.sum() for c in cent])[1])]
layers.append((sil_col, sil_tf, sil))
for n, k in sorted(counts, reverse=True):
    if n < 30:
        continue
    m = labels == k
    # a 1 px grow so neighbouring layers overlap instead of leaving hairlines
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 127
    m &= alpha
    tf, ds = trace(m)
    layers.append((cent[k], tf, ds))

hexc = lambda c: "#%02x%02x%02x" % tuple(int(max(0, min(255, v))) for v in c)
g = [f'<g id="figure" transform="scale({SCALE})">']
for col, tf, ds in layers:
    g.append(f'<g transform="{tf}" fill="{hexc(col)}">' + "".join(f'<path d="{d}"/>' for d in ds) + "</g>")
g.append("</g>")
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W * SCALE:g} {H * SCALE:g}" width="{W * SCALE:g}" height="{H * SCALE:g}">' + "".join(g) + "</svg>"
open(dst, "w").write(svg)
print(f"traced {src} -> {dst}: {len(layers)} layers, {len(svg) // 1024} KB")
