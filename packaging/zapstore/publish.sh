#!/bin/sh
# Build, sign and publish the Survival LLM Android app to Zapstore.
#
# Usage: sh packaging/zapstore/publish.sh [--metadata-only]
#
# Default (full release): builds and signs a fresh APK, hosts it on GitHub,
# publishes it and verifies the listing.
#
# --metadata-only: refreshes the listing's text and screenshots from
# zapstore.yaml without rebuilding or re-uploading the APK. It reuses the
# already-published APK in dist/ and runs `zsp publish --overwrite-release`,
# which Zapstore requires for an unchanged version_code. Use it for a
# description tweak or new screenshots; never to slip a different binary
# under an existing version (the version check below refuses that).
#
# Every gate in here is unconditional and aborts on failure — like
# packaging/make_update.py for the desktop releases. Nothing is skippable:
# a signed APK that fails a check is never published, and a publish that
# cannot be verified afterwards is reported as a failure. Metadata-only mode
# keeps the same discipline: zsp check before, check_zapstore.py after.
#
# Required secrets (environment, never echoed):
#   NOSTR_NSEC               publisher's Nostr private key (nsec1...)
#   GITHUB_TOKEN             for the GitHub release / pushing zapstore.yaml
# Local files (never committed — see .gitignore):
#   packaging/zapstore/upload-keystore.jks   Android upload keystore (full releases)
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

MODE=full
case "${1:-}" in
  "") ;;
  --metadata-only) MODE=metadata ;;
  *) fail "unknown argument '$1' (usage: sh $0 [--metadata-only])" ;;
esac

[ -x "$ZSP" ] || fail "zsp binary missing at $ZSP (see packaging/zapstore/README)"
[ -n "${NOSTR_NSEC:-}" ] || fail "NOSTR_NSEC is not set; add it in the workspace secrets and re-run"
[ -n "${GITHUB_TOKEN:-}" ] || fail "GITHUB_TOKEN is not set; needed for the GitHub release and for pushing zapstore.yaml"

# Fail fast if the listing would go out without screenshots (no images: list,
# a listed file missing/empty, or an entry that is not a plausible phone
# screenshot). A listing without screenshots shipped once already; this gate
# runs before any build or network work so the mistake is cheap to fix.
note "checking the listing has screenshots"
python3 "$HERE/check_zapstore_images.py" || fail "zapstore.yaml screenshot check failed — not publishing"

if [ "$MODE" = full ]; then
  [ -f "$KEYSTORE" ] || fail "upload keystore missing at $KEYSTORE — losing it means losing the ability to update the app"
  [ -f "$KEYSTORE_ENV" ] || fail "keystore passwords missing at $KEYSTORE_ENV"
  # shellcheck disable=SC1090
  set -a; . "$KEYSTORE_ENV"; set +a
  [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && [ -n "${ANDROID_KEY_PASSWORD:-}" ] \
    || fail "$KEYSTORE_ENV must set ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_PASSWORD"
fi

# The workspace keeps the JDK in the Nix store. Both modes need java on PATH:
# full mode for Gradle, metadata-only for apksigner. Honor a pre-set JAVA_HOME
# so the same script runs on a developer machine with a normal JDK install.
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME=$(ls -d /nix/store/*-openjdk-21*/ 2>/dev/null | head -1) \
    && export JAVA_HOME || fail "no JDK 21 found; set JAVA_HOME"
fi
case ":$PATH:" in *":$JAVA_HOME/bin:"*) ;; *) PATH="$JAVA_HOME/bin:$PATH"; export PATH;; esac

# Toolchain: the workspace keeps the Android SDK in the workspace itself (the
# home filesystem is only 4 GB). Honor a pre-set ANDROID_HOME so the same
# script runs on a developer machine with a normal SDK install.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
if [ ! -d "$ANDROID_HOME/platforms" ] && [ -d "$REPO/.android-sdk/platforms" ]; then
  ANDROID_HOME="$REPO/.android-sdk"; export ANDROID_HOME
fi
[ -d "$ANDROID_HOME/platforms" ] || fail "no Android SDK at $ANDROID_HOME; set ANDROID_HOME"
BUILD_TOOLS="$ANDROID_HOME/build-tools/35.0.0"
[ -x "$BUILD_TOOLS/apksigner" ] || fail "apksigner missing at $BUILD_TOOLS"

