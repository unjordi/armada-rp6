#!/usr/bin/env bash
# build_files/dnf-retry.sh: retries ONLY transient repository failures, with
# fresh metadata on the retry, and gives up after the configured attempts; a
# real dnf error (no such package) fails on the first call.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SHIM="$ROOT/build_files/dnf-retry.sh"
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1 -- got [$2] exp [$3]"; fail=1; fi; }

# fake dnf5: plays the outcomes in $tmp/plan (one per call) and logs its argv
cat >"$tmp/dnf5" <<'FAKE'
#!/bin/bash
n=$(( $(cat "$T/n" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$T/n"
echo "$*" >>"$T/calls"
case "$(sed -n "${n}p" "$T/plan")" in
    ok)        echo "Complete!"; exit 0 ;;
    checksum)  echo ">>> Downloading successful, but checksum doesn't match."; echo "Failed to resolve the transaction:"; exit 1 ;;
    nomatch)   echo "No match for argument: nosuchpkg"; exit 1 ;;
    *)         exit 9 ;;
esac
FAKE
chmod +x "$tmp/dnf5"
run() { printf '%s\n' "$@" >"$tmp/plan"; rm -f "$tmp/n" "$tmp/calls"; rc=0
    T="$tmp" ARMADA_DNF_REAL="$tmp/dnf5" ARMADA_DNF_ATTEMPTS=4 ARMADA_DNF_DELAYS="0" \
        "$SHIM" -y install foo >"$tmp/out" 2>&1 || rc=$?; }
calls() { wc -l <"$tmp/calls" | tr -d ' '; }

run checksum checksum ok
check "transient twice then ok: succeeds" "$rc" 0
check "transient twice then ok: 3 calls" "$(calls)" 3
check "first call has no --refresh" "$(sed -n 1p "$tmp/calls")" "-y install foo"
check "retry forces fresh metadata" "$(sed -n 2p "$tmp/calls")" "--refresh -y install foo"

run nomatch
check "real error: fails" "$rc" 1
check "real error: no retry" "$(calls)" 1

run checksum checksum checksum checksum checksum
check "persistent transient: gives up with dnf's code" "$rc" 1
check "persistent transient: stops at the attempt cap" "$(calls)" 4

run ok
check "plain success: one call" "$(calls)" 1
check "output still shown" "$(grep -c Complete "$tmp/out")" 1

if (( fail )); then echo "dnf-retry: FAILURES"; exit 1; fi
echo "PASS: dnf-retry-test"
