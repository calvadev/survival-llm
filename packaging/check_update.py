"""Check docs/update.json before users find out the hard way: every download URL must resolve.

Usage: python3 packaging/check_update.py [--full]
packaging/make_update.py runs this itself at the end of every release; run it by hand to re-check later
(e.g. right before docs/ is published to GitHub Pages), so a bad link is caught before users receive it.
For each platform entry
this asks the URL for its headers (no download) and fails if it does not answer 200, reports no size,
or its size disagrees with the recorded bytes. When dist/ still holds the built files, their SHA-256
is checked against the recorded one too; with dist/ gone that half is skipped and noted.
Pass --full to download each release file and verify its SHA-256 against update.json, so a corrupted
upload (right size, wrong bytes) is caught even after dist/ is gone. That is slow — hundreds of MB —
so it stays opt-in; the header-only default stays fast enough for make_update.py to run every release.
"""
import hashlib
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PLATFORMS = ("mac", "windows", "linux")


def check(url, size, sha256, dist_path):
    problems = []
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=30) as got:
            status, served = got.status, got.headers.get("Content-Length")
    except Exception as e:
        return [f"{url}: no 200 answer ({e})"]
    if status != 200:
        problems.append(f"{url}: HTTP {status}")
    if served is None:
        problems.append(f"{url}: server reported no size, cannot compare with update.json's {size}")
    elif int(served) != size:
        problems.append(f"{url}: serves {served} bytes, update.json says {size}")
    if os.path.exists(dist_path):
        digest = hashlib.sha256()
        with open(dist_path, "rb") as f:
            while chunk := f.read(1 << 24):
                digest.update(chunk)
        if digest.hexdigest() != sha256:
            problems.append(f"{os.path.basename(dist_path)}: sha256 on disk does not match update.json")
        if os.path.getsize(dist_path) != size:
            problems.append(f"{os.path.basename(dist_path)}: size on disk does not match update.json")
    else:
        print(f"note: {os.path.basename(dist_path)} not in dist/, sha256 left unchecked")
    return problems


def check_download(url, size, sha256):
    # Full check: pull the real bytes users would get and hash them. A corrupted upload can
    # still answer 200 with the right Content-Length, so headers alone cannot clear it.
    digest = hashlib.sha256()
    fetched = 0
    try:
        with urllib.request.urlopen(url, timeout=30) as got:
            if got.status != 200:
                return [f"{url}: HTTP {got.status}"]
            while chunk := got.read(1 << 24):
                digest.update(chunk)
                fetched += len(chunk)
    except Exception as e:
        return [f"{url}: download failed ({e})"]
    problems = []
    if fetched != size:
        problems.append(f"{url}: downloaded {fetched} bytes, update.json says {size}")
    if digest.hexdigest() != sha256:
        problems.append(f"{url}: downloaded sha256 does not match update.json")
    return problems


def main():
    full = "--full" in sys.argv[1:]
    update = json.load(open(os.path.join(REPO, "docs", "update.json")))
    problems = []
    for key in PLATFORMS:
        entry = update.get(key)
        if not entry:
            problems.append(f"docs/update.json has no {key!r} entry")
            continue
        if full:
            problems += check_download(entry["url"], entry["bytes"], entry["sha256"])
            continue
        name = entry["url"].rsplit("/", 1)[-1]
        problems += check(entry["url"], entry["bytes"], entry["sha256"],
                          os.path.join(REPO, "dist", name))
    for p in problems:
        print(f"FAIL {p}")
    if problems:
        sys.exit(1)
    if full:
        print(f"PASS all {len(PLATFORMS)} downloads in docs/update.json match their recorded sha256")
    else:
        print(f"PASS all {len(PLATFORMS)} download URLs in docs/update.json resolve")


if __name__ == "__main__":
    main()
