#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# The source server and tests need only Python's standard library. Desktop-only
# dependencies are installed by the Linux installer on the user's device.
# Never download models/library packs or enable a system service during a merge.
python3 -m compileall -q core.py memory.py app library packaging
python3 tests/run_all.py
echo "Post-merge checks passed. No hosted service or desktop setup is required."
