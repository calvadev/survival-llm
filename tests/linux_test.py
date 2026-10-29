"""Linux installer, browser launcher and safe Trash regressions; no model or library downloads."""
import importlib.util
import os
from pathlib import Path
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
            self.assertIsNone(server.platform_key())  # no Windows in-app updater on Linux
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
