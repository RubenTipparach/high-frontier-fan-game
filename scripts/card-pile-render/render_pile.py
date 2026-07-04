import bpy, bmesh, math, os, sys
import numpy as np

# ---- args after '--' : cards_dir out_png samples ----
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
CARDS_DIR = argv[0]
OUT = argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 160
SEED = int(argv[3]) if len(argv) > 3 else 20260704
W, H = 2400, 1680

rng = np.random.default_rng(SEED)

# ---- fresh scene ----
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- render: Cycles CPU + OIDN denoise ----
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False  # this Blender build ships without OIDN
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.01
scene.cycles.max_bounces = 8
scene.render.resolution_x = W
scene.render.resolution_y = H
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT
try:
    scene.view_settings.view_transform = 'Filmic'
except Exception:
    pass
scene.view_settings.look = 'Medium High Contrast'
scene.view_settings.exposure = 0.45

# ---- world: dim cool ambient fill ----
world = bpy.data.worlds.new("World"); scene.world = world
world.use_nodes = True
bgn = world.node_tree.nodes['Background']
bgn.inputs[0].default_value = (0.015, 0.02, 0.035, 1)
bgn.inputs[1].default_value = 0.5

# ---- linen normal map (numpy -> image) for the card faces ----
def make_linen_normal(name, size=768, freq=90, strength=1.4):
    ax = np.linspace(0, 2 * np.pi * freq, size, endpoint=False)
    X, Y = np.meshgrid(ax, ax)
    # plain weave: two orthogonal thread ridges, softly interleaved
    height = np.abs(np.sin(X)) * 0.5 + np.abs(np.sin(Y)) * 0.5
    height += (rng.random((size, size)) - 0.5) * 0.10  # fine paper tooth
    gx = np.gradient(height, axis=1)
    gy = np.gradient(height, axis=0)
    nx = -gx * strength; ny = -gy * strength; nz = np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= ln; ny /= ln; nz /= ln
    rgb = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)
    rgba = np.dstack([rgb, np.ones((size, size), np.float32)]).astype(np.float32)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels = rgba.ravel()
    img.pack()
    return img

LINEN = make_linen_normal('linen_nrm')

# ---- rounded-rect card mesh with thickness + planar UV on the top face ----
def rounded_rect_pts(w, h, r, seg=10):
    hw, hh = w / 2, h / 2
    arcs = [
        (hw - r, -(hh - r), -math.pi / 2, 0.0),
        (hw - r,  hh - r,   0.0, math.pi / 2),
        (-(hw - r), hh - r, math.pi / 2, math.pi),
        (-(hw - r), -(hh - r), math.pi, 1.5 * math.pi),
    ]
    pts = []
    for cx, cy, a0, a1 in arcs:
        for i in range(seg + 1):
            a = a0 + (a1 - a0) * i / seg
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts, hw, hh

