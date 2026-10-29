"""Check docs/library-packs.json before users find out the hard way: it must be valid JSON, carry
every field the app itself requires, and every pack part URL must resolve.

Usage: python3 packaging/check_packs.py
packaging/publish.sh and .github/workflows/publish-docs.yml run this before docs/ goes to GitHub Pages,
so a hand-edit that breaks the pack list (invalid JSON, a field the app's valid_packs() requires gone
or the wrong type, a malformed sha256, a dead or wrong-sized part URL) fails the publish instead of
shipping a manifest the app would reject -- leaving fresh installs with no library packs to download.
Unlike docs/update.json there is no --full download check: the parts total ~10 GB, far too slow for a
publish gate, so this asks each URL for its headers only (no download) and fails if it does not answer
200, reports no size, or its size disagrees with the recorded bytes. Part sha256 values are verified
against the real bytes at install time by the app itself; here they are only checked for shape.
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

SHA256_HEX = re.compile(r"[0-9a-f]{64}")


def validate(manifest):
    """Structural problems in the manifest: every field app/server.py's valid_packs() requires,
    plus the sha256 hex format the app matches before it downloads a part. A manifest that fails
    here would be ignored or refused by the app even with every URL alive."""
    problems = []
    packs = manifest.get("packs") if isinstance(manifest, dict) else None
    if not isinstance(packs, list) or not packs:
        return ["docs/library-packs.json has no non-empty 'packs' list"]
    for pack in packs:
        if not isinstance(pack, dict):
            problems.append("a pack is not an object")
            continue
        pack_id = pack.get("id")
        where = f"pack {pack_id!r}" if isinstance(pack_id, str) else "a pack"
        if not isinstance(pack_id, str) or not pack_id:
            problems.append(f"{where}: no valid 'id'")
        if not isinstance(pack.get("label"), str):
            problems.append(f"{where}: no valid 'label' (the app refuses packs without one)")
        if not isinstance(pack.get("gb"), (int, float)) or isinstance(pack.get("gb"), bool):
            problems.append(f"{where}: no valid 'gb' (the app refuses packs without one)")
        if not isinstance(pack.get("version", ""), str):
            problems.append(f"{where}: 'version' is not a string")
        if not isinstance(pack.get("install_bytes", 0), int):
            problems.append(f"{where}: 'install_bytes' is not an integer")
        parts = pack.get("parts")
        if not isinstance(parts, list) or not parts:
            problems.append(f"{where}: no non-empty 'parts' list")
            continue
        for part in parts:
            if not isinstance(part, dict):
                problems.append(f"{where}: a part is not an object")
                continue
            url = part.get("url")
            at = url if isinstance(url, str) else f"{where}: a part"
            if not isinstance(url, str) or not url:
                problems.append(f"{at}: no valid 'url'")
            if not isinstance(part.get("bytes"), int) or part.get("bytes", 0) <= 0:
                problems.append(f"{at}: no valid 'bytes' recorded")
            if not SHA256_HEX.fullmatch(str(part.get("sha256", ""))):
                problems.append(f"{at}: 'sha256' is not 64 hex characters")
    return problems


def check_url(part):
    """Header-only live check for one part URL, after validate() has cleared its shape."""
    url, size = part["url"], part["bytes"]
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as got:
            status, served = got.status, got.headers.get("Content-Length")
    except Exception as e:
        return [f"{url}: no 200 answer ({e})"]
    problems = []
    if status != 200:
        problems.append(f"{url}: HTTP {status}")
    if served is None:
        problems.append(f"{url}: server reported no size, cannot compare with the manifest's {size}")
    elif int(served) != size:
        problems.append(f"{url}: serves {served} bytes, the manifest says {size}")
    return problems


def main():
    packs_path = os.path.join(REPO, "docs", "library-packs.json")
    try:
        with open(packs_path) as f:
            manifest = json.load(f)
    except Exception as e:
        print(f"FAIL docs/library-packs.json is not valid JSON ({e})")
        sys.exit(1)
    problems = validate(manifest)
    total_parts = 0
    if not problems:
        # Only hit the network once the manifest's shape is known good; validate() guarantees
        # the fields check_url() reads.
        for pack in manifest["packs"]:
            total_parts += len(pack["parts"])
            for part in pack["parts"]:
                problems += check_url(part)
    for p in problems:
        print(f"FAIL {p}")
    if problems:
        sys.exit(1)
    print(f"PASS docs/library-packs.json is valid and all {total_parts} part URLs resolve")


if __name__ == "__main__":
    main()
