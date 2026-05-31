# Validation

## Quick Commands

Run the unit tests:

```sh
npm test
```

Probe decoder coverage:

```sh
npm run coverage:opcodes
```

Run the strict SingleStep suite:

```sh
git clone https://github.com/SingleStepTests/z80 vendor/SingleStepTests-z80
npm run test:singlestep
```

Run the CP/M exercisers:

```sh
npm run test:zexdoc
npm run test:zexall
```

## Current Known Passing Results

The latest validation pass reported:

- `npm test`: 107 tests passing
- `npm run coverage:opcodes`: 100% for base, CB, ED, DD, FD, DDCB, and FDCB
- `npm run test:singlestep`: 1,604,000 vectors, 0 failures
- `npm run test:zexdoc`: `Tests complete`
- `npm run test:zexall`: `Tests complete`

Both `zexdoc.com` and `zexall.com` currently terminate by CP/M warm boot after
5,764,169,610 emulated instructions.

## What Each Suite Proves

### Unit Tests

The unit tests in `test/` pin down known behaviours, regressions, and APIs. They
are intentionally readable and targeted. They are the first line of defence when
editing the CPU.

### Opcode Coverage

`scripts/opcode-coverage.js` executes every opcode pattern with neutral operand
bytes and reports decoder holes.

This proves that the decoder handles all opcode slots. It does not prove that an
opcode is semantically correct.

### SingleStep

`scripts/run-singlestep.js` runs JSON vectors from `vendor/SingleStepTests-z80`.
The vector corpus is intentionally kept out of this repository because it is
large; clone it locally before running the suite.
The harness checks:

- Main and alternate registers
- `I`, `R`, `IX`, `IY`, `PC`, `SP`
- `IFF1`, `IFF2`, interrupt mode
- Final `WZ`
- Final `Q`
- RAM changes
- Port reads and writes
- Instruction cycle counts

This is the strongest single-instruction validation path.

### CP/M Exercisers

`scripts/run-cpm-exerciser.js` loads `.COM` binaries at `0x0100`, sets up a
small CP/M zero page, intercepts `CALL 0x0005`, and supports BDOS output
functions `2` and `9`.

`zexdoc.com` checks documented Z80 behaviour. `zexall.com` also checks
undocumented flag bits. These programs validate long instruction sequences and
CRC-based machine-state results.

## Recommended Validation Flow

For normal CPU edits:

```sh
npm test
npm run test:singlestep
```

For decoder or opcode implementation changes:

```sh
npm test
npm run coverage:opcodes
npm run test:singlestep
```

Before major milestones or before integrating CPU changes into Spectrum
hardware:

```sh
npm test
npm run coverage:opcodes
npm run test:singlestep
npm run test:zexdoc
npm run test:zexall
```

The `zexdoc` and `zexall` runs are long. They are best treated as milestone
checks rather than every-edit checks.
