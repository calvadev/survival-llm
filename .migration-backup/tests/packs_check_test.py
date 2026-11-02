"""The publish gate for the pack list (packaging/check_packs.py) must refuse a manifest the app
itself would refuse: missing label/gb, a malformed sha256, a dead part URL, a wrong served size.
HEAD responses are faked; no network, no real pack files.

Usage: .venv/bin/python tests/packs_check_test.py"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packaging"))
import check_packs  # noqa: E402

FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))
    if not ok:
        FAILS.append(name)


class FakeResponse:
    def __init__(self, status=200, size=None):
        self.status = status
        self.headers = {"Content-Length": None if size is None else str(size)}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


GOOD_PART = {"url": "https://example.test/library-lite.zip.000", "bytes": 1303588795,
             "sha256": "60aac5c9170bb11186c7caa6750d8655943340130e646c0bf3e53b5a202cfc24"}


def good_manifest():
    return {"packs": [{"id": "lite", "label": "Essentials (1.3 GB)", "gb": 1.3,
                       "articles": 497236, "version": "2026-10-24", "install_bytes": 4447747645,
                       "parts": [dict(GOOD_PART)]}]}


def run_gate(manifest_text, head):
    """Run check_packs.main() against manifest_text written as docs/library-packs.json in a temp
    repo, with head(url) faking the HEAD responses. Returns (exit_code, output)."""
    repo = tempfile.mkdtemp()
    old_repo, old_urlopen = check_packs.REPO, urllib.request.urlopen
    try:
        os.makedirs(os.path.join(repo, "docs"))
        with open(os.path.join(repo, "docs", "library-packs.json"), "w") as f:
            f.write(manifest_text)
        check_packs.REPO = repo

        def fake_urlopen(request, timeout=0):
            url = request.full_url if hasattr(request, "full_url") else request
            return head(url)
        urllib.request.urlopen = fake_urlopen
        out = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(out):
            try:
                check_packs.main()
            except SystemExit as e:
                code = e.code or 0
        return code, out.getvalue()
    finally:
        check_packs.REPO = old_repo
        urllib.request.urlopen = old_urlopen
        shutil.rmtree(repo)


def head_ok(url):
    return FakeResponse(200, GOOD_PART["bytes"])


code, out = run_gate(json.dumps(good_manifest()), head_ok)
check("valid manifest with resolving URLs passes", code == 0 and "PASS" in out, out)

for field in ("label", "gb"):
    manifest = good_manifest()
    del manifest["packs"][0][field]
    code, out = run_gate(json.dumps(manifest), head_ok)
    check(f"missing {field!r} fails even with URLs alive", code == 1 and f"'{field}'" in out, out)

manifest = good_manifest()
manifest["packs"][0]["gb"] = "1.3 GB"
code, out = run_gate(json.dumps(manifest), head_ok)
check("gb of the wrong type fails", code == 1 and "'gb'" in out, out)

manifest = good_manifest()
manifest["packs"][0]["install_bytes"] = None
code, out = run_gate(json.dumps(manifest), head_ok)
check("install_bytes of the wrong type fails", code == 1 and "'install_bytes'" in out, out)

for bad in ("z" * 64, "60aac5c9", "60AAC5C9170BB11186C7CAA6750D8655943340130E646C0BF3E53B5A202CFC24"):
    manifest = good_manifest()
    manifest["packs"][0]["parts"][0]["sha256"] = bad
    code, out = run_gate(json.dumps(manifest), head_ok)
    check(f"malformed sha256 {bad[:12]}... fails", code == 1 and "'sha256'" in out, out)

code, out = run_gate("{broken json", head_ok)
check("invalid JSON fails before any URL is checked", code == 1 and "not valid JSON" in out, out)


def head_dead(url):
    raise urllib.error.HTTPError(url, 404, "Not Found", None, None)


code, out = run_gate(json.dumps(good_manifest()), head_dead)
check("dead part URL fails", code == 1 and "no 200 answer" in out, out)

code, out = run_gate(json.dumps(good_manifest()), lambda url: FakeResponse(200, GOOD_PART["bytes"] + 1))
check("wrong served size fails", code == 1 and "bytes, the manifest says" in out, out)

code, out = run_gate(json.dumps(good_manifest()), lambda url: FakeResponse(200, None))
check("server reporting no size fails", code == 1 and "no size" in out, out)

code, out = run_gate(json.dumps(good_manifest()), lambda url: FakeResponse(503, GOOD_PART["bytes"]))
check("non-200 status fails", code == 1 and "HTTP 503" in out, out)

print(f"{'FAIL' if FAILS else 'PASS'}: {len(FAILS)} failing checks" if FAILS else "all checks passed")
sys.exit(1 if FAILS else 0)
