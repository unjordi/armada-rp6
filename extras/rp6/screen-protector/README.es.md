# Retroid Pocket 6 — plantilla de mica frontal completa

[English](README.md)

Plantilla de corte 1:1 para una mica de hidrogel (o film) que cubre todo el frente de la RP6, como la mica
oficial de Retroid: huecos para las dos palancas, la cruceta, el grupo ABXY, los cuatro botones chicos, las
dos rejillas de bocina y el micrófono. Las cortadoras de micas suelen traer una biblioteca de aparatos sin la
RP6; con estos archivos cualquier puesto puede cortarla.

| Archivo | Uso |
|---|---|
| `rp6-screen-protector.dxf` | para la cortadora (milímetros, R2010; contorno + 11 huecos) |
| `rp6-screen-protector.plt` | los mismos trazos en HPGL (40 unidades/mm), el formato habitual de plotter de corte |
| `rp6-screen-protector.svg` | los mismos trazos en SVG (milímetros) |
| `rp6-screen-protector-letter-es.pdf` / `-a4-es.pdf` | hoja a tamaño real con regla de 100 mm (carta o A4): imprimir al 100 % (sin "ajustar a página"), medir la regla y presentarla sobre la consola |
| `front-face.json` / `front-face.png` | cara frontal medida: contorno y cada abertura en mm, origen al centro de la cara |

**Medidas:** 199.2 × 75.4 mm (la cara plana mide 200.4 × 77.6 mm; la mica queda 0.5 mm adentro de su orilla).
Los huecos tienen 0.8 mm de holgura. Los pares izquierda/derecha se promedian y el contorno se intersecta con
su espejo, así que la pieza nunca sobresale de ningún lado.

## Cómo se midió

De un escaneo 3D de una RP6 real (ver [`../3d-scan/`](../3d-scan/README.es.md)). El escaneo coincide con las medidas
oficiales: 205.19 mm de largo (oficial 205.5) y 17.3 mm entre las caras planas de frente y espalda (oficial 17.2).
`extract_front.py` encuentra el plano del frente, lo ajusta, arma un mapa de profundidad y extrae el contorno y
las aberturas; `make_template.py` lo convierte en los trazos de corte. Comandos y dependencias: [README.md](README.md)
(usa `--lang es` para la hoja en español).

## Licencia

La plantilla y `front-face.*` derivan del escaneo de klaustro, con licencia CC BY-SA, así que se comparten bajo
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.es) citando a klaustro (Thingiverse
thing:7320283). Los dos scripts siguen la licencia del repositorio.
