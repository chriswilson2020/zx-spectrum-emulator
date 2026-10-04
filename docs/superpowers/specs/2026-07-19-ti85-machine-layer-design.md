# TI-85 Machine Layer Design

## Goal

Add a TI-85 compatible machine layer around the existing Z80 core. The TI-85
layer must stay separate from the ZX Spectrum, TRS-80 Model III, and CP/M
machine layers. The first milestone is headless: the bundled TI-85 ROM boots
far enough that rendered LCD output changes from blank.

## Scope

The first slice creates `src/ti85.js` with a `Ti85Machine` class. It includes
the minimum hardware behavior needed for real ROM execution to reach nonblank
LCD output:

- 6 MHz Z80 timing.
- 128K ROM image validation and copying.
- 32K RAM at `0x8000-0xffff`.
- Fixed ROM page at `0x0000-0x3fff`.
- Banked ROM page at `0x4000-0x7fff`.
- TI-85 I/O ports `0x00-0x07`.
- Named-key matrix state, including a separate `ON` key.
- Timer and ON-key interrupt state.
- Headless 128x64 monochrome LCD render helpers.
- Compact debug state for boot and display diagnosis.

The first slice does not add a browser page, clickable calculator face, session
save/load, keyboard shortcuts, or full link cable protocol. Those are follow-up
browser/UI slices after headless ROM execution produces visible LCD data.

## Architecture

`Ti85Machine` follows the same project convention as `Spectrum48`,
`Trs80Model3Machine`, `Cpm22Machine`, and `Z80Mbc2Machine`: the machine owns a
`Z80` instance, exposes memory and I/O callbacks to the CPU, and provides small
public APIs for stepping, frame execution, key state, rendering, and debugging.

The TI-85 layer does not introduce standalone LCD, ASIC, keyboard, or link-chip
models. Those behaviors are machine-owned state. If the implementation later
gets too dense, internal helper functions or small private objects may be used,
but consumers should still interact with a single `Ti85Machine` surface.

## Memory Map

The first implementation uses the TI-85 map:

```text
0000-3fff   fixed ROM page 0
4000-7fff   banked ROM page selected by port 5
8000-ffff   32K RAM
```

Writes to ROM addresses are ignored. Writes to RAM update the machine RAM.
Reads from the banked ROM window use the selected 16K page within the 128K ROM.
The bank value is stored from port `0x05`; only valid page bits are used for the
128K TI-85 ROM.

## I/O Ports

The TI-85 machine owns these ports:

```text
0x00   LCD memory base
0x01   keypad matrix scan
0x02   LCD contrast
0x03   ON status, LCD power, interrupt status/masks
0x04   display width and interrupt options
0x05   ROM banking
0x06   power mode
0x07   link port state
```

For the first milestone, ports `0x00`, `0x01`, `0x03`, `0x04`, and `0x05` are
behaviorally important. Ports `0x02`, `0x06`, and `0x07` are still stored and
reported through debug state so later UI and link work can build on the same
state without changing public API.

## LCD Rendering

The first renderer produces a 128x64 monochrome bitmap. It derives the display
origin from the LCD memory base register:

```text
lcdBase = ((port0Value & 0x3f) + 0xc0) << 8
```

The renderer reads 64 rows by 16 bytes from machine memory and expands each byte
most-significant-bit first into eight horizontal pixels. It exposes a packed
bitmap through `renderLcdBitmap()` and an RGBA buffer through `renderLcdRgba()`,
with shared diagnostics such as `litPixelCount` and a simple checksum. These
diagnostics are the first boot smoke test's acceptance signal.

Contrast is stored but does not affect the headless pass/fail result. The UI
phase can use it to tune LCD colors.

## Keyboard And ON

The emulator core API uses named keys only:

- `pressKey(name)`
- `releaseKey(name)`
- `setKeyState(name, pressed)`
- `getPressedKeys()`

The key matrix follows the TI-85 rows documented by the reference driver,
including `F1` through `F5`, arrows, numeric keys, operators, `2nd`, `ALPHA`,
`MORE`, `EXIT`, `DEL`, `CLEAR`, and `ON`.

`ON` is modeled as a distinct key and interrupt source, not as an ordinary
matrix key. The first ROM smoke test should simulate an ON press after reset
because the TI-85 waits for an ON-key interrupt at startup.

The later clickable UI will map faceplate hit regions to these same named keys.
Coordinate handling must remain outside `Ti85Machine`.

## Timing And Interrupts

`Ti85Machine` uses a 6 MHz CPU cadence. `runTStates(targetTStates)` runs until
the requested cycle budget is reached, and `runFrame()` advances one display
frame-sized slice.

The first interrupt implementation includes:

- periodic timer interrupts, initially scheduled at 256 Hz to match the
  reference driver behavior;
- ON-key interrupt status and masking;
- port `0x03` reads that expose and clear interrupt status in the same style as
  the hardware-facing reference.

If ROM boot diagnosis shows different timing is needed for this ROM image, the
interrupt scheduler should be adjusted behind the same public API.

## Public API

The initial public surface is:

- `new Ti85Machine({ rom })`
- `Ti85Machine.fromRomFile(path)`
- `read8(address)`, `write8(address, value)`
- `read16(address)`, `write16(address, value)`
- `readPort(port)`, `writePort(port, value)`
- `step()`
- `runTStates(targetTStates)`
- `runFrame()`
- `reset()`
- `pressKey(name)`, `releaseKey(name)`, `setKeyState(name, pressed)`
- `getPressedKeys()`
- `renderLcdBitmap()`
- `renderLcdRgba()`
- `getDebugState()`

`getDebugState()` should include CPU state, frame/t-state counters, selected
ROM bank, key state, ON/timer interrupt status and masks, LCD base/power/width
state, and display diagnostics.

## Testing

Unit tests cover:

- ROM size validation for 128K images.
- Fixed ROM reads and ignored ROM writes.
- Banked ROM selection through port `0x05`.
- RAM reads, writes, and 16-bit access.
- Port state reads/writes for the first implemented ports.
- Key matrix press/release behavior.
- ON key interrupt state.
- LCD bitmap expansion from known RAM bytes.
- Debug state shape and key diagnostics.

The integration smoke test loads `ROM/TI85.ROM`, resets the machine, simulates
an ON press/interrupt, runs a bounded CPU budget, renders the LCD, and passes
when the LCD diagnostics show output changed from blank. If it fails, the test
must expose enough debug state to tell whether the ROM is waiting for ON, stuck
in bank switching, leaving the LCD disabled, or writing pixels to an unexpected
memory location.

## Follow-Ups

- Add `public/ti85.html` and `public/ti85-app.js`.
- Render the LCD to canvas with calculator-like colors and contrast.
- Build the calculator faceplate from the provided TI-85 layout images.
- Add click/touch hit regions that call the named-key API.
- Add keyboard shortcuts as a convenience layer over the same named-key API.
- Add debug drawer and session save/load once the UI is useful.
- Implement link cable protocol after basic calculator interaction works.
- Consider TI-86 as the next calculator family member once the TI-85 layer is
  stable.
