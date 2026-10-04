#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT

python3 -B - "$ROOT" "$WORK" <<'PYEOF'
import importlib.machinery
import importlib.util
from pathlib import Path
import sys

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "system_files/usr/lib/armada"))

control_path = root / "system_files/usr/libexec/armada/armada-control"
loader = importlib.machinery.SourceFileLoader("armada_control_service", str(control_path))
spec = importlib.util.spec_from_loader("armada_control_service", loader)
control = importlib.util.module_from_spec(spec)
loader.exec_module(control)

keep = Path(sys.argv[2]) / "keep-rollback"
control.KEEP_ROLLBACK_FILE = keep

for action in ("get_keep_rollback", "set_keep_rollback"):
    assert action in control.ACTIONS, f"{action} not registered in ACTIONS"

assert control.action_get_keep_rollback({}) == {"enabled": False}

assert control.action_set_keep_rollback({"enabled": True}) == {"enabled": True}
assert keep.exists()
assert control.action_get_keep_rollback({}) == {"enabled": True}

assert control.action_set_keep_rollback({"enabled": False}) == {"enabled": False}
assert not keep.exists()
assert control.action_get_keep_rollback({}) == {"enabled": False}

# Turning it off when already off must not fail.
assert control.action_set_keep_rollback({"enabled": False}) == {"enabled": False}

keep.write_text("")
for bad in ("yes", 1, None):
    try:
        control.action_set_keep_rollback({"enabled": bad})
    except ValueError:
        pass
    else:
        raise AssertionError(f"non-bool {bad!r} was accepted")
assert keep.exists(), "rejected request must not change state"
PYEOF
echo "armada-control keep-rollback tests passed"
