import configparser
import shutil
import tempfile
import time
from pathlib import Path

from .privileged import call

POWER_CONFIG = Path("/etc/armada/power-profiles.conf")
FACTORY_POWER_CONFIG = Path("/usr/share/armada/power-profiles.conf")
PROFILES = ("eco", "balanced", "performance")
# Profile armada-powerd is actually running right now -- may differ from the
# [general] default_profile until a reload/reboot catches up. fan_curves.py
# reads it through active_profile() below, so both tabs agree.
STATE_FILE = Path("/var/lib/armada/powerd.state")


def default_label(name):
    return name.replace("_", " ").title()


def active_profile(profiles=None):
    """The live profile armada-powerd is running, or None if it can't be read
    (daemon not up yet, state file missing/corrupt). Callers decide the
    fallback -- config.py falls back to [general] default_profile."""
    names = profiles if profiles is not None else PROFILES
    try:
        for line in STATE_FILE.read_text(encoding="utf-8").splitlines():
            if not line.startswith("profile="):
                continue
            value = line.split("=", 1)[1].strip()
            if value in names:
                return value
    except OSError:
        pass
    return None


def set_active_profile(name):
    """Switch the LIVE profile now (org.armada.Power1 Profile, via
    armada-power), independent of [general] default_profile. This is what
    lets Armada Control's Power tab and Steam's native "Rendimiento" panel
    activate the same thing instead of drifting."""
    if name not in PROFILES:
        raise ValueError("invalid power profile")
    call("set_power_profile", profile=name)
    return name


def read_active_profile():
    """Cheap, pollable "what's active" read for the Power tab's live status
    line (src/hooks/useActivePowerProfile.ts) -- same fallback chain
    config.py's build_config() uses, kept separate so polling it every few
    seconds doesn't rebuild the whole plugin config each time."""
    power = parse_power()
    return active_profile(power["profiles"].keys()) or power["general"]["default_profile"]


def restore_factory_power_config(reason):
    # Remove invalid /etc overrides so factory-only sections keep tracking /usr.
    if not POWER_CONFIG.exists():
        raise reason
    backup = POWER_CONFIG.with_name(f"{POWER_CONFIG.name}.invalid-{time.strftime('%Y%m%d-%H%M%S')}")
    try:
        shutil.copy2(POWER_CONFIG, backup)
        POWER_CONFIG.unlink()
    except OSError:
        raise reason


def parse_power(path=None, repair=True):
    parser = configparser.ConfigParser()
    paths = [path] if path is not None else [FACTORY_POWER_CONFIG, POWER_CONFIG]
    try:
        if not parser.read([candidate for candidate in paths if candidate.exists()]):
            raise FileNotFoundError(path or FACTORY_POWER_CONFIG)
        return parsed_power(parser)
    except (configparser.Error, FileNotFoundError, ValueError) as exc:
        # Avoid factory-restore on IO errors or code bugs in the read path.
        if path is None and repair:
            restore_factory_power_config(exc)
            return parse_power(FACTORY_POWER_CONFIG, repair=False)
        raise


def parsed_power(parser):
    for section in ("general", "fan"):
        if not parser.has_section(section):
            raise ValueError(f"missing config section [{section}]")
    data = {
        "general": {"default_profile": parser.get("general", "default_profile")},
        "profiles": {},
        "fan_curves": {},
        "fan": {},
        "underclocks": {},
    }
    for name in PROFILES:
        section = f"profile.{name}"
        if not parser.has_section(section):
            raise ValueError(f"missing config section [{section}]")
        data["profiles"][name] = {
            "label": parser.get(section, "label", fallback="") or default_label(name),
            "cpu_governor": parser.get(section, "cpu_governor"),
            "cpu_max": parser.get(section, "cpu_max"),
            "cpu_underclock": parser.get(section, "cpu_underclock"),
            "gpu_max": parser.get(section, "gpu_max"),
            "gpu_min": parser.get(section, "gpu_min"),
            "fan_curve": parser.get(section, "fan_curve"),
        }
    for section in parser.sections():
        if section.startswith("fan_curve."):
            name = section.split(".", 1)[1]
            data["fan_curves"][name] = {
                "label": parser.get(section, "label", fallback="") or default_label(name),
                "curve": parser.get(section, "curve"),
            }
            continue
        if not section.startswith("underclock."):
            continue
        parts = section.split(".")
        if len(parts) == 3:
            _, device_class, level = parts
            data["underclocks"].setdefault(device_class, {})[level] = dict(parser.items(section))
    data["fan"] = dict(parser.items("fan"))
    return data


# Only editable fields are written to /etc; factory-only fields stay in /usr.
EDITABLE_KEYS = ("cpu_governor", "cpu_max", "cpu_underclock", "gpu_max", "gpu_min", "fan_curve")
NUMERIC_KEYS = ("cpu_max", "gpu_max", "gpu_min")


def profile_overrides(profile):
    out = {}
    for key in EDITABLE_KEYS:
        value = profile[key]
        out[key] = f"{float(value):.2f}" if key in NUMERIC_KEYS else str(value)
    return out


def set_or_clear(parser, section, key, value, keep):
    if keep:
        if not parser.has_section(section):
            parser.add_section(section)
        parser.set(section, key, value)
    elif parser.has_section(section) and parser.has_option(section, key):
        parser.remove_option(section, key)


def render_power(data, factory):
    # Preserve hand-edited /etc fields outside the plugin-owned keys.
    parser = configparser.ConfigParser()
    parser.optionxform = str
    parser.read(POWER_CONFIG)

    set_or_clear(parser, "general", "default_profile", data["general"]["default_profile"],
                 data["general"]["default_profile"] != factory["general"]["default_profile"])
    for name in PROFILES:
        overrides = profile_overrides(data["profiles"][name])
        edited = overrides != profile_overrides(factory["profiles"][name])
        for key in EDITABLE_KEYS:
            set_or_clear(parser, f"profile.{name}", key, overrides[key], edited)

    for section in ("general", *(f"profile.{name}" for name in PROFILES)):
        if parser.has_section(section) and not parser.options(section):
            parser.remove_section(section)

    with tempfile.TemporaryFile("w+", encoding="utf-8") as f:
        parser.write(f)
        f.seek(0)
        return f.read()


def factory_power_defaults():
    try:
        return parse_power(FACTORY_POWER_CONFIG)
    except OSError:
        return parse_power()


def save_power_config(data):
    if not isinstance(data, dict) or not isinstance(data.get("general"), dict):
        raise ValueError("invalid power config")
    data["general"]["default_profile"] = data["general"].get("default_profile", "")
    if data["general"]["default_profile"] not in PROFILES:
        raise ValueError("invalid power config")
    try:
        rendered = render_power(data, factory_power_defaults())
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"malformed power config: {exc}")
    call("write_config", name="power", text=rendered)
