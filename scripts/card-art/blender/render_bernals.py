"""Blender card art: the other eight Bernals (16 faces).

Same kit as render_bernal_megastructures.py (imported from it): the shielded
Stanford torus, the Kalpana finned sphere, the mass driver that makes every
Bernal a dirt rocket, Cycles on the CPU, transparent film. Each scene draws
the station's own equipment from research (see the per-face comments in
scripts/card-art/bernals.mjs, which these follow), and `frame` places the
station in the open band beside the thrust triangle (the supports box and
ability text cover the lower half of a Bernal card).

Run:
    python scripts/card-art/blender/render_bernals.py --out DIR [--only key,key] [--samples 24]
Keys: '<cardId>-<front|back>'.
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
    TAU, W, H, Mats, box, cyl, glow, group, habitat, mass_driver, principled,
    rock, rod, sphere, sun, torus, tube, mat_planet, mat_clouds, mat_atmosphere,
    mat_rubble)

FACTION = [(0.71, 0.0, 0.33), (0.92, 0.7, 0.03), (0.62, 0.48, 0.92),
           (0.2, 0.83, 0.6), (0.61, 0.64, 0.69), (0.96, 0.94, 0.86)]


def srgb(c):
    return tuple(pow(v, 2.2) for v in c)


def kalpana(M, r=4.0, seed=2):
    """Kalpana One: a rubble-shielded sphere with radiator fins at its waist,
    a lit window band and docking caps on the spin axis (built axis Z)."""
    rnd = random.Random(seed)
    parts = [sphere('kal.shell', r, M.rubble, seg=64)]
    for i in range(55):
        a, z = rnd.uniform(0, TAU), rnd.uniform(-0.85, 0.85)
        rr = math.sqrt(1 - z * z) * r * 1.02
        parts.append(rock(f'kal.rock{i}', r * rnd.uniform(0.05, 0.09), M.rubble, (rr * math.cos(a), rr * math.sin(a), z * r)))
    for i in range(40):
        a = TAU * i / 40
        parts.append(box(f'kal.win{i}', (r * 0.05, r * 0.05, r * 0.1), M.window,
                         (r * 1.0 * math.cos(a), r * 1.0 * math.sin(a), -r * 0.15), (0, 0, a)))
    for s in (-1, 1):
        parts.append(box(f'kal.fin{s}', (r * 2.2, r * 0.05, r * 0.9), M.dark, (s * r * 1.9, 0, 0)))
        parts.append(cyl(f'kal.cap{s}', r * 0.25, r * 0.5, M.white, (0, 0, s * r * 1.1)))
    return parts


def frame(at=(0.68, 0.3), azim=-60.0, elev=25.0, lens=40, fill=1.0, skip=('bg.',)):
    """Aim a camera at the hardware's bounding sphere and slide the film so
    its centre lands at `at` (x right, y down, fractions of the frame)."""
    bpy.context.view_layer.update()
    pts = []
    for ob in bpy.context.scene.objects:
        if ob.type not in ('MESH', 'CURVE') or any(ob.name.startswith(k) for k in skip):
            continue
        pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    center = (lo + hi) / 2
    radius = max((p - center).length for p in pts)
    half = math.atan(18.0 / lens)
    # 0.6: the station should fill the band beside the triangle, not the card
    dist = radius / math.sin(half) / (fill * 0.6)
    a, e = math.radians(azim), math.radians(elev)
    loc = center + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    K.camera(tuple(loc), tuple(center), lens, shift=(-(at[0] - 0.5), (at[1] - 0.5) * H / W), clip=dist * 50)


def behind(name, r, local, mat=None, land=0.535):
    """Put a backdrop planet in CAMERA space (x right, y up, -z ahead), so it
    lands where the composition wants it whatever the framing did."""
    cam = bpy.context.scene.camera
    loc = tuple(cam.matrix_world @ Vector(local))
    if mat is not None:
        sphere(f'bg.{name}', r, mat, loc, 96)
    else:
        planet_bg(name, r, loc, land=land)


def lights(key=(0.6, -0.5, 0.6), strength=4.5):
    sun(key, strength)
    sun((-0.6, 0.4, 0.3), 0.6, (0.6, 0.75, 1.0), angle=30)


def planet_bg(name, r, loc, land=0.535, scale=0.6, ocean=False, mat=None):
    sphere(f'bg.{name}', r, mat or mat_planet(f'{name}m', scale / r * 3, land, ocean), loc, 96)
    sphere(f'bg.{name}c', r * 1.012, mat_clouds(f'{name}cl', scale / r * 3.5), loc, 96)
    sphere(f'bg.{name}a', r * 1.03, mat_atmosphere(f'{name}at', 3.0), loc, 96)


def mars_mat():
    m = principled('mars', srgb((0.75, 0.38, 0.2)), 0.9)
    nt = m.node_tree
    n = K.noise(nt, 2.0, 8, 0.6)
    r = K.ramp(nt, [(0.3, srgb((0.45, 0.2, 0.1))), (0.55, srgb((0.78, 0.42, 0.22))), (0.8, srgb((0.9, 0.62, 0.42)))])
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    return m


def solar_wing(name, M, loc, size, rot=(0, 0, 0)):
    p = box(name, size, M.pv, loc, rot)
    box(name + '.frame', (size[0] * 1.02, size[1] * 0.5, size[2] * 1.02), M.steel, loc, rot)
    return p


# ---- scenes ----------------------------------------------------------------

def l1_front(M, lab=False):
    """L1 Climate Control: a Kalpana sphere tending a vast faint sunshade
    between the Sun and a planet; the shade's shadow on the world."""
    hab = kalpana(M, 3.0, 4)
    group('hab', hab, (0, 0, 0), (0.3, 0.6, 0))
    mass_driver(M, (-3.0, 2.0, -1.5), (-1, 0.6, -0.4), 3.0, seed=5, n=22)
    shade = principled('shade', (0.55, 0.5, 0.42), 0.6, 0.2)
    shade.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.55
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=7, depth=0.05, location=(-9, 10, 3), rotation=(1.2, 0, 0.6))
    sh = bpy.context.active_object
    sh.name = 'shade.disc'
    sh.data.materials.append(shade)
    torus('shade.rim', 7, 0.12, M.steel, (-9, 10, 3), (1.2, 0, 0.6))
    rod('shade.tether', (0, 0, 0), (-9, 10, 3), 0.05, M.steel)
    if lab:
        # sampling dishes and a tilted mirror aimed at the planet; the planet's
        # air banded cooler
        for i, (x, y, z) in enumerate([(2.5, -1.5, 2.6), (-2.0, -2.0, 2.4)]):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=1.2, location=(x, y, z), segments=32, ring_count=16)
            d = bpy.context.active_object
            d.name = f'lab.dish{i}'
            d.scale = (1, 1, 0.3)
            d.data.materials.append(M.white)
        box('lab.mirror', (3.0, 0.08, 2.2), principled('mir', (0.9, 0.85, 0.6), 0.3, 0.35), (4.0, -1.0, -2.0), (0.4, 0.5, 0.8))
        tube('lab.beam', [(4.0, -1.0, -2.0), (14.0, -12.0, -18.0)], 0.06, M.blue)
    sun((-0.8, 0.5, 0.4), 4.5)
    sun((0.5, -0.6, 0.6), 0.5, (0.6, 0.75, 1.0), angle=30)
    frame((0.7, 0.3), azim=-70, elev=20, lens=32, fill=1.6, skip=('bg.', 'shade.disc', 'shade.rim', 'shade.tether', 'md.', 'lab.beam'))
    behind('earth', 16, (10, -14, -70))


