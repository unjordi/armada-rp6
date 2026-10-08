#!/usr/bin/env bash
# build_files/release-notes.sh: commit range, trailer filtering, size cap.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/build_files/release-notes.sh"
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "ok: $1"; else echo "FAIL: $1"; printf '  got: [%s]\n  exp: [%s]\n' "$2" "$3"; fail=1; fi; }
has() { if grep -qF -- "$2" <<<"$3"; then echo "ok: $1"; else echo "FAIL: $1 -- missing [$2]"; fail=1; fi; }
lacks() { if grep -qF -- "$2" <<<"$3"; then echo "FAIL: $1 -- found [$2]"; fail=1; else echo "ok: $1"; fi; }

repo="$tmp/repo"
git init -q -b develop "$repo"
git -C "$repo" config user.email t@example.com
git -C "$repo" config user.name t
commit() { git -C "$repo" commit -q --allow-empty -m "$1"; }

commit "chore: root"
commit "feat: old change"
base="$(git -C "$repo" rev-parse HEAD)"
commit "$(printf 'feat(rgb): slider fix (#50)\n\nSliders send numbers.\nSecond line of the same paragraph.\n\nSecond paragraph is not included.\n\nRama: fix/rgb\nMR/PR: #50\nCo-Authored-By: X <x@example.com>\nClaude-Session: https://example.com/s')"
commit "$(printf 'fix: trailers only\n\nRama: fix/x\nMR/PR: #51\nCo-Authored-By: X <x@example.com>')"
commit "fix: title only"
# A side branch merged with a merge commit: only the merge is a first-parent entry.
git -C "$repo" checkout -q -b side
commit "feat: side internal commit"
git -C "$repo" checkout -q develop
git -C "$repo" merge -q --no-ff side -m "Merge side"
head="$(git -C "$repo" rev-parse HEAD)"

out="$("$SCRIPT" --repo "$repo" --version 20261007.abc --from "$base")"
check "header" "$(sed -n 1p <<<"$out")" "## 20261007.abc"
has "range includes new commit" "- feat(rgb): slider fix (#50)" "$out"
has "first paragraph kept, joined on one line" "  Sliders send numbers. Second line of the same paragraph." "$out"
lacks "second paragraph dropped" "Second paragraph" "$out"
lacks "range excludes the base commit" "old change" "$out"
lacks "range excludes earlier commits" "root" "$out"
lacks "Rama trailer" "Rama:" "$out"
lacks "MR/PR trailer" "MR/PR:" "$out"
lacks "Co-Authored-By trailer" "Co-Authored-By" "$out"
lacks "Claude-Session trailer" "Claude-Session" "$out"
has "trailer-only body keeps the title" "- fix: trailers only" "$out"
check "trailer-only body leaves no detail line" "$(grep -A1 -F -- '- fix: trailers only' <<<"$out" | sed -n 2p)" "- feat(rgb): slider fix (#50)"
has "first-parent merge listed" "- Merge side" "$out"
lacks "side-branch commit not listed" "side internal" "$out"

out="$("$SCRIPT" --repo "$repo" --version v --from deadbeef --fallback-count 2)"
check "unknown --from falls back to N commits" "$(grep -c '^- ' <<<"$out")" 2
has "fallback is the newest commits" "- Merge side" "$out"

out="$("$SCRIPT" --repo "$repo" --version v)"
check "empty --from falls back (default count covers all first-parent commits)" "$(grep -c '^- ' <<<"$out")" 6

out="$("$SCRIPT" --repo "$repo" --version v --from "$head")"
check "empty range has only the header" "$out" "$(printf '## v\n')"

# Size cap
for i in $(seq 1 40); do commit "feat: filler commit number $i with a reasonably long title to fill space"; done
out="$("$SCRIPT" --repo "$repo" --version v --from "$base" --max-bytes 600)"
size="$(printf '%s' "$out" | LC_ALL=C wc -c | tr -d ' ')"
if (( size <= 600 )); then echo "ok: output within cap ($size bytes)"; else echo "FAIL: $size bytes > 600"; fail=1; fi
check "truncated output ends with the ellipsis" "$(tail -n1 <<<"$out")" "…"
full="$("$SCRIPT" --repo "$repo" --version v --from "$base" --max-bytes 100000)"
check "truncation cuts on a line boundary" "$(grep -cxF -- "$(tail -n2 <<<"$out" | head -n1)" <<<"$full")" 1
lacks "oldest commits are cut" "slider fix" "$out"
out="$("$SCRIPT" --repo "$repo" --version v --from "$base" --max-bytes 100000)"
lacks "no ellipsis when under the cap" "…" "$out"

rc=0; "$SCRIPT" --repo "$repo" >/dev/null 2>&1 || rc=$?
check "missing --version is rejected" "$rc" 2

exit "$fail"
