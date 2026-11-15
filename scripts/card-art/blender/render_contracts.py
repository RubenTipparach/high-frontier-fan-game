"""Blender card art (scripted, headless): Module 4 contract destinations.

Every contract face shows where it sends you: a planet, a moon, an asteroid,
a comet, the Sun or a station (user 2026-11-15: "use blender to render
planets, asteroids and comets, you have the shaders already"). Built on the
same kit as the Bernal renders (render_bernal_megastructures.py: the noise /
ramp materials, mat_planet + mat_clouds + mat_atmosphere, mat_rubble, the
habitat, sun and camera helpers), Cycles on the CPU, transparent film. The
subject sits low and right: the destination box covers the card's top-left
and the ability box its middle.

Subjects are an explicit table keyed by card code (SUBJECTS below), so a
re-render is reproducible and a wrong pick is a one-line fix.

Run (Blender as a Python module, `pip install bpy`, Python 3.11):
    python scripts/card-art/blender/render_contracts.py --out DIR [--only CODE,CODE] [--samples 32]
then put each on the dark card backdrop:
    python3 scripts/card-art/blender/composite.py --src DIR --deck contracts --all-dark
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
    TAU, W, H, Mats, sphere, sun, glow, principled, mat_planet, mat_clouds, mat_atmosphere,
    habitat, cyl, box, rod)
from render_bernals import kalpana, mars_mat, srgb  # noqa: E402


# ---- materials -----------------------------------------------------------------

def _bsdf(m):
    return m.node_tree.nodes['Principled BSDF']


def banded(name, stops, bands=5.0, distort=6.0, rough=0.7):
    """Gas giant: latitude bands (a wave along Z) wobbled by noise."""
    m = principled(name, stops[0][1], rough)
    nt = m.node_tree
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wv = nt.nodes.new('ShaderNodeTexWave')
    wv.bands_direction = 'Z'
    wv.inputs['Scale'].default_value = bands
    wv.inputs['Distortion'].default_value = distort
    wv.inputs['Detail'].default_value = 4.0
    # Generated coords (0..1 over the sphere) so the band count is the same
    # whatever the planet's radius
    nt.links.new(tc.outputs['Generated'], wv.inputs['Vector'])
    r = K.ramp(nt, [(p, srgb(c)) for p, c in stops])
    nt.links.new(wv.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], _bsdf(m).inputs['Base Color'])
    return m


def cratered(name, stops, scale=6.0, crater=14.0, bump=0.6):
    """Airless body: mottled noise plus Voronoi craters in the bump."""
    m = principled(name, stops[0][1], 0.95)
    nt = m.node_tree
    n = K.noise(nt, scale, 9, 0.62)
    r = K.ramp(nt, [(p, srgb(c)) for p, c in stops])
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    nt.links.new(r.outputs['Color'], _bsdf(m).inputs['Base Color'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vo = nt.nodes.new('ShaderNodeTexVoronoi')
    vo.inputs['Scale'].default_value = crater
    nt.links.new(tc.outputs['Object'], vo.inputs['Vector'])
    cr = K.ramp(nt, [(0.0, (0, 0, 0)), (0.28, (0.15, 0.15, 0.15)), (0.36, (1, 1, 1)), (1.0, (0.6, 0.6, 0.6))])
    nt.links.new(vo.outputs['Distance'], cr.inputs['Fac'])
    b = nt.nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = bump
    nt.links.new(cr.outputs['Color'], b.inputs['Height'])
    nt.links.new(b.outputs['Normal'], _bsdf(m).inputs['Normal'])
    return m


def sun_mat(name, strength=7.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    n = K.noise(nt, 4.0, 10, 0.65)
    r = K.ramp(nt, [(0.3, (0.9, 0.12, 0.0)), (0.55, (1.0, 0.38, 0.03)), (0.78, (1.0, 0.7, 0.2))])
    nt.links.new(n.outputs['Fac'], r.inputs['Fac'])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    nt.links.new(r.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def halo(name, color, strength=3.0, inner=0.0):
    """A glow shell: bright toward the centre of the disc (coma, corona)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    r = K.ramp(nt, [(0.0, (1, 1, 1)), (0.45 + inner, (0.25, 0.25, 0.25)), (0.9, (0, 0, 0)), (1.0, (0, 0, 0))])
    nt.links.new(lw.outputs['Facing'], r.inputs['Fac'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(r.outputs['Color'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def ring_mat(name, color, radius, gaps=((0.62, 0.66), (0.86, 0.88))):
    """A flat ring: banded by radius in object space, transparent in the gaps."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(tc.outputs['Object'], ln.inputs[0])
    dv = nt.nodes.new('ShaderNodeMath')
    dv.operation = 'DIVIDE'
    dv.inputs[1].default_value = radius
    nt.links.new(ln.outputs['Value'], dv.inputs[0])
    stops = [(0.0, (0, 0, 0)), (0.42, (0, 0, 0)), (0.44, (0.8, 0.8, 0.8))]
    for a, b in gaps:
        stops += [(a, (0.85, 0.85, 0.85)), (a + 0.005, (0, 0, 0)), (b, (0, 0, 0)), (b + 0.005, (0.7, 0.7, 0.7))]
    stops += [(0.98, (0.5, 0.5, 0.5)), (1.0, (0, 0, 0))]
    r = K.ramp(nt, stops)
    nt.links.new(dv.outputs['Value'], r.inputs['Fac'])
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = (*srgb(color), 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(r.outputs['Color'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(df.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def tail_mat(name, color, strength=1.2, spread=0.85):
    """Comet tail on a camera-facing plane: bright at the nucleus (u = 0),
    widening and fading along its length, soft at the sides."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])

    def math_node(op, a=None, b=None):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]
    u, v = sep.outputs['X'], sep.outputs['Y']
    half = math_node('MULTIPLY_ADD', u, spread, 0.12) if False else math_node('ADD', math_node('MULTIPLY', u, spread * 0.5), 0.04)
    off = math_node('ABSOLUTE', math_node('SUBTRACT', v, 0.5))
    across = math_node('MAXIMUM', math_node('SUBTRACT', 1.0, math_node('DIVIDE', off, half)), 0.0)
    along = math_node('POWER', math_node('SUBTRACT', 1.0, u), 1.6)
    fac = math_node('MULTIPLY', math_node('POWER', across, 1.5), along)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fac, mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


# Named looks for the bodies the contracts name.
def look(kind):
    G = (0.5, 0.5, 0.5)
    if kind == 'earth':
        return None
    if kind == 'mars':
        return mars_mat()
    if kind == 'moon':
        return cratered('moon', [(0.25, (0.32, 0.32, 0.33)), (0.55, (0.55, 0.55, 0.56)), (0.8, (0.72, 0.72, 0.72))])
    if kind == 'mercury':
        return cratered('mercury', [(0.25, (0.3, 0.27, 0.25)), (0.55, (0.5, 0.46, 0.42)), (0.8, (0.66, 0.6, 0.55))], crater=18)
    if kind == 'venus':
        return banded('venus', [(0.0, (0.86, 0.72, 0.42)), (0.5, (0.95, 0.85, 0.6)), (1.0, (0.8, 0.62, 0.32))], 1.6, 6.0)
    if kind == 'jupiter':
        return banded('jupiter', [(0.0, (0.55, 0.35, 0.22)), (0.3, (0.92, 0.82, 0.66)), (0.55, (0.72, 0.48, 0.3)),
                                  (0.8, (0.95, 0.9, 0.8)), (1.0, (0.62, 0.42, 0.28))], 3.2, 5.0)
    if kind == 'saturn':
        return banded('saturn', [(0.0, (0.66, 0.52, 0.3)), (0.35, (0.92, 0.8, 0.55)), (0.6, (0.75, 0.6, 0.36)), (1.0, (0.95, 0.86, 0.62))], 3.6, 2.5)
    if kind == 'uranus':
        return banded('uranus', [(0.0, (0.55, 0.82, 0.86)), (1.0, (0.66, 0.9, 0.92))], 1.2, 1.0, 0.4)
    if kind == 'neptune':
        return banded('neptune', [(0.0, (0.12, 0.25, 0.75)), (0.5, (0.25, 0.42, 0.9)), (1.0, (0.15, 0.3, 0.8))], 2.4, 4.0, 0.4)
    if kind == 'io':
        return cratered('io', [(0.2, (0.35, 0.22, 0.05)), (0.45, (0.92, 0.82, 0.3)), (0.7, (0.95, 0.6, 0.2)), (0.9, (0.98, 0.95, 0.75))], 5, 9, 0.3)
    if kind == 'icy':
        return cratered('icy', [(0.25, (0.62, 0.66, 0.72)), (0.55, (0.84, 0.86, 0.9)), (0.85, (0.96, 0.97, 1.0))], 5, 12)
    if kind == 'europa':
        return cratered('europa', [(0.3, (0.6, 0.42, 0.3)), (0.42, (0.9, 0.88, 0.84)), (1.0, (0.96, 0.95, 0.92))], 9, 6, 0.3)
    if kind == 'pluto':
        return cratered('pluto', [(0.25, (0.45, 0.3, 0.2)), (0.5, (0.78, 0.66, 0.52)), (0.8, (0.95, 0.9, 0.82))], 4, 10)
    if kind == 'titan':
        return banded('titan', [(0.0, (0.75, 0.5, 0.2)), (1.0, (0.88, 0.65, 0.3))], 1.2, 4.0)
    return cratered(kind, [(0.3, G), (0.7, (0.7, 0.7, 0.7))])


# ---- subjects --------------------------------------------------------------------

def rock_body(name, r, color, seed, stretch=(1.0, 0.8, 0.7), sub=5, lump=0.35):
    """An asteroid / nucleus: a subdivided ico sphere pushed out by noise."""
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=sub)
    ob = K.obj(name)
    ob.scale = stretch
    tex = bpy.data.textures.new(f'{name}.tex', 'CLOUDS')
    tex.noise_scale = 0.55
    tex.noise_depth = 3
    d = ob.modifiers.new('lumps', 'DISPLACE')
    d.texture, d.strength = tex, r * lump
    rnd = random.Random(seed)
    ob.rotation_euler = (rnd.uniform(0, TAU), rnd.uniform(0, TAU), rnd.uniform(0, TAU))
    ob.data.materials.append(cratered(f'{name}.m', [(0.25, tuple(c * 0.55 for c in color)), (0.6, color),
                                                     (0.85, tuple(min(1, c * 1.3) for c in color))], 3, 7, 0.9))
    bpy.ops.object.shade_smooth()
    return ob


def place(ob, loc):
    ob.location = loc
    return ob


def world_scene(subject, seed):
    """Build one subject around the origin, framed lower-right for a camera on +Y."""
    rnd = random.Random(seed)
    kind = subject[0]
    p = dict(subject[1]) if len(subject) > 1 else {}
    key = (-0.7, -0.9, 0.5)
    if kind == 'planet':
        body = p.get('body', 'earth')
        R = p.get('r', 3.0)
        c = (1.4, 0, -1.3)
        if body == 'earth':
            from render_bernals import planet_bg
            planet_bg('earth', R, c, land=0.535)
        else:
            sphere('planet', R, look(body), c, 128)
            if body in ('venus', 'titan', 'mars', 'uranus', 'neptune'):
                at = mat_atmosphere('atm', 2.0 if body != 'mars' else 1.0)
                sphere('atm', R * 1.03, at, c, 96)
        if body in ('saturn', 'uranus') or p.get('ring'):
            rr = R * (2.2 if body == 'saturn' else 1.5)
            bpy.ops.mesh.primitive_circle_add(vertices=192, radius=rr, fill_type='NGON', location=c)
            ring = K.obj('ring')
            ring.data.materials.append(ring_mat('ringm', (0.85, 0.78, 0.6) if body == 'saturn' else (0.32, 0.36, 0.4), rr))
            ring.rotation_euler = (math.radians(18 if body == 'saturn' else 70), math.radians(-14), 0)
        for i, moon in enumerate(p.get('moons', [])):
            sphere(f'moon{i}', moon[1], look(moon[0]), moon[2], 64)
        if p.get('aerostat'):
            # a small balloon station riding the cloud tops, lit by its windows
            M = Mats()
            env = sphere('aero.env', 0.2, principled('env', (0.9, 0.9, 0.92), 0.3), (c[0] - R * 0.55, c[1] - R * 0.95, c[2] + R * 0.62), 48)
            env.scale = (1.0, 1.0, 0.55)
            cyl('aero.gondola', 0.06, 0.2, M.dark, (env.location[0], env.location[1], env.location[2] - 0.24), (0, math.radians(90), 0))
            box('aero.win', (0.18, 0.02, 0.03), M.window, (env.location[0], env.location[1] - 0.09, env.location[2] - 0.24))
        sun(key, 4.5)
    elif kind == 'asteroid':
        col = p.get('color', (0.42, 0.38, 0.34))
        if p.get('binary'):
            a = rock_body('lobe1', 1.25, col, seed, (1.0, 0.9, 0.85), lump=0.25)
            b = rock_body('lobe2', 0.9, col, seed + 1, (1.0, 0.9, 0.9), lump=0.25)
            place(a, (0.4, 0, -0.5))
            place(b, (2.1, 0, -1.2))
        else:
            place(rock_body('asteroid', p.get('r', 1.1) * 1.45, col, seed), (1.2, 0, -0.9))
        for i in range(p.get('swarm', 5)):
            s = rock_body(f'pebble{i}', rnd.uniform(0.08, 0.18), col, seed + 10 + i, sub=3)
            place(s, (rnd.uniform(-1.2, 2.6), rnd.uniform(-0.5, 1.5), rnd.uniform(-1.8, 0.8)))
        sun(key, 5.0)
    elif kind == 'comet':
        nuc = rock_body('nucleus', 0.32, (0.3, 0.28, 0.26), seed, (1.0, 0.75, 0.7))
        place(nuc, (0.9, 0, -0.6))
        sphere('coma', 1.2, halo('coma', (0.6, 0.82, 1.0), 0.55), (0.9, 0, -0.6), 64)
        nx, nz = 0.9, -0.6
        for tname, col, ang, ln, wd, st in [('dust', (1.0, 0.9, 0.7), 145, 7.5, 3.4, 1.1), ('ion', (0.45, 0.7, 1.0), 155, 9.0, 1.6, 1.6)]:
            # a plane in XZ (facing the camera on -Y), its +X end at the nucleus side
            bpy.ops.mesh.primitive_plane_add(size=1)
            t = K.obj(f'tail.{tname}')
            t.data.materials.append(tail_mat(f'{tname}m', col, st))
            t.rotation_euler = (math.radians(90), math.radians(-ang), 0)
            t.scale = (ln, wd, 1)
            a_ = math.radians(ang)
            # Generated X runs 0..1 along local +X; put u = 0 at the nucleus
            t.location = (nx + math.cos(a_) * ln / 2, 0.2, nz + math.sin(a_) * ln / 2)
        if p.get('sun'):
            sphere('sun', 1.6, sun_mat('sunm', 2.2), (3.8, 3.0, -2.4), 64)
        sun((0.8, -0.5, -0.3), 4.0)
    elif kind == 'sun':
        sphere('sun', 2.8, sun_mat('sunm', 2.2), (1.6, 1.0, -1.6), 128)
        sphere('corona', 3.6, halo('corona', (1.0, 0.45, 0.08), 0.7, 0.1), (1.6, 1.0, -1.6), 96)
        if p.get('probe'):
            M = Mats()
            box('probe.shield', (0.5, 0.06, 0.5), M.white, (-0.6, -1.5, 0.6), (0.3, 0.2, 0.5))
            cyl('probe.body', 0.12, 0.45, M.gold, (-0.75, -1.7, 0.75), (0.3, 0.2, 0.5))
        sun((0.7, -0.5, -0.4), 3.0)
    elif kind == 'station':
        M = Mats()
        parts = kalpana(M, 0.9, seed) if p.get('kalpana') else habitat(M, 1.0, seed)
        root = K.group('station', parts, (1.1, 0, -0.8), (math.radians(65), math.radians(12), math.radians(-20)), 1.5)
        if p.get('body'):
            sphere('bgplanet', 2.6, look(p['body']) or mat_planet('bgp', 0.6, 0.535), (2.4, 6.0, -3.2), 96)
        sun(key, 4.5)
    elif kind == 'tour':
        # a row of worlds, nearest largest, for the flyby tours
        for i, (b, r) in enumerate(p['bodies']):
            x, z = 2.2 - i * 1.55, -1.7 + i * 1.05
            if b == 'earth':
                from render_bernals import planet_bg
                planet_bg(f'tour{i}', r, (x, i * 3.0, z), land=0.535)
            else:
                sphere(f'tour{i}', r, look(b), (x, i * 3.0, z), 96)
            if b == 'saturn':
                bpy.ops.mesh.primitive_circle_add(vertices=128, radius=r * 2.1, fill_type='NGON', location=(x, i * 3.0, z))
                ring = K.obj(f'tourring{i}')
                ring.data.materials.append(ring_mat(f'tr{i}', (0.85, 0.78, 0.6), r * 2.1))
                ring.rotation_euler = (math.radians(18), math.radians(-14), 0)
        sun(key, 4.5)
    # camera on -Y looking +Y at the origin; the subject sits right and low
    K.camera((0, -9.0, 0.3), (0, 0, 0.3), lens=40)


# card code -> subject. ('planet', {body, r, moons, aerostat}), ('asteroid', {color, r,
# binary, swarm}), ('comet', {sun}), ('sun', {probe}), ('station', {kalpana, body}),
# ('tour', {bodies}).
C_ROCK, S_ROCK, ICE_ROCK, RED_ROCK = (0.3, 0.28, 0.26), (0.55, 0.47, 0.38), (0.72, 0.74, 0.78), (0.55, 0.32, 0.22)
SUBJECTS = {
    'M4N217F': ('asteroid', {'color': S_ROCK}), 'M4N217R': ('station', {'kalpana': True}),
    'M4N218F': ('comet', {}), 'M4N218R': ('planet', {'body': 'europa', 'r': 2.6}),
    'M4N219F': ('planet', {'body': 'moon', 'r': 2.8}), 'M4N219R': ('planet', {'body': 'venus'}),
    'M4N220F': ('planet', {'body': 'mercury'}), 'M4N220R': ('planet', {'body': 'icy', 'r': 2.4}),
    'M4N221F': ('tour', {'bodies': [('mercury', 0.6), ('venus', 0.9), ('earth', 1.0), ('mars', 0.7)]}),
    'M4N221R': ('tour', {'bodies': [('jupiter', 1.4), ('saturn', 1.0), ('uranus', 0.7)]}),
    'M4N222F': ('planet', {'body': 'mars'}), 'M4N222R': ('planet', {'body': 'io', 'r': 2.4}),
    'M4N223F': ('asteroid', {'color': C_ROCK, 'swarm': 9}), 'M4N223R': ('planet', {'body': 'pluto', 'r': 2.4}),
    'M4N224F': ('asteroid', {'color': (0.38, 0.36, 0.34), 'r': 1.2}), 'M4N224R': ('asteroid', {'color': RED_ROCK}),
    'M4N225F': ('sun', {'probe': True}), 'M4N225R': ('planet', {'body': 'moon', 'r': 2.8}),
    'M4N226F': ('planet', {'body': 'mars', 'r': 3.2}), 'M4N226R': ('asteroid', {'color': (0.5, 0.42, 0.36), 'r': 0.9}),
    'M4N227F': ('planet', {'body': 'titan', 'aerostat': True}), 'M4N227R': ('planet', {'body': 'venus', 'aerostat': True}),
    'M4N228F': ('sun', {}), 'M4N228R': ('comet', {'sun': True}),
    'M4N229F': ('planet', {'body': 'europa', 'r': 2.6}), 'M4N229R': ('asteroid', {'color': (0.4, 0.38, 0.35), 'r': 0.8}),
    'M4N230F': ('planet', {'body': 'moon', 'r': 2.8}), 'M4N230R': ('planet', {'body': 'jupiter', 'r': 3.4, 'moons': [('io', 0.35, (-1.6, -2.0, 0.4))]}),
    'M4N231F': ('asteroid', {'color': S_ROCK}), 'M4N231R': ('asteroid', {'color': C_ROCK, 'r': 1.1}),
    'M4N232F': ('sun', {'probe': True}), 'M4N232R': ('comet', {}),
    'M4N233F': ('planet', {'body': 'mars', 'r': 3.0}), 'M4N233R': ('asteroid', {'color': S_ROCK, 'r': 1.25}),
    'M4N234F': ('asteroid', {'color': ICE_ROCK, 'r': 1.15}), 'M4N234R': ('planet', {'body': 'saturn', 'r': 2.4, 'aerostat': True}),
    'M4N235F': ('planet', {'body': 'mercury'}), 'M4N235R': ('planet', {'body': 'europa', 'r': 2.6}),
    'M4N236F': ('asteroid', {'color': C_ROCK, 'r': 0.8}), 'M4N236R': ('planet', {'body': 'saturn', 'r': 2.2}),
    'M4N237F': ('planet', {'body': 'moon', 'r': 2.6}), 'M4N237R': ('planet', {'body': 'mars', 'r': 3.0}),
    'M4N238F': ('asteroid', {'color': RED_ROCK, 'r': 1.0}), 'M4N238R': ('planet', {'body': 'neptune', 'r': 2.8}),
    'M4N239F': ('comet', {}), 'M4N239R': ('planet', {'body': 'icy', 'r': 2.6, 'ring': True}),
    'M4N240F': ('planet', {'body': 'europa', 'r': 2.6}), 'M4N240R': ('planet', {'body': 'venus', 'aerostat': True}),
    'M4N241F': ('asteroid', {'color': C_ROCK, 'r': 1.25}), 'M4N241R': ('planet', {'body': 'uranus', 'r': 2.8}),
    'M4N242F': ('asteroid', {'color': S_ROCK, 'r': 0.9}), 'M4N242R': ('comet', {}),
    'M4N243F': ('planet', {'body': 'icy', 'r': 2.6}), 'M4N243R': ('planet', {'body': 'mercury'}),
    'M4N244F': ('planet', {'body': 'mars', 'r': 3.0, 'moons': [('moon', 0.3, (-1.5, -2.2, 0.6))]}),
    'M4N244R': ('station', {'body': 'mars'}),
    'M4N245F': ('asteroid', {'color': S_ROCK, 'r': 1.0}), 'M4N245R': ('planet', {'body': 'neptune', 'r': 2.8}),
    'M4N246F': ('comet', {'sun': True}), 'M4N246R': ('asteroid', {'color': C_ROCK, 'swarm': 10}),
    'M4N247F': ('comet', {}), 'M4N247R': ('station', {'body': 'earth'}),
    'M4N248F': ('asteroid', {'color': (0.5, 0.5, 0.52), 'r': 1.0}), 'M4N248R': ('planet', {'body': 'europa', 'r': 2.6}),
    'M4N249F': ('station', {'kalpana': True}), 'M4N249R': ('station', {'body': 'earth'}),
    'M4N250F': ('station', {'kalpana': True, 'body': 'icy'}), 'M4N250R': ('station', {}),
    'M4N251F': ('station', {'kalpana': True}), 'M4N251R': ('planet', {'body': 'icy', 'r': 2.4}),
    'M4N252F': ('planet', {'body': 'mars', 'r': 3.0}), 'M4N252R': ('planet', {'body': 'icy', 'r': 2.6, 'moons': [('pluto', 0.4, (-1.6, -2.0, 0.6))]}),
    'M4N253F': ('planet', {'body': 'uranus', 'r': 2.8, 'aerostat': True}), 'M4N253R': ('planet', {'body': 'neptune', 'r': 2.8}),
    'M4N254F': ('planet', {'body': 'saturn', 'r': 2.4, 'aerostat': True}), 'M4N254R': ('planet', {'body': 'pluto', 'r': 2.6, 'moons': [('icy', 0.7, (-1.6, -1.6, 0.6))]}),
    'M4N255F': ('sun', {'probe': True}), 'M4N255R': ('planet', {'body': 'neptune', 'r': 3.0, 'moons': [('icy', 0.25, (-1.4, -2.2, 0.7))]}),
    'M4N256F': ('station', {}), 'M4N256R': ('asteroid', {'color': RED_ROCK, 'r': 1.2}),
    'M4N257F': ('planet', {'body': 'mercury'}), 'M4N257R': ('asteroid', {'color': RED_ROCK, 'r': 1.0}),
    'M4N258F': ('asteroid', {'color': RED_ROCK, 'binary': True}), 'M4N258R': ('asteroid', {'color': (0.6, 0.45, 0.38), 'r': 1.0}),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=32)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    keys = [k for k in SUBJECTS if not a.only or k in a.only.split(',')]
    for i, code in enumerate(keys):
        K.reset(a.samples)
        world_scene(SUBJECTS[code], seed=sum(map(ord, code)))
        bpy.context.scene.render.filepath = os.path.join(a.out, f'{code}.png')
        bpy.ops.render.render(write_still=True)
        print(f'[{i + 1}/{len(keys)}] {code} {SUBJECTS[code][0]}', flush=True)


if __name__ == '__main__':
    main()
