---
name: Releases publish on the fork
description: GitHub releases and update.json for Survival LLM are published to calvadev/survival-llm (the user's fork), not the upstream anonnerdfrenzy repo.
---

Releases, `docs/update.json` URLs, and the README download link all point at
`github.com/calvadev/survival-llm` (a fork of `anonnerdfrenzy/survival-llm`), and GitHub Pages for the
fork serves `docs/` from main at `calvadev.github.io/survival-llm/`.

**Why:** the workspace has no write access to the upstream repo (the owner's account is not reachable
from here); the user said on 2026-10-28 to "publish on the fork, not the upstream."

**How to apply:** `packaging/make_update.py` already emits fork URLs. When cutting a release, create it
on the fork and upload all three assets there. The app reads both update.json and the library-pack
manifest from the fork's Pages site. Exception: the ~10 GB of library pack zips are hosted only on the
upstream repo's v0.1.0 release, so the part URLs in docs/library-packs.json intentionally point upstream
(explained by its top-level "note", which republishing with make_packs.py drops) and download_stats.py
queries both repos. Moving the packs to the fork awaits the permanent-home decision. If upstream write
access is ever restored, decide with the user whether to move publishing back before changing URLs again.
