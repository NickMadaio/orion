#!/usr/bin/env python3
"""Render Orion's app icon from the same geometry the hologram uses.

Not a hand-drawn approximation: this walks the identical Fibonacci sphere, the
same radial filaments, latitude arcs, chips and orbital great-circles as
`hologram.js` and `HologramModel.swift`, with the same palette and the same
two-pass depth ordering. The icon is a still frame of the thing itself, so it
cannot drift away from what the app actually looks like.

Additive blending is done by hand -- accumulate light into a float buffer and
tone-map once at the end -- because that is what makes overlapping geometry
bloom the way it does on the canvas. PIL has no "lighter" composite.

    python3 scripts/orion_make_icon.py                 # writes Orion.icns
    python3 scripts/orion_make_icon.py --preview out.png

Needs Pillow (`pip install pillow`). On macOS the .icns is assembled with
`iconutil`, which ships with the system.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.exit("This needs Pillow:  python3 -m pip install pillow")

TAU = math.tau
GOLDEN_ANGLE = 2.399963229728653

# Identical to PALETTE in hologram.js.
CORE = (255, 246, 214)
HOT = (255, 208, 112)
MID = (255, 158, 38)
DEEP = (214, 104, 12)

# Supersample, then downsample. Thin bright lines alias badly at icon sizes and
# an icon is judged at 32px more often than at 1024.
SS = 4
BASE = 1024


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def fib_point(i, n):
    y = 1 - (i / (n - 1)) * 2
    r = math.sqrt(max(0.0, 1 - y * y))
    th = i * GOLDEN_ANGLE
    return math.cos(th) * r, y, math.sin(th) * r


class Canvas:
    """Float RGB accumulator. Every draw adds light; nothing occludes."""

    def __init__(self, size):
        self.size = size
        self.buf = [0.0] * (size * size * 3)

    def add_px(self, x, y, colour, alpha):
        if alpha <= 0:
            return
        xi, yi = int(x), int(y)
        if not (0 <= xi < self.size and 0 <= yi < self.size):
            return
        i = (yi * self.size + xi) * 3
        b = self.buf
        b[i] += colour[0] * alpha
        b[i + 1] += colour[1] * alpha
        b[i + 2] += colour[2] * alpha

    def line(self, x0, y0, x1, y1, colour, alpha, width):
        """Additive line. Short segments, so a simple walk beats any cleverness."""
        dx, dy = x1 - x0, y1 - y0
        steps = int(max(abs(dx), abs(dy))) + 1
        if steps > 4000:
            return
        half = max(0.5, width / 2)
        span = range(int(-half), int(half) + 1)
        for s in range(steps + 1):
            t = s / steps
            px, py = x0 + dx * t, y0 + dy * t
            for ox in span:
                for oy in span:
                    # Soft edge: falls off with distance from the line centre.
                    d = math.hypot(ox, oy)
                    if d > half:
                        continue
                    self.add_px(px + ox, py + oy, colour, alpha * (1 - d / (half + 0.5)))

    def to_image(self):
        # Reinhard-ish tone map: lets the core clip to white while the faint
        # limb detail survives, which is exactly the look of the reference.
        px = bytearray(self.size * self.size * 3)
        for i in range(0, len(self.buf), 3):
            for k in range(3):
                v = self.buf[i + k]
                v = v / (v + 190.0) * 255.0 * 1.55
                px[i + k] = min(255, max(0, int(v)))
        return Image.frombytes("RGB", (self.size, self.size), bytes(px))


def project(px, py, pz, radius, size, spin=0.7, tilt=0.34):
    s, c = math.sin(spin), math.cos(spin)
    x = px * c + pz * s
    z = -px * s + pz * c
    st, ct = math.sin(tilt), math.cos(tilt)
    y2 = py * ct - z * st
    z2 = py * st + z * ct
    persp = 1 / (1 - z2 * 0.16)
    base_r = size * 0.36
    r = base_r * radius
    return size / 2 + x * r * persp, size / 2 + y2 * r * persp, z2, persp


def depth_colour(z):
    return mix(DEEP, HOT, pow((z + 1) / 2, 0.8))


def render(size):
    rng = random.Random(7)  # fixed: the icon must be reproducible
    cv = Canvas(size)
    scale = size / BASE

    filaments = []
    for i in range(1400):
        x, y, z = fib_point(i, 1400)
        spike = rng.random() < 0.14
        filaments.append({
            "p": (x, y, z),
            "inner": rng.uniform(0.55, 0.74) if spike else rng.uniform(0.78, 0.93),
            "outer": rng.uniform(1.04, 1.22) if spike else rng.uniform(0.97, 1.03),
            "w": (rng.uniform(0.9, 1.7) if spike else rng.uniform(0.35, 0.95)) * scale * 1.6,
            "bright": rng.uniform(0.35, 1.0),
        })

    arcs = []
    for i in range(44):
        y = math.cos((i + 0.5) / 44 * math.pi)
        arcs.append({
            "y": y,
            "r": math.sqrt(max(0.0, 1 - y * y)),
            "start": rng.uniform(0, TAU),
            "sweep": rng.uniform(0.5, 2.6),
            "radius": rng.uniform(0.88, 1.0),
            "w": rng.uniform(0.3, 0.9) * scale * 1.6,
        })

    chips = []
    for i in range(240):
        x, y, z = fib_point((i * 7 + 3) % 240, 240)
        chips.append({"p": (x, y, z), "radius": rng.uniform(0.9, 1.06),
                      "w": rng.uniform(1.5, 6) * scale * 1.6,
                      "h": rng.uniform(0.8, 2.4) * scale * 1.6})

    orbits = [
        {"tx": 0.42, "tz": -0.18, "r": 1.14, "w": 1.5 * scale * 1.8, "a": 0.55},
        {"tx": -0.62, "tz": 0.35, "r": 0.99, "w": 1.0 * scale * 1.8, "a": 0.38},
        {"tx": 1.25, "tz": 0.10, "r": 1.06, "w": 0.8 * scale * 1.8, "a": 0.26},
    ]

    def shell(side):
        dim = 0.34 if side < 0 else 1.0

        for f in filaments:
            x, y, z = f["p"]
            _, _, mz, _ = project(x, y, z, 1, size)
            if (mz > 0) != (side > 0):
                continue
            ax, ay, _, _ = project(x, y, z, f["inner"], size)
            bx, by, _, pe = project(x, y, z, f["outer"], size)
            alpha = f["bright"] * (0.30 + 0.55 * ((mz + 1) / 2)) * dim
            cv.line(ax, ay, bx, by, depth_colour(mz), alpha * 0.55, f["w"] * pe)

        for a in arcs:
            steps = 30
            prev = None
            for s in range(steps + 1):
                ang = a["start"] + a["sweep"] * s / steps
                p = project(math.cos(ang) * a["r"], a["y"], math.sin(ang) * a["r"],
                            a["radius"], size)
                if (p[2] > 0) != (side > 0):
                    prev = None
                    continue
                if prev:
                    cv.line(prev[0], prev[1], p[0], p[1],
                            depth_colour(side * 0.5), 0.22 * dim, a["w"])
                prev = p

        for ch in chips:
            x, y, z = ch["p"]
            sx, sy, z2, pe = project(x, y, z, ch["radius"], size)
            if (z2 > 0) != (side > 0):
                continue
            alpha = (0.30 + 0.45 * ((z2 + 1) / 2)) * dim
            w, h = ch["w"] * pe, ch["h"] * pe
            cv.line(sx - w / 2, sy, sx + w / 2, sy, depth_colour(z2), alpha * 0.7, h)

        for o in orbits:
            steps = 260
            prev = None
            for s in range(steps + 1):
                ang = s / steps * TAU
                px, pz = math.cos(ang), math.sin(ang)
                cx1, sx1 = math.cos(o["tx"]), math.sin(o["tx"])
                y1, z1 = -pz * sx1, pz * cx1
                cz1, sz1 = math.cos(o["tz"]), math.sin(o["tz"])
                x2, y2 = px * cz1 - y1 * sz1, px * sz1 + y1 * cz1
                p = project(x2, y2, z1, o["r"], size)
                if (p[2] > 0) != (side > 0):
                    prev = None
                    continue
                if prev:
                    cv.line(prev[0], prev[1], p[0], p[1],
                            depth_colour(side * 0.7), o["a"] * dim * 0.5, o["w"])
                prev = p

    # Back hemisphere, then the core, then the front. That ordering is what
    # makes it read as a volume rather than a disc.
    shell(-1)

    cx = cy = size / 2

    # Core: a true radial falloff evaluated per pixel. Drawing it as concentric
    # rings (the obvious approach) leaves visible moiré, because the angular
    # sample count and the pixel grid beat against each other.
    core_r = size * 0.36 * 0.40
    r_int = int(core_r)
    for yy in range(-r_int, r_int + 1):
        for xx in range(-r_int, r_int + 1):
            d = math.hypot(xx, yy)
            if d > core_r:
                continue
            t = d / core_r
            colour = mix(CORE, MID, min(1.0, t * 1.3))
            cv.add_px(cx + xx, cy + yy, colour, (1 - t) ** 2.6 * 3.4)

    shell(1)

    # Anamorphic streak: what makes it read as projected light rather than a
    # drawn circle. Soft and vertically feathered -- a hard one-pixel line
    # looks like a scratch on the lens, not a flare.
    streak = size * 0.36 * 1.5
    thick = max(2.0, size / BASE * 5)
    for dx in range(int(-streak), int(streak)):
        t = 1 - abs(dx) / streak
        falloff = t ** 3.0
        for oy in range(int(-thick), int(thick) + 1):
            v = 1 - abs(oy) / (thick + 1)
            cv.add_px(cx + dx, cy + oy, CORE, falloff * v * v * 1.1)

    return cv.to_image()


def add_background(fg: Image.Image) -> Image.Image:
    """Dark rounded-square plate, so the icon has a silhouette in the Dock."""
    size = fg.size[0]
    bg = Image.new("RGB", (size, size), (6, 9, 17))
    d = ImageDraw.Draw(bg)
    for i in range(size // 2, 0, -6):
        t = i / (size / 2)
        v = int(10 + 26 * (1 - t))
        d.ellipse([size // 2 - i, size // 2 - i, size // 2 + i, size // 2 + i],
                  fill=(v, int(v * 0.72), int(v * 0.35)))

    out = Image.blend(bg, Image.new("RGB", (size, size), (0, 0, 0)), 0.45)
    out = Image.blend(out, fg, 0.0)
    # Screen the hologram over the plate.
    px_bg, px_fg = out.load(), fg.load()
    for y in range(size):
        for x in range(size):
            b, f = px_bg[x, y], px_fg[x, y]
            px_bg[x, y] = tuple(min(255, 255 - (255 - b[i]) * (255 - f[i]) // 255)
                                for i in range(3))

    # macOS rounded-rect mask.
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [size * 0.045, size * 0.045, size * 0.955, size * 0.955],
        radius=size * 0.2235, fill=255)

    rgba = out.convert("RGBA")
    rgba.putalpha(mask)
    return rgba


def build(preview: str | None) -> int:
    render_size = BASE * 2  # supersample once, resize down for every slot
    print(f"rendering hologram at {render_size}px (this takes a moment)…")
    art = render(render_size)
    art = art.filter(ImageFilter.GaussianBlur(radius=render_size / BASE * 0.6))
    art = art.resize((BASE, BASE), Image.LANCZOS)
    icon = add_background(art)

    if preview:
        icon.save(preview)
        print(f"preview: {preview}")
        return 0

    repo = Path(__file__).resolve().parent.parent
    out_dir = repo / "native/Orion/Resources"
    out_dir.mkdir(parents=True, exist_ok=True)
    icon.save(out_dir / "OrionIcon.png")

    tmp = Path(tempfile.mkdtemp())
    iconset = tmp / "Orion.iconset"
    iconset.mkdir()
    for px in (16, 32, 64, 128, 256, 512, 1024):
        icon.resize((px, px), Image.LANCZOS).save(iconset / f"icon_{px}x{px}.png")
        half = px // 2
        if half >= 16:
            icon.resize((px, px), Image.LANCZOS).save(iconset / f"icon_{half}x{half}@2x.png")

    icns = out_dir / "Orion.icns"
    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], check=True)
        print(f"wrote {icns}")
    else:
        # Not on macOS: leave the iconset for the Mac to assemble.
        keep = out_dir / "Orion.iconset"
        if keep.exists():
            shutil.rmtree(keep)
        shutil.copytree(iconset, keep)
        print(f"no iconutil here — wrote {keep}")
        print("On the Mac:  iconutil -c icns native/Orion/Resources/Orion.iconset")
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"wrote {out_dir / 'OrionIcon.png'}")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Render Orion's app icon")
    ap.add_argument("--preview", metavar="PATH", help="write a single PNG and stop")
    args = ap.parse_args()
    raise SystemExit(build(args.preview))
