#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

python3 -B - "$ROOT" "$WORK" <<'PYEOF'
import importlib.machinery
import importlib.util
from pathlib import Path
import sys

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "system_files/usr/lib/armada"))

control_path = root / "system_files/usr/libexec/armada/armada-control"
loader = importlib.machinery.SourceFileLoader("armada_control_service", str(control_path))
spec = importlib.util.spec_from_loader("armada_control_service", loader)
control = importlib.util.module_from_spec(spec)
loader.exec_module(control)

commands = []
rgb_environments = []
supported = False


def check_output(command, **kwargs):
    commands.append(command)
    if command and command[0] == control.RGB_TOOL:
        rgb_environments.append(kwargs.get("env", {}))
    if command[-1] == "get":
        return '{"version":1,"enabled":false,"linkBrightness":false,"brightness":25,"maxBrightness":25,"color":"FFFFFF","saturation":100}'
    return '{"version":1,"enabled":true,"linkBrightness":true,"brightness":40,"maxBrightness":60,"color":"A1B2C3","saturation":50}'


def run(command, **kwargs):
    assert command == [control.RGB_TOOL, "supported"]
    return control.subprocess.CompletedProcess(command, 0 if supported else 1)


control.subprocess.check_output = check_output
control.subprocess.run = run
# Unsupported devices return no RGB state and do not invoke the RGB tool.
assert control.action_get_rgb({}) is None
assert commands == []

supported = True
# Supported devices return the saved RGB configuration through the get command.
state = control.action_get_rgb({})
assert state["color"] == "FFFFFF"
assert commands.pop() == [control.RGB_TOOL, "get"]

control.device_env = lambda: {"ARMADA_PRIMARY_BACKLIGHT": "panel0"}
# A complete payload forwards enabled, smart brightness, saturation, and brightness settings.
state = control.action_set_rgb({
    "enabled": True,
    "linkBrightness": True,
    "color": "a1b2c3",
    "saturation": 50,
    "maxBrightness": 60,
    "brightness": 40,
})
assert state["color"] == "A1B2C3"
assert rgb_environments[-1]["ARMADA_PRIMARY_BACKLIGHT"] == "panel0"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--link-brightness",
    "true",
    "--max-brightness",
    "60",
    "--color",
    "a1b2c3",
    "--saturation",
    "50",
    "--brightness",
    "40",
]

# Smart-brightness fields are independently optional so omitted values remain
# preserved by armada-rgb's saved configuration.
# Supplying only linkBrightness forwards that flag without inventing maxBrightness.
state = control.action_set_rgb({
    "enabled": True,
    "linkBrightness": True,
    "color": "a1b2c3",
    "brightness": 40,
})
assert state["color"] == "A1B2C3"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--link-brightness",
    "true",
    "--color",
    "a1b2c3",
    "--brightness",
    "40",
]

# Supplying only maxBrightness forwards that ceiling while preserving other saved settings.
state = control.action_set_rgb({
    "enabled": True,
    "color": "a1b2c3",
    "saturation": 75,
    "maxBrightness": 35,
    "brightness": 40,
})
assert state["color"] == "A1B2C3"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--max-brightness",
    "35",
    "--color",
    "a1b2c3",
    "--saturation",
    "75",
    "--brightness",
    "40",
]

# Legacy callers that omit smart brightness and saturation preserve the saved values.
# The legacy payload forwards only the fields it actually supplied.
state = control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40})
assert state["color"] == "A1B2C3"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--color",
    "a1b2c3",
    "--brightness",
    "40",
]

# Disabling RGB with a full settings payload still persists the disabled state.
# A complete disabled payload uses set so the configuration fields are retained.
state = control.action_set_rgb({
    "enabled": False,
    "linkBrightness": True,
    "color": "a1b2c3",
    "saturation": 50,
    "maxBrightness": 60,
    "brightness": 40,
})
assert state["color"] == "A1B2C3"
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "false",
    "--link-brightness",
    "true",
    "--max-brightness",
    "60",
    "--color",
    "a1b2c3",
    "--saturation",
    "50",
    "--brightness",
    "40",
]

# The legacy enabled=false payload still maps to the off command.
control.action_set_rgb({"enabled": False})
assert commands.pop() == [control.RGB_TOOL, "off"]

