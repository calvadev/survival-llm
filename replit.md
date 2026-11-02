# Project notes

Survival LLM is a local/offline Python desktop application, not a hosted service.
Keep the existing standard-library server and Mac/Windows packaging intact.

## Linux / Omarchy

- Install on a Linux desktop: `python3 packaging/install_linux.py` (without sudo).
- Launch: `~/.local/bin/survival-llm`, or the Survival LLM application-menu entry.
- Linux uses browser mode for Wayland/X11 compatibility; the server remains loopback-only.
- Ollama is installed/managed separately. Model and library downloads are chosen in the app.
- See README.md for Omarchy prerequisites, GPU options, updates and uninstall instructions.

## Development and verification

- Run from source: `python3 app/server.py --browser`.
- Without opening a browser: `python3 app/server.py --no-browser --port 5000`.
- Tests: `python3 tests/run_all.py` (no Ollama or library required).
- Installer tests: `python3 tests/linux_test.py`.
- Post-merge setup: `bash scripts/post-merge.sh` checks Python syntax and runs the tests.
  It deliberately does not install desktop dependencies, download models/libraries, or start services.
- In Replit, `/tmp` has only 4 GB; use `mkdir -p .cache/tmp` and
  `TMPDIR="$PWD/.cache/tmp" python3 tests/run_all.py` for the setup tests, which need 5 GB free.
  The post-merge script sets this automatically.

No Replit run workflow is configured: this is a local desktop app, not cloud hosting.
Do not expose the server publicly or weaken its Host/token checks to enable a hosted preview.

## Multi-artifact workspace

The pnpm workspace scaffold (`artifacts/api-server/`, `artifacts/mockup-sandbox/`,
`lib/*`, and the workspace package files) is retained for future work. It does not
replace or run the Python desktop product. The desktop app needs no JavaScript
build, generated API hooks, PostgreSQL database, or database migration.
Do not convert it to React or relocate its files: its packaging and tests rely
on the original root layout.
