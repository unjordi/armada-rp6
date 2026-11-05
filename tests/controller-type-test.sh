#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/system_files/usr/libexec/armada/controller-type"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

BIN="$WORK/bin"
mkdir -p "$BIN"

# busctl stub: one composite device; TargetDevices comes from $TARGETS; SetTargetDevices calls go to $CALLS.
cat > "$BIN/busctl" <<'STUB'
#!/usr/bin/env bash
args="$*"
case "$args" in
  *" tree "*) echo "└─ /org/shadowblip/InputPlumber/CompositeDevice0" ;;
  *"get-property"*"TargetDevices"*) printf 'ao %s' "$(wc -w <<<"$TARGETS")"; for t in $TARGETS; do printf ' "/org/shadowblip/InputPlumber/devices/target/%s"' "$t"; done; echo ;;
  *"SetTargetDevices"*) echo "${args#*SetTargetDevices as }" >> "$CALLS" ;;
esac
STUB
chmod +x "$BIN/busctl"

run_apply() {  # run_apply <device-env output> <current targets>; prints the SetTargetDevices argument list
  printf '#!/bin/sh\ncat <<"ENV"\n%s\nENV\n' "$1" > "$WORK/device-env"
  chmod +x "$WORK/device-env"
  : > "$WORK/calls"
  PATH="$BIN:$PATH" TARGETS="$2" CALLS="$WORK/calls" ARMADA_DEVICE_ENV="$WORK/device-env" \
    ARMADA_CONTROLLER_CONF="$WORK/controller.conf" python3 "$SCRIPT" apply >/dev/null || fail "apply exited non-zero"
  cat "$WORK/calls"
}

# A device that declares a keyboard target keeps it even when InputPlumber has not created it yet (boot race).
got="$(run_apply $'ARMADA_IP_TARGETS=deck-uhid,xb360\nARMADA_IP_EXTRA_TARGETS=keyboard' 'dbus0 gamepad0')"
[[ "$got" == "2 deck-uhid keyboard" ]] || fail "declared keyboard dropped during boot race: got '$got'"

# A keyboard InputPlumber already created is still kept without the declaration.
got="$(run_apply 'ARMADA_IP_TARGETS=deck-uhid' 'dbus0 gamepad0 keyboard0')"
[[ "$got" == "2 deck-uhid keyboard" ]] || fail "existing keyboard dropped: got '$got'"

# Declared and existing keyboard are not duplicated.
got="$(run_apply $'ARMADA_IP_TARGETS=deck-uhid\nARMADA_IP_EXTRA_TARGETS=keyboard' 'dbus0 gamepad0 keyboard0')"
[[ "$got" == "2 deck-uhid keyboard" ]] || fail "keyboard duplicated: got '$got'"

# Without declaration and without an existing keyboard only the controller is set.
got="$(run_apply 'ARMADA_IP_TARGETS=deck-uhid' 'dbus0 gamepad0')"
[[ "$got" == "1 deck-uhid" ]] || fail "unexpected extra target: got '$got'"

# Unknown extra target names are ignored.
got="$(run_apply $'ARMADA_IP_TARGETS=deck-uhid\nARMADA_IP_EXTRA_TARGETS=keyboard,bogus' 'dbus0 gamepad0')"
[[ "$got" == "2 deck-uhid keyboard" ]] || fail "unknown extra target not ignored: got '$got'"

# The shipped device profiles declare the keyboard where the InputPlumber profile needs it.
device_env() { ARMADA_DEVICE_DIR="$ROOT/system_files/usr/lib/armada/devices" ARMADA_MODEL="$1" \
  bash "$ROOT/system_files/usr/libexec/armada/device-env" | sed -n s/^ARMADA_IP_EXTRA_TARGETS=//p; }
for model in "Retroid Pocket 6" "Retroid Pocket Nova"; do
  [[ "$(device_env "$model")" == keyboard ]] || fail "$model does not declare the keyboard target"
done
[[ "$(device_env "Retroid Pocket 5")" == "''" ]] || fail "Retroid Pocket 5 declares an unexpected extra target"

echo "PASS: controller-type keeps declared and existing extra targets"
