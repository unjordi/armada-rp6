#!/usr/bin/env bash
# Dark resume (suspend-dispatch + dark-resume-lib): in deep, a wake whose ONLY
# change is the charger (plug/unplug) must put the device back to sleep without
# ever returning to the caller (so logind/Steam never see a resume), while a
# power-button, rtc or unexplained wake -- or any failure -- ends in the full
# resume of today. Uses a fake sysfs, /proc/interrupts, systemctl and a fake
# systemd-sleep that replays a script of "events", one per invocation.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DISPATCH="$ROOT/system_files/usr/libexec/armada/suspend-dispatch"
LIB="$ROOT/system_files/usr/lib/armada/dark-resume-lib"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
fail=0

sysfs="$tmp/sys"; interrupts="$tmp/interrupts"; ledger="$tmp/ledger"
script="$tmp/script"; counter="$tmp/counter"; sleep_log="$tmp/sleep.log"; sc_log="$tmp/systemctl.log"
pk_file="$tmp/pwrkey0"; hook_log="$tmp/hook56.log"

# --- fake systemd-sleep: applies event N of the script, then returns ----------
# events: usb=<0|1> | pwrkey (counter+1, wake IRQ none) | pwrkey-irq (counter+1,
# IRQ 21) | rtc | fail | none
cat >"$tmp/systemd-sleep" <<'FAKE'
#!/bin/bash
n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$COUNTER"
echo "call=$n args=$* freeze_env=${SYSTEMD_SLEEP_FREEZE_USER_SESSIONS:-unset}" >>"$SLEEP_LOG"
: >"$SYSFS/power/pm_wakeup_irq"
ev=$(sed -n "${n}p" "$SCRIPT"); ev=${ev:-none}
bump() { local c; c=$(awk '$NF=="pmic_pwrkey"{print $2}' "$INTERRUPTS"); printf ' 21:  %d  0  pmic_pwrkey\n200:  0  0  pm8xxx_rtc_alarm\n' $((c+1)) >"$INTERRUPTS"; }
case "$ev" in
    usb=*) echo "${ev#usb=}" >"$SYSFS/class/power_supply/usb/online"
           if [[ "${ev#usb=}" == 1 ]]; then echo Charging; else echo Discharging; fi >"$SYSFS/class/power_supply/battery/status" ;;
    pwrkey) bump ;;
    pwrkey-irq) bump; echo 21 >"$SYSFS/power/pm_wakeup_irq" ;;
    rtc) echo 200 >"$SYSFS/power/pm_wakeup_irq" ;;
    fail) exit 3 ;;
esac
exit 0
FAKE
cat >"$tmp/systemctl" <<'FAKE'
#!/bin/bash
echo "$*" >>"$SC_LOG"
[[ "$1" == freeze && -n "${FAKE_FREEZE_FAIL:-}" ]] && exit 1
exit 0
FAKE
cat >"$tmp/hook56" <<'FAKE'
#!/bin/bash
echo "$* force=${ARMADA_RGB_FORCE_RESTORE:-0}" >>"$HOOK_LOG"
FAKE
cat >"$tmp/device-env" <<'FAKE'
#!/bin/bash
echo "ARMADA_SUSPEND_MODE=${FAKE_MODE:-deep}"
echo "ARMADA_DARK_RESUME=${FAKE_DARK:-1}"
FAKE
chmod +x "$tmp"/{systemd-sleep,systemctl,hook56,device-env}

