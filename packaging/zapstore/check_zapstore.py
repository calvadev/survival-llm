"""Verify the Zapstore listing after publishing — the Android counterpart of
packaging/check_update.py.

Usage: ZAPSTORE_VERSION=x.y.z ZAPSTORE_CERT_SHA256=... ZAPSTORE_APK_SHA256=... \
         NOSTR_NSEC=... python3 packaging/zapstore/check_zapstore.py

Three gates, all mandatory; any failure exits 1:
1. The listing exists on the relay: `zsp check` (run with the publisher key)
   must find the published app and report the expected version.
2. The published APK's certificate fingerprint must equal the upload
   certificate's SHA-256, so nobody else's build can be served under the listing.
3. The APK bytes the listing serves (the GitHub release asset) must download
   and hash to the sha256 of the APK that was published — a corrupted upload
   is caught the way check_update.py --full catches one.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ZSP = os.path.join(HERE, "zsp")


def fail(problems):
    for p in problems:
        print(f"FAIL {p}")
    sys.exit(1)


def main():
    version = os.environ.get("ZAPSTORE_VERSION", "")
    cert = os.environ.get("ZAPSTORE_CERT_SHA256", "").lower().replace(":", "")
    apk_sha = os.environ.get("ZAPSTORE_APK_SHA256", "")
    nsec = os.environ.get("NOSTR_NSEC", "")
    for name, value in (("ZAPSTORE_VERSION", version), ("ZAPSTORE_CERT_SHA256", cert),
                        ("ZAPSTORE_APK_SHA256", apk_sha), ("NOSTR_NSEC", nsec)):
        if not value:
            sys.exit(f"{name} is not set; publish.sh sets all four before calling this check")

    repo_url = json.load(open(os.path.join(REPO, "packaging", "repo.json")))["repo"]
    slug = repo_url.removeprefix("https://github.com/")
    apk_url = f"{repo_url}/releases/download/android-v{version}/Survival-LLM-android-{version}.apk"

    problems = []

    # Gate 1+2: the relay knows the listing, at this version, with this certificate.
    env = dict(os.environ, SIGN_WITH=nsec)
    proc = subprocess.run([ZSP, "check", "--json"], cwd=REPO, env=env,
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        problems.append(f"zsp check failed: {proc.stderr.strip() or proc.stdout.strip()}")
    else:
        try:
            report = json.loads(proc.stdout)
        except json.JSONDecodeError:
            report = None
            problems.append("zsp check did not return JSON; cannot verify the listing")
        if report is not None:
            text = json.dumps(report)
            if version not in text:
                problems.append(f"the listing does not report version {version}")
            if cert not in text.lower():
                problems.append("the listing does not report the upload certificate's SHA-256")

    # Gate 3: the bytes the listing serves match what was published.
    digest = hashlib.sha256()
    fetched = 0
    try:
        req = urllib.request.Request(apk_url)
        with urllib.request.urlopen(req, timeout=60) as got:
            if got.status != 200:
                problems.append(f"{apk_url}: HTTP {got.status}")
            while chunk := got.read(1 << 24):
                digest.update(chunk)
                fetched += len(chunk)
    except Exception as e:
        problems.append(f"{apk_url}: download failed ({e})")
    if not problems and digest.hexdigest() != apk_sha:
        problems.append(f"{apk_url}: downloaded sha256 {digest.hexdigest()} != published {apk_sha}")

    if problems:
        fail(problems)
    print(f"PASS Zapstore listing serves Survival LLM {version} "
          f"(cert …{cert[-12:]}, {fetched} bytes, sha256 verified)")


if __name__ == "__main__":
    main()
