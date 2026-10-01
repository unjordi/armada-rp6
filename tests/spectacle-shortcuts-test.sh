#!/bin/bash
# The baked Spectacle defaults must use Spectacle 6's real schema, or KDE ignores them silently.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import configparser, sys
def load(p):
    c = configparser.RawConfigParser(strict=False, delimiters=("=",)); c.optionxform = str
    c.read(p); return c
sc = load("system_files/etc/xdg/kglobalshortcutsrc")
g = "services][org.kde.spectacle.desktop"
fail = []
if not sc.has_section(g): fail.append("missing [services][org.kde.spectacle.desktop]")
else:
    keys = sc.options(g)
    real = {"FullScreenScreenShot","CurrentMonitorScreenShot","ActiveWindowScreenShot","RectangularRegionScreenShot",
            "WindowUnderCursorScreenShot","RecordRegion","RecordScreen","RecordWindow","OpenWithoutScreenshot","_launch"}
    fail += [f"unknown Spectacle action {k}" for k in keys if k not in real]
    if "F13" not in sc.get(g, "FullScreenScreenShot", fallback="").split("\t"):
        fail.append("FullScreenScreenShot is not bound to F13")
rc = load("system_files/etc/xdg/spectaclerc")
if rc.get("ImageSave", "imageSaveLocation", fallback="") != "file:///var/home/armada/juegos/screensHots":
    fail.append("[ImageSave] imageSaveLocation is not ~/juegos/screensHots")
if rc.get("General", "autoSaveImage", fallback="") != "true":
    fail.append("[General] autoSaveImage is not true")
if fail: print("FAIL:", *fail, sep="\n  "); sys.exit(1)
print("spectacle defaults OK")
PY
