#!/bin/bash
set -euxo pipefail

# Firmware for unrelated hardware.
dnf5 -y remove --no-autoremove \
    amd-gpu-firmware \
    amd-ucode-firmware \
    brcmfmac-firmware \
    cirrus-audio-firmware \
    intel-audio-firmware \
    intel-gpu-firmware \
    mt7xxx-firmware \
    nvidia-gpu-firmware \
    nxpwireless-firmware \
    qcom-wwan-firmware \
    realtek-firmware \
    tiwilink-firmware

rm -f /usr/lib/binfmt.d/qemu-*.conf

# AWS SDK chain from the bootc base.
dnf5 -y remove --no-autoremove \
    python3-boto3 \
    python3-botocore \
    python3-s3transfer

dnf5 -y remove --no-autoremove binutils

for required in qcom-firmware atheros-firmware bootc podman skopeo gamescope-session; do
    rpm -q "$required" >/dev/null || { echo "ERROR: $required got removed"; exit 1; }
done

# armada-splash owns the console; plymouth would fight it for the VT.
if rpm -q plymouth >/dev/null 2>&1; then
    echo "ERROR: plymouth got installed; a dependency dragged it in"
    exit 1
fi

for package in \
    armada-jupiter-hw-support \
    armada-splash \
    fex-emu-utils \
    terra-gamescope \
    terra-gamescope-libs \
    gamescope-session \
    gamescope-session-steam \
    inputplumber \
    mangohud \
    mesa-vulkan-drivers \
    NetworkManager \
    powerdevil \
    umtp-responder; do
    case "$(rpm -q --qf '%{release}' "$package" 2>/dev/null)" in
        *armada*) ;;
        *) echo "ERROR: patched .armada package not installed: $package"; exit 1 ;;
    esac
done

# Firmware pruning — ALLOWLIST (conservador): el SM8550 (kalama) solo usa
# qcom (adreno a740/a6xx, venus, adsp/cdsp/modem), ath12k/ath11k (WCN7850)
# y el audio/bt del device. Borramos TODO lo demás de /usr/lib/firmware.
# (allowlist, no blocklist frágil: si aparece una familia nueva, se borra por defecto)
FW_ALLOW='qcom ath12k ath11k ath10k ath6k ath9k brcm cypress nxp ti-connectivity'
for d in /usr/lib/firmware/*/; do
    name="$(basename "$d")"
    keep=0
    for a in $FW_ALLOW; do
        case "$name" in "$a"|"$a"-*) keep=1 ;; esac
    done
    if [ "$keep" -eq 0 ]; then
        rm -rf "$d"
    fi
done
# Dentro de qcom: dejar solo las familias del kalama (a740/a6xx, venus, adsp/cdsp/modem, wcn7850)
# y borrar SoCs/funciones que el SM8550 no usa.
rm -rf \
    /usr/lib/firmware/qcom/sm8750 \
    /usr/lib/firmware/qcom/x1e80100 \
    /usr/lib/firmware/qcom/sm8650 \
    /usr/lib/firmware/qcom/vpu \
    /usr/lib/firmware/qcom/sc8280xp \
    /usr/lib/firmware/qcom/kaanapali \
    /usr/lib/firmware/qcom/sdm845 \
    /usr/lib/firmware/qcom/sa8775p \
    /usr/lib/firmware/qcom/sm8250 \
    /usr/lib/firmware/qcom/maili \
    /usr/lib/firmware/qcom/qcm2290 \
    /usr/lib/firmware/qcom/qcs6490 \
    /usr/lib/firmware/qcom/apq8096 \
    /usr/lib/firmware/qcom/glymur

# Doc/man pruning (🟢, ~164M): documentación y manpages no necesarios en el device.
rm -rf /usr/share/doc /usr/share/man

# Vulkan drivers (🟢, ~110M): dejar solo freedreno (adreno a740) + swrast/zink.
# Borramos los ICDs de GPU que el SM8550 no usa.
rm -f \
    /usr/lib64/libvulkan_radeon.so \
    /usr/lib64/libvulkan_panfrost.so \
    /usr/lib64/libvulkan_nouveau.so \
    /usr/lib64/libvulkan_asahi.so \
    /usr/lib64/libvulkan_lvp.so \
    /usr/lib64/libvulkan_powervr_mesa.so \
    /usr/lib64/libvulkan_broadcom.so \
    /usr/lib64/libvulkan_dzn.so \
    /usr/lib64/libvulkan_virtio.so

# CJK input methods (🟢, ~59M): libpinyin/anthy/ibus-* no se usan en el device.
# Solo se borran si NADA del set los requiere (verificación con rpm --whatrequires).
for pkg in libpinyin libpinyin-data anthy anthy-unicode ibus ibus-libpinyin ibus-anthy; do
    if rpm -q "$pkg" >/dev/null 2>&1; then
        requires="$(rpm -q --whatrequires "$pkg" 2>/dev/null | grep -v '^$' || true)"
        if [ -z "$requires" ]; then
            dnf5 -y remove --no-autoremove "$pkg"
        else
            echo "WARN: $pkg requerido por: $requires — NO se borra (conservador)"
        fi
    fi
done

# Qt5 (🟢, ~34M): solo si NADA del set lo requiere (Plasma/KDE usa Qt6).
# Verificación con rpm --whatrequires; si algo lo pide, NO se borra.
for pkg in qt5-qtbase qt5-qtdeclarative qt5-qtquickcontrols2; do
    if rpm -q "$pkg" >/dev/null 2>&1; then
        requires="$(rpm -q --whatrequires "$pkg" 2>/dev/null | grep -v '^$' || true)"
        if [ -z "$requires" ]; then
            dnf5 -y remove --no-autoremove "$pkg"
        else
            echo "WARN: $pkg requerido por: $requires — NO se borra (conservador)"
        fi
    fi
done