def l2(M, lab=False):
    """L2 Collimator: the habitat behind a huge collimating mirror fed by
    solar wings; a pencil-thin green laser leaves it. Lab: a gimballed
    steering mirror splits the beam (the bonus pivot)."""
    hab = kalpana(M, 2.6, 6)
    group('hab', hab, (-6, 0, 0), (0.2, 0.5, 0))
    for s in (-1, 1):
        solar_wing(f'wing{s}', M, (-6, s * 7.5, 0), (3.5, 0.08, 7.0), (0, 0, 0))
        rod(f'wing{s}.boom', (-6, 0, 0), (-6, s * 4, 0), 0.12, M.steel)
    mirror = principled('mir', (0.95, 0.85, 0.55), 0.3, 0.35)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=6, location=(2, 0, 0), segments=64, ring_count=32)
    m = bpy.context.active_object
    m.name = 'mirror'
    m.scale = (0.18, 1, 1)
    m.data.materials.append(mirror)
    rod('mirror.strut', (-6, 0, 0), (1.2, 0, 0), 0.2, M.steel)
    green = glow('green', (0.3, 1.0, 0.45), 18)
    if lab:
        tube('beam', [(2.5, 0, 0), (12, 0, 0)], 0.09, green)
        torus('lab.gimbal', 1.4, 0.1, M.steel, (13, 0, 0), (0, 1.2, 0.5))
        box('lab.steer', (0.1, 1.8, 1.8), mirror, (13, 0, 0), (0, 0, 0.7))
        tube('beam2', [(13, 0, 0), (30, 9, 5)], 0.07, green)
        tube('beam3', [(13, 0, 0), (30, -9, -4)], 0.07, green)
    else:
        tube('beam', [(2.5, 0, 0), (40, -6, 3)], 0.09, green)
    lights((0.3, -0.8, 0.5))
    frame((0.62, 0.3), azim=-110, elev=18, lens=32, fill=1.3, skip=('beam',))


