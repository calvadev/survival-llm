# Zapstore publishing

`publish.sh` builds, signs and publishes the Android app
(`artifacts/survival-llm-mobile/`) to Zapstore in one gated run — the Android
counterpart of `packaging/make_update.py` for desktop. Every check aborts the
publish; nothing is skippable.

```
sh packaging/zapstore/publish.sh
```

## Metadata-only refresh (text and screenshots)

To change the listing's description, screenshots, icon or other metadata in
`zapstore.yaml` **without** rebuilding or re-uploading the ~244 MB APK:

```
sh packaging/zapstore/publish.sh --metadata-only
```

Use this mode when the app itself has not changed and only the listing text or
images have. It reuses the already-published APK in `dist/`, and because
Zapstore refuses to republish an unchanged `version_code` without an explicit
flag, it runs `zsp publish --overwrite-release` for you.

The same gates apply, all mandatory: the local `zapstore.yaml` is committed
and pushed first (the relay fetches it from GitHub), the APK's versionName
must still match `app.json` (so a stale binary can never be slipped under new
metadata), `zsp check` runs before publishing, and `check_zapstore.py`
verifies the listing afterwards. The keystore is not needed — nothing is
re-signed. Never work around this flow by running `zsp publish
--overwrite-release` by hand; that bypasses every gate.

Use the full mode (no flag) for anything that changes the app binary: a
version bump, code changes, or dependency updates.

To cut a release, bump `expo.version` in
`artifacts/survival-llm-mobile/app.json` and write the CHANGELOG.md section —
those are the only edits. `publish.sh` stamps `android/app/build.gradle`
(Expo prebuild output, not committed) with the versionName and derives
versionCode as `major*10000 + minor*100 + patch`, so it rises monotonically on
its own as Zapstore requires; keep minor and patch below 100. After the build
it refuses to publish an APK whose versionName or versionCode disagrees with
app.json, and it refuses to publish a version with no CHANGELOG section.

Prerequisites (never committed, all covered by `.gitignore`):

- `zsp` — the Zapstore publisher binary (github.com/zapstore/zsp releases)
- `upload-keystore.jks` — the Android upload keystore. **Losing it means losing
  the ability to update the app**; keep a backup outside this checkout.
- `upload-keystore.env` — its passwords (`ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`), mode 600
- secrets: `NOSTR_NSEC` (publisher's Nostr key), `GITHUB_TOKEN` (release upload)

The flow: Gradle release build signed with the upload keystore → the APK is
verified with `apksigner` and hosted as a GitHub release asset on the fork
(tag `android-v<version>`) → `zsp check` → `zsp publish` (Nostr events signed
with `NOSTR_NSEC`, never echoed) → `check_zapstore.py` verifies the listing
serves the expected version, the upload certificate's SHA-256, and the exact
APK bytes that were published.

`npub.py` derives the publisher's npub from `NOSTR_NSEC` at publish time and
writes it into `zapstore.yaml`. The relay's whitelist check fetches
`zapstore.yaml` from GitHub and requires the committed pubkey to match the
signing key, so the real npub is committed (it is a public key).

## One-time certificate proof (first publish only)

The first publish with a new upload certificate fails with `proof_required`
until the interactive `zsp` wizard proves ownership once. Run `zsp` with no
arguments, in this directory, with `SIGN_WITH=$NOSTR_NSEC` set. The wizard's
final approval is not a terminal prompt: it serves a preview page on
localhost:17008 and waits for the page's "Approve publication" button. If the
publish ever fails `proof_required` again (new key, expired proof), re-run the
wizard the same way.
