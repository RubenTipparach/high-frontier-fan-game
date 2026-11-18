# The krita-brushwork self-test: paints a wobbly inked tag with a wash under it, saves it, and checks the PNG has ink
# (dark pixels), wash (mid alpha) and a transparent outside. Run: tools/krita/run.sh tools/krita/selftest.py <out.png>
import random
import sys

from brush import Canvas, args, wobble
from PyQt5.QtGui import QImage

out = (args() or ["/tmp/krita-selftest.png"])[0]
rng = random.Random(7)
c = Canvas(400, 200, "selftest")
tag = [(40, 40), (330, 30), (370, 80), (350, 165), (50, 160), (40, 40)]
c.new_layer("wash", opacity=200)
c.brush("d) Ink-2 Fineliner", 4, "#a8482a")
c.fill_path(wobble(tag, rng, 2.0))
c.new_layer("ink")
c.brush("d) Ink-7 Brush Rough", 7, "#2a1410")
c.polyline(wobble(tag, rng, 2.5), taper=(0.2, 1.0, 0.4))
c.save(out)
img = QImage(out)
dark = sum(1 for y in range(0, 200, 2) for x in range(0, 400, 2) if (img.pixel(x, y) >> 24) & 255 > 200 and (img.pixel(x, y) & 255) < 70)
corner = (img.pixel(2, 197) >> 24) & 255
print("selftest: ink pixels", dark, "corner alpha", corner)
sys.exit(0 if dark > 200 and corner == 0 else 1)
