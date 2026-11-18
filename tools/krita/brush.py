# Scripted brushwork in Krita (the krita-brushwork skill): one small API over Krita's Python bindings so a generator
# paints real brush-engine strokes (ink with pressure taper, washes, dry brush, hatching) the same way every time.
# Runs inside Krita via tools/krita/run.sh. Every wobble comes from a seeded random.Random passed in, never the global
# generator (CLAUDE.md section 6.3). Units: canvas pixels, y down.
import math
import os
import random
from typing import List, Sequence, Tuple

from krita import InfoObject, Krita, ManagedColor
from PyQt5.QtCore import QPoint, QPointF, QRectF
from PyQt5.QtGui import QColor, QPainterPath

Pt = Tuple[float, float]


def args() -> List[str]:
    """The arguments given to tools/krita/run.sh after the script's path."""
    raw = os.environ.get("FC_KRITA_ARGS", "")
    return [a for a in raw.split("\n") if a]


class Canvas:
    """A Krita document with a transparent background, shown in a view so the brush engines can paint."""

    def __init__(self, w: int, h: int, name: str = "canvas") -> None:
        self.k = Krita.instance()
        self.doc = self.k.createDocument(w, h, name, "RGBA", "U8", "", 300.0)
        bg = self.doc.rootNode().childNodes()[0]
        bg.remove()                                   # transparent: pieces are composited over other art
        self.view = self.k.activeWindow().addView(self.doc)
        self.layer = None
        self.new_layer("base")

    def new_layer(self, name: str, opacity: int = 255, blend: str = "normal"):
        """Adds a paint layer on top and makes it the one strokes go to. opacity 0-255; blend is Krita's id."""
        n = self.doc.createNode(name, "paintlayer")
        n.setOpacity(opacity)
        n.setBlendingMode(blend)
        self.doc.rootNode().addChildNode(n, None)
        self.doc.setActiveNode(n)
        self.layer = n
        return n

    def brush(self, preset: str, size_px: float, colour: str, opacity: float = 1.0) -> None:
        """Selects a brush preset by its exact name, its size in px, its colour (#rrggbb) and its opacity 0-1."""
        presets = self.k.resources("preset")
        if preset not in presets:
            raise KeyError("no Krita brush preset named %r" % preset)
        self.view.activateResource(presets[preset])
        self.view.setBrushSize(float(size_px))
        self.view.setPaintingOpacity(float(opacity))
        c = QColor(colour)
        mc = ManagedColor("RGBA", "U8", "")
        mc.setComponents([c.blueF(), c.greenF(), c.redF(), 1.0])
        self.view.setForeGroundColor(mc)

    def line(self, a: Pt, b: Pt, p0: float = 1.0, p1: float = 1.0) -> None:
        """One straight stroke from a to b, its pressure going p0 to p1 (0-1): the taper of an inked line."""
        self.layer.paintLine(QPoint(round(a[0]), round(a[1])), QPoint(round(b[0]), round(b[1])), p0, p1)

    def polyline(self, pts: Sequence[Pt], taper: Tuple[float, float, float] = (0.3, 1.0, 0.3)) -> None:
        """A stroke through pts, pressure rising from taper[0] to taper[1] mid-stroke and falling to taper[2]."""
        n = len(pts) - 1
        for i in range(n):
            self.line(pts[i], pts[i + 1], _press(i / n, taper), _press((i + 1) / n, taper))

    def fill_path(self, pts: Sequence[Pt], fill: str = "ForegroundColor", stroke: str = "None") -> None:
        """Fills a closed outline with the brush's colour (Krita's fill styles: ForegroundColor, BackgroundColor, Pattern)."""
        path = QPainterPath(QPointF(*pts[0]))
        for p in pts[1:]:
            path.lineTo(QPointF(*p))
        path.closeSubpath()
        self.layer.paintPath(path, stroke, fill)

    def ellipse(self, x: float, y: float, w: float, h: float) -> None:
        """An inked ellipse in the box (x, y, w, h)."""
        self.layer.paintEllipse(QRectF(x, y, w, h))

    def save(self, path: str) -> None:
        """Flattens nothing (layers keep their blend modes in the projection) and writes a PNG."""
        self.doc.waitForDone()
        self.doc.refreshProjection()
        self.k.setBatchmode(True)
        self.doc.setBatchmode(True)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        if not self.doc.exportImage(path, InfoObject()):
            raise RuntimeError("Krita could not export " + path)


def wobble(pts: Sequence[Pt], rng: random.Random, amp_px: float, step_px: float = 6.0) -> List[Pt]:
    """Resamples a polyline every step_px and pushes each point off the line by a smooth random amount up to amp_px:
    a hand's wobble, the same for the same seed."""
    out: List[Pt] = []
    phase, freq = rng.uniform(0, math.tau), rng.uniform(0.04, 0.09)
    s = 0.0
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        L = math.hypot(bx - ax, by - ay)
        if L == 0:
            continue
        nx, ny = -(by - ay) / L, (bx - ax) / L
        k = max(1, int(L // step_px))
        for i in range(k):
            t = i / k
            d = amp_px * (0.7 * math.sin(phase + (s + t * L) * freq) + 0.3 * rng.uniform(-1, 1))
            out.append((ax + (bx - ax) * t + nx * d, ay + (by - ay) * t + ny * d))
        s += L
    out.append(pts[-1])
    return out


def _press(t: float, taper: Tuple[float, float, float]) -> float:
    a, m, b = taper
    return a + (m - a) * (t / 0.5) if t < 0.5 else m + (b - m) * ((t - 0.5) / 0.5)
