"""Blender card art: the promo crew deck (18 cards, 36 faces).

Briefs: the comment block above each promo(...) call in
scripts/card-art/crew.mjs. Both faces of a promo card share one faction and
one launcher, so each card is ONE scene with a small change between its faces
(`back` is True for the secondary face). Same card rules as render_crew.py,
whose kit (stages, bells, towers, pads, figures, the shared framing) this
imports: transparent film, top ~40% kept light for the privilege text, the
launcher in the right third, no logos, flags or lettering.

Run:
    python scripts/card-art/blender/render_crew_promo.py --out DIR [--only key,key] [--samples 20]
Keys: '<cardId>-<front|back>'.
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
import render_crew as C  # noqa: E402
from render_crew import (  # noqa: E402
    K, RX, TAU, m, WHITE, DARK, stage, nose, bells, booster, capsule_les,
    liftoff, ground, tower, pad, shoot, flag_free_colour as fc, box, cyl, lathe,
    mat_glow, rod, sphere, sun, torus, tube, area, truss, new_glenn_landing)


def figure(name, x, y=-1.0, z=0.0, suit=(0.9, 0.9, 0.9), helmet=True, hat=None, coat=None, sit=False, arms='down', s=1.0, glow=None):
    """A small person: a suit (or a coat), a helmet or a head with a hat."""
    sm = m(f'{name}.suit', coat or suit, 0.55)
    parts = []
    if sit:
        parts.append(cyl(f'{name}.body', 0.15 * s, 0.4 * s, sm, (x, y, z + 0.45 * s), verts=16))
        parts.append(rod(f'{name}.thighs', (x, y, z + 0.28 * s), (x, y - 0.35 * s, z + 0.28 * s), 0.08 * s, sm))
        parts.append(rod(f'{name}.shins', (x, y - 0.35 * s, z + 0.28 * s), (x, y - 0.35 * s, z), 0.07 * s, sm))
        parts.append(rod(f'{name}.armsf', (x - 0.14 * s, y - 0.12 * s, z + 0.5 * s), (x + 0.14 * s, y - 0.12 * s, z + 0.5 * s), 0.05 * s, sm))
        hz = z + 0.78 * s
    else:
        parts.append(cyl(f'{name}.body', 0.15 * s, 0.55 * s, sm, (x, y, z + 0.55 * s), verts=16))
        for sx in (-1, 1):
            parts.append(rod(f'{name}.leg{sx}', (x + sx * 0.07 * s, y, z + 0.3 * s), (x + sx * 0.08 * s, y, z), 0.06 * s, sm))
        if arms == 'up':
            parts.append(rod(f'{name}.arm', (x + 0.15 * s, y, z + 0.75 * s), (x + 0.35 * s, y - 0.2 * s, z + 1.1 * s), 0.045 * s, sm))
        elif arms == 'forward':
            parts.append(rod(f'{name}.arm', (x + 0.15 * s, y, z + 0.75 * s), (x + 0.45 * s, y - 0.25 * s, z + 0.6 * s), 0.045 * s, sm))
        hz = z + 0.98 * s
    if helmet:
        parts.append(sphere(f'{name}.helm', 0.15 * s, m(f'{name}.hm', (0.95, 0.95, 0.95), 0.3), (x, y, hz), 16))
        parts.append(sphere(f'{name}.visor', 0.1 * s, m(f'{name}.vz', (0.15, 0.2, 0.3), 0.1, 0.6), (x, y - 0.07 * s, hz), 12))
    else:
        parts.append(sphere(f'{name}.head', 0.11 * s, m(f'{name}.skin', (0.75, 0.55, 0.42), 0.6), (x, y, hz - 0.03 * s), 16))
    if hat == 'top':
        parts.append(cyl(f'{name}.brim', 0.15 * s, 0.02 * s, DARK(), (x, y, hz + 0.06 * s), verts=16))
        parts.append(cyl(f'{name}.crown', 0.09 * s, 0.22 * s, DARK(), (x, y, hz + 0.17 * s), verts=16))
    if glow:
        parts.append(sphere(f'{name}.aura', 0.5 * s, mat_glow(f'{name}.au', glow, 1.5, 0.3), (x, y, z + 0.55 * s), 16))
    return parts


def figures(prefix, x0, n, **kw):
    out = []
    for i in range(n):
        out += figure(f'{prefix}{i}', x0 + i * 0.45, **kw)
    return out


def sea(color=(0.03, 0.3, 0.45)):
    return box('sea', (60, 60, 0.2), m('sea', color, 0.12), (0, 28, 0.0))


def fins(x, y, z, r, n=4, size=(0.05, 0.4, 0.5), mat=None):
    mt = mat or WHITE()
    return [box(f'fin{x}{k}', size, mt, (x + r * math.cos(k * TAU / n), y + r * math.sin(k * TAU / n), z), (0, 0, k * TAU / n)) for k in range(n)]


def planet(name, r, loc, c1, c2, rough=0.8):
    mt = m(name, c1, rough)
    nt = mt.node_tree
    n = K.noise(nt, 3.0 / r, 8, 0.6)
    rp = K.ramp(nt, [(0.3, c2), (0.7, c1)])
    nt.links.new(n.outputs['Fac'], rp.inputs['Fac'])
    nt.links.new(rp.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    return sphere(name, r, mt, loc, 96)


def space_light(key=(0.7, -0.5, 0.5)):
    sun(key, 4.5)
    area('fill', (-6, -8, 6), 300, 6, (0.75, 0.82, 1.0))


# ---- the eighteen cards --------------------------------------------------------

def brin(back):
    """BRIN: a slim finned solid RX rocket on a rail launcher at an equatorial
    coral coast, big radiator panels folded (white) or deployed glowing (back)."""
    ang = math.radians(78)
    rk = [stage('rx', 0.16, 0.0, 4.2, WHITE(), 0, 0), nose('rxnose', 0.16, 4.2, 0.7, WHITE(), 0, 0)]
    rk += fins(0, 0, 0.35, 0.18, 4, (0.04, 0.35, 0.6), m('red', (0.8, 0.1, 0.1), 0.4))
    C.group('rocket', rk, (RX, 0, 1.4), (0, math.radians(90) - ang, 0))
    rail = m('rail', (0.35, 0.37, 0.4), 0.5, 0.6)
    rod('rail', (RX - 0.35, 0, 1.0), (RX + 0.75, 0, 6.2), 0.08, rail)
    rod('strut', (RX + 0.6, 0, 0), (RX + 0.2, 0, 3.0), 0.07, rail)
    box('base', (1.6, 1.4, 0.4), m('base', (0.4, 0.4, 0.42), 0.6), (RX - 0.3, 0, 0.2))
    radm = m('radp', (0.75, 0.77, 0.8), 0.35, 0.5)
    if back:
        hot = m('radhot', (0.6, 0.2, 0.1), 0.5)
        hot.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1.0, 0.4, 0.15, 1)
        hot.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 2.5
        for k in range(5):
            box(f'radwall{k}', (0.9, 0.06, 2.4), hot, (-3.6 + k * 1.0, 1.2, 1.3))
    else:
        for k in range(5):
            box(f'radfold{k}', (0.9, 0.06, 0.5), radm, (-3.6 + k * 1.0, 1.2, 0.3 + (k % 2) * 0.05))
    ground((0.93, 0.85, 0.6), depth=6.0)
    sea((0.0, 0.45, 0.55))
    shoot()


def sea_peoples(back):
    """The Sea Peoples: a small rocket off a semi-submersible sea-launch
    platform, their command ship alongside. Back: the rig at night, lit up like
    a floating casino."""
    plat = m('plat', (0.75, 0.75, 0.72), 0.5, 0.3)
    deckz = 1.6
    box('deck', (4.0, 2.6, 0.3), plat, (RX - 0.5, 0, deckz))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f'col{sx}{sy}', 0.3, deckz, plat, (RX - 0.5 + sx * 1.5, sy * 1.0, deckz / 2), verts=24)
        box(f'pontoon{sx}', (4.0, 0.6, 0.5), plat, (RX - 0.5, sx * 1.0, 0.25))
    z0 = deckz + 0.15
    stage('fuu', 0.28, z0, z0 + 4.6, WHITE())
    nose('fuunose', 0.28, z0 + 4.6, 0.9, WHITE())
    bells('fuueng', RX, 0, z0, 0.18, 1, 0)
    tower(RX - 1.1, 5.5, to=RX - 0.3)
    for o in bpy.context.scene.objects:
        if o.name.startswith(('tower', 'arm')):
            o.location.z += deckz
    hull = m('hull', (0.18, 0.22, 0.3), 0.5, 0.3)
    box('ship', (5.0, 1.4, 0.9), hull, (-2.6, 1.8, 0.45))
    box('bridge', (1.6, 1.0, 1.0), WHITE(), (-1.6, 1.8, 1.4))
    sea((0.02, 0.2, 0.35) if back else (0.03, 0.35, 0.5))
    if back:
        lamp = mat_glow('casino', (1.0, 0.75, 0.3), 12)
        rnd = random.Random(2)
        for i in range(40):
            sphere(f'bulb{i}', 0.05, lamp, (rnd.uniform(-4.8, RX + 1.4), rnd.uniform(-1.3, 2.3), rnd.uniform(0.6, 2.4)), 8)
        for k in range(4):
            area(f'glow{k}', (-3 + k * 2.2, -1.5, 1.0), 120, 1, (1.0, 0.6, 0.25))
        shoot()
        bpy.data.objects['sun'].data.energy = 0.5
        return
    shoot()


def martian_way(back):
    """The Martian Way: white face, a battered scavenger ship grappling a
    tumbling spent booster with Mars and Phobos behind. Back (Tailings
    Remining): their ships embedded in the end of a colossal ring-ice block."""
    if not back:
        planet('mars', 5.0, (-2.0, 30, 3.0), (0.75, 0.35, 0.15), (0.4, 0.15, 0.06))
        planet('phobos', 0.6, (3.5, 18, 6.5), (0.45, 0.4, 0.35), (0.25, 0.22, 0.2))
        spent = [stage('spent', 0.4, -2.0, 2.0, WHITE(), 0, 0), torus('sband', 0.41, 0.05, DARK(), (0, 0, 1.8))]
        spent += bells('spentbell', 0, 0, -2.0, 0.3, 1, 0)
        C.group('booster', spent, (RX + 0.4, 0, 4.4), (math.radians(30), math.radians(60), 0))
        rust = m('rust', (0.45, 0.3, 0.2), 0.7, 0.4)
        hull = [box('scav', (1.2, 0.8, 0.7), rust, (0, 0, 0)), cyl('scavtank', 0.35, 1.2, m('tankg', (0.55, 0.55, 0.5), 0.5, 0.5), (-0.9, 0, 0), (0, math.radians(90), 0))]
        hull += bells('scaveng', -1.55, 0, 0, 0.18, 1, 0)
        C.group('scavenger', hull, (RX - 1.8, -0.4, 2.2), (0, math.radians(-15), 0))
        tube('grapple', [(RX - 1.2, -0.4, 2.4), (RX - 0.4, -0.2, 3.2), (RX + 0.1, 0, 3.8)], 0.04, DARK())
    else:
        ice = m('ice', (0.6, 0.82, 1.0), 0.25)
        ice.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.5, 0.75, 1.0, 1)
        ice.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 0.4
        ice.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.3
        box('iceblock', (3.0, 2.4, 7.0), ice, (RX + 0.4, 0, 4.6), (0.1, 0.05, 0.08))
        for k in range(3):
            x = RX - 0.6 + k * 0.9
            box(f'ship{k}', (0.5, 0.5, 0.9), m('shipr', (0.5, 0.45, 0.4), 0.6, 0.4), (x, 0, 0.8))
            lathe(f'plume{k}', [(0.0, 0.3), (0.25, 0.3), (0.5, -2.6), (0.0, -2.8)], mat_glow(f'pl{k}', (0.7, 0.85, 1.0), 6, 0.5)).location = (x, 0, 0)
    space_light()
    K.camera((0, -20.2, 8.9), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36


def jaxa(back):
    """JAXA: a slim all-white Epsilon-style solid rocket on the hilltop rail
    launcher of Uchinoura over the Pacific. Back (Starchild): an augmented
    crew member with a soft bioluminescent glow at the foot of it."""
    hill = lathe('hill', [(6.0, 0.0), (4.0, 1.0), (1.5, 1.6), (0.0, 1.7)], m('grass', (0.12, 0.42, 0.15), 0.8), segs=48)
    hill.location = (RX - 1.0, 1.0, 0)
    hill.scale = (1, 0.5, 1)
    w = WHITE()
    z0 = 1.8
    stage('eps1', 0.32, z0, z0 + 3.4, w)
    stage('eps2', 0.28, z0 + 3.4, z0 + 5.4, w)
    nose('epsnose', 0.3, z0 + 5.4, 1.1, w)
    bells('epseng', RX, 0, z0, 0.22, 1, 0)
    rail = m('rail', (0.3, 0.32, 0.35), 0.5, 0.6)
    rod('launcher', (RX - 0.4, 0, z0 - 0.1), (RX - 0.4, 0, z0 + 5.6), 0.12, rail)
    rod('boom', (RX - 0.4, 0, z0 + 5.4), (RX - 0.05, 0, z0 + 5.4), 0.08, rail)
    sea((0.04, 0.25, 0.6))
    if back:
        figure('starchild', -1.4, y=-1.5, z=0.0, suit=fc((0.75, 0.6, 0.75)), s=1.3, glow=(0.4, 1.0, 0.8))
    shoot()


def space_force(back):
    """Space Force - Falcon X: a stubby wide white core over three big engine
    bells on a fog-bound coastal pad. Back: a small orange lifeboat capsule
    pulling away (rescue)."""
    w = WHITE()
    r = 0.75
    stage('core', r, 0.9, 6.0, w)
    stage('upper', r * 0.85, 6.0, 7.4, w)
    nose('fxnose', r * 0.85, 7.4, 1.4, w)
    bells('fxeng', RX, 0, 0.9, 0.32, 3, 0.4)
    tower(RX - 1.8, 8.4, to=RX - 0.8)
    pad()
    ground((0.45, 0.5, 0.55))
    fog = m('fog', (0.92, 0.94, 0.96), 0.9)
    fog.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.55
    rnd = random.Random(5)
    for i in range(14):
        sphere(f'fog{i}', rnd.uniform(0.8, 1.6), fog, (rnd.uniform(-6, 6), rnd.uniform(1, 6), rnd.uniform(0.0, 0.6)), 20)
    if back:
        orange = m('lifeboat', (0.95, 0.45, 0.08), 0.45)
        lb = lathe('lifeboat', [(0.4, 0.0), (0.25, 0.45), (0.0, 0.5)], orange, segs=32)
        lb.location = (-1.5, -1.0, 6.4)
        lb.rotation_euler = (0, math.radians(-30), 0)
        for k in range(3):
            lathe(f'lbjet{k}', [(0.0, 0.0), (0.06, 0.0), (0.0, -0.8)], mat_glow(f'lbj{k}', (1.0, 0.75, 0.4), 15, 0.7)).location = (-1.5 + 0.12 * (k - 1) + 0.3, -1.0, 6.2)
    shoot()


def aeb(back):
    """AEB: a small solid rocket ringed with slim strap-ons (VLS style) at the
    Alcantara coast, red earth and mangroves. The back flies the taller O'Bean
    III with a bigger upper stage."""
    w = WHITE()
    z0 = 0.4
    top = 5.6 if not back else 6.6
    stage('core', 0.3, z0, top, w)
    if back:
        stage('upper', 0.36, top, top + 1.3, w)
        top += 1.3
        nose('nose', 0.36, top, 1.0, w)
    else:
        nose('nose', 0.3, top, 0.9, w)
    for k in range(4):
        a = k * TAU / 4 + 0.785
        x, y = RX + 0.5 * math.cos(a), 0.5 * math.sin(a)
        stage(f'strap{k}', 0.2, z0, z0 + 3.4, w, x, y)
        lathe(f'strap{k}.nose', [(0.2, z0 + 3.4), (0.0, z0 + 4.1)], w, segs=24).location = (x, y, 0)
        bells(f'strap{k}.b', x, y, z0, 0.13, 1, 0)
    tower(RX - 1.4, top + 0.6, to=RX - 0.5)
    pad()
    ground((0.6, 0.22, 0.1))
    sea((0.05, 0.3, 0.42))
    mang = m('mangrove', (0.08, 0.32, 0.12), 0.8)
    rnd = random.Random(7)
    for i in range(7):
        sphere(f'mang{i}', rnd.uniform(0.4, 0.7), mang, (-5 + i * 0.8, rnd.uniform(1.5, 3.0), 0.6), 16)
    shoot()


def explorers(back):
    """Explorers Without Borders: in orbit, a Centaur V upper stage nosing
    supply pods toward a small shuttle, Earth below; crew in field-medic white
    with a red stripe. Back (Iso-Shuttles): two shuttles running the route."""
    planet('earth', 30.0, (0, 20, -26), (0.12, 0.35, 0.75), (0.05, 0.15, 0.4), 0.4)
    centaur = [stage('centaur', 0.38, 0, 3.2, WHITE(), 0, 0), torus('cband', 0.39, 0.05, m('cbandc', (0.85, 0.55, 0.15), 0.4, 0.8), (0, 0, 2.6))]
    centaur += bells('rl10', 0, 0, 0.0, 0.2, 2, 0.16)
    for k in range(3):
        centaur.append(box(f'pod{k}', (0.5, 0.5, 0.5), m('pod', (0.95, 0.95, 0.95), 0.4), (0, 0, 3.6 + k * 0.6)))
        centaur.append(box(f'podx{k}', (0.52, 0.52, 0.12), m('podred', (0.8, 0.1, 0.12), 0.4), (0, 0, 3.6 + k * 0.6)))
    C.group('stack', centaur, (RX + 0.4, 0, 3.4), (0, math.radians(-35), 0))

    def shuttle(name, loc, rot):
        parts = [lathe(f'{name}.body', [(0.0, -1.0), (0.3, -0.8), (0.32, 0.6), (0.0, 1.1)], WHITE(), segs=24),
                 box(f'{name}.wing', (1.4, 0.06, 0.8), WHITE(), (0, 0, -0.4)),
                 box(f'{name}.stripe', (0.66, 0.06, 0.12), m('stripe', (0.8, 0.1, 0.12), 0.4), (0, -0.3, 0.2))]
        return C.group(name, parts, loc, rot)
    shuttle('shuttle', (RX - 1.2, -0.5, 8.0), (0, math.radians(-120), 0))
    if back:
        shuttle('shuttle2', (-1.8, 1.0, 5.6), (0, math.radians(-110), 0))
    space_light()
    K.camera((0, -20.2, 8.9), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36


def gun_club(back):
    """Baltimore Gun Club: the Columbiad cannon pit at Stones Hill - a great
    iron muzzle in the ground - with an arcjet nozzle glowing at its mouth;
    gentlemen in top hats. Front: a steam plume. Back: a violet plasma jet."""
    iron = m('iron', (0.15, 0.15, 0.17), 0.5, 0.8)
    lathe('muzzle', [(1.2, 0.0), (1.2, 1.2), (1.4, 1.35), (1.4, 1.6), (1.0, 1.6), (1.0, 0.0)], iron, segs=64).location = (RX - 0.2, 0, 0)
    lathe('mound', [(4.0, 0.0), (1.4, 1.1), (1.2, 1.1)], m('earth', (0.45, 0.38, 0.3), 0.9), segs=64).location = (RX - 0.2, 0, 0)
    lathe('arcjet', [(0.2, 1.3), (0.35, 1.7), (0.5, 2.2), (0.45, 2.2), (0.3, 1.72), (0.15, 1.3)], m('copperj', (0.85, 0.45, 0.22), 0.3, 1.0), segs=32).location = (RX - 0.2, 0, 0)
    if back:
        lathe('jet', [(0.0, 2.1), (0.4, 2.1), (0.25, 7.6), (0.0, 7.8)], mat_glow('violet', (0.6, 0.45, 1.0), 10, 0.6), segs=32).location = (RX - 0.2, 0, 0)
    else:
        rnd = random.Random(3)
        steam = m('steam', (0.96, 0.96, 0.98), 0.9)
        for i in range(12):
            z = 2.4 + i * 0.45
            sphere(f'steam{i}', 0.35 + i * 0.06, steam, (RX - 0.2 + rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), z), 20)
    figures('gent', -3.6, 3, helmet=False, hat='top', coat=(0.08, 0.08, 0.1))
    ground((0.47, 0.44, 0.4))
    shoot()


def african_union(back):
    """African Union Space Directorate: an equatorial launch off an offshore
    platform (the San Marco platform off Malindi) with a clean white mid-size
    rocket. Back (Arbiter): a round council table of delegates on the shore."""
    plat = m('plat', (0.6, 0.6, 0.58), 0.6, 0.3)
    box('platform', (3.4, 3.0, 0.4), plat, (RX - 0.2, 0, 1.4))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(f'leg{sx}{sy}', 0.14, 1.4, plat, (RX - 0.2 + sx * 1.4, sy * 1.2, 0.7), verts=16)
    w = WHITE()
    z0 = 1.65
    stage('uru1', 0.36, z0, z0 + 4.4, w)
    stage('uru2', 0.36, z0 + 4.4, z0 + 5.6, w)
    torus('uruband', 0.37, 0.05, DARK(), (RX, 0, z0 + 4.4))
    nose('urunose', 0.4, z0 + 5.6, 1.1, w)
    bells('urueng', RX, 0, z0, 0.2, 1, 0)
    sea((0.01, 0.3, 0.5))
    box('shore', (6.0, 8.0, 0.3), m('sand', (0.85, 0.78, 0.6), 0.85), (-4.5, 2.0, 0.15))
    if back:
        cyl('table', 0.9, 0.12, m('wood', (0.4, 0.26, 0.14), 0.6), (-3.2, -0.2, 0.75), verts=48)
        for k in range(6):
            a = k * TAU / 6
            figure(f'del{k}', -3.2 + 1.2 * math.cos(a), y=-0.2 + 1.2 * math.sin(a), z=0.3, helmet=False, coat=fc((0.99, 0.8, 0.0)) if k % 2 else (0.9, 0.9, 0.9), s=0.8)
    shoot()


def leo_workers(back):
    """LEO Workers' Union: welders in hard-shell EVA suits on an orbital truss,
    tool tethers out, an Angara small in the distance below. White face: on the
    job. Back (Sitdown): seated across the hatch, arms folded, tools down."""
    planet('earth', 30.0, (0, 20, -28), (0.12, 0.35, 0.75), (0.05, 0.15, 0.4), 0.4)
    st = m('truss', (0.6, 0.62, 0.66), 0.45, 0.7)
    parts = truss('beam', 0.0, 9.0, 0.45, st, bays=8)
    C.group('truss', parts, (0.5, 0, 3.4), (0, math.radians(90), 0))
    box('hatch', (1.4, 1.0, 0.25), m('hatchm', (0.85, 0.85, 0.85), 0.4, 0.4), (RX, 0, 3.0))
    suit = fc((0.66, 0.85, 0.75))
    if back:
        figure('w0', RX - 0.6, y=-0.6, z=3.95, suit=suit, sit=True)
        figure('w1', RX + 0.5, y=-0.6, z=3.95, suit=suit, sit=True)
        box('toolbox', (0.4, 0.25, 0.2), DARK(), (RX - 1.4, -0.4, 4.0))
    else:
        figure('w0', RX - 0.9, y=-0.6, z=3.95, suit=suit, arms='forward')
        figure('w1', RX + 0.6, y=-0.6, z=3.95, suit=suit, arms='up')
        sphere('weld', 0.12, mat_glow('weld', (0.7, 0.85, 1.0), 40), (RX - 0.45, -0.85, 4.55), 12)
        tube('tether', [(RX + 0.75, -0.6, 4.7), (RX + 1.5, -0.8, 5.6), (RX + 2.0, -0.6, 6.2)], 0.02, m('tether', (0.95, 0.75, 0.2), 0.5))
    angara = [stage('ang', 0.12, 0, 1.8, WHITE(), 0, 0), nose('angn', 0.12, 1.8, 0.3, WHITE(), 0, 0)]
    C.group('angara', angara, (-2.6, 6, 1.2), (math.radians(20), 0, 0))
    space_light()
    K.camera((0, -20.2, 8.9), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36


def makers_guild(back):
    """Makers Guild: a boxy kit-bashed tug of mismatched printed modules docked
    at a busy trade-port station, cargo racks and a big 3D-printer arm; guild
    craftspeople in aprons. Back: the trade port."""
    rnd = random.Random(11)
    cols = [(0.7, 0.35, 0.05), (0.4, 0.42, 0.48), (0.06, 0.45, 0.4), (0.6, 0.62, 0.66), (0.62, 0.38, 0.05)]
    dock = m('dock', (0.35, 0.37, 0.42), 0.5, 0.5)
    box('quay', (12, 2.5, 0.5), dock, (0, 0.5, 3.2))
    for i in range(6):
        h = rnd.uniform(0.6, 1.2) if not back else rnd.uniform(1.2, 2.4)
        box(f'rack{i}', (1.2, 1.0, h), m(f'rk{i}', cols[i % 5], 0.6, 0.2), (-4.8 + i * 1.3, 1.0, 3.45 + h / 2))
    if not back:
        mods = []
        for i in range(6):
            sx, sz = rnd.uniform(0.6, 1.0), rnd.uniform(0.6, 1.1)
            mods.append(box(f'mod{i}', (sx, 0.8, sz), m(f'md{i}', cols[i % 5], 0.6, 0.3), (rnd.uniform(-0.3, 0.3), 0, i * 0.9)))
        mods += bells('tugeng', 0, 0, -0.4, 0.25, 2, 0.25)
        C.group('tug', mods, (RX, -0.4, 4.4), (0, 0, 0))
        arm = m('arm', (0.95, 0.75, 0.2), 0.4, 0.6)
        rod('arm1', (RX - 1.6, 0.3, 3.4), (RX - 1.3, 0.3, 6.4), 0.12, arm)
        rod('arm2', (RX - 1.3, 0.3, 6.4), (RX - 0.5, -0.2, 7.0), 0.1, arm)
        sphere('nozzle', 0.12, mat_glow('print', (1.0, 0.6, 0.2), 15), (RX - 0.45, -0.25, 6.95), 12)
    else:
        for i in range(3):
            box(f'ship{i}', (0.9, 0.8, 1.6), m(f'sh{i}', cols[(i + 2) % 5], 0.6, 0.3), (-3 + i * 2.6, -0.3, 6.0 + (i % 2) * 0.8))
        torus('ring', 3.0, 0.3, dock, (0, 3.0, 9.0), (math.radians(90), 0, 0))
    figures('maker', -3.2, 3, z=3.45, helmet=False, coat=(0.55, 0.38, 0.2))
    space_light()
    K.camera((0, -20.2, 8.9), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36


def new_pilgrims(back):
    """New Pilgrims: settlers in plain dark coats and white collars watching a
    huge translucent stratospheric balloon lift a slim rocket on a long rig
    line at dawn - a rockoon. Back: the rocket fires off the balloon."""
    film = mat_glow('balloon', (1.0, 0.92, 0.85), 1.2, 0.45)   # translucent, lit by the dawn
    bal = sphere('balloon', 2.2, film, (RX - 0.6, 2.0, 10.6), 48)
    bal.scale = (1, 1, 0.8)
    rz = 5.6 if not back else 6.4
    rk = [stage('pil', 0.14, 0, 2.2, WHITE(), 0, 0), nose('piln', 0.14, 2.2, 0.4, WHITE(), 0, 0)]
    rk += fins(0, 0, 0.2, 0.15, 4, (0.03, 0.25, 0.35))
    if back:
        rk.append(lathe('pilflame', [(0.0, 0.0), (0.12, 0.0), (0.0, -1.6)], mat_glow('pf', (1.0, 0.75, 0.35), 18, 0.7), segs=16))
    C.group('rocket', rk, (RX, 0, rz), (0, math.radians(10) if back else 0, 0))
    if not back:
        rod('rigline', (RX, 0, rz + 2.6), (RX - 0.6, 2.0, 8.9), 0.015, DARK())
    for i in range(4):
        figure(f'pilgrim{i}', -3.6 + i * 0.5, helmet=False, hat='top' if i % 2 else None, coat=(0.08, 0.08, 0.1))
        box(f'collar{i}', (0.2, 0.2, 0.05), WHITE(), (-3.6 + i * 0.5, -1.05, 0.85))
    ground((0.6, 0.62, 0.55))
    shoot()
    bpy.data.objects['sun'].rotation_euler = (Vector((0, 0, 0)) - Vector((-0.9, 0.2, 0.15))).to_track_quat('-Z', 'Y').to_euler()
    bpy.data.objects['sun'].data.color = (1.0, 0.75, 0.5)


def utopia(back):
    """Utopia, Inc.: a sleek small launcher on a glowing aerospike (a crown-
    shaped base, the flame hugging the spike, no bell) over a pristine garden-
    city campus. Back (Piggyback): a small rocket riding on a bigger one."""
    w = WHITE()
    z0 = 1.2
    stage('uto', 0.36, z0, z0 + 5.2, w)
    nose('uton', 0.36, z0 + 5.2, 1.2, w)
    spike = lathe('spike', [(0.36, z0), (0.2, z0 - 0.6), (0.0, z0 - 0.7)], m('spikem', (0.75, 0.77, 0.8), 0.3, 1.0), segs=32)
    spike.location = (RX, 0, 0)
    lathe('spikeflame', [(0.3, z0 - 0.05), (0.38, z0 - 0.05), (0.08, z0 - 1.6), (0.0, z0 - 1.7)], mat_glow('spf', (0.6, 0.85, 1.0), 12, 0.6), segs=32).location = (RX, 0, 0)
    if back:
        rider = [stage('rider', 0.15, 0, 1.6, w, 0, 0), nose('ridern', 0.15, 1.6, 0.4, w, 0, 0)]
        C.group('rider', rider, (RX - 0.55, 0, z0 + 2.2), (0, 0, 0))
    glass = m('glass', (0.85, 0.92, 0.95), 0.1)
    rnd = random.Random(4)
    for i in range(4):
        h = 1.0 + i * 0.4
        x = -4.8 + i * 1.3
        box(f'tower{i}', (0.9, 0.9, h), glass, (x, 2.0, h / 2))
        sphere(f'tree{i}', 0.45, m('treeg', (0.15, 0.6, 0.25), 0.7), (x + 0.4, 0.4, 0.45), 16)
    ground((0.5, 0.8, 0.5))
    shoot()


def galahad(back):
    """Galahad Group: a heavy white-and-silver launcher rising into a shaft of
    sunlight; a crew member in a knightly tabard over the suit. Back (Quest): a
    lone figure on a distant moon beside a grail-shaped dish antenna."""
    if not back:
        w = WHITE()
        silver = m('silver', (0.8, 0.82, 0.85), 0.25, 1.0)
        z0 = 1.6
        stage('gal', 0.55, z0, z0 + 5.4, w)
        stage('galup', 0.55, z0 + 5.4, z0 + 6.6, silver)
        nose('galn', 0.55, z0 + 6.6, 1.3, w)
        for s in (-1, 1):
            booster(f'galb{s}', 0.28, z0, z0 + 3.8, silver, RX + s * 0.85, 0)
        liftoff(RX, 9, 1.8, 0.6, 1.0)
        beam = lathe('sunshaft', [(0.6, -1.0), (1.8, 12.0)], mat_glow('shaft', (1.0, 0.93, 0.7), 1.2, 0.25), segs=32)
        beam.location = (RX, 0, 0)
        figure('knight', -2.8, suit=(0.9, 0.9, 0.9))
        box('tabard', (0.32, 0.05, 0.45), m('tabard', fc((0.89, 0.88, 0.83)), 0.6), (-2.8, -1.16, 0.6))
        box('cross', (0.06, 0.06, 0.3), m('tcross', (0.75, 0.1, 0.1), 0.5), (-2.8, -1.2, 0.62))
        ground((0.6, 0.6, 0.56))
        shoot()
        return
    R = 40.0
    sphere('moon', R, m('regolith', (0.6, 0.6, 0.58), 0.95), (0, 18, -R + 1.0), 128)
    st = m('grail', (0.85, 0.7, 0.3), 0.3, 1.0)
    lathe('grail', [(0.6, 0.6), (0.15, 0.9), (0.12, 2.0), (0.9, 2.5), (1.4, 3.4), (1.3, 3.45), (0.85, 2.6), (0.0, 2.4)], st, segs=48).location = (RX, -0.5, 0.3)
    figure('lone', RX - 1.8, y=-0.6, z=0.6)
    planet('earth', 1.2, (-3.0, 30, 12.0), (0.15, 0.4, 0.8), (0.05, 0.15, 0.4), 0.4)
    K.camera((0, -20.2, 8.0), (0, 0, 6.8), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36
    sun((0.8, -0.3, 0.35), 4.5)


def cryptobankers(back):
    """Brotherhood of Cryptobankers - Roton C-9: the Rotary Rocket's squat cone
    with four helicopter rotor blades on its nose and a ring of jets round its
    rotating annular aerospike base, at night; cloaked figures. Back (Chairman's
    Cut): the same with coins in hex tokens, no text."""
    z0 = 1.0
    cone = lathe('roton', [(1.1, z0), (0.9, z0 + 2.5), (0.4, z0 + 5.0), (0.15, z0 + 5.4), (0.0, z0 + 5.45)], m('rotonm', (0.85, 0.85, 0.86), 0.35, 0.3), segs=48)
    cone.location = (RX, 0, 0)
    cyl('hub', 0.12, 0.4, DARK(), (RX, 0, z0 + 5.6), verts=16)
    for k in range(4):
        a = k * TAU / 4 + 0.3
        box(f'blade{k}', (2.4, 0.12, 0.03), DARK(), (RX + 1.2 * math.cos(a), 1.2 * math.sin(a), z0 + 5.75), (0, 0, a))
    for k in range(12):
        a = k * TAU / 12
        lathe(f'jet{k}', [(0.0, z0), (0.08, z0), (0.0, z0 - 0.7)], mat_glow(f'j{k}', (1.0, 0.6, 0.3), 12, 0.7), segs=12).location = (RX + 0.95 * math.cos(a), 0.95 * math.sin(a), 0)
    pad()
    ground((0.1, 0.09, 0.08))
    for i in range(3):
        figure(f'cloak{i}', -3.6 + i * 0.5, helmet=False, coat=fc((0.45, 0.0, 0.18)))
        lathe(f'hood{i}', [(0.14, 0.95), (0.0, 1.2)], m('hood', fc((0.45, 0.0, 0.18)), 0.6), segs=16).location = (-3.6 + i * 0.5, -1.0, 0)
    if back:
        gold = m('gold', (0.95, 0.72, 0.2), 0.25, 1.0)
        rnd = random.Random(6)
        for i in range(10):
            bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.32, depth=0.06, location=(rnd.uniform(-4, 0.5), rnd.uniform(-1.5, 0.5), rnd.uniform(1.5, 5.5)),
                                                rotation=(rnd.uniform(0.6, 1.5), rnd.uniform(-0.5, 0.5), 0))
            bpy.context.active_object.data.materials.append(gold)
    shoot()
    bpy.data.objects['sun'].data.energy = 0.8
    area('padlight', (RX - 2.5, -3, 1.0), 400, 1.5, (1.0, 0.75, 0.5))


def verisai(back):
    """VerisAI: a heavy, pristine, sensor-studded launcher on a pad built like a
    data centre (server racks, cooling towers), an android crew member. Back
    (Cavitation Engineers): the vehicle punching through the air in a bubble-
    like shock cavity."""
    w = WHITE()
    z0 = 1.0
    stage('ver', 0.6, z0, z0 + 6.0, w)
    nose('vern', 0.6, z0 + 6.0, 1.6, w)
    bells('vereng', RX, 0, z0, 0.22, 5, 0.32)
    sens = mat_glow('sensor', (0.4, 0.8, 1.0), 10)
    for k in range(10):
        a = k * 2.4
        sphere(f'sensor{k}', 0.05, sens, (RX + 0.6 * math.cos(a), 0.6 * math.sin(a) - 0.0, z0 + 0.8 + k * 0.55), 8)
    if not back:
        for i in range(5):
            box(f'rack{i}', (0.6, 0.8, 1.6), DARK(), (-4.4 + i * 0.75, 1.4, 0.8))
            for j in range(4):
                box(f'led{i}{j}', (0.4, 0.02, 0.04), sens, (-4.4 + i * 0.75, 0.99, 0.4 + j * 0.35))
        for i in range(2):
            lathe(f'cool{i}', [(0.9, 0.0), (0.6, 1.4), (0.7, 2.2), (0.65, 2.2), (0.55, 1.4), (0.85, 0.0)], m('cool', (0.85, 0.85, 0.83), 0.6), segs=32).location = (-1.6 + i * 2.0, 4.0, 0)
        figure('android', -1.0, suit=(0.8, 0.82, 0.86), helmet=True)
        pad()
        ground((0.62, 0.64, 0.66))
    else:
        cav = m('cavity', (0.8, 0.9, 1.0), 0.05)
        cav.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.9
        cav.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.35
        shell = lathe('shock', [(0.0, z0 + 8.4), (1.0, z0 + 7.0), (1.6, z0 + 4.0), (1.9, z0 + 0.5), (2.0, z0 - 1.0)], cav, segs=64)
        shell.location = (RX, 0, 0)
        lathe('trail', [(0.0, z0), (0.6, z0), (1.4, z0 - 4.0), (0.0, z0 - 4.2)], mat_glow('trail', (1.0, 0.8, 0.5), 5, 0.5), segs=32).location = (RX, 0, 0)
    shoot()


def heliocentricity(back):
    """Heliocentricity: a sundiver craft behind a big white heat shield against
    the solar disc and its prominences (the Parker Solar Probe look). Back:
    looping chaotic transfer paths drawn as orbit spirographs."""
    # low emission strength: AgX bleaches a bright disc to cream
    disc = sphere('sun', 6.0, mat_glow('sunm', (1.0, 0.4, 0.04), 1.6), (-1.0, 26, 3.2), 64)
    for k in range(5):
        a = 0.6 + k * 0.5
        p = Vector((-1.0 + 6.0 * math.cos(a), 26, 3.2 + 6.0 * math.sin(a)))
        q = p + Vector((math.cos(a), 0, math.sin(a))) * 1.6
        tube(f'prom{k}', [p, (p + q) / 2 + Vector((0.6, 0, 0.6)), q], 0.25, mat_glow(f'pr{k}', (1.0, 0.45, 0.15), 6, 0.6))
    if not back:
        shield = cyl('shield', 1.1, 0.15, m('shieldw', (0.96, 0.96, 0.95), 0.6), (RX - 0.4, -1.0, 6.0), (math.radians(80), 0, math.radians(-15)), 48)
        body = [cyl('bus', 0.35, 0.8, m('busm', (0.85, 0.62, 0.2), 0.3, 1.0), (0, 0, 0), verts=6),
                box('pvw1', (1.2, 0.04, 0.4), m('pv', (0.05, 0.08, 0.28), 0.25, 0.6), (0.8, 0, 0)),
                box('pvw2', (1.2, 0.04, 0.4), m('pv2', (0.05, 0.08, 0.28), 0.25, 0.6), (-0.8, 0, 0)),
                rod('mast', (0, 0, 0.4), (0, 0, 1.2), 0.03, DARK())]
        C.group('probe', body, (RX - 0.3, -2.0, 5.8), (math.radians(80), 0, math.radians(-15)))
    else:
        gold = mat_glow('orbit', (1.0, 0.85, 0.4), 4)
        for j, (a, b, sc) in enumerate([(3, 2, 2.6), (5, 3, 2.0), (7, 4, 1.4)]):
            pts = []
            for i in range(361):
                t = i * TAU / 360
                pts.append((RX - 1.0 + sc * (math.cos(a * t) * 0.6 + 0.4 * math.cos(b * t)), -1.0, 6.0 + sc * (math.sin(a * t) * 0.6 - 0.4 * math.sin(b * t))))
            tube(f'spiro{j}', pts, 0.025, gold)
    space_light((0.2, -0.9, 0.3))
    K.camera((0, -20.2, 8.9), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36


def cerulean(back):
    """Cerulean (water-world people): New Glenn's first stage settling onto a
    landing ship in a cerulean ocean. Back (Dowsers): a crew member with a
    forked dowsing rod over an icy moon surface."""
    if not back:
        new_glenn_landing()
        return
    R = 40.0
    ice = m('icemoon', (0.82, 0.9, 0.96), 0.35)
    sphere('moon', R, ice, (0, 18, -R + 1.0), 128)
    crack = m('crack', (0.6, 0.35, 0.2), 0.8)
    for k in range(5):
        a = -0.5 + k * 0.25
        tube(f'crack{k}', [(-6 + k * 2.5, 10, 0.4), (-4 + k * 2.3, 2, 0.95), (-3 + k * 2.2, -2, 1.0)], 0.05, crack)
    suit = fc((0.89, 0.88, 0.83))
    figure('dowser', RX - 0.5, y=-1.0, z=1.0, suit=suit, arms='forward', s=1.6)
    rod('rod1', (RX + 0.2, -1.4, 2.05), (RX + 0.75, -1.85, 1.75), 0.03, m('wood', (0.4, 0.26, 0.14), 0.6))
    rod('rod2', (RX + 0.75, -1.85, 1.75), (RX + 1.1, -2.1, 1.85), 0.025, m('wood2', (0.4, 0.26, 0.14), 0.6))
    rod('rod3', (RX + 0.75, -1.85, 1.75), (RX + 1.05, -2.05, 1.55), 0.025, m('wood3', (0.4, 0.26, 0.14), 0.6))
    planet('gas', 4.0, (-3.0, 40, 14.0), (0.35, 0.55, 0.85), (0.2, 0.35, 0.6), 0.6)
    K.camera((0, -20.2, 8.0), (0, 0, 6.8), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36
    sun((0.8, -0.3, 0.35), 4.5)


CARDS = {
    'crew_brin': brin,
    'crew_the_sea_peoples': sea_peoples,
    'crew_the_martian_way': martian_way,
    'crew_jaxa': jaxa,
    'crew_space_force': space_force,
    'crew_aeb': aeb,
    'crew_explorers_without_borders': explorers,
    'crew_baltimore_gun_club': gun_club,
    'crew_african_union_space_directorate': african_union,
    'crew_leo_workers_union': leo_workers,
    'crew_makers_guild': makers_guild,
    'crew_new_pilgrims': new_pilgrims,
    'crew_utopia_inc': utopia,
    'crew_galahad_group': galahad,
    'crew_brotherhood_of_cryptobankers': cryptobankers,
    'crew_verisai': verisai,
    'crew_heliocentricity': heliocentricity,
    'crew_cerulean': cerulean,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=20)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    keys = [f'{cid}-{side}' for cid in CARDS for side in ('front', 'back')]
    for k in [k for k in keys if not a.only or k in a.only.split(',')]:
        cid, side = k.rsplit('-', 1)
        sc = K.reset(a.samples)
        sc.render.resolution_x, sc.render.resolution_y = C.CW, C.CH
        CARDS[cid](side == 'back')
        sc.render.filepath = os.path.join(a.out, f'{k}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', k, flush=True)


if __name__ == '__main__':
    main()
