#!/bin/bash
# haptics-stop-device-test.sh — corre EN el aparato, como root. Sube un rumble de 5 s al dispositivo
# qcom-hv-haptics, lo detiene a los 0.4 s y mide con un kprobe cuándo corre haptics_stop_constant_effect_play.
# Pasa si el stop llega antes de HAPTICS_STOP_MAX_S (1.0); sin el dispositivo o sin tracefs sale 77 (SKIP).
set -uo pipefail
max=${HAPTICS_STOP_MAX_S:-1.0}
tr=/sys/kernel/tracing
dev=$(for e in /sys/class/input/event*; do [ "$(cat "$e/device/name" 2>/dev/null)" = qcom-hv-haptics ] && echo "/dev/input/${e##*/}"; done | head -1)
[ -n "$dev" ] || { echo "SKIP: no hay dispositivo qcom-hv-haptics"; exit 77; }
[ -w "$tr/kprobe_events" ] || { echo "SKIP: sin tracefs con permiso de escritura (¿root?)"; exit 77; }
grep -q ' haptics_stop_constant_effect_play' /proc/kallsyms || { echo "SKIP: el kernel no expone haptics_stop_constant_effect_play"; exit 77; }

reloj=$(sed -E 's/.*\[([a-z_]+)\].*/\1/' "$tr/trace_clock")
limpiar() {
  if [ -d "$tr/events/hstop" ]; then echo 0 > "$tr/events/hstop/enable"; echo '-:hstop/stop' >> "$tr/kprobe_events"; fi
  echo "$reloj" > "$tr/trace_clock"
}
trap limpiar EXIT
limpiar
echo boot > "$tr/trace_clock"
echo 'p:hstop/stop haptics_stop_constant_effect_play' >> "$tr/kprobe_events"
[ -d "$tr/events/hstop" ] || { echo "FAIL: no se pudo armar el kprobe"; exit 1; }
echo > "$tr/trace"; echo 1 > "$tr/events/hstop/enable"

t_stop=$(python3 - "$dev" <<'PY'
import os, struct, fcntl, sys, time
fd = os.open(sys.argv[1], os.O_RDWR)
eff = bytearray(48)
struct.pack_into("<HhH", eff, 0, 0x50, -1, 0)          # FF_RUMBLE
struct.pack_into("<HH", eff, 10, 5000, 0)               # replay.length 5 s
struct.pack_into("<HH", eff, 16, 0x8000, 0x8000)
fcntl.ioctl(fd, 0x40304580, eff)                        # EVIOCSFF
eid = struct.unpack_from("<h", eff, 2)[0]
ev = lambda v: os.write(fd, struct.pack("<qqHHi", 0, 0, 0x15, eid, v))
ev(1); time.sleep(0.4); ev(0)
print(f"{time.clock_gettime(time.CLOCK_BOOTTIME):.6f}", flush=True)
time.sleep(5.5); os.close(fd)
PY
)
t_drv=$(grep -m1 -E ' [0-9]+\.[0-9]+: stop: ' "$tr/trace" | sed -E 's/.* ([0-9]+\.[0-9]+): stop: .*/\1/')
[ -n "$t_drv" ] || { echo "FAIL: el driver no corrió el stop en 5.5 s"; exit 1; }
d=$(python3 -c "print(round($t_drv - $t_stop, 3))")
if python3 -c "import sys; sys.exit(0 if -0.05 <= $d <= $max else 1)"; then
  echo "PASS: el driver detuvo el efecto ${d}s después del EV_FF 0"
else
  echo "FAIL: el driver detuvo el efecto ${d}s después del EV_FF 0 (máximo ${max}s)"; exit 1
fi
