# TI-85 Golden Workflow Tests Design

## Goal

Add ROM-level golden workflow tests that exercise the TI-85 as a calculator, not
only as a collection of hardware ports.

## Scope

The first suite covers deterministic guidebook-style workflows that can be
driven through the existing key matrix and verified from the LCD framebuffer:
power-on, simple arithmetic, signed expressions, trigonometric entry,
store/recall, divide-by-zero error display, and graph menu entry.

This does not add LCD OCR yet. The oracle is a stable LCD signature made from
LCD enabled state, framebuffer base address, lit-pixel count, and framebuffer
checksum.

## Architecture

Create a reusable test helper, `test/helpers/ti85-rom-harness.js`, that owns
ROM boot timing, key tap timing, framebuffer settling, and signature capture.
Tests in `test/ti85-rom-workflows.test.js` will define named workflows as key
sequences and assert their golden signatures.

The helper deliberately uses only public `Ti85Machine` APIs:
`fromRomFile()`, `runFrame()`, `pressKey()`, `releaseKey()`,
`renderLcdBitmap()`, and `getDebugState()`.

## Test Strategy

Each workflow starts from a fresh `ROM/TI85.ROM` machine, powers on, sends a key
sequence, waits a fixed settle interval, and compares the final LCD signature.
Failure messages include the workflow name, key sequence, observed signature,
and debug state so regressions can be diagnosed without a browser.

The suite is regression-oriented. It will catch changes in Z80 execution,
interrupts, keyboard matrix behavior, LCD base handling, ROM banking, and
browser-facing key names that disturb real ROM workflows.
