from .controller import CONTROLLER_TYPES, controller_type, inputplumber_targets
from .power import active_profile, factory_power_defaults, parse_power
from .rgb import rgb_supported, sync_scale_percent
from .steam import installed_games
from .system import (
    abl_auto_enabled,
    abl_version,
    bottom_screen_brightness,
    bottom_screen_active,
    bottom_screen_enabled,
    device_env,
    mtp_enabled,
    os_version,
    perf_info,
    desktop_mode,
    desktop_modes,
    sleep_modes,
    ssh_enabled,
)
from .tweaks import fex_profile_labels, load_env_presets, load_fex_contract, load_tweaks


def build_config(include_games=True):
    fex_contract = load_fex_contract()
    env = device_env()
    secondary_brightness = bottom_screen_brightness()
    power = parse_power()
    # The profile armada-powerd is actually running, falling back to the
    # configured default before armada-powerd writes its first state file.
    live_profile = active_profile(power["profiles"].keys()) or power["general"]["default_profile"]
    return {
        "power": power,
        "powerDefaults": factory_power_defaults(),
        "activePowerProfile": live_profile,
        "tweaks": load_tweaks(),
        "installedGames": installed_games() if include_games else [],
        "fexProfiles": fex_profile_labels(fex_contract),
        "envPresets": load_env_presets(),
        "perf": perf_info(),
        "cpuDeviceClass": env.get("ARMADA_SOC_CLASS", ""),
        "topBarIndicator": {
            "sizePx": env.get("ARMADA_UI_TOPBAR_INDICATOR_SIZE_PX", ""),
            "marginPx": env.get("ARMADA_UI_TOPBAR_INDICATOR_MARGIN_PX", ""),
        },
        "rgbSupported": rgb_supported(),
        "rgbSyncScaleDefault": sync_scale_percent(env.get("ARMADA_RGB_SYNC_SCALE", "")),
        "protonDefaults": [
            default.strip()
            for default in env.get("ARMADA_PROTON_DEFAULTS", "").split(":")
            if default.strip()
        ],
        "osVersion": os_version(),
        "ablVersion": abl_version(),
        "ablAutoEnabled": abl_auto_enabled(),
        "bottomScreenSupported": bool(
            env.get("ARMADA_SECONDARY_CONNECTOR") and env.get("ARMADA_SECONDARY_TOUCHSCREEN")
        ),
        "bottomScreenEnabled": bottom_screen_enabled(),
        "bottomScreenBrightnessSupported": secondary_brightness is not None,
        "bottomScreenActive": bottom_screen_active(),
        "bottomScreenBrightness": secondary_brightness or 0,
        "chargingFanPwm": int(power["fan"].get("charging_pwm", 0)),
        "sshEnabled": ssh_enabled(),
        "mtpEnabled": mtp_enabled(),
        "desktopMode": desktop_mode(),
        "desktopModes": desktop_modes(),
        "sleepMode": env.get("ARMADA_SUSPEND_MODE", "s2idle"),
        "sleepModes": sleep_modes(),
        "controllerType": controller_type(),
        "controllerTypes": [
            {"data": key, "label": CONTROLLER_TYPES[key]} for key in inputplumber_targets(env)
        ],
    }