control.action_set_rgb(
    {
        "enabled": True,
        "color": "a1b2c3",
        "brightness": 40,
        "effect": "rainbow",
        "speed": 250,
    }
)
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--color",
    "a1b2c3",
    "--brightness",
    "40",
    "--effect",
    "rainbow",
    "--speed",
    "250",
]

control.action_set_rgb(
    {"enabled": True, "color": "a1b2c3", "saturation": 60, "brightness": 40, "effect": "breathing"}
)
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--color",
    "a1b2c3",
    "--saturation",
    "60",
    "--brightness",
    "40",
    "--effect",
    "breathing",
]

# Invalid smart-brightness, color, saturation, and brightness values are rejected.
invalid_requests = (
    {"enabled": True, "linkBrightness": "true", "color": "FFFFFF", "brightness": 40},
    {"enabled": True, "linkBrightness": 1, "color": "FFFFFF", "brightness": 40},
    {"enabled": True, "color": "FFFFFF", "maxBrightness": -1, "brightness": 40},
    {"enabled": True, "color": "FFFFFF", "maxBrightness": 101, "brightness": 40},
    {"enabled": True, "color": "FFFFFF", "maxBrightness": True, "brightness": 40},
    {"enabled": True, "color": "12345", "brightness": 40},
    {"enabled": True, "color": "FFFFFF", "brightness": 101},
    {"enabled": True, "color": "FFFFFF", "brightness": 40, "effect": "sparkle"},
    {"enabled": True, "color": "FFFFFF", "brightness": 40, "speed": 0},
    {"enabled": True, "color": "FFFFFF", "brightness": 40, "speed": 1001},
    {"enabled": True, "color": "FFFFFF", "saturation": 101, "brightness": 40},
)
for request in invalid_requests:
    try:
        control.action_set_rgb(request)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid RGB state was accepted")

sys.path.insert(0, str(root / "decky/armada-control/py_modules"))
from armada_control import rgb

# The Python RGB wrapper reports unsupported devices when its privileged call fails.
rgb.call = lambda action, **payload: None
assert not rgb.rgb_supported()

calls = []
# The Python RGB wrapper forwards the complete settings payload unchanged.
rgb.call = lambda action, **payload: calls.append((action, payload)) or {}
assert rgb.rgb_supported()
assert calls.pop() == ("get_rgb", {})
assert rgb.get_rgb() == {}
assert calls.pop() == ("get_rgb", {})
rgb.set_rgb(True, False, "112233", 75, 100, 50)
assert calls.pop() == (
    "set_rgb",
    {
        "enabled": True,
        "linkBrightness": False,
        "color": "112233",
        "saturation": 75,
        "maxBrightness": 100,
        "brightness": 50,
        "effect": None,
        "speed": None,
        "syncScale": None,
    },
)
rgb.set_rgb(True, True, "112233", 75, 40, 50, "breathing", 200)
assert calls.pop() == (
    "set_rgb",
    {
        "enabled": True,
        "linkBrightness": True,
        "color": "112233",
        "saturation": 75,
        "maxBrightness": 40,
        "brightness": 50,
        "effect": "breathing",
        "speed": 200,
        "syncScale": None,
    },
)
rgb.set_rgb(True, False, "112233", 75, 100, 50, "static", 100, 60)
assert calls.pop()[1]["syncScale"] == 60

# The slider's starting point is the device factor in percent; junk means 100.
assert rgb.sync_scale_percent("0.88") == 88
assert rgb.sync_scale_percent("1.5") == 150
for junk in ("", "0", "-1", "2.5", "abc", None):
    assert rgb.sync_scale_percent(junk) == 100, junk

rgb.get_rgb_charge_indicator_enabled()
assert calls.pop() == ("get_rgb_charge_indicator_enabled", {})
rgb.set_rgb_charge_indicator_enabled(True)
assert calls.pop() == ("set_rgb_charge_indicator_enabled", {"enabled": True})
rgb.set_rgb_charge_indicator_brightness(40)
assert calls.pop() == ("set_rgb_charge_indicator_brightness", {"brightness": 40})

