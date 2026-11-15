"""Blender card art: the Module 4 spaceborn and robot colonists (16 cards,
front + promoted back = 32 faces).

The RENDERED candidate beside the SVG set (scripts/colonist-art-m4.mjs): the
user will pick one (2026-11-15: "try both I will decide whats better"). Same
concepts per face as the SVG set, built from primitives on the Bernal-art kit
(render_bernal_megastructures.py), Cycles on the CPU, transparent film; any
world in a scene is a rendered sphere, never drawn.

Run (Blender as a Python module, Python 3.11):
    python scripts/card-art/blender/render_colonists_m4.py --out DIR [--only id-front,...] [--samples 32]
then: python3 scripts/card-art/blender/composite.py --src DIR --deck colonists-m4 --webp \
        --map <key>=<key>:dark (fronts) <key>=<key>:purple (backs)
"""
import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import render_bernal_megastructures as K  # noqa: E402
from render_bernal_megastructures import (  # noqa: E402
    TAU, Mats, sphere, sun, glow, principled, cyl, box, rod, torus)
from render_contracts import cone, rock_body, look, halo, hw_rover  # noqa: E402

W, H = 600, 660


# ---- builders --------------------------------------------------------------

def figure(name, M, loc, suit, skin=(0.78, 0.6, 0.48), visor=None, arm_up=False, s=1.0):
    """A person in a soft suit, about 1.8 * s tall, feet at loc."""
    x, y, z = loc
    st = principled(name + '.suit', suit, 0.6)
    sk = principled(name + '.skin', skin, 0.5)
    parts = [cyl(name + '.legL', 0.09 * s, 0.85 * s, st, (x - 0.1 * s, y, z + 0.42 * s)),
             cyl(name + '.legR', 0.09 * s, 0.85 * s, st, (x + 0.1 * s, y, z + 0.42 * s)),
             cyl(name + '.torso', 0.22 * s, 0.7 * s, st, (x, y, z + 1.15 * s)),
             sphere(name + '.head', 0.16 * s, sk, (x, y, z + 1.68 * s), 32)]
    for side in (-1, 1):
        up = arm_up and side == 1
        a = (x + side * 0.27 * s, y, z + 1.42 * s)
        b = (x + side * 0.45 * s, y, z + (1.95 if up else 0.8) * s)
        parts.append(rod(name + f'.arm{side}', a, b, 0.065 * s, st))
    if visor:
        parts.append(box(name + '.visor', (0.24 * s, 0.05 * s, 0.07 * s), glow(name + '.v', visor, 4.0), (x, y - 0.14 * s, z + 1.7 * s)))
    return parts


def cobot(name, M, loc, s=1.0):
    x, y, z = loc
    eye = glow(name + '.eye', (0.5, 0.82, 1.0), 6.0)
    parts = [cyl(name + '.body', 0.3 * s, 0.8 * s, M.white, (x, y, z + 0.55 * s)),
             sphere(name + '.head', 0.32 * s, M.white, (x, y, z + 1.25 * s), 48),
             box(name + '.face', (0.4 * s, 0.1 * s, 0.24 * s), principled(name + '.fc', (0.03, 0.03, 0.04), 0.2), (x, y - 0.24 * s, z + 1.25 * s))]
    for d in (-1, 1):
        parts.append(sphere(name + f'.eye{d}', 0.045 * s, eye, (x + d * 0.08 * s, y - 0.3 * s, z + 1.27 * s), 16))
        parts.append(cyl(name + f'.arm{d}', 0.07 * s, 0.6 * s, M.white, (x + d * 0.4 * s, y, z + 0.6 * s)))
    return parts


