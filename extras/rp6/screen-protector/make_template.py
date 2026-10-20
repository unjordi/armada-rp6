#!/usr/bin/env python3
"""Generate the 1:1 RP6 front screen-protector template from front-face.json (extract_front.py).

Usage: make_template.py front-face.json PREFIX [options]
Outputs: PREFIX.svg (mm), PREFIX.dxf (mm, R2010), PREFIX.plt (HPGL, 40 units/mm)
         and PREFIX-<paper>.svg (landscape 1:1 print sheet with ruler; paper = letter | a4).

Options (mm):
  --margin 0.5        inset of the outline from the edge of the flat face
  --clearance 0.8     clearance around each control
  --paper letter      print sheet size: letter | a4
  --lang en           language of the texts on the print sheet: en | es
  --no-speakers       do not cut the speaker grilles (the protector covers them)
  --no-mic            do not cut the microphone hole
  --individual        one hole per ABXY button instead of a single circle for the group
  --harmonics 20      Fourier harmonics kept in the outline (fewer = smoother)
  --asymmetric        do not average left/right (by default the outline is the intersection
                      with its mirror image and each pair of controls is averaged)
"""
import argparse, json, math
import ezdxf
import numpy as np
from shapely.affinity import scale
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import unary_union

PAPERS = {"letter": (279.4, 215.9), "a4": (297.0, 210.0)}   # landscape, mm

ap = argparse.ArgumentParser()
ap.add_argument("front"); ap.add_argument("output")
ap.add_argument("--margin", type=float, default=0.5)
ap.add_argument("--clearance", type=float, default=0.8)
ap.add_argument("--paper", choices=sorted(PAPERS), default="letter")
ap.add_argument("--lang", choices=("en", "es"), default="en")
ap.add_argument("--no-speakers", action="store_true")
ap.add_argument("--no-mic", action="store_true")
ap.add_argument("--individual", action="store_true")
ap.add_argument("--harmonics", type=int, default=20)
ap.add_argument("--asymmetric", action="store_true")
a = ap.parse_args()
d = json.load(open(a.front))

face = Polygon(d["outline"]).buffer(0)
if not a.asymmetric:
    face = face.intersection(scale(face, xfact=-1, origin=(0, 0)))

def fourier(poly, k, n=2048):
    """Resample the outline by arc length and keep the k lowest harmonics."""
    c = np.asarray(poly.exterior.coords)[:-1]
    t_ = np.vstack([c, c[:1]])
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(t_, axis=0).T))]
    t = np.linspace(0, seg[-1], n, endpoint=False)
    z = np.interp(t, seg, t_[:, 0]) + 1j * np.interp(t, seg, t_[:, 1])
    F = np.fft.fft(z); F[k + 1:n - k] = 0
    z = np.fft.ifft(F)
    return Polygon(np.c_[z.real, z.imag]).buffer(0)

face = max(getattr(face, "geoms", [face]), key=lambda g: g.area)
face = fourier(face, a.harmonics)
if not a.asymmetric:
    face = face.intersection(scale(face, xfact=-1, origin=(0, 0)))
protector = face.buffer(-a.margin, join_style=1).simplify(0.02)

H = d["holes"]
if not a.asymmetric:
    used = set()
    # Average each left/right pair of holes (mirror positions) so the cut-outs are symmetric.
    for i, h in enumerate(H):
        if i in used or abs(h["x"]) < 5:
            continue
        cand = [(abs(g["x"] + h["x"]) + abs(g["y"] - h["y"]), j) for j, g in enumerate(H)
                if j != i and j not in used and g["x"] * h["x"] < 0]
        if not cand:
            continue
        dist, j = min(cand)
        if dist > 4:
            continue
        g = H[j]; mx = (abs(h["x"]) + abs(g["x"])) / 2; my = (h["y"] + g["y"]) / 2
        for k in (h, g):
            k["x"] = math.copysign(mx, k["x"]); k["y"] = my
        used |= {i, j}

def size_in(h, lo, hi): return lo <= max(h["width"], h["height"]) <= hi
sticks = [h for h in H if size_in(h, 17, 23) and h["relief_mm"] > 4]
dpads = [h for h in H if size_in(h, 17, 23) and h["relief_mm"] <= 4]
abxy = [h for h in H if size_in(h, 7.5, 9.5) and min(h["width"], h["height"]) > 7]
small = [h for h in H if size_in(h, 4.5, 6.5)]
speakers = [h for h in H if h["relief_mm"] < 0 and h["width"] > 3 * h["height"]]
mics = [h for h in H if max(h["width"], h["height"]) < 3.5]

cuts, labels = [], []
def circle(x, y, r, name):
    cuts.append(Point(x, y).buffer(r, resolution=64)); labels.append((name, x, y, 2 * r))

for h in sticks:
    circle(h["x"], h["y"], max(h["width"], h["height"]) / 2 + a.clearance, "stick")
for h in dpads:
    circle(h["x"], h["y"], max(h["width"], h["height"]) / 2 + a.clearance, "d-pad")
if a.individual or len(abxy) != 4:
    for h in abxy:
        circle(h["x"], h["y"], max(h["width"], h["height"]) / 2 + a.clearance, "button")
