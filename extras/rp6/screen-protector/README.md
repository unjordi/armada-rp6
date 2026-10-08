# Retroid Pocket 6 — full-front screen protector template

[Español](README.es.md)

A 1:1 cut template for a hydrogel (or film) protector that covers the whole front of the RP6, like
Retroid's official glass: cut-outs for both sticks, the D-pad, the ABXY cluster, the four small buttons,
both speaker grilles and the microphone. Screen-protector cutting machines usually ship a device library
without the RP6; these files let any shop cut one.

| File | Use |
|---|---|
| `rp6-screen-protector.dxf` | for the cutting machine (millimetres, R2010; outline + 11 cut-outs) |
| `rp6-screen-protector.plt` | same paths as HPGL (40 units/mm), the usual plotter-cutter format |
| `rp6-screen-protector.svg` | same paths as SVG (millimetres) |
| `rp6-screen-protector-letter.pdf` / `-a4.pdf` (Spanish: `-letter-es.pdf` / `-a4-es.pdf`) | actual-size print sheet with a 100 mm ruler: print at 100 % (no "fit to page"), check the ruler, lay it on the device |
| `front-face.json` / `front-face.png` | measured front face: outline and every opening, in mm, origin at the face centre |

**Size:** 199.2 × 75.4 mm (the flat front face measures 200.4 × 77.6 mm; the protector stays 0.5 mm inside
its edge). Cut-outs have 0.8 mm of clearance. Left/right pairs are averaged and the outline is intersected
with its mirror image, so the piece never overhangs either side.

## How it was measured

From a 3D scan of a real RP6 (see [`../3d-scan/`](../3d-scan/)). The scan matches the official body size:
205.19 mm long (spec 205.5) and 17.3 mm between the flat front and back faces (spec 17.2).
`extract_front.py` finds the front plane, fits it, builds a depth map and extracts the face outline and the
openings; `make_template.py` turns that into the cut paths.

```
python extract_front.py retroid_pocket_6_Raw.stl front-face --rot180
python make_template.py front-face.json rp6-screen-protector [--margin 0.5] [--clearance 0.8]
       [--harmonics 20] [--no-speakers] [--no-mic] [--individual] [--asymmetric] [--paper letter|a4]
rsvg-convert -f pdf -o rp6-screen-protector-letter.pdf rp6-screen-protector-letter.svg
```
Needs numpy, scipy, scikit-image, pillow, shapely and ezdxf.

## License

The template and `front-face.*` derive from klaustro's scan, licensed CC BY-SA, so they are shared under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) with attribution to klaustro
(Thingiverse thing:7320283). The two scripts follow the repository license.
