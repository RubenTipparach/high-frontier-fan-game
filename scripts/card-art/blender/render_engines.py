"""Blender card art: GW/TW thrusters (14 faces) and freighters (14 faces).

Built on the thruster proof of concept (scripts/blender/render_thruster_art.py):
its primitives, lathe, materials, ship kit and the shared vessel POSE (nose
up-left, plume down-right) are imported, not copied. Every engine is bolted to
a spacecraft. Each face draws ITS drive from Eklund's designer notes (M1 rules
1Z1 freighters, 1Z2 GW/TW), the same briefs as the per-face comments in
scripts/card-art/gwthrusters.mjs and freighters.mjs.

Engine-local frame: Z up, plume toward -Z, ship on +Z. `place` frames the
hardware and slides the film so the engine sits where its card has room:
GW/TW across the thrust-triangle band (y ~0.41), freighters in the open lower
half (y ~0.72). Renders go on a transparent film; composite.py puts purple
backs on the promoted wash (black fronts stay transparent over the dark card).

Run:
    python scripts/card-art/blender/render_engines.py --out DIR [--deck gw|freighter] [--only key,key] [--samples 20]
"""
import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'blender'))
import render_bernal_megastructures as K  # noqa: E402  (reset at 600x576)
from render_thruster_art import (  # noqa: E402
    TAU, POSE, asteroid, bell_profile, box, capsule_tank, copper, cyl, group,
    is_glow, lathe, mat_glow, mat_metal, rod, sphere, steel, sun, torus,
    tube, area, truss)
from render_thruster_art import ship as _ship  # noqa: E402


def ship(kind, base=(0, 0, 0), s=1.0, **kw):
    """The kit ship, a size down: on these cards the engine is the subject."""
    return _ship(kind, base, s * 0.7, **kw)


def place(at, fill=1.0, azim=-90.0, elev=8.0, lens=40, skip=()):
    """Aim at the hardware (glows excluded) and slide the film so its centre
    lands at `at` (x right, y down, fractions of the frame)."""
    bpy.context.view_layer.update()
    pts = []
    for ob in bpy.context.scene.objects:
        if ob.type not in ('MESH', 'CURVE') or is_glow(ob) or any(ob.name.startswith(k) for k in skip):
            continue
        pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    center = (lo + hi) / 2
    radius = max((p - center).length for p in pts)
    dist = radius / math.sin(math.atan(18.0 / lens)) / (fill * 0.72)
    a, e = math.radians(azim), math.radians(elev)
    loc = center + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    K.camera(tuple(loc), tuple(center), lens, shift=(-(at[0] - 0.5), (at[1] - 0.5) * K.H / K.W), clip=dist * 40)


def rig():
    sun((0.5, -0.8, 0.6), 4.0)
    area('rim', (-6, 5, 3), 500, 4, (0.6, 0.75, 1.0))


def plume(name, top, bottom, r0, r1, color, strength=3.0, alpha=0.55):
    return lathe(name, [(0.0, top), (r0, top), (r1, bottom), (0.0, bottom)], mat_glow(name, color, strength, alpha))


def coil_stack(name, n, z0, dz, r0, dr, rr=0.08):
    cu = copper()
    return [torus(f'{name}{i}', r0 + dr * i, rr, cu, (0, 0, z0 - dz * i)) for i in range(n)]


