"""Pose MakeHuman bodies for the colonist card art and render them, headless.

Owner 2026-11-20: "pulling in human modeling skills from fps game demo, crab
breeze, or the heavy photon site ... and then drawing SVGs based on 3d human
renders". The method is fps-game-demo's blender-humanoid-characters (MPFB2
bodies, the game_engine rig, CC0 MakeHuman assets) cut down to stills: one
scene per colonist card, figures posed by AIMING bones at directions, flat
colour materials (the render is traced to SVG afterwards, so clean colour
regions matter more than texture), Cycles on the CPU, transparent film.

Run (MPFB and the CC0 pack unpacked into the private user folder first):
  BLENDER_USER_RESOURCES=~/.cache/hf-chars/blender \
  blender -b --factory-startup -P scripts/blender/colonist_people.py -- OUT_DIR [--only id,id] [--lo]

Axes: the body faces -Y, +Z is up, the figure's left (_l bones) is +X.
"""
import bpy, os, sys, math, json
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "/tmp/people"
ONLY = None
LO = "--lo" in ARGS
if "--only" in ARGS:
    ONLY = set(ARGS[ARGS.index("--only") + 1].split(","))
HERE = os.path.dirname(os.path.abspath(__file__))
SCENES = json.load(open(os.path.join(HERE, "colonist_people.json")))

import addon_utils
addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
from bl_ext.user_default.mpfb.services import HumanService, AssetService
try:
    AssetService.update_all_asset_lists()
except Exception:
    pass

EYES_UUID = "1cc97a30-85a1-42e6-a9f7-b3e753732baa"


def age_slider(years):
    anchors = [(1.0, 0.0), (11.0, 0.1875), (25.0, 0.5), (90.0, 1.0)]
    years = min(max(years, 1.0), 90.0)
    for (y0, s0), (y1, s1) in zip(anchors, anchors[1:]):
        if years <= y1:
            return s0 + (years - y0) / (y1 - y0) * (s1 - s0)
    return 1.0


def flat(name, rgb, rough=0.6, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*[c / 255 for c in rgb], 1)
    b.inputs["Roughness"].default_value = rough
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
        b.inputs["Subsurface Radius"].default_value = (1.0, 0.4, 0.25)
    return m


def hexrgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def set_mat(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def build_figure(f):
    info = HumanService._create_default_human_info_dict()
    info["name"] = f["id"]
    male = f.get("sex", "male") == "male"
    race = f.get("race", {"african": 0.33, "asian": 0.33, "caucasian": 0.34})
    tot = sum(race.values())
    info["phenotype"] = {"gender": 1.0 if male else 0.0, "age": age_slider(f.get("age", 30)),
                         "muscle": f.get("muscle", 0.5), "weight": f.get("weight", 0.45), "height": f.get("height", 0.5),
                         "proportions": f.get("proportions", 0.6), "cupsize": 0.5, "firmness": 0.5,
                         "race": {k: v / tot for k, v in race.items()}}
    info["rig"] = "game_engine"
    if f.get("hair"):
        info["hair"] = "{0}/{0}.mhclo".format(f["hair"])
    info["eyebrows"] = "{0}/{0}.mhclo".format(f.get("eyebrows", "eyebrow001"))
    info["eyelashes"] = "{0}/{0}.mhclo".format(f.get("eyelashes", "eyelashes02"))
    info["eyes"] = "low-poly/low-poly.mhclo"
    info["clothes"] = ["{0}/{0}.mhclo".format(c) for c in f.get("clothes", [])]
    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 1
    before = set(bpy.data.objects)
    try:
        HumanService.deserialize_from_dict(info, settings)
    except Exception as e:
        # A missing asset should not stop the scene: drop the clothes and hair and retry once.
        print("WARN", f["id"], e)
        for o in set(bpy.data.objects) - before:
            bpy.data.objects.remove(o, do_unlink=True)
        info["clothes"], info["hair"] = [], ""
        HumanService.deserialize_from_dict(info, settings)
    objs = list(set(bpy.data.objects) - before)
    rig = next(o for o in objs if o.type == "ARMATURE")
    meshes = [o for o in objs if o.type == "MESH"]
    body = max(meshes, key=lambda o: len(o.data.vertices) if o.name == f["id"] or "human" in o.name.lower() else 0)
    # flat materials
    skin = flat(f["id"] + "_skin", hexrgb(f.get("skin", "#c99a7a")), 0.5, 0.15)
    hair = flat(f["id"] + "_hair", hexrgb(f.get("hair_color", "#2a1a10")), 0.55)
    cols = f.get("cloth_colors", {})
    for o in objs:
        if o.type != "MESH":
            continue
        n = o.name.lower()
        if o is body:
            set_mat(o, skin)
        elif "eyebrow" in n or "eyelash" in n or (f.get("hair") and f["hair"] in n):
            set_mat(o, hair)
        elif "low-poly" in n or "eye" in n:
            set_mat(o, flat(f["id"] + "_eye", [240, 240, 240], 0.2))
        else:
            key = next((k for k in cols if k in n), None)
            set_mat(o, flat(f["id"] + "_" + n, hexrgb(cols[key] if key else f.get("cloth", "#8a8a8a")), 0.75))
    return rig, objs


FINGERS = ["index", "middle", "ring", "pinky"]


def expand_hands(pose):
    """'hand_l_shape' / 'hand_r_shape': fist | relaxed | open | point -> per-joint curls."""
    out = dict(pose)
    for side in ("l", "r"):
        shape = out.pop(f"hand_{side}_shape", None)
        if not shape:
            continue
        deg = {"fist": (80, 95, 70), "relaxed": (25, 30, 20), "open": (5, 5, 5), "grip": (55, 65, 45)}.get(shape, (80, 95, 70))
        for fg in FINGERS:
            d = (5, 5, 5) if (shape == "point" and fg == "index") else deg
            for j, dd in zip((1, 2, 3), d):
                out[f"{fg}_0{j}_{side}"] = {"curl": dd * (1 if side == "l" else 1)}
    return out


def pose_figure(rig, pose):
    """pose: {bone: {"aim": [x,y,z]} | {"rot": [axis, deg]}}, applied parent first.
    'aim' turns the bone (in armature space) to point along the vector; 'rot' adds a rotation
    about an armature axis (x, y or z) on top, e.g. a head turn."""
    pose = expand_hands(pose)
    bpy.context.view_layer.update()
    order = [b.name for b in rig.data.bones]
    for name in order:
        if name not in pose:
            continue
        spec = pose[name]
        pb = rig.pose.bones[name]
        for step in (spec if isinstance(spec, list) else [spec]):
            bpy.context.view_layer.update()
            m = pb.matrix.copy()
            head = m.to_translation()
            rot = m.to_3x3()
            if "aim" in step:
                cur = (rot @ Vector((0, 1, 0))).normalized()
                q = cur.rotation_difference(Vector(step["aim"]).normalized())
            elif "curl" in step:     # about the bone's own X axis (finger bend)
                q = Matrix.Rotation(math.radians(step["curl"]), 3, (rot @ Vector((1, 0, 0))).normalized()).to_quaternion()
            else:
                axis = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[step["rot"][0]]
                q = Matrix.Rotation(math.radians(step["rot"][1]), 3, axis).to_quaternion()
            new = q.to_matrix() @ rot
            pb.matrix = Matrix.Translation(head) @ new.to_4x4()
            bpy.context.view_layer.update()


def bone_world(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].head


def render_scene(sc):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 24 if LO else 96
    s.cycles.use_denoising = True
    s.render.film_transparent = True
    s.render.resolution_x, s.render.resolution_y = (300, 330) if LO else (600, 660)
    s.view_settings.view_transform = "Standard"
    rigs = {}
    for f in sc["figures"]:
        rig, objs = build_figure(f)
        rig.location = Vector(f.get("at", (0, 0, 0)))
        rig.rotation_euler = (0, 0, math.radians(f.get("turn", 0)))
        pose_figure(rig, f.get("pose", {}))
        rigs[f["id"]] = rig
    bpy.context.view_layer.update()
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = sc.get("lens", 50)
    cam = bpy.data.objects.new("cam", cam_d)
    s.collection.objects.link(cam)
    cam.location = Vector(sc["camera"])
    look = sc.get("look")
    if isinstance(look, str):            # "figure:bone"
        fid, bn = look.split(":")
        target = bone_world(rigs[fid], bn)
    else:
        target = Vector(look)
    d = (target - cam.location)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    s.camera = cam
    for name, (loc, energy, size, col) in {
        "key": (sc.get("key", (-2.2, -2.6, 2.8)), sc.get("key_w", 80), 1.6, (1.0, 0.96, 0.9)),
        "fill": ((2.6, -2.0, 1.4), sc.get("fill_w", 18), 2.5, (0.85, 0.9, 1.0)),
        "rim": (sc.get("rim", (1.8, 2.4, 2.4)), sc.get("rim_w", 90), 1.0, tuple(sc.get("rim_color", (0.8, 0.95, 1.0)))),
    }.items():
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size, ld.color = energy, size, col
        lo = bpy.data.objects.new(name, ld)
        s.collection.objects.link(lo)
        lo.location = Vector(loc)
        lo.rotation_euler = (Vector((0, 0, 1.0)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.08
    s.world = world
    s.render.filepath = os.path.join(OUT, sc["id"] + ".png")
    bpy.ops.render.render(write_still=True)
    # Key bone positions in CARD units (the render is the card's 300x330 at 2x), so SVG props
    # (a visor, binoculars, a rose) can be placed on the traced figure exactly.
    from bpy_extras.object_utils import world_to_camera_view
    marks = {}
    for fid, rig in rigs.items():
        for bn in ("head", "neck_01", "hand_l", "hand_r", "lowerarm_l", "lowerarm_r", "upperarm_l", "upperarm_r", "foot_l", "foot_r", "calf_l", "calf_r", "spine_03", "pelvis"):
            pb = rig.pose.bones[bn]
            for end, co in (("", pb.head), ("_tip", pb.tail)):
                v = world_to_camera_view(s, cam, rig.matrix_world @ co)
                marks[f"{fid}.{bn}{end}"] = [round(v.x * 300, 1), round((1 - v.y) * 330, 1)]
    json.dump(marks, open(os.path.join(OUT, sc["id"] + ".json"), "w"), indent=0)
    print("RENDERED", s.render.filepath, [(o.name, o.data.materials[0].name if o.type == "MESH" and o.data.materials else "") for o in bpy.data.objects if o.type == "MESH"])


os.makedirs(OUT, exist_ok=True)
for sc in SCENES["scenes"]:
    if ONLY and sc["id"] not in ONLY:
        continue
    render_scene(sc)
