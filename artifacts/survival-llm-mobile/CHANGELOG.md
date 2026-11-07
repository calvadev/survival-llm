# Changelog

## 0.1.3

Fix the AI dumping raw tool-call text ({"name": "read_article", ...}) as its
answer instead of looking articles up: text-written calls are now recovered
and run, markup never reaches the screen, and an answer that is only markup
falls back to answering with library excerpts. Also caps on-screen article
opens at one per answer — asking a question no longer hijacks the screen for
every article the AI reads.

## 0.1.2

Fix a crash when the AI answers with library sources: after it used its search
and read tools, the follow-up request could fail with "Failed to parse
messages: ... type must be string, but is null". Tool calls are now rebuilt
with string-only fields before going back to the model, and the no-tools
fallback retries from a clean transcript instead of the failed messages.

## 0.1.1

Fix download progress during setup: the library and AI-model bars no longer
swap places on every update, and multi-part library downloads show one bar
labelled with the current part instead of stacking up identical bars.

## 0.1.0

First Android release. On-device AI chat (llama.cpp) with the offline survival
library: full-text search, source citations with a tap-to-read article reader,
and resumable, checksum-verified downloads of the AI model and the Essentials
library pack.
