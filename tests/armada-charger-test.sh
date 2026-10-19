#!/usr/bin/env bash
# armada-charger (charger mode loop): sleeps while a charger is online, reboots
# on the power button (also pressed while awake between rounds), powers off when
# no supply is online, retries a failed sleep, waits for battmgr's supplies to
# appear, and leaves dark-resume.pwrkey0 for hook 56. Fake sysfs, /proc/interrupts
# and systemctl; each `start suspend.target` applies the next scripted event.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CHARGER="$ROOT/system_files/usr/libexec/armada/armada-charger"
LIB="$ROOT/system_files/usr/lib/armada/dark-resume-lib"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
fail=0
sysfs="$tmp/sys"; interrupts="$tmp/interrupts"; ledger="$tmp/ledger"; sc_log="$tmp/sc.log"

# events: none | usb=<0|1> | pwrkey | pwrkey-awake (pressed after the wake) | fail
cat >"$tmp/systemctl" <<'FAKE'
#!/bin/bash
echo "$*" >>"$SC_LOG"
bump() { local c; c=$(awk '$NF=="pmic_pwrkey"{print $2}' "$INTERRUPTS"); printf ' 21:  %d  0  pmic_pwrkey\n' $((c+1)) >"$INTERRUPTS"; }
case "$1" in
    poweroff|reboot) exit 0 ;;
    start)
        n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$COUNTER"
        (( n > 20 )) && { echo "runaway" >>"$SC_LOG"; kill -TERM "$PPID"; exit 1; }
        [[ -n "${SUPPLY_LATE:-}" && ! -e "$SYSFS/class/power_supply/usb/type" ]] && exit 9
        echo "pwrkey0=$(cat "$PK0" 2>/dev/null)" >>"$SC_LOG"
        ev=$(sed -n "${n}p" "$SCRIPT"); ev=${ev:-none}
        case "$ev" in
            usb=*) echo "${ev#usb=}" >"$SYSFS/class/power_supply/usb/online" ;;
            pwrkey) bump ;;
            pwrkey-awake) ( sleep 0.3; bump ) & ;;
            fail) exit 3 ;;
        esac ;;
esac
exit 0
FAKE
chmod +x "$tmp/systemctl"

run() { # $@ = events
    rm -rf "$sysfs"; mkdir -p "$sysfs/class/power_supply/battery"
    if [[ -z "${SUPPLY_LATE:-}" ]]; then
        mkdir -p "$sysfs/class/power_supply/usb"; echo USB >"$sysfs/class/power_supply/usb/type"
        echo "${START_ONLINE:-1}" >"$sysfs/class/power_supply/usb/online"
    else
        ( sleep 1.2; mkdir -p "$sysfs/class/power_supply/usb"; echo 1 >"$sysfs/class/power_supply/usb/online"
          echo USB >"$sysfs/class/power_supply/usb/type" ) &
    fi
    echo Battery >"$sysfs/class/power_supply/battery/type"
    printf ' 21:  0  0  pmic_pwrkey\n' >"$interrupts"
    : >"$ledger"; : >"$sc_log"; rm -f "$tmp/counter" "$tmp/flag" "$tmp/pk0"
    printf '%s\n' "$@" >"$tmp/script"
    env ARMADA_SYSFS_ROOT="$sysfs" ARMADA_PROC_INTERRUPTS="$interrupts" ARMADA_DARK_RESUME_LOG="$ledger" \
        ARMADA_SYSTEMCTL="$tmp/systemctl" ARMADA_DARK_RESUME_LIB="$LIB" ARMADA_CHARGER_MODE_FLAG="$tmp/flag" \
        ARMADA_DARK_RESUME_PWRKEY0="$tmp/pk0" ARMADA_DARK_RESUME_ONLINE_TICKS=6 ARMADA_CHARGER_RETRY_SECS=0 \
        ARMADA_CHARGER_SUPPLY_WAIT=5 SC_LOG="$sc_log" INTERRUPTS="$interrupts" SYSFS="$sysfs" \
        SCRIPT="$tmp/script" COUNTER="$tmp/counter" PK0="$tmp/pk0" SUPPLY_LATE="${SUPPLY_LATE:-}" \
        timeout 30 bash "$CHARGER" >/dev/null 2>"$tmp/stderr" || true
}
check() { if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1 -- got [$2] exp [$3]"; fail=1; fi; }
has()  { if grep -q -- "$2" "$3"; then echo "ok: $1"; else echo "FAIL: $1 -- [$2] not in: $(paste -sd'|' "$3")"; fail=1; fi; }
lacks(){ if grep -q -- "$2" "$3"; then echo "FAIL: $1 -- [$2] unexpectedly present"; fail=1; else echo "ok: $1"; fi; }
sleeps() { grep -c '^start suspend.target' "$sc_log" || true; }

# 1) charging, two quiet wakes, then the button -> reboot (normal boot).
run none none pwrkey
check "button: three sleeps" "$(sleeps)" 3
has "button: reboot" "^reboot" "$sc_log"
lacks "button: no poweroff" "^poweroff" "$sc_log"
has "button: ledger reason=user" "charger-mode reason=user" "$ledger"
check "button: two quiet rounds" "$(grep -c 'reason=other' "$ledger")" 2
check "button: charger-mode flag left for suspend-dispatch" "$([[ -e "$tmp/flag" ]] && echo yes)" yes
has "button: pwrkey0 written before each sleep (hook 56)" "pwrkey0=0" "$sc_log"

# 2) unplugged while asleep -> poweroff, never reboot.
run none usb=0
has "unplug: poweroff" "^poweroff" "$sc_log"
lacks "unplug: no reboot" "^reboot" "$sc_log"
has "unplug: ledger reason=charger then unplug" "charger-mode reason=unplug" "$ledger"

# 3) started without a charger (unplugged before the loop) -> poweroff at once.
START_ONLINE=0 run none
check "no charger at start: never sleeps" "$(sleeps)" 0
has "no charger at start: poweroff" "^poweroff" "$sc_log"

# 4) the button pressed while awake between rounds still reboots.
run pwrkey-awake none none
has "button while awake: reboot" "^reboot" "$sc_log"
lacks "button while awake: no poweroff" "^poweroff" "$sc_log"

# 5) a failed sleep is retried, not a reboot or poweroff.
run fail pwrkey
check "failed sleep: retried" "$(sleeps)" 2
has "failed sleep: ledger reason=failed" "reason=failed" "$ledger"
has "failed sleep: then the button reboots" "^reboot" "$sc_log"

# 6) battmgr registers its supplies late: wait for them, do not power off.
SUPPLY_LATE=1 run none pwrkey
lacks "late supplies: no poweroff" "^poweroff" "$sc_log"
has "late supplies: found usb" "supplies=usb" "$ledger"
has "late supplies: button reboots" "^reboot" "$sc_log"

if (( fail )); then echo "armada-charger: FAILURES"; exit 1; fi
echo "PASS: armada-charger-test"
