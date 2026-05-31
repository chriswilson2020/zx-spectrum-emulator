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
basic machine diagnostics, a Hello World button, and a `Paste BASIC` flow.

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

## Current Next Work

Highest-value next slices:

- Add a small debugger panel: pause, single-step, registers, disassembly, and
  memory inspection.
- Add TAP loading so real tape images can enter through the ROM loader path.
- Implement beeper audio output from port `0xfe`.
- Improve renderer timing toward scanline accuracy, contention, and floating
  bus behaviour.
- Add save/load snapshots once the runtime state is stable.

## Later Accuracy Work

After the first booting Spectrum works:

- ULA contention timing
- Floating bus behaviour
- Tape loading, TAP first
- TZX support
- More exact audio timing
- Snapshot formats such as `.z80` and `.sna`

The CPU and first machine shell are ready; the next work is tooling and hardware
accuracy.
