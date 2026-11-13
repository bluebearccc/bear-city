# Build mods/kaiju/assets/ in one go: plate, 8 slots x (4 damage levels + empty lot), monster frames, effect icons and manifest.json
# Usage: python3 -I art/build_assets.py
# Everything is drawn at 1 art pixel = 1 logical pixel and exported 2x nearest-neighbor (1 art pixel = 2 device pixels on Retina)
import colorsys, json, os, shutil, subprocess, sys, tempfile
import numpy as np
from PIL import Image

ART = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ART)
sys.path.insert(0, ART)
import render as R

OUT = os.path.join(ROOT, "mods", "kaiju", "assets")
SAMPLES = os.path.join(ART, "samples")
MODES = ("day", "night")
FRAMES = ("idle", "walk", "smash", "roar", "wave")   # same left-to-right order as the AI sprite sheet
SPRITE_H = 60

def save2x(arr_or_img, path, k=2):
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img, "RGBA")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.resize((im.width * k, im.height * k), Image.NEAREST).save(path)

def save1x(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)

def bbox(arr):
    ys, xs = np.where(arr[:, :, 3] > 0)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1

# ---------- Monster stands ----------
# Pick 2 stands per building automatically; monsters and buildings stack by real depth (a front building can hide part of a monster, feet on the ground)
#   criteria: close to its building, little hidden by front buildings (head visible), not covering its building much, in front of it, spaced apart
#   each stand gets a sort depth: before every building that hides it, after every building it hides
MON_W, MON_H = 36, 56     # rough monster body box on screen (up from the foot midpoint)
STAND_MAX = 4             # max stands per building (the 5th monster on one building starts overlapping)

def slot_depth(k):
    x, y, w, d = R.SLOTS[k][:4]
    return x + w / 2 + y + d / 2

def pick_stands(layers):
    S = R.S
    foot = [(x, y, w, d) for (x, y, w, d, *_ ) in R.SLOTS]

    def inside(px, py, m=3):
        return any(x - m <= px < x + w + m and y - m <= py < y + d + m for (x, y, w, d) in foot)

    def front_of(sx, sy, k):
        # building k is in front of the point: the point is behind its far corner
        x, y, w, d = foot[k]
        return sx < x + w and sy < y + d

    def cover(sx, sy, ks):
        px, py = R.P(sx, sy, 0)
        x0, x1 = max(0, int(px - MON_W / 2)), int(px + MON_W / 2)
        y0, y1 = max(0, int(py - MON_H)), int(py)
        return sum(int((layers[(k, 0)][y0:y1, x0:x1, 3] > 0).sum()) for k in ks)

    def dist(sx, sy, k):
        x, y, w, d = foot[k]
        return max(x - sx, 0, sx - (x + w)) + max(y - sy, 0, sy - (y + d))

    own_total = [max(1, int((layers[(k, 0)][:, :, 3] > 0).sum())) for k in range(len(foot))]
    chosen = []
    out = [None] * len(foot)
    # back-row buildings pick first (fewer options), front-row ones later
    for k in sorted(range(len(foot)), key=slot_depth):
        x, y, w, d = foot[k]
        mine = []
        for reach, tol in ((16, 300), (24, 500), (36, 700), (60, 1000)):
            cands = []
            for sx in range(x - reach, x + w + reach + 1, 2):
                for sy in range(y - reach, y + d + reach + 1, 2):
                    if not (4 <= sx <= S - 4 and 4 <= sy <= S - 4) or inside(sx, sy):
                        continue
                    if R.wx0 <= sx < S - 40 and sy >= R.wy0 - 4:      # sea
                        continue
                    dd = dist(sx, sy, k)
                    if dd > reach:
                        continue
                    hid = cover(sx, sy, [q for q in range(len(foot)) if front_of(sx, sy, q)])
                    if hid > tol:
                        continue
                    # share of its own building covered: penalized above 1/4, more for more (a short building shouldn't vanish behind its monster)
                    own = 0 if front_of(sx, sy, k) else cover(sx, sy, [k]) / own_total[k]
                    if own > 0.4:
                        continue
                    px, py = R.P(sx, sy, 0)
                    score = hid / 25 + max(0, own - 0.25) * 80 + dd - 0.1 * (sx + sy - (x + y))
                    cands.append((score, round(px), round(py), sx, sy))
            cands.sort()
            mine = []
            for _, px, py, sx, sy in cands:
                # stands of the same building >= 30 apart, >= 24 from other buildings' stands
                # the 3rd and 4th stands stay near the first (not over by another building)
                if len(mine) >= 2 and abs(px - mine[0][0]) + abs(py - mine[0][1]) > 50:
                    continue
                if all(abs(px - qx) + abs(py - qy) >= 30 for qx, qy, *_ in mine) and \
                   all(abs(px - qx) + abs(py - qy) >= 24 for qx, qy, *_ in chosen):
                    mine.append((px, py, sx, sy))
                if len(mine) == STAND_MAX:
                    break
            if len(mine) >= 2:
                break
        assert len(mine) >= 2, f"slot {k}: could not find 2 stands"
        chosen += mine
        res = []
        for px, py, sx, sy in mine:
            # only buildings overlapping the monster on screen constrain order: ones hiding it draw after, ones it hides draw before
            near = [q for q in range(len(foot)) if cover(sx, sy, [q]) > 0]
            ahead = [slot_depth(q) for q in near if front_of(sx, sy, q)]
            behind = [slot_depth(q) for q in near if not front_of(sx, sy, q)]
            lo = max(behind, default=-1e9)
            hi = min(ahead, default=1e9)
            assert lo < hi, f"slot {k} stand ({sx},{sy}) depth conflict: must be after {lo} and before {hi}"
            # unconstrained: use world x+y (same scale as building depth), then clamp into the allowed range
            dep = min(max(sx + sy, lo + 0.01), hi - 0.01)
            res.append((px, py, round(dep, 2)))
        out[k] = res
    return out

