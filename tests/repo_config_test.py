"""The repo-link gate (packaging/check_repo.py) must catch every way the hardcoded repo URLs can
drift from packaging/repo.json: a wrong download URL in update.json, a pack part on another repo,
the download page's REPO constant, the app's feed URLs, a stray README link. Offline; the real tree
is copied to a temp folder and one spot is broken at a time.

Usage: python3 tests/repo_config_test.py"""
import io
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "packaging"))
import check_repo  # noqa: E402
import repo  # noqa: E402

FAILS = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  -> {detail}"))
    if not ok:
        FAILS.append(name)


# The files the gate reads, copied from the real tree so the passing case is the shipped one.
WATCHED = [os.path.join("docs", "update.json"), os.path.join("docs", "library-packs.json"),
           os.path.join("docs", "index.html"), os.path.join("app", "server.py"), "README.md"]


def run_gate(mutate=None):
    """Run check_repo.main() on a temp copy of the watched files, with mutate(path, text) -> text
    applied to one of them. Returns (exit_code, output)."""
    root = tempfile.mkdtemp()
    old_root = check_repo.ROOT
    try:
        for rel in WATCHED:
            dest = os.path.join(root, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            text = open(os.path.join(BASE, rel)).read()
            if mutate:
                text = mutate(rel, text)
            with open(dest, "w") as f:
                f.write(text)
        check_repo.ROOT = root
        out = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(out):
            try:
                check_repo.main()
            except SystemExit as e:
                code = e.code or 0
        return code, out.getvalue()
    finally:
        check_repo.ROOT = old_root
        shutil.rmtree(root)


def break_one(target, old, new):
    def mutate(rel, text):
        return text.replace(old, new) if rel == target else text
    return mutate


code, out = run_gate()
check("the shipped tree passes", code == 0, out)

OTHER = "https://github.com/someone-else/survival-llm"

code, out = run_gate(break_one(os.path.join("docs", "update.json"), repo.RELEASES + "/", OTHER + "/releases/download/"))
check("update.json download URLs on another repo fail", code == 1 and "update.json" in out, out)

code, out = run_gate(break_one(os.path.join("docs", "library-packs.json"),
                               repo.PACKS_RELEASES + "/", OTHER + "/releases/download/"))
check("pack part URLs on another repo fail", code == 1 and "library-packs.json" in out, out)

code, out = run_gate(break_one(os.path.join("docs", "index.html"), f'const REPO = "{repo.REPO}"',
                               f'const REPO = "{OTHER}"'))
check("download page REPO constant on another repo fails", code == 1 and "index.html" in out, out)

code, out = run_gate(break_one(os.path.join("app", "server.py"), f'"{repo.UPDATES_URL}"',
                               f'"{OTHER}/update.json"'))
check("app UPDATES_URL pointing elsewhere fails", code == 1 and "UPDATES_URL" in out, out)

code, out = run_gate(break_one(os.path.join("app", "server.py"), f'"{repo.PACKS_MANIFEST_URL}"',
                               f'"{OTHER}/library-packs.json"'))
check("app MANIFEST_URL pointing elsewhere fails", code == 1 and "MANIFEST_URL" in out, out)

code, out = run_gate(break_one("README.md", repo.REPO, OTHER))
check("README links to another repo fail", code == 1 and "README.md" in out, out)

# make_packs.py must refuse a --base-url outside repo.json's packs repo, before zipping anything.
env = dict(os.environ)
result = subprocess.run([sys.executable, os.path.join(BASE, "packaging", "make_packs.py"),
                         "--base-url", OTHER + "/releases/download/v9.9.9", "lite=/tmp/none"],
                        capture_output=True, text=True, env=env)
check("make_packs.py refuses a --base-url outside repo.json's packs repo",
      result.returncode != 0 and "repo.json" in (result.stdout + result.stderr),
      result.stdout + result.stderr)

# --release TAG replaces the typed-out URL: it must be a bare tag, and it cannot mix with --base-url.
result = subprocess.run([sys.executable, os.path.join(BASE, "packaging", "make_packs.py"),
                         "--release", "v9.9.9", "--base-url", repo.PACKS_RELEASES + "/v9.9.9",
                         "lite=/tmp/none"],
                        capture_output=True, text=True, env=env)
check("make_packs.py refuses --release and --base-url together",
      result.returncode != 0 and "not both" in (result.stdout + result.stderr),
      result.stdout + result.stderr)

result = subprocess.run([sys.executable, os.path.join(BASE, "packaging", "make_packs.py"),
                         "--release", repo.PACKS_RELEASES + "/v9.9.9", "lite=/tmp/none"],
                        capture_output=True, text=True, env=env)
check("make_packs.py refuses a --release that is a URL, not a tag",
      result.returncode != 0 and "bare release tag" in (result.stdout + result.stderr),
      result.stdout + result.stderr)

result = subprocess.run([sys.executable, os.path.join(BASE, "packaging", "make_packs.py"),
                         "lite=/tmp/none"],
                        capture_output=True, text=True, env=env)
check("make_packs.py refuses to run without --release or --base-url",
      result.returncode != 0 and "--release" in (result.stdout + result.stderr),
      result.stdout + result.stderr)

# The derived URLs follow from repo.json: Pages host is the repo owner's.
owner, name = repo.REPO.split("/")[-2:]
check("derived Pages URL follows repo.json",
      repo.PAGES == f"https://{owner}.github.io/{name}" and repo.UPDATES_URL.startswith(repo.PAGES)
      and repo.PACKS_MANIFEST_URL.startswith(repo.PAGES),
      f"{repo.PAGES} {repo.UPDATES_URL} {repo.PACKS_MANIFEST_URL}")

sys.exit(1 if FAILS else 0)