def l4(M, lab=False):
    """L4 Antimatter Factory: the habitat docked beside a big solar-powered
    accelerator ring of magnet segments, a magenta beam inside. Lab: rows of
    Penning-trap canisters with magenta trap points."""
    magenta = glow('magenta', (1.0, 0.25, 0.9), 14)
    if lab:
        hab = kalpana(M, 2.5, 8)
        group('hab', hab, (-9, 0, 2), (0.3, 0.4, 0))
        for r in range(3):
            for c in range(4):
                x, z = -2.0 + c * 2.6, -2.5 + r * 2.6
                cyl(f'trap{r}{c}', 0.8, 2.0, M.dark, (x, 0, z), (1.5708, 0, 0), 32)
                for k in range(3):
                    torus(f'trap{r}{c}.coil{k}', 0.82, 0.08, M.copper, (x, -0.6 + k * 0.6, z), (1.5708, 0, 0), (32, 8))
                sphere(f'trap{r}{c}.pt', 0.18, magenta, (x, -1.05, z), 12)
        lights((0.4, -0.8, 0.5))
        frame((0.64, 0.3), azim=-85, elev=14, lens=32, fill=1.2)
        return
    hab = kalpana(M, 2.6, 8)
    group('hab', hab, (-10, -2, 2), (0.3, 0.4, 0))
    mass_driver(M, (-12.5, -2, 0.5), (-1, -0.4, -0.5), 3.0, seed=6, n=20)
    torus('ring.beam', 8, 0.12, magenta, (2, 0, 0), (1.2, 0, 0))
    for i in range(18):
        a = TAU * i / 18
        p = Vector((8 * math.cos(a), 8 * math.sin(a), 0))
        ob = box(f'ring.mag{i}', (1.4, 0.9, 0.9), principled('magblue', (0.1, 0.2, 0.7), 0.35, 0.6), tuple(p), (0, 0, a + 1.5708))
        ob.parent = None
    ring = [o for o in bpy.context.scene.objects if o.name.startswith('ring.mag')]
    group('ring', ring, (2, 0, 0), (1.2, 0, 0))
    solar_wing('wing', M, (2, 0, 9.5), (10, 4, 0.08), (0.3, 0, 0))
    rod('wing.mast', (2, 0, 0), (2, 0, 9.5), 0.15, M.steel)
    rod('dock', (-7.4, -2, 2), (-6, 0, 0.5), 0.3, M.steel)
    lights((0.5, -0.7, 0.6))
    frame((0.64, 0.3), azim=-80, elev=28, lens=32, fill=1.3, skip=('md.',))


