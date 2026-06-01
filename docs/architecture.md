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
`public/debugger.js` supplies browser-friendly debug helpers: hex formatting,
small-window disassembly, system variable reads, BASIC status extraction, and
memory row formatting.
`public/tape.js` parses TAP containers and standard-speed TZX data blocks,
validates block checksums, pairs header blocks with data blocks, and implements
the first fast-load path for BASIC program and CODE blocks.
`public/snapshot.js` parses and writes 48K `.z80` snapshots so the browser can
restore complete RAM/register state or download the current state for later.

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

The browser debugger consumes this state live. It shows register pairs, `I`,
`R`, interrupt mode, total T-states, active flags as visual pills, a small
disassembly window around `PC`, BASIC status (`ERR_NR`, current line, and
sub-statement), and memory inspections for `PROG`, `VARS`, `E_LINE`, screen
memory at `0x4000`, and system variables around `0x5c00`.

The disassembler is intentionally partial and conservative. It renders common
base Z80 instructions and control flow mnemonics that are useful when watching
the ROM. Unknown or less common opcode forms fall back to byte output instead
of showing a misleading mnemonic.

## Browser Layout

The viewer uses CSS grid with responsive breakpoints. The preferred layout keeps
the Spectrum display and debugger in the left pane with machine controls in a
right rail. The canvas has a viewport-aware maximum size so it scales down
before colliding with the controls. At medium widths, debugger cards reflow into
two columns using named grid areas; at narrow widths, controls and debugger
cards stack into one column. This keeps the emulator usable in full-screen,
split-screen, and laptop-width browser windows.

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

## Tape Loading

The first tape path is a pragmatic fast loader rather than an audio/pulse-level
emulation of cassette input. `parseTap()` reads TAP containers as a sequence of
length-prefixed blocks. `parseTzx()` supports TZX standard-speed data blocks
(`0x10`) and skips common descriptive metadata blocks. Header blocks decode the
Spectrum header payload: type, 10-character name, data length, and two
type-specific parameters. Data blocks keep their payload and checksum status.

The UI presents header/data pairs as tape entries. The current loader supports:

- BASIC program blocks (`type 0`): payload bytes are copied directly to `PROG`.
  `VARS`, `E_LINE`, `K_CUR`, `WORKSP`, `STKBOT`, and `STKEND` are updated in the
  same style as the BASIC paste loader. Header parameter 2 is used as the
  variables offset, and header parameter 1 is used as an optional auto-start
  line.
- CODE blocks (`type 3`): payload bytes are copied to the start address in
  header parameter 1.

Parsed tape files are also mounted into the machine as a virtual tape. The
first path is a fast ROM byte-loader intercept: when the 48K ROM reaches
`0x0556`, the machine checks the next block against the ROM's requested flag
byte, destination in `IX`, and length in `DE`. Matching blocks are copied into
the requested buffer, carry is set for a successful ROM return, and the tape
cursor advances. This lets multi-block BASIC loaders such as
`LOAD "" CODE: LOAD "" CODE: RANDOMIZE USR n` continue through the original ROM
control flow.

The second path is standard-speed pulse playback. Mounted tape blocks can be
expanded into Spectrum cassette pulses: pilot tone, sync pulses, and two pulses
per data bit using the ROM timings. The machine exposes those transitions as
the EAR bit on port `0xfe`, while pauses advance time without toggling the EAR
level. This covers standard TZX blocks that are read by polling code instead of
calling the ROM byte-loader entry point.

Number-array and character-array blocks are parsed and displayed but not loaded
yet. TZX turbo and pure-data blocks remain future work for software with
non-standard cassette timings.

## Snapshot Loading

The snapshot module supports the 48K `.z80` paths used by many Spectrum tools:

- Version 1 snapshots with uncompressed 48K RAM.
- Version 1 snapshots with `ED ED count value` compressed RAM.
- Extended `.z80` snapshots that contain 48K pages 8, 4, and 5, mapped to
  `0x4000`, `0x8000`, and `0xc000`.

Loading a snapshot writes the saved CPU registers, alternate registers, `I`,
`R`, `IX`, `IY`, `SP`, `PC`, interrupt flip-flops, interrupt mode, border
colour, and 48K RAM into the live `Spectrum48` instance. Transient browser-side
state such as held keys, beeper events, tape playback, and the frame counter is
cleared so the restored machine resumes from a clean input/audio boundary.

Saving writes an uncompressed version 1 `.z80` file. This keeps the output simple
and widely compatible while preserving the whole 48K machine state, which is
enough to save BASIC programs typed in the browser as well as game positions.

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