def wiresphere(name, r, mat, loc=(0, 0, 0), seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    wf = ob.modifiers.new('wf', 'WIREFRAME')
    wf.thickness = 0.02
    return ob


def disc(name, r, mat, loc=(0, 0, 0), rot=(0, 0, 0), depth=0.04, verts=96):
    return cyl(name, r, depth, mat, loc, rot, verts, smooth=False)  # smooth bulges a flat disc


GW_AT, FR_AT = (0.45, 0.3), (0.48, 0.64)


# ---- GW / TW ----------------------------------------------------------------

def gw_amat_front():
    """Amat-Catalyzed Fission-Fusion: fuel rings behind a LiH shield disc, ion
    ports converging on one point inside an open ablative cup, a magenta flash."""
    st = steel()
    parts = [torus('fuel0', 0.8, 0.14, mat_metal('fuel', (0.5, 0.52, 0.56), 0.4), (0, 0, 1.75)),
             torus('fuel1', 0.8, 0.14, mat_metal('fuel', (0.5, 0.52, 0.56), 0.4), (0, 0, 2.05)),
             cyl('lih', 1.15, 0.16, mat_metal('lih', (0.85, 0.85, 0.8), 0.6, 0.0), (0, 0, 1.45))]
    parts.append(lathe('cup', [(0.0, 1.0), (0.9, 0.9), (1.5, 0.35), (1.75, -0.45), (1.62, -0.45), (1.38, 0.28), (0.82, 0.78), (0.0, 0.86)],
                       mat_metal('sic', (0.25, 0.25, 0.28), 0.6, 0.2)))
    for k in range(6):
        a = k * TAU / 6
        parts.append(rod(f'port{k}', (1.25 * math.cos(a), 1.25 * math.sin(a), 0.9), (0.45 * math.cos(a), 0.45 * math.sin(a), 0.25), 0.07, st))
    mag = (1.0, 0.3, 0.9)
    parts.append(sphere('flash', 0.35, mat_glow('flash', mag, 30), (0, 0, 0.1), 24))
    parts.append(plume('plume', -0.2, -4.5, 1.2, 2.2, mag, 2.5))
    parts.append(ship('tug', (0, 0, 2.2), 0.9))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_amat_back():
    """Amat-Initiated H-B Magnetic-Inertial: a slimmer coil-ringed chamber, a
    pellet feed tube, a magnetic nozzle of rings, a white-magenta flash."""
    parts = [cyl('chamber', 0.45, 1.3, steel('ch', (0.7, 0.72, 0.76)), (0, 0, 1.1))]
    parts += coil_stack('ccoil', 5, 1.6, 0.25, 0.5, 0.0, 0.07)
    parts += coil_stack('noz', 4, 0.2, 0.45, 0.55, 0.28, 0.08)
    parts.append(tube('feed', [(0.9, 0, 2.3), (0.9, 0, 1.4), (0.46, 0, 1.2)], 0.07, steel('fd', (0.4, 0.42, 0.46))))
    parts.append(sphere('flash', 0.3, mat_glow('flash', (1.0, 0.75, 0.95), 35), (0, 0, 0.3), 24))
    parts.append(plume('plume', 0.0, -4.0, 0.6, 1.8, (1.0, 0.5, 0.85), 2.5))
    parts.append(ship('crew', (0, 0, 1.8), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_dpf_front():
    """Dense Plasma H-B Focus: a squirrel cage of cathode rods round a central
    anode, a pinched plasmoid at the open tip, a capacitor bank, a narrow jet."""
    st, cu = steel(), copper()
    parts = [rod('anode', (0, 0, 2.0), (0, 0, 0.35), 0.14, cu)]
    for k in range(12):
        a = k * TAU / 12
        parts.append(rod(f'cath{k}', (0.55 * math.cos(a), 0.55 * math.sin(a), 2.0), (0.55 * math.cos(a), 0.55 * math.sin(a), 0.2), 0.04, st))
    parts.append(torus('cage_top', 0.55, 0.05, st, (0, 0, 2.0)))
    for k in range(8):
        a = k * TAU / 8
        parts.append(box(f'cap{k}', (0.35, 0.35, 0.55), mat_metal('cap', (0.2, 0.22, 0.26), 0.5, 0.3), (1.0 * math.cos(a), 1.0 * math.sin(a), 2.35), (0, 0, a)))
    parts.append(sphere('pinch', 0.18, mat_glow('pinch', (0.7, 0.95, 1.0), 40), (0, 0, 0.18), 16))
    parts.append(plume('jet', 0.1, -4.5, 0.15, 0.7, (0.5, 0.85, 1.0), 4))
    parts.append(ship('tug', (0, 0, 2.65), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_crossfire_back():
    """Crossfire H-B Focus: six ion-gun arms like a 3D jack firing inward at a
    glowing magnetic cusp; exhaust leaves through a coil ring below."""
    st = steel()
    parts = []
    dirs = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    beam = mat_glow('beam', (1.0, 0.85, 0.4), 12)
    for i, d in enumerate(dirs):
        v = Vector(d)
        if i == 5:
            continue
        parts.append(rod(f'arm{i}', v * 0.45, v * 1.7, 0.16, st))
        parts.append(rod(f'gun{i}', v * 1.6, v * 1.95, 0.26, mat_metal('gun', (0.25, 0.27, 0.3), 0.5, 0.5)))
        parts.append(rod(f'beam{i}', v * 0.45, v * 0.1, 0.03, beam))
    parts.append(sphere('cusp', 0.3, mat_glow('cusp', (1.0, 0.9, 0.5), 30), (0, 0, 0), 24))
    parts.append(lathe('mirror', [(0.42, 0.3), (0.5, 0.0), (0.42, -0.3)], mat_metal('xmir', (0.9, 0.8, 0.5), 0.2)))
    parts += coil_stack('noz', 3, -0.7, 0.4, 0.45, 0.25, 0.08)
    parts.append(plume('plume', -0.4, -4.0, 0.4, 1.4, (1.0, 0.65, 0.25), 3))
    parts.append(ship('crew', (0, 0, 1.95), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_ldx_front():
    """Levitated Dipole 6Li-H: a superconducting ring floating inside a round
    chamber (cut away), a dipole halo of plasma like a mini magnetosphere."""
    shell = lathe('chamber', [(r * 1.4, z * 1.4) for r, z in
                              [(0.0, 1.0), (0.5, 0.87), (0.87, 0.5), (1.0, 0.0), (0.87, -0.5), (0.5, -0.87), (0.25, -0.97)]],
                  steel('sh', (0.7, 0.72, 0.76)), segs=48, sweep=TAU * 0.7, start=-0.6)
    ring = torus('dipole', 0.55, 0.13, mat_metal('sc', (0.9, 0.75, 0.3), 0.25))
    halo = lathe('halo', [(0.42, 0.0), (0.5, 0.35), (0.85, 0.55), (1.15, 0.3), (1.2, 0.0), (1.15, -0.3), (0.85, -0.55), (0.5, -0.35), (0.42, 0.0)],
                 mat_glow('halo', (0.75, 0.45, 1.0), 2.5, 0.5))
    parts = [shell, ring, halo]
    parts += coil_stack('noz', 3, -1.5, 0.4, 0.4, 0.25, 0.08)
    parts.append(plume('plume', -1.4, -5.0, 0.3, 1.4, (0.75, 0.5, 1.0), 2.5))
    parts.append(ship('tug', (0, 0, 1.4), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_dusty_back():
    """Dusty Plasma: a sparkling cloud of uranium dust in a moderator vessel,
    ring coils for the nozzle, very large radiators."""
    rnd = random.Random(6)
    parts = [lathe('vessel', [(0.0, 1.2), (0.9, 1.2), (0.95, 0.9), (0.95, -0.6), (0.6, -0.9)],
                   mat_metal('mod', (0.35, 0.36, 0.4), 0.45, 0.4), segs=48, sweep=TAU * 0.72, start=-0.7)]
    dust = mat_glow('dust', (1.0, 0.8, 0.45), 18)
    for i in range(70):
        p = Vector((rnd.gauss(0, 0.32), rnd.gauss(0, 0.32), rnd.gauss(0.2, 0.35)))
        parts.append(sphere(f'dust{i}', rnd.uniform(0.015, 0.04), dust, tuple(p), 8))
    parts += coil_stack('noz', 3, -1.0, 0.4, 0.45, 0.25, 0.08)
    for sx in (-1, 1):
        parts.append(box(f'rad{sx}', (2.6, 0.03, 1.6), mat_metal('rad', (0.75, 0.77, 0.8), 0.35, 0.5), (sx * 2.3, 0, 1.0)))
    parts.append(plume('plume', -0.9, -4.5, 0.3, 1.2, (1.0, 0.7, 0.4), 3))
    parts.append(ship('crew', (0, 0, 1.25), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.1)
    rig()


def gw_minimag_front():
    """Mini-Mag Orion: a long truss, a pellet injector, a flared cage of
    superconducting rings at the stern in place of a pusher plate."""
    st = steel()
    parts = truss('spine', 0.6, 3.0, 0.3, st, bays=4)
    parts.append(cyl('injector', 0.18, 1.0, mat_metal('inj', (0.3, 0.32, 0.36), 0.4), (0, 0, 0.6)))
    parts += coil_stack('cage', 5, 0.1, 0.38, 0.45, 0.32, 0.09)
    for k in range(6):
        a = k * TAU / 6
        parts.append(rod(f'cagebar{k}', (0.45 * math.cos(a), 0.45 * math.sin(a), 0.1), (1.73 * math.cos(a), 1.73 * math.sin(a), -1.42), 0.03, st))
    parts.append(sphere('flash', 0.32, mat_glow('flash', (1.0, 0.75, 0.9), 35), (0, 0, -0.4), 24))
    parts.append(plume('plume', -0.6, -5.0, 1.0, 2.4, (1.0, 0.45, 0.7), 2))
    parts.append(ship('tug', (0, 0, 3.0), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_medusa_back():
    """Solem Medusa: a huge jellyfish canopy far AHEAD of the ship, tethers to
    a winch on its nose, the blast flash in the gap: pulled, not pushed."""
    canopy = lathe('canopy', [(0.0, 8.6), (2.5, 8.3), (4.5, 7.4), (5.8, 6.0), (6.2, 5.0), (6.1, 5.0), (5.7, 5.95), (4.4, 7.32), (2.45, 8.22), (0.0, 8.5)],
                   mat_metal('sail', (0.8, 0.82, 0.86), 0.5, 0.2), segs=96)
    teth = mat_metal('teth', (0.7, 0.72, 0.76), 0.4)
    parts = [canopy]
    for k in range(16):
        a = k * TAU / 16
        parts.append(rod(f'teth{k}', (6.1 * math.cos(a), 6.1 * math.sin(a), 5.0), (0, 0, 2.9), 0.012, teth))
    parts.append(cyl('winch', 0.3, 0.3, steel('w', (0.4, 0.42, 0.46)), (0, 0, 2.85)))
    parts.append(sphere('blast', 0.6, mat_glow('blast', (1.0, 0.85, 0.5), 25), (0, 0, 5.2), 24))
    parts.append(lathe('blastglow', [(0.0, 7.6), (3.6, 6.2), (0.8, 4.4), (0.0, 4.4)], mat_glow('bg', (1.0, 0.6, 0.25), 2, 0.4)))
    parts.append(ship('crew', (0, 0, 0.0), 0.9))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.05)
    rig()


def gw_saltwater_front():
    """Salt-Water Zubrin: a fat tank packed with boron-carbide capillary tubes
    feeding a long straight chamber; an enormous blinding plume."""
    parts = [capsule_tank('tank', 0.85, 1.7, mat_metal('tk', (0.8, 0.82, 0.85), 0.4, 0.4), 0.9)]
    b4c = mat_metal('b4c', (0.2, 0.2, 0.22), 0.5, 0.2)
    for k in range(10):
        a = k * TAU / 10
        parts.append(rod(f'cap{k}', (0.86 * math.cos(a), 0.86 * math.sin(a), 1.1), (0.86 * math.cos(a), 0.86 * math.sin(a), 2.4), 0.03, b4c))
    parts.append(cyl('chamber', 0.22, 1.8, steel('ch', (0.6, 0.62, 0.66)), (0, 0, 0.0)))
    parts.append(lathe('bell', [(0.22, -0.9), (0.4, -1.2), (0.6, -1.6), (0.55, -1.6), (0.36, -1.22), (0.2, -0.95)], steel()))
    parts.append(plume('plume', -1.5, -11.0, 0.6, 2.6, (0.75, 0.9, 1.0), 6, 0.7))
    parts.append(plume('core', -1.4, -8.0, 0.25, 0.6, (1.0, 1.0, 1.0), 25, 1.0))
    parts.append(ship('tug', (0, 0, 2.6), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.2)
    rig()


def gw_gdm_back():
    """Zubrin-GDM: a long thin string of solenoid rings with stronger mirror
    coils at each end inside a fission blanket, a thin hot jet out one end."""
    parts = [cyl('tube', 0.12, 4.2, steel('tb', (0.6, 0.62, 0.66)), (0, 0, 0.6))]
    cu = copper()
    for i in range(16):
        z = 2.5 - i * 0.26
        big = i in (0, 1, 14, 15)
        parts.append(torus(f'sol{i}', 0.3 if big else 0.22, 0.07 if big else 0.045, cu, (0, 0, z)))
    parts.append(cyl('blanket', 0.38, 2.2, mat_metal('bl', (0.3, 0.32, 0.36), 0.5, 0.5), (0, 0, 0.6)))
    parts.append(plume('jet', -1.5, -6.0, 0.12, 0.45, (0.6, 0.85, 1.0), 6))
    parts.append(ship('crew', (0, 0, 2.7), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_spheromak_front():
    """Spheromak 3He-D: a short flux-conserving can (cut away) holding a
    glowing smoke ring, flaring into a nozzle of coils."""
    can = lathe('can', [(0.0, 1.4), (0.9, 1.4), (0.95, 1.3), (0.95, 0.2), (0.7, 0.0)], steel('can', (0.66, 0.68, 0.72)),
                segs=48, sweep=TAU * 0.7, start=-0.7)
    ring = torus('smoke', 0.48, 0.2, mat_glow('smoke', (0.6, 0.9, 1.0), 10))
    ring.location = (0, 0, 0.75)
    parts = [can, ring]
    parts += coil_stack('noz', 4, -0.1, 0.4, 0.55, 0.3, 0.08)
    parts.append(plume('plume', 0.0, -4.5, 0.5, 1.8, (0.55, 0.85, 1.0), 2.5))
    parts.append(ship('tug', (0, 0, 1.45), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_frc_back():
    """Colliding FRC: a symmetric barbell of ring coils with a formation
    section at each end, two plasmoids meeting in a hot centre."""
    parts = [cyl('tube', 0.28, 3.6, mat_metal('tb', (0.5, 0.52, 0.56), 0.4, 0.5), (0, 0, 0.9))]
    cu = copper()
    for i in range(14):
        z = 2.6 - i * 0.26
        end = i < 2 or i > 11
        mid = 5 <= i <= 8
        parts.append(torus(f'c{i}', 0.5 if end else (0.42 if mid else 0.36), 0.1 if (end or mid) else 0.06, cu, (0, 0, z)))
    pl = mat_glow('frc', (0.55, 0.95, 1.0), 12)
    for z in (1.5, 0.3):
        t = torus(f'frc{z}', 0.18, 0.08, pl)
        t.location = (0, 0, z)
        parts.append(t)
    parts.append(sphere('hot', 0.2, mat_glow('hot', (1.0, 1.0, 1.0), 40), (0, 0, 0.9), 16))
    parts.append(plume('jet', -0.9, -5.0, 0.25, 1.0, (0.5, 0.9, 1.0), 3))
    parts.append(ship('crew', (0, 0, 2.75), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.15)
    rig()


def gw_vista_front():
    """VISTA D-T Inertial: a wide cone, point aft, its surface heat-pipe
    radiators; the target flashes just behind the point, plasma streams out."""
    cone = lathe('cone', [(0.25, -0.1), (3.0, 2.2), (2.92, 2.25), (0.2, 0.0)], mat_metal('hp', (0.62, 0.6, 0.56), 0.4, 0.6), segs=96)
    ribs = [rod(f'rib{k}', (0.25 * math.cos(k * TAU / 24), 0.25 * math.sin(k * TAU / 24), -0.08),
                (3.0 * math.cos(k * TAU / 24), 3.0 * math.sin(k * TAU / 24), 2.22), 0.025, steel('rb', (0.3, 0.3, 0.34))) for k in range(24)]
    mag = torus('magnet', 0.35, 0.16, copper(), (0, 0, -0.05))
    flash = sphere('flash', 0.3, mat_glow('flash', (1.0, 0.95, 0.6), 40), (0, 0, -0.5), 24)
    pl = plume('plume', -0.5, -5.0, 0.4, 1.8, (1.0, 0.75, 0.35), 3)
    s = ship('crew', (0, 0, 0.6), 0.75)
    group('ENGINE', [cone, *ribs, mag, flash, pl, s], rot=POSE)
    place(GW_AT, 1.1)
    rig()


def gw_daedalus_back():
    """Daedalus: the two-stage starship - a huge orange-hot molybdenum bell, a
    ring of big spherical propellant tanks, a second stage, an erosion shield."""
    hot = bpy.data.materials.new('moly')
    hot.use_nodes = True
    b = hot.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.6, 0.3, 0.15, 1)
    b.inputs['Metallic'].default_value = 0.8
    b.inputs['Roughness'].default_value = 0.35
    b.inputs['Emission Color'].default_value = (1.0, 0.4, 0.1, 1)
    b.inputs['Emission Strength'].default_value = 1.6
    bell = lathe('bell', [(0.3, 1.0), (0.5, 0.6), (1.2, -0.4), (2.2, -1.4), (2.3, -1.5), (2.2, -1.5), (1.12, -0.42), (0.42, 0.6), (0.25, 1.0)], hot, segs=96)
    tm = mat_metal('tank', (0.82, 0.84, 0.88), 0.35, 0.4)
    parts = [bell, cyl('spine', 0.2, 4.0, steel(), (0, 0, 2.8))]
    for k in range(6):
        a = k * TAU / 6
        parts.append(sphere(f'tank{k}', 0.62, tm, (1.0 * math.cos(a), 1.0 * math.sin(a), 1.9), 32))
    parts.append(lathe('bell2', [(0.15, 3.6), (0.6, 3.0), (0.65, 2.95), (0.12, 3.6)], hot, segs=48))
    for k in range(4):
        a = k * TAU / 4 + 0.4
        parts.append(sphere(f'tank2{k}', 0.32, tm, (0.5 * math.cos(a), 0.5 * math.sin(a), 3.9), 24))
    parts.append(cyl('shield', 0.9, 0.08, mat_metal('be', (0.75, 0.75, 0.72), 0.5, 0.6), (0, 0, 5.2)))
    parts.append(plume('plume', -1.4, -6.0, 1.8, 2.6, (1.0, 0.7, 0.4), 1.5, 0.4))
    parts.append(ship('probe', (0, 0, 4.4), 0.6))
    group('ENGINE', parts, rot=POSE)
    place(GW_AT, 1.1)
    rig()


# ---- freighters ---------------------------------------------------------------

def fr_steam_front():
    """Fission-Heated Steam: a stubby particle-bed reactor drum bolted to a
    bell, fed by a huge thin balloon tank of water; a white steam plume."""
    bal = sphere('balloon', 1.6, mat_metal('kevlar', (0.92, 0.9, 0.84), 0.6, 0.0), (0, 0, 2.6), 48)
    bal.scale = (1, 1, 0.8)
    parts = [bal, cyl('pump', 0.2, 0.5, steel(), (0, 0, 1.15)),
             cyl('reactor', 0.5, 0.6, mat_metal('rx', (0.3, 0.32, 0.36), 0.45, 0.6), (0, 0, 0.65)),
             torus('rxband', 0.51, 0.04, mat_glow('rxg', (1.0, 0.5, 0.2), 6), (0, 0, 0.65)),
             lathe('bell', bell_profile(0.5, 0.25, 0.8, 0.35, 1.3, 0.04), steel())]
    parts.append(plume('steam', -0.5, -4.5, 0.75, 2.2, (0.95, 0.97, 1.0), 1.4, 0.5))
    parts.append(ship('tanker', (0, 0, 3.8), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.45)
    rig()


def fr_gcr_back():
    """Fission GCR: a cavity inside a thick moderator shell (cut away), violet
    fission plasma inside, a ring coil each end (the rear one smaller so the
    field leaks out), a blue-white jet."""
    shell = lathe('moderator', [(0.0, 1.0), (0.5, 0.87), (0.87, 0.5), (1.0, 0.0), (0.87, -0.5), (0.5, -0.87), (0.2, -0.98)],
                  mat_metal('mod', (0.35, 0.36, 0.4), 0.45, 0.4), segs=48, sweep=TAU * 0.72, start=-0.7)
    parts = [shell, sphere('plasma', 0.6, mat_glow('pl', (0.75, 0.55, 1.0), 12), (0, 0, 0), 32),
             torus('coilF', 0.8, 0.12, copper(), (0, 0, 0.95)), torus('coilR', 0.45, 0.1, copper(), (0, 0, -1.0))]
    parts.append(plume('jet', -1.0, -5.0, 0.25, 0.9, (0.7, 0.85, 1.0), 6))
    parts.append(ship('tanker', (0, 0, 1.1), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.45)
    rig()


def sail_ship(parts, sail_r, z_sail, z_ship):
    for k in range(8):
        a = k * TAU / 8
        parts.append(rod(f'shroud{k}', (sail_r * 0.95 * math.cos(a), sail_r * 0.95 * math.sin(a), z_sail), (0, 0, z_ship), 0.012,
                         mat_metal('shroud', (0.8, 0.82, 0.86), 0.4)))
    s = ship('tanker', (0, 0, z_ship), 0.7)
    s.rotation_euler = (math.pi, 0, 0)
    parts.append(s)


def fr_fragment_front():
    """Fusion Fragment Sail: a kilometre-wide two-layer disc, a dark absorber
    speckled with warm radioactive dust; the freighter hangs on shroud lines."""
    rnd = random.Random(3)
    parts = [disc('absorber', 5.0, mat_metal('abs', (0.08, 0.07, 0.07), 0.5, 0.2), (0, 0, 0)),
             disc('b11', 5.0, mat_metal('b11', (0.45, 0.42, 0.38), 0.6, 0.1), (0, 0, 0.05))]
    dust = mat_glow('dust', (1.0, 0.6, 0.3), 6)
    for i in range(80):
        a, r = rnd.uniform(0, TAU), 4.8 * math.sqrt(rnd.random())
        parts.append(sphere(f'dust{i}', 0.04, dust, (r * math.cos(a), r * math.sin(a), -0.03), 6))
    sail_ship(parts, 5.0, 0.0, -3.0)
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.35)
    rig()


def fr_antiproton_back():
    """Antiproton Sail and Harvester: a charged carbon disc with nested wire-
    mesh spheres at its focus, a magenta annihilation sparkle."""
    parts = [disc('sail', 5.0, mat_metal('cc', (0.1, 0.1, 0.12), 0.4, 0.4), (0, 0, 0))]
    wire = mat_metal('mesh', (0.85, 0.85, 0.95), 0.3)
    for r in (1.2, 0.85, 0.5):
        parts.append(wiresphere(f'trap{r}', r, wire, (0, 0, -1.6)))
    parts.append(sphere('anti', 0.12, mat_glow('anti', (1.0, 0.3, 0.9), 40), (0, 0, -1.6), 12))
    for k in range(4):
        a = k * 1.7
        parts.append(sphere(f'spark{k}', 0.08, mat_glow(f'sp{k}', (1.0, 0.4, 0.95), 30), (3.5 * math.cos(a), 3.5 * math.sin(a), -0.05), 8))
    sail_ship(parts, 5.0, 0.0, -3.2)
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.35)
    rig()


def fr_hiiper_front():
    """HIIPER Beam Rider: a big flat receiver sail lit by a laser from below,
    a helicon tube wrapped in an RF antenna and a spherical IEC grid on its
    axis, a faint violet ion plume."""
    parts = [disc('receiver', 3.2, mat_metal('pv', (0.05, 0.1, 0.32), 0.25, 0.6), (0, 0, 2.6))]
    parts.append(rod('laser', (0, 0, 2.55), (3.0, -2.0, -6.0), 0.05, mat_glow('laser', (0.3, 1.0, 0.45), 20)))
    q = mat_metal('quartz', (0.85, 0.9, 0.95), 0.1, 0.0)
    parts.append(cyl('helicon', 0.22, 1.2, q, (0, 0, 1.4)))
    helix = [(0.25 * math.cos(t), 0.25 * math.sin(t), 0.85 + t * 0.035) for t in [i * 0.3 for i in range(32)]]
    parts.append(tube('antenna', helix, 0.025, copper()))
    parts.append(wiresphere('iec', 0.5, steel(), (0, 0, 0.35)))
    parts.append(plume('ions', 0.0, -4.0, 0.2, 0.9, (0.7, 0.5, 1.0), 3, 0.45))
    parts.append(ship('tanker', (0, 0, 2.7), 0.75))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.4)
    rig()


def fr_mirror_back():
    """Magnetic Mirror Beam Rider: a giant shielded stern hoop and a smaller
    forward ring; a pellet stream rises from behind and sprays back out."""
    cu = copper()
    parts = [torus('hoop', 2.6, 0.22, cu, (0, 0, -0.6)), torus('fwd', 1.0, 0.12, cu, (0, 0, 1.2)),
             box('water', (1.4, 1.4, 0.3), mat_metal('wc', (0.3, 0.5, 0.7), 0.3, 0.2), (0, 0, 1.8))]
    for k in range(4):
        a = k * TAU / 4
        parts.append(rod(f'strut{k}', (2.6 * math.cos(a), 2.6 * math.sin(a), -0.6), (1.0 * math.cos(a), 1.0 * math.sin(a), 1.2), 0.05, steel()))
    pel = mat_glow('pel', (1.0, 0.9, 0.4), 15)
    for i in range(10):
        parts.append(sphere(f'pin{i}', 0.08, pel, (0, 0, -1.2 - i * 0.6), 8))
    rnd = random.Random(2)
    for i in range(16):
        a, d = rnd.uniform(0, TAU), rnd.uniform(1.0, 4.0)
        parts.append(sphere(f'pout{i}', 0.06, pel, (d * 0.5 * math.cos(a), d * 0.5 * math.sin(a), -0.6 - d), 8))
    parts.append(ship('tanker', (0, 0, 2.0), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.35)
    rig()


def fr_inflatable_front():
    """Inflatable Solar-Heated: a big silver lens balloon (clear face, mirrored
    inside) on a sun-tracking mount, focusing a sunbeam cone onto a white-hot
    absorber and a small nozzle."""
    lens = sphere('lens', 2.4, mat_metal('lens', (0.9, 0.92, 0.95), 0.12, 0.9), (2.4, 0, 1.0), 64)
    lens.scale = (0.25, 1, 1)
    parts = [lens, rod('mount', (0, 0, 1.0), (2.0, 0, 1.0), 0.06, steel())]
    parts.append(lathe('cone', [(0.0, 0.0), (2.2, 2.4)], mat_glow('sunbeam', (1.0, 0.9, 0.55), 1.2, 0.25), segs=48))
    parts[-1].rotation_euler = (0, math.radians(-90), 0)
    parts[-1].location = (2.3, 0, 1.0)
    parts.append(sphere('absorber', 0.2, mat_glow('abs', (1.0, 0.98, 0.9), 40), (0.05, 0, 1.0), 16))
    parts.append(lathe('nozzle', [(0.1, 0.8), (0.25, 0.4), (0.45, -0.1), (0.4, -0.1), (0.2, 0.42), (0.06, 0.8)], steel()))
    parts.append(plume('plume', -0.1, -3.2, 0.35, 1.0, (0.85, 0.9, 1.0), 1.5, 0.4))
    parts.append(ship('tanker', (0, 0, 1.3), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.35)
    rig()


def fr_archimedes_back():
    """Archimedes Palmer Lens: a loose swarm of flat mirror tiles held in
    formation by two thin lasers, all reflecting onto one glowing carbon-foam
    absorber."""
    rnd = random.Random(8)
    mir = mat_metal('tile', (0.92, 0.93, 0.96), 0.08, 1.0)
    ray = mat_glow('ray', (1.0, 0.9, 0.55), 2.5, 0.5)
    parts = []
    for i in range(22):
        p = Vector((rnd.uniform(1.5, 4.0), rnd.uniform(-2.5, 2.5), rnd.uniform(-1.5, 3.0)))
        parts.append(box(f'tile{i}', (0.5, 0.5, 0.02), mir, tuple(p), (rnd.uniform(0, 1), rnd.uniform(0, 1), 0)))
        if i % 3 == 0:
            parts.append(rod(f'ray{i}', p, (0, 0, 0.6), 0.015, ray))
    green = mat_glow('palmer', (0.3, 1.0, 0.45), 15)
    parts.append(rod('palmer1', (0, 0, 2.0), (4.5, 2.6, 3.2), 0.02, green))
    parts.append(rod('palmer2', (0, 0, 2.0), (4.5, -2.6, -1.8), 0.02, green))
    parts.append(box('foam', (0.4, 0.4, 0.4), mat_glow('foam', (1.0, 0.55, 0.2), 15), (0, 0, 0.6)))
    parts.append(lathe('nozzle', [(0.1, 0.4), (0.25, 0.1), (0.4, -0.3), (0.35, -0.3), (0.2, 0.12), (0.06, 0.4)], steel()))
    parts.append(plume('plume', -0.3, -3.0, 0.3, 0.9, (1.0, 0.7, 0.4), 2, 0.45))
    parts.append(ship('tanker', (0, 0, 0.85), 0.8))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.35, skip=('tile', 'ray', 'palmer'))
    rig()


def fr_poodle_front():
    """Poodle Steam: the simplest drive in the deck - a heater block of
    polonium capsules glowing dull red, a water tank, a plain nozzle, a wisp."""
    parts = [capsule_tank('tank', 0.6, 1.4, mat_metal('tk', (0.8, 0.82, 0.85), 0.4, 0.4), 0.6),
             cyl('heater', 0.32, 0.45, mat_metal('ht', (0.35, 0.15, 0.1), 0.5, 0.3), (0, 0, 0.35))]
    for k in range(4):
        a = k * TAU / 4
        parts.append(sphere(f'po{k}', 0.08, mat_glow('po', (1.0, 0.3, 0.15), 8), (0.33 * math.cos(a), 0.33 * math.sin(a), 0.35), 10))
    parts.append(lathe('nozzle', [(0.12, 0.12), (0.2, -0.2), (0.32, -0.6), (0.28, -0.6), (0.16, -0.2), (0.08, 0.12)], steel()))
    parts.append(plume('wisp', -0.6, -3.0, 0.2, 0.7, (0.95, 0.97, 1.0), 1.2, 0.4))
    parts.append(ship('tanker', (0, 0, 2.0), 0.7))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.4)
    rig()


def fr_dnanotube_back():
    """D-Nanotube Dirt Launcher: a hairline carbon-nanotube loop shaped like a
    capital D, a cable car running it, dirt flying off tangent to the curve."""
    R = 2.6
    d = [(0.0, 0.0, z) for z in [R, -R]]
    arc = [(R * math.sin(t), 0.0, R * math.cos(t)) for t in [math.pi - i * math.pi / 40 for i in range(41)]]
    pts = [d[0], d[1]] + arc[::-1] + [d[0]]
    pts = [(0.0, 0.0, R)] + [(R * math.sin(t), 0.0, R * math.cos(t)) for t in [i * math.pi / 40 for i in range(41)]] + [(0.0, 0.0, -R), (0.0, 0.0, R)]
    parts = [tube('loop', pts, 0.02, mat_metal('cnt', (0.15, 0.15, 0.18), 0.3, 0.6))]
    t0 = 0.6
    parts.append(box('car', (0.3, 0.25, 0.22), mat_metal('car', (0.95, 0.75, 0.2), 0.3, 0.6), (R * math.sin(t0), 0, R * math.cos(t0))))
    rnd = random.Random(4)
    dirt = mat_metal('dirt', (0.45, 0.33, 0.2), 0.9, 0.0)
    tr = 2.0
    p0 = Vector((R * math.sin(tr), 0, R * math.cos(tr)))
    tan = Vector((math.cos(tr), 0, -math.sin(tr)))
    for i in range(14):
        parts.append(sphere(f'dirt{i}', rnd.uniform(0.04, 0.09), dirt, tuple(p0 + tan * (0.3 + i * 0.32) + Vector((0, rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1)))), 8))
    parts.append(ship('tanker', (0, 0, R), 0.7))
    group('ENGINE', parts, rot=(math.radians(-10), math.radians(-35), math.radians(-15)))
    place(FR_AT, 1.35)
    rig()


def fr_rotary_front():
    """Rotary Dirt Launcher: two counter-rotating tapered Kevlar arms on hubs,
    brown pellets leaving each tip."""
    parts = [cyl('axle', 0.12, 2.2, steel(), (0, 0, 0.6))]
    kev = mat_metal('kev', (0.85, 0.8, 0.6), 0.6, 0.0)
    rnd = random.Random(5)
    dirt = mat_metal('dirt', (0.45, 0.33, 0.2), 0.9, 0.0)
    for j, (z, a0, sgn) in enumerate([(1.2, 0.3, 1), (0.0, 1.4, -1)]):
        parts.append(cyl(f'hub{j}', 0.32, 0.3, mat_metal('hub', (0.3, 0.32, 0.36), 0.4, 0.6), (0, 0, z)))
        arm = lathe(f'arm{j}', [(0.0, -2.6), (0.05, -2.6), (0.14, 0.0), (0.14, 0.05), (0.0, 0.05)], kev, segs=16)
        arm.rotation_euler = (math.pi / 2, 0, a0)
        arm.location = (0, 0, z)
        parts.append(arm)
        arm2 = lathe(f'armb{j}', [(0.0, -2.6), (0.05, -2.6), (0.14, 0.0), (0.14, 0.05), (0.0, 0.05)], kev, segs=16)
        arm2.rotation_euler = (math.pi / 2, 0, a0 + math.pi)
        arm2.location = (0, 0, z)
        parts.append(arm2)
        tip = Vector((2.6 * math.sin(a0), -2.6 * math.cos(a0), z))
        tdir = Vector((math.cos(a0), math.sin(a0), 0)) * sgn
        for i in range(8):
            parts.append(sphere(f'pel{j}{i}', rnd.uniform(0.04, 0.08), dirt, tuple(tip + tdir * (0.3 + i * 0.35)), 8))
    parts.append(ship('tanker', (0, 0, 1.7), 0.75))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.35)
    rig()


def fr_kests_back():
    """KESTS Hoop Dirt Launcher: two giant thin hoops arching off a rubble-pile
    asteroid's equator like handles, held open by mass streams, flinging dirt;
    a freighter docked on the rock."""
    rockm = mat_metal('rock', (0.36, 0.32, 0.28), 0.85, 0.0)
    a = asteroid('rock', 1.6, rockm, (0, 0, 0), 2.0, 0.3)
    parts = [a]
    stream = mat_glow('stream', (1.0, 0.7, 0.35), 3)
    for sgn in (-1, 1):
        h = torus(f'hoop{sgn}', 2.4, 0.05, steel())
        h.rotation_euler = (math.pi / 2, 0, sgn * 0.5)
        h.location = (sgn * 2.4 * math.cos(sgn * 0.5) * 0.9, sgn * 2.4 * math.sin(sgn * 0.5) * 0.9, 0)
        parts.append(h)
        h2 = torus(f'hoopg{sgn}', 2.4, 0.015, stream)
        h2.rotation_euler, h2.location = h.rotation_euler.copy(), h.location.copy()
        parts.append(h2)
    rnd = random.Random(9)
    dirt = mat_metal('dirt', (0.45, 0.33, 0.2), 0.9, 0.0)
    for i in range(12):
        parts.append(sphere(f'dirt{i}', rnd.uniform(0.05, 0.1), dirt, (4.4 + i * 0.35, 1.2 + i * 0.05, 2.0 + i * 0.25), 8))
    s = ship('tanker', (0, 0, 1.4), 0.6)
    parts.append(s)
    group('ENGINE', parts, rot=(math.radians(-15), 0, math.radians(20)))
    place(FR_AT, 1.35, skip=('dirt',))
    rig()


def fr_zpinch_front():
    """Z-Pinch D-T / 6Li: Marx capacitor banks forward, an annular nozzle
    firing a fuel column inside a lithium sleeve, a pink-white pulse flash in
    the magnetic nozzle."""
    capm = mat_metal('marx', (0.22, 0.24, 0.28), 0.45, 0.4)
    parts = []
    for k in range(10):
        a = k * TAU / 10
        parts.append(box(f'marx{k}', (0.4, 0.3, 1.2), capm, (1.0 * math.cos(a), 1.0 * math.sin(a), 1.9), (0, 0, a)))
    parts.append(cyl('annulus', 0.35, 0.5, mat_metal('ann', (0.1, 0.45, 0.55), 0.3, 0.6), (0, 0, 1.0)))
    parts.append(lathe('bell', [(0.4, 0.8), (0.8, 0.2), (1.5, -0.8), (1.42, -0.8), (0.72, 0.22), (0.32, 0.8)], steel(), segs=64))
    parts += coil_stack('mn', 3, 0.4, 0.45, 0.75, 0.3, 0.09)
    parts.append(sphere('pulse', 0.35, mat_glow('pulse', (1.0, 0.75, 0.9), 35), (0, 0, 0.2), 24))
    parts.append(plume('plume', -0.4, -4.5, 1.1, 2.2, (1.0, 0.5, 0.8), 2, 0.45))
    parts.append(ship('tanker', (0, 0, 2.5), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.4)
    rig()


def fr_target_back():
    """Z-Pinch 3He-D Target: a ring of flux-compression generators converging
    on a silver lithium liner that bursts into a cleaner blue exhaust."""
    parts = [cyl('injector', 0.2, 1.0, steel(), (0, 0, 1.4))]
    for k in range(8):
        a = k * TAU / 8
        parts.append(box(f'fcg{k}', (0.25, 0.25, 0.7), copper(), (0.85 * math.cos(a), 0.85 * math.sin(a), 0.5), (0, math.radians(20), a)))
    parts.append(sphere('liner', 0.32, mat_metal('li', (0.92, 0.93, 0.96), 0.15, 1.0), (0, 0, 0.5), 32))
    parts.append(sphere('burst', 0.25, mat_glow('burst', (0.7, 0.85, 1.0), 25), (0, 0, 0.1), 16))
    parts += coil_stack('mn', 3, -0.1, 0.45, 0.6, 0.3, 0.08)
    parts.append(plume('plume', -0.2, -4.5, 0.6, 1.6, (0.55, 0.75, 1.0), 3, 0.5))
    parts.append(ship('tanker', (0, 0, 1.9), 0.85))
    group('ENGINE', parts, rot=POSE)
    place(FR_AT, 1.4)
    rig()


SCENES = {
    'gw': {
        'gw-_amat_catalyzed_fission_fusion-front': gw_amat_front,
        'gw-_amat_catalyzed_fission_fusion-back': gw_amat_back,
        'gw-_dense_plasma_h_b_focus_fusion-front': gw_dpf_front,
        'gw-_dense_plasma_h_b_focus_fusion-back': gw_crossfire_back,
        'gw-_levitated_dipole_6li_h_fusion-front': gw_ldx_front,
        'gw-_levitated_dipole_6li_h_fusion-back': gw_dusty_back,
        'gw-_mini_mag_orion_z_pinch_fission-front': gw_minimag_front,
        'gw-_mini_mag_orion_z_pinch_fission-back': gw_medusa_back,
        'gw-_salt_water_zubrin-front': gw_saltwater_front,
        'gw-_salt_water_zubrin-back': gw_gdm_back,
        'gw-_spheromak_3he_d_magnetic_fusion-front': gw_spheromak_front,
        'gw-_spheromak_3he_d_magnetic_fusion-back': gw_frc_back,
        'gw-_vista_d_t_inertial_fusion-front': gw_vista_front,
        'gw-_vista_d_t_inertial_fusion-back': gw_daedalus_back,
    },
    'freighter': {
        'fre_fission_heated_steam-front': fr_steam_front,
        'fre_fission_heated_steam-back': fr_gcr_back,
        'fre_fusion_fragment_sail-front': fr_fragment_front,
        'fre_fusion_fragment_sail-back': fr_antiproton_back,
        'fre_hiiper_beam_rider-front': fr_hiiper_front,
        'fre_hiiper_beam_rider-back': fr_mirror_back,
        'fre_inflatable_solar_heated-front': fr_inflatable_front,
        'fre_inflatable_solar_heated-back': fr_archimedes_back,
        'fre_poodle_steam-front': fr_poodle_front,
        'fre_poodle_steam-back': fr_dnanotube_back,
        'fre_rotary_dirt_launcher-front': fr_rotary_front,
        'fre_rotary_dirt_launcher-back': fr_kests_back,
        'fre_z_pinch_d_t_6li_fusion-front': fr_zpinch_front,
        'fre_z_pinch_d_t_6li_fusion-back': fr_target_back,
    },
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--deck', default='gw')
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=20)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    scenes = SCENES[a.deck]
    for k in [k for k in scenes if not a.only or k in a.only.split(',')]:
        sc = K.reset(a.samples)
        scenes[k]()
        sc.render.filepath = os.path.join(a.out, f'{k}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', k, flush=True)


if __name__ == '__main__':
    main()
