#!/usr/bin/env bash
# Charger mode wiring: nothing that paints the panel runs on a cable power-on
# (every armada splash unit and armada-boot-hotkeys carry the negated cmdline
# condition), the backlight rule is valid udev, the initramfs module installs the
# switch-root and splash drop-ins, and the target stays out of basic.target.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SYS="$ROOT/system_files/usr/lib/systemd/system"
SPLASH_UNITS="$ROOT/packages/armada-splash/system/usr/lib/systemd/system"
MOD="$ROOT/system_files/usr/lib/dracut/modules.d/91armada-charger/module-setup.sh"
COND='ConditionKernelCommandLine=!systemd.unit=armada-charger.target'
fail=0; tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
bad() { echo "FAIL: $*"; fail=1; }

units=(armada-boot-hotkeys.service)
for f in "$SPLASH_UNITS"/*.service; do units+=("${f##*/}"); done
(( ${#units[@]} >= 5 )) || bad "found only ${#units[@]} units to check"
for u in "${units[@]}"; do
    grep -qxF "$COND" "$SYS/$u.d/armada-charger.conf" 2>/dev/null || bad "$u has no charger-mode condition"
done

if command -v udevadm >/dev/null; then
    udevadm verify --resolve-names=never "$ROOT/system_files/usr/lib/udev/rules.d/61-armada-charger-backlight.rules" \
        >/dev/null 2>&1 || bad "61-armada-charger-backlight.rules does not pass udevadm verify"
else
    echo "SKIP: udevadm verify (no udevadm)"
fi
grep -q 'ENV{systemd.unit}=="armada-charger.target"' "$ROOT/system_files/usr/lib/udev/rules.d/61-armada-charger-backlight.rules" ||
    bad "backlight rule is not gated on the charger target"

# Run the module's install() against a scratch initdir.
initdir="$tmp/initrd"; systemdsystemunitdir=/usr/lib/systemd/system; rules=""
inst_rules() { rules+=" $*"; }
# shellcheck source=/dev/null
source "$MOD"
install
sr="$initdir/$systemdsystemunitdir/initrd-switch-root.service.d/armada-init.conf"
[[ "$(cat "$sr" 2>/dev/null)" == $'[Service]\nExecStart=\nExecStart=systemctl --no-block switch-root /sysroot /usr/lib/systemd/systemd' ]] ||
    bad "initrd-switch-root drop-in: $(cat "$sr" 2>/dev/null)"
grep -qxF "$COND" "$initdir/$systemdsystemunitdir/armada-splash-initrd.service.d/armada-charger.conf" 2>/dev/null ||
    bad "initrd splash has no charger-mode condition"
[[ "$rules" == *61-armada-charger-backlight.rules* ]] || bad "module does not install the backlight rule"
grep -q -- '--add armada-charger' "$ROOT/build_files/55-generate-initramfs.sh" || bad "initramfs build does not add armada-charger"

t="$SYS/armada-charger.target"; s="$SYS/armada-charger.service"
grep -qx 'Requires=sysinit.target' "$t" && grep -qx 'Wants=armada-charger.service' "$t" || bad "target wiring"
! grep -q 'basic.target\|multi-user.target' "$t" "$s" || bad "charger mode pulls basic/multi-user (update timers, network)"
grep -qx 'DefaultDependencies=no' "$s" && grep -qx 'Restart=always' "$s" &&
    grep -qx 'ConditionKernelCommandLine=systemd.unit=armada-charger.target' "$s" || bad "service wiring"

if (( fail )); then echo "charger-mode-units: FAILURES"; exit 1; fi
echo "PASS: charger-mode-units-test (${#units[@]} units)"
