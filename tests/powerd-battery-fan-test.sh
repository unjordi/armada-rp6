#!/usr/bin/env bash
# Covers the battery-temperature fan floor baked into armada-powerd: the
# [battery_fan] section in the factory power-profiles.conf is parsed, the floor
# is interpolated + quantized, gets a boost while charging, stays inert below the
# coolest knot / when disabled / when the sensor is unreadable, and fan_tick
# applies it ON TOP of the CPU/GPU curve (target = max(cpu_gpu, battery)).

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# armada#29: the Reload D-Bus method (what Armada Control's battery-fan
# toggle triggers via action_write_config's "armada-power reload") must
# re-read [battery_fan], not just __init__ -- otherwise flipping the toggle
# in the UI silently does nothing until the daemon is restarted.
awk '/if method == "Reload":/,/if method == "Suspend":/' \
    "$ROOT/system_files/usr/libexec/armada/armada-powerd" \
    | grep -Fq 'self.load_battery_fan_config()' || {
    printf 'FAIL: Reload no longer re-reads [battery_fan] -- the UI toggle would need a daemon restart to take effect\n' >&2
    exit 1
}

# The factory config must ship the [battery_fan] section enabled.
grep -Fq '[battery_fan]' "$ROOT/system_files/usr/share/armada/power-profiles.conf" || {
    printf 'FAIL: factory power-profiles.conf lost the [battery_fan] section\n' >&2
    exit 1
}

python3 - "$ROOT" "$WORK" <<'PYEOF'
import importlib.machinery
import importlib.util
import os
import sys

ROOT, WORK = sys.argv[1], sys.argv[2]
LIB = os.path.join(ROOT, "system_files/usr/lib/armada")
LIBEXEC = os.path.join(ROOT, "system_files/usr/libexec/armada")
SHARE = os.path.join(ROOT, "system_files/usr/share/armada")
sys.path.insert(0, LIB)

failures = []


def check(name, condition):
    if not condition:
        failures.append(name)
        print(f"FAIL: {name}", file=sys.stderr)


