# Deep suspend as a two-gate fleet feature

Deep suspend (PSCI suspend-to-RAM) runs only when both gates pass:

1. **Kernel gate**: the running kernel advertises `deep` in `/sys/power/mem_sleep`.
2. **Validation gate**: the device model is validated for deep (deep charging and
   resume verified on that hardware).

A model that fails either gate falls back to its profile default (`s2idle` for the
fleet), and to `fake` when the kernel does not advertise that either.

## Declaring a model validated

A device `.conf` (`system_files/usr/lib/armada/devices/`) clears its model in one of
two ways:

- `ARMADA_SUSPEND_MODE=deep`: deep is the default, which implies validation. The
  Retroid Pocket 6 does this.
- `ARMADA_SUSPEND_DEEP_VALIDATED=1`: deep is selectable but not the default.

`defaults.conf` keeps the fleet floor at `ARMADA_SUSPEND_DEEP_VALIDATED=0`. Every
other device `.conf` carries a commented `# ARMADA_SUSPEND_MODE=deep` line, so
validating a model is a one-line change.

## One source of truth

- `libexec/armada/device-env` resolves the validation state and the effective mode,
  including a user override in `/etc/armada/sleep.conf` (an override to deep on an
  unvalidated model is ignored), and exports `ARMADA_SUSPEND_DEEP_VALIDATED`.
- `libexec/armada/armada-control` owns the sleep-mode menu (`sleep_modes()`,
  served as `get_sleep_modes`): modes the kernel does not advertise are left out,
  and `deep` is listed but disabled until the model is validated.
  `set_sleep_mode` accepts only the enabled entries of that same menu.
- The Decky plugin consumes `get_sleep_modes` instead of re-reading `mem_sleep`, and
  shows a disabled mode greyed out and inert.

Tests: `tests/device-env-suspend-test.sh` (gates and overrides) and
`tests/armada-control-settings-test.sh` (menu, enforcement, plugin parity).
