# Zapstore publishing

`publish.sh` builds, signs and publishes the Android app
(`artifacts/survival-llm-mobile/`) to Zapstore in one gated run — the Android
counterpart of `packaging/make_update.py` for desktop. Every check aborts the
publish; nothing is skippable.

```
sh packaging/zapstore/publish.sh
```

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
writes it into `zapstore.yaml`; the committed `zapstore.yaml` keeps a
placeholder so the key never enters git.
