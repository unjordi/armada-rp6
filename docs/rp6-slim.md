# The RP6 slim pass: what this fork removes from the image, and why

This fork (`unjordi/armada-rp6`) builds Armada for one device, the Retroid Pocket 6 (SM8550). On top of
upstream's own cleanup, `build_files/70-cleanup.sh` runs a **slim pass** that removes what the RP6 cannot
use. This page lists every removal, how much space it saves, what is kept on purpose, and the build guards
that stop a removal from breaking the device.

**Rule for future removals:** one item at a time, with evidence that nothing on the device uses it. The guards
below enforce part of that automatically. Removing first and checking later is how the first version of this
pass shipped without audio and without Bluetooth firmware (see "History").

## What it removes

Measured by building the same commit twice, once with this pass and once with upstream's `70-cleanup.sh`,
and comparing the two root filesystems: **1.24 GB less, 23 030 files** (2026-10-03).

| Removed | Size | Why it is safe on the RP6 |
|---|---:|---|
| Heroic Games Launcher | 387 MB | Not used on this device (Steam is the store). |
| Firefox | 299 MB | Not used on this device. |
| Firmware for other Qualcomm SoCs (`qcom/sm8750`, `x1e80100`, `sm8650`, `sc8280xp`, `kaanapali`, …) | 202 MB | The RP6 is SM8550; it never loads another SoC's firmware. |
| Documentation and man pages (`/usr/share/doc`, `/usr/share/man`) | 116 MB | Nothing reads them at runtime. |
| Vulkan drivers for GPUs the RP6 does not have (radeon, nouveau, asahi, panfrost, powervr, broadcom, dzn, virtio) and their loader manifests | ~96 MB | These drivers can only drive their own GPUs; the RP6's Adreno uses turnip. |
| WebKitGTK 6.0 | 94 MB | Only needed by the removed apps. |
| Bazaar (Flatpak store GUI) | 4 MB | Removed together with WebKitGTK; not used on this device. |
| Firmware families for hardware the RP6 does not have (Intel, NVIDIA, AMD GPU, MediaTek, Realtek NICs, server NICs, …) | ~20 MB | Chosen by an allowlist; see "Firmware" below. |

Also listed in the script but **absent from the base image**, so nothing is removed for them: the other
WebKitGTK versions, `cups`, `gcc`, `make`. Each removal first runs `rpm -e --test`, which also sees soname
dependencies, and skips the package (logging what depends on it) instead of letting dnf take dependents along.
That is why Bazaar is listed explicitly ahead of WebKitGTK 6.0 rather than removed as a side effect.

The base image installs the **variable** Noto Sans CJK font (`google-noto-sans-cjk-vf-fonts`, 33 MB) instead of
upstream's static set (`google-noto-sans-cjk-fonts`, 131 MB): same Japanese, Chinese and Korean coverage, 98 MB less.

## What it keeps on purpose

- **Everything games use:** turnip (Adreno Vulkan), **lavapipe** (CPU Vulkan fallback), Mesa, Zink, the Vulkan
  loader and layers, gamescope, MangoHud, FEX and its RootFS, the baked Proton. Only their documentation is removed.
- **CJK text:** the variable CJK font above, and the input-method libraries (`libpinyin`, `anthy-unicode`) and
  Qt5, which the on-screen keyboard (`maliit-keyboard`), KDE Frameworks 5 and `plasma-integration-qt5` link against.
- **All firmware the RP6 hardware can load**, including `qcom/vpu` (video decoder; without it audio breaks)
  and `qca/` (WCN7850 Bluetooth).
- Upstream's own cleanup is unchanged; this pass runs on top of it.

## Guards (the build fails instead of shipping a broken image)

1. **Firmware.** `build_files/rp6-firmware-requerido.py` derives the firmware the RP6 can load from the RP6
   itself: the enabled `compatible` strings and `firmware-name` properties of its device tree, the kernel
   modules that bind them (through `modules.alias`, plus their dependencies), and the firmware those modules
   request (`modinfo`, and firmware-like strings inside the modules, because most drivers build the file name at
   runtime and declare nothing). Files under other SoCs' directories, and symlinks into them, are excluded.
   `70-cleanup.sh` computes that list **before** pruning and fails if any listed file is gone afterwards, naming
   each one. Run `./rp6-firmware-requerido.py --explain` to see which driver asks for each file.
2. **Vulkan.** The build fails if turnip or lavapipe is missing, or if any loader manifest in
   `/usr/share/vulkan/icd.d` points at a library that does not exist.
3. **Packages.** The build fails if the pass removed a package the RP6 needs to boot, sleep, connect or play
   (bootc, dracut, NetworkManager, PipeWire, WirePlumber, BlueZ, gamescope-session, InputPlumber, FEX,
   the on-screen keyboard, the CJK font, …).

## How it was audited

1. Build the same commit with and without the slim pass, export both root filesystems, and diff files and packages.
2. For everything removed, look for anything left in the slimmed image that still consumes it:
   - binaries and libraries whose `NEEDED` library is gone;
   - symlinks that now dangle;
   - configuration, units, `.desktop` files and scripts that reference a removed path;
   - Vulkan, EGL and OpenCL manifests pointing at removed libraries.

   Result: **no binary or library lost a dependency**. The only consumers left were the orphaned Vulkan
   manifests (now removed with their drivers) and references to the removed apps and documentation.
3. Firmware is covered by guard 1 instead of a list.

## History

- The first version removed `qcom/vpu`. `qcom-iris` then failed, `/dev/video0` broke and WirePlumber stopped
  linking audio streams. `qcom/vpu` is now kept and guarded.
- The firmware allowlist omitted `qca/`, so the WCN7850 Bluetooth controller ran from ROM without its patch
  and NVM (it showed a placeholder address). `qca/` is now kept, and guard 1 replaced the hand-written list.
- Lavapipe was removed although the software Vulkan path was meant to stay. It is now kept and guarded.
- Upstream's static CJK font was dropped with nothing in its place, leaving no font for Japanese, Chinese or
  Korean (names rendered as boxes). The variable font now covers them at a quarter of the size.
- The removal checks used `rpm -q --whatrequires <name>`, which misses soname dependencies. Loops meant for the
  CJK input methods and Qt5 would have removed the on-screen keyboard if their filter had worked; they were
  dropped, and every removal is now gated on `rpm -e --test`.