# screen_sync is a plain --effect value with no flags of its own. Brightness
# sync is explicitly not an effect -- see below.
assert "screen_sync" in control.RGB_EFFECTS
assert set(control.RGB_EFFECTS) == {
    "static", "breathing", "color_cycle", "rainbow", "load", "battery", "screen_sync",
}
assert "backlight_sync" not in control.RGB_EFFECTS

control.action_set_rgb(
    {"enabled": True, "color": "a1b2c3", "brightness": 40, "effect": "screen_sync"}
)
assert commands.pop() == [
    control.RGB_TOOL,
    "set",
    "--enabled",
    "true",
    "--color",
    "a1b2c3",
    "--brightness",
    "40",
    "--effect",
    "screen_sync",
]

# The LED-vs-screen factor rides on `set` as --sync-scale (percent or "default").
control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40, "syncScale": 60})
assert commands.pop()[-2:] == ["--sync-scale", "60"]
control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40, "syncScale": "default"})
assert commands.pop()[-2:] == ["--sync-scale", "default"]
for bad in (0, 9, 201, True, "60", 1.5):
    try:
        control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40, "syncScale": bad})
    except ValueError:
        pass
    else:
        raise AssertionError(f"syncScale {bad!r} was accepted")

# Linked brightness travels in set_rgb's request, like the rest of the settings.
assert "set_rgb_sync_brightness" not in control.ACTIONS

# The charge indicator itself is an armada-rgb command only the suspend hook
# calls (rgb-suspend-charging-hook-test.sh); the UI owns just the opt-in gate
# the hook reads.
assert "charge_indicator" not in control.ACTIONS
assert "set_charge_indicator" not in control.ACTIONS

indicator_config = Path(sys.argv[2]) / "rgb-charge-indicator.conf"
control.RGB_CHARGE_INDICATOR_CONFIG = indicator_config
assert control.action_get_rgb_charge_indicator_enabled({}) == {"enabled": False, "brightness": 100}, \
    "opt-in must default OFF (full brightness) when the config file doesn't exist yet"

assert control.action_set_rgb_charge_indicator_enabled({"enabled": True}) == {"enabled": True, "brightness": 100}
assert indicator_config.read_text() == "enabled=1\nbrightness=100\n"

# Brightness and the opt-in are independent keys: changing one keeps the other.
assert control.action_set_rgb_charge_indicator_brightness({"brightness": 30}) == {"enabled": True, "brightness": 30}
assert control.action_set_rgb_charge_indicator_enabled({"enabled": False}) == {"enabled": False, "brightness": 30}
assert indicator_config.read_text() == "enabled=0\nbrightness=30\n"
# A file written before the brightness key existed still reads, at 100.
indicator_config.write_text("enabled=1\n")
assert control.action_get_rgb_charge_indicator_enabled({}) == {"enabled": True, "brightness": 100}
for bad in (0, 101, True, "30", None):
    try:
        control.action_set_rgb_charge_indicator_brightness({"brightness": bad})
    except ValueError:
        pass
    else:
        raise AssertionError(f"charge indicator brightness {bad!r} was accepted")

try:
    control.action_set_rgb_charge_indicator_enabled({"enabled": "yes"})
except ValueError:
    pass
else:
    raise AssertionError("non-bool charge indicator enabled state was accepted")

for action in (
    "get_rgb_charge_indicator_enabled",
    "set_rgb_charge_indicator_enabled",
    "set_rgb_charge_indicator_brightness",
):
    assert action in control.ACTIONS, f"{action} not registered in ACTIONS"

# run_rgb error handling: a Python exception must never reach the UI as
# opaque text. Every failure mode gets a clean, actionable RuntimeError.


def missing_tool(command, **kwargs):
    raise FileNotFoundError(command[0])


control.subprocess.check_output = missing_tool
try:
    control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40})
except RuntimeError as exc:
    assert "not installed" in str(exc)
else:
    raise AssertionError("missing armada-rgb binary was not reported")


def timed_out(command, **kwargs):
    raise control.subprocess.TimeoutExpired(command, 5)


control.subprocess.check_output = timed_out
try:
    control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40})
except RuntimeError as exc:
    assert "timed out" in str(exc)
else:
    raise AssertionError("armada-rgb timeout was not reported")


