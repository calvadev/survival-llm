---
name: Home filesystem is only 4 GB
description: /home/runner is a 4 GB overlay that fills fast; big toolchains (Android SDK, Gradle caches) must live in the 256 GB workspace and be symlinked.
---

The container's home filesystem (`/home/runner`, overlay) is capped at 4 GB and was 100% full after installing the Android SDK + a Gradle cache there. `/home/runner/workspace` (`/dev/vdb`) has 256 GB.

**Why:** a Gradle release build failed with "No space left on device" while the workspace showed 251 GB free — the cache was on the wrong filesystem.

**How to apply:** put anything large under the workspace (e.g. `.android-sdk/`, `.gradle-home/`, both git-ignored) and symlink from `$HOME`. Watch `df -h /home/runner` when installs or builds fail with space errors.
