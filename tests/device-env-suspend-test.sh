#!/usr/bin/env bash
# Asserts the INTENT of the RP6 deep-suspend default, not just that device-env
# runs. device-env resolves ARMADA_SUSPEND_MODE from defaults.conf, the matched
# device profile, /sys/power/mem_sleep and /etc/armada/sleep.conf, in that order.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICE_ENV="$ROOT/system_files/usr/libexec/armada/device-env"
DEVICE_DIR="$ROOT/system_files/usr/lib/armada/devices"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail=0
pass=0

# resolve_mode <model> <mem_sleep_contents> <sleep_conf_contents|"">
# Prints the resolved ARMADA_SUSPEND_MODE. Empty sleep-conf arg => no sleep.conf.
resolve_mode() {
    local model=$1 mem_contents=$2 sleep_contents=${3-}
    local mem sconf
    mem="$WORK/mem_sleep"
    printf '%s\n' "$mem_contents" >"$mem"
    if [[ -n "$sleep_contents" ]]; then
        sconf="$WORK/sleep.conf"
        printf '%s\n' "$sleep_contents" >"$sconf"
    else
        sconf="$WORK/nonexistent-sleep.conf"
        rm -f "$sconf"
    fi
    local out
    out=$(ARMADA_DEVICE_DIR="$DEVICE_DIR" ARMADA_MODEL="$model" \
        ARMADA_MEM_SLEEP_PATH="$mem" ARMADA_SLEEP_CONFIG="$sconf" \
        bash "$DEVICE_ENV")
    eval "$out"
    printf '%s' "${ARMADA_SUSPEND_MODE:-}"
}

check() {
    local desc=$1 got=$2 want=$3
    if [[ "$got" == "$want" ]]; then
        pass=$((pass + 1))
        printf 'ok   - %s (got %q)\n' "$desc" "$got"
    else
        fail=$((fail + 1))
        printf 'FAIL - %s: got %q, want %q\n' "$desc" "$got" "$want"
    fi
}

# 1. The RP6 profile defaults to deep with no user override, when the kernel
#    advertises deep. This is the whole point of the branch.
check "RP6 defaults to deep" \
    "$(resolve_mode 'Retroid Pocket 6' 's2idle [deep]')" deep

# 2. An explicit, supported user override in sleep.conf wins over the profile.
check "RP6 sleep.conf=s2idle overrides the deep default" \
    "$(resolve_mode 'Retroid Pocket 6' 's2idle [deep]' 'suspend_mode=s2idle')" s2idle

# 3. fake is always accepted (it is not a kernel mem_sleep mode).
check "RP6 sleep.conf=fake is honored" \
    "$(resolve_mode 'Retroid Pocket 6' 's2idle [deep]' 'suspend_mode=fake')" fake

# 4. A user override the running kernel does NOT advertise falls back to the
#    device profile default (deep on the RP6) instead of being applied blindly.
check "RP6 unsupported sleep.conf override falls back to the profile default" \
    "$(resolve_mode 'Retroid Pocket 6' '[deep]' 'suspend_mode=s2idle')" deep

# 5. deep is RP6-scoped: every other/unknown device keeps the s2idle default
#    from defaults.conf, so the branch does not change the rest of the fleet.
check "unknown device keeps the s2idle fleet default" \
    "$(resolve_mode 'No Such Handheld' 's2idle [deep]')" s2idle

# 6. deep survives on the RP6 even when it is the *selected* kernel mode already
#    (s2idle absent), i.e. the profile default is not clobbered to fake.
check "RP6 stays on deep when only deep is advertised" \
    "$(resolve_mode 'Retroid Pocket 6' '[deep]')" deep

# 7. Fleet gate: an UNVALIDATED model (AYN Odin 2) does not run deep even when a
#    user sleep.conf asks for it and the kernel advertises deep -- it falls back
#    to the profile default (s2idle). This is the second compuerta: kernel-capable
#    is not enough; the model must be validated.
check "unvalidated model ignores a sleep.conf deep override" \
    "$(resolve_mode 'AYN Odin 2' 's2idle [deep]' 'suspend_mode=deep')" s2idle

# 8. Unvalidated model whose kernel advertises ONLY deep: a deep override drops to
#    the profile default (s2idle), which is not advertised, so it degrades to fake
#    -- never deep on unvetted hardware.
check "unvalidated model degrades a deep override to fake when only deep is advertised" \
    "$(resolve_mode 'AYN Odin 2' '[deep]' 'suspend_mode=deep')" fake

# 9. Same gate for an unknown device: a deep override never wins.
check "unknown device ignores a sleep.conf deep override" \
    "$(resolve_mode 'No Such Handheld' 's2idle [deep]' 'suspend_mode=deep')" s2idle

# 10. Dark resume (charger plug while in deep): on for the RP6 only, with a
#     sleep.conf kill switch. Reads ARMADA_DARK_RESUME as device-env publishes it.
resolve_dark() { # <model> <sleep_conf|"">
    local mem="$WORK/mem_sleep" sconf="$WORK/dark-sleep.conf" out
    printf 's2idle [deep]\n' >"$mem"
    if [[ -n "${2-}" ]]; then printf '%s\n' "$2" >"$sconf"; else rm -f "$sconf"; fi
    out=$(ARMADA_DEVICE_DIR="$DEVICE_DIR" ARMADA_MODEL="$1" \
        ARMADA_MEM_SLEEP_PATH="$mem" ARMADA_SLEEP_CONFIG="$sconf" bash "$DEVICE_ENV")
    eval "$out"
    printf '%s' "${ARMADA_DARK_RESUME:-}"
}
check "RP6 enables dark resume by default" "$(resolve_dark 'Retroid Pocket 6' '')" 1
check "RP6 sleep.conf dark_resume=0 turns it off" "$(resolve_dark 'Retroid Pocket 6' 'dark_resume=0')" 0
check "RP6 sleep.conf dark_resume=1 keeps it on (and coexists with suspend_mode)" \
    "$(resolve_dark 'Retroid Pocket 6' $'suspend_mode=deep\ndark_resume=1')" 1
check "other devices keep dark resume off" "$(resolve_dark 'AYN Odin 2' '')" 0
check "garbage dark_resume value is ignored" "$(resolve_dark 'Retroid Pocket 6' 'dark_resume=maybe')" 1

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