else:
    cx = sum(h["x"] for h in abxy) / 4; cy = sum(h["y"] for h in abxy) / 4
    r = max(math.hypot(h["x"] - cx, h["y"] - cy) + max(h["width"], h["height"]) / 2 for h in abxy)
    circle(cx, cy, r + a.clearance, "abxy")
for h in small:
    circle(h["x"], h["y"], max(h["width"], h["height"]) / 2 + a.clearance, "small button")
if not a.no_mic:
    for h in mics:
        circle(h["x"], h["y"], max(h["width"], h["height"]) / 2 + 0.3, "microphone")
if not a.no_speakers:
    for h in speakers:
        w, t = h["width"] / 2 + a.clearance, h["height"] / 2 + a.clearance
        cuts.append(LineString([(h["x"] - w + t, h["y"]), (h["x"] + w - t, h["y"])]).buffer(t, resolution=32))
        labels.append(("speaker", h["x"], h["y"], 2 * w))

piece = protector.difference(unary_union(cuts))
minx, miny, maxx, maxy = piece.bounds
Wd, Hd = maxx - minx, maxy - miny

def rings(g):
    """Yield every closed ring (exteriors and interiors) of a polygon or multipolygon."""
    for p in getattr(g, "geoms", [g]):
        yield list(p.exterior.coords)
        for i in p.interiors:
            yield list(i.coords)

def svg_path(coords, ox, oy):
    return "M " + " L ".join(f"{x - minx + ox:.3f},{maxy - y + oy:.3f}" for x, y in coords) + " Z"

def svg_piece(ox, oy, stroke):
    return "".join(f'<path d="{svg_path(c, ox, oy)}" fill="none" stroke="black" stroke-width="{stroke}"/>' for c in rings(piece))

open(a.output + ".svg", "w").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{Wd:.3f}mm" height="{Hd:.3f}mm" viewBox="0 0 {Wd:.3f} {Hd:.3f}">'
    f'{svg_piece(0, 0, 0.1)}</svg>\n')

doc = ezdxf.new("R2010"); doc.units = ezdxf.units.MM; msp = doc.modelspace()
for c in rings(piece):
    msp.add_lwpolyline([(x - minx, y - miny) for x, y in c], close=True)
doc.saveas(a.output + ".dxf")

# HPGL: 40 units per mm, one pen-up/pen-down pass per closed ring.
plt = ["IN;", "SP1;"]
for c in rings(piece):
    pts = [(round((x - minx) * 40), round((y - miny) * 40)) for x, y in c]
    plt.append(f"PU{pts[0][0]},{pts[0][1]};")
    plt.append("PD" + ",".join(f"{x},{y}" for x, y in pts[1:] + pts[:1]) + ";")
plt += ["PU0,0;", "SP0;"]
open(a.output + ".plt", "w").write("\n".join(plt) + "\n")

PW, PH = PAPERS[a.paper]
ox, oy = (PW - Wd) / 2, 35
ruler = "".join(f'<line x1="{20 + i}" y1="{PH - 25}" x2="{20 + i}" y2="{PH - 25 - (5 if i % 10 == 0 else 2.5)}" stroke="black" stroke-width="0.2"/>' for i in range(101))
TEXTS = {
    "en": (f"Retroid Pocket 6 front screen protector · {Wd:.1f} x {Hd:.1f} mm · margin {a.margin} mm · clearance {a.clearance} mm · "
           "print at 100 %, actual size, do not fit to page",
           "This ruler must measure exactly 100 mm.",
           'Geometry: 3D scan "Retroid Pocket 6" by klaustro (Thingiverse thing:7320283, CC BY-SA).'),
    "es": (f"Mica frontal Retroid Pocket 6 · {Wd:.1f} x {Hd:.1f} mm · margen {a.margin} mm · holgura {a.clearance} mm · "
           "imprimir al 100 % (tamaño real, sin ajustar a página)",
           "Esta regla debe medir 100 mm exactos.",
           "Geometría: escaneo 3D «Retroid Pocket 6» de klaustro (Thingiverse 7320283, CC BY-SA)."),
}
title, ruler_text, credit = TEXTS[a.lang]
sheet = f"{a.output}-{a.paper}" + ("" if a.lang == "en" else "-es") + ".svg"
open(sheet, "w").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{PW}mm" height="{PH}mm" viewBox="0 0 {PW} {PH}">'
    f'<rect width="{PW}" height="{PH}" fill="white"/>'
    f'<text x="{ox}" y="{oy - 8}" font-size="3.5" font-family="sans-serif">{title}</text>'
    f'{svg_piece(ox, oy, 0.25)}'
    f'<line x1="20" y1="{PH - 25}" x2="120" y2="{PH - 25}" stroke="black" stroke-width="0.2"/>{ruler}'
    f'<text x="20" y="{PH - 15}" font-size="3.5" font-family="sans-serif">{ruler_text}</text>'
    f'<text x="{ox}" y="{PH - 5}" font-size="2.5" font-family="sans-serif">{credit}</text>'
    '</svg>\n')

print(f"protector {Wd:.2f} x {Hd:.2f} mm · {len(cuts)} cuts")
for n, x, y, dm in labels:
    print(f"  {n:12s} center ({x:7.2f}, {y:6.2f})  width {dm:5.2f}")
