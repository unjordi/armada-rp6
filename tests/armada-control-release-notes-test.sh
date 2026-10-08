#!/usr/bin/env bash
# Decky backend get_release_notes: tool stdout on success, "" on failure or a bad source.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf -- "$WORK"' EXIT

cat >"$WORK/tool" <<'TOOL'
#!/bin/bash
echo "$1" >>"$WORK_CALLS"
case "$1:${TOOL_MODE:-ok}" in
    *:fail) exit 1 ;;
    pending:ok) printf '## 2\n\n- pending notes\n' ;;
    current:ok) printf '## 1\n\n- current notes\n' ;;
esac
TOOL
chmod +x "$WORK/tool"

WORK_CALLS="$WORK/calls" python3 -B - "$ROOT" "$WORK" <<'PY'
import os, sys
sys.path.insert(0, sys.argv[1] + "/decky/armada-control/py_modules")
from armada_control import system

system.RELEASE_NOTES_TOOL = sys.argv[2] + "/tool"
calls = sys.argv[2] + "/calls"

assert system.get_release_notes("pending") == "## 2\n\n- pending notes\n"
assert system.get_release_notes("current") == "## 1\n\n- current notes\n"

os.environ["TOOL_MODE"] = "fail"
assert system.get_release_notes("pending") == "", "tool failure must give empty notes"

os.environ["TOOL_MODE"] = "ok"
before = open(calls).read()
for bad in ("../etc/passwd", "", None, "pending; id"):
    assert system.get_release_notes(bad) == "", bad
assert open(calls).read() == before, "an invalid source must not run the tool"

system.RELEASE_NOTES_TOOL = sys.argv[2] + "/missing"
assert system.get_release_notes("pending") == "", "missing tool must give empty notes"
PY
echo "armada-control release-notes tests passed"