def l4s(M, lab=False):
    """L4s Pharmaceutics: sealed clean-room lab modules docked at the torus
    hub, clinical teal and white. Lab: perfectly uniform microspheres (the
    first space-made product sold), a protein-crystal tray and a centrifuge."""
    teal = principled('teal', srgb((0.37, 0.92, 0.83)), 0.3, emit=srgb((0.37, 0.92, 0.83)), strength=1.5)
    if lab:
        bead = principled('bead', (0.9, 0.98, 0.97), 0.05)
        bead.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.6
        for r in range(5):
            for c in range(6):
                sphere(f'bead{r}{c}', 0.85, bead, (c * 1.8 + (r % 2) * 0.9 - 4.5, 0, r * 1.6 - 3.2), 32)
        torus('lens', 6.2, 0.35, M.white, (0, 0.6, 0), (1.5708, 0, 0))
        box('tray', (5, 2.4, 0.4), M.white, (-9, 0, -4.5))
        for i in range(6):
            bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.35, depth=0.7, location=(-11 + i * 0.8, 0, -4.0))
            bpy.context.active_object.data.materials.append(teal)
        torus('fuge', 2.0, 0.25, M.steel, (-9, 0, 2.5), (1.5708, 0, 0))
        for k in range(4):
            a = k * math.pi / 2
            rod(f'fuge.arm{k}', (-9, 0, 2.5), (-9 + 2 * math.cos(a), 0, 2.5 + 2 * math.sin(a)), 0.1, M.steel)
        lights((0.3, -0.8, 0.6))
        frame((0.6, 0.3), azim=-90, elev=10, lens=32, fill=1.25)
        return
    hab = habitat(M, R=6.0, seed=12)
    group('hab', hab, (0, 0, 0), (1.0, 0, 0.3))
    for i in range(4):
        x = 2.5 + i * 2.4
        cyl(f'mod{i}', 1.0, 2.0, M.white, (x, -0.6, 2.2), (0, 1.5708, 0), 32)
        torus(f'mod{i}.band', 1.02, 0.12, teal, (x, -0.6, 2.2), (0, 1.5708, 0), (32, 8))
    rod('mods.spine', (0, 0, 0.5), (12, -0.6, 2.2), 0.25, M.steel)
    mass_driver(M, (-5, 2, -3), (-1, 0.3, -0.6), 3.0, seed=12, n=20)
    lights()
    frame((0.64, 0.3), azim=-70, elev=30, lens=32, fill=1.25, skip=('md.',))


def l5(M, lab=False):
    """L5 Solar Cell Factory: a robotic assembly truss rolling out huge dark-
    blue photovoltaic blankets beside the habitat. Lab: a thin-film
    deposition drum and a solar sail being finished."""
    hab = kalpana(M, 2.6, 10)
    group('hab', hab, (-10, 0, 0), (0.3, 0.4, 0))
    rod('truss', (-7, 0, 0), (12, 0, 0), 0.25, M.steel)
    if lab:
        cyl('drum', 2.0, 7, M.dark, (-2, 0, 0), (1.5708, 0, 0), 48)
        torus('drum.ring', 2.05, 0.1, M.blue, (-2, -3.2, 0), (1.5708, 0, 0))
        film = principled('film', (0.95, 0.85, 0.5), 0.1, 1.0)
        bpy.ops.mesh.primitive_plane_add(size=1, location=(7, 0, 1.5), rotation=(0, -0.25, 0))
        p = bpy.context.active_object
        p.name = 'sail'
        p.scale = (10, 7, 1)
        p.data.materials.append(film)
        mass_driver(M, (-12.5, 0, -1.0), (-1, -0.3, -0.6), 3.0, seed=10, n=18)
    else:
        for s in (-1, 1):
            solar_wing(f'blanket{s}', M, (4, s * 4.2, 0), (14, 6.5, 0.06))
        for i in range(5):
            box(f'robot{i}', (0.7, 0.7, 0.7), M.gold, (-2 + i * 3.4, 0, 0.6))
        mass_driver(M, (-12.5, 0, -1.0), (-1, -0.3, -0.6), 3.0, seed=10, n=18)
    lights((0.3, -0.6, 0.8))
    frame((0.62, 0.3), azim=-70, elev=35, lens=32, fill=1.25, skip=('md.',))