VERSION=$(python3 -c "import json; print(json.load(open('$APP/app.json'))['expo']['version'])")
# app.json is the single place the version is set. versionCode derives from
# the semver as major*10000 + minor*100 + patch; the full-release path below
# stamps both into build.gradle and this same derivation verifies the built
# APK afterwards.
EXPECTED_CODE=$(python3 - "$VERSION" <<'EOF'
import sys
parts = sys.argv[1].split(".")
if len(parts) != 3 or not all(p.isdigit() for p in parts):
    sys.exit(f"app.json version {sys.argv[1]!r} must be MAJOR.MINOR.PATCH")
major, minor, patch = map(int, parts)
if minor >= 100 or patch >= 100:
    sys.exit("minor/patch >= 100 breaks versionCode derivation; bump the major version")
print(major * 10000 + minor * 100 + patch)
EOF
) || fail "${EXPECTED_CODE:-could not derive versionCode from app.json version $VERSION}"

# Release notes travel with the version: refuse to publish a version that has
# no CHANGELOG section (one of the three files releases used to need by hand;
# the notes themselves are still written by hand, but forgetting them is now
# caught here instead of after the fact).
grep -qxF "## $VERSION" "$APP/CHANGELOG.md" \
  || fail "no '## $VERSION' section in $APP/CHANGELOG.md — write the release notes first"
TAG="android-v$VERSION"
APK_NAME="Survival-LLM-android-$VERSION.apk"
APK_OUT="$APP/android/app/build/outputs/apk/release/app-release.apk"
SIGNED_APK="$REPO/dist/$APK_NAME"
REPO_URL=$(python3 -c "import json; print(json.load(open('$REPO/packaging/repo.json'))['repo'])")
REPO_SLUG=${REPO_URL#https://github.com/}

if [ "$MODE" = full ]; then
  # app.json is the single place the version is set. build.gradle is Expo
  # prebuild output (gitignored, regenerated by `expo prebuild`), so hand-edits
  # there neither persist nor belong in git — stamp versionName/versionCode
  # from app.json here instead. versionCode derives from the semver as
  # major*10000 + minor*100 + patch so it rises monotonically on its own, as
  # Zapstore and Android both require.
  GRADLE_FILE="$APP/android/app/build.gradle"
  note "stamping build.gradle with version $VERSION (versionCode $EXPECTED_CODE)"
  [ -f "$GRADLE_FILE" ] || fail "no build.gradle at $GRADLE_FILE — run expo prebuild first"
  sed -i.bak \
    -e "s/^\([[:space:]]*\)versionCode .*/\1versionCode $EXPECTED_CODE/" \
    -e "s/^\([[:space:]]*\)versionName .*/\1versionName \"$VERSION\"/" \
    "$GRADLE_FILE"
  rm -f "$GRADLE_FILE.bak"
  grep -q "versionCode $EXPECTED_CODE\$" "$GRADLE_FILE" \
    || fail "could not stamp versionCode $EXPECTED_CODE into $GRADLE_FILE"
  grep -q "versionName \"$VERSION\"\$" "$GRADLE_FILE" \
    || fail "could not stamp versionName $VERSION into $GRADLE_FILE"

  note "building signed release APK ($VERSION)"
  cd "$APP/android"
  export ANDROID_KEYSTORE_PATH="$KEYSTORE"
  export ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-upload}"
  ./gradlew assembleRelease --no-daemon -q || fail "Gradle release build failed"
  [ -f "$APK_OUT" ] || fail "build finished but $APK_OUT is missing"
  mkdir -p "$REPO/dist"
  cp "$APK_OUT" "$SIGNED_APK"
else
  note "metadata-only mode: reusing the published APK, no rebuild"
  [ -f "$SIGNED_APK" ] || fail "no APK at $SIGNED_APK — run a full publish (without --metadata-only) first"
fi

