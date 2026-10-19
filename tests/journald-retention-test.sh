#!/usr/bin/env bash
# The persistent journal is bounded both ways: entries older than one week are dropped
# (MaxRetentionSec=1week) and the disk use has a cap (SystemMaxUse) big enough for a week.
# Effective value = last assignment across journald.conf.d drop-ins in lexical order.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
D="$ROOT/system_files/usr/lib/systemd/journald.conf.d"
eff() { cat $(printf '%s\n' "$D"/*.conf | sort) | awk -F= -v k="$1" '$1==k {v=$2} END {print v}'; }
ret=$(eff MaxRetentionSec); max=$(eff SystemMaxUse)
[[ "$ret" == 1week ]] || { echo "FAIL: MaxRetentionSec efectivo = '$ret' (se espera 1week)"; exit 1; }
[[ "$max" =~ ^([0-9]+)M$ ]] && (( ${BASH_REMATCH[1]} >= 384 )) || { echo "FAIL: SystemMaxUse efectivo = '$max' (se espera >= 384M, ~1 semana)"; exit 1; }
echo "OK journald: retención 1week, tope $max"
