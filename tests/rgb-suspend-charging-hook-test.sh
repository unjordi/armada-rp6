#!/usr/bin/env bash
# Exercises the RGB-suspend-charging hook (armada#26 + QG-8), DESIGN A (kernel
# LED trigger): on suspend, when the user opted in, it (1) STOPS the armada-rgb
# daemon so it stops reclaiming the LEDs from the kernel trigger on every render
# tick (backend.rs reclaim_led) -- otherwise its last tick before freeze would
# disarm our hand-off (QG-8); (2) keeps the HTR3212 controllers powered through
# sleep (keep_alive=1); (3) hands the stick LEDs to a kernel trigger
# ("<psy>-charging-orange-full-green") so the kernel repaints them amber/green
# when a power_supply_changed() fires mid-sleep, with no CPU/userspace; and
# (4) SEEDS the current charge state onto the LEDs right now, because arming the
# trigger does NOT paint an initial frame -- if the charger was already attached
# before sleep there is no edge, so without the seed the LEDs would sleep showing
# the user's last color, not the charge status (QG-8 causa a). On resume it
# disarms the trigger, clears keep_alive, and starts the daemon back up (or, if
# it never stopped one, nudges a repaint via `armada-rgb apply`). It is a no-op
# for a non-suspend sleep type or when the opt-in is off, and never fails/blocks
# suspend even if nodes are missing or armada-rgb errors.
#
# This is the DESIGN-A contract. There is deliberately NO `armada-rgb
# charge-indicator` CLI (that dead design-B path was removed): the suspend
# painting is owned by the kernel trigger + the hook's seed, not a userspace
# command. And it does NOT gate the ARM on charging state (it still arms on
# opt-in alone, so a plug-in while asleep is caught); it only gates the SEED
# color on the current status.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/system_files/usr/lib/systemd/system-sleep/56-armada-rgb-suspend-charging"
[[ -x "$HOOK" ]] || { echo "FAIL: hook not executable"; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
fail=0
TRIGGER="battery-charging-orange-full-green"

# ---- fake sysfs: 8 multicolor group LED nodes (2 HTR3212 controllers) -------
# Each node carries the same attrs the real htr3212 group LEDs expose: a
# `trigger` list, a `multi_index` order (this device reports "blue green red"),
# a `multi_intensity` triple and brightness/max_brightness.
leds=()
for n in l1 l2 l3 l4 r1 r2 r3 r4; do
    d="$tmp/leds/rgb:$n"; mkdir -p "$d"
    printf 'none\n' >"$d/trigger"
    printf 'blue green red\n' >"$d/multi_index"
    printf '10 20 30\n' >"$d/multi_intensity"
    printf '0\n' >"$d/brightness"
    printf '255\n' >"$d/max_brightness"
    leds+=("$d")
done
LEDS_GLOB="$tmp/leds/rgb:l? $tmp/leds/rgb:r?"

# ---- fake keep_alive knobs, one per bound htr3212 controller ----------------
for addr in 3-0030 2-0030; do
    mkdir -p "$tmp/htr3212/$addr"; printf '0\n' >"$tmp/htr3212/$addr/keep_alive"
done
KA_GLOB="$tmp/htr3212/*/keep_alive"

# ---- fake power_supply/battery under ARMADA_SYSFS_ROOT ----------------------
psy_dir="$tmp/sysfs/class/power_supply/battery"; mkdir -p "$psy_dir"
set_charge() { printf '%s\n' "$1" >"$psy_dir/status"; printf '%s\n' "${2:-50}" >"$psy_dir/capacity"; }

# ---- opt-in config ----------------------------------------------------------
indicator_config="$tmp/indicator.conf"
set_indicator()   { printf 'enabled=%s\n' "$1" >"$indicator_config"; }
clear_indicator() { rm -f "$indicator_config"; }

# ---- fake armada-rgb tool (logs its argv) -----------------------------------
rgb_calls="$tmp/calls.log"; : >"$rgb_calls"
rgb_tool="$tmp/armada-rgb"
cat >"$rgb_tool" <<'EOF'
#!/bin/bash
echo "$@" >>"$RGB_CALLS"
EOF
chmod +x "$rgb_tool"

# ---- fake systemctl on PATH (logs argv; is-active reflects a state file) -----
sc_log="$tmp/systemctl.log"; : >"$sc_log"
sc_active_flag="$tmp/service-active"
mkdir -p "$tmp/bin"
cat >"$tmp/bin/systemctl" <<'EOF'
#!/bin/bash
echo "$*" >>"$SYSTEMCTL_LOG"
if [[ "$1 $2" == "is-active --quiet" ]]; then
    [[ -f "$SYSTEMCTL_ACTIVE" ]] && exit 0 || exit 1
fi
exit 0
EOF
chmod +x "$tmp/bin/systemctl"
service_active()   { : >"$sc_active_flag"; }
service_inactive() { rm -f "$sc_active_flag"; }

marker="$tmp/daemon-marker"

# ---- helpers ----------------------------------------------------------------
run_hook() { # $1=pre|post  $2=suspend|hibernate  [$3=rgb_tool override]
    PATH="$tmp/bin:$PATH" env \
        ARMADA_SYSFS_ROOT="$tmp/sysfs" \
        ARMADA_RGB_TOOL="${3:-$rgb_tool}" \
        ARMADA_RGB_SERVICE="armada-rgb.service" \
        ARMADA_RGB_DAEMON_MARKER="$marker" \
        ARMADA_RGB_CHARGE_INDICATOR_CONFIG="$indicator_config" \
        ARMADA_RGB_INDICATOR_LEDS="$LEDS_GLOB" \
        ARMADA_RGB_KEEPALIVE="$KA_GLOB" \
        RGB_CALLS="$rgb_calls" \
        SYSTEMCTL_LOG="$sc_log" \
        SYSTEMCTL_ACTIVE="$sc_active_flag" \
        bash "$HOOK" "$1" "$2"
}
triggers()   { for d in "${leds[@]}"; do cat "$d/trigger"; done | sort -u | paste -sd, -; }
keepalives() { cat "$tmp"/htr3212/*/keep_alive | sort -u | paste -sd, -; }
intensities(){ for d in "${leds[@]}"; do cat "$d/multi_intensity"; done | sort -u | paste -sd, -; }
brights()    { for d in "${leds[@]}"; do cat "$d/brightness"; done | sort -u | paste -sd, -; }
reset_nodes() {
    for d in "${leds[@]}"; do
        printf 'none\n' >"$d/trigger"; printf '10 20 30\n' >"$d/multi_intensity"; printf '0\n' >"$d/brightness"
    done
    for f in "$tmp"/htr3212/*/keep_alive; do printf '0\n' >"$f"; done
    : >"$rgb_calls"; : >"$sc_log"; rm -f "$marker"
}
check() { # $1=msg $2=got $3=exp
    if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1 — got [$2] exp [$3]"; fail=1; fi
}
grep_ok() { # $1=msg $2=file $3=pattern
    if grep -qE "$3" "$2"; then echo "ok: $1"; else echo "FAIL: $1 — pattern [$3] not in $(paste -sd'|' "$2")"; fail=1; fi
}
grep_absent() { # $1=msg $2=file $3=pattern
    if grep -qE "$3" "$2"; then echo "FAIL: $1 — pattern [$3] unexpectedly present"; fail=1; else echo "ok: $1"; fi
}

# 1) opt-in ON, charging mid-SOC, daemon active -> pre suspend:
#    stops the daemon, arms the trigger + keep_alive on ALL nodes, and SEEDS
#    amber (multi_index "blue green red" -> "0 168 255") at full brightness.
reset_nodes; set_indicator 1; set_charge Charging 60; service_active
run_hook pre suspend
check "pre+on: every LED handed to the kernel trigger" "$(triggers)" "$TRIGGER"
check "pre+on: every controller kept alive through sleep" "$(keepalives)" "1"
grep_ok "pre+on: daemon STOPPED before arming (QG-8 reclaim race)" "$sc_log" "^stop armada-rgb\.service$"
check "pre+on: marker recorded that WE stopped it" "$([[ -e "$marker" ]] && echo yes || echo no)" "yes"
check "pre+on+charging: seeds amber on every LED (0 168 255)" "$(intensities)" "0 168 255"
check "pre+on+charging: seeds full brightness" "$(brights)" "255"
check "pre+on: no armada-rgb call at pre (kernel + seed own the paint)" "$(cat "$rgb_calls")" ""

# 2) opt-in ON, FULL -> seeds green (0 255 0).
reset_nodes; set_indicator 1; set_charge Full 100; service_active
run_hook pre suspend
check "pre+on+full: seeds green on every LED (0 255 0)" "$(intensities)" "0 255 0"
check "pre+on+full: trigger still armed" "$(triggers)" "$TRIGGER"

# 3) opt-in ON, charging AT 100% but status still 'Charging' -> treated as full.
reset_nodes; set_indicator 1; set_charge Charging 100; service_active
run_hook pre suspend
check "pre+on+charging@100: seeds green (topped off)" "$(intensities)" "0 255 0"

# 4) opt-in ON, DISCHARGING -> arms the trigger (plug-in-while-asleep still
#    works) but does NOT seed a color (LEDs left as-is; sleeping glow off).
reset_nodes; set_indicator 1; set_charge Discharging 55; service_active
run_hook pre suspend
check "pre+on+discharging: trigger still armed (catches later plug-in)" "$(triggers)" "$TRIGGER"
check "pre+on+discharging: no seed (LEDs left alone)" "$(intensities)" "10 20 30"
check "pre+on+discharging: brightness left alone" "$(brights)" "0"

# 5) daemon NOT active at pre -> we don't stop it, no marker, no seed-blocking.
reset_nodes; set_indicator 1; set_charge Charging 60; service_inactive
run_hook pre suspend
grep_absent "pre+inactive: no stop issued when daemon wasn't running" "$sc_log" "^stop "
check "pre+inactive: no marker (nothing to restart later)" "$([[ -e "$marker" ]] && echo yes || echo no)" "no"
check "pre+inactive: still arms + seeds (charge shown regardless)" "$(triggers)" "$TRIGGER"

# 6) DESIGN-A KEY: it does NOT gate the ARM on charging state.
reset_nodes; set_indicator 1; set_charge Discharging 40; service_active
run_hook pre suspend
check "pre+on arms regardless of charge state (plug-in-while-asleep case)" "$(triggers)" "$TRIGGER"

# 7) opt-in OFF -> pre suspend is a no-op (nothing armed, daemon untouched).
reset_nodes; set_indicator 0; set_charge Charging 60; service_active
run_hook pre suspend
check "pre+off: nothing armed (trigger left alone)" "$(triggers)" "none"
check "pre+off: keep_alive left alone"              "$(keepalives)" "0"
check "pre+off: no seed"                            "$(intensities)" "10 20 30"
grep_absent "pre+off: daemon left running"          "$sc_log" "^stop "

# 8) opt-in config MISSING -> default OFF -> no-op.
reset_nodes; clear_indicator; service_active
run_hook pre suspend
check "pre+missing-config: default off, nothing armed" "$(triggers)" "none"
set_indicator 1

# 9) resume with a marker (we stopped the daemon) -> disarms UNCONDITIONALLY and
#    STARTS the daemon back up (not `apply`).
reset_nodes; : >"$marker"
for d in "${leds[@]}"; do printf '%s\n' "$TRIGGER" >"$d/trigger"; done
for f in "$tmp"/htr3212/*/keep_alive; do printf '1\n' >"$f"; done
run_hook post suspend
check "post: trigger disarmed on every LED"      "$(triggers)" "none"
check "post: keep_alive cleared on every ctrl"   "$(keepalives)" "0"
grep_ok "post: daemon STARTED back up"           "$sc_log" "^start armada-rgb\.service$"
check "post: marker cleared"                     "$([[ -e "$marker" ]] && echo yes || echo no)" "no"
check "post: did NOT use apply (started service instead)" "$(cat "$rgb_calls")" ""

# 10) resume with NO marker (daemon was never ours to stop) -> disarms + nudges
#     a repaint via `armada-rgb apply`.
reset_nodes
for d in "${leds[@]}"; do printf '%s\n' "$TRIGGER" >"$d/trigger"; done
run_hook post suspend
check "post+no-marker: trigger disarmed"         "$(triggers)" "none"
check "post+no-marker: repaints user lighting via apply" "$(cat "$rgb_calls")" "apply"
grep_absent "post+no-marker: no start issued"    "$sc_log" "^start "

# 11) post is unconditional even with opt-in OFF (restore lighting either way).
reset_nodes; set_indicator 0
for d in "${leds[@]}"; do printf '%s\n' "$TRIGGER" >"$d/trigger"; done
run_hook post suspend
check "post+off: still disarmed unconditionally" "$(triggers)" "none"
check "post+off: still repaints via apply"       "$(cat "$rgb_calls")" "apply"
set_indicator 1

# 12) non-suspend sleep type (hibernate) is ignored entirely.
reset_nodes; set_charge Charging 60; service_active
run_hook pre hibernate
check "hibernate pre ignored (nothing armed)" "$(triggers)" "none"
grep_absent "hibernate pre: daemon untouched" "$sc_log" "^stop "
run_hook post hibernate
check "hibernate post ignored (no apply)" "$(cat "$rgb_calls")" ""

# 13) armada-rgb tool missing on resume (no marker) -> still disarms, exits 0.
reset_nodes
for d in "${leds[@]}"; do printf '%s\n' "$TRIGGER" >"$d/trigger"; done
if run_hook post suspend "$tmp/does-not-exist"; then echo "ok: missing tool -> exit 0"; else echo "FAIL: missing tool should not fail"; fail=1; fi
check "post+missing-tool: still disarmed" "$(triggers)" "none"

# 14) never blocks suspend: pre exits 0 even with no LED nodes at all.
reset_nodes; set_charge Charging 60; service_active
if PATH="$tmp/bin:$PATH" env ARMADA_RGB_INDICATOR_LEDS="$tmp/nope/rgb:l?" ARMADA_RGB_KEEPALIVE="$tmp/nope/*/keep_alive" \
     ARMADA_SYSFS_ROOT="$tmp/sysfs" ARMADA_RGB_SERVICE="armada-rgb.service" ARMADA_RGB_DAEMON_MARKER="$marker" \
     ARMADA_RGB_CHARGE_INDICATOR_CONFIG="$indicator_config" ARMADA_RGB_TOOL="$rgb_tool" RGB_CALLS="$rgb_calls" \
     SYSTEMCTL_LOG="$sc_log" SYSTEMCTL_ACTIVE="$sc_active_flag" \
     bash "$HOOK" pre suspend; then echo "ok: no nodes -> pre exit 0"; else echo "FAIL: missing nodes should not block suspend"; fail=1; fi

# 15) partial hardware: a node ABSENT mid-list is skipped gracefully — the hook
#     still exits 0 (never blocks suspend) and the LEDs that ARE present still
#     get armed. (One HTR3212 controller unbound / a node not yet probed.)
reset_nodes; set_indicator 1; set_charge Charging 60; service_active
rm -rf "$tmp/leds/rgb:l2"   # yank one node from the middle of the glob
if run_hook pre suspend; then partial_rc=1; else partial_rc=0; fail=1; fi
check "pre+missing-node: exit 0 (never blocks suspend)" "$partial_rc" "1"
check "pre+missing-node: a present LED still got armed" "$(cat "$tmp/leds/rgb:l1/trigger" 2>/dev/null)" "$TRIGGER"

if (( fail )); then echo "rgb-suspend-charging hook: FAILURES"; exit 1; fi
echo "PASS: rgb-suspend-charging-hook-test (design A / kernel trigger + QG-8 seed & daemon hand-off)"
