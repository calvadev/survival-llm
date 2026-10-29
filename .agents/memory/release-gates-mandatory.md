---
name: Release gates must be mandatory, not prompt-skippable
description: Safety checks in the release flow (packaging/) must run unconditionally; interactive prompts that can be declined get rejected in review.
---

Release-flow protections in this repo (packaging/make_update.py, packaging/publish.sh) must be mandatory gates that fail the release, not interactive prompts an operator can decline.

**Why:** A task that wired the full SHA-256 download check as a skippable `[Y/n]` prompt was rejected in completion review; only the unconditional version (with a `packaging/.full-check` marker recording the verified update.json hash, committed alongside docs/, so re-checks skip the download) passed.

**How to apply:** When adding a check to the release flow, run it unconditionally and make failure abort the release; if the check is expensive, record a passed-for-this-input marker rather than asking the operator.
