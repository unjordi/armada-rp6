#!/usr/bin/env python3
"""List the firmware files the Retroid Pocket 6 hardware can load, out of those present in a root.

The hardware set comes from the RP6 device tree: every enabled node's `compatible` is matched against
modules.alias (of: and pci:), and those modules plus their dependencies are the RP6 drivers. A firmware
file is required when it matches:
  - a `firmware-name` in the device tree,
  - a `modinfo -F firmware` entry of an RP6 driver,
  - a firmware-like string inside an RP6 driver (most drivers build the name at runtime, e.g.
    "qca/hmtbtfw%02x.tlv", and never declare it); printf conversions become wildcards.
Matching broadly only keeps extra files, which is the safe direction for a pruning guard.

Usage: rp6-firmware-requerido.py [--root /] [--dtb qcom/qcs8550-retroidpocket-rp6.dtb]
Prints one path per line, relative to <root>/usr/lib/firmware, without the .xz/.zst suffix.
"""
import argparse
import fnmatch
import lzma
import os
import re
import struct
import subprocess
import sys

FW_EXT = r"(?:mbn|bin|fw|tlv|elf|jsn|mdt|b[0-9a-fA-F]{2,}|b%[0-9]*[xX]|ucode|dat|nvm)"
FW_STRING = re.compile(rb"[A-Za-z0-9_%./+-]{3,120}\." + FW_EXT.encode() + rb"(?![A-Za-z0-9_])")
PRINTF = re.compile(r"%[-#0 +]*[0-9]*(?:\.[0-9]+)?(?:hh|h|ll|l|z)?[diouxXsc]")


def fdt_nodes(blob):
    """Yield (path, {prop: bytes}) for every node of a flattened device tree."""
    magic, _, off_struct, off_strings = struct.unpack(">IIII", blob[:16])
    if magic != 0xD00DFEED:
        raise ValueError("not a flattened device tree")
    pos, stack, props = off_struct, [], None
    while True:
        (token,) = struct.unpack(">I", blob[pos:pos + 4])
        pos += 4
        if token == 1:  # BEGIN_NODE
            end = blob.index(b"\0", pos)
            stack.append(blob[pos:end].decode())
            pos = (end + 4) & ~3
            props = {}
            yield "/".join(stack) or "/", props
        elif token == 2:  # END_NODE
            stack.pop()
        elif token == 3:  # PROP
            length, nameoff = struct.unpack(">II", blob[pos:pos + 8])
            pos += 8
            name_end = blob.index(b"\0", off_strings + nameoff)
            props[blob[off_strings + nameoff:name_end].decode()] = blob[pos:pos + length]
            pos = (pos + length + 3) & ~3
        elif token == 4:  # NOP
            continue
        elif token == 9:  # END
            return
        else:
            raise ValueError(f"bad FDT token {token} at {pos - 4}")


def stringlist(raw):
    return [s.decode(errors="replace") for s in raw.rstrip(b"\0").split(b"\0") if s]


def dt_facts(dtb_path):
    compatibles, fw_names = set(), set()
    with open(dtb_path, "rb") as f:
        blob = f.read()
    # A node's props are filled after it is yielded, so walk the whole tree before reading them.
    for _, props in list(fdt_nodes(blob)):
        status = stringlist(props.get("status", b"okay\0"))
        if status and status[0] not in ("okay", "ok"):
            continue
        compatibles.update(stringlist(props.get("compatible", b"")))
        fw_names.update(stringlist(props.get("firmware-name", b"")))
    return compatibles, fw_names


def modules_for(compatibles, moddir):
    pci_ids = set()
    for c in compatibles:
        m = re.fullmatch(r"pci([0-9a-fA-F]{4}),([0-9a-fA-F]{4})", c)
        if m:
            pci_ids.add((m.group(1).upper(), m.group(2).upper()))
    mods = set()
    with open(os.path.join(moddir, "modules.alias")) as f:
        for line in f:
            parts = line.split()
            if len(parts) != 3 or parts[0] != "alias":
                continue
            pattern, mod = parts[1], parts[2]
            if pattern.startswith("of:"):
                for c in compatibles:
                    if fnmatch.fnmatchcase(f"of:NxTxC{c}", pattern) or fnmatch.fnmatchcase(f"of:NxTxC{c}Cx", pattern):
                        mods.add(mod)
                        break
            elif pattern.startswith("pci:"):
                for ven, dev in pci_ids:
                    if fnmatch.fnmatchcase(f"pci:v0000{ven}d0000{dev}sv0sd0bc0sc0i0", pattern):
                        mods.add(mod)
                        break
    return mods


