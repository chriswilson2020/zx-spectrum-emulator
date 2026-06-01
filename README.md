# ZX Spectrum Emulator

A faithful Zilog Z80 emulator, growing into a ZX Spectrum emulator for teaching
Z80 assembly and Sinclair BASIC.

## Current Status

The Z80 CPU core is implemented and strongly validated:

- Complete base, CB, ED, DD, FD, DDCB, and FDCB opcode decoder coverage.
- Documented and major undocumented Z80 behaviours implemented, including
  X/Y flag quirks, `WZ/MEMPTR`, `Q`, indexed instructions, block operations,
  and interrupt entry paths.
- Strict SingleStep validation passes 1,604,000 instruction vectors, including
  registers, flags, memory, ports, cycles, `WZ`, and `Q`.
- `zexdoc.com` and `zexall.com` both pass through the CP/M exerciser harness.

The first ZX Spectrum 48K machine layer is also in place:

- `Spectrum48` maps a 16K ROM at `0x0000-0x3fff` and 48K RAM at
  `0x4000-0xffff`.
- Port `0xfe` implements active-low keyboard row reads plus border and beeper
  state writes.
- Beeper transitions are captured with CPU t-state timing and can be played in
  the browser through Web Audio.
- A 50 Hz frame loop raises maskable interrupts and renders the ULA display file
  plus border into a 320x240 RGBA frame.
- The browser viewer loads a local `ROM/48.rom`, runs the ROM, accepts modern PC
  keyboard input, and can paste/load Sinclair BASIC listings.
- The viewer includes a visual debugger with pause/frame-step/instruction-step
  controls, live registers and flags, disassembly around `PC`, BASIC status,
  and memory inspectors for key Spectrum regions.
- The BASIC paste path tokenizes the full 48K keyword range, renumbers listings
  that exceed line `9999`, auto-runs numbered listings, and handles ROM-specific
  `DEF FN` parameter placeholders.

See [CPU Status](docs/cpu-status.md) and [Validation](docs/validation.md) for
the details and remaining caveats.

## Quick Validation

```sh
npm test
npm run coverage:opcodes
```

## Browser Viewer

With `ROM/48.rom` present, start the current canvas viewer:

```sh
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The viewer loads the
48K ROM, runs the headless machine, draws the 320x240 border/display frame, and
passes browser key events into the Spectrum keyboard matrix.

`ROM/48.rom` is intentionally local-only and is ignored by git. Put your own
48K ROM image at that path before starting the viewer or running ROM-level
tests.

The `Paste BASIC` box accepts normal PC text. Numbered listings are loaded
directly into BASIC memory and then `RUN` is typed automatically unless the
paste includes unnumbered commands. Listings with line numbers above the real
Spectrum editor limit are renumbered before loading.

The debugger is designed for the browser viewport rather than as a fixed-size
desktop panel. On wide screens the Spectrum display remains in the left pane
with controls on the right. The canvas starts scaling down before the layout
becomes cramped, and below tablet widths the controls and debugger stack into a
single column. The debugger cards use named layout areas so registers, BASIC
state, disassembly, and memory stay in predictable positions as the page
reflows.

The long independent Z80 exercisers are available too:

```sh
npm run test:zexdoc
npm run test:zexall
```

These are intentionally heavy runs. Each currently executes about 5.76 billion
emulated Z80 instructions.

The strict SingleStep suite is supported but its vector corpus is intentionally
not committed because it is very large. To run it locally:

```sh
git clone https://github.com/SingleStepTests/z80 vendor/SingleStepTests-z80
npm run test:singlestep
```

## Documentation

- [CPU Status](docs/cpu-status.md): what the CPU core supports and what remains.
- [Validation](docs/validation.md): validation commands, harnesses, and known
  passing results.
- [Architecture](docs/architecture.md): CPU, memory, I/O, interrupts, and test
  harness structure.
- [Spectrum Next Steps](docs/spectrum-next.md): plan for the ZX Spectrum 48K
  machine layer and current Spectrum status.
- [Opcode Coverage](docs/opcode-coverage.md): decoder coverage probe notes.
- [Roadmap](docs/roadmap.md): high-level project phases.

## License

The emulator code is licensed under the MIT License. See [LICENSE](LICENSE).

Third-party validation material under `ZEXALL-main/` is GPLv2-licensed and is
kept separate from the emulator runtime. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.

## CP/M Exerciser Harness

The CPU can run CP/M-style `.COM` validation programs through a small BDOS
console harness. This workspace includes `zexdoc.com` and `zexall.com` under
`ZEXALL-main/`.

```sh
npm run test:zexdoc
npm run test:zexall
```

The harness loads the program at `0x0100`, intercepts `CALL 0x0005`, supports
BDOS console output functions `2` and `9`, and terminates on BDOS function `0`
or CP/M warm boot at `0x0000`.

## Goal

The emulator is being built as both a faithful ZX Spectrum emulator and a
teaching environment for Z80 assembly and Sinclair BASIC. The immediate next
engineering milestone is moving from the current booting/debuggable Spectrum
shell toward TAP loading and more hardware accuracy, including ULA timing
details.
