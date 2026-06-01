# Validation

## Quick Commands

Run the unit tests:

```sh
npm test
```

Build the static GitHub Pages artifact:

```sh
npm run build:pages
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

- `npm test`: 211 tests passing
- `npm run build:pages`: `dist/` artifact created
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
editing the CPU or the Spectrum machine layer.

The current unit suite covers the Z80 core, CP/M exerciser harness, `Spectrum48`
ROM/RAM/ports/frame/video behaviour, modern keyboard translation, the BASIC
tokenizer/loader/detokenizer/export path, Web Audio beeper sample generation,
and debugger helper formatting/disassembly/status reads, TAP/TZX parsing,
fast-loading, ROM-loader interception, standard-speed EAR pulse playback,
`.z80` snapshot save/load, GitHub Pages packaging, and the tabbed/collapsible
browser layout. It also covers the bootable CP/M 2.2 machine layer, z80pack raw
floppy geometry, FDC and console ports, CP/M command smoke tests, host-side CP/M
filesystem import/export, Z80-MBC2 8 MB disk reads, native Z80-MBC2 IOS boot,
interactive frame-sliced Z80-MBC2 typing, browser-local CP/M disk persistence
wiring, compressed CP/M session ZIP round-trips, full-extent record-count
repair, and the screen-buffer terminal behavior needed by WordStar-style
full-screen applications. The bundled `ROM/48.rom`, `ROM/cpm22-1.dsk`, and
`ROM/DS0N00.DSK` let ROM-level Spectrum tests and CP/M boot tests run without
extra local setup.

The `.z80` snapshot path has also been checked interactively with real snapshot
files: loading external `.z80` files resumes the saved machine state, and a
snapshot downloaded from the browser can be loaded back into the emulator.

### GitHub Pages Build

`scripts/build-pages.js` creates a static `dist/` directory containing the
browser entry point, `public/`, `src/`, and `ROM/` when present. The unit tests
verify that browser imports are relative, the ROM fetch is project-page-safe,
and the build script emits the files GitHub Pages needs.

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

### Bootable CP/M Machine Tests

The `test/cpm*.test.js` suite validates the CP/M 2.2 machine target separately
from the BDOS-intercept exerciser harness:

- `cpm-disk.test.js` checks z80pack raw floppy image size, sector addressing,
  invalid sector handling, writes, dirty tracking, and blank disk creation.
- `cpm22.test.js` checks boot-sector loading, console status/data ports,
  blocking console input, FDC read/write/status behavior, real CP/M boot to
  `A>`, `DIR`, `ED`, and `BYE`.
- `cpm-filesystem.test.js` checks CP/M 8.3 name handling, directory listing,
  file read/write/overwrite/delete, multi-extent files, Z80-MBC2 8 MB disk
  geometry detection/reading, and repair of old full-extents written with
  record count `00`.
- `cpm-terminal.test.js` checks carriage return, line feed, backspace,
  scrolling, cursor addressing, clear/erase behavior, and control-byte
  filtering.

Manual browser smoke tests are still useful for full application workflows. The
most important current manual path is loading a WordStar disk as B:, running
`INSTALL`, selecting `K` for Soroc IQ-120/140, and confirming the installed
WordStar menu renders as a stable screen. Also confirm that the bundled
companion disk is reachable as C: after a fresh page load. For foreign disk
imports, load a Z80-MBC2 image such as `DS0N00.DSK`, copy a small `.COM` file
to B:, switch to `B:` in CP/M, and run it. Also switch the CP/M page to the
Z80-MBC2 machine profile and verify that it boots to `A>` and can run `DIR` on
A: and B:. For local persistence, import or create a file on F: or G:, reload
the page, switch back to Z80-MBC2, and confirm that the selected drive is marked
`local` and still contains the file. Then use `Restore Bundled` or `Clear Local`
and confirm the local marker disappears. For session files, save a CP/M session
while the terminal is on a recognizable screen, reload the page, use `Load
Session`, and confirm the same profile, terminal contents, selected drive, and
disk directory return.

### Interactive BASIC Programs

The `progs/` directory contains interactive Sinclair BASIC validation programs
for the browser viewer and bundled `ROM/48.rom`.

- `progs/shorter_suite.bas` is the quick smoke suite. It covers BASIC paste,
  `INKEY$` pauses, UDG setup with `POKE` and `USR`, colour attributes,
  `SCREEN$`, `PLOT`, `DRAW`, `CIRCLE`, string sorting and slicing, `DATA` /
  `READ` / `RESTORE`, `BEEP`, `PEEK`, `CHR$`, `CODE`, `VAL`, and `STR$`.
- `progs/full_suite.bas` adds a heavier cellular automaton section that stresses
  numeric arrays, nested loops, conditional branches, long-running screen
  updates, and interpreter responsiveness.

These programs are not automated yet. Run them through `npm run dev`, paste the
selected `.bas` file into the viewer, and watch for ROM errors, stalled input,
broken display output, missing beeper feedback, or incorrect `ATTR`,
`SCREEN$`, `PEEK`, `POKE`, and `USR` results. See `progs/README.md` for the
detailed section-by-section notes.

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

For CP/M browser work, also run:

```sh
npm test
npm run build:pages
```

Then do a browser smoke pass through `cpm.html` for disk load/save and any
interactive application affected by the change.
