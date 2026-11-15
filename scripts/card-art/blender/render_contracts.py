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
    habitat, cyl, box, rod, torus)
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



# ---- distance and glow ------------------------------------------------------------
# A contract's art is two layers that never touch: the WORLD, built around the
# origin and then scaled up about the camera so it sits huge and far away, and
# the mission's CRAFT a few units from the lens. Light linking keeps each layer
# lit (and shadowed) only by its own lamps, so a craft can never cast a shadow
# on the planet it is visiting (user 2026-11-15: "planets ... big and glowing
# and far off in the distance, dont cheapen it by just placing models next to
# each other, think about framing").

LIT = (-0.8, -0.05, 0.5)     # toward the sun on the planet cards (world_scene's `side`)

GLOW = {
    'earth': ((0.45, 0.7, 1.0), 2.4), 'mars': ((1.0, 0.55, 0.35), 1.4), 'venus': ((1.0, 0.85, 0.55), 2.4),
    'jupiter': ((1.0, 0.8, 0.6), 1.8), 'saturn': ((1.0, 0.88, 0.6), 1.8), 'uranus': ((0.55, 0.95, 1.0), 2.2),
    'neptune': ((0.35, 0.55, 1.0), 2.4), 'titan': ((1.0, 0.7, 0.3), 2.4), 'io': ((1.0, 0.9, 0.5), 1.0),
    'moon': ((0.8, 0.85, 1.0), 0.7), 'mercury': ((0.95, 0.8, 0.7), 0.7), 'icy': ((0.7, 0.85, 1.0), 0.9),
    'europa': ((0.85, 0.9, 1.0), 0.9), 'pluto': ((0.95, 0.85, 0.75), 0.8),
}