note "verifying the APK version matches app.json ($VERSION, versionCode $EXPECTED_CODE)"
APK_BADGING=$("$BUILD_TOOLS/aapt" dump badging "$SIGNED_APK" 2>/dev/null)
APK_VERSION=$(printf '%s\n' "$APK_BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)
[ -n "$APK_VERSION" ] || fail "aapt could not read the APK's versionName — refusing to publish"
[ "$APK_VERSION" = "$VERSION" ] \
  || fail "the APK in dist/ is version $APK_VERSION but app.json says $VERSION — refusing to publish mismatched metadata"
if [ "$MODE" = full ]; then
  # Full releases build from build.gradle, which derives versionCode from
  # app.json — verify that derivation survived into the APK. Metadata-only
  # mode skips this: it reuses an already-published APK, which may predate
  # the derivation (e.g. the hand-set versionCode 2 for 0.1.1).
  APK_CODE=$(printf '%s\n' "$APK_BADGING" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -1)
  [ -n "$APK_CODE" ] || fail "aapt could not read the APK's versionCode — refusing to publish"
  [ "$APK_CODE" = "$EXPECTED_CODE" ] \
    || fail "the APK's versionCode is $APK_CODE but app.json $VERSION derives $EXPECTED_CODE — check build.gradle's derivation"
fi

note "verifying the APK is signed with the upload certificate"
CERT_SHA256=$("$BUILD_TOOLS/apksigner" verify --print-certs "$SIGNED_APK" 2>/dev/null \
  | sed -n 's/.*SHA-256 digest: //p' | head -1)
[ -n "$CERT_SHA256" ] || fail "apksigner could not read the APK's certificate — refusing to publish"
export ZAPSTORE_CERT_SHA256="$CERT_SHA256"

note "computing sha256"
APK_SHA256=$(sha256sum "$SIGNED_APK" | cut -d' ' -f1)
export ZAPSTORE_APK_SHA256="$APK_SHA256"

if [ "$MODE" = full ]; then
  note "hosting the APK on $REPO_SLUG release $TAG"
  if ! gh release view "$TAG" --repo "$REPO_SLUG" >/dev/null 2>&1; then
    gh release create "$TAG" --repo "$REPO_SLUG" --title "Android $VERSION" --notes "Android release $VERSION for Zapstore." \
      || fail "could not create GitHub release $TAG"
  fi
  gh release upload "$TAG" "$SIGNED_APK" --repo "$REPO_SLUG" --clobber \
    || fail "could not upload the APK to the release"
fi

# The relay's whitelist check fetches zapstore.yaml from the GitHub repo and
# requires its pubkey to match the key that signs the publish events, so the
# file must name the npub that NOSTR_NSEC derives to, committed and pushed,
# BEFORE publishing. The npub is a public key — safe to commit. This applies
# to metadata-only refreshes too: the relay serves the listing text and
# screenshots from the pushed zapstore.yaml, so any local edit must be
# committed and pushed here first.
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
if [ -n "$(git status --porcelain zapstore.yaml)" ]; then
  git add zapstore.yaml
  git commit -m "zapstore.yaml: refresh Zapstore listing metadata" -q \
    || fail "could not commit the zapstore.yaml metadata changes"
fi
# Push via the GITHUB_TOKEN secret (the gh CLI's own token is a read-only mirror).
git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO_SLUG}.git" HEAD:main -q \
  || fail "could not push zapstore.yaml; the relay fetches it from GitHub for whitelisting"

note "checking the APK against zapstore.yaml"
cd "$REPO"
SIGN_WITH="$NOSTR_NSEC" "$ZSP" check "$SIGNED_APK" --json > /dev/null || fail "zsp check failed — not publishing"

note "publishing to Zapstore relays"
if [ "$MODE" = metadata ]; then
  SIGN_WITH="$NOSTR_NSEC" "$ZSP" publish -q --json --overwrite-release > /tmp/zsp-publish-result.json \
    || fail "zsp publish --overwrite-release failed (see /tmp/zsp-publish-result.json)"
else
  SIGN_WITH="$NOSTR_NSEC" "$ZSP" publish -q --json > /tmp/zsp-publish-result.json || fail "zsp publish failed (see /tmp/zsp-publish-result.json)"
fi
cat /tmp/zsp-publish-result.json

note "verifying the listing (version, certificate fingerprint, download integrity)"
ZAPSTORE_VERSION="$VERSION" python3 "$HERE/check_zapstore.py" || fail "post-publish verification failed"
if [ "$MODE" = metadata ]; then
  echo "PASS Survival LLM $VERSION listing metadata republished to Zapstore and verified"
else
  echo "PASS Survival LLM $VERSION published to Zapstore and verified"
fi
