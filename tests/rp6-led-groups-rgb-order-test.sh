#!/usr/bin/env bash
# Each multi-led group of the RP6 DTS lists its channels as red, green, blue BY THEIR color property:
# the kernel's multicolor triggers (battery-charging-orange-full-green) fill intensities by position
# assuming R,G,B, so any other order paints the wrong colour.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DTS="$ROOT/packages/kernel/dts/qcs8550-retroidpocket-rp6.dts"
awk '
  /^[[:space:]]*[a-z0-9_]+: led@/ { h=$1; sub(":", "", h) }
  h != "" && /color = <LED_COLOR_ID_/ { c=$0; sub(/.*LED_COLOR_ID_/, "", c); sub(/>.*/, "", c); color[h]=c; h="" }
  /leds = <&/ { groups[++n]=$0 }
  END {
    bad=0
    for (i=1; i<=n; i++) {
      line=groups[i]; got=""
      while (match(line, /&[a-z0-9_]+/)) { k=substr(line, RSTART+1, RLENGTH-1); got=got (got==""?"":",") color[k]; line=substr(line, RSTART+RLENGTH) }
      if (got != "RED,GREEN,BLUE") { print "FAIL: group " i " is " got ": " groups[i]; bad=1 }
    }
    if (n != 8) { print "FAIL: expected 8 multi-led groups, found " n; bad=1 }
    if (!bad) print "OK rp6 led groups: 8 groups in red,green,blue order"
    exit bad
  }' "$DTS"
