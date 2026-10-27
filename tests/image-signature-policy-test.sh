#!/usr/bin/env bash
# The RP6 image must only be accepted with a sigstore signature from the key
# shipped in the image; any other image keeps the existing behaviour.

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
system = root / "system_files"
policy = json.loads((system / "etc/containers/policy.json").read_text())
docker = policy["transports"]["docker"]


def scopes(reference):
    """containers-policy.json(5) lookup order for a docker reference."""
    repo = reference.split("@", 1)[0]
    last = repo.rsplit("/", 1)[-1]
    if ":" in last:
        yield repo
        repo = repo[: repo.rfind(":")]
    yield repo
    parts = repo.split("/")
    for i in range(len(parts) - 1, 0, -1):
        yield "/".join(parts[:i])
    yield ""


def requirements(reference):
    for scope in scopes(reference):
        if scope in docker:
            return docker[scope]
    return policy["default"]


rp6 = "ghcr.io/unjordi/armada-rp6"
pub = system / "etc/pki/containers/armada-rp6.pub"
assert pub.is_file(), f"missing {pub}"

for ref in (f"{rp6}:latest", f"{rp6}:20261020.ac8e232", f"{rp6}@sha256:deadbeef"):
    reqs = requirements(ref)
    types = [r["type"] for r in reqs]
    assert "insecureAcceptAnything" not in types, f"{ref} accepted unsigned: {reqs}"
    assert types == ["sigstoreSigned"], f"{ref}: unexpected requirements {reqs}"
    req = reqs[0]
    assert req.get("keyPath") == "/etc/pki/containers/armada-rp6.pub", req
    assert req["signedIdentity"] == {"type": "matchRepository"}, req

# Other images are not affected by this rule.
other = requirements("ghcr.io/unjordi/something-else:latest")
assert [r["type"] for r in other] == ["insecureAcceptAnything"], other

# Without sigstore attachments the signature is never fetched and every pull fails.
sigstore = (system / "etc/containers/registries.d/ghcr-armada.yaml").read_text()
assert f"  {rp6}:\n    use-sigstore-attachments: true" in sigstore, sigstore
PY

echo "image-signature-policy-test: OK"