# $1.. = events. Env FAKE_* / extra ARMADA_* may be exported by the caller.
run() {
    mkdir -p "$sysfs/power" "$sysfs/class/power_supply/usb" "$sysfs/class/power_supply/battery"
    : >"$sysfs/power/pm_wakeup_irq"; echo 0 >"$sysfs/class/power_supply/usb/online"
    echo Discharging >"$sysfs/class/power_supply/battery/status"
    printf ' 21:  0  0  pmic_pwrkey\n200:  0  0  pm8xxx_rtc_alarm\n' >"$interrupts"
    : >"$ledger"; : >"$sleep_log"; : >"$sc_log"; : >"$hook_log"; rm -f "$counter" "$pk_file"
    printf '%s\n' "$@" >"$script"
    echo '[s2idle] deep' >"$tmp/mem_sleep"   # the dispatcher overwrites it
    rc=0
    env ARMADA_DEVICE_ENV="$tmp/device-env" ARMADA_MEM_SLEEP_PATH="$tmp/mem_sleep" \
        ARMADA_SYSTEMD_SLEEP="$tmp/systemd-sleep" ARMADA_DARK_RESUME_LIB="${LIB_OVERRIDE:-$LIB}" \
        ARMADA_SYSFS_ROOT="$sysfs" ARMADA_PROC_INTERRUPTS="$interrupts" ARMADA_DARK_RESUME_LOG="$ledger" \
        ARMADA_SYSTEMCTL="$tmp/systemctl" ARMADA_DARK_RESUME_HOOK56="$tmp/hook56" \
        ARMADA_DARK_RESUME_PWRKEY0="$pk_file" ARMADA_DARK_RESUME_SETTLE_TICKS=2 \
        COUNTER="$counter" SLEEP_LOG="$sleep_log" SYSFS="$sysfs" SCRIPT="$script" INTERRUPTS="$interrupts" \
        SC_LOG="$sc_log" HOOK_LOG="$hook_log" \
        timeout 20 bash "$DISPATCH" >/dev/null 2>"$tmp/stderr" || rc=$?
}
calls() { wc -l <"$sleep_log" | tr -d ' '; }
check() { if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1 -- got [$2] exp [$3]"; fail=1; fi; }
has()  { if grep -q -- "$2" "$3"; then echo "ok: $1"; else echo "FAIL: $1 -- [$2] not in: $(paste -sd'|' "$3")"; fail=1; fi; }
lacks(){ if grep -q -- "$2" "$3"; then echo "FAIL: $1 -- [$2] unexpectedly present"; fail=1; else echo "ok: $1"; fi; }
nlines(){ grep -c -- "$1" "$2" || true; }

# 1) charger plugged while asleep -> sleeps again; then the button -> exits.
run usb=1 pwrkey-irq
check "plug then button: 2 sleep rounds" "$(calls)" 2
check "plug then button: exit 0" "$rc" 0
has "plug then button: ledger reason=charger" "reason=charger" "$ledger"
has "plug then button: ledger reason=user" "reason=user" "$ledger"
check "ledger order: charger first, user last" "$(grep -o 'reason=[a-z]*' "$ledger" | paste -sd, -)" "reason=charger,reason=user"
has "user.slice frozen once" "^freeze user.slice" "$sc_log"
has "user.slice thawed on exit" "^thaw user.slice" "$sc_log"
has "systemd-sleep told not to thaw user sessions itself" "freeze_env=0" "$sleep_log"
check "user wake: no forced LED restore from the lib (hook 56 post did it)" "$(cat "$hook_log")" ""
check "pwrkey0 marker removed on exit" "$([[ -e $pk_file ]] && echo yes || echo no)" no

# 1b) button reported as IRQ none (counter delta only) -> still the user.
run usb=1 pwrkey
check "plug then button(none irq): 2 rounds, stops" "$(calls)" 2
has "button(none irq): reason=user" "reason=user" "$ledger"

# 1c) unplug after plug, then the button: charger twice, user last.
run usb=1 usb=0 pwrkey-irq
check "plug+unplug+button: 3 rounds" "$(calls)" 3
check "plug+unplug+button: two charger reasons" "$(nlines reason=charger "$ledger")" 2

# 2) button on the first round -> exits without sleeping again.
run pwrkey-irq
check "button first: single sleep call" "$(calls)" 1
has "button first: reason=user" "reason=user" "$ledger"

# 3) rtc -> exits (an alarm somebody set wants a full resume).
run rtc
check "rtc: single sleep call" "$(calls)" 1
has "rtc: reason=rtc" "reason=rtc" "$ledger"

# 3b) rtc after a dark round: full resume AND the LEDs are handed back.
run usb=1 rtc
check "plug then rtc: 2 rounds" "$(calls)" 2
has "plug then rtc: forced LED restore (non-user final wake)" "post suspend force=1" "$hook_log"

# 4) unexplained wake (nothing changed) -> exits like today.
run none
check "unknown reason: single sleep call" "$(calls)" 1
has "unknown reason: reason=unknown" "reason=unknown" "$ledger"
check "unknown reason: exit 0" "$rc" 0

# 5) cap: charger flipping every round stops at ARMADA_DARK_RESUME_MAX.
export ARMADA_DARK_RESUME_MAX=3
run usb=1 usb=0 usb=1 usb=0 usb=1 usb=0
unset ARMADA_DARK_RESUME_MAX
check "cap: stops after MAX sleep calls" "$(calls)" 3
has "cap: ledger reason=cap" "reason=cap" "$ledger"
check "cap: two charger rounds before the cap" "$(nlines reason=charger "$ledger")" 2
has "cap: thawed" "^thaw user.slice" "$sc_log"
has "cap: LEDs handed back" "post suspend force=1" "$hook_log"

# 6) freeze fails -> today's behaviour: plain exec of systemd-sleep, no loop.
FAKE_FREEZE_FAIL=1 run usb=1 pwrkey-irq
check "freeze fails: exactly one plain sleep call (no loop)" "$(calls)" 1
check "freeze fails: no thaw attempted" "$(nlines '^thaw' "$sc_log")" 0
lacks "freeze fails: sleep not run with the frozen-slice env" "freeze_env=0" "$sleep_log"

# 7) always thaws, even when systemd-sleep fails (and returns its code).
run fail
check "sleep rc!=0: propagated" "$rc" 3
has "sleep rc!=0: thawed" "^thaw user.slice" "$sc_log"
has "sleep rc!=0: reason=failed" "reason=failed" "$ledger"
run usb=1 fail
check "failure after a dark round: propagated" "$rc" 3
has "failure after a dark round: thawed" "^thaw user.slice" "$sc_log"
has "failure after a dark round: LEDs handed back" "post suspend force=1" "$hook_log"

# 7b) charger state unreadable -> never dark-resume.
ARMADA_DARK_RESUME_SUPPLIES="nothere" run usb=1
check "unreadable charger: single sleep call" "$(calls)" 1

# 8) not applicable -> plain exec, loop never used.
FAKE_DARK=0 run usb=1 pwrkey-irq
check "ARMADA_DARK_RESUME=0: single plain call" "$(calls)" 1
check "ARMADA_DARK_RESUME=0: no freeze" "$(nlines '^freeze' "$sc_log")" 0
FAKE_MODE=s2idle run usb=1 pwrkey-irq
check "mode=s2idle: single plain call" "$(calls)" 1
check "mode=s2idle: no freeze" "$(nlines '^freeze' "$sc_log")" 0

# 9) lib missing -> today's behaviour (plain suspend), warns.
LIB_OVERRIDE="$tmp/no-such-lib" run usb=1 pwrkey-irq
check "lib missing: single plain call" "$(calls)" 1
has "lib missing: warned" "dark-resume lib missing" "$tmp/stderr"

# 10) settle_battery_status waits until status agrees (and gives up quietly).
(
    export ARMADA_SYSFS_ROOT="$sysfs" ARMADA_DARK_RESUME_SETTLE_TICKS=3
    # shellcheck source=/dev/null
    source "$LIB"
    echo Discharging >"$sysfs/class/power_supply/battery/status"
    ( sleep 0.15; echo Charging >"$sysfs/class/power_supply/battery/status" ) &
    settle_battery_status "10"   # returns as soon as Charging shows (<= 3 ticks)
    echo Charging >"$sysfs/class/power_supply/battery/status"
    settle_battery_status "10"
    echo Discharging >"$sysfs/class/power_supply/battery/status"
    settle_battery_status "00"
    wait
) && echo "ok: settle_battery_status terminates" || { echo "FAIL: settle_battery_status"; fail=1; }

if (( fail )); then echo "dark-resume: FAILURES"; exit 1; fi
echo "PASS: dark-resume-test"
