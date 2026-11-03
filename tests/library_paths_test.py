"""Library indexes must not direct article reads outside the text folder. No downloads."""
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from library import search


class LibraryPathsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="library-paths-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.text = self.root / "text"
        self.text.mkdir()
        (self.text / "nested").mkdir()
        (self.text / "nested" / "article.txt").write_bytes(b"Article text")
        (self.root / "outside.txt").write_bytes(b"Outside text")
        (self.root / "text-other").mkdir()
        (self.root / "text-other" / "article.txt").write_bytes(b"Sibling text")
        self.database = self.root / "index.sqlite"
        with sqlite3.connect(self.database) as db:
            db.executescript("CREATE TABLE sources (id INTEGER); CREATE TABLE files (id INTEGER, path TEXT);")
        self.lib = search.Library(str(self.database))
        self.addCleanup(self.lib.db.close)
        patched = patch.object(search, "TEXT_DIR", str(self.text))
        patched.start()
        self.addCleanup(patched.stop)

    def read(self, path, offset=0, length=100):
        with sqlite3.connect(self.database) as db:
            db.execute("DELETE FROM files")
            db.execute("INSERT INTO files VALUES (?, ?)", (1, str(path)))
        return self.lib._read_bytes(1, offset, length)

    def symlink(self, path, target, directory=False):
        try:
            path.symlink_to(target, target_is_directory=directory)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"Symlinks unavailable: {exc}")

    def test_normal_nested_read_preserves_offset_and_length(self):
        self.assertEqual(self.read("nested/article.txt", 8, 4), b"text")

    def test_absolute_path_inside_text_folder_is_allowed(self):
        self.assertEqual(self.read(self.text / "nested" / "article.txt"), b"Article text")

    def test_parent_traversal_is_rejected(self):
        with self.assertRaises(ValueError):
            self.read("../outside.txt")

    def test_absolute_path_outside_text_folder_is_rejected(self):
        with self.assertRaises(ValueError):
            self.read(self.root / "outside.txt")

    def test_sibling_with_same_name_prefix_is_rejected(self):
        with self.assertRaises(ValueError):
            self.read("../text-other/article.txt")

    def test_symlink_to_outside_file_is_rejected(self):
        self.symlink(self.text / "link.txt", self.root / "outside.txt")
        with self.assertRaises(ValueError):
            self.read("link.txt")

    def test_symlink_to_outside_directory_is_rejected(self):
        self.symlink(self.text / "linked", self.root / "text-other", directory=True)
        with self.assertRaises(ValueError):
            self.read("linked/article.txt")

    def test_symlink_staying_inside_text_folder_is_allowed(self):
        self.symlink(self.text / "link.txt", self.text / "nested" / "article.txt")
        self.assertEqual(self.read("link.txt"), b"Article text")

    def test_symlinked_text_folder_is_allowed(self):
        alias = self.root / "text-alias"
        self.symlink(alias, self.text, directory=True)
        with patch.object(search, "TEXT_DIR", str(alias)):
            self.assertEqual(self.read("nested/article.txt"), b"Article text")


if __name__ == "__main__":
    unittest.main()
