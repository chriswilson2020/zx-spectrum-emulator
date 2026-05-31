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

See [CPU Status](docs/cpu-status.md) and [Validation](docs/validation.md) for
the details and remaining caveats.

## Quick Validation

```sh
npm test
npm run coverage:opcodes
```

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
  machine layer.
- [Opcode Coverage](docs/opcode-coverage.md): decoder coverage probe notes.
- [Roadmap](docs/roadmap.md): high-level project phases.

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
engineering milestone is the Spectrum 48K shell: ROM mapping, RAM, keyboard
ports, frame interrupts, and a minimal display pipeline.
