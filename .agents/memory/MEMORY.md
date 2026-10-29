# Memory index

- [Releases publish on the fork](release-publishing-fork.md) — GitHub releases, update.json URLs, and README download links point at calvadev/survival-llm, not the upstream anonnerdfrenzy repo.
- [GitHub access from this workspace](github-access-quirks.md) — gh CLI token only covers Replit's read-only mirror; the GitHub integration's credentials are withheld from the agent sandbox; use the GITHUB_TOKEN secret for github.com writes.
- [Release gates must be mandatory](release-gates-mandatory.md) — release-flow checks run unconditionally and abort on failure; skippable prompts get rejected in review; record a passed-input marker for expensive checks.
