#!/usr/bin/env bash
# Asserts the INTENT of 41-armada-wake-probe: across a sleep it names the interrupt sources whose
# count ROSE, smallest delta first (in deep the wake source climbs by ~1), keyed by LABEL — never
# summing the hwirq column (regression: +100663343 "temp-alarm" garbage, 2026-09-27) — and it
# never fails the sleep transition.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/system_files/usr/lib/systemd/system-sleep/41-armada-wake-probe"
[[ -x "$HOOK" ]]
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
int="$tmp/interrupts"; mkdir -p "$tmp/sys/power" "$tmp/probe" "$tmp/run"
wl() { printf '%s\n' \
 '            CPU0       CPU1       CPU2       CPU3' \
 " 11:     $1     $1     $1     $1  GICv3  27 Level     arch_timer" \
 " 21:          0          0          0          $2  pmic_arb  1303088 Edge      pmic_pwrkey" \
 "200:          0          0          0          $3  pmic_arb  6431283 Edge      pm8xxx_rtc_alarm" \
 "231:         50          0          0          1  ipcc  393216 Edge      glink-smem" \
 "232:      $4          0          0          0  ipcc  196608 Edge      glink-smem" >"$int"; }
printf 'mem\n' >"$tmp/sys/power/mem_sleep"; printf 'success: 1\n' >"$tmp/sys/power/suspend_stats" 2>/dev/null || true
export ARMADA_SYSFS_ROOT="$tmp/sys" ARMADA_PROC_INTERRUPTS="$int" ARMADA_WAKE_PROBE_DIR="$tmp/probe" \
       ARMADA_WAKE_PROBE_RUN="$tmp/run" ARMADA_WAKEUP_SOURCES="$tmp/none"
wl 1000 0 0 500;  "$HOOK" pre suspend  || { echo "FAIL: pre devolvió error"; exit 1; }
wl 9000 0 1 540;  "$HOOK" post suspend || { echo "FAIL: post devolvió error"; exit 1; }
log="$(ls -t "$tmp/probe"/*.log | head -1)"; [[ -s "$log" ]] || { echo "FAIL: no escribió log"; exit 1; }
delta="$(sed -n '/--- interrupt delta/,/^$/p' "$log")"
first="$(grep -m1 '^  +' <<<"$delta")"
[[ "$first" == *"+1 "*"pm8xxx_rtc_alarm"* ]] || { echo "FAIL: el candidato de wake (rtc +1) no va primero: $first"; exit 1; }
grep -q 'glink-smem' <<<"$delta" || { echo "FAIL: no reportó glink-smem (+40)"; exit 1; }
grep -qE '\+(1303088|6431283|100663343|[0-9]{7,})' <<<"$delta" && { echo "FAIL: delta basura (hwirq sumado)"; exit 1; }
grep -q 'pmic_pwrkey' <<<"$delta" && { echo "FAIL: reportó pwrkey sin cambio"; exit 1; }
# CDSP (393216) y ADSP (196608) glink-smem NO se mezclan: solo el ADSP subió (+40)
[[ "$(grep -c 'glink-smem' <<<"$delta")" == 1 ]] || { echo "FAIL: mezcló los dos glink-smem"; exit 1; }
echo "OK wake-probe: candidato +1 primero, sin basura de hwirq, glink ADSP/CDSP separados, nunca falla el sleep"
