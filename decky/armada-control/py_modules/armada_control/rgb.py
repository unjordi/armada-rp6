from .privileged import call


def rgb_supported():
    try:
        return get_rgb() is not None
    except Exception:
        return False


def get_rgb():
    return call("get_rgb")


def set_rgb(enabled, color, saturation, brightness, effect=None, speed=None):
    return call(
        "set_rgb",
        enabled=enabled,
        color=color,
        saturation=saturation,
        brightness=brightness,
        effect=effect,
        speed=speed,
    )


# A separate toggle (`armada-rgb sync-brightness on|off`), not an effect.
def set_rgb_sync_brightness(enabled):
    return call("set_rgb_sync_brightness", enabled=enabled)


# Opt-in gate the suspend hook reads directly (not armada-rgb's own config);
# default off.
def get_rgb_charge_indicator_enabled():
    return call("get_rgb_charge_indicator_enabled")


def set_rgb_charge_indicator_enabled(enabled):
    return call("set_rgb_charge_indicator_enabled", enabled=enabled)