def l5s(M, lab=False):
    """L5s Cancer Hospital: a spinning wheel marked with a red cross behind a
    thick rubble shield. Lab: a proton-therapy beamline into a treatment couch
    inside a heavily shielded vault, the beam a soft blue."""
    red = principled('red', srgb((0.86, 0.15, 0.15)), 0.4)
    if lab:
        rub = mat_rubble('vault')
        box('vault.l', (1.5, 8, 7), rub, (-4, 0, 0))
        box('vault.b', (9, 1.5, 7), rub, (0.5, 4, 0))
        box('vault.f', (9, 1.5, 7), rub, (0.5, -4, 0), )
        box('vault.floor', (9, 8, 1), rub, (0.5, 0, -3.5))
        torus('sync', 5, 0.4, M.steel, (-12, 0, 0), (0, 0, 0))
        tube('beam', [(-7, 0, 0.8), (0.5, 0, 0.8)], 0.1, glow('pbeam', (0.5, 0.8, 1.0), 14))
        rod('beamline', (-12, 0, 0.8), (-5, 0, 0.8), 0.35, M.steel)
        box('couch', (5, 1.6, 0.4), M.white, (2.5, 0, -1))
        box('couch.base', (1.2, 1.0, 1.6), M.dark, (2.5, 0, -2))
        box('cross.v', (0.2, 0.6, 1.8), red, (-4.8, 0, 2.5))
        box('cross.h', (0.2, 1.8, 0.6), red, (-4.8, 0, 2.5))
        lights((0.5, -0.8, 0.6))
        frame((0.62, 0.3), azim=-55, elev=40, lens=32, fill=1.2)
        return
    hab = habitat(M, R=6.5, seed=14)
    group('hab', hab, (0, 0, 0), (1.15, 0, 0.2))
    white = principled('wht', (0.95, 0.95, 0.95), 0.4)
    box('cross.bg', (2.6, 0.2, 2.6), white, (0, -1.5, 0.4))
    box('cross.v', (0.8, 0.3, 2.2), red, (0, -1.6, 0.4))
    box('cross.h', (2.2, 0.3, 0.8), red, (0, -1.6, 0.4))
    mass_driver(M, (-6.5, 2, -2), (-1, 0.4, -0.5), 3.0, seed=14, n=20)
    lights()
    frame((0.64, 0.3), azim=-90, elev=20, lens=32, fill=1.25, skip=('md.',))


def sso(M, lab=False):
    """SSO Diplomatic: a stately torus with an assembly dome at the hub, a
    ring of six faction banners, GPS satellites in the 12-hour orbit. Lab: a
    great chamber ringed with delegate seats and antenna relay arrays."""
    flags = [principled(f'fac{i}', srgb(c), 0.5, emit=srgb(c), strength=0.3) for i, c in enumerate(FACTION)]
    if lab:
        cyl('floor', 8, 0.4, principled('fl', (0.12, 0.1, 0.28), 0.4), (0, 0, 0), verts=96)
        cyl('dais', 2.4, 0.8, M.white, (0, 0, 0.4), verts=64)
        for i in range(24):
            a = TAU * i / 24
            box(f'seat{i}', (0.7, 0.7, 0.9), flags[i % 6], (6.2 * math.cos(a), 6.2 * math.sin(a), 0.6), (0, 0, a))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=8.4, location=(0, 0, 0), segments=64, ring_count=32)
        d = bpy.context.active_object
        d.name = 'dome'
        d.scale = (1, 1, 0.55)
        glass = principled('glass', (0.7, 0.8, 1.0), 0.05)
        glass.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.9
        glass.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.25
        d.data.materials.append(glass)
        for s in (-1, 1):
            rod(f'ant{s}', (s * 9, 0, 0), (s * 9, 0, 6), 0.12, M.steel)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=1.4, location=(s * 9, 0, 6.6), segments=24, ring_count=12)
            a = bpy.context.active_object
            a.name = f'ant{s}.dish'
            a.scale = (1, 1, 0.3)
            a.data.materials.append(M.white)
        lights((0.4, -0.6, 0.8))
        frame((0.62, 0.32), azim=-80, elev=35, lens=32, fill=1.2)
        return
    hab = habitat(M, R=6.5, seed=16)
    group('hab', hab, (0, 0, 0), (1.0, 0, 0.2))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.8, location=(0, 0, 0), segments=32, ring_count=16)
    dm = bpy.context.active_object
    dm.name = 'dome'
    dm.data.materials.append(principled('domeg', (0.75, 0.88, 1.0), 0.1, emit=(0.6, 0.75, 1.0), strength=0.5))
    for i in range(6):
        a = TAU * i / 6
        base = Vector((7.4 * math.cos(a), 7.4 * math.sin(a), 0))
        pole = [base, base + Vector((0, 0, 2.6))]
        bp = [o for o in []]
        rod(f'ban{i}.pole', pole[0], pole[1], 0.06, M.steel)
        box(f'ban{i}', (1.1, 0.06, 0.7), flags[i], tuple(base + Vector((0.55, 0, 2.2))))
    flagobjs = [o for o in bpy.context.scene.objects if o.name.startswith('ban')]
    group('banners', flagobjs, (0, 0, 0), (1.0, 0, 0.2))
    for i, p in enumerate([(-14, 6, 5), (12, 8, 7)]):
        box(f'gps{i}', (0.8, 0.8, 0.8), M.gold, p)
        box(f'gps{i}.w', (3.4, 0.05, 0.8), M.pv, p)
    lights()
    frame((0.64, 0.3), azim=-90, elev=24, lens=32, fill=1.2, skip=('gps',))
    behind('earth', 26, (-6, -36, -90))


