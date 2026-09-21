#!/usr/bin/env bash
# Exercises the fan-suspend-charging gate: on suspend it raises the pwm-fan
# suspend_pwm knob only while charging, zeroes it on battery, resets on resume,
# clamps/validates the override, and is a no-op when the knob is absent.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/system_files/usr/lib/systemd/system-sleep/55-armada-fan-suspend-charging"
[[ -x "$HOOK" ]] || { echo "FAIL: hook not executable"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

sysfs="$tmp/sys"
knob="$tmp/suspend_pwm"
floor_file="$tmp/floor"
mkdir -p "$sysfs/class/power_supply/battery" "$sysfs/class/power_supply/usb"

set_status() { printf '%s\n' "$1" >"$sysfs/class/power_supply/battery/status"; }
set_knob()   { printf '%s\n' "$1" >"$knob"; }
get_knob()   { cat "$knob"; }

run_hook() {
    env \
        "ARMADA_SYSFS_ROOT=$sysfs" \
        "ARMADA_PWM_FAN_SUSPEND_KNOB=$knob" \
        "ARMADA_FAN_SUSPEND_CHARGING_PWM_FILE=$floor_file" \
        bash "$HOOK" "$@"
}

fail=0
check() { if [[ "$2" != "$3" ]]; then echo "FAIL: $1 (want '$3' got '$2')"; fail=1; else echo "ok: $1"; fi; }

# 1) charging -> suspend raises knob to the default floor (51, quietest reliable spin)
set_knob 0; set_status Charging; printf 'usb\n' >"$sysfs/class/power_supply/usb/type"
run_hook pre suspend
check "charging pre -> default floor" "$(get_knob)" "51"

# 2) resume resets to 0
run_hook post suspend
check "post -> reset to 0" "$(get_knob)" "0"

# 3) on battery -> suspend keeps knob 0 (no leak)
set_knob 99; set_status Discharging
run_hook pre suspend
check "discharging pre -> 0" "$(get_knob)" "0"

# 4) override file honoured + clamped to 255
set_knob 0; set_status Charging; printf '999\n' >"$floor_file"
run_hook pre suspend
check "override clamped to 255" "$(get_knob)" "255"

# 5) invalid override falls back to default
set_knob 0; printf 'garbage\n' >"$floor_file"
run_hook pre suspend
check "invalid override -> default 51" "$(get_knob)" "51"
rm -f "$floor_file"

# 6) non-suspend sleep type ignored (hibernate)
set_knob 7; set_status Charging
run_hook pre hibernate
check "hibernate ignored" "$(get_knob)" "7"

# 7) knob absent -> no-op / no crash
rm -f "$knob"; set_status Charging
run_hook pre suspend && echo "ok: absent knob no-op (exit 0)" || { echo "FAIL: crashed on absent knob"; fail=1; }
[[ -e "$knob" ]] && { echo "FAIL: hook created the knob"; fail=1; } || echo "ok: did not fabricate knob"

if (( fail )); then echo "fan-suspend-charging hook: FAILURES"; exit 1; fi
echo "PASS: fan-suspend-charging-hook-test"
