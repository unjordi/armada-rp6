#!/usr/bin/env bash
# Asserts the INTENT of 45-armada-wake-policy: on a deep-suspend device, only the power
# key and RTC alarm stay wakeup-armed across suspend; every other source is disabled at
# pre and restored at post. On a non-deep (s2idle fleet) device it is a no-op.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/system_files/usr/lib/systemd/system-sleep/45-armada-wake-policy"
[[ -x "$HOOK" ]]
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT

# fake sysfs: 2 keep (pwrkey, rtc) + 2 spurious (thermal, remoteproc)
declare -A W=(
  [c400000.spmi:pmic@0:pon@1300:pwrkey]=enabled
  [c400000.spmi:pmic@0:rtc@6100]=enabled
  [c273000.thermal-sensor]=enabled
  [32300000.remoteproc]=enabled
)
for name in "${!W[@]}"; do
  d="$tmp/sys/devices/platform/$name"; mkdir -p "$d/power"
  printf '%s\n' "${W[$name]}" >"$d/power/wakeup"
done
state="$tmp/run/armada/wake-policy-disabled.list"

mkdenv() {  # $1 = suspend mode the stubbed device-env reports
  local f="$tmp/device-env-$1"
  printf '#!/bin/bash\necho ARMADA_SUSPEND_MODE=%s\n' "$1" >"$f"; chmod +x "$f"
  printf '%s' "$f"
}
run() {  # $1=pre|post $2=mode
  ARMADA_SYSFS_ROOT="$tmp/sys" ARMADA_WAKE_POLICY_STATE="$state" \
    ARMADA_DEVICE_ENV="$(mkdenv_cache_$2)" "$HOOK" "$1" suspend
}
mkdenv_cache_deep()   { mkdenv deep; }
mkdenv_cache_s2idle() { mkdenv s2idle; }
val() { cat "$tmp/sys/devices/platform/$1/power/wakeup"; }

# --- scenario 1: deep device → pre disables spurious, keeps pwrkey/rtc ---
run pre deep
[[ "$(val 'c400000.spmi:pmic@0:pon@1300:pwrkey')" == enabled  ]] || { echo "FAIL: pwrkey desarmado"; exit 1; }
[[ "$(val 'c400000.spmi:pmic@0:rtc@6100')"        == enabled  ]] || { echo "FAIL: rtc desarmado"; exit 1; }
[[ "$(val 'c273000.thermal-sensor')"             == disabled ]] || { echo "FAIL: thermal NO desarmado"; exit 1; }
[[ "$(val '32300000.remoteproc')"                == disabled ]] || { echo "FAIL: remoteproc NO desarmado"; exit 1; }
grep -q 'thermal-sensor'  "$state" || { echo "FAIL: thermal no en state"; exit 1; }
grep -q 'remoteproc'      "$state" || { echo "FAIL: remoteproc no en state"; exit 1; }
grep -q 'pwrkey'          "$state" && { echo "FAIL: pwrkey en state (no debe)"; exit 1; }

# --- post restores everything ---
run post deep
for name in "${!W[@]}"; do
  [[ "$(val "$name")" == enabled ]] || { echo "FAIL: $name no restaurado en post"; exit 1; }
done
[[ -e "$state" ]] && { echo "FAIL: state no borrado en post"; exit 1; }

# --- scenario 2: s2idle fleet device → no-op (nada se desarma) ---
run pre s2idle
[[ "$(val 'c273000.thermal-sensor')" == enabled ]] || { echo "FAIL: s2idle debía ser no-op"; exit 1; }
[[ -s "$state" ]] && { echo "FAIL: s2idle escribió state (no debe)"; exit 1; }

echo "wake-policy-hook-test: OK"
