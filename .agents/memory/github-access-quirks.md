---
name: GitHub access from this workspace
description: Which GitHub credentials work from this Replit workspace and which do not, learned while publishing a release.
---

Three separate GitHub credential paths exist here, and only one can write to github.com:

1. `gh` CLI uses `GH_ENTERPRISE_TOKEN` against `github.replit.internal` (Replit's mirror of the repos).
   It is read-only for the upstream repo, and its release `upload_url` redirects to uploads.github.com,
   where the token is invalid — release asset uploads through it fail.
2. The GitHub integration (`github_7dd39da9_api`) reports "authorized" and `addIntegration` claims
   success, but `listConnections("github-source-control")` returns empty — credentials are withheld
   from the agent sandbox — and the connect card fails to render (platform validation error).
3. The `GITHUB_TOKEN` secret (user's personal account `calvadev`) works for github.com API and release
   uploads to repos `calvadev` can write (including the fork). Use it for any github.com write.

**Why:** two attempts at the integration and one at the mirror failed before the token path worked;
retrying them wastes a turn.

**How to apply:** for github.com reads, unauthenticated API or `gh api` on the mirror are fine. For any
write (releases, contents, Pages), use `curl`/API with the `GITHUB_TOKEN` secret and never print it.
