#!/usr/bin/env bash
# HW-dependent UI values live in the device .conf, not in the plugin or daemon:
# device-env must publish them, the armada-control service must pass them to
# the plugin, and the plugin config must hand them to the frontend. A device
# without the keys gets empty values, so the frontend/daemon defaults apply.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for model in "Retroid Pocket 6" "AYN Odin 2"; do
    tag=${model// /-}
    cat >"$WORK/device-env-$tag" <<SH
#!/usr/bin/env bash
printf '%s\n' '[s2idle] deep' >"$WORK/mem_sleep-$tag"
ARMADA_DEVICE_DIR="$ROOT/system_files/usr/lib/armada/devices" ARMADA_MODEL="$model" \
ARMADA_MEM_SLEEP_PATH="$WORK/mem_sleep-$tag" ARMADA_SLEEP_CONFIG="$WORK/none" \
    exec bash "$ROOT/system_files/usr/libexec/armada/device-env"
SH
    chmod +x "$WORK/device-env-$tag"
done

python3 - "$ROOT" "$WORK" <<'PYEOF'
import importlib.machinery
import importlib.util
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
work = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(root / "system_files/usr/lib/armada"))

control_path = root / "system_files/usr/libexec/armada/armada-control"
loader = importlib.machinery.SourceFileLoader("armada_control_service", str(control_path))
spec = importlib.util.spec_from_loader("armada_control_service", loader)
control = importlib.util.module_from_spec(spec)
loader.exec_module(control)

sys.path.insert(0, str(root / "decky/armada-control/py_modules"))
from armada_control import config as plugin_config
from armada_control import system as plugin_system

# The plugin asks the privileged service for the device env.
plugin_system.call = lambda action, **payload: (
    control.action_get_device_env(payload) if action == "get_device_env" else {}
)

# Everything else build_config reads is unrelated to this test.
for name, value in {
    "load_fex_contract": {}, "parse_power": {"profiles": {}, "general": {"default_profile": "balanced"}, "fan": {}},
    "active_profile": None, "factory_power_defaults": {}, "load_tweaks": {}, "installed_games": [],
    "fex_profile_labels": {}, "load_env_presets": [], "perf_info": {}, "rgb_supported": False, "os_version": "",
    "abl_version": "", "abl_auto_enabled": False, "bottom_screen_brightness": None,
    "bottom_screen_active": False, "bottom_screen_enabled": False, "ssh_enabled": False,
    "mtp_enabled": False, "desktop_mode": "", "desktop_modes": [], "sleep_modes": [],
    "controller_type": "", "inputplumber_targets": [],
}.items():
    if hasattr(plugin_config, name):
        setattr(plugin_config, name, lambda *args, _value=value, **kwargs: _value)

failures = []

def check(desc, got, want):
    status = "ok  " if got == want else "FAIL"
    print(f"{status} - {desc}: got {got!r}" + ("" if got == want else f", want {want!r}"))
    if got != want:
        failures.append(desc)

control.DEVICE_ENV = str(work / "device-env-Retroid-Pocket-6")
env = control.device_env()
check("RP6 publishes the LED-vs-screen factor", env.get("ARMADA_RGB_SYNC_SCALE"), "0.88")
check("RP6 top-bar glyph reaches the frontend",
      plugin_config.build_config(include_games=False).get("topBarIndicator"),
      {"sizePx": "16", "marginPx": "6"})

control.DEVICE_ENV = str(work / "device-env-AYN-Odin-2")
env = control.device_env()
check("a device without the key publishes no LED factor", env.get("ARMADA_RGB_SYNC_SCALE"), "")
check("a device without the keys leaves the glyph to the plugin defaults",
      plugin_config.build_config(include_games=False).get("topBarIndicator"),
      {"sizePx": "", "marginPx": ""})

if failures:
    sys.exit(1)
PYEOF
