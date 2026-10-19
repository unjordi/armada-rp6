#!/bin/bash
# Charger mode in the initramfs: the ABL's cable power-on path adds
# "init=/init" (absent here), the initrd splash must not light the panel, and
# the backlight goes to 0 as soon as the panel binds.

check() {
    # 255 = explicit --add only, matching the other armada modules.
    return 255
}

depends() {
    echo systemd
    return 0
}

install() {
    # With INIT given as systemd's own binary, systemctl switch-root ignores the
    # cmdline init= and does the standard switch; same result on a normal boot.
    mkdir -p "$initdir/$systemdsystemunitdir/initrd-switch-root.service.d"
    printf '[Service]\nExecStart=\nExecStart=systemctl --no-block switch-root /sysroot /usr/lib/systemd/systemd\n' \
        > "$initdir/$systemdsystemunitdir/initrd-switch-root.service.d/armada-init.conf"

    mkdir -p "$initdir/$systemdsystemunitdir/armada-splash-initrd.service.d"
    printf '[Unit]\nConditionKernelCommandLine=!systemd.unit=armada-charger.target\n' \
        > "$initdir/$systemdsystemunitdir/armada-splash-initrd.service.d/armada-charger.conf"

    inst_rules 61-armada-charger-backlight.rules
}