def make_card(name, w, h, r, thick, face_img):
    pts, hw, hh = rounded_rect_pts(w, h, r)
    bm = bmesh.new()
    top = [bm.verts.new((x, y, thick / 2)) for (x, y) in pts]
    bot = [bm.verts.new((x, y, -thick / 2)) for (x, y) in pts]
    f_top = bm.faces.new(top)
    f_bot = bm.faces.new(list(reversed(bot)))
    n = len(pts)
    for i in range(n):
        bm.faces.new((top[i], top[(i + 1) % n], bot[(i + 1) % n], bot[i]))
    uv = bm.loops.layers.uv.new("UVMap")
    for loop in f_top.loops:
        co = loop.vert.co
        loop[uv].uv = ((co.x + hw) / w, (co.y + hh) / h)
    # material slots: 0 face (top), 1 edge (sides+bottom)
    f_top.material_index = 0
    f_bot.material_index = 1
    for f in bm.faces:
        if f not in (f_top, f_bot):
            f.material_index = 1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)

    # face material: card art + linen normal
    m = bpy.data.materials.new(name + "_face"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = face_img
    tex.image.colorspace_settings.name = 'sRGB'
    tex.extension = 'CLIP'
    # inset the art so a white border frames it (classic trading-card look)
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    b = 0.05
    sfac = 1.0 / (1.0 - 2 * b)
    inset = nt.nodes.new('ShaderNodeMapping')
    inset.inputs['Scale'].default_value = (sfac, sfac, 1.0)
    inset.inputs['Location'].default_value = (0.5 * (1 - sfac), 0.5 * (1 - sfac), 0.0)
    nt.links.new(uvn.outputs['UV'], inset.inputs['Vector'])
    nt.links.new(inset.outputs['Vector'], tex.inputs['Vector'])
    # white where the art doesn't cover (border + the art's own rounded corners)
    border = nt.nodes.new('ShaderNodeMixRGB')
    border.inputs['Color1'].default_value = (0.95, 0.95, 0.93, 1)
    nt.links.new(tex.outputs['Alpha'], border.inputs['Fac'])
    nt.links.new(tex.outputs['Color'], border.inputs['Color2'])
    nrm_tex = nt.nodes.new('ShaderNodeTexImage'); nrm_tex.image = LINEN
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.28
    nt.links.new(border.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(nrm_tex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.42
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.5
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

    # edge material: cream card stock
    me_edge = bpy.data.materials.new(name + "_edge"); me_edge.use_nodes = True
    eb = me_edge.node_tree.nodes.get('Principled BSDF')
    eb.inputs['Base Color'].default_value = (0.92, 0.9, 0.84, 1)
    eb.inputs['Roughness'].default_value = 0.6

    ob.data.materials.append(m)
    ob.data.materials.append(me_edge)
    # shade: smooth the corner arcs a touch via auto-smooth
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob

# ---- procedural wood table ----
def make_table():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    t = bpy.context.active_object
    t.name = 'Table'
    m = bpy.data.materials.new('Wood'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    coord = nt.nodes.new('ShaderNodeTexCoord')
    # planks run along Y; grain lines along Y, colour varies across X.
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (2.4, 0.42, 1.0)
    nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    # warp the grain with a Y-stretched noise so lines wander like real timber
    wmap = nt.nodes.new('ShaderNodeMapping'); wmap.inputs['Scale'].default_value = (1.0, 0.22, 1.0)
    nt.links.new(coord.outputs['Object'], wmap.inputs['Vector'])
    warp = nt.nodes.new('ShaderNodeTexNoise'); warp.inputs['Scale'].default_value = 3.4
    warp.inputs['Detail'].default_value = 8; warp.inputs['Roughness'].default_value = 0.7
    nt.links.new(wmap.outputs['Vector'], warp.inputs['Vector'])
    scale_noise = nt.nodes.new('ShaderNodeVectorMath'); scale_noise.operation = 'SCALE'
    scale_noise.inputs['Scale'].default_value = 0.42
    nt.links.new(warp.outputs['Color'], scale_noise.inputs[0])
    disp_mix = nt.nodes.new('ShaderNodeVectorMath'); disp_mix.operation = 'ADD'
    nt.links.new(mapping.outputs['Vector'], disp_mix.inputs[0])
    nt.links.new(scale_noise.outputs['Vector'], disp_mix.inputs[1])
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'; wave.bands_direction = 'X'; wave.wave_profile = 'SIN'
    wave.inputs['Scale'].default_value = 3.6
    wave.inputs['Distortion'].default_value = 6.0
    wave.inputs['Detail'].default_value = 2.5
    wave.inputs['Detail Roughness'].default_value = 0.6
    nt.links.new(disp_mix.outputs['Vector'], wave.inputs['Vector'])
    # thin dark grain lines on a walnut field (dark only near the band extremes)
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    e = ramp.color_ramp.elements
    e[0].position = 0.0; e[0].color = (0.055, 0.026, 0.013, 1)
    e[1].position = 0.28; e[1].color = (0.19, 0.10, 0.052, 1)
    e2 = ramp.color_ramp.elements.new(0.78); e2.color = (0.205, 0.11, 0.057, 1)
    e3 = ramp.color_ramp.elements.new(1.0); e3.color = (0.05, 0.024, 0.012, 1)
    nt.links.new(wave.outputs['Color'], ramp.inputs['Fac'])
    # large-scale plank tone variation
    plank = nt.nodes.new('ShaderNodeTexNoise'); plank.inputs['Scale'].default_value = 1.1
    plank.inputs['Detail'].default_value = 2
    pmap = nt.nodes.new('ShaderNodeMapping'); pmap.inputs['Scale'].default_value = (3.5, 0.2, 1)
    nt.links.new(coord.outputs['Object'], pmap.inputs['Vector'])
    nt.links.new(pmap.outputs['Vector'], plank.inputs['Vector'])
    tone = nt.nodes.new('ShaderNodeMixRGB'); tone.blend_type = 'MULTIPLY'; tone.inputs['Fac'].default_value = 0.35
    nt.links.new(ramp.outputs['Color'], tone.inputs['Color1'])
    nt.links.new(plank.outputs['Color'], tone.inputs['Color2'])
    nt.links.new(tone.outputs['Color'], bsdf.inputs['Base Color'])
    # low-relief grain bump only (no venetian-blind ridges)
    fibre = nt.nodes.new('ShaderNodeTexNoise'); fibre.inputs['Scale'].default_value = 55
    fibre.inputs['Detail'].default_value = 3
    fmap = nt.nodes.new('ShaderNodeMapping'); fmap.inputs['Scale'].default_value = (2, 16, 1)
    nt.links.new(coord.outputs['Object'], fmap.inputs['Vector'])
    nt.links.new(fmap.outputs['Vector'], fibre.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.05
    bump2 = nt.nodes.new('ShaderNodeBump'); bump2.inputs['Strength'].default_value = 0.03
    nt.links.new(fibre.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(wave.outputs['Color'], bump2.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bump2.inputs['Normal'])
    nt.links.new(bump2.outputs['Normal'], bsdf.inputs['Normal'])
    # satin finish: slight roughness variation along the grain
    rramp = nt.nodes.new('ShaderNodeValToRGB')
    rramp.color_ramp.elements[0].position = 0.0; rramp.color_ramp.elements[0].color = (0.3,)*3 + (1,)
    rramp.color_ramp.elements[1].position = 1.0; rramp.color_ramp.elements[1].color = (0.45,)*3 + (1,)
    nt.links.new(wave.outputs['Color'], rramp.inputs['Fac'])
    nt.links.new(rramp.outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    t.data.materials.append(m)
    return t

# ---- build the scene ----
table = make_table()

CW, CH, CR, CT = 2.05, 2.05 * 350 / 220, 2.05 * 10 / 220, 0.028
files = sorted(f for f in os.listdir(CARDS_DIR) if f.endswith('.png'))
cards = []
for i, fn in enumerate(files):
    img = bpy.data.images.load(os.path.join(CARDS_DIR, fn))
    ob = make_card('card_%02d' % i, CW, CH, CR, CT, img)
    # start clustered above the table, staggered LOW so cards land mostly
    # face-up (big tilts made them tumble onto their blank backs); random yaw
    # for the scatter, only a gentle tilt.
    ang = rng.random() * 2 * math.pi
    rad = math.sqrt(rng.random()) * 1.75
    ob.location = (math.cos(ang) * rad * 1.15, math.sin(ang) * rad * 0.9, 0.20 + i * 0.055)
    ob.rotation_euler = (
        math.radians((rng.random() - 0.5) * 8),
        math.radians((rng.random() - 0.5) * 8),
        math.radians((rng.random() - 0.5) * 180),
    )
    cards.append(ob)

# ---- rigid body physics so cards collide (no clipping) ----
scene.rigidbody_world  # ensure attr
bpy.ops.rigidbody.world_add()
rbw = scene.rigidbody_world
rbw.substeps_per_frame = 24
rbw.solver_iterations = 24

# table = passive collider
bpy.context.view_layer.objects.active = table
bpy.ops.rigidbody.object_add(type='PASSIVE')
table.rigid_body.collision_shape = 'BOX'
table.rigid_body.friction = 0.9

for ob in cards:
    bpy.context.view_layer.objects.active = ob
    bpy.ops.rigidbody.object_add(type='ACTIVE')
    rb = ob.rigid_body
    rb.collision_shape = 'BOX'
    rb.mass = 0.05
    rb.friction = 0.8
    rb.restitution = 0.0
    rb.linear_damping = 0.55
    rb.angular_damping = 0.75
    rb.use_margin = True
    rb.collision_margin = 0.002

# ---- settle the simulation ----
scene.frame_start = 1
scene.frame_end = 170
for f in range(1, 171):
    scene.frame_set(f)

# bake the settled transforms into the objects, then drop physics so render is static
for ob in cards:
    mw = ob.matrix_world.copy()
    ob.rigid_body.kinematic = True
    ob.matrix_world = mw

# ---- lighting: big soft key (ray-traced soft shadow) + cool fill ----
def area_light(name, loc, size, energy, color, rot):
    ld = bpy.data.lights.new(name, 'AREA'); ld.shape = 'RECTANGLE'
    ld.size = size; ld.size_y = size * 0.7
    ld.energy = energy; ld.color = color
    lo = bpy.data.objects.new(name, ld); scene.collection.objects.link(lo)
    lo.location = loc; lo.rotation_euler = rot
    return lo

key = area_light('Key', (-4.5, -3.5, 8.5), 7.0, 2600, (1.0, 0.96, 0.9),
                 (math.radians(28), math.radians(-18), math.radians(-8)))
fill = area_light('Fill', (6, -4, 4.5), 6.5, 1150, (0.6, 0.72, 1.0),
                  (math.radians(52), math.radians(30), math.radians(20)))

# ---- camera ----
cam_d = bpy.data.cameras.new('Cam'); cam = bpy.data.objects.new('Cam', cam_d)
scene.collection.objects.link(cam); scene.camera = cam
cam.location = (0.8, -8.4, 8.4)
cam_d.lens = 56
tgt = bpy.data.objects.new('Target', None); scene.collection.objects.link(tgt)
tgt.location = (0, 0.2, 0.16)
con = cam.constraints.new('TRACK_TO'); con.target = tgt
con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'

bpy.context.view_layer.update()
print("PILE: rendering %dx%d @ %d spp, %d cards" % (W, H, SAMPLES, len(cards)))
bpy.ops.render.render(write_still=True)
print("PILE: wrote", OUT)
