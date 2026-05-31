# Spectrum48 Machine Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a headless ZX Spectrum 48K machine layer that maps the bundled 48K ROM, owns the Z80 CPU, exposes basic I/O, and can run frame-sized CPU slices.

**Architecture:** Create `src/spectrum48.js` as the machine boundary around the existing `Z80` class. Keep the CPU unchanged and make the wrapper provide memory and port callbacks that later ULA, keyboard, audio, and UI work can extend.

**Tech Stack:** JavaScript ES modules, Node.js built-in `node:test`, existing `src/z80.js` CPU.

**Status:** Completed and extended. The final implementation includes the
machine layer, keyboard matrix, frame renderer, browser viewer, modern keyboard
translation, and direct Sinclair BASIC paste loading.

---

### Task 1: ROM And RAM Memory Map

**Files:**
- Create: `src/spectrum48.js`
- Create: `test/spectrum48.test.js`

- [x] **Step 1: Write failing tests for ROM/RAM behavior**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { Spectrum48 } from "../src/spectrum48.js";

function makeRom() {
  const rom = new Uint8Array(0x4000);
  rom[0x0000] = 0xf3;
  rom[0x1234] = 0x5a;
  rom[0x3fff] = 0xc9;
  return rom;
}

test("requires a 16K ROM", () => {
  assert.throws(() => new Spectrum48({ rom: new Uint8Array(0x3fff) }), /16K ROM/);
  assert.throws(() => new Spectrum48({ rom: new Uint8Array(0x4001) }), /16K ROM/);
});

test("maps ROM at 0000-3fff and ignores writes to ROM", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  assert.equal(machine.read8(0x0000), 0xf3);
  assert.equal(machine.read8(0x1234), 0x5a);
  assert.equal(machine.read8(0x3fff), 0xc9);

  machine.write8(0x1234, 0x99);
  assert.equal(machine.read8(0x1234), 0x5a);
});

test("maps RAM at 4000-ffff", () => {
  const machine = new Spectrum48({ rom: makeRom() });

  machine.write8(0x4000, 0x12);
  machine.write8(0x8000, 0x34);
  machine.write8(0xffff, 0x56);

  assert.equal(machine.read8(0x4000), 0x12);
  assert.equal(machine.read8(0x8000), 0x34);
  assert.equal(machine.read8(0xffff), 0x56);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/spectrum48.test.js`

Expected: fail because `src/spectrum48.js` does not exist.

- [x] **Step 3: Implement minimal memory map**

Create `Spectrum48` with ROM validation, copied ROM storage, 48K RAM storage,
and `read8`/`write8` methods.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/spectrum48.test.js`

Expected: all tests in `test/spectrum48.test.js` pass.

### Task 2: ROM File Loading And 16-Bit Access

**Files:**
- Modify: `src/spectrum48.js`
- Modify: `test/spectrum48.test.js`

- [x] **Step 1: Write failing tests for file loading and 16-bit access**

Add tests that call `Spectrum48.fromRomFile("ROM/48.rom")` and verify the ROM is
16K, plus tests for little-endian `read16`/`write16` through RAM.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/spectrum48.test.js`

Expected: fail because `fromRomFile`, `read16`, or `write16` is missing.

- [x] **Step 3: Implement file loading and 16-bit helpers**

Use `node:fs` `readFileSync` in the static loader and implement `read16` and
`write16` through `read8` and `write8`.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/spectrum48.test.js`

Expected: all Spectrum48 tests pass.

### Task 3: CPU Wiring, Ports, And Frame Loop

**Files:**
- Modify: `src/spectrum48.js`
- Modify: `test/spectrum48.test.js`

- [x] **Step 1: Write failing tests for CPU ownership and machine I/O**

Add tests that execute ROM bytes through `machine.cpu.step()`, verify `step()`
delegates to the CPU, verify port `0xfe` writes update `borderColor` and
`beeperOn`, and verify `runFrame()` advances the frame counter.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/spectrum48.test.js`

Expected: fail because CPU wiring, port state, or frame helpers are missing.

- [x] **Step 3: Implement CPU ownership and helpers**

Construct `Z80` with the machine as memory and with I/O callbacks bound to
`readPort` and `writePort`. Add `step`, `runTStates`, `runFrame`, `reset`,
`borderColor`, `beeperOn`, and `frame`.

- [x] **Step 4: Run targeted and full tests**

Run: `npm test -- test/spectrum48.test.js`

Expected: all Spectrum48 tests pass.

Run: `npm test`

Expected: all project tests pass.
