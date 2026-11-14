"""Blender card art: the core crew deck (6 cards, 12 faces).

Each crew face is a FACTION and its launcher, so each scene is that launcher
on (or leaving) its home pad, the same briefs as the per-face comments in
scripts/card-art/crew.mjs. Real vehicles keep their real silhouettes (stage
count, boosters, fairing, colours). No logos, flags or lettering anywhere.

Card rules: the canvas is the face below the name bar (300x440, rendered at
600x880). The top ~40% stays light for the privilege text, the rocket stands
in the right third, and the thrust triangle sits bottom-centre. Both crew
faces are cream, so everything renders on a transparent film (no sky box).

Every launcher is built at the same height (~10 units, ground at z=0) and
`shoot` frames it the same way, so the deck reads as one set.

Run:
    python scripts/card-art/blender/render_crew.py --out DIR [--only key,key] [--samples 20]
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
sys.path.insert(0, os.path.join(HERE, '..', '..', 'blender'))
import render_bernal_megastructures as K  # noqa: E402
from render_thruster_art import (  # noqa: E402
    TAU, box, cyl, group, lathe, mat_glow, mat_metal, rod, sphere, sun, torus,
    tube, area, truss)

CW, CH = 600, 880
RX = 2.9   # the rocket's x: the right third of the card


def m(name, c, r=0.45, metal=0.0):
    return mat_metal(name, c, r, metal)


WHITE = lambda: m('white', (0.9, 0.9, 0.9), 0.4)  # noqa: E731
DARK = lambda: m('dark', (0.06, 0.06, 0.07), 0.5)  # noqa: E731


def stage(name, r, z0, z1, mat, x=RX, y=0.0):
    return cyl(name, r, z1 - z0, mat, (x, y, (z0 + z1) / 2), verts=48)


def nose(name, r, z, h, mat, x=RX, y=0.0, blunt=0.0):
    prof = [(r, z)]
    for i in range(1, 9):
        t = i / 8
        prof.append((r * math.sqrt(max(0.0, 1 - t * t)) * (1 - blunt) + r * blunt * (1 - t), z + h * t))
    prof.append((0.0, z + h))
    ob = lathe(name, prof, mat, segs=48)
    ob.location = (x, y, 0)
    return ob


def bells(name, x, y, z, r, n, ring):
    out = []
    for i in range(n):
        a = i * TAU / max(n, 1)
        cx, cy = (x + ring * math.cos(a), y + ring * math.sin(a)) if n > 1 else (x, y)
        b = lathe(f'{name}{i}', [(r * 0.45, z), (r, z - r * 1.4), (r * 0.92, z - r * 1.4), (r * 0.4, z - 0.05)], m('bell', (0.3, 0.3, 0.33), 0.35, 0.8), segs=24)
        b.location = (cx, cy, 0)
        out.append(b)
    return out


def booster(name, r, z0, z1, mat, x, y, joints=0):
    out = [stage(name, r, z0, z1, mat, x, y), nose(name + '.nose', r, z1, r * 2.6, mat, x, y)]
    for k in range(joints):
        z = z0 + (z1 - z0) * (k + 1) / (joints + 1)
        out.append(torus(f'{name}.j{k}', r * 1.01, 0.03, DARK(), (x, y, z)))
    out += bells(name + '.bell', x, y, z0, r * 0.7, 1, 0)
    return out


def capsule_les(name, r, z, x=RX):
    cap = lathe(name, [(r, z), (r * 0.45, z + r * 1.0), (0.0, z + r * 1.05)], WHITE(), segs=32)
    cap.location = (x, 0, 0)
    tower = [rod(f'{name}.les', (x, 0, z + r), (x, 0, z + r * 3.2), 0.05, DARK())]
    tip = nose(f'{name}.motor', 0.12, z + r * 2.6, 0.5, m('lesred', (0.7, 0.08, 0.06), 0.4), x)
    return [cap, *tower, tip]


def liftoff(x, seed, flame_len=2.2, r=0.6, cloud=1.0):
    rnd = random.Random(seed)
    out = [lathe('flame', [(0.0, 0.0), (r, 0.0), (r * 0.6, -flame_len), (0.0, -flame_len * 1.1)], mat_glow('flame', (1.0, 0.75, 0.35), 18, 0.7))]
    out[0].location = (x, 0, 0.0)
    smoke = m('smoke', (0.95, 0.95, 0.95), 0.9)
    for i in range(int(16 * cloud)):
        out.append(sphere(f'cloud{i}', rnd.uniform(0.5, 1.1) * cloud, smoke,
                          (x + rnd.uniform(-3.2, 2.2) * cloud, rnd.uniform(-1.0, 1.5), rnd.uniform(0.0, 0.7)), 20))
    return out


def ground(color, depth=40.0, x0=-30, x1=30):
    return box('ground', (x1 - x0, depth, 0.4), m('ground', color, 0.85), ((x0 + x1) / 2, depth / 2 - 2.0, -0.2))


def tower(x, h, arms=(0.35, 0.6, 0.85), to=RX - 0.5):
    st = m('tower', (0.35, 0.37, 0.4), 0.5, 0.6)
    out = truss('tower', 0.0, h, 0.32, st, bays=max(4, int(h / 0.9)))
    out = [o for o in out]
    for o in out:
        o.location = (x, 0, 0)
    for k in arms:
        out.append(rod(f'arm{k}', (x + 0.3, 0, h * k), (to, 0, h * k), 0.05, st))
    return out


def pad(x=RX):
    return [box('pad', (2.4, 2.4, 0.25), m('padc', (0.35, 0.33, 0.3), 0.8), (x, 0, 0.12))]


def crew_figures(color, x=-3.6, n=3):
    suit = m('suit', color, 0.5)
    out = []
    for i in range(n):
        cx = x + i * 0.42
        out.append(cyl(f'fig{i}', 0.14, 0.5, suit, (cx, -1.0, 0.25), verts=16))
        out.append(sphere(f'helm{i}', 0.13, WHITE(), (cx, -1.0, 0.62), 16))
    return out


def shoot(look_z=8.9, cam_z=10.4, dist=20.2, lens=35, x=0.0):
    """One framing for the deck: ground near the bottom, launcher tops a bit
    under the 40% line, the launcher (built at x=RX) in the right third."""
    K.camera((x, -dist, cam_z), (x, 0, look_z), lens, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit = 'VERTICAL'
    c.sensor_height = 36
    sun((0.6, -0.7, 0.5), 4.0)
    area('fill', (-6, -8, 6), 600, 6, (0.75, 0.82, 1.0))


def flag_free_colour(c):
    return tuple(pow(v, 2.2) for v in c)


# ---- the twelve faces ---------------------------------------------------------

def liberty():
    """UN Cosmonauts - Liberty: a five-segment solid first stage (white, black
    joints) under a wider Vulcain-powered core stage and a crew capsule with its
    escape tower, lifting off in a column of solid-rocket smoke."""
    w = WHITE()
    stage('srb', 0.3, 0.3, 5.2, w)   # 3.7 m solid, narrower than the 5.4 m stage above
    for k in range(4):
        torus(f'joint{k}', 0.31, 0.035, DARK(), (RX, 0, 1.3 + k * 0.98))
    lathe('interstage', [(0.3, 5.2), (0.52, 5.7), (0.0, 5.7)], m('inter', (0.75, 0.75, 0.75), 0.4)).location = (RX, 0, 0)
    stage('core', 0.52, 5.7, 8.4, w)
    torus('coreband', 0.53, 0.04, DARK(), (RX, 0, 8.3))
    capsule_les('cap', 0.5, 8.4)
    bells('nozzle', RX, 0, 0.3, 0.3, 1, 0)
    tower(RX - 1.3, 8.6)
    pad()
    liftoff(RX, 1, 1.6, 0.45, 1.0)
    ground((0.66, 0.64, 0.6))
    crew_figures(flag_free_colour((0.98, 0.84, 0.2)))
    shoot()


def new_glenn_stage(z0=0.9, w=None, glow_mat=None):
    """New Glenn's first stage: 7 m, four aft fins, two strakes, seven BE-4s."""
    w = w or WHITE()
    stage('booster', 0.6, z0, z0 + 7.0, w)
    torus('band', 0.61, 0.05, DARK(), (RX, 0, z0 + 6.6))
    for k in range(4):
        a = k * TAU / 4 + 0.4
        box(f'fin{k}', (0.06, 0.6, 1.0), w, (RX + 0.62 * math.cos(a), 0.62 * math.sin(a), z0 + 6.1), (0, 0, a))
    for k in range(2):
        a = k * math.pi + 0.3
        box(f'strake{k}', (0.05, 0.5, 1.6), w, (RX + 0.62 * math.cos(a), 0.62 * math.sin(a), z0 + 1.5), (0, 0, a))
    lathe('cap', [(0.6, z0 + 7.0), (0.55, z0 + 7.15), (0.0, z0 + 7.2)], w).location = (RX, 0, 0)
    bells('eng', RX, 0, z0, 0.18, 7, 0.36)


