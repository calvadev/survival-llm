#!/usr/bin/env python3
"""Install a browser-based Linux desktop app for the current user, without sudo.

Run from the checkout: python3 packaging/install_linux.py
System Python is left untouched; pure-Python dependencies live beside the app.
"""
import argparse
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

SOURCE = Path(__file__).resolve().parent.parent


def desktop_quote(value):
    # Desktop Entry Exec quoting is not shell quoting; percent introduces field codes.
    value = str(value).replace("%", "%%")
    for char in ("\\", '"', "`", "$"):
        value = value.replace(char, "\\" + char)
    return '"' + value + '"'


def install(prefix, *, skip_dependencies=False):
    prefix = Path(prefix).expanduser().resolve()
    target = prefix / "share" / "survival-llm"
    if target == SOURCE or target in SOURCE.parents or SOURCE in target.parents:
        raise ValueError("Choose an install prefix outside the source checkout.")
    if sys.version_info < (3, 10):
        raise RuntimeError("Survival LLM needs Python 3.10 or newer.")
    if any(char in str(prefix) for char in ("\n", "\r", "\x00")):
        raise ValueError("The install prefix must not contain line breaks or null characters.")
    if not skip_dependencies:
        missing = [name for name in ("xdg-open", "gio") if not shutil.which(name)]
        if missing:
            raise RuntimeError("Missing desktop tools: " + ", ".join(missing) +
                               ". On Omarchy/Arch: sudo pacman -S python python-pip xdg-utils glib2")
        subprocess.run([sys.executable, "-m", "pip", "--version"], check=True, capture_output=True)
    target.mkdir(parents=True, exist_ok=True)
    if not skip_dependencies:
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-user", "--upgrade", "--target", str(target / "deps"),
                        "-r", str(SOURCE / "packaging" / "requirements-linux.txt")], check=True)
    # Copy only runtime source, never a person's settings, library, models or build caches.
    for name in ("app", "library"):
        shutil.copytree(SOURCE / name, target / name, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("core.py", "memory.py", "LICENSE", "SOURCES.md"):
        shutil.copy2(SOURCE / name, target / name)
    shutil.copy2(SOURCE / "packaging" / "VERSION", target / "version.txt")
    launcher = prefix / "bin" / "survival-llm"
    launcher.parent.mkdir(parents=True, exist_ok=True)
    # Absolute paths work from app menus, even when ~/.local/bin is not on PATH.
    launcher.write_text(
        "#!/bin/sh\n"
        f"export PYTHONPATH={shlex.quote(str(target / 'deps'))}${{PYTHONPATH:+:$PYTHONPATH}}\n"
        f"exec {shlex.quote(sys.executable)} {shlex.quote(str(target / 'app' / 'server.py'))} --browser \"$@\"\n",
        encoding="utf-8")
    launcher.chmod(0o755)
    applications = prefix / "share" / "applications"
    applications.mkdir(parents=True, exist_ok=True)
    desktop = applications / "survival-llm.desktop"
    desktop.write_text(
        "[Desktop Entry]\nType=Application\nName=Survival LLM\n"
        "Comment=Offline AI assistant and survival library\n"
        f"Exec={desktop_quote(launcher)}\n"
        "Icon=help-browser\nTerminal=false\nCategories=Education;Utility;\nStartupNotify=false\n",
        encoding="utf-8")
    print(f"Installed Survival LLM at {target}")
    print(f"Open Survival LLM from your app menu, or run: {shlex.quote(str(launcher))}")
    print("Closing the browser tab does not stop the local server. To stop it, use the Quit button.")
    if not shutil.which("ollama"):
        print("Ollama is not installed. On Omarchy: Menu > Install > AI > Ollama.")
    print("In the app, download an AI model and library while online; then it works offline.")
    return target, launcher, desktop


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", default=str(Path.home() / ".local"),
                        help="Install location (default: ~/.local; custom prefixes may not appear in your app menu)")
    parser.add_argument("--skip-dependencies", action="store_true",
                        help="Offline/source testing only: dependencies must already be available")
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("This installer is for Linux. Use the existing Mac or Windows downloads instead.")
    try:
        install(args.prefix, skip_dependencies=args.skip_dependencies)
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"Installation failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