def walker(name, M, loc, legs=4, s=1.0, color=(0.36, 0.38, 0.42), heads=1):
    x, y, z = loc
    mat = principled(name + '.m', color, 0.45, 0.6)
    span = 1.4 * s
    parts = [box(name + '.body', (span, 0.42 * s, 0.26 * s), mat, (x, y, z + 0.9 * s))]
    for i in range(legs // 2):
        lx = x - span / 2 + 0.15 * s + i * (span - 0.3 * s) / max(1, legs // 2 - 1)
        for side in (-1, 1):
            knee = (lx + 0.15 * s * (1 if i >= legs // 4 else -1), y + side * 0.32 * s, z + 0.6 * s)
            parts.append(rod(name + f'.th{i}{side}', (lx, y + side * 0.2 * s, z + 0.85 * s), knee, 0.05 * s, mat))
            parts.append(rod(name + f'.sh{i}{side}', knee, (lx, y + side * 0.36 * s, z), 0.04 * s, mat))
            parts.append(sphere(name + f'.kn{i}{side}', 0.06 * s, M.steel, knee, 16))
    for h in range(heads):
        hx = x + span / 2 + 0.1 * s
        hz = z + 1.0 * s + (h - (heads - 1) / 2) * 0.42 * s
        hy = y + (h - (heads - 1) / 2) * 0.3 * s
        if heads > 1:
            parts.append(rod(name + f'.neck{h}', (x + span / 2 - 0.1 * s, y, z + 0.95 * s), (hx + 0.2 * s, hy, hz + 0.3 * s), 0.05 * s, mat))
            hx, hz = hx + 0.25 * s, hz + 0.35 * s
        parts.append(box(name + f'.head{h}', (0.32 * s, 0.24 * s, 0.2 * s), mat, (hx, hy, hz)))
        parts.append(sphere(name + f'.eye{h}', 0.04 * s, M.beacon, (hx + 0.16 * s, hy - 0.08 * s, hz), 12))
    return parts


def node_web(name, center, r, n, seed, node_col=(0.6, 0.85, 1.0), line_col=(0.4, 0.7, 1.0)):
    rnd = random.Random(seed)
    nm = glow(name + '.n', node_col, 8.0)
    lm = glow(name + '.l', line_col, 2.0)
    cx, cy, cz = center
    pts = []
    for _ in range(n):
        v = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized() * r * rnd.random() ** 0.4
        pts.append((cx + v.x, cy + v.y * 0.4, cz + v.z))
    parts = [sphere(name + f'.p{i}', 0.035 if i % 4 else 0.06, nm, p, 12) for i, p in enumerate(pts)]
    for i, a in enumerate(pts):
        for j, b in enumerate(pts):
            if j > i and (Vector(a) - Vector(b)).length < r * 0.6:
                parts.append(rod(name + f'.e{i}_{j}', a, b, 0.006, lm))
    return parts


def sail(name, M, loc, size=1.6, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    sl = K.obj(name)
    sl.data.materials.append(principled(name + '.m', (0.86, 0.88, 0.92), 0.15, 0.9))
    parts = [sl, box(name + '.hub', (0.12, 0.12, 0.12), M.gold, loc, rot)]
    return parts


def hex_lattice(name, loc, n=6, cell=0.32):
    mat = principled(name + '.m', (0.62, 0.66, 0.72), 0.35, 0.9)
    parts = []
    x0, y0, z0 = loc
    for r in range(n):
        for c in range(n):
            x = x0 + (c - n / 2) * cell + (r % 2) * cell / 2
            z = z0 + (r - n / 2) * cell * 0.87
            parts.append(torus(name + f'.h{r}{c}', cell * 0.45, 0.015, mat, (x, y0, z), (math.radians(90), 0, 0), seg=(6, 6)))
    return parts


def towers(name, M, loc, heights=(2.2, 2.8)):
    parts = []
    lay = principled(name + '.lay', (0.85, 0.86, 0.9), 0.4)
    for t, hgt in enumerate(heights):
        x = loc[0] + (t - 0.5) * 0.7
        for i in range(int(hgt / 0.12)):
            parts.append(box(name + f'.l{t}_{i}', (0.5, 0.5, 0.1), lay, (x, loc[1], loc[2] + 0.06 + i * 0.12)))
    parts.append(box(name + '.head', (0.7, 0.08, 0.05), glow(name + '.g', (1.0, 0.85, 0.5), 8.0), (loc[0] + 0.35, loc[1], loc[2] + heights[1] + 0.1)))
    return parts


def fluid_mat(name, color):
    m = principled(name, color, 0.05)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Transmission Weight'].default_value = 1.0
    b.inputs['IOR'].default_value = 1.05
    return m


def vat(name, M, loc, fluid=(0.45, 0.9, 0.75), form=(0.95, 0.7, 0.62)):
    x, y, z = loc
    glass = principled(name + '.glass', (0.9, 0.95, 1.0), 0.05)
    glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
    return [cyl(name + '.tube', 0.36, 1.6, glass, (x, y, z + 0.9)),
            cyl(name + '.fluid', 0.33, 1.5, fluid_mat(name + '.fl', fluid), (x, y, z + 0.9)),
            sphere(name + '.form', 0.22, principled(name + '.f', form, 0.5), (x, y, z + 0.85), 32),
            sphere(name + '.formh', 0.13, principled(name + '.fh', form, 0.5), (x + 0.05, y, z + 1.15), 24),
            cyl(name + '.base', 0.42, 0.14, M.steel, (x, y, z + 0.07)),
            cyl(name + '.cap', 0.42, 0.14, M.steel, (x, y, z + 1.73))]


def delta_ship(name, M, loc, hull=(0.9, 0.92, 0.95), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.9, radius2=0.0, depth=0.22, location=loc, rotation=rot)
    ob = K.obj(name)
    ob.scale = (1.6, 0.7, 1.0)
    ob.data.materials.append(principled(name + '.m', hull, 0.3, 0.6))
    return [ob, sphere(name + '.glow', 0.16, halo(name + '.g', (1.0, 0.6, 0.3), 3.0), (loc[0] - 0.9, loc[1], loc[2]), 24)]


def pod(name, M, loc):
    x, y, z = loc
    glass = principled(name + '.glass', (0.75, 0.9, 1.0), 0.05)
    glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.9
    shell = cyl(name + '.shell', 0.45, 2.2, M.white, (x, y, z), (0, math.radians(90), 0))
    lid = cyl(name + '.lid', 0.47, 1.7, glass, (x, y - 0.05, z + 0.05), (0, math.radians(90), 0))
    return [shell, lid, figure(name + '.sleeper', M, (x - 0.9, y, z - 0.1), (0.85, 0.85, 0.92), s=0.5)[3],
            box(name + '.stand', (1.6, 0.6, 0.2), M.dark, (x, y, z - 0.55))]


def domes(name, loc, n=3):
    glass = principled(name + '.g', (0.85, 0.95, 1.0), 0.05)
    glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.85
    win = glow(name + '.w', (1.0, 0.85, 0.5), 6.0)
    parts = []
    for i in range(n):
        r = 0.6 + 0.25 * (i % 2)
        x = loc[0] + (i - (n - 1) / 2) * 1.3
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, loc[1] + i * 0.4, loc[2]), segments=48, ring_count=24)
        d = K.obj(name + f'.d{i}')
        d.data.materials.append(glass)
        parts.append(d)
        parts.append(box(name + f'.h{i}', (r * 0.9, r * 0.6, r * 0.35), win, (x, loc[1] + i * 0.4, loc[2] + r * 0.18)))
    return parts


def ground(name, color, z=0.0, size=40):
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, z))
    g = K.obj(name)
    g.data.materials.append(K.mat_rubble(name + '.m') if color is None else principled(name + '.m', color, 0.9))
    return [g]


def lights(key=(0.6, -0.8, 0.7), strength=4.0):
    sun(key, strength)
    sun((-0.7, 0.5, 0.2), 1.2, (0.6, 0.75, 1.0), angle=20)


_CAM = {}  # reset per scene in main()


def cam(target=(0, 0, 1.0), dist=7.5, lens=50, elev=0.15, zoom=1.0):
    """Record the view direction; main() frames the subject from it (frame())."""
    _CAM.update(elev=elev, lens=lens, zoom=zoom)


BACKDROP = ('ground', 'canyon', 'reg', 'earth.bg', 'dawn')


def frame(margin=1.12):
    """Fit the camera to the subject: the bounding sphere of every mesh that is
    not a backdrop (ground plane, background world), seen from the scene's
    elevation, so each figure fills the card art box."""
    pts = []
    dg = bpy.context.evaluated_depsgraph_get()   # curves (rods) only have bounds once evaluated
    for ob in bpy.context.scene.objects:
        if ob.type not in ('MESH', 'CURVE') or ob.name.startswith(BACKDROP):
            continue
        ev = ob.evaluated_get(dg)
        pts += [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2
    elev, lens = _CAM.get('elev', 0.15), _CAM.get('lens', 50)
    half_w = 18.0 * W / H / lens          # sensor fits the taller side (36 mm)
    half_h = 18.0 / lens
    ext_x, ext_z = (hi.x - lo.x) / 2, (hi.z - lo.z) / 2 + (hi.y - lo.y) * elev / 2
    dist = max(ext_x / half_w, ext_z / half_h) * margin / _CAM.get('zoom', 1.0) + (hi.y - lo.y) / 2
    d = Vector((0, -1, elev)).normalized()
    K.camera(tuple(c + d * dist), tuple(c), lens)


# ---- scenes (front = working face, back = promoted face) ---------------------

def sc(key, M):
    s = key
    if s == 'col_cobots-front':
        figure('f1', M, (-0.55, 0, 0), (0.18, 0.24, 0.34), (0.45, 0.3, 0.2)); cobot('cb', M, (0.55, 0, 0), 1.2); cam()
    elif s == 'col_cobots-back':
        for i, (x, sz) in enumerate([(-1.0, 1.0), (-0.3, 0.7), (0.4, 1.05), (1.0, 0.6)]):
            figure(f'fam{i}', M, (x, 0, 0), (0.08, 0.06, 0.12), (0.08, 0.06, 0.12), s=sz)
        sphere('dawn', 3.0, sun_like(), (0.4, 9.0, -1.6), 64); cam((0, 0, 0.9))
    elif s == 'col_beowulf_internet-front':
        node_web('net', (0, 0, 1.0), 1.8, 38, 4); sphere('earth.bg', 2.4, K.mat_planet('e', 0.25, 0.535), (1.2, 6, -1.8), 96); cam()
    elif s == 'col_beowulf_internet-back':
        node_web('grendel', (0, 0, 1.0), 1.4, 60, 9, (1.0, 0.95, 0.8), (0.9, 0.8, 1.0)); cam(zoom=1.9)
    elif s == 'col_self_designing_heuristics-front':
        node_web('brain', (0, 0, 1.0), 1.2, 44, 11, (0.8, 0.9, 1.0), (0.5, 0.65, 1.0))
        sphere('skull', 1.35, halo('sk', (0.4, 0.55, 1.0), 0.5), (0, 0, 1.0), 64); cam()
    elif s == 'col_self_designing_heuristics-back':
        g = glow('glyph', (1.0, 0.55, 0.8), 6.0)
        rod('x1', (-1.2, 0, 1.5), (-0.6, 0, 0.9), 0.07, g); rod('x2', (-1.2, 0, 0.9), (-0.6, 0, 1.5), 0.07, g)
        w = glow('glyph2', (1.0, 1.0, 1.0), 6.0)
        rod('p1', (0.6, 0, 1.6), (0.6, 0, 0.8), 0.07, w); rod('p2', (0.2, 0, 1.2), (1.0, 0, 1.2), 0.07, w)
        torus('sq', 0.35, 0.05, glow('glyph3', (0.55, 0.88, 1.0), 6.0), (0, 0, 0.3), (math.radians(90), 0, math.radians(45)), seg=(4, 8)); cam()
    elif s == 'col_combat_quadrupeds-front':
        ground('ground', (0.32, 0.2, 0.12)); walker('q', M, (0, 0, 0), 4, 1.2); cam((0, 0, 0.8))
    elif s == 'col_combat_quadrupeds-back':
        walker('hydra', M, (-0.4, 0, 0), 4, 1.1, (0.82, 0.84, 0.88), heads=3); cam((0, 0, 1.0))
    elif s == 'col_sensor_web_sail-front':
        sail('sail', M, (0, 0, 1.1), 2.2, (math.radians(70), 0, math.radians(35)))
        cyl('beam', 0.03, 6, glow('b', (1.0, 0.5, 0.35), 3.0), (-1.6, 1.0, -1.4), (math.radians(55), math.radians(35), 0)); cam()
    elif s == 'col_sensor_web_sail-back':
        sail('wisp', M, (0.5, 0, 1.6), 0.6, (math.radians(70), 0, math.radians(20)))
        sphere('trail', 0.5, halo('tr', (0.9, 0.85, 1.0), 1.2), (0.0, 0.2, 1.1), 32); cam()
    elif s == 'col_nano_3d_printers-front':
        hex_lattice('lat', (0, 0, 1.0), 7, 0.36); cam()
    elif s == 'col_nano_3d_printers-back':
        towers('tw', M, (0, 0, 0)); cam((0, 0, 1.4))
    elif s == 'col_lava_lamp_evangelists-front':
        figure('ev', M, (0, 0, 0), (0.12, 0.12, 0.14), (0.7, 0.5, 0.36), arm_up=True, s=1.15)
        torus('laurel', 0.5, 0.04, glow('lg', (1.0, 0.55, 0.15), 8.0), (0, -0.4, 1.0), (math.radians(90), 0, 0)); cam()
    elif s == 'col_lava_lamp_evangelists-back':
        arm = cyl('arm', 0.22, 2.4, principled('skin', (0.7, 0.5, 0.36), 0.5), (0, 0, 1.0), (0, math.radians(20), 0))
        for i in range(14):
            a = i * 2.4
            sphere(f'goo{i}', 0.07, glow(f'goo{i}m', (1.0, 0.6, 0.3), 6.0), (math.sin(a) * 0.2 + (i - 7) * 0.06, -0.2, 0.2 + i * 0.12), 12)
        cam()
    elif s == 'col_gabonese_mining_consortium-front':
        figure('kid', M, (0, 0, 0), (0.92, 0.9, 0.85), (0.35, 0.22, 0.15), arm_up=True, s=0.9)
        box('bino', (0.2, 0.12, 0.08), M.dark, (0.08, -0.12, 1.55)); towers('city', M, (1.4, 2.0, 0), (1.6, 2.2)); cam()
    elif s == 'col_gabonese_mining_consortium-back':
        ground('reg', None); domes('bubble', (0, 0.5, 0)); cam((0, 0, 0.7), 7.0, elev=0.25)
    elif s == 'col_prehensilists-front':
        water = principled('water', (0.5, 0.8, 1.0), 0.02)
        water.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
        d = sphere('drop', 0.8, water, (0, 0, 1.0), 64); d.scale = (1, 1, 1.25)
        for i in range(6):
            a = TAU * i / 6
            K.tube(f'tendril{i}', [(math.cos(a) * 1.6, 0.2, 1.0 + math.sin(a) * 1.6), (math.cos(a) * 1.0, 0, 1.0 + math.sin(a) * 1.1), (math.cos(a + 0.4) * 0.9, -0.2, 1.0 + math.sin(a + 0.4) * 0.9)], 0.04, glow(f'tm{i}', (0.25, 0.75, 0.9), 2.0))
        cam()
    elif s == 'col_prehensilists-back':
        parts = figure('floater', M, (0, 0, 0), (0.9, 0.88, 0.95), visor=(0.3, 0.5, 0.9), arm_up=True, s=1.2)
        K.group('fl', parts, (0, 0, 0.2), (0, math.radians(-35), 0)); cam()
    elif s == 'col_exoskeletalists-front':
        ground('canyon', (0.5, 0.2, 0.1)); figure('hiker', M, (0, 0, 0), (0.22, 0.28, 0.34), s=1.1)
        for z in (0.4, 0.9, 1.3):
            torus(f'frame{z}', 0.26, 0.025, M.steel, (0, 0, z), seg=(24, 6))
        cam((0, 0, 0.9))
    elif s == 'col_exoskeletalists-back':
        delta_ship('jockey', M, (0, 0, 1.0), (0.1, 0.1, 0.12), (math.radians(80), math.radians(-25), math.radians(10))); cam()
    elif s == 'col_teleoperators-front':
        figure('op', M, (-0.6, 0, 0), (0.1, 0.14, 0.2), (0.35, 0.22, 0.15), visor=(0.5, 0.82, 1.0)); cobot('drone', M, (0.6, 0, 0), 1.1); cam()
    elif s == 'col_teleoperators-back':
        sphere('head', 0.7, principled('hd', (0.7, 0.45, 0.32), 0.5), (-0.4, 0, 1.0), 64)
        for i, p in enumerate([(0.9, 0, 1.8), (1.3, 0.2, 1.2), (1.0, -0.2, 0.5)]):
            box(f'dr{i}', (0.3, 0.2, 0.08), M.white, p); rod(f'link{i}', (-0.0, 0, 1.0), p, 0.008, glow(f'lk{i}', (0.6, 0.95, 1.0), 4.0))
        cam()
    elif s == 'col_boston_hexapods-front':
        walker('hex', M, (0, 0, 0), 6, 1.1, (0.82, 0.85, 0.88)); cam((0, 0, 0.7))
    elif s == 'col_boston_hexapods-back':
        figure('zombie', M, (0.4, 0, 0), (0.95, 0.95, 0.97), (0.85, 0.72, 0.6), s=1.1)
        for i in range(5):
            box(f'holo{i}', (0.6 - i * 0.06, 0.01, 0.05), glow(f'hl{i}', (0.55, 0.95, 1.0), 4.0), (-0.7, -0.2, 0.8 + i * 0.22))
        cam()
    elif s == 'col_neural_pilots-front':
        delta_ship('pilot', M, (0, 0, 1.0), rot=(math.radians(80), math.radians(-15), math.radians(-15))); cam()
    elif s == 'col_neural_pilots-back':
        sphere('skull', 0.9, halo('sk2', (0.85, 0.8, 1.0), 0.8), (0, 0, 1.0), 64)
        node_web('mind', (0, 0, 1.1), 0.6, 26, 13, (0.6, 0.4, 1.0), (0.5, 0.35, 0.9))
        rod('cable', (0.8, 0, 1.0), (1.6, 0, 1.6), 0.03, glow('cb', (0.6, 0.95, 1.0), 4.0)); cam()
    elif s == 'col_vr_simulcasters-front':
        figure('host', M, (-0.5, 0, 0), (0.48, 0.2, 0.26), (0.55, 0.36, 0.22))
        parts = figure('avatar', M, (0.6, 0, 0), (0.5, 0.88, 1.0), (0.5, 0.88, 1.0))
        for ob in parts:
            ob.data.materials[0] = glow('holo', (0.5, 0.88, 1.0), 1.5)
        cam()
    elif s == 'col_vr_simulcasters-back':
        figure('a', M, (-0.8, 0, 0), (0.12, 0.08, 0.18)); figure('b', M, (0.8, 0, 0), (0.12, 0.08, 0.18), (0.35, 0.22, 0.15))
        sphere('presence', 0.4, halo('pr', (0.9, 0.95, 1.0), 4.0), (0, 0, 1.3), 32); cam()
    elif s == 'col_transhuman_activists-front':
        for i in range(12):
            a = TAU * i / 12
            figure(f'ring{i}', M, (math.cos(a) * 1.4, math.sin(a) * 1.4, 0), (0.85, 0.9, 0.88), s=0.45)
        sphere('beacon', 0.35, halo('bc', (0.6, 1.0, 0.75), 4.0), (0, 0, 0.6), 32); cam((0, 0, 0.4), 6.0, elev=0.6)
    elif s == 'col_transhuman_activists-back':
        figure('soldier', M, (0, 0, -0.4), (0.16, 0.16, 0.2), (0.2, 0.2, 0.24), visor=(0.6, 0.95, 1.0), s=1.3)
        box('hud', (0.9, 0.02, 0.6), glow('hud', (0.6, 0.95, 1.0), 0.6), (-0.9, -0.6, 1.7)); cam((0, 0, 1.2))
    elif s == 'col_clone_entrepreneurs-front':
        vat('v1', M, (-0.55, 0, 0)); vat('v2', M, (0.55, 0, 0)); cam((0, 0, 0.9))
    elif s == 'col_clone_entrepreneurs-back':
        pod('pod', M, (0, 0, 1.0)); cam()
    else:
        raise SystemExit(f'no scene for {key}')
    lights()


def sun_like():
    m = bpy.data.materials.new('dawn')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1.0, 0.7, 0.4, 1)
    em.inputs['Strength'].default_value = 3.0
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


IDS = ['col_cobots', 'col_beowulf_internet', 'col_self_designing_heuristics', 'col_combat_quadrupeds',
       'col_sensor_web_sail', 'col_nano_3d_printers', 'col_lava_lamp_evangelists',
       'col_gabonese_mining_consortium', 'col_prehensilists', 'col_exoskeletalists', 'col_teleoperators',
       'col_boston_hexapods', 'col_neural_pilots', 'col_vr_simulcasters', 'col_transhuman_activists',
       'col_clone_entrepreneurs']


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=32)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    keys = [f'{i}-{s}' for i in IDS for s in ('front', 'back')]
    keys = [k for k in keys if not a.only or k in a.only.split(',')]
    for n, key in enumerate(keys):
        K.reset(a.samples)
        sc_ = bpy.context.scene
        sc_.render.resolution_x, sc_.render.resolution_y = W, H
        _CAM.clear()
        sc(key, Mats())
        frame()
        sc_.render.filepath = os.path.join(a.out, f'{key}.png')
        bpy.ops.render.render(write_still=True)
        print(f'[{n + 1}/{len(keys)}] {key}', flush=True)


if __name__ == '__main__':
    main()
