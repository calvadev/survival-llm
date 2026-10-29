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
on the fork and upload all three assets there. Note the app still reads update.json from the upstream
Pages URL (`SURVIVAL_LLM_UPDATES` in app/server.py) — that is an open follow-up. If upstream write
access is ever restored, decide with the user whether to move publishing back before changing URLs again.
