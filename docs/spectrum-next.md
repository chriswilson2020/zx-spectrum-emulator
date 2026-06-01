# Spectrum 48K Status And Next Steps

The CPU core is now strong enough to become the heart of a ZX Spectrum 48K
emulator. The first minimal but real Spectrum machine shell is implemented and
driving the 48K ROM through a browser canvas viewer.

## Target Machine

Initial target:

- ZX Spectrum 48K
- 16K ROM at `0x0000-0x3fff`
- 48K RAM at `0x4000-0xffff`
- 50 Hz maskable interrupt
- ULA screen memory and attributes
- Keyboard matrix on port `0xfe`

## Milestone 1: Machine Skeleton

Create a `Spectrum48` class that owns:

- Z80 CPU
- ROM/RAM memory map
- ULA-facing I/O ports
- Frame counter
- Basic run loop

The first goal is not rendering yet. The first goal is to boot the ROM far
enough that the CPU is executing real Spectrum code with correct memory and
interrupt behaviour.

Status: implemented. `src/spectrum48.js` owns the Z80, ROM/RAM map, basic I/O,
frame counter, and frame-sized CPU runner.

## Milestone 2: Memory Map

Implement:

- ROM reads at `0x0000-0x3fff`
- Ignore writes to ROM
- RAM reads/writes at `0x4000-0xffff`
- Ability to load a 16K Spectrum ROM from disk

Use a small memory object behind the CPU's existing `read8`/`write8` interface.

Status: implemented for the initial 48K map, including `ROM/48.rom` loading.

## Milestone 3: Ports

Start with port `0xfe`:

- Reads return keyboard matrix rows
- Writes update border colour and beeper bit

At first, return an idle keyboard state. Then add a simple key matrix API.

Status: implemented. Port `0xfe` writes update border and beeper state, and
reads use an active-low keyboard matrix with `pressKey`/`releaseKey`.

## Milestone 4: Frame Interrupt

Drive a 50 Hz frame loop:

- Run CPU for one frame worth of T-states
- Request a maskable interrupt once per frame
- Let the CPU's `IM 1` handler enter the ROM interrupt routine at `0x0038`

This is the point where the ROM should start behaving like a Spectrum rather
than just arbitrary Z80 code.

Status: implemented. `runFrame()` asserts an IM 1-style interrupt before the
frame's CPU work, so enabled ROM code can service it during that frame.

## Milestone 5: Video

Implement display extraction from:

- Pixel bitmap: `0x4000-0x57ff`
- Attributes: `0x5800-0x5aff`

Initial renderer can be simple:

- Convert the 6912-byte display file to an RGBA buffer
- Ignore contention and exact scanline timing
- Add border colour after the core image works

Status: implemented for the first viewer. `renderDisplayRgba()` converts the 256x192 bitmap and
attributes into opaque RGBA pixels, including ULA line addressing and bright
attributes. `renderFrameRgba()` composes the display into a 320x240 frame with
the current border colour. Exact scanline timing and contention remain later
accuracy work.

## Milestone 6: Browser Teaching UI

Once the machine runs a ROM frame loop, add the web experience:

- Canvas display
- Run/pause/reset controls
- CPU register panel
- Memory view
- Disassembly view
- Breakpoints and single-step
- Assembly editor and examples

Status: implemented as a usable first slice. `npm run dev` serves a canvas viewer that loads
`ROM/48.rom`, runs frames, draws the frame buffer, and forwards browser key
events into the keyboard matrix. The viewer also includes run/pause/reset,
basic machine diagnostics, a Hello World button, a Web Audio beeper toggle, and
a `Paste BASIC` flow.

## Debugger And Responsive Layout

Status: implemented as the first visual debugger slice. The viewer has
pause/run, frame-step, and instruction-step controls. It displays live register
pairs, flags, `PC`, interrupt mode, T-state count, BASIC error/current-line
state, system variable pointers, a disassembly window around `PC`, and memory
inspection blocks for `PROG`, `VARS`, `E_LINE`, screen RAM, and system
variables.

The layout is responsive but keeps the preferred emulator shape: Spectrum screen
on the left and controls on the right while there is enough room. The screen
starts scaling down at medium widths to avoid overlap. Debugger cards reflow
from a three-area desktop layout to two columns, then to a single column on
narrow screens.

## Beeper Audio

Status: implemented for a first audible slice. The machine records beeper bit
transitions from port `0xfe` with CPU t-state timestamps. The browser drains
those transitions into Web Audio buffers when sound is enabled by the user.

This is good enough for BASIC `BEEP` feedback and demos that toggle the beeper.
It is not yet a cycle-perfect model of speaker output, tape audio, or contention
effects.

## BASIC Loading And Keyboard Input

The browser UI supports two input paths:

- Modern key events are translated into Spectrum matrix chords, including common
  punctuation through Symbol Shift.
- Pasted BASIC text is tokenized and loaded directly into the ROM's BASIC
  program area. The tokenizer covers the 48K keyword range, numeric markers, and
  `DEF FN` parameter placeholders required by the ROM evaluator.

The paste path renumbers listings that exceed the Spectrum editor's four-digit
line-number limit and auto-types `RUN` for numbered listings that do not include
an explicit command.

## Tape Loading

Status: implemented for fast-loading, ROM byte-loader interception, and
standard-speed EAR pulse playback. The viewer can open `.tap` files and
standard-speed `.tzx` data blocks, decode Spectrum header blocks, validate
checksums, and show the block list in the control panel. Parsed files are
mounted as a virtual tape so the 48K ROM's byte-loading routine can consume
later blocks in sequence.

Supported fast-load entries:

- BASIC program header/data pairs. Data bytes are copied directly into the BASIC
  program area. If the header has an auto-start line, the viewer types
  `RUN <line>` after loading. Subsequent ROM `LOAD "" CODE` calls can be fed
  from the mounted tape cursor.
- CODE header/data pairs. Data bytes are copied to the header's start address.
- Standard-speed tape pulse playback. Remaining mounted blocks can be expanded
  into pilot/sync/data pulses and exposed through the EAR bit on port `0xfe` for
  loaders that poll tape input directly.

For real pulse playback, flashing border colours are normal. The emulated loader
is seeing tape level transitions, and large standard-speed blocks still take
cassette-scale time to load.

Number arrays, character arrays, TZX turbo/pure-data blocks, and higher-fidelity
loader timing remain future work.

## Snapshot Save And Load

Status: implemented for useful 48K `.z80` snapshots. The browser can load
version 1 snapshots with compressed or uncompressed RAM, plus extended snapshots
that contain the normal 48K memory pages. Loading restores CPU registers,
alternate registers, interrupt state, border colour, and RAM.

The viewer can also download the current machine state as an uncompressed
version 1 `.z80` snapshot. This gives users a practical save path for BASIC
programs and games: the snapshot preserves the entire live machine, not just a
text listing.

## Current Next Work

Highest-value next slices:

- Add fuller tape support: arrays, TZX turbo/pure-data blocks, and richer loader
  compatibility.
- Add a more BASIC-friendly export/import path for listings, separate from
  whole-machine snapshots.
- Improve renderer timing toward scanline accuracy, contention, and floating
  bus behaviour.

## Later Accuracy Work

After the first booting Spectrum works:

- ULA contention timing
- Floating bus behaviour
- Fuller tape loading beyond standard-speed TAP/TZX blocks
- More exact audio timing
- Additional snapshot formats such as `.sna`

The CPU and first machine shell are ready; the next work is tooling and hardware
accuracy.
