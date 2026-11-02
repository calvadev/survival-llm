#!/usr/bin/env bash
# Publish docs/ (GitHub Pages), the push that tells installed copies a new version is out.
# The download check runs here, first, every time: if docs/update.json's links fail it, the push never
# happens, so an unchecked update notice cannot reach users. make_update.py runs the check when it writes
# update.json; this runs it again on exactly the committed update.json that is about to go out.
# The full SHA-256 check (slow: it downloads every release file) is mandatory here, the last gate
# before users see the notice; a passed run is recorded so it costs the download once per release.
# Any arguments are passed to git push (e.g. --dry-run to rehearse without publishing).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
cd "$REPO"

# docs/ publishes what is committed, not what is on disk. Refuse if they differ, so the check below
# covers the same update.json that users would get.
if ! git diff --quiet -- docs || ! git diff --cached --quiet -- docs || \
   [ -n "$(git ls-files --others --exclude-standard -- docs)" ]; then
  echo "FAIL docs/ has uncommitted changes; commit them first, so the check covers exactly what publishes" >&2
  exit 1
fi

echo "checking the update notice before it goes out..."
python3 "$HERE/check_update.py" || {
  echo "FAIL the download check did not pass; docs/ was not published" >&2
  exit 1
}

# Every download and update link derives from one setting (packaging/repo.json), but the app and the
# download page keep hardcoded copies that must agree with it. This offline check catches a repo move
# that updated only some of the spots.
echo "checking every repo link agrees with packaging/repo.json..."
python3 "$HERE/check_repo.py" || {
  echo "FAIL the repo link check did not pass; docs/ was not published" >&2
  exit 1
}

# update.json is not the only thing that can break on the site: a hand-edit that makes
# docs/library-packs.json invalid JSON or leaves a dead pack URL would ship just as silently,
# so the pack list is gated the same way, on the committed copy.
echo "checking the library pack list before it goes out..."
python3 "$HERE/check_packs.py" || {
  echo "FAIL the pack list check did not pass; docs/ was not published" >&2
  exit 1
}

# Headers cannot catch a corrupted upload (right size, wrong bytes) — only downloading the files can.
# So the full check is mandatory here, the last gate before users see the notice. make_update.py
# already ran it for this update.json and recorded that (packaging/.full-check, committed with docs/),
# so on the normal path this skips the downloads and costs nothing; it downloads only when update.json
# changed since the last passed full check.
python3 "$HERE/check_update.py" --full || {
  echo "FAIL the full download check did not pass; docs/ was not published" >&2
  exit 1
}

git push "$@"
