---
name: Android version stamping
description: android/ is gitignored Expo prebuild output — version stamping lives in publish.sh, not build.gradle edits
---

`artifacts/survival-llm-mobile/android/` is gitignored Expo prebuild output. Edits to `android/app/build.gradle` are neither committed nor survive `expo prebuild`, so release-time values must be stamped by `packaging/zapstore/publish.sh`, not hand-edited into Gradle files.

**Why:** Task to make app.json the single version source first tried deriving versionName/versionCode inside build.gradle via Groovy; `git check-ignore` revealed the file never reaches git, making that approach un-reviewable and un-persistent.

**How to apply:** app.json `expo.version` is the single source; versionCode = major*10000 + minor*100 + patch (minor/patch must stay < 100). Any new release-time value that belongs in the native project should be stamped or gated in publish.sh, and verified from the built APK with aapt afterwards.
