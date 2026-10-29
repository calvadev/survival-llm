"""Write docs/update.json, which tells installed copies of the app that a new version is out.

Usage: python3 packaging/make_update.py "What's new, one item" ["another item" ...]
Run after packaging/build.sh, once all three release files are uploaded to the GitHub release named after
packaging/VERSION (v<version>). It then runs packaging/check_update.py itself, every time, so the download
URLs are confirmed to resolve without relying on anyone's memory; only when that passes, commit docs/ and
publish it with packaging/publish.sh, which runs the check once more and refuses to push on failure.
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
RELEASES = "https://github.com/calvadev/survival-llm/releases/download"

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
print("checking the download URLs just written...", flush=True)
if subprocess.run([sys.executable, os.path.join(HERE, "check_update.py")]).returncode:
    sys.exit("FAIL docs/update.json is written but its check failed; fix the links before packaging/publish.sh will publish docs/")
