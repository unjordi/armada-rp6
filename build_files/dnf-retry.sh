#!/bin/bash
# dnf5 with retries for transient repository failures (a mirror mid-publish,
# metadata whose checksum does not match, a dropped download) for a few minutes,
# then fails rather than stall the build on a broken repository. build.sh puts it
# first in PATH as `dnf5` for the build; it is not shipped.
# Only failures that look transient are retried, so a real error (a package
# that does not exist, a conflict) still fails on the first try.
set -uo pipefail

real=${ARMADA_DNF_REAL:-/usr/bin/dnf5}
attempts=${ARMADA_DNF_ATTEMPTS:-4}
delays=(${ARMADA_DNF_DELAYS:-30 60 120})   # ~3.5 min in total
transient='checksum doesn.t match|Usable URL not found|Cannot download|Failed to download|Curl error|Status code: 5[0-9][0-9]|Timeout was reached|Could not resolve host|Connection reset|Failed to load expired repos cache|Librepo error'

log=$(mktemp "${TMPDIR:-/tmp}/dnf-retry.XXXXXX")
trap 'rm -f "$log"' EXIT
for ((try = 1; ; try++)); do
    args=("$@")
    # After a transient failure, force fresh metadata instead of the cached bad copy.
    (( try > 1 )) && args=(--refresh "$@")
    "$real" "${args[@]}" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
    (( rc == 0 )) && exit 0
    if (( try >= attempts )) || ! grep -Eq "$transient" "$log"; then
        exit "$rc"
    fi
    wait=${delays[try - 1]:-${delays[-1]}}
    echo "[dnf-retry] transient repository failure (attempt ${try}/${attempts}); retrying in ${wait}s" >&2
    sleep "$wait"
done
