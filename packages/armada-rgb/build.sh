#!/usr/bin/bash
# Runs inside the builder container. See ../build-local.sh for the contract.
#
# The tarball's top-level directory must stay `work`: armada-rgb.spec unpacks it
# with `%autosetup -n work`.
set -euxo pipefail

NAME=armada-rgb

rm -rf out
mkdir -p out

cat >/etc/rpm/macros.armada <<EOF
%_buildhost armada-builder
%packager Armada
%vendor Armada
EOF

dnf -y install --skip-unavailable \
  rpm-build rpmdevtools dnf-plugins-core \
  util-linux tar gzip
dnf -y builddep "${NAME}.spec"
rpmdev-setuptree

# screen_sync (src/effects.rs) captures through `runuser -u USER --` because the
# plain runuser PAM stack has no pam_systemd, so a capture every few seconds
# does not open a logind session each time. Fail the build if that changes.
test -f /etc/pam.d/runuser || { echo "[armada-rgb] /etc/pam.d/runuser missing; cannot verify screen_sync's PAM assumption" >&2; exit 1; }
if grep -q pam_systemd /etc/pam.d/runuser; then
  echo "[armada-rgb] /etc/pam.d/runuser includes pam_systemd; screen_sync captures would open a logind session each" >&2
  exit 1
fi

cp "${NAME}.spec" ~/rpmbuild/SPECS/
tar -C / \
  --exclude=work/out \
  --exclude=work/target \
  -czf ~/rpmbuild/SOURCES/${NAME}.tar.gz \
  work

rpmbuild -bb ~/rpmbuild/SPECS/${NAME}.spec

cp ~/rpmbuild/RPMS/aarch64/*.rpm /work/out/
