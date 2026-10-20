# What the RP6 fork changes: an index

This fork (`unjordi/armada-rp6`) builds Armada for one device, the Retroid Pocket 6 (SM8550). This page
indexes everything it changes relative to upstream `armada-os/armada`: what each change is, why it exists,
where it lives, and how to check it. It is a map, not a changelog; the commit history has the detail.

**Comparison base:** the `upstream` remote (`https://github.com/armada-os/armada.git`). The fork diverged
at upstream commit `43c0cca`. Reproduce the full list with:

```sh
git log upstream/main..origin/develop --first-parent --format='%h %s'
git diff --stat upstream/main...origin/develop
```

Commands marked "on the device" run as root on a Retroid Pocket 6 running a fork image. Commands marked
"in the repo" need only a checkout. Anything not confirmed from the code or a patch header is marked
`TODO(verify)`.

Contents: [Kernel](#1-kernel) · [Deep suspend and dark resume](#2-deep-suspend-dark-resume-and-the-wake-ledger) ·
[armada-rgb](#3-armada-rgb) · [Armada Control](#4-armada-control-decky-plugin) · [Fan control](#5-fan-control-armada-powerd) ·
[Release notes](#6-release-notes) · [CI/CD](#7-cicd-and-the-signed-latest-image) · [Slim pass](#8-slim-pass) ·
[Hardware config](#9-hardware-config)

---

## 1. Kernel

**What and why.** Eight kernel-tree changes live in `packages/kernel/`, all tagged `source: armada`,
`upstream: local` in `packages/kernel/PATCHES.md` (none is submitted upstream yet). They exist so that the
RP6 can sleep in PSCI suspend-to-RAM ("deep"), charge while asleep, keep its LEDs and fan going, and wake
only when it should.

| Change | Purpose (from its patch header / `PATCHES.md`) |
|---|---|
| `0030a-leds-htr3212-retain-pattern-in-suspend.patch` | Adds an optional `keep_alive` sysfs attribute to the HTR3212 stick-LED controller. When set, the driver skips shutdown and regulator disable in its suspend hook, so the chip keeps driving its last PWM pattern with no CPU. |
| `0522a-PCI-host-common-keep-root-port-d3cold-veto-for-suspend-to-ram.patch` | Keeps upstream's endpoint-only D3cold rule (`0522`) for s2idle but restores the root-port veto for suspend-to-RAM. Without it the PCIe controller is powered off in PSCI suspend, nothing keeps a DDR vote, and the RP6 never resumes from deep (3/3 hangs at `PM: suspend entry (deep)` in the patch's measurements). |
| `0533-hwmon-pwm-fan-optional-static-pwm-across-suspend.patch` | Adds a `suspend_pwm` module parameter (default 0 = stock behaviour): a static fan duty kept across suspend-to-RAM. Userspace sets it only while charging. |
| `0910-power-supply-qcom-battmgr-dont-hold-wakeup-source-on-routine-notifications.patch` | Registers the battmgr supplies with no wakeup source, so routine ADSP telemetry no longer blocks suspend. Replaces upstream-series `0504` (IPCC summary-irq mask), which also silenced the charger doorbell. |
| `0911-power-supply-qcom-battmgr-wake-on-charger-attach-detach.patch` | Wakes the system only when `usb.online` / `wireless.online` actually changes (a real attach or detach). |
| `0912-power-supply-qcom-battmgr-pause-notifications-during-system-suspend.patch` | Asks the firmware to stop battery notifications during system suspend (SM8550 variant) and re-requests them only once the AP has stayed awake `resume_notify_delay_ms` (20 s). The enable request resets the firmware's power-state baseline, so re-enabling on every short dark-resume round made the next firmware event wake the device again. Plug, unplug and charge-state changes still wake it. |
| `dts/qcs8550-retroidpocket-rp6-suspend.dts.patch` | Marks the HTR3212 controllers always-on and drops `regulator-off-in-suspend` from `vdd_fan_5v0`, which `0030a` and `0533` need. |
| `dts/qcs8550-retroidpocket-rp6.dts` (LED groups) | Lists each multicolor LED group's channels in red, green, blue order by their colour (the node labels are swapped against their colour). The kernel's charging trigger fills intensities by position, so the old order painted the charge colour blue-cyan. |

**Series changes.** `packages/kernel/patches/series` also disables two upstream patches, each with an
inline reason: `0004-drm-msm-a6xx-Enable-IFPC-on-Adreno-740.patch` (on the A740, IFPC wedges the GPU after
idle and the panel stays black) and `0504-mailbox-qcom-ipcc-mask-summary-irq-for-suspend-to-ram.patch`
(superseded by `0910`/`0911`).

**Gamescope.** `packages/gamescope/patches/0024-screenshot-thread-sched-other-not-rt.patch` moves
gamescope's screenshot thread to `SCHED_OTHER`: under the compositor's `RLIMIT_RTTIME` budget, encoding a
PNG of a game frame overran it and the kernel killed the whole compositor (see `packages/gamescope/PATCHES.md`).

**Files (9 + 2)**
- `packages/kernel/patches/series`, `packages/kernel/PATCHES.md`
- `packages/kernel/patches/0030a-…`, `0522a-…`, `0533-…`, `0910-…`, `0911-…`, `0912-…`
- `packages/kernel/dts/qcs8550-retroidpocket-rp6-suspend.dts.patch`, `packages/kernel/dts/qcs8550-retroidpocket-rp6.dts`
- `packages/gamescope/patches/0024-screenshot-thread-sched-other-not-rt.patch`, `packages/gamescope/PATCHES.md`

**How to verify**
- In the repo, every patch in the series exists and each fork patch is documented:
  `grep -E '0030a|0522a|0533|0910|0911|0912|rp6-suspend' packages/kernel/patches/series packages/kernel/PATCHES.md`.
- On the device, the kernel parameters exist: `cat /sys/module/pwm_fan/parameters/suspend_pwm` and
  `cat /sys/bus/i2c/devices/{2,3}-003c/keep_alive` (one attribute per HTR3212 controller, on its I2C device).
- On the device, deep is advertised: `cat /sys/power/mem_sleep` shows `deep`.
- On the device: `cat /sys/module/qcom_battmgr/parameters/resume_notify_delay_ms` shows `20000`, and
  `cat /sys/class/leds/rgb:l1/multi_index` shows `red green blue`. In the repo: `tests/rp6-led-groups-rgb-order-test.sh`.
- A real deep suspend returns: `rtcwake -m mem -s 30` (resumes by RTC), then `journalctl -k -b | grep 'suspend entry (deep)'`.

---

## 2. Deep suspend, dark resume, and the wake ledger

**What and why.** The RP6 defaults to deep suspend, gated per model (`docs/deep-suspend-fleet-gate.md`).
On top of the kernel patches above, userspace adds:

- **Wake policy** (`45-armada-wake-policy`): before a deep suspend, disable every wakeup source except the
  power key and the RTC alarm (ADSP doorbells, thermal sensors, charger supply, Wi-Fi and SD otherwise wake
  the device in a pocket). Re-enabled on resume from a list in `/run/armada/`. Runs only when
  `device-env` reports `ARMADA_SUSPEND_MODE=deep`.
- **Dark resume** (`suspend-dispatch` + `dark-resume-lib`): in deep, a charger plug or unplug wakes the SoC
  and the kernel resumes fully. The library keeps user sessions frozen and the suspend job alive (logind
  never sees a resume, Steam and gamescope never notice), re-runs the `pre` hooks (LED colour, fan floor),
  and sleeps again. The panel brightness is set to 0 during a round and restored before thaw. Only the power
  button, an RTC alarm that someone armed, or a suspend failure end in a full resume. A wake storm (20
  consecutive rounds that each slept under 15 s; both tunable) is logged once as `reason=wakestorm` and the
  device keeps sleeping. User slice is always thawed on exit. Kill switch: `dark_resume=0` in
  `/etc/armada/sleep.conf`.
- **Charger mode** (cable power-on while off): the ROCKNIX ABL then boots `boot_a`/`boot_b`, not the ESP
  `/KERNEL`. `armada-chargerimg-update` (run by `armada-bootimg-sync` at boot and shutdown, only with
  `ARMADA_CHARGER_MODE=1`) writes there `/KERNEL`'s kernel, initramfs and DTBs with the cmdline
  `systemd.unit=armada-charger.target` (no `console=tty0`) and an unsigned AVB hash footer (`avbtool` vendored
  from AOSP, accepted while unlocked), and clears the Android header of `init_boot_a`/`init_boot_b`.
  `armada-charger.target` is `sysinit.target` plus `armada-charger.service` (no session, network or update
  timers): it sleeps in deep while a supply is online; the power button reboots into the normal boot (with
  splash), no supply online powers off. On that boot only, the splash units and `armada-boot-hotkeys` are
  skipped, a udev rule puts every backlight at 0, and the initramfs `initrd-switch-root` passes systemd as
  INIT (the ABL appends `init=/init` on that path). `suspend-dispatch` does a plain suspend there.
- **Charge LEDs while asleep** (`56-armada-rgb-suspend-charging`): opt-in. Stops the RGB daemon, sets
  `keep_alive=1` on the controllers, arms the kernel charge trigger and seeds the current charge colour
  (amber charging, green full). Restores everything on resume.
- **Fan floor while asleep and charging** (`55-armada-fan-suspend-charging`): writes `suspend_pwm`
  (default 51, override in `/etc/armada/fan-suspend-charging-pwm`) only while a supply reports `Charging`,
  else 0.
- **Wake ledger** (`40-armada-wake-ledger`): one line per resume in `/var/lib/armada/wake-ledger.log`
  (`wake_irq=`, interrupt name, mode). Dark-resume rounds add `dark-resume reason=<user|rtc|charger|other|failed|wakestorm> online=<a>-><b> round=<n> panel=<brightness>`;
  charger mode adds `charger-mode reason=<start|other|charger|user|unplug|failed> …`.
  The ledger is capped at 20000 lines, trimmed to 10000.
- **Wake probe** (`41-armada-wake-probe`): log-only instrumentation that diffs `/proc/interrupts` across a
  sleep to name wake sources the ledger reports as `none`. It enables `pm_debug_messages` for the cycle and
  restores it; it leaves `pm_print_times` off (one line per device callback filled the journal).
- **Journal retention** (`journald.conf.d/50-armada-retention.conf`): one week, capped at 512M.

**Files**
- `system_files/usr/libexec/armada/suspend-dispatch`, `system_files/usr/lib/armada/dark-resume-lib`
- `system_files/usr/libexec/armada/device-env`, `docs/deep-suspend-fleet-gate.md`
- `system_files/usr/lib/systemd/system-sleep/40-armada-wake-ledger`, `41-armada-wake-probe`,
  `45-armada-wake-policy`, `55-armada-fan-suspend-charging`, `56-armada-rgb-suspend-charging`
- Charger mode: `system_files/usr/libexec/armada/armada-chargerimg-update`, `armada-charger`,
  `system_files/usr/lib/armada/bootimg-args`, `system_files/usr/lib/systemd/system/armada-charger.{target,service}`,
  `armada-bootimg-sync.service`, the `armada-charger.conf` drop-ins, `usr/lib/udev/rules.d/61-armada-charger-backlight.rules`,
  `usr/lib/dracut/modules.d/91armada-charger/`, `build_files/vendor/avb/avbtool.py`

**How to verify**
- In the repo: `tests/dark-resume-test.sh`, `tests/wake-policy-hook-test.sh`, `tests/wake-probe-hook-test.sh`,
  `tests/fan-suspend-charging-hook-test.sh`, `tests/rgb-suspend-charging-hook-test.sh`,
  `tests/device-env-suspend-test.sh`, `tests/armada-charger-test.sh`, `tests/charger-mode-units-test.sh`,
  `tests/bootimg-regen-test.sh` (charger image). Each uses fake sysfs and replays wake events.
- On the device, the charger image: `python3 /usr/libexec/armada/avbtool.py info_image --image
  /dev/disk/by-partlabel/boot_a` (Algorithm NONE, partition boot) and
  `journalctl -b -u armada-bootimg-sync | grep chargerimg`.
- On the device, the effective mode: `/usr/libexec/armada/device-env | grep -E 'SUSPEND_MODE|DARK_RESUME'`.
- On the device, after a suspend with the charger plugged or unplugged while asleep:
  `tail -n 20 /var/lib/armada/wake-ledger.log` shows `dark-resume reason=charger … panel=0` and the screen stayed dark.
- On the device, after a sleep with no interaction: every ledger entry that ended it should read `reason=user`
  (power button) or `rtc`.

---

## 3. armada-rgb

**What and why.** `packages/armada-rgb/` is the lighting daemon and CLI for the RP6's stick LEDs
(HTR3212 controllers). The fork extends it with animated effects (`static`, `breathing`, `color_cycle`,
`rainbow`, `load`, `battery`, `screen_sync` — an ambilight sampled from the screen through
`gamescopectl screenshot`, run as the session user via `runuser`), brightness that follows the screen
backlight, a saturation setting, a device-tuned scale for that brightness sync, and `armada-rgb run`, a
daemon that re-paints the saved configuration (also after resume) and reloads live when
`/etc/armada/rgb.json` changes. `set` only paints the LEDs itself when no daemon is running (the daemon
writes `/run/armada-rgb/daemon.pid`), so moving a UI slider does not flash the base colour before the
effect repaints. Full CLI and effect reference: `packages/armada-rgb/README.md`.

**Files (11 + 1)**
- `packages/armada-rgb/src/{backend,controller,effects,lib,main,state}.rs`, `tests/controller.rs`,
  `Cargo.toml`, `Cargo.lock`, `build.sh`, `README.md`
- `system_files/usr/lib/systemd/system/armada-rgb.service`

**How to verify**
- In the repo: `cd packages/armada-rgb && cargo test` (run as a normal user; one preflight test depends on file permissions).
- On the device: `armada-rgb supported`, `armada-rgb get`, then
  `armada-rgb set --color FF0000 --brightness 40 --effect breathing --speed 150` and `systemctl status armada-rgb`.
- On the device, the live-slider fix: drag a UI slider while `watch -n0.05 'cat /sys/class/leds/l:{r,g,b}1/brightness'`
  (one single-colour node per channel: `l:` / `r:` stick, `r|g|b`, LED `1..4`) shows no flash of a different colour.

---

## 4. Armada Control (Decky plugin)

**What and why.** `decky/armada-control/` plus the privileged backend `system_files/usr/libexec/armada/armada-control`.
Changes in the fork:

- **RGB tab:** effect picker (reflects the saved effect), brightness-follows-screen toggle, a slider for the
  LED-vs-screen dimming factor (`sync_scale`, 10–200 %), "show charge status while sleeping" toggle plus a
  charge-indicator brightness slider (state in `/etc/armada/rgb-charge-indicator.conf`, read by hook 56).
  Slider values are sent as numbers, not formatted strings (`test/sliderValue.test.ts`).
- **Fans tab:** battery-temperature floor on/off and a profile selector (Quiet or Aggressive); see section 5.
- **Power tab and top bar:** unified power-profile UX; a profile indicator inside the Steam top bar whose
  size and margin come from the device config (section 9).
- **Release notes:** replaces Steam's "Patch Notes" button in Settings > System with a modal of this OS's
  notes (section 6).
- **Advanced tab:** toggle "keep rollback deployment" (`get_keep_rollback` / `set_keep_rollback`, flag file
  `/etc/armada/keep-rollback`) read by `armada-prune-rollback`; and the sleep-mode menu, which lists only
  modes the kernel advertises and disables `deep` on unvalidated models (`get_sleep_modes`).
- **Localization:** `en`, `es`, `pt-BR`, `pt-PT`, `zh-CN` locale files under `decky/armada-control/src/locales/`
  (the fork added `es`; the other four exist upstream).
- **Rollback pruning:** `armada-prune-rollback.service`/`.timer` run 10 minutes after boot and drop the
  ostree rollback deployment and its orphaned layers unless the keep flag exists; they also remove a
  `rpmostree/live-apply` ref whose base is no longer the booted deployment.

**Files (about 40)**
- Plugin: `decky/armada-control/main.py`, `py_modules/armada_control/{config,fan_curves,power,privileged,rgb,system}.py`,
  `src/{Content,backend,i18n,index,types}.ts(x)`, `src/tabs/{Compatibility,Fans,Power,Settings}.tsx`,
  `src/components/{ActiveProfileBadge,Calibration,ReleaseNotesModal,RgbLighting,widgets}.tsx`,
  `src/hooks/*`, `src/lib/{errors,releaseNotes,rgbEffects,topBarClock,topBarProfileIndicator,updateNotesPatch}.ts(x)`,
  `src/locales/*.ts`, `test/*.test.ts`, `tests/i18n.test.mjs`
- Backend and units: `system_files/usr/libexec/armada/armada-control`, `armada-prune-rollback`,
  `system_files/usr/lib/systemd/system/armada-prune-rollback.{service,timer}`

**How to verify**
- In the repo: `tests/armada-control-rgb-test.sh`, `armada-control-settings-test.sh`,
  `armada-control-battery-fan-toggle-test.sh`, `armada-control-keep-rollback-test.sh`,
  `armada-control-release-notes-test.sh`, `armada-prune-rollback-test.sh`, `device-hw-ui-config-test.sh`;
  and in `decky/armada-control`: `npm test`.
- On the device: open Quick Access > Armada Control and check the tabs; `systemctl list-timers armada-prune-rollback.timer`.

---

## 5. Fan control (armada-powerd)

**What and why.** `armada-powerd` stays the sole owner of the fan. The fork adds a floor by **battery
temperature**, because the CPU/GPU curve ignores the battery that fast charging heats. Target PWM is
`max(cpu_gpu_curve, battery_floor)` with an extra boost while charging, and it only ever raises the fan.
Configuration is the `[battery_fan]` section of `system_files/usr/share/armada/power-profiles.conf`:
`enabled=`, `profile=` (`quiet` default, or `aggressive`), curve sections `[battery_fan_curve.<name>]`
(`curve=temp_C:pwm,…`, `charging_boost=`). `curve`/`charging_boost` set directly in `[battery_fan]` override
the profile. Overrides live in `/etc/armada/power-profiles.conf`. While **asleep and charging**, the fan floor
comes from hook 55 and kernel patch `0533` (section 2).

**Files (3)**
- `system_files/usr/libexec/armada/armada-powerd`
- `system_files/usr/share/armada/power-profiles.conf`
- `decky/armada-control/src/tabs/Fans.tsx` (UI; counted in section 4)

**How to verify**
- In the repo: `tests/powerd-battery-fan-test.sh`, `tests/perf-settings-test.sh`.
- On the device: `grep -A8 '^\[battery_fan' /usr/share/armada/power-profiles.conf`;
  `ls /etc/systemd/system/armada-powerd.service.d/ 2>&1` should show no drop-in shadowing the image's unit.

---

## 6. Release notes

**What and why.** Steam's update panel shows a fixed string. The fork builds real notes in CI and shows
them in Armada Control.

1. CI (develop only) runs `build_files/release-notes.sh`: markdown from the first-parent commits between the
   previous published revision (the `org.opencontainers.image.revision` label of `:latest`) and the build
   commit, falling back to the last 20 commits; trailer lines are dropped; output capped at 8192 bytes.
2. The result is baked as `/usr/share/armada/release-notes.md` and attached to the image as the
   base64 label `io.armada.release-notes`.
3. `armada-release-notes current` prints the booted image's notes; `armada-release-notes pending` reads the
   label of the image `armada-update check` targets via `skopeo inspect`.
4. The plugin's `updateNotesPatch.tsx` swaps Steam's update-field component for one that opens the
   `ReleaseNotesModal`; with no notes available the field is left untouched.

**Files (7)**
- `build_files/release-notes.sh`, `.github/workflows/build.yml` (step "Generate release notes")
- `system_files/usr/libexec/armada/armada-release-notes`
- `decky/armada-control/src/lib/{updateNotesPatch.tsx,releaseNotes.ts}`, `src/components/ReleaseNotesModal.tsx`

**How to verify**
- In the repo: `tests/release-notes-test.sh`, `tests/release-notes-device-test.sh`,
  `tests/armada-control-release-notes-test.sh`.
- Generate notes locally: `bash build_files/release-notes.sh --version test --from origin/develop~5 --to origin/develop`.
- On the device: `armada-release-notes current; echo rc=$?` (rc 1 and empty output when there are none).
- Against the registry: `skopeo inspect docker://ghcr.io/<owner>/armada-rp6:latest | jq -r '.Labels["io.armada.release-notes"]' | base64 -d`.

---

## 7. CI/CD and the signed `:latest` image

**What and why.** Upstream publishes channel images; the fork's devices track a single moving tag.

- **develop to `:latest`:** `.github/workflows/build.yml` maps a push to `develop` onto the tag `latest`
  plus a `<date>.<short-sha>` version tag, pushes to GHCR, and signs the image digest with cosign
  (`--new-bundle-format=false`, because bootc's verifier expects the legacy signature). The public key
  shipped in the image is `system_files/etc/pki/containers/armada-rp6.pub`. Devices follow `:latest`
  through Settings > System; `armada-update check` compares the local digest with the registry's.
- **Monorepo packages:** `packages.yml` builds each package in `packages/` into
  `ghcr.io/<owner>/armada/pkg/<name>:<content-hash>`. On a fork it reuses upstream's published build
  (`ghcr.io/armada-os/armada/pkg`) of an unchanged package. `pr.yml` runs `tests/*-test.sh` and builds the
  image for pull requests without publishing.
- **terra-pins:** `packages/terra-pins/` fixes the RPMs the image takes from Terra by sha256 in `pins.txt`
  (5 pins). The image build installs them from that package and never contacts Terra, so a Terra outage or
  half-published mirror cannot break it. A package may ship its own `Containerfile.package`;
  `packages/containerfile-for.sh` selects it without changing other packages' hashes.
- **dnf-retry:** `build_files/dnf-retry.sh` wraps `dnf5` during the build and retries only failures that
  look transient (checksum mismatch, download errors, 5xx, timeouts), 4 attempts over about 3.5 minutes,
  with `--refresh` after the first failure.
- **Rollback pruning:** see section 4.

**Files (about 12)**
- `.github/workflows/{build,packages,pr}.yml`, `Containerfile`, `Justfile`
- `build_files/{dnf-retry.sh,build.sh,release-notes.sh}`
- `packages/{README.md,containerfile-for.sh}`, `packages/terra-pins/{Containerfile.package,build.sh,pins.txt}`
- `system_files/etc/pki/containers/armada-rp6.pub`

**How to verify**
- In the repo: `tests/dnf-retry-test.sh`, `tests/terra-pins-test.sh`.
- Published state: `gh run list --repo unjordi/armada-rp6 --branch develop --limit 3`;
  `skopeo inspect docker://ghcr.io/unjordi/armada-rp6:latest | grep -E 'Digest|"version"'`;
  `cosign verify --key system_files/etc/pki/containers/armada-rp6.pub ghcr.io/unjordi/armada-rp6@<digest>`.
- On the device: `/usr/libexec/armada/armada-update check; echo rc=$?` (7 means the device already runs the published digest).

---

## 8. Slim pass

The image drops what the RP6 cannot use (Heroic, Firefox, other SoCs' firmware, unused Vulkan drivers, docs)
and fails the build if a removal would break boot, firmware, Vulkan or required packages. Full list,
measurements and guards: [`docs/rp6-slim.md`](rp6-slim.md). Code: `build_files/70-cleanup.sh`,
`build_files/rp6-firmware-requerido.py`, `build_files/10-base-packages.sh`.

---

## 9. Hardware config

`system_files/usr/lib/armada/devices/retroid-pocket-6.conf` carries the RP6's per-device values, read through
`libexec/armada/device-env`:

| Key | Value | Meaning |
|---|---|---|
| `ARMADA_SUSPEND_MODE` | `deep` | Default suspend mode; also marks the model as validated for deep (`docs/deep-suspend-fleet-gate.md`). Overridable by `suspend_mode=` in `/etc/armada/sleep.conf`. |
| `ARMADA_DARK_RESUME` | `1` | Enables dark resume (section 2). Kill switch: `dark_resume=0` in `sleep.conf`. |
| `ARMADA_UI_TOPBAR_INDICATOR_SIZE_PX`, `…_MARGIN_PX` | `16`, `6` | Size and margin of the power-profile glyph in the Steam top bar. |
| `ARMADA_RGB_SYNC_SCALE` | `0.88` | Scale applied to the stick LEDs when following screen brightness. The UI slider overrides it (`sync_scale` in `rgb.json`). |
| `ARMADA_PANEL_ORIENTATION`, `ARMADA_HDR_NITS` | `left`, `750` | Panel orientation and HDR peak. Upstream keys (used by other device profiles), set here for the RP6. |

Other changes under `system_files/`: `etc/localtime` (symlink to `America/Mexico_City`), `etc/xdg/spectaclerc` and `etc/xdg/kglobalshortcutsrc` (F13 as the Spectacle
full-screen shortcut, so Steam Input can map a button to it). Every other device `.conf` gains a commented
`# ARMADA_SUSPEND_MODE=deep` line (see `docs/deep-suspend-fleet-gate.md`).

**How to verify**
- In the repo: `tests/device-hw-ui-config-test.sh`, `tests/device-env-suspend-test.sh`, `tests/spectacle-shortcuts-test.sh`.
- On the device: `/usr/libexec/armada/device-env` prints the resolved values.
