"""Write docs/update.json, which tells installed copies of the app that a new version is out.

Usage: python3 packaging/make_update.py "What's new, one item" ["another item" ...]
Run after packaging/build.sh, once all three release files are uploaded to the GitHub release named after
packaging/VERSION (v<version>). It then runs packaging/check_update.py itself, every time, so the download
URLs are confirmed to resolve without relying on anyone's memory; only when that passes, commit docs/ and
publish it with packaging/publish.sh, which runs the check once more and refuses to push on failure.
That default check reads headers only, so after it this script also runs the --full check, which
downloads each file and verifies its SHA-256 — mandatory once per release, so a corrupted upload is
caught rather than shipped. A passed --full is recorded, so publish.sh's own --full run skips the
downloads for an unchanged update.json.
The app downloads the zip for its system from
the release, checks it against the size and SHA-256 here, and replaces itself with it. Linux installs update
manually: the app reads the "linux" entry to say a newer release is out and to link to the archive, nothing more.
"""
import datetime
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import repo  # noqa: E402  the one place the GitHub repo URLs are named (packaging/repo.json)

RELEASES = repo.RELEASES

version = open(os.path.join(HERE, "VERSION")).read().strip()
update = {"version": version, "date": datetime.date.today().isoformat(), "notes": sys.argv[1:]}
for key, name in (("mac", "Survival-LLM-mac.zip"), ("windows", "Survival-LLM-windows.zip"),
                  ("linux", "Survival-LLM-linux.tar.gz")):
    path = os.path.join(REPO, "dist", name)
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 24):
            digest.update(chunk)
    update[key] = {"url": f"{RELEASES}/v{version}/{name}", "bytes": os.path.getsize(path), "sha256": digest.hexdigest()}
with open(os.path.join(REPO, "docs", "update.json"), "w") as f:
    json.dump(update, f, indent=1)
print(json.dumps(update, indent=1))

# The check runs here, every time, not when remembered: a skipped check is how a dead link ships.
# It needs the release files live on GitHub (see the docstring), so it runs last, after writing.
# check_repo.py runs first: it is offline, and it confirms the spots that keep their own hardcoded
# repo URL (the app, the download page) still agree with packaging/repo.json, so a release never
# ships an app whose update feed points somewhere else than the release it is cut from.
print("checking every repo link agrees with packaging/repo.json...", flush=True)
if subprocess.run([sys.executable, os.path.join(HERE, "check_repo.py")]).returncode:
    sys.exit("FAIL the repo link check failed; fix the links before packaging/publish.sh will publish docs/")
print("checking the download URLs just written...", flush=True)
if subprocess.run([sys.executable, os.path.join(HERE, "check_update.py")]).returncode:
    sys.exit("FAIL docs/update.json is written but its check failed; fix the links before packaging/publish.sh will publish docs/")

# Headers cannot catch a corrupted upload (right size, wrong bytes) — only downloading the files can.
# So the full check runs here too, every release, not when remembered; a passed run records the
# update.json it verified (see check_update.py), so this costs the download once per release, and
# publish.sh's own --full run before pushing then skips straight past the downloads.
print("downloading each release file and verifying its SHA-256...", flush=True)
if subprocess.run([sys.executable, os.path.join(HERE, "check_update.py"), "--full"]).returncode:
    sys.exit("FAIL the full download check failed; fix the release files before packaging/publish.sh will publish docs/")
