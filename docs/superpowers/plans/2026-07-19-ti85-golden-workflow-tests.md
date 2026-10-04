# TI-85 Golden Workflow Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic ROM-level golden workflow tests for real TI-85 calculator behavior.

**Architecture:** Create a focused TI-85 ROM harness under `test/helpers/` that boots the bundled ROM, sends key taps, settles the LCD, and captures signatures. Add a workflow test file that asserts stable framebuffer signatures for calculator workflows.

**Tech Stack:** Node.js built-in test runner, ES modules, existing `Ti85Machine`, bundled `ROM/TI85.ROM`.

---

## Task 1: Failing Workflow Suite

**Files:**
- Create: `test/ti85-rom-workflows.test.js`
- Create later: `test/helpers/ti85-rom-harness.js`

- [x] Add `test/ti85-rom-workflows.test.js` importing `Ti85RomHarness` from `./helpers/ti85-rom-harness.js`.
- [x] Define golden workflows for power-on, arithmetic, signed expression, trig entry, store/recall, divide-by-zero, and graph menu.
- [x] Run `node --test test/ti85-rom-workflows.test.js`.
- [x] Confirm it fails because `test/helpers/ti85-rom-harness.js` does not exist.

## Task 2: ROM Harness

**Files:**
- Create: `test/helpers/ti85-rom-harness.js`
- Test: `test/ti85-rom-workflows.test.js`

- [x] Implement `Ti85RomHarness.fromBundledRom()`.
- [x] Implement `powerOn()`, `tap(key)`, `runWorkflow(keys)`, `signature()`, and `failureDetails(name, keys)`.
- [x] Use fixed key timing: three frames held, five frames released, twenty frames final settle.
- [x] Run `node --test test/ti85-rom-workflows.test.js`.
- [x] Confirm all workflow tests pass.

## Task 3: Full Verification

**Files:**
- Test: all test files

- [x] Run `npm test`.
- [x] Confirm the full suite passes.
- [ ] Commit the spec, plan, helper, and workflow tests.