def module_files(mods, moddir):
    """Resolve module names to files, adding every dependency from modules.dep."""
    deps, by_name = {}, {}
    with open(os.path.join(moddir, "modules.dep")) as f:
        for line in f:
            path, _, rest = line.partition(":")
            name = os.path.basename(path).split(".ko")[0].replace("-", "_")
            by_name[name] = path
            deps[path] = rest.split()
    todo = [by_name[m.replace("-", "_")] for m in mods if m.replace("-", "_") in by_name]
    seen = set()
    while todo:
        p = todo.pop()
        if p not in seen:
            seen.add(p)
            todo.extend(deps.get(p, []))
    return sorted(seen)


def module_bytes(path):
    with open(path, "rb") as f:
        data = f.read()
    if path.endswith(".xz"):
        return lzma.decompress(data)
    if path.endswith(".zst"):
        return subprocess.run(["zstd", "-dc", path], capture_output=True, check=True).stdout
    return data


def patterns_from_module(path, root, kver):
    pats = set()
    for s in FW_STRING.findall(module_bytes(path)):
        pats.add(PRINTF.sub("*", s.decode(errors="replace")))
    name = os.path.basename(path).split(".ko")[0]
    out = subprocess.run(["modinfo", "-b", root, "-k", kver, "-F", "firmware", name], capture_output=True, text=True)
    pats.update(line.strip() for line in out.stdout.splitlines() if line.strip())
    return pats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/")
    ap.add_argument("--dtb", default="qcom/qcs8550-retroidpocket-rp6.dtb")
    ap.add_argument("--explain", action="store_true", help="print 'file <- pattern' instead of bare paths")
    a = ap.parse_args()

    kvers = sorted(os.listdir(os.path.join(a.root, "usr/lib/modules")))
    if len(kvers) != 1:
        sys.exit(f"[rp6-firmware] expected one kernel in {a.root}/usr/lib/modules, found {kvers}")
    kver = kvers[0]
    moddir = os.path.join(a.root, "usr/lib/modules", kver)
    dtb = os.path.join(moddir, "dtb", a.dtb)
    if not os.path.isfile(dtb):
        sys.exit(f"[rp6-firmware] RP6 device tree not found: {dtb}")

    compatibles, fw_names = dt_facts(dtb)
    rp6_socs = {c.split(",", 1)[1] for c in compatibles if c.startswith("qcom,") and "-" not in c}
    with open(os.path.join(moddir, "modules.alias")) as f:
        alias_text = f.read()

    def other_soc(pat):
        """A driver string under qcom/<soc>/ for a SoC that is not the RP6's (the driver supports many)."""
        m = re.match(r"qcom/([^/*]+)/", pat)  # pat: a driver string or a firmware path
        return bool(m) and m.group(1) not in rp6_socs and f"Cqcom,{m.group(1)}-" in alias_text
    mods = modules_for(compatibles, moddir)
    if not mods:
        sys.exit("[rp6-firmware] no module matched the RP6 device tree; refusing to guess")

    patterns = {n: "device tree firmware-name" for n in fw_names}
    for path in module_files(mods, moddir):
        for p in patterns_from_module(os.path.join(moddir, path), a.root, kver):
            if not other_soc(p):
                patterns.setdefault(p, os.path.basename(path).split(".ko")[0])

    fwroot = os.path.join(a.root, "usr/lib/firmware")
    required = {}
    for dirpath, _, files in os.walk(fwroot):
        for fn in files:
            rel = os.path.relpath(os.path.join(dirpath, fn), fwroot)
            base = re.sub(r"\.(xz|zst)$", "", rel)
            full = os.path.join(dirpath, fn)
            if os.path.islink(full):
                # A board file that is a symlink into another SoC's directory (e.g. a reference board's topology
                # pointing at qcom/kaanapali/) belongs to that SoC, not to the RP6.
                target = os.path.relpath(os.path.realpath(full), os.path.realpath(fwroot))
                if other_soc(target):
                    continue
            for pat, why in patterns.items():
                if why != "device tree firmware-name" and other_soc(base):
                    continue  # a wildcard such as qcom/*/*-tplg.bin also reaches other SoCs' files
                # A bare name is looked up at the firmware root or one directory down (e.g. qcom/a740_sqe.fw).
                hit = (fnmatch.fnmatchcase(base, pat) if "/" in pat
                       else base.count("/") <= 1 and fnmatch.fnmatchcase(os.path.basename(base), pat))
                if hit:
                    required[base] = f"{why}: {pat}"
                    break
    for base in sorted(required):
        print(f"{base} <- {required[base]}" if a.explain else base)


if __name__ == "__main__":
    main()
