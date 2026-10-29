#!/usr/bin/env python3
"""Build dist/Survival-LLM-linux.tar.gz: the runtime source plus the per-user installer.

Linux and Omarchy users download this archive from a release, extract it, and run
packaging/install_linux.py from the extracted folder; no Git or source checkout is needed.
The archive is reproducible: entries are sorted, and owners, permissions and timestamps are
fixed (SOURCE_DATE_EPOCH overrides the timestamp), so the same source builds the same file
on any machine. It carries only runtime files, never the library fetch/build scripts.

Usage: python3 packaging/make_linux_release.py [output.tar.gz]   (any Mac or Linux Python 3)
"""
import gzip
import hashlib
import os
from pathlib import Path
import sys
import tarfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
TOP = "Survival-LLM"  # the folder the archive extracts to

# The same runtime source build.sh's copy_app puts in the Mac and Windows downloads,
# plus the Linux installer and what it needs, laid out like the checkout so
# install_linux.py finds everything relative to itself.
FILES = (
    "core.py",
    "memory.py",
    "library/search.py",
    "library/passages.py",
    "library/myfiles.py",
    "app/server.py",
    "LICENSE",
    "README.md",
    "SOURCES.md",
    "packaging/install_linux.py",
    "packaging/requirements-linux.txt",
    "packaging/VERSION",
)


def members():
    """(archive path, source path or None for a directory) pairs, sorted for a stable order."""
    entries = {}
    for rel in sorted(FILES):
        source = REPO / rel
        if not source.is_file():
            raise SystemExit(f"Missing source file: {source}")
        arc = Path(TOP, rel)
        entries[arc.as_posix()] = source
        parent = arc.parent
        while parent.as_posix() != ".":
            entries.setdefault(parent.as_posix(), None)
            parent = parent.parent
    for static in sorted((REPO / "app" / "static").iterdir()):
        if static.is_file():
            entries[Path(TOP, "app", "static", static.name).as_posix()] = static
    return sorted(entries.items())


def build(output):
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    with open(output, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=epoch) as gz:
            with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
                for arcname, source in members():
                    info = tarfile.TarInfo(arcname)
                    info.mtime = epoch
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    if source is None:
                        info.type = tarfile.DIRTYPE
                        info.mode = 0o755
                        tar.addfile(info)
                    else:
                        info.size = source.stat().st_size
                        info.mode = 0o755 if os.access(source, os.X_OK) else 0o644
                        with open(source, "rb") as f:
                            tar.addfile(info, f)
    return output


def main():
    output = sys.argv[1] if len(sys.argv) > 1 else REPO / "dist" / "Survival-LLM-linux.tar.gz"
    build(output)
    digest = hashlib.sha256(Path(output).read_bytes()).hexdigest()
    size = Path(output).stat().st_size
    print(f"Wrote {output} ({size:,} bytes)")
    print(f"sha256: {digest}")


if __name__ == "__main__":
    main()
