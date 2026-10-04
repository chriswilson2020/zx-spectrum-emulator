# TRS-80 Model III Machine Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a headless TRS-80 Model III machine layer with ROM/RAM mapping, memory-mapped keyboard and text video, CPU stepping, frame running, and debug state.

**Architecture:** Create `src/trs80-model3.js` as a separate machine boundary around the existing `Z80` class. Keep the first milestone focused on Model III and avoid introducing a generic TRS-80 platform abstraction until Model I or Model 4 work creates proven duplication.

**Tech Stack:** JavaScript ES modules, Node.js built-in `node:test`, existing `src/z80.js` CPU.

---

### Task 1: Memory Map And CPU Ownership

**Files:**
- Create: `src/trs80-model3.js`
- Create: `test/trs80-model3.test.js`

- [x] **Step 1: Write failing memory map tests**

Add tests that import `Trs80Model3Machine`, require a 14K ROM, verify ROM at
`0x0000-0x37ff`, keyboard at `0x3800-0x3bff`, video at `0x3c00-0x3fff`, RAM at
`0x4000-0xffff`, ignored writes to ROM/keyboard, and little-endian 16-bit
helpers.

- [x] **Step 2: Run targeted test to verify red**

Run: `node --test test/trs80-model3.test.js`

Expected: fail because `src/trs80-model3.js` does not exist.

- [x] **Step 3: Implement minimal memory map**

Create `Trs80Model3Machine` with 14K ROM validation, copied ROM storage, 48K RAM,
1K video RAM, eight keyboard row bytes, `read8`, `write8`, `read16`, `write16`,
and `fromRomFile`.

- [x] **Step 4: Run targeted test to verify green**

Run: `node --test test/trs80-model3.test.js`

Expected: all current TRS-80 tests pass.

### Task 2: Keyboard And Text Display

**Files:**
- Modify: `src/trs80-model3.js`
- Modify: `test/trs80-model3.test.js`

- [x] **Step 1: Write failing keyboard/display tests**

Add tests for active-high keyboard row reads through addresses `0x3800`,
`0x3840`, and `0x3880`; `pressKey`, `releaseKey`, `getPressedKeys`; and
`renderTextDisplay()` returning 16 rows of 64 characters from video RAM.

- [x] **Step 2: Run targeted test to verify red**

Run: `node --test test/trs80-model3.test.js`

Expected: fail because key APIs or display rendering are missing.

- [x] **Step 3: Implement keyboard and display APIs**

Add a small Model III key map, key normalization, row selection based on
keyboard address bits, active-high row storage, display byte-to-character
conversion, and text row rendering.

- [x] **Step 4: Run targeted test to verify green**

Run: `node --test test/trs80-model3.test.js`

Expected: all TRS-80 tests pass.

### Task 3: Execution Loop And Debug State

**Files:**
- Modify: `src/trs80-model3.js`
- Modify: `test/trs80-model3.test.js`

- [x] **Step 1: Write failing execution/debug tests**

Add tests that execute ROM bytes through `step()`, verify `runTStates()`,
verify `runFrame()` requests an interrupt and increments `frame`, verify
`reset()` resets CPU/frame state without clearing memory, and verify
`getDebugState()` returns profile, CPU state, halt state, frame, keyboard, and
display metadata.

- [x] **Step 2: Run targeted test to verify red**

Run: `node --test test/trs80-model3.test.js`

Expected: fail because execution and debug APIs are missing.

- [x] **Step 3: Implement execution and debug APIs**

Wire a `Z80` instance to the machine memory and neutral I/O callbacks, add
`step`, `runTStates`, `runFrame`, `reset`, and `getDebugState`.

- [x] **Step 4: Run targeted and full verification**

Run: `node --test test/trs80-model3.test.js`

Expected: all TRS-80 tests pass.

Run: `npm test`

Expected: all project tests pass.
