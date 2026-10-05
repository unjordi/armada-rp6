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

for required in \
    qcom-firmware \
    atheros-firmware \
    bootc \
    podman \
    skopeo \
    gamescope-session \
    newt \
    python-unversioned-command \
    lsb_release \
    fuse-libs \
    sdl2-compat; do
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
    protontricks \
    steamos-manager \
    umtp-responder; do
    case "$(rpm -q --qf '%{release}' "$package" 2>/dev/null)" in
        *armada*) ;;
        *) echo "ERROR: patched .armada package not installed: $package"; exit 1 ;;
    esac
done

# Firmware the RP6 hardware can load (device tree + its drivers), computed BEFORE pruning; checked after it.
./rp6-firmware-requerido.py > /tmp/rp6-firmware-requerido.txt
[ -s /tmp/rp6-firmware-requerido.txt ] || { echo "[70-cleanup] ERROR: rp6-firmware-requerido.py listed nothing; the firmware guard would check nothing"; exit 1; }

# Firmware pruning by ALLOWLIST: the SM8550 (kalama) only loads qcom (Adreno
# a740/a6xx, adsp/cdsp/modem, iris), ath12k/ath11k (WCN7850) and qca (Bluetooth).
# Everything else in /usr/lib/firmware goes; a new vendor family is dropped by
# default instead of slipping past a blocklist.
FW_ALLOW='qcom qca ath12k ath11k ath10k ath6k ath9k brcm cypress nxp ti-connectivity'
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
# Inside qcom: drop the other SoCs. qcom/vpu stays: without the iris video
# firmware /dev/video0 breaks and WirePlumber hangs enumerating it (no audio);
# the firmware guard at the end catches its removal.
rm -rf \
    /usr/lib/firmware/qcom/sm8750 \
    /usr/lib/firmware/qcom/x1e80100 \
    /usr/lib/firmware/qcom/sm8650 \
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

# Doc/man pruning (~164 MB): not needed on the device.
rm -rf /usr/share/doc /usr/share/man

# Vulkan drivers: keep turnip (Adreno A740) and lavapipe (lvp, the CPU Vulkan fallback); drop the ICDs for GPUs
# the SM8550 does not have, together with their loader manifests so no ICD points at a missing library.
for icd in radeon panfrost nouveau asahi powervr_mesa broadcom dzn virtio; do
    rm -f "/usr/lib64/libvulkan_${icd}.so" /usr/share/vulkan/icd.d/"${icd}"_icd.*.json
done
# turnip (the GPU) and lavapipe (CPU fallback) must survive, and no manifest may point at a missing library.
for icd in freedreno lvp; do
    [ -e "/usr/lib64/libvulkan_${icd}.so" ] && compgen -G "/usr/share/vulkan/icd.d/${icd}_icd.*.json" >/dev/null \
        || { echo "[70-cleanup] ERROR: Vulkan ICD ${icd} was removed by the slim pass"; exit 1; }
done
for json in /usr/share/vulkan/icd.d/*.json; do
    lib=$(sed -n 's/.*"library_path": *"\([^"]*\)".*/\1/p' "$json")
    [ -z "$lib" ] || [ -e "$lib" ] || { echo "[70-cleanup] ERROR: $json points at missing $lib"; exit 1; }
done

# Packages the RP6 build does not use (no Heroic, Firefox, printing or toolchain;
# bazaar is the only user of webkitgtk6.0). Each is removed only when `rpm -e --test`
# says nothing else depends on it -- that check also sees soname dependencies,
# which `rpm -q --whatrequires <name>` misses -- so dnf never takes a dependent
# with it. Order matters: a dependent comes before what it depends on.
for pkg in \
    heroic-games-launcher \
    firefox \
    bazaar \
    webkitgtk6.0 webkit2gtk4.1 webkit2gtk3 \
    cups-pk-helper cups-browsed cups-filters cups \
    gcc-c++ gcc cpp make automake autoconf libtool ; do
    rpm -q "$pkg" >/dev/null 2>&1 || continue
    if blockers="$(rpm -e --test "$pkg" 2>&1)"; then
        echo "  slim: removing $pkg"
        dnf5 -y remove --no-autoremove "$pkg"
    else
        echo "  slim: keeping $pkg, other packages depend on it:"
        printf '%s\n' "$blockers" | sed 's/^/    /'
    fi
done

# Final guard: the removals above go through dnf, which also drops anything that
# depends on a removed package. Fail the build if that took out something the RP6
# needs to boot, sleep, connect or play.
for required in qcom-firmware atheros-firmware bootc podman skopeo dracut \
    mesa-vulkan-drivers mesa-dri-drivers NetworkManager NetworkManager-wifi \
    pipewire wireplumber bluez plasma-workspace kwin sddm flatpak \
    gamescope-session inputplumber powerdevil fex-emu armada-rgb spectacle wireguard-tools \
    maliit-keyboard google-noto-sans-cjk-vf-fonts; do
    rpm -q "$required" >/dev/null || { echo "[70-cleanup] ERROR: $required was removed by the slim pass"; exit 1; }
done

# Every firmware file the RP6 hardware can load that existed before pruning must still exist.
missing=0
while read -r fw; do
    f=/usr/lib/firmware/$fw
    [ -e "$f" ] || [ -e "$f.xz" ] || [ -e "$f.zst" ] \
        || { echo "[70-cleanup] ERROR: the slim pass removed firmware the RP6 needs: $fw"; missing=1; }
done < /tmp/rp6-firmware-requerido.txt
[ "$missing" = 0 ] || { echo "[70-cleanup] see: ./rp6-firmware-requerido.py --explain (which driver asks for each file)"; exit 1; }
rm -f /tmp/rp6-firmware-requerido.txt
