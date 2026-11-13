"""Blender thruster card art (scripted, headless): all 24 thruster faces.

Method from the blender-hard-surface skill (Star Crew -> Crab Breeze -> Fleet
Command): every model is built by this committed script from primitives,
lathed profiles (full, or a partial sweep for a cutaway), tori, rods and
curve tubes - nothing hand-modelled - and rendered with Cycles on the CPU (no
GPU needed). Renders on a transparent film; the card's space backdrop is
composited afterwards (--backdrop) so Blender and vector art share a look.

Each face draws its OWN technology: the black back of a thruster card is a
different engine, so it is a different scene.

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


# ---- the 24 faces (Z up; most engines fire toward -Z) ----------------------

def ablative_plate():
    """A laser from far away strikes a pusher plate; vapour jets back."""
    plate = cyl('pusher_plate', 1.5, 0.12, steel('plate', (0.8, 0.82, 0.86), 0.35))
    scorch = cyl('scorch', 0.55, 0.02, mat_glow('hot', (1.0, 0.45, 0.1), 12), (0, 0, -0.07))
    struts = [rod(f'strut{k}', (math.cos(k * TAU / 4) * 1.2, math.sin(k * TAU / 4) * 1.2, 0.05),
                  (0, 0, 1.4), 0.04, steel('strut', (0.5, 0.52, 0.56))) for k in range(4)]
    pod = lathe('payload', [(0, 2.2), (0.35, 2.1), (0.42, 1.5), (0.42, 1.3), (0, 1.3)], steel('pod', (0.9, 0.9, 0.92), 0.3))
    vapour = lathe('vapour', [(0.0, -0.08), (0.5, -0.08), (1.4, -1.6), (0.0, -1.6)], mat_glow('vapour', (1.0, 0.55, 0.2), 3, 0.5))
    beam = rod('laser', (0, 0, -0.1), (0, 0, -9), 0.06, mat_glow('laser', (1.0, 0.1, 0.08), 25))
    beam_glow = rod('laser_glow', (0, 0, -0.1), (0, 0, -9), 0.2, mat_glow('lg', (1.0, 0.1, 0.1), 3, 0.4))
    group('ENGINE_ablative_plate', [plate, scorch, *struts, pod, vapour, beam, beam_glow], (0, 0, 0.4), (math.radians(35), 0, math.radians(-25)))
    camera((5.8, -6.6, 1.6), (0, 0, 0.2), 38)
    rig()


def ablative_nozzle():
    """A charred ablative-lined nozzle firing a long flame sideways."""
    char = mat_metal('char', (0.16, 0.1, 0.07), 0.85, 0.0)
    liner = mat_metal('liner', (0.32, 0.2, 0.12), 0.75, 0.0)
    shell = steel('case', (0.55, 0.56, 0.6), 0.35)
    body = cyl('case', 0.9, 2.4, shell, (0, 0, 1.6))
    nozzle = lathe('nozzle', bell_profile(0.9, 0.38, 1.35, 0.4, 2.4, 0.18), char)
    bands = [torus(f'band{i}', 0.62 + i * 0.2, 0.05, liner, (0, 0, -0.3 - i * 0.55)) for i in range(4)]
    flame = lathe('flame', [(0.0, -1.5), (0.95, -1.5), (1.7, -6.5), (0.0, -6.5)], mat_glow('flame', (1.0, 0.5, 0.12), 4, 0.6))
    core = lathe('core', [(0.0, -0.6), (0.4, -1.4), (0.5, -4.0), (0.0, -5.0)], mat_glow('core', (1.0, 0.85, 0.5), 10))
    group('ENGINE_ablative', [body, nozzle, *bands, flame, core], (-0.8, 0, 0), (0, math.radians(-100), math.radians(10)))
    camera((1.2, -8.4, 1.6), (0.6, 0, 0), 36)
    rig((2, -5, 5), (-4, 3, -1))


def de_laval():
    body = lathe('bell', bell_profile(), steel())
    dark = steel('band', (0.18, 0.19, 0.22), 0.45)
    rings = [torus(f'band{i}', 0.62 + 0.04 * i, 0.03, dark, (0, 0, 1.6 - i * 0.18)) for i in range(3)]
    pump = cyl('turbopump', 0.22, 0.9, steel('tp', (0.6, 0.62, 0.66)), (0.75, 0, 1.6))
    duct = tube('feed', [(0.75, 0, 1.15), (0.75, 0, 0.9), (0.55, 0, 0.95)], 0.08, dark)
    jet = lathe('jet', [(0.0, -1.35), (1.1, -1.35), (1.6, -5.2), (0.0, -5.2)], mat_glow('jet', (0.35, 0.6, 1.0), 2.5, 0.55))
    shocks = [lathe(f'shock{i}', [(0, -1.8 - i * 0.8), (0.32 - i * 0.05, -2.1 - i * 0.8), (0, -2.4 - i * 0.8)],
                    mat_glow(f'shk{i}', (0.85, 0.92, 1), 6 - i * 1.5)) for i in range(3)]
    group('ENGINE_de_laval', [body, *rings, pump, duct, jet, *shocks], rot=(math.radians(-18), 0, 0))
    camera((5.4, -6.6, 1.6), (0, 0, -0.6), 40)
    rig()


def mag_nozzle():
    cu = copper()
    frame = steel('frame', (0.3, 0.32, 0.36), 0.4)
    coils = [torus(f'coil{i}', 0.55 + i * 0.32, 0.12, cu, (0, 0, 1.6 - i * 0.55)) for i in range(5)]
    spars = [rod(f'spar{k}', (math.cos(k * TAU / 4) * 0.6, math.sin(k * TAU / 4) * 0.6, 1.7),
                 (math.cos(k * TAU / 4) * 1.85, math.sin(k * TAU / 4) * 1.85, -0.6), 0.035, frame) for k in range(4)]
    plasma = lathe('plasma', [(0.0, 2.2), (0.18, 2.2), (0.5, 0.6), (1.2, -1.4), (2.0, -3.4), (0.0, -3.4)],
                   mat_glow('plasma', (0.6, 0.3, 1.0), 2.5, 0.5))
    core = lathe('core', [(0.0, 2.2), (0.08, 2.2), (0.18, 0.4), (0.0, -1.5)], mat_glow('core', (1, 0.8, 1), 8))
    group('ENGINE_mag', [*coils, *spars, plasma, core], rot=(math.radians(-20), 0, 0))
    camera((5.6, -6.2, 2.4), (0, 0, -0.3), 40)
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
    group('ENGINE_dumbo', [vessel, *disks, channel, bell, jet], rot=(math.radians(-12), 0, math.radians(20)))
    camera((5.2, -6.4, 2.6), (0, 0, 0.0), 40)
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
    group('ENGINE_timberwind', [can, *beads, core, bell, jet], rot=(math.radians(-14), 0, math.radians(15)))
    camera((5.4, -6.4, 2.6), (0, 0, 0.1), 40)
    rig()


def hall():
    """Hall thruster in three-quarter view: body, glowing annular channel,
    hollow cathode on top, wide plume."""
    body_m = steel('body', (0.6, 0.63, 0.68), 0.3)
    pole = steel('pole', (0.32, 0.33, 0.37), 0.4)
    body = lathe('body', [(0, -0.6), (1.6, -0.6), (1.7, -0.5), (1.7, 0.25), (1.55, 0.3),
                          (1.2, 0.3), (1.2, 0.05), (0.75, 0.05), (0.75, 0.3), (0.0, 0.3)], body_m)
    coils = [cyl(f'outer_coil{k}', 0.16, 0.7, copper(), (math.cos(k * TAU / 4 + 0.78) * 1.85, math.sin(k * TAU / 4 + 0.78) * 1.85, -0.2)) for k in range(4)]
    channel = torus('discharge', 0.975, 0.2, mat_glow('plasma', (0.3, 0.5, 1.0), 9), (0, 0, 0.08))
    cap = cyl('pole_cap', 0.55, 0.08, pole, (0, 0, 0.33))
    cath = cyl('cathode', 0.13, 1.4, pole, (0, 2.05, 0.4), (math.radians(-90 + 25), 0, 0))
    tip = sphere('cathode_tip', 0.1, mat_glow('tip', (0.6, 0.8, 1), 10), (0, 1.75, 1.0))
    plume = lathe('plume', [(0.7, 0.3), (1.3, 0.3), (3.0, 5.5), (0.0, 5.5), (0.0, 2.0)], mat_glow('plume', (0.35, 0.45, 1.0), 2.2, 0.45))
    group('ENGINE_hall', [body, *coils, channel, cap, cath, tip, plume], (-0.6, 0, 0), (math.radians(80), 0, math.radians(-62)))
    camera((1.0, -7.4, 1.4), (0.3, 0, 0), 38)
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
    group('ENGINE_ion', [body, grid, beam, *holes], rot=(math.radians(-60), 0, math.radians(-30)))
    camera((3.2, -5.4, 1.8), (0.4, 0, -0.6), 42)
    rig()


def mass_driver():
    """An electromagnetic track on an asteroid flinging slugs of its own rock."""
    rock = asteroid('asteroid', 4.0, mat_metal('rock', (0.36, 0.32, 0.28), 0.85, 0.0), (0, 0, -4.2), 3.0, 0.22)
    rail_m = steel('rail', (0.55, 0.57, 0.62), 0.35)
    coil_m = mat_metal('coil', (0.95, 0.6, 0.2), 0.3)
    a, b = Vector((-3.2, -0.6, -0.2)), Vector((3.6, 1.0, 2.6))
    rails = [rod(f'rail{k}', a + Vector((0, 0, k * 0.18)), b + Vector((0, 0, k * 0.18)), 0.05, rail_m) for k in range(2)]
    d = (b - a).normalized()
    rot = d.to_track_quat('Z', 'Y').to_euler()
    coils = [torus(f'bucket_coil{i}', 0.28, 0.05, coil_m, tuple(a + (b - a) * (i / 13) + Vector((0, 0, 0.1))), rot) for i in range(14)]
    pylons = [rod(f'pylon{i}', tuple(a + (b - a) * (i / 4)), tuple(a + (b - a) * (i / 4) - Vector((0, 0, 1.6 + i * 0.4))), 0.06, rail_m) for i in range(1, 5)]
    slug_m = mat_glow('slug', (1.0, 0.85, 0.55), 6)
    slugs = [sphere(f'slug{i}', 0.11 - i * 0.012, slug_m, tuple(b + d * (0.6 + i * 0.7) + Vector((0, 0, 0.1))), 16) for i in range(5)]
    camera((1.0, -9.0, 2.6), (0.4, 0, 0.8), 34)
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
    group('ENGINE_mpd', [anode, cathode, *arcs, coil, jet, *waves], rot=(math.radians(-25), 0, math.radians(10)))
    camera((5.4, -6.0, 2.2), (0, 0, -0.5), 40)
    rig()


def metastable_helium():
    """A frosted cryogenic dewar of excited helium over a small engine."""
    tank = sphere('dewar', 1.4, mat_metal('frost', (0.92, 0.94, 0.97), 0.55, 0.2), (0, 0, 1.3), 64)
    collar = torus('collar', 1.42, 0.06, steel('collar', (0.6, 0.62, 0.66)), (0, 0, 1.3))
    legs = [rod(f'leg{k}', (math.cos(k * TAU / 3) * 1.1, math.sin(k * TAU / 3) * 1.1, 0.4), (0, 0, -0.4), 0.05, steel('leg', (0.5, 0.52, 0.56))) for k in range(3)]
    bell = lathe('bell', bell_profile(0.35, 0.16, 0.6, -0.1, 1.1), steel('bell'))
    jet = lathe('jet', [(0.0, -1.4), (0.55, -1.4), (1.0, -4.5), (0.0, -4.5)], mat_glow('jet', (1.0, 0.85, 0.3), 2.5, 0.5))
    orbit_m = mat_glow('orbit', (1.0, 0.8, 0.2), 6)
    orbits = [torus('orbit_a', 1.75, 0.02, orbit_m, (0, 0, 1.3), (math.radians(70), 0, 0)),
              torus('orbit_b', 2.0, 0.02, orbit_m, (0, 0, 1.3), (math.radians(70), math.radians(50), 0))]
    excited = sphere('electron', 0.12, mat_glow('e', (1.0, 0.9, 0.4), 16), (1.9, -0.3, 1.9))
    group('ENGINE_he', [tank, collar, *legs, bell, jet, *orbits, excited], rot=(math.radians(-8), 0, 0))
    camera((5.0, -6.4, 2.6), (0, 0, 0.5), 40)
    rig()


def microfission():
    """Pulse chamber: lithium-6 pellets fed in and flashed one after another."""
    chamber = lathe('chamber', [(0.0, 2.2), (1.3, 2.2), (1.35, 1.0), (1.0, 0.0), (0.45, -0.3), (0.5, -0.4), (1.1, -0.1), (1.5, 1.0), (1.45, 2.3), (0.0, 2.3)],
                    steel('chamber', (0.5, 0.52, 0.56), 0.35), sweep=TAU * 0.72, start=-0.9)
    pellet_m = mat_metal('li6', (0.5, 0.95, 0.75), 0.2, 0.3)
    pellets = [sphere(f'pellet{i}', 0.1, pellet_m, (0.0, 0.0, 2.0 - i * 0.32), 16) for i in range(4)]
    flash = sphere('flash', 0.42, mat_glow('flash', (1.0, 0.85, 0.5), 18), (0, 0, 0.75))
    bursts = [sphere(f'burst{i}', 0.55 - i * 0.1, mat_glow(f'bu{i}', (1.0, 0.45 - i * 0.08, 0.1), 6 - i * 1.2, 0.6), (0, 0, -1.0 - i * 0.9)) for i in range(4)]
    group('ENGINE_microfission', [chamber, *pellets, flash, *bursts], rot=(math.radians(-15), 0, math.radians(18)))
    camera((5.2, -6.2, 2.4), (0, 0, 0.0), 40)
    rig()


def plug_nozzle():
    """Aerospike: the exhaust hugs a central plug instead of a bell."""
    chamber = lathe('combustor', [(0.0, 1.2), (1.4, 1.2), (1.5, 1.0), (1.5, 0.3), (1.3, 0.2), (0.0, 0.2)], steel('combustor', (0.6, 0.62, 0.66)))
    spike = lathe('spike', [(1.1, 0.2), (0.9, -0.6), (0.65, -1.5), (0.4, -2.4), (0.18, -3.1), (0.0, -3.3)], steel('spike', (0.75, 0.77, 0.82), 0.2))
    throat = torus('throat_ring', 1.25, 0.06, mat_glow('throat', (1.0, 0.55, 0.2), 10), (0, 0, 0.18))
    sheath = lathe('sheath', [(1.32, 0.15), (1.05, -0.6), (0.8, -1.5), (0.6, -2.4), (0.45, -3.4), (0.6, -4.6), (0.0, -4.6), (0.0, -3.3), (0.18, -3.1), (0.4, -2.4), (0.65, -1.5), (0.9, -0.6), (1.12, 0.15)],
                   mat_glow('sheath', (1.0, 0.55, 0.2), 3, 0.55))
    group('ENGINE_aerospike', [chamber, spike, throat, sheath], rot=(math.radians(-22), 0, 0))
    camera((5.4, -6.4, 1.8), (0, 0, -0.9), 40)
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
    group('ENGINE_vortex', [wall, swirl, core, jet], rot=(math.radians(-12), 0, math.radians(20)))
    camera((5.2, -6.4, 2.6), (0, 0, 0.2), 40)
    rig()


def heliogyro():
    """Long ribbon blades spun out from a hub, riding sunlight."""
    film = mat_metal('film', (0.95, 0.9, 0.75), 0.15, 1.0)
    hub = cyl('hub', 0.35, 0.3, steel('hub', (0.4, 0.42, 0.46)))
    blades = []
    for k in range(10):
        a = k * TAU / 10
        blades.append(box(f'blade{k}', (6.0, 0.32, 0.01), film, (math.cos(a) * 3.2, math.sin(a) * 3.2, 0), (0.12, 0, a)))
    root = group('ENGINE_heliogyro', [hub, *blades], rot=(math.radians(58), 0, math.radians(12)))
    camera((0, -11.5, 2.0), (0, 0, 0), 32)
    sun((-0.6, 1.0, -0.8), 5.0)
    area('fill', (-4, -6, -2), 300, 6, (0.5, 0.6, 1.0))
    sphere('sun_disc', 0.9, mat_glow('sundisc', (1.0, 0.85, 0.5), 30), (5.5, 6.0, 4.2))


def electric_sail():
    """A hub trailing long charged tethers that push on the solar wind."""
    hub = box('hub', (0.6, 0.6, 0.6), steel('hub', (0.65, 0.67, 0.72)))
    panels = [box(f'panel{s}', (1.1, 0.5, 0.03), mat_metal('pv', (0.08, 0.12, 0.35), 0.2, 0.6), (s * 0.95, 0, 0)) for s in (-1, 1)]
    wire_m = mat_glow('wire', (0.75, 0.88, 1.0), 6)
    sheath_m = mat_glow('sheath', (0.3, 0.55, 1.0), 1.2, 0.35)
    wires = []
    for k in range(16):
        a = k * TAU / 16
        end = (math.cos(a) * 12, math.sin(a) * 12, 0)
        wires += [rod(f'tether{k}', (0, 0, 0), end, 0.012, wire_m), rod(f'sheath{k}', (0, 0, 0), end, 0.12, sheath_m)]
    group('ENGINE_esail', [hub, *panels, *wires], rot=(math.radians(62), 0, math.radians(8)))
    wind_m = mat_glow('wind', (1.0, 0.85, 0.5), 4)
    for i in range(14):
        y = -3 + (i * 0.73) % 6
        z = -2.5 + (i * 1.37) % 5
        rod(f'wind{i}', (-7 + (i % 5), y, z), (-6.2 + (i % 5), y, z), 0.02, wind_m)
    camera((0, -10, 1.5), (0, 0, 0), 30)
    rig((3, -6, 5), (-5, 4, 2), 600, 300)


def kite_sail():
    """A square reflective sail bellied by sunlight on four diagonal booms."""
    bm = bmesh.new()
    n, s = 24, 2.6
    vs = {}
    for i in range(n + 1):
        for j in range(n + 1):
            x, y = (i / n * 2 - 1) * s, (j / n * 2 - 1) * s
            # a diamond (square rotated 45deg) with a gentle billow
            u, v = (x + y) / 2, (x - y) / 2
            sag = 0.45 * (1 - (abs(u) / s) ** 2) * (1 - (abs(v) / s) ** 2)
            vs[i, j] = bm.verts.new((u * 1.4, v * 1.4, sag))
    for i in range(n):
        for j in range(n):
            bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
    sail = obj_from_bm('sail', bm, mat_metal('film', (0.92, 0.9, 0.82), 0.12, 1.0))
    boom_m = steel('boom', (0.35, 0.36, 0.4), 0.4)
    booms = [rod(f'boom{k}', (0, 0, 0.05), (math.cos(k * TAU / 4) * 3.7, math.sin(k * TAU / 4) * 3.7, 0.05), 0.03, boom_m) for k in range(4)]
    bus = box('bus', (0.4, 0.4, 0.3), steel('bus', (0.6, 0.62, 0.66)), (0, 0, -0.1))
    group('ENGINE_kite', [sail, *booms, bus], rot=(math.radians(55), 0, math.radians(15)))
    camera((0, -10, 2.2), (0, 0, 0), 36)
    sun((-1.0, 0.8, -0.6), 5.0)
    area('fill', (3, -6, -2), 250, 6, (0.5, 0.6, 1.0))
    sphere('sun_disc', 0.9, mat_glow('sundisc', (1.0, 0.85, 0.5), 30), (-6.0, 6.0, 4.5))


def mag_sail():
    """A huge superconducting loop whose magnetic bubble deflects the wind."""
    loop = torus('sc_loop', 3.0, 0.07, mat_glow('loop', (0.7, 0.75, 1.0), 6), rot=(math.radians(90), 0, 0))
    shell = sphere('magnetosphere', 3.8, mat_glow('bubble', (0.35, 0.4, 1.0), 1.0, 0.25), (0, 0, 0), 64)
    shell.scale = (1.15, 1.0, 0.95)
    payload = box('payload', (0.35, 0.35, 0.35), steel('payload', (0.6, 0.62, 0.66)), (0, -3.2, 0))
    line_m = steel('line', (0.6, 0.62, 0.66))
    lines = [rod(f'shroud{k}', (3.0 * math.cos(k * TAU / 4), 0, 3.0 * math.sin(k * TAU / 4)), (0, -3.2, 0), 0.01, line_m) for k in range(4)]
    group('ENGINE_magsail', [loop, shell, payload, *lines], rot=(0, 0, math.radians(30)))
    wind_m = mat_glow('wind', (1.0, 0.85, 0.5), 3)
    for i in range(9):
        z = -4 + i
        bend = 1.0 if abs(z) < 4 else 0
        tube(f'flow{i}', [(-9, 3, z), (-4.5, 1.5, z * (1 + 0.4 * bend)), (0, 0, z * (1 + 0.8 * bend) + (0.4 if z >= 0 else -0.4)), (6, -2, z * 1.2)], 0.02, wind_m)
    camera((2.0, -12.0, 1.0), (0, 0, 0), 34)
    rig((4, -6, 4), (-5, 2, 3), 500, 300)


def vasimr():
    """A long magnetic bottle in stages, the plasma heating violet to white."""
    tube_m = mat_metal('quartz', (0.7, 0.75, 0.85), 0.1, 0.0)
    liner = cyl('liner', 0.55, 5.0, tube_m, (0, 0, 0.5))
    liner.data.materials[0] = mat_glow('liner_glow', (0.6, 0.35, 1.0), 0.6, 0.3)
    stage_cols = [(0.6, 0.4, 1.0), (0.95, 0.4, 0.75), (0.9, 0.9, 0.95)]
    coils = []
    for i in range(9):
        z = 2.6 - i * 0.55
        st = 0 if i < 3 else (1 if i < 7 else 2)
        coils.append(torus(f'coil{i}', 0.85 + (0.25 * (i - 6) if i > 6 else 0), 0.12,
                           copper() if st < 2 else steel('sc', (0.8, 0.82, 0.86)), (0, 0, z)))
    antenna = tube('helicon_antenna', [(0.7 * math.cos(a / 10 * TAU), 0.7 * math.sin(a / 10 * TAU), 2.2 - a * 0.06) for a in range(21)], 0.04, mat_glow('ant', (1.0, 0.6, 0.9), 6))
    plasma = lathe('plasma', [(0.0, 3.0), (0.25, 3.0), (0.4, 0.0), (0.5, -1.6), (1.6, -3.4), (2.4, -5.0), (0.0, -5.0)], mat_glow('pl', (0.8, 0.5, 1.0), 2.6, 0.55))
    core = lathe('core', [(0.0, 2.6), (0.1, 2.6), (0.22, -1.0), (0.0, -2.6)], mat_glow('core', (1.0, 0.92, 1.0), 9))
    group('ENGINE_vasimr', [liner, *coils, antenna, plasma, core], (0, 0, 0.4), (math.radians(-70), 0, math.radians(-70)))
    camera((1.0, -8.4, 1.8), (0, 0, 0.2), 36)
    rig()


def plasmoid():
    """A conical theta-pinch coil firing self-contained plasma rings."""
    coil_m = copper()
    cone = lathe('cone', [(0.5, 1.8), (0.55, 1.8), (1.25, -0.4), (1.2, -0.4)], steel('cone', (0.45, 0.47, 0.52), 0.35))
    turns = [torus(f'turn{i}', 0.6 + i * 0.1, 0.06, coil_m, (0, 0, 1.6 - i * 0.3)) for i in range(7)]
    ring_m = [mat_glow(f'pl{i}', (0.5, 0.95, 1.0), 9 - i * 2) for i in range(4)]
    rings = [torus(f'plasmoid{i}', 0.85 - i * 0.08, 0.16 - i * 0.025, ring_m[i], (0, 0, -1.2 - i * 1.15)) for i in range(4)]
    halos = [torus(f'halo{i}', 0.85 - i * 0.08, 0.35, mat_glow(f'h{i}', (0.3, 0.8, 1.0), 1.2, 0.3), (0, 0, -1.2 - i * 1.15)) for i in range(2)]
    group('ENGINE_plasmoid', [cone, *turns, *rings, *halos], (0.2, 0, 0.4), (math.radians(-68), 0, math.radians(-62)))
    camera((1.0, -8.4, 1.6), (0, 0, 0), 36)
    rig()


def pulsed_inductive():
    """A flat spiral coil; the induced current sheet flashes off its face."""
    base = cyl('base', 2.3, 0.25, steel('base', (0.2, 0.21, 0.24), 0.5), (0, 0, -0.15))
    pts = []
    for i in range(400):
        t = i / 399 * 9 * TAU
        r = 0.2 + t / (9 * TAU) * 2.0
        pts.append((r * math.cos(t), r * math.sin(t), 0.02))
    spiral = tube('spiral_coil', pts, 0.045, copper())
    sheet = cyl('current_sheet', 2.2, 0.08, mat_glow('sheet', (1.0, 0.55, 0.85), 5, 0.6), (0, 0, 0.5))
    sheet2 = cyl('sheet_far', 2.05, 0.05, mat_glow('sheet2', (0.9, 0.4, 0.8), 2, 0.4), (0, 0, 1.35))
    arc_m = mat_glow('arc', (1.0, 0.85, 1.0), 12)
    arcs = [tube(f'arc{k}', [(2.1 * math.cos(k), 2.1 * math.sin(k), 0.05), (2.0 * math.cos(k + 0.1), 2.0 * math.sin(k + 0.1), 0.25), (2.15 * math.cos(k + 0.05), 2.15 * math.sin(k + 0.05), 0.48)], 0.015, arc_m) for k in range(0, 6)]
    group('ENGINE_pit', [base, spiral, sheet, sheet2, *arcs], rot=(math.radians(-8), 0, 0))
    camera((0.0, -6.8, 3.6), (0, 0, 0.3), 36)
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
    group('ENGINE_ds4g', [src, *grids, *spacers, plasma, beam, core], (-0.4, 0, 0.2), (math.radians(-72), 0, math.radians(-60)))
    camera((1.0, -8.0, 1.8), (0.2, 0, 0), 36)
    rig()


def solar_moth():
    """Two parabolic mirror wings focus sunlight onto a rhenium absorber."""
    mirror = mat_metal('mirror', (0.96, 0.92, 0.8), 0.06, 1.0)
    prof = [(r, 0.12 * r * r) for r in [0.2 + i * 0.25 for i in range(13)]]
    wings = []
    for s in (-1, 1):
        w = lathe(f'wing{s}', prof, mirror, segs=40, sweep=math.radians(110), start=math.radians(-55))
        w.location = (s * 2.6, 0, 0)
        w.rotation_euler = (0, math.radians(-s * 70), math.radians(180 if s < 0 else 0))
        wings.append(w)
    struts = [rod(f'strut{s}', (0, 0, 0), (s * 2.0, 0, 0.3), 0.05, steel('st', (0.4, 0.42, 0.46))) for s in (-1, 1)]
    absorber = sphere('absorber', 0.3, mat_glow('re', (1.0, 0.6, 0.25), 14), (0, 0, 0))
    body = cyl('body', 0.22, 1.0, steel('bd', (0.45, 0.43, 0.42)), (0, 0, -0.6))
    bell = lathe('bell', [(0.12, -1.1), (0.3, -1.5), (0.42, -1.8), (0.38, -1.8), (0.26, -1.5), (0.08, -1.1)], steel('bl'))
    jet = lathe('jet', [(0.0, -1.8), (0.38, -1.8), (0.7, -4.0), (0.0, -4.0)], mat_glow('jet', (1.0, 0.75, 0.5), 2.0, 0.5))
    beams = [rod(f'ray{i}', (s * 4.6, -1.0 + i, 2.6), (0, 0, 0), 0.015, mat_glow('ray', (1.0, 0.9, 0.6), 3, 0.5)) for s in (-1, 1) for i in range(3)]
    group('ENGINE_solar_moth', [*wings, *struts, absorber, body, bell, jet, *beams], (0, 0, 0.6), (math.radians(-12), 0, 0))
    camera((0.0, -10.5, 2.4), (0, 0, 0.3), 36)
    sun((0.2, 0.6, -1.0), 3.5)
    area('fill', (-4, -6, 2), 300, 6, (0.6, 0.7, 1.0))


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
    group('ENGINE_hb_fusion', [ring, beam_a, beam_b, *spokes, flash, halo, nozzle, jet, *alphas], (0, 0, 0.5), (math.radians(-28), 0, 0))
    camera((4.0, -8.0, 3.0), (0, 0, -0.2), 38)
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