def rejected(command, **kwargs):
    raise control.subprocess.CalledProcessError(
        2, command, stderr="error: unrecognized subcommand 'run'\n"
    )


control.subprocess.check_output = rejected
try:
    control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40})
except RuntimeError as exc:
    assert "unrecognized subcommand" in str(exc)
else:
    raise AssertionError("armada-rgb rejection was not reported")


def bad_json(command, **kwargs):
    return "not json"


control.subprocess.check_output = bad_json
try:
    control.action_set_rgb({"enabled": True, "color": "a1b2c3", "brightness": 40})
except RuntimeError as exc:
    assert "unexpected response" in str(exc)
else:
    raise AssertionError("malformed armada-rgb output was not reported")

control.subprocess.check_output = check_output

# Switching the live power profile via armada-power, independent of
# [general] default_profile.
power_commands = []


def power_run(command, **kwargs):
    power_commands.append(command)


control.run = power_run
assert control.action_set_power_profile({"profile": "performance"}) == {
    "profile": "performance"
}
assert power_commands.pop() == [control.ARMADA_POWER_TOOL, "profile", "performance"]

try:
    control.action_set_power_profile({"profile": "turbo"})
except ValueError:
    pass
else:
    raise AssertionError("invalid power profile was accepted")


def power_missing(command, **kwargs):
    raise FileNotFoundError(command[0])


control.run = power_missing
try:
    control.action_set_power_profile({"profile": "eco"})
except RuntimeError as exc:
    assert "not installed" in str(exc)
else:
    raise AssertionError("missing armada-power binary was not reported")

assert "set_power_profile" in control.ACTIONS

# privileged.py: a socket-level failure (armada-control.service itself down)
# must not leak a raw errno/OSError string to the UI either.
sys.path.insert(0, str(root / "decky/armada-control/py_modules"))
import importlib

privileged = importlib.import_module("armada_control.privileged")


class FakeSocket:
    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        raise FileNotFoundError("no such socket")

    def __exit__(self, *a):
        return False


privileged.socket.socket = FakeSocket
try:
    privileged.call("get_rgb")
except RuntimeError as exc:
    assert "Couldn't reach" in str(exc)
else:
    raise AssertionError("missing armada-control socket was not reported")
# RGB hardware descriptions live in armada-rgb's profiles, not in the device
# confs. ARMADA_RGB_SYNC_SCALE is the one exception: armada-rgb reads it from
# device-env to match the stick LEDs to the panel when following brightness.
paths = list((root / "system_files/usr/lib/armada/devices").rglob("*"))
paths.append(root / "system_files/usr/libexec/armada/device-env")
for path in paths:
    if path.is_file():
        text = path.read_text().replace("ARMADA_RGB_SYNC_SCALE", "")
        assert "ARMADA_RGB_" not in text, path
PYEOF

SERVICE="$ROOT/system_files/usr/lib/systemd/system/armada-rgb.service"
! grep -Fq 'ConditionPathExists=/etc/armada/rgb.json' "$SERVICE"
grep -Fq 'ExecStart=/usr/libexec/armada/armada-rgb-env run' "$SERVICE"
grep -Fq 'ExecCondition=/usr/bin/armada-rgb supported' "$SERVICE"
grep -Fq 'systemctl enable armada-rgb.service' "$ROOT/build_files/40-vendor-system-files.sh"

grep -Fq 'ConditionPathExists=/etc/armada/rgb.json' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
grep -Fq 'Wants=armada-rgb.service' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
! grep -Fq 'Requires=armada-rgb.service' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
grep -Fq 'ExecStart=/usr/libexec/armada/armada-rgb-env watch' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.service"
grep -Fq 'systemctl enable armada-rgb-brightness-watch.service' "$ROOT/build_files/40-vendor-system-files.sh"
! grep -Fq 'PathExists=/etc/armada/rgb.json' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.path"
grep -Fq 'PathChanged=/etc/armada/rgb.json' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.path"
grep -Fq 'Unit=armada-rgb-brightness-watch.service' "$ROOT/system_files/usr/lib/systemd/system/armada-rgb-brightness-watch.path"
grep -Fq 'systemctl enable armada-rgb-brightness-watch.path' "$ROOT/build_files/40-vendor-system-files.sh"
printf 'Armada Control RGB tests passed\n'