def new_glenn_landing():
    """New Glenn's first stage settling onto its landing ship at sea, legs out
    (used by Cerulean's white face)."""
    z0 = 0.9
    new_glenn_stage(z0)
    for k in range(4):
        a = k * TAU / 4 + 0.4
        rod(f'leg{k}', (RX + 0.55 * math.cos(a), 0.55 * math.sin(a), z0 + 1.2), (RX + 1.3 * math.cos(a), 1.3 * math.sin(a), 0.62), 0.06, DARK())
    flame = lathe('flame', [(0.0, z0), (0.4, z0), (0.2, 0.62), (0.0, 0.55)], mat_glow('flame', (1.0, 0.7, 0.35), 15, 0.7))
    flame.location = (RX, 0, 0)
    box('ship', (5.0, 2.6, 0.5), m('ship', (0.3, 0.32, 0.36), 0.6, 0.4), (RX, 0, 0.35))
    box('sea', (60, 60, 0.2), m('sea', (0.0, 0.32, 0.55), 0.12), (0, 28, 0.0))
    shoot()


def new_glenn():
    """B612 - New Glenn on its pad at night, in an infrared false-colour glow
    (B612's Sentinel was an infrared asteroid hunter), the telescope overhead
    and two faint asteroid streaks (the blink-comparator pair)."""
    ir = principled_ir()
    new_glenn_stage(0.4, ir)
    tower(RX - 1.5, 8.6, to=RX - 0.6)
    pad()
    ground((0.05, 0.05, 0.08))
    for k in range(3):
        area(f'flood{k}', (RX - 3 + k * 3, -4, 0.5), 300, 1, (1.0, 0.45, 0.2))
    cyl('scope', 0.25, 0.9, m('foil', (0.85, 0.62, 0.2), 0.3, 1.0), (-2.4, 0, 9.0), (0, math.radians(60), 0.4))
    box('shade', (1.2, 0.05, 0.9), m('shadeb', (0.75, 0.77, 0.8), 0.4, 0.4), (-2.6, 0.2, 8.6), (0.2, math.radians(60), 0.4))
    streak = mat_glow('streak', (1.0, 0.6, 0.3), 6, 0.6)
    rod('ast1', (-3.2, 2, 7.0), (-2.2, 2, 7.25), 0.04, streak)
    rod('ast2', (-2.6, 2, 6.6), (-1.6, 2, 6.85), 0.04, streak)
    K.camera((0, -20.2, 10.4), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36
    sun((0.6, -0.7, 0.5), 0.6, (0.6, 0.7, 1.0))


def principled_ir():
    """An infrared false-colour skin: warm magenta-orange glowing from within."""
    mt = m('irskin', (0.55, 0.15, 0.3), 0.5)
    b = mt.node_tree.nodes['Principled BSDF']
    b.inputs['Emission Color'].default_value = (1.0, 0.35, 0.15, 1)
    b.inputs['Emission Strength'].default_value = 0.9
    return mt


def angara():
    """Roscosmos - Angara A5: five IDENTICAL white URM-1 cylinders (a core and
    four strap-ons of the same width), each strap-on capped by a plain conical
    nose, under a wider fairing, in the service tower at snowbound Vostochny
    with bare birches."""
    w = WHITE()
    r = 0.36
    stage('core', r, 0.4, 7.2, w)
    stage('upper', r, 7.2, 8.0, w)
    lathe('fair', [(r, 8.0), (0.5, 8.25), (0.5, 9.1), (0.3, 9.6), (0.0, 9.75)], w).location = (RX, 0, 0)
    for k in range(4):
        a = k * TAU / 4 + 0.785
        x, y = RX + 2 * r * math.cos(a), 2 * r * math.sin(a)
        stage(f'urm{k}', r, 0.4, 5.6, w, x, y)
        cone = lathe(f'urm{k}.nose', [(r, 5.6), (0.0, 6.5)], w, segs=32)
        cone.location = (x, y, 0)
        bells(f'urm{k}.bell', x, y, 0.4, 0.22, 1, 0)
    bells('coreeng', RX, 0, 0.4, 0.22, 1, 0)
    tower(RX - 1.4, 9.4)
    pad()
    ground((0.93, 0.95, 0.98))
    bark = m('birch', (0.92, 0.9, 0.86), 0.7)
    twig = m('twig', (0.2, 0.18, 0.16), 0.8)
    rnd = random.Random(3)
    for i in range(6):
        x, y = -5.2 + i * 1.0, rnd.uniform(0.8, 3.0)
        h = rnd.uniform(2.2, 3.2)
        rod(f'birch{i}', (x, y, 0), (x, y, h), 0.07, bark)
        for k in range(5):
            z = h * (0.45 + k * 0.11)
            a = rnd.uniform(0, TAU)
            rod(f'br{i}{k}', (x, y, z), (x + 0.6 * math.cos(a), y + 0.6 * math.sin(a), z + 0.45), 0.02, twig)
    shoot()


def long_march_9():
    """Taikonauts - Long March 9 (current design): no boosters - one fat
    10.6 m white core over a broad cluster of methane engines, at Wenchang's
    coastal pad among coconut palms; crew in red-trimmed white suits."""
    w = WHITE()
    grey = m('greyband', (0.45, 0.46, 0.48), 0.4)
    r = 0.78
    stage('core', r, 0.6, 7.4, w)
    for z in (2.6, 5.4):
        torus(f'band{z}', r * 1.01, 0.07, grey, (RX, 0, z))
    stage('upper', r, 7.4, 8.4, w)
    lathe('fair', [(r, 8.4), (0.8, 9.0), (0.5, 9.7), (0.0, 9.95)], w).location = (RX, 0, 0)
    bells('core', RX, 0, 0.6, 0.15, 9, 0.5)
    bells('centre', RX, 0, 0.6, 0.15, 1, 0)
    tower(RX - 1.9, 9.6, to=RX - 0.8)
    pad()
    ground((0.86, 0.8, 0.62))
    box('sea', (60, 60, 0.2), m('sea', (0.05, 0.25, 0.45), 0.2), (0, 34, 0.0))
    for i, x in enumerate((-4.4, -3.2, -1.9)):
        rod(f'palm{i}', (x, 0.5, 0), (x + 0.3, 0.5, 2.6), 0.07, m('trunk', (0.4, 0.28, 0.15), 0.8))
        for k in range(6):
            a = k * TAU / 6
            rod(f'frond{i}{k}', (x + 0.3, 0.5, 2.6), (x + 0.3 + 0.9 * math.cos(a), 0.5 + 0.9 * math.sin(a), 2.3), 0.06, m('leaf', (0.1, 0.45, 0.15), 0.7))
    crew_figures(flag_free_colour((0.95, 0.95, 0.95)), x=-0.9)
    shoot()


def sls():
    """NASA - SLS Block II: the orange core stage between two white five-
    segment boosters, the upper stage, the crew capsule and escape tower; the
    big assembly building on the horizon."""
    orange = m('orange', (0.85, 0.35, 0.08), 0.6)
    w = WHITE()
    stage('core', 0.5, 0.4, 6.4, orange)
    stage('eus', 0.5, 6.4, 7.6, w)
    lathe('adapter', [(0.5, 7.6), (0.38, 8.0), (0.0, 8.0)], w).location = (RX, 0, 0)
    capsule_les('orion', 0.38, 8.0)
    for s in (-1, 1):
        booster(f'srb{s}', 0.3, 0.4, 5.9, w, RX + s * 0.82, 0, joints=4)
    bells('rs25', RX, 0, 0.4, 0.18, 4, 0.25)
    tower(RX - 1.6, 9.0, to=RX - 0.5)
    pad()
    box('vab', (2.6, 2.2, 3.4), m('vab', (0.82, 0.82, 0.8), 0.6), (-3.6, 6.0, 1.7))
    for k in range(3):
        box(f'vabstripe{k}', (0.3, 0.05, 2.8), m('vabdoor', (0.55, 0.57, 0.6), 0.6), (-4.4 + k * 0.8, 4.88, 1.6))
    ground((0.55, 0.62, 0.45))
    shoot()


def gslv():
    """ISRO - GSLV Mk III: two huge solid boosters beside a slimmer liquid core,
    topped by a bulbous fairing wider than the core; a coastal launch range."""
    w = WHITE()
    stage('core', 0.38, 0.4, 6.4, w)
    stage('cryo', 0.38, 6.4, 7.4, m('cryo', (0.85, 0.85, 0.82), 0.5))
    lathe('fair', [(0.38, 7.4), (0.62, 7.8), (0.62, 8.9), (0.42, 9.6), (0.0, 9.8)], w).location = (RX, 0, 0)
    for s in (-1, 1):
        booster(f's200{s}', 0.42, 0.4, 5.6, w, RX + s * 0.86, 0, joints=2)
    bells('vikas', RX, 0, 0.4, 0.15, 2, 0.15)
    tower(RX - 1.8, 9.0, to=RX - 1.1)
    pad()
    ground((0.8, 0.75, 0.6))
    box('sea', (60, 60, 0.2), m('sea', (0.08, 0.35, 0.5), 0.2), (0, 34, 0.0))
    crew_figures(flag_free_colour((0.95, 0.95, 0.95)))
    shoot()


def skylon():
    """Anonymous P2P - Skylon: the single-stage spaceplane, white, with its two
    wingtip engine nacelles and canards, climbing off a long runway."""
    w = WHITE()
    body = lathe('fuse', [(0.0, -4.2), (0.25, -3.6), (0.42, -2.5), (0.45, 0.0), (0.45, 2.5), (0.3, 3.6), (0.0, 4.4)], w, segs=40)
    wing = box('wing', (3.6, 1.6, 0.08), w, (0, 0, -0.2))
    nac = []
    for s in (-1, 1):
        nac.append(lathe(f'nac{s}', [(0.0, -1.2), (0.2, -0.9), (0.26, 0.0), (0.22, 0.9), (0.05, 1.3)], w, segs=24))
        nac[-1].location = (s * 1.8, 0, -0.2)
        nac.append(lathe(f'nacflame{s}', [(0.0, -1.1), (0.18, -1.1), (0.0, -2.6)], mat_glow(f'sab{s}', (1.0, 0.55, 0.45), 15, 0.7), segs=16))
        nac[-1].location = (s * 1.8, 0, -0.2)
        nac.append(box(f'canard{s}', (0.7, 0.4, 0.05), w, (s * 0.6, 0, 2.6)))
    fin = box('fin', (0.05, 0.9, 0.7), w, (0, 0.45, -3.3))
    group('skylon', [body, wing, *nac, fin], (RX - 1.0, 0, 4.0), (math.radians(-65), 0, math.radians(-25)))
    box('runway', (16, 3.0, 0.2), m('runway', (0.3, 0.3, 0.32), 0.8), (0, 0.5, 0.0))
    for i in range(6):
        box(f'dash{i}', (0.8, 0.12, 0.02), WHITE(), (-6 + i * 2.4, 0.5, 0.11))
    ground((0.6, 0.62, 0.55))
    crew_figures(flag_free_colour((0.66, 0.85, 0.75)))
    shoot()


def ariane_64():
    """ESA - Ariane 64: a white core with four solid strap-ons and a tall
    fairing, rising out of the green coast of a tropical spaceport."""
    w = WHITE()
    z = 1.6
    stage('core', 0.42, z, z + 5.0, w)
    stage('upper', 0.42, z + 5.0, z + 6.0, m('upper', (0.85, 0.85, 0.85), 0.5))
    lathe('fair', [(0.45, z + 6.0), (0.47, z + 7.4), (0.3, z + 8.1), (0.0, z + 8.3)], w).location = (RX, 0, 0)
    for k in range(4):
        a = k * TAU / 4 + 0.785
        booster(f'p120{k}', 0.24, z, z + 3.6, w, RX + 0.62 * math.cos(a), 0.62 * math.sin(a))
    bells('vulcain', RX, 0, z, 0.22, 1, 0)
    liftoff(RX, 4, 2.0, 0.7, 1.1)
    for k in range(4):
        a = k * TAU / 4 + 0.785
        f = lathe(f'pf{k}', [(0.0, z), (0.2, z), (0.1, z - 1.4), (0.0, z - 1.5)], mat_glow(f'pfl{k}', (1.0, 0.8, 0.45), 15, 0.7))
        f.location = (RX + 0.62 * math.cos(a), 0.62 * math.sin(a), 0)
    ground((0.1, 0.38, 0.15))
    rnd = random.Random(8)
    for i in range(9):
        sphere(f'tree{i}', rnd.uniform(0.4, 0.7), m('treem', (0.06, 0.35, 0.12), 0.8), (-5 + i * 0.8, rnd.uniform(0.5, 2.5), 0.4), 16)
    shoot()


def luna_ring():
    """Shimizu Corp - a lander (no thruster): the Luna Ring idea, a belt of
    solar cells wrapped round the Moon's equator, under construction, past a
    lunar base dome and a lander on its legs."""
    R = 40.0
    moon = sphere('moon', R, m('regolith', (0.62, 0.62, 0.6), 0.95), (0, 18, -R + 1.0), 128)
    # the belt: a broad dark band over the limb, laid on the surface
    # a band hugging a great circle tilted toward us, so it crosses the near side
    belt = lathe('belt', [(R * 1.003, -1.3), (R * 1.003, 1.3)], m('pv', (0.04, 0.08, 0.28), 0.25, 0.6), segs=256)
    belt.location = (0, 18, -R + 1.0)
    belt.rotation_euler = (math.radians(104), 0, 0)
    for i in range(10):
        x = -4 + i * 0.9
        box(f'crawler{i}', (0.3, 0.3, 0.2), m('crawl', (0.85, 0.6, 0.2), 0.4, 0.5), (x, 0, 1.1 - 0.002 * x * x))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, location=(-2.6, -0.6, 0.8), segments=32, ring_count=16)
    d = bpy.context.active_object
    d.name = 'dome'
    d.scale = (1, 1, 0.55)
    d.data.materials.append(WHITE())
    # the lander on its legs
    lz = 1.0
    cyl('lander', 0.55, 0.7, m('foil', (0.85, 0.62, 0.2), 0.3, 1.0), (RX, -0.5, lz + 0.9), verts=8)
    lathe('ascent', [(0.5, lz + 1.25), (0.35, lz + 1.9), (0.0, lz + 2.0)], WHITE()).location = (RX, -0.5, 0)
    for k in range(4):
        a = k * TAU / 4 + 0.785
        rod(f'leg{k}', (RX + 0.4 * math.cos(a), -0.5 + 0.4 * math.sin(a), lz + 0.7), (RX + 1.0 * math.cos(a), -0.5 + 1.0 * math.sin(a), lz), 0.04, DARK())
    crew_figures(flag_free_colour((0.71, 0.0, 0.33)), x=-0.6)
    K.camera((0, -20.2, 8.0), (0, 0, 6.8), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36
    sun((0.8, -0.3, 0.35), 4.5)
    area('fill', (-6, -8, 6), 300, 6, (0.75, 0.82, 1.0))


def pegasus():
    """NASRDA - Pegasus XL: the winged solid rocket just dropped from under its
    airliner carrier, igniting as it falls away."""
    w = WHITE()
    # the carrier jet (wide-body, three engines, one in the tail)
    fuse = lathe('jet', [(0.0, -4.6), (0.35, -4.0), (0.5, -2.5), (0.5, 3.0), (0.3, 4.2), (0.0, 4.6)], w, segs=32)
    wing = box('jwing', (0.06, 6.4, 1.2), w, (0, 0, 0.2), (0, 0, 0))
    wing.rotation_euler = (0, 0, 0)
    wing.scale = (1.0, 1, 1)
    eng = [cyl(f'jeng{s}', 0.18, 0.9, m('eng', (0.6, 0.62, 0.66), 0.3, 0.6), (0.3, s * 1.8, 0.4), (0, math.radians(90), 0), 24) for s in (-1, 1)]
    tail = box('jtail', (0.06, 0.08, 1.2), w, (-0.55, 0, 3.9))
    tail.dimensions = (1.0, 0.08, 1.2)
    tail.location = (-0.6, 0, 3.9)
    jet = group('carrier', [fuse, wing, *eng, tail], (0.4, 0, 8.4), (0, math.radians(90), math.radians(8)))
    # the Pegasus, dropped and lighting
    peg = lathe('peg', [(0.0, -2.0), (0.2, -1.9), (0.22, 1.6), (0.0, 2.3)], m('pegb', (0.08, 0.08, 0.1), 0.5), segs=24)
    pw = box('pegwing', (0.05, 1.6, 0.6), m('pegw', (0.08, 0.08, 0.1), 0.5), (0, 0, 0.2))
    pf = box('pegfin', (0.4, 0.04, 0.4), m('pegw2', (0.08, 0.08, 0.1), 0.5), (0, 0, -1.8))
    fl = lathe('pegflame', [(0.0, -2.0), (0.2, -2.0), (0.0, -3.6)], mat_glow('pfl', (1.0, 0.7, 0.3), 18, 0.7), segs=16)
    group('pegasus', [peg, pw, pf, fl], (RX - 1.0, 0, 6.0), (0, math.radians(97), math.radians(-6)))
    K.camera((0, -20.2, 8.9), (0, 0, 8.9), 35, clip=4000)
    c = bpy.context.scene.camera.data
    c.sensor_fit, c.sensor_height = 'VERTICAL', 36
    sun((0.5, -0.6, 0.7), 4.0)
    area('fill', (-6, -8, 2), 400, 6, (0.75, 0.82, 1.0))


def starship():
    """SpaceX - Starship: the stainless booster and ship stacked beside its
    tower, the two catch arms reaching for it, on a flat beach pad."""
    ss = m('stainless', (0.78, 0.8, 0.82), 0.22, 1.0)
    r = 0.5
    stage('booster', r, 0.5, 5.4, ss)
    for k in range(4):
        a = k * TAU / 4 + 0.785
        box(f'grid{k}', (0.06, 0.45, 0.4), DARK(), (RX + (r + 0.04) * math.cos(a), (r + 0.04) * math.sin(a), 5.1), (0, 0, a))
    stage('ship', r, 5.4, 8.6, ss)
    nose('shipnose', r, 8.6, 1.3, ss)
    for zz, s in ((5.8, 0.5), (8.9, 0.3)):
        for side in (-1, 1):
            box(f'flap{zz}{side}', (0.35, 0.05, s * 1.4), DARK(), (RX + side * (r + 0.15), 0, zz))
    bells('raptor', RX, 0, 0.5, 0.12, 8, 0.32)
    st = m('tower', (0.3, 0.32, 0.35), 0.5, 0.6)
    tw = truss('tower', 0.0, 10.0, 0.5, st, bays=10)
    for o in tw:
        o.location = (RX - 1.9, 0, 0)
    for s in (-1, 1):
        rod(f'chop{s}', (RX - 1.4, s * 0.3, 6.0), (RX - 0.1, s * 0.75, 6.0), 0.1, st)
        rod(f'chop2{s}', (RX - 0.1, s * 0.75, 6.0), (RX + 0.6, s * 0.4, 6.0), 0.1, st)
    box('mount', (2.0, 2.0, 0.5), m('olm', (0.45, 0.45, 0.47), 0.6, 0.5), (RX, 0, 0.25))
    ground((0.84, 0.76, 0.56))
    box('sea', (60, 60, 0.2), m('sea', (0.08, 0.35, 0.5), 0.2), (0, 34, 0.0))
    shoot()


def omega():
    """Norse Astronauts - OmegA SE (dirt): a slender all-solid launcher, black
    and white segmented stages, on an arctic coastal range under the aurora."""
    w, k = WHITE(), DARK()
    r = 0.3
    segs = [(0.4, 2.6, k), (2.6, 4.6, w), (4.6, 6.0, k), (6.0, 7.0, w)]
    for i, (a, b, mt) in enumerate(segs):
        stage(f'seg{i}', r, a, b, mt)
    lathe('fair', [(0.36, 7.0), (0.36, 8.1), (0.22, 8.7), (0.0, 8.85)], w).location = (RX, 0, 0)
    bells('noz', RX, 0, 0.4, 0.22, 1, 0)
    tower(RX - 1.2, 8.8, to=RX - 0.3)
    pad()
    ground((0.92, 0.94, 0.97))
    rock = m('mtn', (0.18, 0.2, 0.26), 0.9)
    snow = m('snow', (0.95, 0.96, 0.98), 0.8)
    for i, (x, h) in enumerate([(-5.5, 3.6), (-3.6, 2.6), (-1.6, 3.0), (5.5, 2.4)]):
        lathe(f'mtn{i}', [(2.2, 0.0), (0.0, h)], rock, segs=6).location = (x, 6, 0)
        lathe(f'cap{i}', [(0.75, h * 0.66), (0.0, h + 0.02)], snow, segs=6).location = (x, 6, 0)
    # a faint aurora ribbon high up (kept faint: the privilege text sits there)
    pts = [(x, 12.0, 12.5 + 0.8 * math.sin(x * 0.6)) for x in [i * 0.5 - 8 for i in range(33)]]
    tube('aurora', pts, 0.35, mat_glow('aurora', (0.25, 1.0, 0.5), 1.5, 0.35))
    shoot()


SCENES = {
    'crew_un_b612-front': liberty,
    'crew_un_b612-back': new_glenn,
    'crew_roscosmos_taikonauts-front': angara,
    'crew_roscosmos_taikonauts-back': long_march_9,
    'crew_nasa_isro-front': sls,
    'crew_nasa_isro-back': gslv,
    'crew_anonp2p_esa-front': skylon,
    'crew_anonp2p_esa-back': ariane_64,
    'crew_shimizu_nasrda-front': luna_ring,
    'crew_shimizu_nasrda-back': pegasus,
    'crew_spacex_norse-front': starship,
    'crew_spacex_norse-back': omega,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--samples', type=int, default=20)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    for k in [k for k in SCENES if not a.only or k in a.only.split(',')]:
        sc = K.reset(a.samples)
        sc.render.resolution_x, sc.render.resolution_y = CW, CH
        SCENES[k]()
        sc.render.filepath = os.path.join(a.out, f'{k}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', k, flush=True)


if __name__ == '__main__':
    main()
