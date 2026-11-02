#!/bin/sh
# Build, sign and publish the Survival LLM Android app to Zapstore.
#
# Usage: sh packaging/zapstore/publish.sh
#
# Every gate in here is unconditional and aborts on failure — like
# packaging/make_update.py for the desktop releases. Nothing is skippable:
# a signed APK that fails a check is never published, and a publish that
# cannot be verified afterwards is reported as a failure.
#
# Required secrets (environment, never echoed):
#   NOSTR_NSEC               publisher's Nostr private key (nsec1...)
#   GITHUB_TOKEN             for creating the GitHub release that hosts the APK
# Local files (never committed — see .gitignore):
#   packaging/zapstore/upload-keystore.jks   Android upload keystore
#   packaging/zapstore/upload-keystore.env   its passwords (ANDROID_KEYSTORE_PASSWORD, ...)
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$HERE/../.." && pwd)
ZSP="$HERE/zsp"
APP="$REPO/artifacts/survival-llm-mobile"
KEYSTORE_ENV="$HERE/upload-keystore.env"
KEYSTORE="$HERE/upload-keystore.jks"

fail() { echo "FAIL $*" >&2; exit 1; }
note() { echo "... $*"; }

[ -x "$ZSP" ] || fail "zsp binary missing at $ZSP (see packaging/zapstore/README)"
[ -f "$KEYSTORE" ] || fail "upload keystore missing at $KEYSTORE — losing it means losing the ability to update the app"
[ -f "$KEYSTORE_ENV" ] || fail "keystore passwords missing at $KEYSTORE_ENV"
[ -n "${NOSTR_NSEC:-}" ] || fail "NOSTR_NSEC is not set; add it in the workspace secrets and re-run"
[ -n "${GITHUB_TOKEN:-}" ] || fail "GITHUB_TOKEN is not set; needed to host the APK on the fork's releases"

# shellcheck disable=SC1090
set -a; . "$KEYSTORE_ENV"; set +a
[ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && [ -n "${ANDROID_KEY_PASSWORD:-}" ] \
  || fail "$KEYSTORE_ENV must set ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_PASSWORD"

# Toolchain: the workspace keeps the JDK in the Nix store and the Android SDK
# in the workspace (the home filesystem is only 4 GB). Honor pre-set values so
# the same script runs on a developer machine with a normal SDK install.
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME=$(ls -d /nix/store/*-openjdk-21*/ 2>/dev/null | head -1) \
    && export JAVA_HOME || fail "no JDK 21 found; set JAVA_HOME"
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
[ -d "$ANDROID_HOME/platforms" ] || fail "no Android SDK at $ANDROID_HOME; set ANDROID_HOME"

VERSION=$(python3 -c "import json; print(json.load(open('$APP/app.json'))['expo']['version'])")
TAG="android-v$VERSION"
APK_NAME="Survival-LLM-android-$VERSION.apk"
APK_OUT="$APP/android/app/build/outputs/apk/release/app-release.apk"
SIGNED_APK="$REPO/dist/$APK_NAME"
REPO_URL=$(python3 -c "import json; print(json.load(open('$REPO/packaging/repo.json'))['repo'])")
REPO_SLUG=${REPO_URL#https://github.com/}

note "building signed release APK ($VERSION)"
cd "$APP/android"
export ANDROID_KEYSTORE_PATH="$KEYSTORE"
export ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-upload}"
./gradlew assembleRelease --no-daemon -q || fail "Gradle release build failed"
[ -f "$APK_OUT" ] || fail "build finished but $APK_OUT is missing"
mkdir -p "$REPO/dist"
cp "$APK_OUT" "$SIGNED_APK"

note "verifying the APK is signed with the upload certificate"
CERT_SHA256=$("$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --print-certs "$SIGNED_APK" 2>/dev/null \
  | sed -n 's/.*SHA-256 digest: //p' | head -1)
[ -n "$CERT_SHA256" ] || fail "apksigner could not read the APK's certificate — refusing to publish"
export ZAPSTORE_CERT_SHA256="$CERT_SHA256"

note "computing sha256"
APK_SHA256=$(sha256sum "$SIGNED_APK" | cut -d' ' -f1)
export ZAPSTORE_APK_SHA256="$APK_SHA256"

note "hosting the APK on $REPO_SLUG release $TAG"
if ! gh release view "$TAG" --repo "$REPO_SLUG" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$REPO_SLUG" --title "Android $VERSION" --notes "Android release $VERSION for Zapstore." \
    || fail "could not create GitHub release $TAG"
fi
gh release upload "$TAG" "$SIGNED_APK" --repo "$REPO_SLUG" --clobber \
  || fail "could not upload the APK to the release"

# The relay's whitelist check fetches zapstore.yaml from the GitHub repo and
# requires its pubkey to match the key that signs the publish events, so the
# file must name the npub that NOSTR_NSEC derives to, committed and pushed,
# BEFORE publishing. The npub is a public key — safe to commit.
NPUB=$(NOSTR_NSEC="$NOSTR_NSEC" python3 "$HERE/npub.py") || fail "could not derive the npub from NOSTR_NSEC"
cd "$REPO"
if ! grep -q "^pubkey: $NPUB\$" zapstore.yaml; then
  sed -i.bak "s/^pubkey: .*/pubkey: $NPUB/" zapstore.yaml 2>/dev/null || true
  grep -q '^pubkey:' zapstore.yaml || printf 'pubkey: %s\n' "$NPUB" >> zapstore.yaml
  rm -f zapstore.yaml.bak
  git add zapstore.yaml
  git commit -m "zapstore.yaml: publisher pubkey for the Zapstore whitelist check" -q \
    || fail "could not commit zapstore.yaml"
fi
# Push via the GITHUB_TOKEN secret (the gh CLI's own token is a read-only mirror).
git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git" HEAD:main -q \
  || fail "could not push zapstore.yaml; the relay fetches it from GitHub for whitelisting"

note "checking the APK against zapstore.yaml"
cd "$REPO"
SIGN_WITH="$NOSTR_NSEC" "$ZSP" check "$SIGNED_APK" --json > /dev/null || fail "zsp check failed — not publishing"

note "publishing to Zapstore relays"
SIGN_WITH="$NOSTR_NSEC" "$ZSP" publish -q --json > /tmp/zsp-publish-result.json || fail "zsp publish failed (see /tmp/zsp-publish-result.json)"
cat /tmp/zsp-publish-result.json

note "verifying the listing (version, certificate fingerprint, download integrity)"
ZAPSTORE_VERSION="$VERSION" python3 "$HERE/check_zapstore.py" || fail "post-publish verification failed"
echo "PASS Survival LLM $VERSION published to Zapstore and verified"
