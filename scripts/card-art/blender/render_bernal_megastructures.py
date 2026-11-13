"""Blender card art (scripted, headless): the two megastructure Bernals.

GEO Elevator Bernal and L3 Lofstrom Loop Microgravity, both faces each, as 3D
renders instead of flat vector art (user 2026-11-13: "these colonies are
awesome megastructures"). Method from the blender-hard-surface skill: every
model is built here from primitives (tori, boxes, cylinders, curve tubes),
nothing hand-modelled, rendered with Cycles on the CPU on a transparent film.

- GEO: a camera beside the elevator column looks DOWN the ribbon. A shielded
  Stanford-torus habitat is threaded on it; the truss tower is dense with
  modules, tanks and lit windows; a climber rides the ribbon down to a cloudy
  Earth far below. Lab face: a nanotube extrusion works at the hub and a
  catapult arm flinging a payload.
- Lofstrom: high above an ocean planet, the launch loop's sheath sweeps up off
  the sea and runs far along above the curved horizon, stay cables fanning
  down to the water in a criss-cross, a loop-end station on the sea in the
  foreground, little vehicles on the arc. The Bernal hangs above it all. Lab
  face: a loop ring around the station and microgravity process modules.

Every Bernal is a dirt rocket (rules fn 5), so each habitat vents a regolith
stream from a mass driver. The subject sits in the upper band of the card
(the supports box and ability text cover the lower half); the planet may fill
the whole card. Front (white) faces render on a transparent film so they sit
on the cream card; back (purple) faces are composited onto the promoted
purple wash afterwards by composite_bernal_megastructures.py.

Run (Blender as a Python module, `pip install bpy`, Python 3.11):
    python scripts/card-art/blender/render_bernal_megastructures.py --out DIR [--only key,key] [--samples 64]
Keys: geo-front, geo-back, lofstrom-front, lofstrom-back.
"""
import argparse
import math
import os
import random
import sys

import bpy  # must come before bmesh / mathutils with the pip module
from mathutils import Vector

W, H = 600, 576
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
    world = bpy.data.worlds.new('space')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.01, 0.012, 0.02, 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = world
    return sc


def link(ob):
    bpy.context.collection.objects.link(ob)
    return ob


