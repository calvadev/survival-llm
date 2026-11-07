---
name: Running a Zapstore publish from this workspace
description: How to run packaging/zapstore/publish.sh from an agent session — keep_alive, $HOME symlinks after restarts, expected stage timings.
---

Rules for running `packaging/zapstore/publish.sh` from an agent session:

- Always launch it as a background task with `keep_alive: true`. Without it, a workspace sleep/restart kills the pipeline mid-build; the task is reported "lost" and its log disappears. Rerunning is safe (Gradle/ninja caches persist, `gh release create` skips an existing tag) but costs the elapsed build time.
- After ANY workspace restart, recreate the `$HOME` symlinks before building — see home-fs-4gb.md; restarts wipe them and Gradle silently refills the 4 GB home disk.
- Expected timings: full native build ~1 h with the -j3 ninja shim (see build-memory-thrash.md); JS-only changes ~5–15 min. The slow stage is silent because the pipeline log is piped through `tail` — judge progress by process list and `dist/`, not the log.
- The pipeline's own zapstore.yaml push carries HEAD to GitHub main, so unpushed local commits ride along with a publish.

**Why:** the 0.1.2 publish died to a workspace sleep mid-build (Nov 2026), and the 0.1.1 build died to home-disk exhaustion after a restart wiped the symlinks.

**How to apply:** any session that runs the Android publish pipeline.
