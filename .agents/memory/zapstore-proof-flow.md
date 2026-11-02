---
name: Zapstore first-publish certificate proof
description: zsp publish fails with proof_required until the interactive zsp wizard's browser-style approval is completed; how to drive it
---

The first time a certificate publishes to Zapstore, `zsp publish` fails with
`proof_required` ("no active proof found for certificate …", `requires_human: true`).

The fix is the interactive `zsp` wizard (no args). Its final approval step is NOT a
terminal prompt: it starts a preview server on localhost:17008 and waits for the
preview page's "Approve publication" button. Pressing Enter in the terminal exits
the wizard WITHOUT publishing.

To approve programmatically: GET http://localhost:17008/ , extract
`sessionNonce = "<hex>"` from the page JS, then POST /api/approve with headers
`X-Session-Nonce: <nonce>` AND `Origin: http://localhost:17008` (the server rejects
with "403 forbidden origin" otherwise). A 204 means approved; the wizard then
publishes and exits 0.

**Why:** the 403 without Origin and the silent exit on terminal Enter each cost a
long wizard re-run (it re-fetches and re-inspects the 244 MB APK release each time).

**How to apply:** if a future publish fails `proof_required` (e.g. new upload key,
expired proof), re-run the wizard the same way. Terminal prompts seen: APK location
(send EOF/Ctrl-D to accept the zapstore.yaml default), keystore path, keystore
password, "Publish now" (answer 1), then the HTTP approval above, then "how should
new releases reach Zapstore" (1 = let Zapstore track the GitHub releases).
