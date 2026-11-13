"""Blender thruster card art (scripted, headless): all 24 thruster faces.

Method from the blender-hard-surface skill (Star Crew -> Crab Breeze -> Fleet
Command): every model is built by this committed script from primitives,
lathed profiles (full, or a partial sweep for a cutaway), tori, rods and
curve tubes - nothing hand-modelled - and rendered with Cycles on the CPU (no
GPU needed). Renders on a transparent film; the card's space backdrop is
composited afterwards (--backdrop) so Blender and vector art share a look.

Each face draws its OWN technology: the black back of a thruster card is a
different engine, so it is a different scene. Every engine is bolted to a
spacecraft from a small ship kit (crewed tug, crew ship, spherical-tank
tanker, probe bus); sails tow theirs on the hub or the shrouds. A shared
pose puts the ship upper-left and the plume lower-right, and `autoframe`
aims the camera at the hardware.

Run (Blender as a Python module, `pip install bpy`, Python 3.11):
    python scripts/blender/render_thruster_art.py --out DIR [--only key,key] [--samples 48]
Keys are '<cardId>-<front|back>'.
"""
import argparse
import math
import os
import sys

import bpy  # must come before bmesh / mathutils with the pip module
import bmesh
from mathutils import Vector, noise

W, H = 436, 418
TAU = 2 * math.pi


# ---- scene plumbing --------------------------------------------------------

