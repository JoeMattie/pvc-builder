# PLANFILE — Mobile Ergonomics and Production Hardening

Baseline: planned from v0.3.9 / schema v10; implemented against the newer v0.3.16 tree. No schema or JSON format change.

## Product contract

- Support real editing from 320 px phones through tablets and desktop.
- Compact width is `<640`, very narrow is `<360`, and short viewport is `<720` visual CSS pixels.
- Tall phones retain the tool rail. Very narrow or short phones use the bottom Select / Draw / Move / Rotate / More dock.
- Mobile commands remain labeled and discoverable without a keyboard or secondary mouse button.
- Touch navigation is transient: one finger edits in Edit mode, one finger orbits in Orbit mode, and two fingers always zoom/pan without changing the document.
- Existing `editorActions`, `updateCurrent`, schema v10, JSON, solver, BOM shape, and `window.__pvc` methods remain compatible.

## Delivery scope

1. Responsive shell with safe-area docks, visual-viewport sizing, non-draggable compact panels, and collision-free mobile chrome.
2. Mobile command and More sheets, explicit path completion/cancellation/exact length, touch multi-select, visible size/connection/delete/group actions, and long-press context access.
3. Pointer-type/touch-count gesture arbitration, Edit/Orbit modes, two-finger navigation, and touch-size interaction targets.
4. Accessibility protection: labeled sheets, 44 px primary targets, pressed state, keyboard focus, Escape, and Radix focus trapping.
5. Playwright projects at 390×844, 390×667, 320×568, 768×1024, and phone landscape with layout and touch checks.
6. Direct `mathcat@0.0.13`, neutral unit formatting, supported Three.js shadows, clean test shutdown, and production chunks below 500 KB gzip.
7. Context/user-guide maintenance and follow-up decomposition of the large action/domain/chrome modules without changing their public APIs.

## Acceptance

`typecheck`, Biome, Vitest, production build, desktop E2E, and mobile E2E pass. Compact layouts have no horizontal overflow or offscreen controls, mobile primary targets are at least 44 px, navigation gestures never mutate the design, there is no schema migration, and no JavaScript chunk exceeds 500 KB gzip.
