---
name: Android release builds swap-thrash with stock ninja parallelism
description: Release builds in this workspace exhaust the 8 GB RAM + 6 GB swap; ninja is shimmed to -j3 to keep compiles from thrashing.
---

Running `publish.sh` (Gradle `assembleRelease`) with ninja's default job count (cores+2 = 6) runs ~6 parallel llama.cpp compiles at ~800 MB RSS each. That exhausts the workspace's 8 GB RAM, fills all 6 GB of swap, and the build crawls (~1s CPU per 20s wall per clang) without ever failing loudly.

**Why:** Observed during the 0.1.1 release build (Nov 2026): swap 100% full, object-file count frozen for minutes, no OOM kill — just indefinite thrash. Killing and restarting with bounded jobs restored full compile speed.

**How to apply:** `$ANDROID_HOME/cmake/3.22.1/bin/ninja` is a shim that prepends `-j3` and execs `ninja.real` alongside it. Do not "restore" the stock binary; if the SDK is ever reinstalled, recreate the shim. If a build looks frozen, check `free -m` and swap first — thrash, not a hang, is the likely cause.