# ---------- City layers ----------
def build_city(mode, manifest):
    R.reset(mode)
    R.draw_plate()
    snap = R.snapshot()
    plate = Image.fromarray(R.clouds(), "RGBA")
    plate.alpha_composite(R.shadow())
    plate.alpha_composite(Image.fromarray(R.layer(), "RGBA"))
    save2x(plate, f"{OUT}/{mode}/plate.png")
    layers = {"plate": np.asarray(plate)}
    for i in range(len(R.SLOTS)):
        for dmg in (-1, 0, 1, 2, 3):
            R.restore(snap)
            lo = R._next[0] + 1
            R.draw_slot(i, dmg)
            arr = R.layer((lo, R._next[0] + 1))
            name = f"slot{i}-empty.png" if dmg < 0 else f"slot{i}-{dmg}.png"
            save2x(arr, f"{OUT}/{mode}/{name}")
            layers[(i, dmg)] = arr
    if mode == "day":
        picked = pick_stands(layers)
        for i, (x, y, w, d, h, color, kind) in enumerate(R.SLOTS):
            x0, y0, x1, y1 = bbox(layers[(i, 0)])
            cx, _ = R.P(x + w / 2, y + d / 2, h)
            stands = [{"x": px, "y": py, "depth": dep} for (px, py, dep) in picked[i]]
            manifest["slots"].append({
                "i": i, "color": color,
                "roof": {"x": round(cx), "y": y0},
                # actual roof y per damage level (arrow and siren follow the height)
                "roofs": [bbox(layers[(i, k)])[1] for k in range(4)],
                "stand": stands,
                "hit": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0},
                "depth": x + w / 2 + y + d / 2,
                "layers": [f"slot{i}-{k}.png" for k in range(4)], "empty": f"slot{i}-empty.png",
            })
        ex, ey = R.ENTRY
        px, py = R.P(ex, ey, -4)
        manifest["entry"] = {"x": round(px), "y": round(py), "depth": ex + ey}
    return layers

# ---------- Monsters ----------
def is_glow(rgb):
    # night glow pixels: cyan hues, highly saturated, or medium saturation but very bright (lizard back spikes, mech visor)
    h, s, v = colorsys.rgb_to_hsv(*(np.asarray(rgb) / 255.0))
    return 170 <= h * 360 <= 205 and (s > 0.5 or (s > 0.25 and v > 0.8))

def to_night(arr):
    out = arr.astype(float)
    glow_tint = np.array([110, 232, 255.0])
    for yy, xx in zip(*np.where(arr[:, :, 3] > 0)):
        rgb = out[yy, xx, :3]
        if is_glow(arr[yy, xx, :3]):
            out[yy, xx, :3] = rgb * 0.7 + glow_tint * 0.3
        else:
            out[yy, xx, :3] = rgb * 0.78
    return np.clip(out, 0, 255).astype(np.uint8)