def tourism(M, lab=False):
    """Tourism Cycler: Aldrin's castle, a wheel with a shielded storm shelter
    looping forever between Earth and Mars; taxis dock as it flies past. Lab:
    the hotel's panoramic viewing deck, warm windows, Mars swinging by."""
    if lab:
        # the hotel wheel up close: a ring of big warm panoramic windows and a
        # glass viewing dome on the hub, Mars swinging by behind
        hab = habitat(M, R=6.0, seed=19)
        group('hab', hab, (0, 0, 0), (1.15, 0, 0.3))
        for i in range(16):
            a = TAU * i / 16
            box(f'pane{i}', (0.5, 1.8, 1.0), M.window, (7.1 * math.cos(a), 7.1 * math.sin(a), 0), (0, 0, a))
        panes = [o for o in bpy.context.scene.objects if o.name.startswith('pane')]
        group('panes', panes, (0, 0, 0), (1.15, 0, 0.3))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=2.0, location=(0, 0, 0), segments=32, ring_count=16)
        dm = bpy.context.active_object
        dm.name = 'dome'
        dm.data.materials.append(principled('domeg', (0.8, 0.9, 1.0), 0.1, emit=(1.0, 0.8, 0.5), strength=1.5))
        lights((0.6, -0.6, 0.4))
        frame((0.6, 0.3), azim=-90, elev=25, lens=32, fill=1.2, skip=('bg.',))
        behind('mars', 12, (-12, -16, -90), mars_mat())
        return
    hab = habitat(M, R=5.5, seed=18)
    group('hab', hab, (0, 0, 0), (1.0, 0, 0.4))
    box('shelter', (2.4, 2.4, 2.4), mat_rubble('shel'), (0, 0, 0))
    for i, p in enumerate([(8, -3, 3), (-8, -2, -2)]):
        box(f'taxi{i}', (1.6, 0.8, 0.8), M.white, p, (0, 0, 0.3))
        sphere(f'taxi{i}.lamp', 0.15, M.beacon, (p[0] + 0.9, p[1], p[2]), 10)
    orbit = [(30 * math.cos(t), 18 * math.sin(t) + 10, -6) for t in [i * TAU / 96 for i in range(97)]]
    tube('bg.orbit', orbit, 0.06, glow('orb', (0.9, 0.9, 1.0), 2))
    lights()
    frame((0.64, 0.3), azim=-90, elev=30, lens=32, fill=1.3, skip=('bg.',))
    behind('earth', 5, (-16, 2, -70))
    behind('mars', 3, (20, 4, -70), mars_mat())


SCENES = {
    'ber_l1_climate_control_bernal-front': lambda M: l1_front(M, False),
    'ber_l1_climate_control_bernal-back': lambda M: l1_front(M, True),
    'ber_l2_collimator_bernal-front': lambda M: l2(M, False),
    'ber_l2_collimator_bernal-back': lambda M: l2(M, True),
    'ber_l4_antimatter_factory-front': lambda M: l4(M, False),
    'ber_l4_antimatter_factory-back': lambda M: l4(M, True),
    'ber_l4s_pharmaceutics_bernal-front': lambda M: l4s(M, False),
    'ber_l4s_pharmaceutics_bernal-back': lambda M: l4s(M, True),
    'ber_l5_solar_cell_factory-front': lambda M: l5(M, False),
    'ber_l5_solar_cell_factory-back': lambda M: l5(M, True),
    'ber_l5s_cancer_hospital-front': lambda M: l5s(M, False),
    'ber_l5s_cancer_hospital-back': lambda M: l5s(M, True),
    'ber_sso_diplomatic-front': lambda M: sso(M, False),
    'ber_sso_diplomatic-back': lambda M: sso(M, True),
    'ber_tourism_cycler-front': lambda M: tourism(M, False),
    'ber_tourism_cycler-back': lambda M: tourism(M, True),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=24)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    keys = [k for k in SCENES if not a.only or k in a.only.split(',')]
    for k in keys:
        sc = K.reset(a.samples)
        SCENES[k](Mats())
        sc.render.filepath = os.path.join(a.out, f'{k}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', k, flush=True)


if __name__ == '__main__':
    main()
