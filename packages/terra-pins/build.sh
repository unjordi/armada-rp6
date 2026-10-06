#!/usr/bin/bash
# Downloads the pinned Terra RPMs and checks each sha256. Runs only when this
# package's hash changes (a pin was bumped); the image build never talks to Terra.
set -euo pipefail

base=${TERRA_PINS_BASE:-https://repos.fyralabs.com/terra44}
rm -rf out
mkdir -p out
while read -r file sha; do
    [[ -z "${file}" || "${file}" == \#* ]] && continue
    curl -fsSL --retry 10 --retry-all-errors --retry-delay 30 -o "out/${file}" "${base}/${file}" \
        || { echo "[terra-pins] cannot download ${base}/${file}" >&2; exit 1; }
    echo "${sha}  out/${file}" | sha256sum -c --quiet - \
        || { echo "[terra-pins] sha256 mismatch for ${file}; Terra replaced it, re-pin it" >&2; exit 1; }
done < pins.txt
ls -l out