def pixelize(sheet):
    tmp = tempfile.mkdtemp(prefix="kaiju-px-")
    subprocess.run([sys.executable, "-I", os.path.join(ART, "pixelize.py"), os.path.join(ROOT, sheet), tmp, str(SPRITE_H), "--poses", str(len(FRAMES))],
                   check=True, capture_output=True)
    n = len([f for f in os.listdir(tmp) if f.startswith("frame")])
    assert n == len(FRAMES), f"{sheet}: cut {n} poses, expected {len(FRAMES)}"
    frames = [np.asarray(Image.open(f"{tmp}/frame{k}.png").convert("RGBA")) for k in range(len(FRAMES))]
    shutil.rmtree(tmp)
    return dict(zip(FRAMES, frames))

def in_box(arr, bw, bh):
    # place on a shared canvas: foot midpoint at the bottom-center
    box = np.zeros((bh, bw, 4), dtype=np.uint8)
    fh, fw = arr.shape[:2]
    left = (bw - fw) // 2
    box[bh - fh:, left:left + fw] = arr
    return box

def face_center(arr):
    # face center: very dark pixels inside the outline (all 4 neighbors opaque) in the top 70% of the frame = eyes, mouth; None if not found
    top = arr[:round(arr.shape[0] * 0.7)]
    a = top[:, :, 3] > 0
    inner = np.zeros_like(a)
    inner[1:-1, 1:-1] = a[1:-1, 1:-1] & a[:-2, 1:-1] & a[2:, 1:-1] & a[1:-1, :-2] & a[1:-1, 2:]
    luma = top[:, :, :3].astype(int) @ np.array([299, 587, 114]) // 1000
    ys, xs = np.where(inner & (luma < 45))
    if len(xs) < 3:
        return None
    return int(round(xs.mean())), int(round(ys.mean()))

