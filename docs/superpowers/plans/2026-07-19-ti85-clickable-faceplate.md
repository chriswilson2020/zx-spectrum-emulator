# TI-85 Clickable Faceplate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first clickable TI-85 keypad surface to the browser viewer.

**Architecture:** Generate semantic keypad buttons from a local layout table in
`public/ti85-app.js`. Bind each button to the existing `Ti85Machine`
`pressKey()` and `releaseKey()` API, keeping click geometry outside the emulator
core.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Node.js built-in test runner,
existing Playwright CLI verification workflow.

---

## Task 1: Keypad Surface Tests

- [x] Add page tests that assert `public/ti85.html` contains `id="ti85Keypad"`
  and `public/ti85-app.js` contains `TI85_KEY_LAYOUT`, `data-ti85-key`,
  `bindTi85KeyButton`, `machine.pressKey(key)`, and `machine.releaseKey(key)`.
- [x] Run `node --test test/pages.test.js` and verify the new assertions fail.

## Task 2: Keypad UI

- [x] Add the keypad container to `public/ti85.html`.
- [x] Generate TI-85 physical key buttons in `public/ti85-app.js`.
- [x] Replace the standalone ON control with a physical `ON` key button.
- [x] Add responsive TI-85 keypad styles in `public/styles.css`.
- [x] Run `node --test test/pages.test.js` and verify it passes.

## Task 3: Verification

- [x] Run `npm test`.
- [x] Open `http://127.0.0.1:3000/ti85.html` in browser automation.
- [x] Verify the page has no console errors.
- [x] Hold the physical `ON` key and confirm LCD pixels become nonblank.
- [x] Hold another physical key, such as `F1`, and confirm debug state shows it
  as held.
