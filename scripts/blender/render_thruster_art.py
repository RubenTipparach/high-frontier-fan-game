"""Blender proof of concept for thruster card art (scripted, headless).

Method from the blender-hard-surface skill (Star Crew -> Crab Breeze -> Fleet
Command): every model is built by this committed script from primitives and
lathed profiles, nothing hand-modelled, rendered with Cycles on the CPU (no GPU
needed). Renders with a transparent background; the card's space backdrop is
composited afterwards so Blender and vector art share one backdrop.

Run (Blender as a Python module, `pip install bpy`, Python 3.11):
    python scripts/blender/render_thruster_art.py --out DIR [--only a,b] [--samples 48]
"""
import argparse
import math
import os
import sys

import bpy  # must come before bmesh / mathutils with the pip module
import bmesh
from mathutils import Vector

W, H = 436, 418


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
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.06, 0.1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    sc.world = world
    return sc


def mat_metal(name, color, rough=0.28, metal=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    return m


def mat_glow(name, color, strength, alpha=1.0):
    """Emission, optionally see-through (a plasma plume)."""
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
    # Fade with view angle so a cone reads as a soft glowing jet.
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.6
    ramp = nt.nodes.new('ShaderNodeMath')
    ramp.operation = 'MULTIPLY'
    ramp.inputs[1].default_value = alpha
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    nt.links.new(lw.outputs['Facing'], inv.inputs[1])
    nt.links.new(inv.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    return m


def obj_from_bm(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def lathe(name, profile, mat, segs=72):
    """Sweep an (r, z) profile around the Z axis (the skill's `lathe`)."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in profile])
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for k in range(len(profile) - 1):
            bm.faces.new((r0[k], r1[k], r1[k + 1], r0[k + 1]))
    return obj_from_bm(name, bm, mat)


def torus(name, R, r, mat, z=0.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=(0, 0, z),
                                     major_segments=96, minor_segments=24)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def cyl(name, r, depth, mat, loc=(0, 0, 0), rot=(0, 0, 0), verts=64):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


def group(name, objs):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        o.parent = root
    return root


def area(name, loc, energy, size, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy, l.size, l.color = energy, size, color
    o = bpy.data.objects.new(name, l)
    o.location = loc
    bpy.context.collection.objects.link(o)
    d = Vector((0, 0, 0)) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o


def camera(loc, target=(0, 0, 0), lens=50):
    c = bpy.data.cameras.new('cam')
    c.lens = lens
    o = bpy.data.objects.new('cam', c)
    bpy.context.collection.objects.link(o)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o


def rig(key=(4, -4, 5), rim=(-5, 3, 2), keyE=900, rimE=600):
    area('key', key, keyE, 4, (1.0, 0.96, 0.9))
    area('rim', rim, rimE, 3, (0.6, 0.75, 1.0))


# ---- the subjects (Z up; nozzles fire toward -Z) ---------------------------

def de_laval():
    steel = mat_metal('steel', (0.72, 0.74, 0.78), 0.22)
    dark = mat_metal('dark', (0.18, 0.19, 0.22), 0.45)
    # chamber, throat, bell: one lathed profile (outer skin) with a lip
    prof = [(0.0, 2.2), (0.55, 2.2), (0.6, 2.1), (0.6, 1.4), (0.5, 1.1), (0.3, 0.85),
            (0.34, 0.5), (0.55, 0.0), (0.82, -0.6), (1.05, -1.3), (1.18, -1.9),
            (1.24, -2.2), (1.2, -2.2), (1.13, -1.9), (1.0, -1.3), (0.77, -0.6), (0.5, 0.0),
            (0.3, 0.5), (0.0, 0.5)]
    body = lathe('bell', prof, steel)
    rings = [torus(f'band{i}', 0.62 + 0.09 * i, 0.03, dark, 1.35 - i * 0.15) for i in range(3)]
    jet = lathe('jet', [(0.0, -2.2), (1.1, -2.2), (1.6, -5.2), (0.0, -5.2)],
                mat_glow('jet', (0.35, 0.6, 1.0), 2.5, 0.55))
    diamonds = [lathe(f'shock{i}', [(0, -2.6 - i * 0.8), (0.32 - i * 0.05, -2.9 - i * 0.8), (0, -3.2 - i * 0.8)],
                      mat_glow(f'shk{i}', (0.85, 0.92, 1), 6 - i * 1.5)) for i in range(3)]
    group('ENGINE_de_laval', [body, jet, *rings, *diamonds]).rotation_euler = (math.radians(-18), 0, 0)
    camera((5.4, -6.6, 1.6), (0, 0, -0.6), 40)
    rig()


def hall():
    steel = mat_metal('steel', (0.55, 0.58, 0.64), 0.3)
    pole = mat_metal('pole', (0.32, 0.33, 0.37), 0.4)
    body = lathe('body', [(0, -0.5), (1.6, -0.5), (1.7, -0.4), (1.7, 0.25), (1.55, 0.3),
                          (1.2, 0.3), (1.2, 0.05), (0.75, 0.05), (0.75, 0.3), (0.0, 0.3)], steel)
    channel = torus('discharge', 0.975, 0.2, mat_glow('plasma', (0.3, 0.5, 1.0), 9), 0.08)
    halo = torus('halo', 0.975, 0.36, mat_glow('halo', (0.2, 0.4, 1.0), 1.5, 0.35), 0.16)
    cap = cyl('pole_cap', 0.55, 0.08, pole, (0, 0, 0.33))
    cath = cyl('cathode', 0.13, 1.2, pole, (2.0, 0, 0.0), (0, 0, 0))
    tip = cyl('cathode_tip', 0.09, 0.05, mat_glow('tip', (0.6, 0.8, 1), 10), (2.0, 0, 0.62))
    group('ENGINE_hall', [body, channel, halo, cap, cath, tip]).rotation_euler = (math.radians(62), 0, math.radians(18))
    camera((0.6, -5.6, 1.4), (0, 0, 0), 45)
    rig((3, -5, 4), (-4, 2, -2), 700, 400)


def ion():
    shell = mat_metal('shell', (0.7, 0.72, 0.76), 0.25)
    grid_m = mat_metal('grid', (0.85, 0.66, 0.38), 0.3)
    body = lathe('shell', [(0, 1.6), (0.9, 1.6), (1.25, 1.0), (1.25, 0.05), (1.32, 0.0), (0.0, 0.0)], shell)
    # dished grid: a thin disc with a hex pattern of holes as small dark studs
    grid = lathe('grid', [(0, -0.02), (1.22, 0.0), (1.22, 0.04), (0, 0.02)], grid_m)
    holes = []
    dark = mat_glow('hole', (0.4, 0.75, 1.0), 6)
    step = 0.17
    for iy in range(-7, 8):
        for ix in range(-7, 8):
            x = (ix + (iy % 2) * 0.5) * step
            y = iy * step * 0.866
            if x * x + y * y < 1.05 ** 2:
                holes.append(cyl(f'h{ix}_{iy}', 0.055, 0.03, dark, (x, y, -0.03), verts=12))
    beam = lathe('beam', [(0.0, -0.05), (1.15, -0.05), (1.6, -5.0), (0.0, -5.0)],
                 mat_glow('beam', (0.2, 0.6, 1.0), 2.2, 0.5))
    group('ENGINE_ion', [body, grid, beam, *holes]).rotation_euler = (math.radians(-60), 0, math.radians(-30))
    camera((3.2, -5.4, 1.8), (0.4, 0, -0.6), 42)
    rig()


def mag_nozzle():
    cu = mat_metal('copper', (0.85, 0.45, 0.22), 0.25)
    frame = mat_metal('frame', (0.3, 0.32, 0.36), 0.4)
    coils = [torus(f'coil{i}', 0.55 + i * 0.32, 0.12, cu, 1.6 - i * 0.55) for i in range(5)]
    spars = []
    for k in range(4):
        a = k * math.pi / 2
        spars.append(cyl(f'spar{k}', 0.035, 3.2, frame,
                         (math.cos(a) * 1.25, math.sin(a) * 1.25, 0.2),
                         (math.radians(-17) * math.sin(a), math.radians(17) * math.cos(a), 0), 12))
    plasma = lathe('plasma', [(0.0, 2.2), (0.18, 2.2), (0.5, 0.6), (1.2, -1.4), (2.0, -3.4), (0.0, -3.4)],
                   mat_glow('plasma', (0.6, 0.3, 1.0), 2.5, 0.5))
    core = lathe('core', [(0.0, 2.2), (0.08, 2.2), (0.18, 0.4), (0.0, -1.5)], mat_glow('core', (1, 0.8, 1), 8))
    group('ENGINE_mag', [*coils, *spars, plasma, core]).rotation_euler = (math.radians(-20), 0, 0)
    camera((5.6, -6.2, 2.4), (0, 0, -0.3), 40)
    rig()


SUBJECTS = {
    'thr_de_laval_nozzle-front': de_laval,
    'thr_hall_effect-front': hall,
    'thr_hall_effect-back': ion,
    'thr_de_laval_nozzle-back': mag_nozzle,
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
        print('rendered', key)


if __name__ == '__main__':
    main()
