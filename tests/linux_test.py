"""Linux installer, browser launcher and safe Trash regressions; no model or library downloads."""
import importlib.util
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("install_linux", ROOT / "packaging" / "install_linux.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


@unittest.skipUnless(shutil.which("bash"), "copy_app parity needs bash")
class ReleaseParityTests(unittest.TestCase):
    """The Linux archive carries the same runtime files as build.sh's Mac/Windows downloads."""

    INSTALLER_ONLY = {"packaging/install_linux.py", "packaging/requirements-linux.txt",
                      "packaging/VERSION"}

    def copy_app_files(self, tmp):
        """Relative paths build.sh's copy_app puts in a Mac or Windows download."""
        script = (ROOT / "packaging" / "build.sh").read_text()
        body = script.split("copy_app() {", 1)[1].split("\n}", 1)[0]
        dest = Path(tmp) / "copied"
        subprocess.run(["bash", "-ec",
                        f"REPO={shlex.quote(str(ROOT))} HERE={shlex.quote(str(ROOT / 'packaging'))}"
                        " VERSION=test\n"
                        f"copy_app() {{{body}\n}}\n"
                        'copy_app "$1"', "bash", str(dest)],
                       check=True, capture_output=True, text=True)
        return {p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()}

    def test_archive_matches_copy_app(self):
        import tarfile
        spec = importlib.util.spec_from_file_location(
            "make_linux_release", ROOT / "packaging" / "make_linux_release.py")
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "Survival-LLM-linux.tar.gz"
            release.build(archive)
            with tarfile.open(archive) as tar:
                archive_files = {m.name.removeprefix("Survival-LLM/")
                                 for m in tar.getmembers() if m.isfile()}
            archive_files -= self.INSTALLER_ONLY
            # version.txt is not archived: install_linux.py writes it from packaging/VERSION.
            downloads = self.copy_app_files(tmp) - {"version.txt"}
            self.assertEqual(archive_files, downloads)


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux desktop integration")
class LinuxTests(unittest.TestCase):
    def test_installs_runtime_and_launches_from_another_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Exercise shell and Desktop Entry escaping, not just simple home-folder paths.
            prefix = Path(tmp) / 'A space $and "quote" %prefix'
            target, launcher, desktop = installer.install(prefix, skip_dependencies=True)
            self.assertTrue((target / "app" / "static" / "index.html").is_file())
            self.assertTrue((target / "library" / "search.py").is_file())
            self.assertEqual((target / "version.txt").read_text(), (ROOT / "packaging" / "VERSION").read_text())
            self.assertFalse((target / "tests").exists())
            self.assertTrue(os.access(launcher, os.X_OK))
            self.assertIn("Terminal=false", desktop.read_text())
            self.assertIn("%%prefix", desktop.read_text())
            self.assertIn('\\"quote\\"', desktop.read_text())
            # A fake interpreter records arguments, avoiding any browser or real server.
            fake = Path(tmp) / "python"
            fake.write_text('#!/bin/sh\nprintf "%s\\n" "$PYTHONPATH" "$@"\n')
            fake.chmod(0o755)
            with patch.object(installer.sys, "executable", str(fake)):
                installer.install(prefix, skip_dependencies=True)
            result = subprocess.run([str(launcher), "--no-browser", "--port", "5123"],
                                    cwd="/tmp", capture_output=True, text=True, check=True)
            lines = result.stdout.splitlines()
            self.assertTrue(lines[0].startswith(str(target / "deps")))
            self.assertEqual(lines[1:], [str(target / "app" / "server.py"), "--browser",
                                        "--no-browser", "--port", "5123"])

    def test_release_archive_installs_without_checkout(self):
        import tarfile
        spec = importlib.util.spec_from_file_location(
            "make_linux_release", ROOT / "packaging" / "make_linux_release.py")
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "Survival-LLM-linux.tar.gz"
            release.build(archive)
            with tarfile.open(archive) as tar:
                names = tar.getnames()
                tar.extractall(Path(tmp) / "extracted", filter="data")
            self.assertIn("Survival-LLM/packaging/install_linux.py", names)
            self.assertIn("Survival-LLM/packaging/requirements-linux.txt", names)
            self.assertFalse(any("__pycache__" in n or "fetch_" in n for n in names))
            # Install from the extracted archive, not the checkout, into a temporary prefix.
            extracted = Path(tmp) / "extracted" / "Survival-LLM"
            spec = importlib.util.spec_from_file_location(
                "installer_from_archive", extracted / "packaging" / "install_linux.py")
            from_archive = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(from_archive)
            target, launcher, _ = from_archive.install(Path(tmp) / "prefix", skip_dependencies=True)
            self.assertTrue(str(target).startswith(str(Path(tmp) / "prefix")))
            self.assertEqual((target / "version.txt").read_text(),
                             (extracted / "packaging" / "VERSION").read_text())
            self.assertIn(str(target / "deps"), launcher.read_text())
            self.assertNotIn(str(ROOT), launcher.read_text())
            # The installed copy stands alone once the extracted folder is gone.
            shutil.rmtree(extracted)
            script = subprocess.run(
                [sys.executable, "-c",
                 "import pathlib, py_compile; "
                 "py_compile.compile('app/server.py', doraise=True); "
                 "py_compile.compile('core.py', doraise=True); "
                 "py_compile.compile('memory.py', doraise=True)"],
                cwd=target, capture_output=True, text=True)
            self.assertEqual(script.returncode, 0, script.stderr)

    def test_update_notice_points_to_release_archive(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, {"SURVIVAL_LLM_APP_DIR": tmp}):
            from app import server
            archive = {"url": "https://example.com/Survival-LLM-linux.tar.gz", "bytes": 12_000_000_000,
                       "sha256": "ab" * 32}
            published = {"version": "999.0", "date": "2026-10-29", "notes": ["a fix"], "linux": archive}
            state = {"data": published, "checked": 123.0, "error": None}
            with patch.object(server, "updates", state):
                self.assertTrue(server.valid_update(published))
                self.assertEqual(server.newer_app()["version"], "999.0")
                report = server.update_report()
            notice = report["app"]
            self.assertEqual(notice["url"], archive["url"])  # the notice links straight to the archive
            self.assertIn("install_linux.py", notice["blocker"])  # and explains the manual install
            # An update.json as old releases wrote it (no "linux" entry) shows no notice on Linux.
            with patch.object(server, "updates", {**state, "data": {"version": "999.0", "notes": []}}):
                self.assertIsNone(server.newer_app())
                self.assertIsNone(server.update_report()["app"])
            # A broken "linux" entry must not reach running copies as a notice.
            self.assertFalse(server.valid_update({**published, "linux": {"url": "ftp://x", "bytes": 1,
                                                                         "sha256": "ab" * 32}}))
            # Nothing newer published: no notice either.
            with patch.object(server, "updates", {**state, "data": {**published, "version": server.VERSION}}):
                self.assertIsNone(server.newer_app())

    def test_dependencies_stay_private(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(installer.shutil, "which", return_value="/usr/bin/tool"), \
                patch.object(installer.subprocess, "run") as run:
            target, _, _ = installer.install(tmp)
            args = run.call_args_list[-1].args[0]
            self.assertIn("--target", args)
            self.assertEqual(args[args.index("--target") + 1], str(target / "deps"))
            self.assertNotIn("--break-system-packages", args)

    def test_missing_desktop_tools_fail_before_copying(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(installer.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "glib2"):
                installer.install(tmp)
            self.assertFalse((Path(tmp) / "share").exists())

    def test_refuses_installing_into_checkout(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            installer.install(ROOT, skip_dependencies=True)

    def test_linux_models_and_trash(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.dict(os.environ, {"SURVIVAL_LLM_APP_DIR": tmp}):
            from app import server
            self.assertEqual(server.system_key(), "win")
            self.assertEqual(server.platform_key(), "linux")  # update.json's "linux" entry drives the notice
            self.assertIn("install_linux.py", server.update_blocker())
            with patch.object(server, "ram_gb", return_value=32), \
                    patch.object(server, "disk_free_gb", return_value=100):
                catalog = server.machine_catalog([])
            self.assertTrue(catalog)
            self.assertTrue(any(row["recommended"] for row in catalog))
            self.assertTrue(all("-mlx" not in row["model"] and "-nvfp4" not in row["model"] for row in catalog))
            path = Path(tmp) / "important.txt"
            path.write_text("keep this")
            with patch.object(server.shutil, "which", return_value=None):
                with self.assertRaisesRegex(OSError, "not been deleted"):
                    server.to_trash(str(path))
            self.assertEqual(path.read_text(), "keep this")
            with patch.object(server.shutil, "which", return_value="/usr/bin/gio"), \
                    patch.object(server.subprocess, "run") as run:
                server.to_trash(str(path))
                self.assertEqual(run.call_args.args[0], ["gio", "trash", str(path)])
            with patch.object(server.shutil, "which", return_value="/usr/bin/gio"), \
                    patch.object(server.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "gio")):
                with self.assertRaises(subprocess.CalledProcessError):
                    server.to_trash(str(path))
            self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
