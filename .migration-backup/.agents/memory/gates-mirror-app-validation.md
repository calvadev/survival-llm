---
name: Publish gates must mirror the app's own validation
description: Any check guarding a published file (update.json, library-packs.json) must enforce every field and format the app itself validates, or the gate passes files the app refuses.
---

# Publish gates must mirror the app's own validation

A publish-gate checker that validates fewer fields than the app does gives false confidence: it reports PASS and the workflow deploys a manifest the app then rejects, leaving users with a silently broken feature (e.g. fresh installs with no library packs).

**Why:** A pack-list gate that checked URLs but not the `label`/`gb` fields or the sha256 hex format that `app/server.py`'s `valid_packs()` enforces would pass a manifest the app then ignores — fresh installs see no library packs while the gate reports PASS.

**How to apply:** When writing or extending a check in `packaging/` for a file the app downloads, first find the app's own validator for that file (`valid_packs()`, `valid_update()`, the sha256 hex regex in `app/server.py`) and enforce at least the same fields, types, and formats in the gate. Add tests with mocked network responses for each rejected shape.
