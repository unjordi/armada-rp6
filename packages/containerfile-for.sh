#!/usr/bin/env bash
# Prints the Containerfile a package builds from, relative to the repo root: its
# own Containerfile.package when it has one (so adding it leaves every other
# package's hash alone), else the shared packages/Containerfile.
set -euo pipefail
pkg="${1:?usage: containerfile-for.sh <package>}"
dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${dir}/${pkg}/Containerfile.package" ]; then
    echo "packages/${pkg}/Containerfile.package"
else
    echo "packages/Containerfile"
fi
