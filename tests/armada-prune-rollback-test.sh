#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ARMADA_PRUNE_SCRIPT:-$ROOT/system_files/usr/libexec/armada/armada-prune-rollback}"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

cat > "$WORK/ostree" <<'EOS'
#!/bin/bash
echo "$*" >> "$FAKE_LOG"
if [[ "$1 $2" == "admin status" ]]; then
    cat "$FAKE_STATUS"
elif [[ "$1" == refs ]]; then
    [[ -n "${FAKE_LIVE_PARENT:-}" ]] && echo rpmostree/live-apply
elif [[ "$1" == show ]]; then
    echo "commit 9999eeee"; echo "Parent:  ${FAKE_LIVE_PARENT}"
fi
EOS
chmod +x "$WORK/ostree"

run() {
    : > "$WORK/log"
    FAKE_LOG="$WORK/log" FAKE_STATUS="$WORK/status" \
    ARMADA_OSTREE="$WORK/ostree" \
    ARMADA_KEEP_ROLLBACK_FILE="$WORK/keep" \
    ARMADA_PRUNE_SKIP_LAYERS=1 \
        bash "$SCRIPT" 2>&1
}

undeploys() { grep '^admin undeploy' "$WORK/log" || true; }

fail() { echo "FAIL: $*" >&2; exit 1; }

# Index 1 is only right if origin:/Version: lines are not counted.
cat > "$WORK/status" <<'EOS'
* default 2222bbbb.0
    Version: 20261003.abc
    origin: ostree-image-signed:docker://ghcr.io/unjordi/armada-rp6:latest
  default 3333cccc.0 (rollback)
    origin: <unknown origin type>
EOS
run
[[ "$(undeploys)" == "admin undeploy 1" ]] || fail "rollback at 1: got '$(undeploys)'"

cat > "$WORK/status" <<'EOS'
  default 0000ffff.0 (staged)
    origin: x
* default 2222bbbb.0
    Version: v
  default 3333cccc.0 (rollback)
    origin: y
EOS
run
[[ "$(undeploys)" == "admin undeploy 2" ]] || fail "staged first: got '$(undeploys)'"

touch "$WORK/keep"
run
[[ -z "$(undeploys)" ]] || fail "keep-rollback set but undeployed"
rm -f "$WORK/keep"

cat > "$WORK/status" <<'EOS'
* default 2222bbbb.0
    origin: x
EOS
run
[[ -z "$(undeploys)" ]] || fail "no rollback but undeployed"

echo "armada-prune-rollback tests passed"

# A leftover apply-live ref whose base is not the booted deployment is stale and gets pruned,
# even with no rollback; one based on the booted deployment is still in use and is left alone.
cat > "$WORK/status" <<'EOS'
* default 2222bbbb.0
    origin: <unknown origin type>
EOS
out=$(FAKE_LIVE_PARENT=6a5e34aa run)
[[ "$out" == *"removing stale apply-live ref"* ]] || fail "stale apply-live not detected: $out"
[[ -z "$(undeploys)" ]] || fail "stale apply-live: unexpected undeploy"
out=$(FAKE_LIVE_PARENT=2222bbbb run)
[[ "$out" != *"stale apply-live"* ]] || fail "apply-live of the booted deployment flagged as stale"
echo "apply-live: ok"