def limb_glow(name, color, strength):
    """Glow on the BACK half of a shell around a world: hidden behind the disc,
    it shows only past the limb, brightest at the limb and fading outward, and
    never washes over the world's own face."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    r = K.ramp(nt, [(0.0, (1, 1, 1)), (0.35, (0.8, 0.8, 0.8)), (0.6, (0.18, 0.18, 0.18)), (0.92, (0, 0, 0))])
    nt.links.new(lw.outputs['Facing'], r.inputs['Fac'])
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(r.outputs['Color'], mul.inputs[0])
    nt.links.new(geo.outputs['Backfacing'], mul.inputs[1])
    # brightest on the sunlit limb, a faint airglow round the night side
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    nt.links.new(geo.outputs['Normal'], dot.inputs[0])
    dot.inputs[1].default_value = -Vector(LIT).normalized()   # back faces: Cycles flips the normal toward the eye
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = -0.4, 0.8
    mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value = 0.12, 1.0
    nt.links.new(dot.outputs['Value'], mr.inputs['Value'])
    lit = nt.nodes.new('ShaderNodeMath')
    lit.operation = 'MULTIPLY'
    nt.links.new(mul.outputs[0], lit.inputs[0])
    nt.links.new(mr.outputs['Result'], lit.inputs[1])
    mul = lit
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mul.outputs[0], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def glow_shell(name, body, R, c):
    col, st = GLOW.get(body, ((0.8, 0.85, 1.0), 0.8))
    airless = st < 1.2
    sh = sphere(f'{name}.glow', R * (1.14 if airless else 1.3), limb_glow(f'{name}.glowm', col, st), c, 96)
    sh.visible_shadow = False
    return sh


CAM = Vector((0.0, -9.0, 0.3))
TAN_W = 18.0 / 40.0                 # half-width of the frame in tangent units (lens 40, 600 wide)
# kind -> (depth, zoom, where its centre lands in tangent units (x right, z up),
# where the subject's centre sits in the world build)
LAYOUT = {
    'planet': (140.0, 1.4, (0.30, 0.14), (1.4, 0.0, -1.3)),
    'asteroid': (32.0, 1.45, (0.24, 0.10), (1.2, 0.0, -0.9)),
    'comet': (70.0, 1.15, (0.10, 0.10), (0.9, 0.0, -0.6)),
    'sun': (400.0, 1.9, (0.42, 0.18), (1.6, 1.0, -1.6)),
    'station': (16.0, 1.15, (0.10, 0.14), (1.1, 0.0, -0.8)),
    'tour': (90.0, 1.2, (0.05, 0.08), None),
}


def world_layer(kind, p, seed):
    """Parent everything built so far to one root, scaled about the camera so the
    picture keeps its composition but the world sits `depth` away, then zoomed and
    slid so the subject lands big in the upper right, partly off the card."""
    rnd = random.Random(seed * 7 + 1)
    depth, zoom, (tx, tz), c = LAYOUT[kind]
    if kind == 'tour':
        bodies = p['bodies']
        xs = [(2.2 - i * 1.55, i * 3.0, -1.7 + i * 1.05) for i in range(len(bodies))]
        c = tuple(sum(v[k] for v in xs) / len(xs) for k in range(3))
    zoom *= rnd.uniform(0.9, 1.12)
    tx += rnd.uniform(-0.06, 0.06)
    tz += rnd.uniform(-0.05, 0.05)
    c = Vector(c)
    S = depth * zoom / (0.0 - CAM.y)   # the old build was framed from 9 units out
    L = Vector((tx * depth + CAM.x - S * c.x, depth + CAM.y - S * c.y, tz * depth + CAM.z - S * c.z))
    for o in bpy.context.scene.objects:
        camera_only_if_glow(o)
    objs = [o for o in bpy.context.scene.objects if o.parent is None]
    root = link_empty('world')
    for o in objs:
        o.parent = root
    root.location, root.scale = L, (S, S, S)
    return objs


def camera_only_if_glow(o):
    """A glow (halo, limb shell, atmosphere, coma) is something the eye sees, not
    a lamp: in Cycles an emitter lights its neighbours, and a shell around a
    world would flood its face from every side and erase the terminator."""
    if o.type != 'MESH' or not o.data.materials:
        return
    m = o.data.materials[0]
    if m and m.use_nodes and not any(n.type == 'BSDF_PRINCIPLED' for n in m.node_tree.nodes):
        if not any(k in o.name for k in ('sun', 'tail')):
            o.visible_diffuse = o.visible_glossy = o.visible_transmission = False
            o.visible_shadow = False


def link_empty(name):
    return K.link(bpy.data.objects.new(name, None))


def backdrop_world(body, tx, tz, tr, depth=160.0, seed=1):
    """A big world far behind a station: centred at (tx, tz) in tangent units,
    radius tr in tangent units."""
    c = (CAM.x + tx * depth, CAM.y + depth, CAM.z + tz * depth)
    R = tr * depth
    if body == 'earth':
        from render_bernals import planet_bg
        planet_bg('backdrop', 3.0, (0, 0, 0), land=0.535)
        for n in ('bg.backdrop', 'bg.backdropc', 'bg.backdropa'):
            o = bpy.data.objects[n]
            o.scale = (R / 3.0,) * 3
            o.location = c
    else:
        o = sphere('backdrop', 1.0, look(body), (0, 0, 0), 128)
        o.scale = (R,) * 3
        o.location = c
    g = glow_shell('backdrop', body, 1.0, (0, 0, 0))
    g.scale = (R,) * 3
    g.location = c


def collect(objs):
    out = []
    for o in objs:
        out.append(o)
        out += collect(list(o.children))
    return out


def link_lights(lamps, objs, name):
    coll = bpy.data.collections.new(name)
    for o in objs:
        if o.type != 'LIGHT':
            coll.objects.link(o)
    for l in lamps:
        l.light_linking.receiver_collection = coll
        l.light_linking.blocker_collection = coll


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
    side = LIT       # from the left and a little behind: a lit limb and a terminator
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
            glow_shell(f'moon{i}', moon[0], moon[1], moon[2])
        glow_shell('planet', body, R, c)
        if p.get('aerostat'):
            # a small balloon station riding the cloud tops, lit by its windows
            M = Mats()
            env = sphere('aero.env', 0.2, principled('env', (0.9, 0.9, 0.92), 0.3), (c[0] - R * 0.55, c[1] - R * 0.95, c[2] + R * 0.62), 48)
            env.scale = (1.0, 1.0, 0.55)
            cyl('aero.gondola', 0.06, 0.2, M.dark, (env.location[0], env.location[1], env.location[2] - 0.24), (0, math.radians(90), 0))
            box('aero.win', (0.18, 0.02, 0.03), M.window, (env.location[0], env.location[1] - 0.09, env.location[2] - 0.24))
        sun(side, 4.5)
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
        # nested shells: a hot core falling off smoothly into the coma
        for j, (cr, cs) in enumerate([(0.38, 2.4), (0.8, 0.7), (1.5, 0.22)]):
            sphere(f'coma{j}', cr, halo(f'coma{j}', (0.62, 0.84, 1.0), cs), (0.9, 0, -0.6), 64)
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
        sphere('sun', 2.8, sun_mat('sunm', 6.0), (1.6, 1.0, -1.6), 128)
        sphere('corona', 4.4, halo('corona', (1.0, 0.55, 0.15), 1.0, 0.1), (1.6, 1.0, -1.6), 96)
        sun((0.7, -0.5, -0.4), 3.0)
    elif kind == 'station':
        M = Mats()
        parts = kalpana(M, 0.9, seed) if p.get('kalpana') else habitat(M, 1.0, seed)
        root = K.group('station', parts, (1.1, 0, -0.8), (math.radians(65), math.radians(12), math.radians(-20)), 1.5)
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
            glow_shell(f'tour{i}', b, r, (x, i * 3.0, z))
            if b == 'saturn':
                bpy.ops.mesh.primitive_circle_add(vertices=128, radius=r * 2.1, fill_type='NGON', location=(x, i * 3.0, z))
                ring = K.obj(f'tourring{i}')
                ring.data.materials.append(ring_mat(f'tr{i}', (0.85, 0.78, 0.6), r * 2.1))
                ring.rotation_euler = (math.radians(18), math.radians(-14), 0)
        sun(side, 4.5)


# ---- mission hardware (by contract type) ------------------------------------------
# Each builder makes its craft at the origin, about 1.4 units across, nose
# toward +X, and returns its parts; `craft` groups, turns and places it in the
# foreground, low and right, where the card's text boxes leave the art open.

def cone(name, r1, r2, depth, mat, loc=(0, 0, 0), rot=(0, 0, 0), verts=32):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    ob = K.obj(name)
    ob.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return ob


def panel(name, M, loc, size, rot=(0, 0, 0)):
    """A solar wing: dark cells in a steel frame."""
    return [box(name, size, M.pv, loc, rot), box(name + '.f', (size[0] * 1.03, size[1] * 0.4, size[2] * 1.03), M.steel, loc, rot)]


def bell(name, M, x, r=0.16, glow_col=(0.45, 0.7, 1.0)):
    """An engine bell pointing -X with a plume glow."""
    parts = [cone(name, r, r * 0.45, r * 1.4, M.dark, (x, 0, 0), (0, math.radians(90), 0))]
    # the exhaust as a soft glow at the bell's mouth (a solid plume cone read
    # as a second nose)
    parts.append(sphere(name + '.glow', r * 0.55, halo(name + '.g', glow_col, 2.5), (x - r * 0.9, 0, 0), 32))
    return parts


def hw_capsule(M):
    """Tourists: a crew capsule on its service module, wings out."""
    p = [cone('cap.cone', 0.34, 0.12, 0.42, M.white, (0.55, 0, 0), (0, math.radians(90), 0)),
         cyl('cap.sm', 0.34, 0.6, principled('sm', (0.75, 0.76, 0.8), 0.35, 0.6), (0.04, 0, 0), (0, math.radians(90), 0))]
    for i in range(4):
        p.append(box(f'cap.win{i}', (0.05, 0.02, 0.04), M.window, (0.5, -0.27 + i * 0.0, 0.18 - i * 0.1), (0, 0, 0)))
    for s_ in (-1, 1):
        p += panel(f'cap.wing{s_}', M, (0.04, s_ * 0.9, 0), (0.32, 0.03, 1.0) if False else (0.34, 1.0, 0.02))
    p += bell('cap.bell', M, -0.36, 0.14)
    return p


def hw_yacht(M):
    """Trillionaires: a long white-and-gold liner with a lit window band."""
    hull = sphere('yacht.hull', 0.3, M.white, (0.1, 0, 0), 64)
    hull.scale = (2.6, 1.0, 0.8)
    p = [hull, box('yacht.trim', (1.3, 0.62, 0.03), M.gold, (0.1, 0, -0.05))]
    for i in range(10):
        p.append(box(f'yacht.win{i}', (0.06, 0.6, 0.035), M.window, (-0.4 + i * 0.11, 0, 0.1)))
    p.append(box('yacht.fin', (0.3, 0.03, 0.28), M.gold, (-0.55, 0, 0.25), (0, math.radians(20), 0)))
    p += bell('yacht.bell', M, -0.8, 0.13, (1.0, 0.75, 0.35))
    return p


def hw_probe(M):
    """Science missions: a foil-wrapped bus, a big dish, an RTG on a boom."""
    p = [box('probe.bus', (0.36, 0.36, 0.3), M.gold, (0, 0, 0)),
         cone('probe.dish', 0.5, 0.05, 0.18, M.white, (0, 0, 0.3)),
         cyl('probe.feed', 0.02, 0.35, M.steel, (0, 0, 0.45)),
         rod('probe.boom', (0.15, 0, 0), (0.9, 0, -0.15), 0.015, M.steel),
         cyl('probe.rtg', 0.06, 0.26, M.dark, (0.95, 0, -0.16), (0, math.radians(90), 0)),
         rod('probe.mag', (-0.15, 0, 0), (-1.0, 0, 0.1), 0.01, M.steel)]
    return p


def hw_rover(M):
    """Robotic research: a six-wheeled rover with a mast camera and a dish."""
    p = [box('rover.body', (0.8, 0.5, 0.18), M.white, (0, 0, 0.22)),
         box('rover.deck', (0.82, 0.52, 0.02), M.gold, (0, 0, 0.32)),
         cyl('rover.mast', 0.025, 0.4, M.steel, (0.3, 0.15, 0.52)),
         box('rover.head', (0.12, 0.08, 0.08), M.dark, (0.3, 0.15, 0.74)),
         cone('rover.dish', 0.14, 0.02, 0.05, M.white, (-0.2, -0.1, 0.4))]
    for i, x in enumerate((-0.32, 0.0, 0.32)):
        for s_ in (-1, 1):
            p.append(cyl(f'rover.w{i}{s_}', 0.11, 0.08, M.dark, (x, s_ * 0.3, 0.1), (math.radians(90), 0, 0)))
    p += panel('rover.pv', M, (-0.2, 0, 0.36), (0.5, 0.5, 0.015))
    return p


def hw_lander(M):
    """Government grants: a four-legged lander, foil body, bell below."""
    p = [cyl('lander.body', 0.32, 0.35, M.gold, (0, 0, 0.45), verts=8, smooth=False),
         cone('lander.top', 0.3, 0.12, 0.2, M.white, (0, 0, 0.72)),
         cone('lander.bell', 0.14, 0.06, 0.2, M.dark, (0, 0, 0.18))]
    for i in range(4):
        a = TAU * i / 4 + math.radians(45)
        foot = (math.cos(a) * 0.62, math.sin(a) * 0.62, 0.0)
        p.append(rod(f'lander.leg{i}', (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.4), foot, 0.02, M.steel))
        p.append(cyl(f'lander.foot{i}', 0.07, 0.02, M.steel, foot))
    return p


def hw_warsat(M):
    """Military: a dark armoured platform, a rail gun and a red beacon."""
    p = [cyl('war.hull', 0.32, 0.5, M.dark, (0, 0, 0), (0, math.radians(90), 0), verts=6, smooth=False),
         cyl('war.rail', 0.04, 1.3, M.steel, (0.75, 0, 0.05), (0, math.radians(90), 0)),
         box('war.rail2', (1.2, 0.02, 0.02), M.copper, (0.72, 0, 0.12)),
         sphere('war.beacon', 0.04, M.beacon, (0, 0, 0.36), 12),
         sphere('war.sensor', 0.09, principled('lens', (0.05, 0.05, 0.07), 0.1, 0.8), (0.22, -0.28, 0), 24)]
    for s_ in (-1, 1):
        p += [box(f'war.pv{s_}', (0.3, 0.75, 0.02), principled('darkpv', (0.08, 0.04, 0.04), 0.3, 0.4), (-0.1, s_ * 0.7, 0))]
    return p


def hw_laser(M):
    """Megaprojects: a ring of mirror segments and a glowing beam."""
    p = []
    for i in range(12):
        a = TAU * i / 12
        p.append(box(f'laser.seg{i}', (0.05, 0.28, 0.22), principled('mirror', (0.85, 0.88, 0.95), 0.05, 1.0),
                     (0, math.cos(a) * 0.6, math.sin(a) * 0.6), (a, 0, 0)))
    p.append(torus('laser.ring', 0.6, 0.03, M.steel, (0, 0, 0), (0, math.radians(90), 0)))
    p.append(cyl('laser.core', 0.12, 0.4, M.copper, (0, 0, 0), (0, math.radians(90), 0)))
    p.append(cyl('laser.beam', 0.035, 6.0, glow('beam', (1.0, 0.35, 0.25), 12.0), (3.1, 0, 0), (0, math.radians(90), 0)))
    return p


def hw_starship(M):
    """Project Exodus: a long truss of spherical tanks, a habitat ring and a drive."""
    p = [cyl('ship.spine', 0.06, 2.2, M.steel, (0, 0, 0), (0, math.radians(90), 0))]
    for i in range(5):
        p.append(sphere(f'ship.tank{i}', 0.16, principled('tank', (0.6, 0.62, 0.66), 0.35, 0.8), (-0.6 + i * 0.25, 0, 0.17), 32))
        p.append(sphere(f'ship.tankb{i}', 0.16, principled('tank', (0.6, 0.62, 0.66), 0.35, 0.8), (-0.6 + i * 0.25, 0, -0.17), 32))
    p.append(torus('ship.hab', 0.42, 0.07, M.white, (0.85, 0, 0), (0, math.radians(90), 0)))
    for i in range(16):
        a = TAU * i / 16
        p.append(box(f'ship.win{i}', (0.03, 0.05, 0.03), M.window, (0.85, math.cos(a) * 0.42, math.sin(a) * 0.42)))
    p += bell('ship.drive', M, -1.2, 0.2, (0.7, 0.85, 1.0))
    return p


HARDWARE = {
    'Tourists Contract': hw_capsule, 'Avatar Tourists Contract': hw_capsule,
    'Trillionaire Contract': hw_yacht, 'Avatar Trillionaire Contract': hw_yacht,
    'Science Mission Contract': hw_probe, 'Robotic Research Contract': hw_rover,
    'Government Grant Contract': hw_lander, 'Military Contract': hw_warsat,
    'Megaproject Contract': hw_laser, 'Project Exodus Contract': hw_starship,
}


def craft(builder, seed, at=(0.35, -3.6, -1.05), scale=1.0):
    rnd = random.Random(seed)
    M = Mats()
    parts = builder(M)
    rot = (math.radians(rnd.uniform(-15, 15)), math.radians(rnd.uniform(-20, 10)), math.radians(rnd.uniform(15, 40)))
    return K.group('craft', parts, at, rot, scale)


def contract_types():
    """card code -> printed contract type, from the card data the game reads."""
    import json
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
    data = json.load(open(os.path.join(root, 'data', 'card-data.json')))
    out = {}
    for tab in ('Contracts', 'Exodus Contracts'):
        for c in data.get(tab, []):
            for f in ('tier1', 'tier2'):
                face = c.get(f) or {}
                if face.get('Code'):
                    out[face['Code']] = face.get('Contract Type')
    return out


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
    types = contract_types()
    for i, code in enumerate(keys):
        K.reset(a.samples)
        seed = sum(map(ord, code))
        subject = SUBJECTS[code]
        kind, p = subject[0], (dict(subject[1]) if len(subject) > 1 else {})
        world_scene(subject, seed=seed)
        world_layer(kind, p, seed)
        if kind == 'station' and p.get('body'):
            backdrop_world(p['body'], 0.42, 0.30, 0.42, seed=seed)
        for o in bpy.context.scene.objects:
            camera_only_if_glow(o)
        bpy.context.scene.cycles.transparent_max_bounces = 32
        world = collect([o for o in bpy.context.scene.objects if o.parent is None])
        world_lamps = [o for o in world if o.type == 'LIGHT']
        link_lights(world_lamps, world, 'world.set')
        # The mission's own hardware in the foreground, except where the scene
        # already IS hardware (a station card shows the station).
        builder = HARDWARE.get(types.get(code))
        if builder and kind != 'station':
            root = craft(builder, seed)
            rim_col = GLOW.get(p.get('body', ''), ((1.0, 0.85, 0.6), 0))[0] if kind == 'planet' else (1.0, 0.85, 0.6)
            lamps = [sun((-0.6, -0.8, 0.55), 4.0), sun((0.5, -0.7, -0.1), 0.6, (0.6, 0.75, 1.0), 20),
                     sun((0.7, 0.9, 0.25), 3.0, rim_col)]
            link_lights(lamps, collect([root]), 'craft.set')
        K.camera(tuple(CAM), (CAM.x, CAM.y + 10, CAM.z), lens=40)
        bpy.context.scene.render.filepath = os.path.join(a.out, f'{code}.png')
        bpy.ops.render.render(write_still=True)
        print(f'[{i + 1}/{len(keys)}] {code} {SUBJECTS[code][0]}', flush=True)


if __name__ == '__main__':
    main()
