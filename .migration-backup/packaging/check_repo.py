"""Check that the hardcoded repo URLs agree with the one place they are set: packaging/repo.json.

Usage: python3 packaging/check_repo.py
The repo URL lives once in packaging/repo.json (read through packaging/repo.py), but several spots
must keep their own hardcoded copy because they ship to users or are served as static files:
  - app/server.py        default UPDATES_URL / MANIFEST_URL (the app cannot import packaging/)
  - docs/index.html      the download page's REPO constant (a static file, no build step)
  - docs/update.json     download URLs written by make_update.py
  - docs/library-packs.json  pack part URLs written by make_packs.py
  - README.md            release and source links
A repo move that updates only some of these is exactly the mistake that shipped once already, so
this gate compares all of them against repo.json and fails on any disagreement. It is offline
(no network) and fast; packaging/publish.sh and .github/workflows/publish-docs.yml run it before
docs/ goes to GitHub Pages, and make_update.py runs it as part of cutting a release.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import repo  # noqa: E402

GITHUB_REPO = re.compile(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")


def read(path):
    with open(os.path.join(ROOT, path)) as f:
        return f.read()


def check_update_json():
    """Every platform download URL must sit under repo.json's releases base."""
    problems = []
    try:
        update = json.loads(read(os.path.join("docs", "update.json")))
    except Exception as e:
        return [f"docs/update.json is not valid JSON ({e})"]
    for key in ("mac", "windows", "linux"):
        entry = update.get(key)
        url = entry.get("url") if isinstance(entry, dict) else None
        if not isinstance(url, str):
            problems.append(f"docs/update.json has no {key!r} download URL")
        elif not url.startswith(repo.RELEASES + "/"):
            problems.append(f"docs/update.json {key!r} URL is {url}, expected it under {repo.RELEASES}/ "
                            "(packaging/repo.json)")
    return problems


def check_packs_json():
    """Every pack part URL must sit under repo.json's packs repo releases base."""
    problems = []
    try:
        manifest = json.loads(read(os.path.join("docs", "library-packs.json")))
    except Exception as e:
        return [f"docs/library-packs.json is not valid JSON ({e})"]
    packs = manifest.get("packs") if isinstance(manifest, dict) else None
    if not isinstance(packs, list):
        return ["docs/library-packs.json has no 'packs' list"]
    for pack in packs:
        for part in pack.get("parts", []) if isinstance(pack, dict) else []:
            url = part.get("url") if isinstance(part, dict) else None
            if isinstance(url, str) and not url.startswith(repo.PACKS_RELEASES + "/"):
                problems.append(f"docs/library-packs.json part URL is {url}, expected it under "
                                f"{repo.PACKS_RELEASES}/ (packaging/repo.json's packs_repo)")
    return problems


def check_download_page():
    """The download page's REPO constant must equal repo.json's repo."""
    html = read(os.path.join("docs", "index.html"))
    found = re.findall(r'const REPO = "([^"]+)"', html)
    if found != [repo.REPO]:
        return [f"docs/index.html REPO constant is {found or 'missing'}, expected exactly "
                f'const REPO = "{repo.REPO}"; (packaging/repo.json)']
    return []


def check_server():
    """The app's default feed URLs must be the Pages URLs derived from repo.json."""
    problems = []
    source = read(os.path.join("app", "server.py"))
    for name, url in (("UPDATES_URL", repo.UPDATES_URL), ("MANIFEST_URL", repo.PACKS_MANIFEST_URL)):
        if f'"{url}"' not in source:
            problems.append(f"app/server.py {name} default is not {url} (derived from packaging/repo.json)")
    return problems


def check_readme():
    """Every GitHub repo link in the README must be one of repo.json's two repos."""
    problems = []
    for url in dict.fromkeys(GITHUB_REPO.findall(read("README.md"))):
        if url not in (repo.REPO, repo.PACKS_REPO):
            problems.append(f"README.md links to {url}, which is neither repo.json's repo ({repo.REPO}) "
                            f"nor its packs_repo ({repo.PACKS_REPO})")
    return problems


def main():
    problems = (check_update_json() + check_packs_json() + check_download_page()
                + check_server() + check_readme())
    for p in problems:
        print(f"FAIL {p}")
    if problems:
        sys.exit(1)
    print(f"PASS every hardcoded repo URL agrees with packaging/repo.json ({repo.REPO})")


if __name__ == "__main__":
    main()
