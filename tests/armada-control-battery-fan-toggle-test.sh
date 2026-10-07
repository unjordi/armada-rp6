#!/usr/bin/env bash
# armada#29: the Armada Control battery-fan-floor toggle -- reading the
# live [battery_fan] "enabled" state (same key armada-powerd itself reads),
# writing only the diff against the factory default (same "only write what
# was edited" convention as render_power/render_all), and the plugin's
# set_battery_fan_enabled() round trip via the privileged write_config call.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

python3 -B - "$ROOT" "$WORK" <<'PYEOF'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
work = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(root / "decky/armada-control/py_modules"))
from armada_control import fan_curves

factory = work / "factory.conf"
etc = work / "etc.conf"
factory.write_text(
    "[general]\n"
    "default_profile=balanced\n"
    "[profile.balanced]\n"
    "label=Balanced\n"
    "fan_curve=default\n"
    "[fan_curve.default]\n"
    "curve=40:80\n"
    "[fan]\n"
    "min_pwm=51\n"
    "ramp_up=36\n"
    "ramp_down=6\n"
    "smoothing=0.50\n"
    "[battery_fan]\n"
    "enabled=1\n"
    "profile=quiet\n"
    "[battery_fan_curve.quiet]\n"
    "label=Quiet\n"
    "charging_boost=16\n"
    "curve=47:255,40:51\n"
    "[battery_fan_curve.aggressive]\n"
    "label=Aggressive\n"
    "charging_boost=36\n"
    "curve=46:255,44:216\n"
)
fan_curves.FACTORY_POWER_CONFIG = factory
fan_curves.POWER_CONFIG = etc

# 1) factory default (enabled=1) -> True, with no /etc override yet.
state = fan_curves.get_state()
assert state["batteryFanEnabled"] is True, state["batteryFanEnabled"]

# 2) disabling writes ONLY the diff (battery_fan.enabled), nothing else.
rendered = fan_curves.render_battery_fan_enabled(False)
etc.write_text(rendered)
state = fan_curves.get_state()
assert state["batteryFanEnabled"] is False, state["batteryFanEnabled"]
assert "[fan_curve.default]" not in rendered, "wrote sections outside battery_fan"
assert "[profile.balanced]" not in rendered, "wrote sections outside battery_fan"

# 3) re-enabling (back to the factory value) CLEARS the override instead of
#    writing a redundant enabled=1 -- same "only write what's edited"
#    convention render_power/render_all already use.
rendered = fan_curves.render_battery_fan_enabled(True)
assert "battery_fan" not in rendered, f"expected the override cleared, got: {rendered!r}"
etc.write_text(rendered)
state = fan_curves.get_state()
assert state["batteryFanEnabled"] is True, state["batteryFanEnabled"]

etc.write_text("")

# 4) set_battery_fan_enabled(): validates, writes via the privileged
# "write_config" action (same one save_power_config/save_all use), and
# returns the refreshed state. The mock persists to disk like the real
# privileged helper's atomic_write() would, so get_state() re-reads it.
calls = []


def fake_call(action, **payload):
    calls.append((action, payload))
    if action == "write_config" and payload.get("name") == "power":
        etc.write_text(payload["text"])
    return {}


fan_curves.call = fake_call
next_state = fan_curves.set_battery_fan_enabled(False)
assert calls, "set_battery_fan_enabled did not call the privileged helper"
action, payload = calls.pop()
assert action == "write_config" and payload.get("name") == "power", (action, payload)
assert next_state["batteryFanEnabled"] is False, next_state["batteryFanEnabled"]

for bad in (1, "true", None):
    try:
        fan_curves.set_battery_fan_enabled(bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"non-bool enabled was accepted: {bad!r}")

# 5) battery floor profiles: state exposes the selected profile and the
# available ones with their curve/boost.
etc.write_text("")
state = fan_curves.get_state()
assert state["batteryFanProfile"] == "quiet", state["batteryFanProfile"]
assert set(state["batteryFanProfiles"]) == {"quiet", "aggressive"}, state["batteryFanProfiles"]
assert state["batteryFanProfiles"]["aggressive"] == {
    "label": "Aggressive", "curve": "46:255,44:216", "charging_boost": 36}, state["batteryFanProfiles"]

# 6) selecting a non-default profile writes ONLY [battery_fan] profile;
# selecting the factory default clears the override.
rendered = fan_curves.render_battery_fan_profile("aggressive")
assert "profile = aggressive" in rendered, rendered
assert "[profile.balanced]" not in rendered and "[fan_curve.default]" not in rendered, rendered
assert fan_curves.render_battery_fan_profile("quiet") == "", "factory default left an override"

# 7) a direct curve/charging_boost shadows the profile, so selecting a profile drops them;
# unrelated keys survive.
etc.write_text("[battery_fan]\nenabled = 0\ncurve = 40:100\ncharging_boost = 5\n")
rendered = fan_curves.render_battery_fan_profile("aggressive")
assert "curve" not in rendered and "charging_boost" not in rendered, rendered
assert "enabled = 0" in rendered and "profile = aggressive" in rendered, rendered
etc.write_text("")

# 8) set_battery_fan_profile(): writes via the privileged helper, returns
# refreshed state, and rejects unknown / non-string profiles without writing.
calls.clear()
next_state = fan_curves.set_battery_fan_profile("aggressive")
action, payload = calls.pop()
assert action == "write_config" and payload.get("name") == "power", (action, payload)
assert next_state["batteryFanProfile"] == "aggressive", next_state["batteryFanProfile"]
etc.write_text("")
for bad in ("nope", "", None, 1, "fan_curve.default"):
    try:
        fan_curves.set_battery_fan_profile(bad)
    except ValueError:
        pass
    else:
        raise AssertionError(f"unknown profile was accepted: {bad!r}")
assert not calls, f"rejected profile still wrote: {calls}"

print("Armada Control battery-fan-toggle tests passed")
PYEOF
