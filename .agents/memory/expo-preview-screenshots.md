---
name: Expo web-preview screenshots come back black at first
description: The appPreview screenshot tool often captures the Expo web app mid-load (black body); retake the same URL until content renders.
---

Capturing the Survival LLM Expo web preview with the Screenshot tool (`appPreview`) repeatedly produced black screenshots — header visible, body black — especially on the first capture of each route.

**Why:** the capture fires while the app is still loading (fonts/splash/Metro lazy route bundle). Retakes of the identical URL usually succeed — one route took three tries.

**How to apply:** after each capture, actually view the saved image and retake if the body is black. Budget several attempts per route. (The old blank fresh-`/` web render — empty inverted FlatList collapsing its footer on RN web — is fixed: the chat empty state renders outside the list now. Do not work around it by seeding messages.)
