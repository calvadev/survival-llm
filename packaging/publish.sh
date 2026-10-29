#!/usr/bin/env bash
# Publish docs/ (GitHub Pages), the push that tells installed copies a new version is out.
# The download check runs here, first, every time: if docs/update.json's links fail it, the push never
# happens, so an unchecked update notice cannot reach users. make_update.py runs the check when it writes
# update.json; this runs it again on exactly the committed update.json that is about to go out.
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

git push "$@"
