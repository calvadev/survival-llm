---
name: Repo URL single source of truth
description: packaging/repo.json is the one place the GitHub repo URLs are set; hardcoded copies elsewhere are guarded by an offline gate
---

`packaging/repo.json` names both GitHub repos: `repo` (fork: app releases + Pages site) and
`packs_repo` (upstream: library pack parts). `packaging/repo.py` derives RELEASES, PAGES,
UPDATES_URL, PACKS_MANIFEST_URL from it.

**Why:** the fork migration had to hand-edit five spots and missed the download page; a partial
repo move shipped once already.

**How to apply:** any code that needs a repo/releases/Pages URL imports `packaging/repo.py` —
never hardcode. Spots that must stay hardcoded because they ship to users as-is (app/server.py's
default feed URLs, docs/index.html's `const REPO`, the committed docs/*.json) are verified
against repo.json by the offline gate `packaging/check_repo.py`, which runs in publish.sh,
make_update.py, and the publish-docs GitHub workflow. `make_packs.py` refuses a `--base-url`
outside `packs_repo`. If a repo moves, edit repo.json only and let the gate find any straggler.