def head_crop(arr, size):
    # head: crop size x size around the face center (spikes and wings don't push the face out; works for the bent smash frame too)
    x0, y0, x1, y1 = bbox(arr)
    fc = face_center(arr)
    cx, cy = fc if fc else ((x0 + x1) // 2, y0 + size // 2)
    # put the face a bit low in the box (room for the top of the head), box stays inside the character
    left = min(max(cx - size // 2, x0), max(x0, x1 - size))
    top = min(max(cy - size * 9 // 16, y0), max(y0, y1 - size))
    box = np.zeros((size, size, 4), dtype=np.uint8)
    src = arr[top:top + size, left:left + size]
    oy = (size - src.shape[0]) // 2
    ox = (size - src.shape[1]) // 2
    box[oy:oy + src.shape[0], ox:ox + src.shape[1]] = src
    return box

def build_monsters(manifest):
    roster = json.load(open(os.path.join(ART, "roster.json")))
    raw = {m["id"]: pixelize(m["sheet"]) for m in roster}
    bw = max(f.shape[1] for fr in raw.values() for f in fr.values()) + 4
    bh = max(f.shape[0] for fr in raw.values() for f in fr.values())
    bw += bw % 2; bh += bh % 2
    manifest["sprite"] = {"w": bw, "h": bh, "ax": bw // 2, "ay": bh}
    sprites = {}
    for m in roster:
        mid, fr = m["id"], raw[m["id"]]
        entry = {"id": mid, "name": m["name"], "frames": {}, "heads": {}, "top": bh - fr["idle"].shape[0]}
        for mode in MODES:
            conv = (lambda a: a) if mode == "day" else to_night
            for k in FRAMES:
                img = conv(fr[k])   # night conversion is per-pixel and slow, do it once per frame
                save2x(in_box(img, bw, bh), f"{OUT}/{mode}/monsters/{mid}/{k}.png")
                # heads saved at 48x48: shown at 24 logical px, 1 art pixel = 1 device pixel
                save1x(Image.fromarray(head_crop(img, 48), "RGBA"), f"{OUT}/{mode}/monsters/{mid}/head-{k}.png")
                # roster avatars: tight 32x32 crop like the news face, exported 3x at 96px, shown at 48 logical px
                save2x(head_crop(img, 32), f"{OUT}/{mode}/monsters/{mid}/avatar-{k}.png", 3)
                if k == "roar":
                    roar = img
            # news face: 32x32 head from the roar frame, exported 2x, shown at 32 logical px
            save2x(head_crop(roar, 32), f"{OUT}/{mode}/monsters/{mid}/face-roar.png")
            if mode == "day":
                sprites[mid] = {k: in_box(fr[k], bw, bh) for k in FRAMES}
        entry["avatars"] = {k: f"monsters/{mid}/avatar-{k}.png" for k in FRAMES}
        for k in FRAMES:
            entry["frames"][k] = f"monsters/{mid}/{k}.png"
        entry["frames"]["head"] = f"monsters/{mid}/head-idle.png"
        for k in FRAMES:
            entry["heads"][k] = f"monsters/{mid}/head-{k}.png"
        entry["face"] = f"monsters/{mid}/face-roar.png"
        manifest["monsters"].append(entry)
    return sprites

# ---------- Effect icons (ASCII art) ----------
FX = {
    "arrow": ("""
..KKKKK..
..KYYOK..
..KYYOK..
KKKYYOKKK
KYYYYYYOK
.KYYYYOK.
..KYYOK..
...KYK...
....K....""", {"K": "#2b2620", "Y": "#ffd23f", "O": "#e8a21c"}),
    "bang": ("""
.KKKKKKKKKKK.
KWWWWWWWWWWWK
KWWWRRWRRWWWK
KWWWRRWRRWWWK
KWWWRRWRRWWWK
KWWWRRWRRWWWK
KWWWWWWWWWWWK
KWWWRRWRRWWWK
KWWWWWWWWWWWK
.KKKKWWKKKKK.
....KWK......
....KK.......""", {"K": "#2b2620", "W": "#ffffff", "R": "#e8402f"}),
    "question": ("""
.KKKKKKKKKKK.
KWWWWWWWWWWWK
KWWWWBBBWWWWK
KWWWBWWWBWWWK
KWWWWWWWBWWWK
KWWWWWWBWWWWK
KWWWWWBWWWWWK
KWWWWWWWWWWWK
KWWWWWBWWWWWK
KWWWWWWWWWWWK
.KKKKWWKKKKK.
....KWK......
....KK.......""", {"K": "#2b2620", "W": "#ffffff", "B": "#2f6fe0"}),
    "zz": ("""
KKKKKK.......
KZZZZK.......
KKKZZK.KKKKK.
.KZZKK.KzzzK.
KZZKKK.KKzKK.
KZZZZK.KzzzK.
KKKKKK.KKKKK.""", {"K": "#2b3a55", "Z": "#9cc7ff", "z": "#c9e0ff"}),
    "siren": ("""
.KKK.
KRWRK
KRRRK
KKKKK""", {"K": "#2b2620", "R": "#ff3b3b", "W": "#ffd0d0"}),
    "brick": ("""
KKKKKKKKKKKK
KBBBBKBBBBBK
KBBBBKBBBBBK
KKKKKKKKKKKK
KBBKBBBBBKBK
KBBKBBBBBKBK
KKKKKKKKKKKK
KBBBBBKBBBBK
KBBBBBKBBBBK
KKKKKKKKKKKK""", {"K": "#6b3524", "B": "#d9673f"}),
    # paper clip on the dossier photo
    "clip": ("""
.KKKK.
KSSSSK
KS..SK
KS.KSK
KS.KSK
KS.KSK
KS.KSK
KSSKSK
.KKKSK
...KSK
...KSK
....K.""", {"K": "#5a5f6b", "S": "#d5d8de"}),
}

def fx_bitmap(art, colors, mode):
    rows = [r for r in art.strip("\n").split("\n")]
    w = max(len(r) for r in rows)
    out = np.zeros((len(rows), w + (w % 2), 4), dtype=np.uint8)
    for yy, r in enumerate(rows):
        for xx, ch in enumerate(r):
            if ch in colors:
                c = R.hexc(colors[ch]).astype(int)
                if mode == "night" and ch in "KB" and colors is FX["brick"][1]:
                    c[:3] = (c[:3] * 0.8).astype(int)
                out[yy, xx] = c
    return out

def build_fx(mode, manifest):
    sizes = {}
    for name, (art, colors) in FX.items():
        arr = fx_bitmap(art, colors, mode)
        save2x(arr, f"{OUT}/{mode}/fx/{name}.png")
        sizes[name] = [arr.shape[1], arr.shape[0]]
    R.reset(mode)
    dust = R.puff(0, 0, 0.6).c.astype(np.uint8)
    dust = dust[:dust.shape[0] // 2 * 2, :dust.shape[1] // 2 * 2]
    save2x(dust, f"{OUT}/{mode}/fx/dust.png")
    sizes["dust"] = [dust.shape[1], dust.shape[0]]
    if mode == "day":
        manifest["fx"] = {k: f"fx/{k}.png" for k in sizes}
        # 1x logical size [w, h]
        manifest["fxSize"] = sizes

# ---------- Checks ----------
def verify(manifest):
    names = ["plate.png"]
    for s in manifest["slots"]:
        names += s["layers"] + [s["empty"]]
    for m in manifest["monsters"]:
        names += list(m["frames"].values()) + list(m["heads"].values()) + list(m["avatars"].values()) + [m["face"]]
    names += list(manifest["fx"].values())
    cw, ch = manifest["canvas"]["w"] * 2, manifest["canvas"]["h"] * 2
    for mode in MODES:
        for n in names:
            p = f"{OUT}/{mode}/{n}"
            assert os.path.exists(p), f"missing file {p}"
            w, h = Image.open(p).size
            assert w % 2 == 0 and h % 2 == 0, f"size is not a multiple of 2 {p} {w}x{h}"
            if n == "plate.png" or n.startswith("slot"):
                assert (w, h) == (cw, ch), f"wrong layer size {p} {w}x{h}"
    return len(names) * len(MODES)

def check_image(manifest, layers, sprites):
    # check image: plate + all buildings (by depth) + monsters on their stands; plus a strip of the orange building's damage levels
    slots = manifest["slots"]
    sp = manifest["sprite"]
    ids = [m["id"] for m in manifest["monsters"]]
    actors = [  # (stand, image)
        (slots[1]["stand"][0], sprites[ids[0]]["smash"]),
        (slots[1]["stand"][1], sprites[ids[1 % len(ids)]]["wave"]),
        (slots[2]["stand"][0], sprites[ids[1 % len(ids)]]["roar"]),
        (slots[6]["stand"][0], sprites[ids[2 % len(ids)]]["wave"]),
        (slots[5]["stand"][0], sprites[ids[2 % len(ids)]]["smash"]),
        (manifest["entry"], sprites[ids[0]]["walk"]),
    ]
    canvas = Image.new("RGBA", (R.W, R.H), (245, 245, 244, 255))
    canvas.alpha_composite(Image.fromarray(layers["plate"]))
    items = [(s["depth"], Image.fromarray(layers[(s["i"], 0)])) for s in slots]
    for pos, img in actors:
        layer = Image.new("RGBA", (R.W, R.H), (0, 0, 0, 0))
        layer.alpha_composite(Image.fromarray(img), (pos["x"] - sp["ax"], pos["y"] - sp["ay"]))
        items.append((pos["depth"], layer))
    # buildings and monsters stacked back to front by depth (same as city.js)
    items = [(d, 0, img) for d, img in items[:len(slots)]] + [(d, 1, img) for d, img in items[len(slots):]]
    for _, _, img in sorted(items, key=lambda t: (t[0], t[1])):
        canvas.alpha_composite(img)
    strip = Image.new("RGBA", (R.W, R.H), (245, 245, 244, 255))
    strip.alpha_composite(Image.fromarray(layers["plate"]))
    dmg_row = Image.new("RGBA", (R.W * 5, R.H), (245, 245, 244, 255))
    for k, dmg in enumerate((0, 1, 2, 3, -1)):
        cell = strip.copy()
        cell.alpha_composite(Image.fromarray(layers[(1, dmg)]))
        dmg_row.paste(cell, (k * R.W, 0))
    os.makedirs(SAMPLES, exist_ok=True)
    canvas.resize((R.W * 3, R.H * 3), Image.NEAREST).save(f"{SAMPLES}/assets-check.png")
    dmg_row.crop((0, 150, R.W * 5, R.H)).save(f"{SAMPLES}/assets-damage.png")

def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    manifest = {"canvas": {"w": R.W, "h": R.H}, "slots": [], "monsters": []}
    day_layers = None
    for mode in MODES:
        layers = build_city(mode, manifest)
        if mode == "day":
            day_layers = layers
        build_fx(mode, manifest)
    sprites = build_monsters(manifest)
    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    # same data for the mod's synchronous import
    with open(os.path.join(ROOT, "mods", "kaiju", "manifest.js"), "w") as f:
        f.write("// Generated by art/build_assets.py, do not edit by hand\nexport default " + json.dumps(manifest, ensure_ascii=False) + ";\n")
    n = verify(manifest)
    check_image(manifest, day_layers, sprites)
    print(f"ok: {n} assets, {len(manifest['slots'])} slots, {len(manifest['monsters'])} monsters -> {OUT}")

if __name__ == "__main__":
    main()
