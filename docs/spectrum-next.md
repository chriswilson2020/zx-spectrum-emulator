# Spectrum Next Steps

The CPU core is now strong enough to become the heart of a ZX Spectrum 48K
emulator. The next milestone is a minimal but real Spectrum machine shell.

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

## Milestone 2: Memory Map

Implement:

- ROM reads at `0x0000-0x3fff`
- Ignore writes to ROM
- RAM reads/writes at `0x4000-0xffff`
- Ability to load a 16K Spectrum ROM from disk

Use a small memory object behind the CPU's existing `read8`/`write8` interface.

## Milestone 3: Ports

Start with port `0xfe`:

- Reads return keyboard matrix rows
- Writes update border colour and beeper bit

At first, return an idle keyboard state. Then add a simple key matrix API.

## Milestone 4: Frame Interrupt

Drive a 50 Hz frame loop:

- Run CPU for one frame worth of T-states
- Request a maskable interrupt once per frame
- Let the CPU's `IM 1` handler enter the ROM interrupt routine at `0x0038`

This is the point where the ROM should start behaving like a Spectrum rather
than just arbitrary Z80 code.

## Milestone 5: Video

Implement display extraction from:

- Pixel bitmap: `0x4000-0x57ff`
- Attributes: `0x5800-0x5aff`

Initial renderer can be simple:

- Convert the 6912-byte display file to an RGBA buffer
- Ignore contention and exact scanline timing
- Add border colour after the core image works

## Milestone 6: Browser Teaching UI

Once the machine runs a ROM frame loop, add the web experience:

- Canvas display
- Run/pause/reset controls
- CPU register panel
- Memory view
- Disassembly view
- Breakpoints and single-step
- Assembly editor and examples

## Later Accuracy Work

After the first booting Spectrum works:

- ULA contention timing
- Floating bus behaviour
- Tape loading, TAP first
- TZX support
- More exact audio timing
- Snapshot formats such as `.z80` and `.sna`

The CPU is ready; the next work is machine integration.
