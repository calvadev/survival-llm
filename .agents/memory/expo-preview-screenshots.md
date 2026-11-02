---
name: Expo web-preview screenshots come back black at first
description: The appPreview screenshot tool often captures the Expo web app mid-load (black body); retake the same URL until content renders, and the fresh chat route renders blank on web regardless.
---

Capturing the Survival LLM Expo web preview with the Screenshot tool (`appPreview`) repeatedly produced black screenshots — header visible, body black — especially on the first capture of each route.

**Why:** the capture fires while the app is still loading (fonts/splash/Metro lazy route bundle). Retakes of the identical URL usually succeed — one route took three tries.

**How to apply:** after each capture, actually view the saved image and retake if the body is black. Budget several attempts per route. Separately: the fresh `/` (chat, nothing installed) renders a blank body on web no matter how many retakes — suspected React Native web quirk of an inverted FlatList with zero items (the setup card lives in its footer). Add state (messages) or pick another route when a screenshot needs content.
