"""Check that zapstore.yaml ships a listing with real screenshots.

Usage: python3 packaging/zapstore/check_zapstore_images.py

The listing once went out with an empty screenshots section and nothing
noticed until someone eyeballed the publish preview page. This gate makes
that class of mistake unpublishable. It is offline (no network, no pyyaml —
zapstore.yaml's images: block is parsed line by line) and fast;
packaging/zapstore/publish.sh runs it unconditionally before any publish,
and it can be run standalone at any time.

Every problem names the offending entry; any failure exits 1:
1. zapstore.yaml must have an images: list with at least one entry.
2. Every entry must point at a file that exists in the repo and is not empty.
3. Every entry must be a plausible phone screenshot: a real JPEG or PNG
   whose dimensions decode, in portrait orientation with a phone-like
   aspect ratio and sane minimum size.
"""
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
ZAPSTORE_YAML = os.path.join(REPO, "zapstore.yaml")

# Phone screenshots are portrait, from roughly 4:3 tablets (1.33) up to tall
# 21:9 phones (2.33), with a little slack on both ends.
MIN_ASPECT = 1.25
MAX_ASPECT = 2.75
MIN_WIDTH = 240
MIN_HEIGHT = 320


def parse_images(yaml_path):
    """Return (found_key, entries) for the images: block of zapstore.yaml.

    Entries are the '- path' lines directly under a top-level 'images:' key;
    parsing stops at the next top-level key. Values may be quoted.
    """
    entries = []
    found = False
    in_block = False
    with open(yaml_path) as f:
        for line in f:
            stripped = line.strip()
            if in_block:
                if stripped.startswith("- "):
                    value = stripped[2:].strip().strip("'\"")
                    if value:
                        entries.append(value)
                    continue
                if stripped and not line.startswith((" ", "\t")):
                    break  # next top-level key ends the block
                continue
            if stripped == "images:" or stripped.startswith("images: "):
                found = True
                inline = stripped[len("images:"):].strip()
                if inline.startswith("[") and inline.endswith("]"):
                    for item in inline[1:-1].split(","):
                        item = item.strip().strip("'\"")
                        if item:
                            entries.append(item)
                    break
                in_block = True
    return found, entries


def png_size(path):
    with open(path, "rb") as f:
        header = f.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", header[16:24])
    return width, height


def jpeg_size(path):
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if i + 4 > len(data):
            return None
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):  # baseline / extended / progressive SOF
            if i + 9 > len(data):
                return None
            height, width = struct.unpack(">HH", data[i + 5:i + 9])
            return width, height
        if length < 2:
            return None
        i += 2 + length
    return None


def image_size(path):
    """(width, height) of a JPEG or PNG, or None if it decodes as neither."""
    with open(path, "rb") as f:
        magic = f.read(8)
    if magic.startswith(b"\x89PNG"):
        return png_size(path)
    if magic.startswith(b"\xff\xd8"):
        return jpeg_size(path)
    return None


def main():
    problems = []

    if not os.path.isfile(ZAPSTORE_YAML):
        problems.append("zapstore.yaml is missing")
    else:
        found, entries = parse_images(ZAPSTORE_YAML)
        if not found:
            problems.append("zapstore.yaml has no 'images:' key — the listing would ship "
                            "with no screenshots")
        elif not entries:
            problems.append("zapstore.yaml has an empty 'images:' list — the listing would "
                            "ship with no screenshots")
        for entry in entries:
            if entry.startswith(("http://", "https://")):
                problems.append(f"images entry '{entry}' is a URL; screenshots must be local "
                                "files committed to the repo")
                continue
            path = os.path.normpath(os.path.join(REPO, entry))
            if not os.path.isfile(path):
                problems.append(f"images entry '{entry}' does not exist")
                continue
            size = os.path.getsize(path)
            if size == 0:
                problems.append(f"images entry '{entry}' is an empty file")
                continue
            dims = image_size(path)
            if dims is None:
                problems.append(f"images entry '{entry}' is not a decodable JPEG or PNG image")
                continue
            width, height = dims
            if height <= width:
                problems.append(f"images entry '{entry}' is {width}x{height} — not portrait, "
                                "so not a plausible phone screenshot")
                continue
            aspect = height / width
            if not (MIN_ASPECT <= aspect <= MAX_ASPECT):
                problems.append(f"images entry '{entry}' is {width}x{height} (aspect "
                                f"{aspect:.2f}) — outside the phone-screenshot range "
                                f"{MIN_ASPECT}–{MAX_ASPECT}")
                continue
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                problems.append(f"images entry '{entry}' is only {width}x{height} — too small "
                                "to be a real phone screenshot")

    for p in problems:
        print(f"FAIL {p}")
    if problems:
        sys.exit(1)
    print(f"PASS zapstore.yaml lists {len(entries)} screenshot(s), all present, non-empty "
          "and plausible phone images")


if __name__ == "__main__":
    main()
