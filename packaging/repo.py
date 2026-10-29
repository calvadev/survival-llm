"""The one place the project's GitHub homes are named: packaging/repo.json.

Every download and update link derives from these two values, so moving the project to another
repository is a one-line edit here instead of a hunt through the app, the site and the tooling:
  repo        where app releases are published and whose GitHub Pages site serves docs/
              (update.json, library-packs.json, the download page)
  packs_repo  where the ~10 GB of library pack parts are hosted (they predate the fork; moving
              them is the "permanent home for releases" decision, tracked separately)

Derived values used across the tooling:
  RELEASES / PACKS_RELEASES  the releases/download base URL of each repo
  PAGES                      the GitHub Pages base URL of repo (https://<owner>.github.io/<name>)
  UPDATES_URL / PACKS_MANIFEST_URL  where the app reads update.json and library-packs.json

The app itself (app/server.py) and the download page (docs/index.html) ship to users and cannot
import this file, so their copies of these URLs stay hardcoded; packaging/check_repo.py is the
publish-time gate that refuses to let them drift from this file.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(HERE, "repo.json")) as f:
    _cfg = json.load(f)

REPO = _cfg["repo"].rstrip("/")
PACKS_REPO = _cfg["packs_repo"].rstrip("/")

for name, url in (("repo", REPO), ("packs_repo", PACKS_REPO)):
    parts = url.split("/")
    if len(parts) != 5 or parts[:3] != ["https:", "", "github.com"] or not parts[3] or not parts[4]:
        raise ValueError(f"packaging/repo.json: {name!r} must look like https://github.com/owner/name, got {url!r}")

RELEASES = REPO + "/releases/download"
PACKS_RELEASES = PACKS_REPO + "/releases/download"
PAGES = f"https://{REPO.split('/')[-2]}.github.io/{REPO.split('/')[-1]}"
UPDATES_URL = PAGES + "/update.json"
PACKS_MANIFEST_URL = PAGES + "/library-packs.json"
