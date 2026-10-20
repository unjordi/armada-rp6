#!/usr/bin/env bash
# SM8550 PCIe across suspend: with 0522a the root port keeps its D3cold veto in
# suspend-to-RAM, so the link stays up. The GDSC must stay RET_ON (no 0566) and
# s2idle needs 0520's opp-suspend floor (0513 falls back to a NULL OPP without it).
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SERIES="$ROOT/packages/kernel/patches/series"
fail=0
active() { sed 's/[[:space:]]*#.*//' "$SERIES" | grep -qx "$1"; }

if active 0522a-PCI-host-common-keep-root-port-d3cold-veto-for-suspend-to-ram.patch; then
    echo "ok: 0522a in the series"
else
    echo "FAIL: 0522a is not in the series; recheck this test's premise"; fail=1
fi
if active 0566-clk-qcom-gcc-sm8550-let-the-pcie-gdscs-collapse-in-suspend.patch; then
    echo "FAIL: 0566 is active together with 0522a (GDSC collapses under a live link in deep)"; fail=1
else
    echo "ok: 0566 not applied"
fi
if active 0520-arm64-dts-qcom-sm8550-add-a-pcie-suspend-opp.patch &&
    [[ -f "$ROOT/packages/kernel/patches/0520-arm64-dts-qcom-sm8550-add-a-pcie-suspend-opp.patch" ]]; then
    echo "ok: 0520 applied"
else
    echo "FAIL: 0520 (SM8550 PCIe suspend OPP) missing; s2idle drops the PCIe memory vote"; fail=1
fi
grep -q 'opp-suspend' "$ROOT/packages/kernel/patches/0520-arm64-dts-qcom-sm8550-add-a-pcie-suspend-opp.patch" 2>/dev/null &&
    echo "ok: 0520 carries an opp-suspend entry" || { echo "FAIL: 0520 has no opp-suspend"; fail=1; }

if (( fail )); then echo "kernel-sm8550-pcie-suspend: FAILURES"; exit 1; fi
echo "PASS: kernel-sm8550-pcie-suspend-test"