def load_script(name):
    spec = importlib.util.spec_from_loader(
        name.replace("-", "_"),
        importlib.machinery.SourceFileLoader(
            name.replace("-", "_"), os.path.join(LIBEXEC, name)),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


powerd = load_script("armada-powerd")

temp_path = os.path.join(WORK, "batt-temp")
status_path = os.path.join(WORK, "batt-status")
etc_conf = os.path.join(WORK, "etc-power.conf")

powerd.FACTORY_CONFIG_FILE = powerd.Path(os.path.join(SHARE, "power-profiles.conf"))
powerd.CONFIG_FILE = powerd.Path(os.path.join(WORK, "no-such-etc.conf"))
powerd.BATTERY_TEMP_PATH = powerd.Path(temp_path)
powerd.BATTERY_STATUS_PATH = powerd.Path(status_path)


def make_power():
    p = powerd.ArmadaPower.__new__(powerd.ArmadaPower)
    # quantize_pwm() only needs these three keys.
    p.fan_config = {"min_pwm": 51, "max_pwm": 255, "pwm_quantum": 8}
    return p


def set_battery(temp_c=None, status="Discharging"):
    if temp_c is None:
        with open(temp_path, "w") as f:
            f.write("unknown")
    else:
        with open(temp_path, "w") as f:
            f.write(str(int(temp_c * 10)))  # deci-Celsius
    with open(status_path, "w") as f:
        f.write(status)


# --- factory [battery_fan] parses ------------------------------------------
power = make_power()
power.load_battery_fan_config()
check("factory battery_fan enabled", power.battery_enabled is True)
check("factory default profile is quiet: boost 16", power.battery_charging_boost == 16)
check("factory default profile is quiet: curve",
      power.battery_curve == sorted([(47, 255), (46, 200), (45, 150), (44, 110),
                                     (42, 80), (40, 51), (38, 0)]))
check("curve sorted ascending by temp",
      power.battery_curve == sorted(power.battery_curve))

# --- floor is inert below the coolest knot (38 C -> 0) ----------------------
set_battery(30, "Discharging")
check("cool battery -> no floor (discharging)", power.battery_target_pwm() == 0)
set_battery(30, "Charging")
check("cool battery -> no floor even charging", power.battery_target_pwm() == 0)
set_battery(38, "Charging")
check("38 C knot is 0 -> no floor", power.battery_target_pwm() == 0)

# --- warm battery: interpolated + quantized, discharging vs charging --------
set_battery(44, "Discharging")
check("quiet: 44 C discharging floor = 110 -> 112 quantized", power.battery_target_pwm() == 112)
set_battery(44, "Charging")
check("quiet: 44 C charging floor = 128 (110 + 16, quantized)",
      power.battery_target_pwm() == 128)
set_battery(50, "Charging")
check("hot battery clamps to max 255", power.battery_target_pwm() == 255)
set_battery(50, "Discharging")
check("hot battery clamps to max 255 discharging", power.battery_target_pwm() == 255)

# --- profile selection: aggressive uses its own curve and boost ---------------
def with_override(text):
    with open(etc_conf, "w") as f:
        f.write(text)
    powerd.CONFIG_FILE = powerd.Path(etc_conf)
    p = make_power()
    p.load_battery_fan_config()
    return p


aggr = with_override("[battery_fan]\nprofile=aggressive\n")
check("aggressive: boost 36", aggr.battery_charging_boost == 36)
check("aggressive: curve has 7 knots", len(aggr.battery_curve) == 7)
set_battery(40, "Discharging")
check("aggressive: 40 C discharging floor = 144", aggr.battery_target_pwm() == 144)
set_battery(40, "Charging")
check("aggressive: 40 C charging floor = 176", aggr.battery_target_pwm() == 176)
check("quiet at 40 C charging stays lower than aggressive",
      power.battery_target_pwm() == 64)

# a direct curve/charging_boost in [battery_fan] wins over the selected profile
direct = with_override("[battery_fan]\nprofile=aggressive\ncharging_boost=0\ncurve=40:200,50:200\n")
set_battery(45, "Charging")
check("direct curve overrides profile curve", direct.battery_target_pwm() == 200)
check("direct charging_boost overrides profile boost", direct.battery_charging_boost == 0)
# only the boost set directly: the profile curve still applies
boost_only = with_override("[battery_fan]\nprofile=aggressive\ncharging_boost=0\n")
set_battery(40, "Charging")
check("direct boost only: profile curve kept, boost 0",
      boost_only.battery_target_pwm() == 144 and boost_only.battery_charging_boost == 0)
# unknown profile falls back to the default profile instead of going inert
unknown = with_override("[battery_fan]\nprofile=nope\n")
check("unknown profile falls back to quiet", unknown.battery_charging_boost == 16)
# enabled=0 stays inert whatever the profile
off = with_override("[battery_fan]\nenabled=0\nprofile=aggressive\n")
set_battery(45, "Charging")
check("enabled=0 with profile selected is inert",
      off.battery_enabled is False and off.battery_target_pwm() == 0)
powerd.CONFIG_FILE = powerd.Path(os.path.join(WORK, "no-such-etc.conf"))

# --- unreadable sensor -> inert (never blindly spin) ------------------------
set_battery(None, "Charging")
check("unreadable battery temp -> 0", power.battery_target_pwm() == 0)

# --- disabled via /etc override -> inert (stock behaviour) ------------------
with open(etc_conf, "w") as f:
    f.write("[battery_fan]\nenabled=0\n")
powerd.CONFIG_FILE = powerd.Path(etc_conf)
power2 = make_power()
power2.load_battery_fan_config()
check("enabled=0 override disables floor", power2.battery_enabled is False)
set_battery(45, "Charging")
check("disabled floor returns 0 while warm+charging",
      power2.battery_target_pwm() == 0)
powerd.CONFIG_FILE = powerd.Path(os.path.join(WORK, "no-such-etc.conf"))

# --- missing section entirely -> inert -------------------------------------
powerd.FACTORY_CONFIG_FILE = powerd.Path(os.path.join(WORK, "bare.conf"))
with open(os.path.join(WORK, "bare.conf"), "w") as f:
    f.write("[general]\ndefault_profile=balanced\n")
power3 = make_power()
power3.load_battery_fan_config()
check("no [battery_fan] section -> inert", power3.battery_enabled is False)
set_battery(45, "Charging")
check("missing section returns 0", power3.battery_target_pwm() == 0)

# --- fan_tick applies the floor ON TOP of the CPU/GPU curve and of upstream's
# charging floor (target = max(curve, charging_pwm if on AC, battery floor)) ---
powerd.FACTORY_CONFIG_FILE = powerd.Path(os.path.join(SHARE, "power-profiles.conf"))
pwm_path = os.path.join(WORK, "pwm1")


def tick(curve_pwm, temp_c, status, on_ac, charging_pwm=0):
    p = make_power()
    p.load_battery_fan_config()
    p.fan_config.update({"smoothing": 0.0, "ramp_up": 255, "ramp_down": 255,
                         "charging_pwm": charging_pwm})
    p.fan_pwm = powerd.Path(pwm_path)
    p.fan_enable = None
    p.fan_hwmon = None
    p.connection = None
    p.suspended = False
    p.smoothed_temp = 0.0
    p.last_pwm = 51
    p.perf_tick = lambda: None
    p.read_temp = lambda: 50
    p.target_pwm = lambda t: curve_pwm
    powerd.external_power_online = lambda: on_ac
    set_battery(temp_c, status)
    p.fan_tick()
    with open(pwm_path) as f:
        return int(f.read().strip())


check("tick: warm battery lifts a quiet CPU curve (44 C -> 112)",
      tick(64, 44, "Discharging", False) == 112)
check("tick: a louder CPU curve wins over the battery floor",
      tick(200, 44, "Discharging", False) == 200)
check("tick: cool battery leaves the CPU curve alone",
      tick(64, 30, "Discharging", False) == 64)
check("tick: upstream charging floor still applies with a cool battery",
      tick(64, 30, "Charging", True, charging_pwm=96) == 96)
check("tick: battery floor + boost beats the charging floor when warm",
      tick(64, 44, "Charging", True, charging_pwm=96) == 128)

if failures:
    print(f"\n{len(failures)} battery-fan check(s) failed", file=sys.stderr)
    sys.exit(1)
print("powerd battery-fan: all checks passed")
PYEOF

echo "PASS: powerd-battery-fan-test"