def principled(name, color, rough=0.4, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def glow(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def ramp(nt, stops):
    r = nt.nodes.new('ShaderNodeValToRGB')
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    return r


def noise(nt, scale, detail=8.0, rough=0.55, w=None):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    return n


def mat_planet(name, scale, land, ocean_only=False):
    """Ocean + land from one noise field; the ocean is glossy so the sun glints."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    n = noise(nt, scale, 10, 0.6)
    sea = (0.008, 0.04, 0.16)
    shallow = (0.02, 0.16, 0.32)
    if ocean_only:
        stops = [(0.0, sea), (0.62, (0.012, 0.06, 0.2)), (0.66, shallow), (0.665, (0.55, 0.5, 0.36)), (1.0, (0.18, 0.3, 0.1))]
    else:
        stops = [(0.0, sea), (0.5, (0.012, 0.07, 0.22)), (0.53, shallow), (0.535, (0.6, 0.55, 0.38)),
                 (0.56, (0.12, 0.3, 0.08)), (0.66, (0.3, 0.28, 0.12)), (1.0, (0.45, 0.36, 0.22))]
    r = ramp(nt, stops)
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], b.inputs['Base Color'])
    rr = ramp(nt, [(0.0, (0.06,) * 3), (land - 0.005, (0.08,) * 3), (land, (0.8,) * 3), (1.0, (0.9,) * 3)])
    nt.links.new(n.outputs['Fac'], rr.inputs['Fac'])
    nt.links.new(rr.outputs['Color'], b.inputs['Roughness'])
    return m


def mat_clouds(name, scale, cover=0.56):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    n = noise(nt, scale, 12, 0.62)
    r = ramp(nt, [(0.0, (0, 0, 0)), (cover, (0, 0, 0)), (cover + 0.12, (1, 1, 1)), (1.0, (1, 1, 1))])
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = (0.95, 0.96, 1.0, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(r.outputs['Color'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(df.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def mat_atmosphere(name, strength=3.0):
    """A shell that glows blue-white only toward its limb (facing ramp)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    r = ramp(nt, [(0.0, (0, 0, 0)), (0.7, (0, 0, 0)), (0.9, (0.5, 0.5, 0.5)), (1.0, (1, 1, 1))])
    nt.links.new(lw.outputs['Facing'], r.inputs['Fac'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.45, 0.7, 1.0, 1)
    em.inputs['Strength'].default_value = strength
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(r.outputs['Color'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def mat_rubble(name):
    """The regolith radiation shield: lumpy grey-brown rock."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.95
    n = noise(nt, 18, 8, 0.7)
    r = ramp(nt, [(0.3, (0.28, 0.25, 0.22)), (0.55, (0.5, 0.46, 0.41)), (0.75, (0.66, 0.62, 0.55))])
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], b.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.9
    nt.links.new(n.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def obj(name):
    ob = bpy.context.active_object
    ob.name = name
    return ob


def torus(name, R, r, mat, loc=(0, 0, 0), rot=(0, 0, 0), seg=(128, 24)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot,
                                     major_segments=seg[0], minor_segments=seg[1])
    ob = obj(name)
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def cyl(name, r, depth, mat, loc=(0, 0, 0), rot=(0, 0, 0), verts=32, smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    ob = obj(name)
    ob.data.materials.append(mat)
    if smooth:
        bpy.ops.object.shade_smooth()
    return ob


def box(name, size, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = obj(name)
    ob.scale = size
    ob.data.materials.append(mat)
    return ob


def sphere(name, r, mat, loc=(0, 0, 0), seg=48):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2)
    ob = obj(name)
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def rock(name, r, mat, loc):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=1, location=loc)
    ob = obj(name)
    ob.data.materials.append(mat)
    return ob


def tube(name, pts, r, mat, res=3):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = res
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    ob = link(bpy.data.objects.new(name, cu))
    cu.materials.append(mat)
    return ob


def rod(name, a, b, r, mat):
    return tube(name, [a, b], r, mat, res=1)


def group(name, objs, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    root = link(bpy.data.objects.new(name, None))
    for o in objs:
        o.parent = root
    root.location, root.rotation_euler, root.scale = loc, rot, (scale,) * 3
    return root


def sun(direction, strength=4.0, color=(1.0, 0.95, 0.85), angle=1.0):
    l = bpy.data.lights.new('sun', 'SUN')
    l.energy, l.color = strength, color
    l.angle = math.radians(angle)
    o = link(bpy.data.objects.new('sun', l))
    o.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
    return o


def camera(loc, target, lens=24, shift=(0.0, 0.0), clip=4000):
    c = bpy.data.cameras.new('cam')
    c.lens = lens
    c.shift_x, c.shift_y = shift
    c.clip_start, c.clip_end = 0.05, clip
    o = link(bpy.data.objects.new('cam', c))
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o


# ---- shared hardware ---------------------------------------------------------

class Mats:
    def __init__(self):
        self.steel = principled('steel', (0.7, 0.72, 0.76), 0.3, 1.0)
        self.dark = principled('dark', (0.12, 0.13, 0.15), 0.5, 0.6)
        self.white = principled('white', (0.85, 0.86, 0.88), 0.45)
        self.gold = principled('gold', (0.85, 0.6, 0.2), 0.3, 1.0)
        self.copper = principled('copper', (0.85, 0.45, 0.22), 0.28, 1.0)
        self.rubble = mat_rubble('rubble')
        self.dirt = principled('dirt', (0.42, 0.36, 0.28), 0.9)
        self.pv = principled('pv', (0.03, 0.06, 0.2), 0.2, 0.3)
        self.window = glow('window', (1.0, 0.82, 0.45), 9.0)
        self.beacon = glow('beacon', (1.0, 0.25, 0.2), 20.0)
        self.blue = glow('blueglow', (0.35, 0.7, 1.0), 10.0)
        self.ribbon = principled('ribbon', (0.25, 0.26, 0.3), 0.35, 0.8)


def habitat(M, R=6.0, seed=1):
    """A Stanford torus behind a rubble shield: the rock-armoured wheel, a lit
    window band inside it, spokes to a hub, and a mass driver venting a stream
    of regolith (how a Bernal moves). Built flat in XY, axis on Z."""
    rnd = random.Random(seed)
    parts = [torus('hab.shield', R, R * 0.17, M.rubble)]
    # lumps of rubble packed on the outer rim
    for i in range(70):
        a = TAU * i / 70 + rnd.uniform(-0.03, 0.03)
        rr = R + R * 0.15 + rnd.uniform(-0.05, 0.08) * R
        z = rnd.uniform(-0.1, 0.1) * R
        parts.append(rock(f'hab.rock{i}', R * rnd.uniform(0.04, 0.07), M.rubble, (rr * math.cos(a), rr * math.sin(a), z)))
    # the inner window band
    for i in range(64):
        a = TAU * i / 64
        rr = R * 0.83
        parts.append(box(f'hab.win{i}', (R * 0.06, R * 0.02, R * 0.06), M.window,
                         (rr * math.cos(a), rr * math.sin(a), 0), (0, 0, a)))
    for i in range(6):
        a = TAU * i / 6
        parts.append(rod(f'hab.spoke{i}', (0, 0, 0), (R * 0.82 * math.cos(a), R * 0.82 * math.sin(a), 0), R * 0.035, M.steel))
    parts.append(sphere('hab.hub', R * 0.16, M.white))
    parts.append(cyl('hab.axle', R * 0.06, R * 0.8, M.steel))
    # docking lights
    for z in (-0.4, 0.4):
        parts.append(sphere(f'hab.beacon{z}', R * 0.025, M.beacon, (0, 0, z * R), 12))
    return parts


def mass_driver(M, origin, direction, length, seed=3, n=40):
    """A rail off the rim and the grey regolith stream it throws."""
    rnd = random.Random(seed)
    o, d = Vector(origin), Vector(direction).normalized()
    parts = [rod('md.rail', o, o + d * length, 0.12, M.steel),
             rod('md.coils', o + d * length * 0.2, o + d * length * 0.95, 0.2, M.copper)]
    side = d.orthogonal().normalized()
    up = d.cross(side).normalized()
    for i in range(n):
        t = length * (1.05 + i * 0.09 + rnd.uniform(0, 0.05))
        spread = 0.02 * t
        p = o + d * t + side * rnd.uniform(-spread, spread) + up * rnd.uniform(-spread, spread)
        parts.append(rock(f'md.dirt{i}', rnd.uniform(0.05, 0.13), M.dirt, p))
    return parts


# ---- GEO Elevator Bernal -----------------------------------------------------

def geo(lab=False):
    M = Mats()
    rnd = random.Random(11)
    # Earth far below, the ribbon falling into it at the equator.
    ER, EZ = 200.0, -285.0
    earth = sphere('earth', ER, mat_planet('earthmat', 0.022, 0.535), (0, 0, EZ), 128)
    earth.rotation_euler = (0.4, 0.2, 1.1)
    sphere('clouds', ER * 1.012, mat_clouds('cloudmat', 0.03), (0, 0, EZ), 128).rotation_euler = (1.0, 0.3, 0.2)
    sphere('atmo', ER * 1.02, mat_atmosphere('atmomat', 4.0), (0, 0, EZ), 128)
    top = EZ + ER
    # the ribbon: a flat band from Earth up past the camera
    box('ribbon', (0.08, 0.9, 140), M.ribbon, (0, 0, top + 70))
    # the elevator column near the station: a square truss dense with modules
    z0, z1, w = -26.0, 22.0, 1.1
    for sx in (-1, 1):
        for sy in (-1, 1):
            rod(f'tw.long{sx}{sy}', (sx * w, sy * w, z0), (sx * w, sy * w, z1), 0.09, M.steel)
    z = z0
    k = 0
    while z < z1:
        for (a, b) in (((-w, -w), (w, -w)), ((w, -w), (w, w)), ((w, w), (-w, w)), ((-w, w), (-w, -w))):
            rod(f'tw.ring{k}', (a[0], a[1], z), (b[0], b[1], z), 0.05, M.steel)
            rod(f'tw.x{k}', (a[0], a[1], z), (b[0], b[1], z + 1.6), 0.035, M.steel)
            k += 1
        z += 1.6
    # modules, tanks and lit windows clustered along the tower
    for i in range(26):
        zz = rnd.uniform(z0 + 2, z1 - 2)
        side = rnd.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        off = Vector((side[0], side[1], 0)) * (w + rnd.uniform(0.5, 1.1))
        if rnd.random() < 0.45:
            cyl(f'tw.tank{i}', rnd.uniform(0.4, 0.7), rnd.uniform(1.6, 3.2), M.white, (off.x, off.y, zz), verts=24)
        else:
            sx, sy = rnd.uniform(0.6, 1.2), rnd.uniform(0.6, 1.2)
            box(f'tw.mod{i}', (sx, sy, rnd.uniform(1.2, 2.6)), rnd.choice([M.white, M.dark, M.gold]), (off.x, off.y, zz))
            for j in range(3):
                box(f'tw.lit{i}_{j}', (0.12, 0.12, 0.25),
                    M.window, (off.x + side[0] * sx * 0.51, off.y + side[1] * sy * 0.51, zz - 0.5 + j * 0.5))
    # a hexagonal mesh antenna on a boom
    rod('boom', (-w, 0, 12), (-6.5, 3.5, 13), 0.12, M.steel)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=3.2, depth=0.08, location=(-8.5, 4.5, 13.4), rotation=(0.5, -0.7, 0.3))
    hexo = obj('hexpanel')
    hexo.data.materials.append(M.steel)
    wf = hexo.modifiers.new('wf', 'WIREFRAME')
    wf.thickness = 0.06
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=3.2, depth=0.04, location=(-8.5, 4.5, 13.4), rotation=(0.5, -0.7, 0.3))
    hexm = obj('hexmesh')
    hexm.data.materials.append(M.pv)
    # the climber riding the ribbon below the tower
    cz = -48.0
    box('climber', (1.4, 1.8, 2.2), M.white, (0, 0, cz))
    for j in range(4):
        box(f'climber.win{j}', (0.15, 0.3, 0.2), M.window, (0.71, -0.5 + j * 0.33, cz + 0.4))
    sphere('climber.beacon', 0.15, M.beacon, (0, 0, cz + 1.2), 12)
    # the habitat threaded on the column
    hab = habitat(M, R=9.0, seed=5)
    group('habitat', hab, (0, 0, 2.0), (0.0, 0.0, 0.3))
    mass_driver(M, (-7.0, -6.0, 2.0), (-0.6, -1, -0.5), 4.0, seed=7, n=28)
    if lab:
        # nanotube extrusion works at the hub: a spinneret drum spinning out
        # fresh ribbon, glowing ring of the furnace
        cyl('works.drum', 2.2, 2.4, M.dark, (0, 0, 7.5), verts=48)
        torus('works.furnace', 2.3, 0.18, M.blue, (0, 0, 8.3))
        torus('works.furnace2', 2.3, 0.12, M.blue, (0, 0, 6.7))
        for i in range(8):
            a = TAU * i / 8
            box(f'works.spool{i}', (0.6, 0.6, 1.2), M.gold, (3.0 * math.cos(a), 3.0 * math.sin(a), 7.5), (0, 0, a))
        # the catapult arm and a payload leaving its tip
        tip = Vector((-14.0, 9.0, 10.0))
        rod('cat.arm', (-1.5, 1.0, 5.0), tip, 0.35, M.steel)
        rod('cat.arm2', (-1.5, 1.0, 3.5), tip, 0.2, M.steel)
        sphere('cat.payload', 0.7, M.white, tuple(tip + Vector((-1.4, 0.8, 0.6))), 24)
        tube('cat.trail', [tip + Vector((-1.4, 0.8, 0.6)) + Vector((-1.4, 0.8, 0.6)) * t for t in (0.6, 3.0, 6.0)], 0.12, M.blue)
    sun((0.85, 0.3, 0.3), 5.0)
    sun((-0.4, -0.6, 0.6), 0.25, (0.6, 0.75, 1.0), angle=30)
    camera((11.0, -14.0, 25.0), (0.0, 0.0, -45.0), lens=20, shift=(-0.15, 0.0), clip=900)


# ---- L3 Lofstrom Loop --------------------------------------------------------

def lofstrom(lab=False):
    M = Mats()
    rnd = random.Random(23)
    R = 400.0
    C = Vector((0, 0, -R))
    sphere('planet', R, mat_planet('oceanmat', 0.012, 0.665, ocean_only=True), tuple(C), 256)
    sphere('clouds', R * 1.004, mat_clouds('cloudmat', 0.01, 0.6), tuple(C), 256).rotation_euler = (0.3, 0.7, 0.1)
    sphere('atmo', R * 1.012, mat_atmosphere('atmomat', 5.0), tuple(C), 256)

    def surf(theta, h, x=0.0):
        """A point h above the sea on the great circle in the YZ plane."""
        r = R + h
        return Vector((x, r * math.sin(theta), r * math.cos(theta) - R))

    # the sheath: up a ramp off the sea near the camera, then a long run at
    # altitude out past the horizon
    H = 14.0
    th0, th_up, th1 = -0.03, 0.03, 0.5
    pts = []
    n = 160
    for i in range(n + 1):
        t = th0 + (th1 - th0) * i / n
        h = H * min(1.0, max(0.0, (t - th0) / (th_up - th0))) ** 0.7
        pts.append(surf(t, h))
    _ARC[:] = [tuple(p) for p in pts]
    tube('sheath', pts, 0.35, M.steel, res=4)
    tube('sheath.glow', [p + Vector((0, 0, 0.36)) for p in pts], 0.06, M.blue, res=1)
    # stay cables fanning down to the water in a criss-cross lattice
    k = 0
    for i in range(6, n, 4):
        t = th0 + (th1 - th0) * i / n
        top = pts[i]
        if top.z - (math.sqrt(max(0.0, R * R - top.y * top.y)) - R) < 2.0:
            continue
        for sx in (-1, 1):
            for dt in (-0.012, 0.012):
                base = surf(t + dt, 0.0, sx * 7.0)
                rod(f'stay{k}', top, base, 0.09, M.steel)
                k += 1
    # little vehicles riding along the top of the arc
    for i, idx in enumerate((40, 58, 80, 110)):
        p = pts[idx] + Vector((0, 0, 0.7))
        box(f'veh{i}', (0.7, 2.0, 0.5), M.white, tuple(p), (-(th0 + (th1 - th0) * idx / n), 0, 0))
        sphere(f'veh{i}.lamp', 0.18, M.window, tuple(p + Vector((0, 1.1, 0))), 10)
    # the loop-end station on the sea in the foreground
    base = surf(th0, 0.0)
    cyl('dock.pad', 4.5, 0.8, M.white, tuple(base + Vector((0, -1.5, 0.2))), verts=48)
    box('dock.hall', (3.0, 4.0, 2.2), M.dark, tuple(base + Vector((-2.5, -2.0, 1.6))))
    for j in range(5):
        box(f'dock.win{j}', (0.12, 0.5, 0.35), M.window, tuple(base + Vector((-0.95, -3.6 + j * 0.8, 1.9))))
    cyl('dock.tower', 0.4, 6.0, M.steel, tuple(base + Vector((2.2, -3.5, 3.0))), verts=16)
    sphere('dock.beacon', 0.3, M.beacon, tuple(base + Vector((2.2, -3.5, 6.2))), 12)
    # the Bernal above the arc, tilted toward the camera
    hp = Vector((-16.0, 22.0, 36.0))
    hab = habitat(M, R=11.0, seed=9)
    group('habitat', hab, tuple(hp), (1.05, 0.0, 0.35))
    mass_driver(M, tuple(hp + Vector((6.5, -1.0, -2.0))), (1, 0.4, -0.5), 4.0, seed=4, n=30)
    if lab:
        # a small loop of its own round the station, glowing, and a cluster of
        # microgravity process modules on the hub
        torus('lab.loop', 17.0, 0.3, M.blue, tuple(hp), (1.05, 0.0, 0.35))
        for i in range(6):
            off = Vector((rnd.uniform(-2.5, 2.5), rnd.uniform(-1.5, 1.5), rnd.uniform(2.5, 5.0)))
            box(f'lab.mod{i}', (1.2, 1.0, 0.9), rnd.choice([M.white, M.gold]), tuple(hp + off))
            box(f'lab.mod{i}.win', (0.3, 0.05, 0.2), M.window, tuple(hp + off + Vector((0, -0.52, 0))))
    sun((-0.25, 0.85, 0.35), 4.0, angle=0.6)
    sun((0.5, -0.6, 0.6), 1.2, (0.8, 0.85, 1.0))
    camera((75.0, -10.0, 62.0), (-12.0, 95.0, -28.0), lens=22, shift=(-0.1, -0.17), clip=3000)


_ARC = []

SCENES = {
    'geo-front': lambda: geo(False),
    'geo-back': lambda: geo(True),
    'lofstrom-front': lambda: lofstrom(False),
    'lofstrom-back': lambda: lofstrom(True),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=64)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    keys = [k for k in SCENES if not a.only or k in a.only.split(',')]
    for k in keys:
        sc = reset(a.samples)
        SCENES[k]()
        if os.environ.get('HF_PROJ'):
            # Debug: where named objects land in the frame (x right, y DOWN, 0..1).
            from bpy_extras.object_utils import world_to_camera_view
            bpy.context.view_layer.update()
            for ob in sc.objects:
                if ob.name in ('habitat', 'sheath', 'climber', 'dock.pad', 'earth', 'planet'):
                    p = world_to_camera_view(sc, sc.camera, ob.matrix_world.translation)
                    print('PROJ', k, ob.name, round(p.x, 2), round(1 - p.y, 2))
            if k.startswith('lofstrom'):
                for i in range(0, 161, 20):
                    p = world_to_camera_view(sc, sc.camera, Vector(_ARC[i]))
                    print('PROJ', k, 'arc', i, round(p.x, 2), round(1 - p.y, 2), round(p.z, 1))
        sc.render.filepath = os.path.join(a.out, f'{k}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', k)


if __name__ == '__main__':
    main()
