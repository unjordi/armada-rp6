#!/usr/bin/env bash
# armada-release-notes: `pending` decodes the label of the image `check` targets;
# `current` reads the baked file; no notes => empty stdout and exit 1.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TOOL="$ROOT/system_files/usr/libexec/armada/armada-release-notes"
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
mkdir "$tmp/bin"
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1"; printf '  got: [%s]\n  exp: [%s]\n' "$2" "$3"; fail=1; fi; }

cat >"$tmp/bin/rpm-ostree" <<'STUB'
#!/bin/bash
printf '{"deployments":[{"container-image-reference":"%s"}]}\n' "$BOOTED_REF"
STUB
# skopeo stub: records the inspected reference; prints the JSON fixture or fails.
cat >"$tmp/bin/skopeo" <<'STUB'
#!/bin/bash
[[ "$1" == inspect ]] || exit 1
echo "$2" >"$SKOPEO_ARG_FILE"
[[ -z "${SKOPEO_FAIL:-}" ]] || exit 1
cat "$SKOPEO_FIXTURE"
STUB
chmod +x "$tmp/bin/rpm-ostree" "$tmp/bin/skopeo"
export PATH="$tmp/bin:$PATH" SKOPEO_ARG_FILE="$tmp/skopeo-arg" SKOPEO_FIXTURE="$tmp/image.json"
export BOOTED_REF="ostree-image-signed:docker://ghcr.io/armada-os/armada:stable"
export ARMADA_UPDATE_LIB="$ROOT/system_files/usr/lib/armada/update-lib"
export ARMADA_CHANNEL_STATE="$tmp/no-channel-state"
export ARMADA_RELEASE_NOTES_FILE="$tmp/release-notes.md"

notes=$'## 20261007.abc\n\n- Better fan curve\n  Quiet by default.\n- Accents: ñ é 日本\n'
b64="$(printf '%s' "$notes" | base64 -w0)"
printf '{"Digest":"sha256:x","Labels":{"io.armada.release-notes":"%s","org.opencontainers.image.version":"20261007.abc"}}' "$b64" >"$tmp/image.json"

run() { rc=0; out="$("$TOOL" "$@" 2>"$tmp/err")" || rc=$?; }

run pending
check "pending: exit 0" "$rc" 0
check "pending: prints the decoded notes (utf-8 intact)" "$out" "${notes%$'\n'}"
check "pending: inspects the same repo:tag as check" "$(cat "$tmp/skopeo-arg")" "docker://ghcr.io/armada-os/armada:stable"

printf '{"Digest":"sha256:x","Labels":{"org.opencontainers.image.version":"1"}}' >"$tmp/image.json"
run pending
check "pending without the label: exit 1" "$rc" 1
check "pending without the label: empty stdout" "$out" ""
check "pending without the label: no traceback" "$(grep -c Traceback "$tmp/err" || true)" 0

printf '{"Digest":"sha256:x","Labels":{"io.armada.release-notes":"%%%%not-base64"}}' >"$tmp/image.json"
run pending
check "pending with a corrupt label: exit 1, empty" "$rc:$out" "1:"
check "pending with a corrupt label: no traceback" "$(grep -c Traceback "$tmp/err" || true)" 0

SKOPEO_FAIL=1 run pending
check "pending with the registry unreachable: exit 1, empty" "$rc:$out" "1:"

printf '{"Digest":"sha256:x","Labels":{"io.armada.release-notes":"%s"}}' "$(printf '   \n' | base64 -w0)" >"$tmp/image.json"
run pending
check "pending with a blank label: exit 1, empty" "$rc:$out" "1:"

run current
check "current without a file: exit 1, empty" "$rc:$out" "1:"
printf '%s' "$notes" >"$ARMADA_RELEASE_NOTES_FILE"
run current
check "current: exit 0" "$rc" 0
check "current: prints the baked file" "$out" "${notes%$'\n'}"
: >"$ARMADA_RELEASE_NOTES_FILE"
run current
check "current with an empty file: exit 1, empty" "$rc:$out" "1:"

run bogus
check "unknown subcommand: exit 2" "$rc" 2

exit "$fail"
