#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# The source server and tests need only Python's standard library. Desktop-only
# dependencies are installed by the Linux installer on the user's device.
# Never download models/library packs or enable a system service during a merge.
# /tmp is a 4 GB tmpfs here and setup_test.py needs ~5 GB free, so put temp files
# on the workspace's large disk (.cache/ is git-ignored). linux_test.py doesn't
# follow TMPDIR: its installs must live outside the checkout, so it uses /tmp.
mkdir -p .cache/tmp
export TMPDIR="$PWD/.cache/tmp"
python3 -m compileall -q core.py memory.py app library packaging
python3 tests/run_all.py
echo "Post-merge checks passed. No hosted service or desktop setup is required."
