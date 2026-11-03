# Memory index

- [Repo URL single source of truth](repo-url-single-source.md) — packaging/repo.json names both repos; tooling derives URLs from it, hardcoded copies in shipped files are guarded by check_repo.py.

- [Releases publish on the fork](release-publishing-fork.md) — GitHub releases, update.json URLs, and README download links point at calvadev/survival-llm, not the upstream anonnerdfrenzy repo.
- [GitHub access from this workspace](github-access-quirks.md) — gh CLI token only covers Replit's read-only mirror; the GitHub integration's credentials are withheld from the agent sandbox; use the GITHUB_TOKEN secret for github.com writes.
- [Release gates must be mandatory](release-gates-mandatory.md) — release-flow checks run unconditionally and abort on failure; skippable prompts get rejected in review; record a passed-input marker for expensive checks.
- [Publish gates mirror the app's validation](gates-mirror-app-validation.md) — a gate checking fewer fields than the app's validator passes files the app refuses.
- [Home filesystem is only 4 GB](home-fs-4gb.md) — big toolchains (Android SDK, Gradle caches) belong in the 256 GB workspace, symlinked from $HOME.
- [Zapstore first-publish certificate proof](zapstore-proof-flow.md) — proof_required means run the interactive zsp wizard; its final approval is an HTTP POST to its preview server, not a terminal answer.
- [Expo preview screenshots come back black at first](expo-preview-screenshots.md) — retake until the body renders; fresh chat route renders blank on web (empty inverted FlatList).
- [Android version stamping](android-version-stamping.md) — android/ is gitignored prebuild output; app.json is the single version source, publish.sh stamps Gradle and derives versionCode from semver.
