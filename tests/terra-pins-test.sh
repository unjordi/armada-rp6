#!/usr/bin/env bash
# terra-pins: the image takes its Terra RPMs from a package fixed by sha256 and
# never configures Terra itself, so a Terra outage cannot break the image build.
# Behaviour: build.sh accepts files whose sha256 matches the pin and refuses a
# file Terra replaced. Isolation: no image build step reaches Terra.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/packages/terra-pins"
tmp="$(mktemp -d)"; trap 'rm -rf -- "$tmp"' EXIT
fail=0
ok()  { echo "ok: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

# --- pins are well formed --------------------------------------------------
n=0
while read -r file sha extra; do
    [[ -z "$file" || "$file" == \#* ]] && continue
    n=$((n + 1))
    [[ "$file" == *.aarch64.rpm || "$file" == *.noarch.rpm ]] || bad "pin $file is not an aarch64/noarch rpm"
    [[ "$sha" =~ ^[0-9a-f]{64}$ && -z "$extra" ]] || bad "pin $file: bad sha256 field"
done <"$PKG/pins.txt"
(( n >= 5 )) && ok "pins.txt lists $n RPMs" || bad "pins.txt lists only $n RPMs"
for want in scx-scheds steam-notif-daemon kvazaar-libs libxavs; do
    grep -q "^${want}-[0-9]" "$PKG/pins.txt" && ok "pinned: $want" || bad "not pinned: $want"
done

# --- build.sh verifies what it downloads ----------------------------------
mkrepo() { # fake Terra with two files; pins as given
    rm -rf "$tmp/repo" "$tmp/work"; mkdir -p "$tmp/repo" "$tmp/work"
    printf 'one' >"$tmp/repo/a-1.0-1.fc44.aarch64.rpm"; printf 'two' >"$tmp/repo/b-2.0-1.fc44.noarch.rpm"
    cp "$PKG/build.sh" "$tmp/work/"
    printf '# test\n%s  %s\n%s  %s\n' \
        a-1.0-1.fc44.aarch64.rpm "$(sha256sum "$tmp/repo/a-1.0-1.fc44.aarch64.rpm" | cut -d' ' -f1)" \
        b-2.0-1.fc44.noarch.rpm "${1:-$(sha256sum "$tmp/repo/b-2.0-1.fc44.noarch.rpm" | cut -d' ' -f1)}" \
        >"$tmp/work/pins.txt"
}
mkrepo
if (cd "$tmp/work" && TERRA_PINS_BASE="file://$tmp/repo" ./build.sh >/dev/null 2>&1) &&
    [[ -f "$tmp/work/out/a-1.0-1.fc44.aarch64.rpm" && -f "$tmp/work/out/b-2.0-1.fc44.noarch.rpm" ]]; then
    ok "matching sha256: both RPMs land in out/"
else bad "matching sha256 did not produce out/"; fi
mkrepo "$(printf '0%.0s' {1..64})"
if (cd "$tmp/work" && TERRA_PINS_BASE="file://$tmp/repo" ./build.sh >"$tmp/log" 2>&1); then
    bad "a replaced file (sha256 mismatch) was accepted"
else
    grep -q "sha256 mismatch for b-2.0-1.fc44.noarch.rpm" "$tmp/log" && ok "replaced file refused, named" || bad "mismatch error not clear: $(cat "$tmp/log")"
fi

# --- the image build never reaches Terra ----------------------------------
if grep -nE 'fyralabs|enable-repo=terra|terra-release' "$ROOT"/build_files/*.sh "$ROOT/Containerfile"; then
    bad "an image build step still configures Terra (above)"
else ok "no image build step configures Terra"; fi
grep -q '^ARG TERRA_PINS_REF$' "$ROOT/Containerfile" && ok "Containerfile resolves TERRA_PINS_REF" || bad "TERRA_PINS_REF missing"
grep -q 'from=terra-pins,source=/rpms,target=/packages/terra-pins' "$ROOT/Containerfile" && ok "terra-pins mounted for the build" || bad "terra-pins not mounted"
grep -q '/packages/terra-pins/\*\.rpm' "$ROOT/build_files/10-base-packages.sh" && ok "10-base installs the pins" || bad "10-base does not install the pins"

# --- its own Containerfile keeps every other package hash unchanged --------
[[ "$("$ROOT/packages/containerfile-for.sh" terra-pins)" == packages/terra-pins/Containerfile.package ]] && ok "terra-pins builds from its own Containerfile" || bad "terra-pins uses the shared Containerfile"
[[ "$("$ROOT/packages/containerfile-for.sh" kernel)" == packages/Containerfile ]] && ok "other packages keep the shared Containerfile" || bad "kernel no longer uses packages/Containerfile"
grep -q 'terra-pins' "$ROOT/packages/Containerfile" && bad "terra-pins leaked into packages/Containerfile (would rehash every package)" || ok "packages/Containerfile untouched"

if (( fail )); then echo "terra-pins: FAILURES"; exit 1; fi
echo "PASS: terra-pins-test"
