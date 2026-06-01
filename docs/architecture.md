# Architecture

## Modules

### `src/z80.js`

The `Z80` class implements the CPU core. It owns registers, flags, hidden CPU
state, interrupt state, and instruction execution.

The constructor accepts:

- `memory`: an object with `read8(address)` and `write8(address, value)`
- `io`: optional `read(port)` and `write(port, value)` hooks

This keeps the CPU independent from any specific machine. The ZX Spectrum layer
will provide memory mapping, keyboard ports, ULA contention, and beeper I/O
through these boundaries.

### `src/memory.js`

`FlatMemory` is a simple 64K RAM implementation used by CPU tests and CP/M
exercisers. It provides:

- `read8`
- `write8`
- `read16`
- `write16`
- `load`

The Spectrum will need a mapped memory implementation rather than flat RAM:
ROM at `0x0000-0x3fff`, RAM at `0x4000-0xffff`, and later contention-aware
accesses.

### `src/spectrum48.js`

`Spectrum48` is the first machine layer around the CPU. It owns:

- A copied 16K ROM image at `0x0000-0x3fff`
- 48K RAM at `0x4000-0xffff`
- A `Z80` instance wired to the machine memory and I/O callbacks
- Port `0xfe` keyboard, border, and beeper state
- A frame counter and 50 Hz frame runner
- ULA display and full-frame RGBA render helpers
- Beeper transition capture with CPU t-state timestamps

The machine exposes `pressKey` and `releaseKey` for Spectrum key names. The
keyboard matrix is active-low and is read through the same port path the ROM
uses.

### `public/`

The browser viewer is intentionally thin. `public/app.js` owns the page loop,
loads `ROM/48.rom`, drives `Spectrum48`, renders the frame buffer to canvas, and
bridges browser controls into the machine.

`public/keyboard.js` translates modern PC keys and pasted text into Spectrum
key chords. `public/basic.js` tokenizes Sinclair BASIC for direct loading into
the ROM's program area, including keyword tokens, number markers, line
renumbering, and `DEF FN` parameter storage expected by the ROM evaluator.
`public/audio.js` converts beeper transitions into Web Audio sample buffers.

## CPU Execution

`cpu.step()` executes one CPU event:

- If an NMI is pending, it services NMI.
- If a maskable interrupt is pending and accepted, it services the interrupt.
- If the CPU is halted, it consumes a 4 T-state HALT cycle.
- Otherwise it fetches and executes one instruction.

The method returns the number of T-states consumed by that event and increments
`cpu.tStates`.

## I/O Boundary

The CPU calls:

```js
io.read(port)
io.write(port, value)
```

Ports are passed as 16-bit Z80 port addresses. The Spectrum machine layer
currently decodes:

- `0xfe` keyboard reads
- Border and beeper writes

Floating bus behaviour and exact contention are later accuracy work.

Beeper writes are also recorded as timed transitions. The browser drains those
events and schedules short mono buffers through Web Audio. This is intentionally
buffer-based and simple for now; exact speaker filtering and contention-aware
timing are future accuracy work.

## Interrupt API

The CPU exposes:

```js
cpu.requestInterrupt(data)
cpu.clearInterrupt()
cpu.requestNmi()
```

Maskable interrupts are accepted only when `IFF1` is set and the `EI` delay has
expired.

Current interrupt entry behaviour:

- `IM 1`: pushes `PC`, clears `IFF1/IFF2`, jumps to `0x0038`
- `IM 2`: pushes `PC`, clears `IFF1/IFF2`, loads vector from `(I << 8) | data`
- `IM 0`: supports RST opcodes supplied as interrupt data; otherwise uses IM 1
  style entry
- `NMI`: pushes `PC`, copies `IFF1` to `IFF2`, clears `IFF1`, jumps to `0x0066`

Interrupt entry wakes `HALT` and increments the refresh register.

## Debug State

`cpu.getState()` returns a debugger-friendly snapshot with:

- Registers
- Decoded flags
- Interrupt mode
- `IFF1` and `IFF2`
- Pending interrupt state
- HALT state
- Total T-states

This is intended for the eventual web debugger and teaching UI.

## Spectrum Runtime

`Spectrum48.runFrame()` requests a maskable interrupt and then runs one PAL frame
worth of CPU time. This is sufficient for the 48K ROM to maintain its interrupt
service work and for the browser UI to animate the display.

Video rendering reads the Spectrum display file directly:

- Bitmap pixels from `0x4000-0x57ff`
- Attributes from `0x5800-0x5aff`

The renderer supports the Spectrum line-address layout, ink/paper attributes,
bright colours, flash state supplied by the viewer, and border composition. It
does not yet model per-scanline contention or floating bus timing.

## BASIC Loading

The paste loader in `public/basic.js` writes tokenized BASIC directly into the
program area starting at `PROG`, then updates the relevant BASIC system
variables (`VARS`, `E_LINE`, `K_CUR`, `WORKSP`, `STKBOT`, and `STKEND`).

This path is faster and more reliable than typing long listings through the ROM
editor, but it must still store the bytes the ROM evaluator expects. In
particular, `DEF FN` parameters include hidden placeholder number markers in the
line body; without them the ROM raises `Q Parameter error` when `FN` is called.

## Validation Harnesses

### SingleStep

`scripts/run-singlestep.js` runs JSON instruction vectors and checks final CPU,
memory, port, cycle, `WZ`, and `Q` state. The vectors live in a local
`vendor/SingleStepTests-z80` checkout and are not committed to this repository
because the corpus is large.

### CP/M Exerciser Runner

`scripts/run-cpm-exerciser.js` runs CP/M `.COM` binaries by:

- Loading the program at `0x0100`
- Installing a minimal CP/M zero page
- Intercepting `CALL 0x0005`
- Supporting BDOS console functions `2` and `9`
- Ending on BDOS function `0` or warm boot at `0x0000`

This is used for `zexdoc.com` and `zexall.com`.
