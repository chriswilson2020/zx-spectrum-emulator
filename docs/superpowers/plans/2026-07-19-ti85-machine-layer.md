# TI-85 Machine Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate headless TI-85 machine layer that can run the bundled ROM far enough for LCD output to become nonblank.

**Architecture:** Implement `Ti85Machine` as a project-native machine layer around the existing `Z80` core. Keep TI-85 memory, ports, keyboard, interrupts, LCD rendering, and debug state inside this machine layer, with browser click UI deferred to a later slice.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, existing `src/z80.js`.

---

## File Structure

- Create `src/ti85.js`: TI-85 machine implementation.
- Create `test/ti85.test.js`: headless unit tests plus ROM smoke test.
- Modify `docs/architecture.md`: brief TI-85 architecture entry after implementation passes.

## Task 1: Memory Map And CPU Wiring

**Files:**
- Create: `test/ti85.test.js`
- Create: `src/ti85.js`

- [ ] **Step 1: Write failing tests**

Add tests for 128K ROM validation, fixed ROM reads, ignored ROM writes, banked ROM selection through port `0x05`, RAM reads/writes, 16-bit access, and CPU fetch through the machine.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/ti85.test.js`
Expected: FAIL because `src/ti85.js` does not exist.

- [ ] **Step 3: Implement minimal machine**

Create `Ti85Machine` with `ROM_SIZE = 0x20000`, `RAM_SIZE = 0x8000`, memory callbacks, port `0x05` bank selection, CPU ownership, `step()`, `runTStates()`, `runFrame()`, and `reset()`.

- [ ] **Step 4: Run tests**

Run: `node --test test/ti85.test.js`
Expected: PASS for memory and CPU wiring tests.

## Task 2: Ports, Keyboard, ON, And LCD Rendering

**Files:**
- Modify: `test/ti85.test.js`
- Modify: `src/ti85.js`

- [ ] **Step 1: Write failing tests**

Add tests for port state, TI-85 key matrix reads, `ON` interrupt status, LCD bitmap expansion from known RAM bytes, RGBA rendering, and debug state.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/ti85.test.js`
Expected: FAIL because ports, keys, ON status, LCD rendering, or debug fields are missing.

- [ ] **Step 3: Implement behavior**

Add TI-85 key rows, `pressKey()`, `releaseKey()`, `setKeyState()`, `getPressedKeys()`, port `0x00-0x07` state, `pulseOnKey()`, 256 Hz interrupt scheduling, `renderLcdBitmap()`, `renderLcdRgba()`, and `getDebugState()`.

- [ ] **Step 4: Run tests**

Run: `node --test test/ti85.test.js`
Expected: PASS for unit-level TI-85 behavior.

## Task 3: Real ROM Smoke Test And Docs

**Files:**
- Modify: `test/ti85.test.js`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Write ROM smoke test**

Add a bounded test that loads `ROM/TI85.ROM`, resets, pulses ON, runs repeated frame slices, renders the LCD, and asserts nonblank output. Include debug state in the failure message.

- [ ] **Step 2: Run smoke test to verify failure or pass**

Run: `node --test test/ti85.test.js`
Expected: the smoke test may initially FAIL with useful debug output or PASS if the first hardware slice is sufficient.

- [ ] **Step 3: Tighten implementation only as needed**

If the smoke test fails, adjust only the minimum TI-85 machine behavior needed to reach nonblank LCD output. Do not add browser UI.

- [ ] **Step 4: Update architecture docs**

Add a concise `src/ti85.js` entry to `docs/architecture.md` describing the new headless TI-85 layer and first milestone.

- [ ] **Step 5: Run verification**

Run: `node --test test/ti85.test.js`
Run: `npm test`
Expected: all tests pass.
