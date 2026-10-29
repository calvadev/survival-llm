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

No Replit run workflow is configured: the requested work is Linux installation support, not cloud hosting.
Do not expose the server publicly or weaken its Host/token checks to enable a hosted preview.