def reset(samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Punchy'
    sc.view_settings.exposure = -0.3
    world = bpy.data.worlds.new('space')
    world.use_nodes = True
    bgn = world.node_tree.nodes['Background']
    bgn.inputs['Color'].default_value = (0.05, 0.06, 0.1, 1)
    bgn.inputs['Strength'].default_value = 1.0
    sc.world = world
    return sc


def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def mat_metal(name, color, rough=0.28, metal=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    return m


def mat_glow(name, color, strength, alpha=1.0):
    """Emission; alpha < 1 fades it toward the silhouette (a soft plasma jet)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    if alpha >= 1:
        nt.links.new(em.outputs[0], out.inputs[0])
        return m
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.6
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = alpha
    nt.links.new(lw.outputs['Facing'], inv.inputs[1])
    nt.links.new(inv.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def obj_from_bm(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = smooth
    return ob


def lathe(name, profile, mat, segs=72, sweep=TAU, start=0.0):
    """Sweep an (r, z) profile around Z (the skill's `lathe`). A sweep < TAU
    leaves an open cutaway so the inside shows."""
    closed = sweep >= TAU - 1e-6
    n = segs if closed else segs + 1
    bm = bmesh.new()
    rings = []
    for i in range(n):
        a = start + sweep * i / segs
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in profile])
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for k in range(len(profile) - 1):
            bm.faces.new((r0[k], r1[k], r1[k + 1], r0[k + 1]))
    return obj_from_bm(name, bm, mat)


def torus(name, R, r, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot,
                                     major_segments=96, minor_segments=20)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def cyl(name, r, depth, mat, loc=(0, 0, 0), rot=(0, 0, 0), verts=64, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    return ob


def box(name, size, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(mat)
    return ob


def sphere(name, r, mat, loc=(0, 0, 0), seg=32):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def tube(name, pts, r, mat):
    """A round tube along a polyline (wires, tethers, spiral coils, beams)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    ob = link(bpy.data.objects.new(name, cu))
    cu.materials.append(mat)
    return ob


def rod(name, a, b, r, mat):
    return tube(name, [a, b], r, mat)


def group(name, objs, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    root = link(bpy.data.objects.new(name, None))
    for o in objs:
        o.parent = root
    root.location, root.rotation_euler, root.scale = loc, rot, (scale,) * 3
    return root


def asteroid(name, r, mat, loc=(0, 0, 0), seed=1.0, rough=0.28):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=5, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    for v in ob.data.vertices:
        n = v.co.normalized()
        d = noise.noise(n * 2.2 + Vector((seed, 0, 0))) * 0.6 + noise.noise(n * 7 + Vector((0, seed, 0))) * 0.15
        v.co = n * r * (1 + d * rough)
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def area(name, loc, energy, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy, l.size, l.color = energy, size, color
    o = link(bpy.data.objects.new(name, l))
    o.location = loc
    o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def sun(direction, strength=4.0, color=(1.0, 0.95, 0.85)):
    l = bpy.data.lights.new('sun', 'SUN')
    l.energy, l.color = strength, color
    o = link(bpy.data.objects.new('sun', l))
    o.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
    return o


def camera(loc, target=(0, 0, 0), lens=50):
    c = bpy.data.cameras.new('cam')
    c.lens = lens
    o = link(bpy.data.objects.new('cam', c))
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o


def rig(key=(4, -4, 5), rim=(-5, 3, 2), keyE=900, rimE=600):
    area('key', key, keyE, 4, (1.0, 0.96, 0.9))
    area('rim', rim, rimE, 3, (0.6, 0.75, 1.0))


def steel(name='steel', c=(0.72, 0.74, 0.78), r=0.25):
    return mat_metal(name, c, r)


def copper():
    return mat_metal('copper', (0.85, 0.45, 0.22), 0.25)


def bell_profile(chamber=0.6, throat=0.3, exit_r=1.2, top=2.0, length=2.2, lip=0.04):
    """Outer skin of a convergent-divergent bell, opening toward -Z."""
    t = 0.85
    return [(0.0, top), (chamber - 0.05, top), (chamber, top - 0.1), (chamber, t + 0.55),
            (chamber * 0.8, t + 0.25), (throat, t), (throat * 1.1, t - 0.35),
            (exit_r * 0.45, t - 0.85), (exit_r * 0.72, t - 1.45), (exit_r * 0.92, t - 2.0),
            (exit_r, t - length), (exit_r - lip, t - length), (exit_r * 0.92 - lip, t - 2.0),
            (exit_r * 0.72 - lip, t - 1.45), (exit_r * 0.45 - lip, t - 0.85), (throat - lip, t - 0.35),
            (0.0, t - 0.35)]


# ---- ship kit: the spacecraft every engine is bolted to --------------------
# Built in ship-local space with +Z pointing FORWARD (away from the plume) and
# the attach point at the origin; `ship()` returns one empty that parents the
# parts, so it rides inside the engine's group and inherits its pose.

def ship_mats():
    return {
        'hull': mat_metal('hull', (0.86, 0.87, 0.89), 0.42, 0.1),
        'dark': mat_metal('dark', (0.12, 0.13, 0.16), 0.5, 0.3),
        'foil': mat_metal('foil', (0.88, 0.62, 0.22), 0.3, 1.0),
        'rad': mat_metal('radiator', (0.78, 0.8, 0.84), 0.35, 0.5),
        'pv': mat_metal('pv', (0.05, 0.09, 0.3), 0.2, 0.6),
        'truss': mat_metal('truss', (0.45, 0.47, 0.52), 0.4, 0.9),
        'window': mat_glow('window', (1.0, 0.85, 0.55), 8),
    }


def capsule_tank(name, r, length, mat, z0):
    """A propellant tank with round ends, standing on z0."""
    prof = [(0.0, z0)]
    for i in range(1, 7):
        a = (math.pi / 2) * i / 6
        prof.append((r * math.sin(a), z0 + r - r * math.cos(a)))
    for i in range(0, 7):
        a = (math.pi / 2) * i / 6
        prof.append((r * math.cos(a), z0 + length - r + r * math.sin(a)))
    prof.append((0.0, z0 + length))
    return lathe(name, prof, mat, segs=48)


def truss(name, z0, z1, w, mat, bays=3):
    """Four longerons with X-braced bays."""
    parts = []
    corners = [(w, w), (-w, w), (-w, -w), (w, -w)]
    for k, (x, y) in enumerate(corners):
        parts.append(rod(f'{name}_long{k}', (x, y, z0), (x, y, z1), w * 0.06, mat))
    for b in range(bays):
        za, zb = z0 + (z1 - z0) * b / bays, z0 + (z1 - z0) * (b + 1) / bays
        for k in range(4):
            (x0, y0), (x1, y1) = corners[k], corners[(k + 1) % 4]
            parts.append(rod(f'{name}_br{b}_{k}', (x0, y0, za), (x1, y1, zb), w * 0.04, mat))
    return parts


def ship(kind, base=(0, 0, 0), s=1.0, flip=False, yaw=0.0, rot=None):
    """kind: 'tug' (crewed, with a propellant tank), 'crew' (crewed, no tank),
    'tanker' (spherical tank clusters on a spine) or 'probe' (bus, dish,
    solar wings)."""
    m = ship_mats()
    p = []
    z = 0.0
    if kind in ('tug', 'crew'):
        tl = 1.2 * s
        p += truss('truss', z, z + tl, 0.32 * s, m['truss'])
        for sx in (-1, 1):
            p.append(box(f'radiator{sx}', (2.0 * s, 0.025 * s, 0.95 * s), m['rad'], (sx * (0.32 + 1.05) * s, 0, z + tl * 0.5)))
            p.append(rod(f'rad_arm{sx}', (sx * 0.3 * s, 0, z + tl * 0.5), (sx * 0.4 * s, 0, z + tl * 0.5), 0.04 * s, m['truss']))
            for k in range(5):
                p.append(box(f'rad_rib{sx}{k}', (0.03 * s, 0.035 * s, 0.95 * s), m['dark'], (sx * (0.55 + k * 0.4) * s, 0, z + tl * 0.5)))
        z += tl
        if kind == 'tug':
            p.append(capsule_tank('tank', 0.78 * s, 2.0 * s, m['hull'], z))
            for k in range(3):
                p.append(torus(f'tank_band{k}', 0.79 * s, 0.03 * s, m['foil'], (0, 0, z + (0.5 + k * 0.5) * s)))
            z += 2.0 * s
            p.append(cyl('neck', 0.3 * s, 0.25 * s, m['dark'], (0, 0, z + 0.12 * s)))
            z += 0.25 * s
        p.append(cyl('hab', 0.62 * s, 1.2 * s, m['hull'], (0, 0, z + 0.6 * s)))
        p.append(torus('hab_band', 0.63 * s, 0.035 * s, m['dark'], (0, 0, z + 0.25 * s)))
        for k in range(6):
            a = k * TAU / 6
            p.append(box(f'window{k}', (0.1 * s, 0.02 * s, 0.18 * s), m['window'],
                         (0.63 * s * math.cos(a), 0.63 * s * math.sin(a), z + 0.75 * s), (0, 0, a + math.pi / 2)))
        dish = lathe('dish', [(r * s, (0.25 * r * r) * s) for r in [0.0, 0.1, 0.2, 0.3, 0.38]], m['hull'], segs=32)
        dish_root = group('dish_mount', [dish], (0.95 * s, 0, z + 0.5 * s), (0, math.radians(70), 0))
        p.append(dish_root)
        p.append(rod('dish_boom', (0.62 * s, 0, z + 0.5 * s), (0.95 * s, 0, z + 0.5 * s), 0.03 * s, m['truss']))
        z += 1.2 * s
        p.append(lathe('capsule', [(0.0, z), (0.62 * s, z), (0.6 * s, z + 0.08 * s), (0.32 * s, z + 0.8 * s),
                                   (0.2 * s, z + 0.9 * s), (0.0, z + 0.92 * s)], m['hull'], segs=48))
        for k in range(3):
            a = k * TAU / 3 + 0.4
            p.append(box(f'cwin{k}', (0.12 * s, 0.02 * s, 0.1 * s), m['window'],
                         (0.47 * s * math.cos(a), 0.47 * s * math.sin(a), z + 0.38 * s), (math.radians(-25), 0, a + math.pi / 2)))
        p.append(cyl('dock', 0.12 * s, 0.15 * s, m['dark'], (0, 0, z + 0.98 * s)))
    elif kind == 'tanker':
        p += truss('truss', z, z + 0.8 * s, 0.3 * s, m['truss'], bays=2)
        z += 0.8 * s
        p.append(cyl('spine', 0.2 * s, 3.0 * s, m['dark'], (0, 0, z + 1.5 * s)))
        for ring in range(2):
            for k in range(3):
                a = k * TAU / 3 + ring * 0.5
                p.append(sphere(f'tank{ring}{k}', 0.58 * s, m['hull'] if ring == 0 else m['foil'],
                                (0.66 * s * math.cos(a), 0.66 * s * math.sin(a), z + (0.65 + ring * 1.3) * s), 32))
        z += 2.6 * s
        p.append(box('cmd', (0.8 * s, 0.8 * s, 0.6 * s), m['hull'], (0, 0, z + 0.3 * s)))
        p.append(box('cmd_win', (0.5 * s, 0.02 * s, 0.14 * s), m['window'], (0, -0.41 * s, z + 0.4 * s)))
        for sx in (-1, 1):
            p.append(box(f'pv{sx}', (1.8 * s, 0.6 * s, 0.025 * s), m['pv'], (sx * 1.35 * s, 0, z + 0.3 * s)))
        p.append(rod('mast', (0, 0, z + 0.6 * s), (0, 0, z + 1.2 * s), 0.025 * s, m['truss']))
    elif kind == 'probe':
        p.append(lathe('adapter', [(0.5 * s, 0.0), (0.38 * s, 0.3 * s)], m['dark'], segs=32))
        p.append(box('bus', (1.0 * s, 1.0 * s, 0.9 * s), m['foil'], (0, 0, 0.75 * s)))
        for sx in (-1, 1):
            p.append(rod(f'yoke{sx}', (sx * 0.5 * s, 0, 0.75 * s), (sx * 0.75 * s, 0, 0.75 * s), 0.03 * s, m['truss']))
            p.append(box(f'wing{sx}', (2.6 * s, 0.9 * s, 0.03 * s), m['pv'], (sx * 2.05 * s, 0, 0.75 * s), (math.radians(20), 0, 0)))
            for k in range(4):
                p.append(box(f'wing_line{sx}{k}', (0.02 * s, 0.92 * s, 0.035 * s), m['truss'], (sx * (0.9 + k * 0.65) * s, 0, 0.75 * s), (math.radians(20), 0, 0)))
        dish = lathe('hga', [(r * s, (0.22 * r * r) * s) for r in [0.0, 0.15, 0.3, 0.45, 0.6]], m['hull'], segs=40)
        p.append(group('hga_mount', [dish], (0, 0, 1.25 * s), (math.radians(25), 0, 0)))
        p.append(rod('mag_boom', (0.5 * s, 0.5 * s, 1.1 * s), (1.2 * s, 1.2 * s, 1.7 * s), 0.015 * s, m['truss']))
    r = rot if rot is not None else ((math.pi if flip else 0.0), 0.0, yaw)
    return group('SHIP_' + kind, p, base, r)


# ---- framing ---------------------------------------------------------------

def is_glow(ob):
    mats = getattr(ob.data, 'materials', None) or []
    return any(m and m.node_tree and any(n.type == 'EMISSION' for n in m.node_tree.nodes) for m in mats)


def autoframe(lens=38, azim=-90.0, elev=10.0, fill=1.0, shift=(0.0, 0.0, 0.0), skip=()):
    """Point a camera at the hardware (glows and `skip` names excluded) and
    back it off until the bounding sphere fits; fill > 1 crops tighter."""
    bpy.context.view_layer.update()
    pts = []
    for ob in bpy.context.scene.objects:
        if ob.type not in ('MESH', 'CURVE') or is_glow(ob) or any(ob.name.startswith(k) for k in skip):
            continue
        pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    center = (lo + hi) / 2 + Vector(shift)
    radius = max((p - center).length for p in pts)
    half = math.atan(18.0 / lens)
    dist = radius / math.sin(half) / fill
    a, e = math.radians(azim), math.radians(elev)
    loc = center + Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))) * dist
    camera(tuple(loc), tuple(center), lens)
    c = bpy.context.scene.camera.data
    c.clip_end = dist * 4


# Standard vessel pose: nose up-left, plume down-right, seen three-quarter.
POSE = (math.radians(-14), math.radians(-62), math.radians(-24))


# ---- the 24 faces (engine-local Z up, plume toward -Z, ship on +Z) ---------

def ablative_plate():
    """A laser from far away strikes a ship's pusher plate; vapour jets back."""
    plate = cyl('pusher_plate', 1.5, 0.12, steel('plate', (0.8, 0.82, 0.86), 0.35))
    scorch = cyl('scorch', 0.55, 0.02, mat_glow('hot', (1.0, 0.45, 0.1), 12), (0, 0, -0.07))
    shocks = [cyl(f'shock_absorber{k}', 0.08, 1.0, steel('shk', (0.5, 0.52, 0.56)),
                  (math.cos(k * TAU / 6) * 0.9, math.sin(k * TAU / 6) * 0.9, 0.55)) for k in range(6)]
    deck = cyl('deck', 1.0, 0.1, steel('deck', (0.4, 0.42, 0.46)), (0, 0, 1.1))
    vapour = lathe('vapour', [(0.0, -0.08), (0.5, -0.08), (1.4, -1.6), (0.0, -1.6)], mat_glow('vapour', (1.0, 0.55, 0.2), 3, 0.5))
    beam = rod('laser', (0, 0, -0.1), (0, 0, -14), 0.06, mat_glow('laser', (1.0, 0.1, 0.08), 25))
    beam_glow = rod('laser_glow', (0, 0, -0.1), (0, 0, -14), 0.2, mat_glow('lg', (1.0, 0.1, 0.1), 3, 0.4))
    s = ship('tug', (0, 0, 1.15), 0.85)
    group('ENGINE_ablative_plate', [plate, scorch, *shocks, deck, vapour, beam, beam_glow, s], rot=POSE)
    autoframe(fill=1.25)
    rig()


def ablative_nozzle():
    """A charred ablative-lined nozzle firing a long flame."""
    char = mat_metal('char', (0.16, 0.1, 0.07), 0.85, 0.0)
    liner = mat_metal('liner', (0.32, 0.2, 0.12), 0.75, 0.0)
    body = cyl('case', 0.9, 1.2, steel('case', (0.55, 0.56, 0.6), 0.35), (0, 0, 1.0))
    nozzle = lathe('nozzle', bell_profile(0.9, 0.38, 1.35, 0.4, 2.4, 0.18), char)
    bands = [torus(f'band{i}', 0.62 + i * 0.2, 0.05, liner, (0, 0, -0.3 - i * 0.55)) for i in range(4)]
    flame = lathe('flame', [(0.0, -1.5), (0.95, -1.5), (1.7, -6.5), (0.0, -6.5)], mat_glow('flame', (1.0, 0.5, 0.12), 4, 0.6))
    core = lathe('core', [(0.0, -0.6), (0.4, -1.4), (0.5, -4.0), (0.0, -5.0)], mat_glow('core', (1.0, 0.85, 0.5), 10))
    s = ship('tanker', (0, 0, 1.6), 1.0)
    group('ENGINE_ablative', [body, nozzle, *bands, flame, core, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def de_laval():
    body = lathe('bell', bell_profile(), steel())
    dark = steel('band', (0.18, 0.19, 0.22), 0.45)
    rings = [torus(f'band{i}', 0.62 + 0.04 * i, 0.03, dark, (0, 0, 1.6 - i * 0.18)) for i in range(3)]
    pump = cyl('turbopump', 0.22, 0.9, steel('tp', (0.6, 0.62, 0.66)), (0.75, 0, 1.6))
    duct = tube('feed', [(0.75, 0, 1.15), (0.75, 0, 0.9), (0.55, 0, 0.95)], 0.08, dark)
    jet = lathe('jet', [(0.0, -1.35), (1.1, -1.35), (1.6, -5.2), (0.0, -5.2)], mat_glow('jet', (0.35, 0.6, 1.0), 2.5, 0.55))
    shocks = [lathe(f'shock{i}', [(0, -1.8 - i * 0.8), (0.32 - i * 0.05, -2.1 - i * 0.8), (0, -2.4 - i * 0.8)],
                    mat_glow(f'shk{i}', (0.85, 0.92, 1), 6 - i * 1.5)) for i in range(3)]
    s = ship('tug', (0, 0, 2.05), 1.0)
    group('ENGINE_de_laval', [body, *rings, pump, duct, jet, *shocks, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def mag_nozzle():
    cu = copper()
    frame = steel('frame', (0.3, 0.32, 0.36), 0.4)
    coils = [torus(f'coil{i}', 0.55 + i * 0.32, 0.12, cu, (0, 0, 1.6 - i * 0.55)) for i in range(5)]
    spars = [rod(f'spar{k}', (math.cos(k * TAU / 4) * 0.6, math.sin(k * TAU / 4) * 0.6, 1.7),
                 (math.cos(k * TAU / 4) * 1.85, math.sin(k * TAU / 4) * 1.85, -0.6), 0.035, frame) for k in range(4)]
    source = cyl('plasma_source', 0.5, 0.9, steel('src', (0.55, 0.57, 0.62)), (0, 0, 2.15))
    plasma = lathe('plasma', [(0.0, 2.2), (0.18, 2.2), (0.5, 0.6), (1.2, -1.4), (2.0, -3.4), (0.0, -3.4)],
                   mat_glow('plasma', (0.6, 0.3, 1.0), 2.5, 0.5))
    core = lathe('core', [(0.0, 2.2), (0.08, 2.2), (0.18, 0.4), (0.0, -1.5)], mat_glow('core', (1, 0.8, 1), 8))
    s = ship('tug', (0, 0, 2.6), 1.0)
    group('ENGINE_mag', [*coils, *spars, source, plasma, core, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def dumbo():
    """Folded-flow reactor: a stack of glowing fuel washers in a cut-away vessel."""
    vessel = lathe('vessel', [(0.0, 2.4), (0.95, 2.4), (1.05, 2.25), (1.05, -0.2), (0.9, -0.35), (0.0, -0.35)],
                   steel('vessel', (0.6, 0.62, 0.66), 0.3), sweep=TAU * 0.72, start=-0.9)
    hot = mat_glow('fuel', (1.0, 0.45, 0.08), 6)
    disks = [lathe(f'washer{i}', [(0.3, 2.0 - i * 0.24), (0.9, 2.0 - i * 0.24), (0.9, 1.88 - i * 0.24), (0.3, 1.88 - i * 0.24)],
                   hot if i % 2 == 0 else mat_glow(f'f{i}', (1.0, 0.7, 0.25), 8), segs=64) for i in range(9)]
    channel = cyl('h2_channel', 0.22, 2.1, mat_glow('h2', (0.6, 0.8, 1.0), 2), (0, 0, 0.95))
    bell = lathe('bell', bell_profile(0.7, 0.32, 1.05, -0.35, 1.5), steel('bell', (0.5, 0.52, 0.56)))
    jet = lathe('jet', [(0.0, -1.9), (0.95, -1.9), (1.3, -4.5), (0.0, -4.5)], mat_glow('jet', (1.0, 0.85, 0.6), 1.8, 0.5))
    s = ship('tanker', (0, 0, 2.4), 1.1, yaw=0.5)
    group('ENGINE_dumbo', [vessel, *disks, channel, bell, jet, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def timberwind():
    """Particle-bed reactor: a cut-away canister packed with glowing fuel beads."""
    can = lathe('canister', [(0.0, 2.2), (1.25, 2.2), (1.35, 2.0), (1.35, -0.6), (1.2, -0.75), (0.0, -0.75)],
                steel('can', (0.55, 0.6, 0.66), 0.3), sweep=TAU * 0.7, start=-0.8)
    bead_m = [mat_glow('bead_a', (1.0, 0.55, 0.15), 7), mat_glow('bead_b', (1.0, 0.8, 0.4), 9)]
    beads = []
    i = 0
    for layer in range(14):
        z = -0.55 + layer * 0.19
        for ring in range(3):
            r = 0.45 + ring * 0.27
            n = 10 + ring * 6
            for k in range(n):
                a = k * TAU / n + layer * 0.37
                beads.append(sphere(f'b{i}', 0.085, bead_m[i % 2], (r * math.cos(a), r * math.sin(a), z), 10))
                i += 1
    core = cyl('h2_core', 0.28, 2.8, mat_glow('core', (0.5, 0.75, 1.0), 4), (0, 0, 0.7))
    bell = lathe('bell', bell_profile(0.6, 0.28, 0.9, -0.75, 1.2), steel('bell', (0.5, 0.52, 0.56)))
    jet = lathe('jet', [(0.0, -2.0), (0.8, -2.0), (1.2, -4.5), (0.0, -4.5)], mat_glow('jet', (0.4, 0.65, 1.0), 2, 0.5))
    s = ship('tug', (0, 0, 2.2), 1.05)
    group('ENGINE_timberwind', [can, *beads, core, bell, jet, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def hall():
    """Hall thruster seen three-quarter: cylinder body, outer magnet coils,
    glowing annular channel, hollow cathode, wide plume, on a probe bus."""
    body_m = steel('body', (0.6, 0.63, 0.68), 0.3)
    pole = steel('pole', (0.32, 0.33, 0.37), 0.4)
    # Built with the exit face toward -Z (plume down, ship on +Z).
    body = lathe('body', [(0.0, 0.6), (1.6, 0.6), (1.7, 0.5), (1.7, -0.25), (1.55, -0.3),
                          (1.2, -0.3), (1.2, -0.05), (0.75, -0.05), (0.75, -0.3), (0.0, -0.3)], body_m)
    coils = [cyl(f'outer_coil{k}', 0.16, 0.7, copper(), (math.cos(k * TAU / 4 + 0.78) * 1.85, math.sin(k * TAU / 4 + 0.78) * 1.85, 0.2)) for k in range(4)]
    channel = torus('discharge', 0.975, 0.2, mat_glow('plasma', (0.3, 0.5, 1.0), 6), (0, 0, -0.08))
    cap = cyl('pole_cap', 0.55, 0.08, pole, (0, 0, -0.33))
    cath = cyl('cathode', 0.13, 1.4, pole, (0, 2.05, -0.4), (math.radians(90 - 25), 0, 0))
    tip = sphere('cathode_tip', 0.1, mat_glow('tip', (0.6, 0.8, 1), 10), (0, 1.75, -1.0))
    plume = lathe('plume', [(0.7, -0.3), (1.3, -0.3), (3.0, -5.5), (0.0, -5.5), (0.0, -2.0)], mat_glow('plume', (0.35, 0.45, 1.0), 1.6, 0.35))
    s = ship('probe', (0, 0, 0.6), 1.3)
    group('ENGINE_hall', [body, *coils, channel, cap, cath, tip, plume, s], rot=(math.radians(-14), math.radians(-62), math.radians(-30)))
    autoframe(fill=1.25)
    rig((3, -5, 4), (-4, 2, -2), 800, 400)


def ion():
    shell = mat_metal('shell', (0.7, 0.72, 0.76), 0.25)
    grid_m = mat_metal('grid', (0.85, 0.66, 0.38), 0.3)
    body = lathe('shell', [(0, 1.6), (0.9, 1.6), (1.25, 1.0), (1.25, 0.05), (1.32, 0.0), (0.0, 0.0)], shell)
    grid = lathe('grid', [(0, -0.02), (1.22, 0.0), (1.22, 0.04), (0, 0.02)], grid_m)
    holes = []
    dark = mat_glow('hole', (0.4, 0.75, 1.0), 6)
    step = 0.17
    for iy in range(-7, 8):
        for ix in range(-7, 8):
            x = (ix + (iy % 2) * 0.5) * step
            y = iy * step * 0.866
            if x * x + y * y < 1.05 ** 2:
                holes.append(cyl(f'h{ix}_{iy}', 0.055, 0.03, dark, (x, y, -0.03), verts=12, smooth=False))
    beam = lathe('beam', [(0.0, -0.05), (1.15, -0.05), (1.6, -5.0), (0.0, -5.0)], mat_glow('beam', (0.2, 0.6, 1.0), 2.2, 0.5))
    s = ship('probe', (0, 0, 1.6), 1.5)
    group('ENGINE_ion', [body, grid, beam, *holes, s], rot=(math.radians(-20), math.radians(-60), math.radians(-30)))
    autoframe(fill=1.22)
    rig()


def mass_driver():
    """A ship whose spine is an electromagnetic track, flinging slugs of
    asteroid ore out the front to push itself the other way."""
    rail_m = steel('rail', (0.55, 0.57, 0.62), 0.35)
    coil_m = mat_metal('coil', (0.95, 0.6, 0.2), 0.3)
    L = 6.0
    rails = [rod(f'rail{k}', (0.25 * math.cos(k * TAU / 3), 0.25 * math.sin(k * TAU / 3), 0),
                 (0.25 * math.cos(k * TAU / 3), 0.25 * math.sin(k * TAU / 3), -L), 0.05, rail_m) for k in range(3)]
    coils = [torus(f'bucket_coil{i}', 0.42, 0.06, coil_m, (0, 0, -i * L / 15)) for i in range(16)]
    hopper = lathe('ore_hopper', [(0.3, 0.0), (0.9, 0.5), (0.9, 1.5), (0.0, 1.5)], mat_metal('hopper', (0.45, 0.4, 0.34), 0.7, 0.2))
    slug_m = mat_glow('slug', (1.0, 0.85, 0.55), 6)
    slugs = [sphere(f'slug{i}', 0.12 - i * 0.012, slug_m, (0, 0, -L - 0.6 - i * 0.8), 16) for i in range(6)]
    trail = rod('trail', (0, 0, -L * 0.6), (0, 0, -L - 5), 0.03, mat_glow('trail', (1.0, 0.8, 0.5), 3, 0.5))
    s = ship('tanker', (0, 0, 1.5), 0.9)
    group('ENGINE_mass_driver', [*rails, *coils, hopper, *slugs, trail, s], (0, 0, 0), POSE)
    rock = asteroid('asteroid', 1.4, mat_metal('rock', (0.36, 0.32, 0.28), 0.85, 0.0), (-4.5, 3.0, -1.5), 3.0, 0.3)
    autoframe(fill=1.35, skip=('asteroid',))
    sun((-1, 1, -0.6), 3.5)
    area('fill', (-5, -4, 3), 300, 5, (0.6, 0.7, 1.0))


def mpd():
    """Magnetoplasmadynamic thruster: cathode rod inside an anode ring, current
    arcs between them, a twisting purple jet."""
    anode = lathe('anode', [(0.0, 1.6), (1.1, 1.6), (1.2, 1.4), (1.2, -0.4), (1.45, -0.6), (1.35, -0.7), (1.0, -0.4), (1.0, 1.4), (0.0, 1.4)],
                  steel('anode', (0.7, 0.72, 0.76), 0.25), sweep=TAU * 0.75, start=-0.6)
    cathode = cyl('cathode', 0.16, 2.2, steel('cathode', (0.85, 0.86, 0.9), 0.15), (0, 0, 0.5))
    arc_m = mat_glow('arc', (0.9, 0.55, 1.0), 14)
    arcs = []
    for k in range(6):
        a = k * TAU / 6
        arcs.append(tube(f'arc{k}', [(0.16 * math.cos(a), 0.16 * math.sin(a), -0.45),
                                     (0.6 * math.cos(a + 0.3), 0.6 * math.sin(a + 0.3), -0.35),
                                     (1.0 * math.cos(a + 0.6), 1.0 * math.sin(a + 0.6), -0.2)], 0.025, arc_m))
    coil = torus('field_coil', 1.6, 0.14, copper(), (0, 0, 0.6))
    jet = lathe('jet', [(0.0, -0.5), (0.9, -0.6), (1.6, -5.0), (0.0, -5.0)], mat_glow('jet', (0.6, 0.25, 1.0), 2.4, 0.5))
    waves = [torus(f'wave{i}', 0.9 + i * 0.22, 0.03, mat_glow(f'w{i}', (0.95, 0.75, 1.0), 6 - i), (0, 0, -1.2 - i * 0.8)) for i in range(4)]
    s = ship('crew', (0, 0, 1.6), 1.0)
    group('ENGINE_mpd', [anode, cathode, *arcs, coil, jet, *waves, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def metastable_helium():
    """A frosted cryogenic dewar of excited helium feeding a small engine."""
    tank = sphere('dewar', 1.4, mat_metal('frost', (0.92, 0.94, 0.97), 0.55, 0.2), (0, 0, 1.3), 64)
    collar = torus('collar', 1.42, 0.06, steel('collar', (0.6, 0.62, 0.66)), (0, 0, 1.3))
    legs = [rod(f'leg{k}', (math.cos(k * TAU / 3) * 1.1, math.sin(k * TAU / 3) * 1.1, 0.4), (0, 0, -0.4), 0.05, steel('leg', (0.5, 0.52, 0.56))) for k in range(3)]
    bell = lathe('bell', bell_profile(0.35, 0.16, 0.6, -0.1, 1.1), steel('bell'))
    jet = lathe('jet', [(0.0, -1.4), (0.55, -1.4), (1.0, -4.5), (0.0, -4.5)], mat_glow('jet', (1.0, 0.85, 0.3), 2.5, 0.5))
    orbit_m = mat_glow('orbit', (1.0, 0.8, 0.2), 6)
    orbits = [torus('orbit_a', 1.75, 0.02, orbit_m, (0, 0, 1.3), (math.radians(70), 0, 0)),
              torus('orbit_b', 2.0, 0.02, orbit_m, (0, 0, 1.3), (math.radians(70), math.radians(50), 0))]
    excited = sphere('electron', 0.12, mat_glow('e', (1.0, 0.9, 0.4), 16), (1.9, -0.3, 1.9))
    s = ship('crew', (0, 0, 2.65), 0.9)
    group('ENGINE_he', [tank, collar, *legs, bell, jet, *orbits, excited, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def microfission():
    """Pulse chamber: lithium-6 pellets fed in and flashed one after another."""
    chamber = lathe('chamber', [(0.0, 2.2), (1.3, 2.2), (1.35, 1.0), (1.0, 0.0), (0.45, -0.3), (0.5, -0.4), (1.1, -0.1), (1.5, 1.0), (1.45, 2.3), (0.0, 2.3)],
                    steel('chamber', (0.5, 0.52, 0.56), 0.35), sweep=TAU * 0.72, start=-0.9)
    pellet_m = mat_metal('li6', (0.5, 0.95, 0.75), 0.2, 0.3)
    pellets = [sphere(f'pellet{i}', 0.1, pellet_m, (0.0, 0.0, 2.0 - i * 0.32), 16) for i in range(4)]
    flash = sphere('flash', 0.42, mat_glow('flash', (1.0, 0.85, 0.5), 18), (0, 0, 0.75))
    bursts = [sphere(f'burst{i}', 0.55 - i * 0.1, mat_glow(f'bu{i}', (1.0, 0.45 - i * 0.08, 0.1), 6 - i * 1.2, 0.6), (0, 0, -1.0 - i * 0.9)) for i in range(4)]
    s = ship('tug', (0, 0, 2.3), 1.0)
    group('ENGINE_microfission', [chamber, *pellets, flash, *bursts, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def plug_nozzle():
    """Aerospike: the exhaust hugs a central plug instead of a bell."""
    chamber = lathe('combustor', [(0.0, 1.2), (1.4, 1.2), (1.5, 1.0), (1.5, 0.3), (1.3, 0.2), (0.0, 0.2)], steel('combustor', (0.6, 0.62, 0.66)))
    spike = lathe('spike', [(1.1, 0.2), (0.9, -0.6), (0.65, -1.5), (0.4, -2.4), (0.18, -3.1), (0.0, -3.3)], steel('spike', (0.75, 0.77, 0.82), 0.2))
    throat = torus('throat_ring', 1.25, 0.06, mat_glow('throat', (1.0, 0.55, 0.2), 10), (0, 0, 0.18))
    sheath = lathe('sheath', [(1.32, 0.15), (1.05, -0.6), (0.8, -1.5), (0.6, -2.4), (0.45, -3.4), (0.6, -4.6), (0.0, -4.6), (0.0, -3.3), (0.18, -3.1), (0.4, -2.4), (0.65, -1.5), (0.9, -0.6), (1.12, 0.15)],
                   mat_glow('sheath', (1.0, 0.55, 0.2), 3, 0.55))
    s = ship('tanker', (0, 0, 1.2), 1.2)
    group('ENGINE_aerospike', [chamber, spike, throat, sheath, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def vortex():
    """Propellant spirals down the wall in a cold vortex around a hot core."""
    wall = lathe('chamber', [(0.0, 2.2), (1.2, 2.2), (1.25, 2.0), (1.25, 0.2), (0.5, -0.4), (0.9, -1.3), (0.85, -1.35), (0.45, -0.45), (1.15, 0.2), (1.15, 2.1), (0.0, 2.1)],
                 steel('wall', (0.45, 0.55, 0.62), 0.3), sweep=TAU * 0.7, start=-0.8)
    pts = []
    for i in range(160):
        t = i / 159
        a = t * TAU * 5
        r = 1.05 - 0.15 * t
        pts.append((r * math.cos(a), r * math.sin(a), 2.0 - t * 1.9))
    swirl = tube('vortex', pts, 0.05, mat_glow('cold', (0.3, 0.9, 1.0), 5))
    core = lathe('hot_core', [(0.0, 2.0), (0.25, 1.6), (0.3, 0.5), (0.18, -0.4), (0.0, -0.5)], mat_glow('core', (1.0, 0.55, 0.2), 7))
    jet = lathe('jet', [(0.0, -1.3), (0.85, -1.3), (1.3, -4.3), (0.0, -4.3)], mat_glow('jet', (1.0, 0.5, 0.25), 2.2, 0.5))
    s = ship('crew', (0, 0, 2.2), 1.0)
    group('ENGINE_vortex', [wall, swirl, core, jet, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def mat_film(name, color):
    """Sail film: metallic, but lit from within a touch so it never reads as a
    black hole when the sun reflects away from the camera."""
    m = mat_metal(name, color, 0.3, 0.7)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = (*color, 1)
    b.inputs['Emission Strength'].default_value = 0.35
    return m


def heliogyro():
    """Long ribbon blades spun out from a probe's hub, riding sunlight."""
    film = mat_film('film', (0.95, 0.85, 0.6))
    hub = cyl('hub', 0.45, 0.4, steel('hub', (0.4, 0.42, 0.46)))
    blades = []
    for k in range(8):
        a = k * TAU / 8
        blades.append(box(f'blade{k}', (6.0, 0.75, 0.02), film, (math.cos(a) * 3.6, math.sin(a) * 3.6, 0), (0.35, 0, a)))
    s = ship('probe', (0, 0, 0.2), 1.2)
    group('ENGINE_heliogyro', [hub, *blades, s], rot=(math.radians(62), math.radians(-20), math.radians(30)))
    autoframe(fill=0.55, elev=14, skip=('blade',))
    sun((-0.6, 1.0, -0.8), 5.0)
    area('fill', (-4, -6, -2), 400, 6, (0.5, 0.6, 1.0))


def electric_sail():
    """A probe trailing long charged tethers that push on the solar wind."""
    wire_m = mat_glow('wire', (0.75, 0.88, 1.0), 6)
    sheath_m = mat_glow('sheath', (0.3, 0.55, 1.0), 1.2, 0.35)
    wires = []
    for k in range(16):
        a = k * TAU / 16
        end = (math.cos(a) * 12, math.sin(a) * 12, 0.75)
        wires += [rod(f'tether{k}', (0, 0, 0.75), end, 0.012, wire_m), rod(f'sheath{k}', (0, 0, 0.75), end, 0.12, sheath_m)]
    reel = cyl('tether_reel', 0.55, 0.25, steel('reel', (0.5, 0.52, 0.56)), (0, 0, 0.75))
    s = ship('probe', (0, 0, -0.4), 1.0)
    group('ENGINE_esail', [reel, *wires, s], rot=(math.radians(62), 0, math.radians(8)))
    wind_m = mat_glow('wind', (1.0, 0.85, 0.5), 4)
    for i in range(14):
        y = -3 + (i * 0.73) % 6
        z = -2.5 + (i * 1.37) % 5
        rod(f'wind{i}', (-7 + (i % 5), y, z), (-6.2 + (i % 5), y, z), 0.02, wind_m)
    camera((0, -9, 1.6), (0, 0, 0), 32)
    rig((3, -6, 5), (-5, 4, 2), 600, 300)


def kite_sail():
    """A square reflective sail bellied by sunlight on four diagonal booms,
    towing a small probe on its shrouds."""
    bm = bmesh.new()
    n, s = 24, 2.6
    vs = {}
    for i in range(n + 1):
        for j in range(n + 1):
            x, y = (i / n * 2 - 1) * s, (j / n * 2 - 1) * s
            u, v = (x + y) / 2, (x - y) / 2
            sag = 0.45 * (1 - (abs(u) / s) ** 2) * (1 - (abs(v) / s) ** 2)
            vs[i, j] = bm.verts.new((u * 1.4, v * 1.4, sag))
    for i in range(n):
        for j in range(n):
            bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
    sail = obj_from_bm('sail', bm, mat_film('film', (0.95, 0.88, 0.7)))
    boom_m = steel('boom', (0.35, 0.36, 0.4), 0.4)
    booms = [rod(f'boom{k}', (0, 0, 0.05), (math.cos(k * TAU / 4) * 3.7, math.sin(k * TAU / 4) * 3.7, 0.05), 0.035, boom_m) for k in range(4)]
    line_m = steel('line', (0.75, 0.77, 0.8))
    lines = [rod(f'shroud{k}', (math.cos(k * TAU / 4) * 3.6, math.sin(k * TAU / 4) * 3.6, 0.05), (0, 0, -2.4), 0.008, line_m) for k in range(4)]
    probe = ship('probe', (0, 0, -2.4), 0.55, flip=True)
    group('ENGINE_kite', [sail, *booms, *lines, probe], rot=(math.radians(-55), math.radians(10), math.radians(25)))
    autoframe(fill=1.25, elev=8)
    sun((-1.0, 0.8, 0.6), 5.0)
    area('key', (2, -6, 4), 700, 6, (1.0, 0.95, 0.85))
    area('fill', (3, -6, -2), 250, 6, (0.5, 0.6, 1.0))
    sphere('sun_disc', 0.9, mat_glow('sundisc', (1.0, 0.85, 0.5), 30), (-7.0, 6.0, 4.5))


def mag_sail():
    """A huge superconducting loop whose magnetic bubble deflects the solar
    wind; a crewed ship rides on the shroud lines."""
    loop = torus('sc_loop', 3.0, 0.09, mat_glow('loop', (0.7, 0.8, 1.0), 10), rot=(math.radians(90), 0, 0))
    loop_glow = torus('loop_glow', 3.0, 0.3, mat_glow('lglow', (0.4, 0.55, 1.0), 2, 0.4), rot=(math.radians(90), 0, 0))
    shell = sphere('magnetosphere', 3.8, mat_glow('bubble', (0.35, 0.45, 1.0), 1.4, 0.35), (0, 0, 0), 64)
    shell.scale = (1.15, 1.0, 0.95)
    line_m = steel('line', (0.7, 0.72, 0.76))
    lines = [rod(f'shroud{k}', (3.0 * math.cos(k * TAU / 6), 0, 3.0 * math.sin(k * TAU / 6)), (0, -3.4, 0), 0.012, line_m) for k in range(6)]
    s = ship('crew', (0, -3.4, 0), 0.7, rot=(math.radians(90), 0, 0))
    group('ENGINE_magsail', [loop, loop_glow, shell, *lines, s], rot=(0, 0, math.radians(35)))
    wind_m = mat_glow('wind', (1.0, 0.85, 0.5), 4)
    for i in range(9):
        z = -4 + i
        bend = 1.0 if abs(z) < 4 else 0
        tube(f'flow{i}', [(-9, 3, z), (-4.5, 1.5, z * (1 + 0.4 * bend)), (0, 0, z * (1 + 0.8 * bend) + (0.4 if z >= 0 else -0.4)), (6, -2, z * 1.2)], 0.025, wind_m)
    camera((3.0, -11.0, 1.4), (0, -1.0, 0), 34)
    rig((4, -6, 4), (-5, 2, 3), 700, 300)


def vasimr():
    """A long magnetic bottle in stages, the plasma heating violet to white."""
    liner = cyl('liner', 0.55, 5.0, mat_glow('liner_glow', (0.6, 0.35, 1.0), 0.6, 0.3), (0, 0, 0.5))
    coils = []
    for i in range(9):
        z = 2.6 - i * 0.55
        st = 0 if i < 3 else (1 if i < 7 else 2)
        coils.append(torus(f'coil{i}', 0.85 + (0.25 * (i - 6) if i > 6 else 0), 0.12,
                           copper() if st < 2 else steel('sc', (0.8, 0.82, 0.86)), (0, 0, z)))
    antenna = tube('helicon_antenna', [(0.7 * math.cos(a / 10 * TAU), 0.7 * math.sin(a / 10 * TAU), 2.2 - a * 0.06) for a in range(21)], 0.04, mat_glow('ant', (1.0, 0.6, 0.9), 6))
    plasma = lathe('plasma', [(0.0, 3.0), (0.25, 3.0), (0.4, 0.0), (0.5, -1.6), (1.6, -3.4), (2.4, -5.0), (0.0, -5.0)], mat_glow('pl', (0.8, 0.5, 1.0), 2.6, 0.55))
    core = lathe('core', [(0.0, 2.6), (0.1, 2.6), (0.22, -1.0), (0.0, -2.6)], mat_glow('core', (1.0, 0.92, 1.0), 9))
    s = ship('tug', (0, 0, 3.0), 1.0)
    group('ENGINE_vasimr', [liner, *coils, antenna, plasma, core, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def plasmoid():
    """A conical theta-pinch coil firing self-contained plasma rings."""
    coil_m = copper()
    cone = lathe('cone', [(0.5, 1.8), (0.55, 1.8), (1.25, -0.4), (1.2, -0.4)], steel('cone', (0.45, 0.47, 0.52), 0.35))
    turns = [torus(f'turn{i}', 0.6 + i * 0.1, 0.06, coil_m, (0, 0, 1.6 - i * 0.3)) for i in range(7)]
    ring_m = [mat_glow(f'pl{i}', (0.5, 0.95, 1.0), 9 - i * 2) for i in range(4)]
    rings = [torus(f'plasmoid{i}', 0.85 - i * 0.08, 0.16 - i * 0.025, ring_m[i], (0, 0, -1.2 - i * 1.15)) for i in range(4)]
    halos = [torus(f'halo{i}', 0.85 - i * 0.08, 0.35, mat_glow(f'h{i}', (0.3, 0.8, 1.0), 1.2, 0.3), (0, 0, -1.2 - i * 1.15)) for i in range(2)]
    cap = cyl('capacitor_bank', 0.6, 0.6, steel('cap', (0.35, 0.37, 0.42)), (0, 0, 2.1))
    s = ship('crew', (0, 0, 2.4), 0.95)
    group('ENGINE_plasmoid', [cone, *turns, *rings, *halos, cap, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def pulsed_inductive():
    """A flat spiral coil; the induced current sheet flashes off its face."""
    # Built with the coil face toward -Z so the ship stands on +Z.
    base = cyl('base', 2.3, 0.25, steel('base', (0.2, 0.21, 0.24), 0.5), (0, 0, 0.15))
    pts = []
    for i in range(400):
        t = i / 399 * 9 * TAU
        r = 0.2 + t / (9 * TAU) * 2.0
        pts.append((r * math.cos(t), r * math.sin(t), -0.02))
    spiral = tube('spiral_coil', pts, 0.045, copper())
    sheet = cyl('current_sheet', 2.2, 0.08, mat_glow('sheet', (1.0, 0.55, 0.85), 5, 0.6), (0, 0, -0.5))
    sheet2 = cyl('sheet_far', 2.05, 0.05, mat_glow('sheet2', (0.9, 0.4, 0.8), 2, 0.4), (0, 0, -1.35))
    arc_m = mat_glow('arc', (1.0, 0.85, 1.0), 12)
    arcs = [tube(f'arc{k}', [(2.1 * math.cos(k), 2.1 * math.sin(k), -0.05), (2.0 * math.cos(k + 0.1), 2.0 * math.sin(k + 0.1), -0.25), (2.15 * math.cos(k + 0.05), 2.15 * math.sin(k + 0.05), -0.48)], 0.015, arc_m) for k in range(0, 6)]
    struts = [rod(f'mount{k}', (1.6 * math.cos(k * TAU / 4), 1.6 * math.sin(k * TAU / 4), 0.28), (0.4 * math.cos(k * TAU / 4), 0.4 * math.sin(k * TAU / 4), 1.0), 0.05, steel('mt', (0.45, 0.47, 0.52))) for k in range(4)]
    s = ship('tug', (0, 0, 1.0), 0.9)
    group('ENGINE_pit', [base, spiral, sheet, sheet2, *arcs, *struts, s], rot=(math.radians(-10), math.radians(-70), math.radians(-30)))
    autoframe(fill=1.22)
    rig((3, -4, 6), (-4, 4, 2))


def ds4g():
    """Four grids in a row: two extract, two accelerate - a pencil-thin beam."""
    src = lathe('source', [(0.0, 2.4), (1.2, 2.4), (1.3, 2.2), (1.3, 0.2), (0.0, 0.2)], steel('src', (0.4, 0.42, 0.47), 0.35))
    cols = [(0.7, 0.72, 0.78), (0.7, 0.72, 0.78), (0.95, 0.72, 0.3), (0.95, 0.72, 0.3)]
    grids = [cyl(f'grid{i}', 1.25, 0.04, mat_metal(f'g{i}', cols[i], 0.3), (0, 0, 0.05 - i * 0.28)) for i in range(4)]
    spacers = [rod(f'spacer{k}', (1.27 * math.cos(k * TAU / 6), 1.27 * math.sin(k * TAU / 6), 0.2), (1.27 * math.cos(k * TAU / 6), 1.27 * math.sin(k * TAU / 6), -0.85), 0.04, steel('sp', (0.3, 0.3, 0.33))) for k in range(6)]
    plasma = cyl('discharge', 1.0, 0.12, mat_glow('dis', (0.3, 0.95, 0.85), 4), (0, 0, 0.25))
    beam = lathe('beam', [(0.0, -0.85), (0.32, -0.85), (0.45, -6.0), (0.0, -6.0)], mat_glow('beam', (0.4, 1.0, 0.9), 5, 0.65))
    core = cyl('beam_core', 0.1, 5.0, mat_glow('bc', (0.9, 1.0, 1.0), 14), (0, 0, -3.3))
    s = ship('probe', (0, 0, 2.4), 1.4)
    group('ENGINE_ds4g', [src, *grids, *spacers, plasma, beam, core, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


def solar_moth():
    """Two parabolic mirror wings on a ship's flanks focus sunlight onto a
    rhenium absorber that heats hydrogen out of a small nozzle."""
    mirror = mat_film('mirror', (0.98, 0.86, 0.55))
    back = mat_film('mirror_back', (0.7, 0.62, 0.45))
    # A dish of focal length ~2.1 (z = 0.12 r^2), vertex 2.1 from the absorber,
    # so each wing focuses on the absorber at the origin.
    prof = [(r, 0.12 * r * r) for r in [0.0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]]
    wings = []
    for sx in (-1, 1):
        d = lathe(f'wing{sx}', prof, mirror, segs=48)
        d2 = lathe(f'wing_back{sx}', [(r, z - 0.03) for r, z in prof], back, segs=48)
        wings.append(group(f'wing_mount{sx}', [d, d2], (sx * 2.1, 0, 0), (0, math.radians(-90 * sx), 0)))
        wings.append(rod(f'wing_arm{sx}', (sx * 0.25, 0, 0.3), (sx * 2.1, 0, 0), 0.05, steel('arm', (0.4, 0.42, 0.46))))
    absorber = sphere('absorber', 0.28, mat_glow('re', (1.0, 0.6, 0.25), 14), (0, 0, 0))
    housing = cyl('absorber_housing', 0.3, 0.5, steel('hs', (0.45, 0.43, 0.42)), (0, 0, 0.45))
    body = cyl('body', 0.22, 0.6, steel('bd', (0.45, 0.43, 0.42)), (0, 0, -0.5))
    bell = lathe('bell', [(0.12, -0.8), (0.3, -1.2), (0.42, -1.5), (0.38, -1.5), (0.26, -1.2), (0.08, -0.8)], steel('bl'))
    jet = lathe('jet', [(0.0, -1.5), (0.38, -1.5), (0.7, -4.0), (0.0, -4.0)], mat_glow('jet', (1.0, 0.75, 0.5), 2.0, 0.5))
    s = ship('crew', (0, 0, 0.7), 0.75)
    group('ENGINE_solar_moth', [*wings, absorber, housing, body, bell, jet, s], rot=(math.radians(-25), math.radians(-30), math.radians(-25)))
    autoframe(fill=1.25)
    sun((0.3, 0.8, -0.6), 3.5)
    area('fill', (-4, -6, 2), 400, 6, (0.6, 0.7, 1.0))
    area('key', (4, -5, 4), 500, 4, (1.0, 0.95, 0.85))


def colliding_beam():
    """Hydrogen and boron beams counter-rotate in a ring and fuse at the core."""
    ring = torus('reactor_ring', 2.6, 0.38, steel('ring', (0.32, 0.34, 0.4), 0.35))
    beam_a = torus('beam_h', 2.6, 0.06, mat_glow('bh', (0.3, 0.8, 1.0), 12), (0, 0, 0.15))
    beam_b = torus('beam_b', 2.6, 0.06, mat_glow('bb', (1.0, 0.4, 0.75), 12), (0, 0, -0.15))
    spokes = [rod(f'spoke{k}', (2.6 * math.cos(k * TAU / 6), 2.6 * math.sin(k * TAU / 6), 0), (0.5 * math.cos(k * TAU / 6), 0.5 * math.sin(k * TAU / 6), 0), 0.07, steel('sp', (0.45, 0.47, 0.52))) for k in range(6)]
    flash = sphere('fusion', 0.55, mat_glow('fusion', (1.0, 0.9, 0.7), 20), (0, 0, 0))
    halo = sphere('fusion_halo', 1.2, mat_glow('halo', (1.0, 0.5, 0.85), 2, 0.4), (0, 0, 0))
    nozzle = lathe('mag_nozzle', [(0.6, -0.4), (0.62, -0.4), (1.4, -2.2), (1.38, -2.2)], copper(), segs=72)
    jet = lathe('jet', [(0.0, -0.5), (0.55, -0.5), (1.6, -5.0), (0.0, -5.0)], mat_glow('jet', (0.9, 0.45, 1.0), 2.4, 0.5))
    alphas = [sphere(f'alpha{i}', 0.07, mat_glow('al', (1.0, 0.95, 0.5), 14), (0.2 * math.sin(i * 1.7), 0.2 * math.cos(i), -1.0 - i * 0.6), 12) for i in range(6)]
    spine = cyl('spine', 0.3, 1.0, steel('spn', (0.4, 0.42, 0.46)), (0, 0, 0.9))
    s = ship('tug', (0, 0, 1.4), 1.1)
    group('ENGINE_hb_fusion', [ring, beam_a, beam_b, *spokes, flash, halo, nozzle, jet, *alphas, spine, s], rot=POSE)
    autoframe(fill=1.22)
    rig()


SUBJECTS = {
    'thr_ablative_plate-front': ablative_plate,
    'thr_ablative_plate-back': ablative_nozzle,
    'thr_de_laval_nozzle-front': de_laval,
    'thr_de_laval_nozzle-back': mag_nozzle,
    'thr_dumbo-front': dumbo,
    'thr_dumbo-back': timberwind,
    'thr_hall_effect-front': hall,
    'thr_hall_effect-back': ion,
    'thr_mass_driver-front': mass_driver,
    'thr_mass_driver-back': mpd,
    'thr_metastable_helium-front': metastable_helium,
    'thr_metastable_helium-back': microfission,
    'thr_monoatomic_plug_nozzle-front': plug_nozzle,
    'thr_monoatomic_plug_nozzle-back': vortex,
    'thr_photon_heliogyro-front': heliogyro,
    'thr_photon_heliogyro-back': electric_sail,
    'thr_photon_kite_sail-front': kite_sail,
    'thr_photon_kite_sail-back': mag_sail,
    'thr_ponderomotive_vasimr-front': vasimr,
    'thr_ponderomotive_vasimr-back': plasmoid,
    'thr_pulsed_inductive-front': pulsed_inductive,
    'thr_pulsed_inductive-back': ds4g,
    'thr_re_solar_moth-front': solar_moth,
    'thr_re_solar_moth-back': colliding_beam,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=48)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    only = set(filter(None, a.only.split(',')))
    for key, build in SUBJECTS.items():
        if only and key not in only:
            continue
        reset(a.samples)
        build()
        bpy.context.scene.render.filepath = os.path.join(a.out, key + '.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', key, flush=True)


if __name__ == '__main__':
    main()
