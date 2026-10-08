#!/usr/bin/env python3
"""Extract the front-face outline and its holes (mm) from an RP6 STL scan.

Usage: extract_front.py SCAN.stl OUTPUT_PREFIX [--res 0.2] [--tol 0.35] [--rot180]
Outputs: PREFIX.json (outline + holes in mm, origin = face center, +y up)
         PREFIX.png  (check view: face in gray, holes in red, outline in green)
"""
import argparse, json, struct
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure

ap = argparse.ArgumentParser()
ap.add_argument("stl"); ap.add_argument("output")
ap.add_argument("--res", type=float, default=0.2, help="mm per pixel of the depth map")
ap.add_argument("--tol", type=float, default=0.35, help="max distance to the plane to count as face (mm)")
ap.add_argument("--min-hole", type=float, default=2.0, help="minimum hole area (mm^2)")
ap.add_argument("--rot180", action="store_true", help="rotate the result 180 degrees in the plane")
a = ap.parse_args()

b = open(a.stl, "rb").read()
n = struct.unpack("<I", b[80:84])[0]
dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
T = np.frombuffer(b, dtype=dt, count=n, offset=84)["v"].astype(np.float64)
V = T.reshape(-1, 3)

# Principal axes of the body: 0 = length, 1 = height, 2 = thickness.
mu = V.mean(0)
_, _, vt = np.linalg.svd((V - mu)[::50], full_matrices=False)
P = (T - mu) @ vt.T
N = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
area = np.linalg.norm(N, axis=1) / 2
N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
C = P.mean(1)

# Front face = the largest flat face on either side of the thickness axis.
best = None
for s in (1, -1):
    m = N[:, 2] * s > 0.95
    h, e = np.histogram(C[m, 2] * s, bins=120, weights=area[m])
    k = h.argmax()
    if best is None or h[k] > best[0]:
        best = (h[k], s, (e[k] + e[k + 1]) / 2)
_, s, z0 = best
P[:, :, 2] *= s
C[:, 2] *= s

# Least-squares plane fit with iterative outlier rejection.
sel = (N[:, 2] * s > 0.95) & (np.abs(C[:, 2] - z0) < 1.5)
X = C[sel]
for _ in range(6):
    A = np.c_[X[:, 0], X[:, 1], np.ones(len(X))]
    coef, *_ = np.linalg.lstsq(A, X[:, 2], rcond=None)
    r = X[:, 2] - A @ coef
    X = X[np.abs(r) < max(3 * r.std(), 0.05)]
nrm = np.array([-coef[0], -coef[1], 1.0]); nrm /= np.linalg.norm(nrm)
u = np.cross([0, 1, 0], nrm); u /= np.linalg.norm(u); w = np.cross(nrm, u)
p0 = np.array([0, 0, coef[2]])
Q = (P.reshape(-1, 3) - p0) @ np.c_[u, w, nrm]   # columns: in-plane x, in-plane y, height above plane
if a.rot180:
    Q[:, :2] *= -1

# Depth map (per-pixel maximum).
res = a.res
x0, y0 = Q[:, 0].min(), Q[:, 1].min()
W = int((Q[:, 0].max() - x0) / res) + 2; H = int((Q[:, 1].max() - y0) / res) + 2
ix = ((Q[:, 0] - x0) / res).astype(int); iy = ((Q[:, 1] - y0) / res).astype(int)
D = np.full((H, W), -np.inf); np.maximum.at(D, (iy, ix), Q[:, 2])
empty = ~np.isfinite(D)
idx = ndimage.distance_transform_edt(empty, return_distances=False, return_indices=True)
D = D[tuple(idx)]                                  # sampling gaps: nearest neighbor

face = np.abs(D) < a.tol
face = ndimage.binary_closing(face, iterations=3)
face = ndimage.binary_opening(face, iterations=2)
lab, k = ndimage.label(face)
face = lab == (np.bincount(lab.ravel())[1:].argmax() + 1)
silhouette = ndimage.binary_fill_holes(face)
silhouette = ndimage.binary_opening(silhouette, iterations=4)

# Outer outline in mm (origin = silhouette center).
cont = max(measure.find_contours(silhouette.astype(float), 0.5), key=len)
cont = measure.approximate_polygon(cont, tolerance=0.1 / res)
cy, cx = np.argwhere(silhouette).mean(0)
def mm(r, c): return ((c - cx) * res, (r - cy) * res)
outline = [mm(r, c) for r, c in cont]

holes = []
lab, k = ndimage.label(silhouette & ~face)
for i in range(1, k + 1):
    m = lab == i
    ar = m.sum() * res * res
    if ar < a.min_hole:
        continue
    rr, cc = np.nonzero(m)
    relief = np.percentile(D[m], 90)
    x, y = mm(rr.mean(), cc.mean())
    holes.append(dict(x=round(x, 2), y=round(y, 2), area_mm2=round(ar, 1),
                      width=round((cc.max() - cc.min() + 1) * res, 2), height=round((rr.max() - rr.min() + 1) * res, 2),
                      equiv_diameter=round(2 * np.sqrt(ar / np.pi), 2), relief_mm=round(float(relief), 2)))
holes.sort(key=lambda h: (-h["y"], h["x"]))

xs = [p[0] for p in outline]; ys = [p[1] for p in outline]
out = dict(source=a.stl, res_mm=res, tol_mm=a.tol,
           face_width_mm=round(max(xs) - min(xs), 2), face_height_mm=round(max(ys) - min(ys), 2),
           outline=[[round(x, 2), round(y, 2)] for x, y in outline], holes=holes)
json.dump(out, open(a.output + ".json", "w"), indent=1)

img = np.zeros((H, W, 3), np.uint8); img[face] = (200, 200, 200); img[silhouette & ~face] = (210, 70, 60)
im = Image.fromarray(img[::-1]); d = ImageDraw.Draw(im)
d.line([(c, H - 1 - r) for r, c in cont], fill=(40, 200, 80), width=2)
im.save(a.output + ".png")
print(f"face {out['face_width_mm']} x {out['face_height_mm']} mm · {len(holes)} holes")
for h in holes:
    print(h)
