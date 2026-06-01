# Z80 Machine Lab

A faithful Zilog Z80 emulator with two browser-hosted machine layers:

- a ZX Spectrum 48K emulator for teaching Z80 assembly and Sinclair BASIC.
- a bootable CP/M 2.2 machine using z80pack-compatible disk and console I/O.

## Current Status

The Z80 CPU core is implemented and strongly validated:

- Complete base, CB, ED, DD, FD, DDCB, and FDCB opcode decoder coverage.
- Documented and major undocumented Z80 behaviours implemented, including
  X/Y flag quirks, `WZ/MEMPTR`, `Q`, indexed instructions, block operations,
  and interrupt entry paths.
- Strict SingleStep validation passes 1,604,000 instruction vectors, including
  registers, flags, memory, ports, cycles, `WZ`, and `Q`.
- `zexdoc.com` and `zexall.com` both pass through the CP/M exerciser harness.

The first ZX Spectrum 48K machine layer is in place:

- `Spectrum48` maps a 16K ROM at `0x0000-0x3fff` and 48K RAM at
  `0x4000-0xffff`.
- Port `0xfe` implements active-low keyboard row reads plus border and beeper
  state writes.
- Beeper transitions are captured with CPU t-state timing and can be played in
  the browser through Web Audio.
- A 50 Hz frame loop raises maskable interrupts and renders the ULA display file
  plus border into a 320x240 RGBA frame.
- The browser viewer loads the bundled `ROM/48.rom`, runs the ROM, accepts
  modern PC keyboard input, and can paste/load Sinclair BASIC listings.
- The viewer includes a visual debugger with pause/frame-step/instruction-step
  controls, live registers and flags, disassembly around `PC`, BASIC status,
  and memory inspectors for key Spectrum regions.
- `.tap` files and standard-speed `.tzx` blocks can be parsed in the browser,
  inspected as tape blocks, and fast-loaded for BASIC program and CODE
  header/data pairs.
- `.z80` snapshots can be loaded and the current machine state can be saved as
  an uncompressed 48K `.z80` snapshot for returning to BASIC programs or game
  positions later.
- The BASIC source paths tokenize and detokenize the full 48K keyword range,
  renumber listings that exceed line `9999`, auto-run pasted listings, export
  editable `.bas` files, and handle ROM-specific `DEF FN` parameter
  placeholders.

The CP/M 2.2 page is also bootable and can switch hardware profiles:

- `Cpm22Machine` owns 64K RAM, the shared Z80 CPU, z80pack-compatible console
  ports, and z80pack/cpmsim floppy disk controller ports.
- `ROM/cpm22-1.dsk` boots through its real boot sector and BIOS into CP/M 2.2,
  reaching the normal `A>` prompt without BDOS interception.
- `ROM/cpm22-2.dsk` is bundled as the matching upstream z80pack companion disk
  and is mounted as C: by default.
- `Z80Mbc2Machine` emulates the Z80-MBC2 IOS protocol and boots
  `ROM/DS0N00.DSK` natively, with `DS0N00.DSK` through `DS0N06.DSK` mounted as
  A: through G: when that profile is selected.
- The browser CP/M page defaults to the z80pack profile, mounting the bundled
  system disk as A: and a blank writable work disk as B:.
- Whole-disk load/save and individual CP/M file import/download/delete are
  available from the browser.
- `Save Session` downloads a compressed local ZIP containing CPU state, RAM,
  terminal state, active profile, and the mounted disk images; `Load Session`
  restores that ZIP without using any server-side storage.
- A compact CP/M debug drawer shows live CPU registers, flags, PC disassembly,
  disk/controller state, console queue status, and a reserved recent-call trace
  panel for future BIOS/BDOS tracing.
- The CP/M file utility handles the z80pack skewed 8-inch floppy layout,
  Z80-MBC2 8 MB disk images for foreign-disk imports, multi-extent files, and
  repair of old full-extent imports whose record counts were written
  incorrectly.
- The terminal renderer is an 80x24 screen buffer with WordStar/Soroc-style
  cursor addressing, screen clear, erase-to-end-of-line, scrolling, tabs, and
  control-byte filtering.

See [CPU Status](docs/cpu-status.md), [Validation](docs/validation.md),
[Architecture](docs/architecture.md), and the
[CP/M Browser Guide](docs/cpm22-browser-guide.md) for details and caveats.

## Quick Validation

```sh
npm test
npm run coverage:opcodes
```

Quick CP/M boot smoke test from Node:

```sh
npm run run:cpm22
```

## Browser Apps

With `ROM/48.rom` and `ROM/cpm22-1.dsk` present, start the local static server:

```sh
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The first page is a
machine selector with links to:

- `spectrum.html` for the ZX Spectrum 48K app.
- `cpm.html` for the CP/M 2.2 terminal app.

The Spectrum viewer loads the 48K ROM, runs the headless machine, draws the
320x240 border/display frame, and passes browser key events into the Spectrum
keyboard matrix.

`ROM/48.rom` is included so the browser demo can boot without extra setup. The
emulator code is MIT licensed; the ROM image is not part of that code license.
See [ROM/README.md](ROM/README.md) for the ROM notice.

The `Paste BASIC` box accepts normal PC text. Numbered listings are loaded
directly into BASIC memory and then `RUN` is typed automatically unless the
paste includes unnumbered commands. Listings with line numbers above the real
Spectrum editor limit are renumbered before loading.

The `BASIC Source` controls load `.bas` or plain-text listings directly from
disk using the same tokenizer as paste loading. `Export BASIC` reads the current
program from `PROG` to `VARS`, detokenizes Spectrum keyword bytes, skips hidden
numeric markers, and downloads editable text as `zx-spectrum-program.bas`.

The `Load TAP` panel accepts `.tap` and `.tzx` files. TAP containers and
standard-speed TZX data blocks are parsed into header/data blocks, showing block
name, type, length, checksum status, and whether the entry can be loaded by the
current fast-load path. Parsed files are also mounted as a virtual tape for the
Spectrum ROM loader. BASIC program entries are copied directly to the ROM BASIC
program area and auto-start with `RUN <line>` when the header contains an
auto-start line; later ROM `LOAD "" CODE` calls made by that loader are
satisfied from the mounted blocks in order. CODE entries can also be copied
directly to the start address from the header. When a loader drops into tape
polling instead of the ROM byte-loader entry point, standard-speed tape blocks
are played as EAR pulses on port `0xfe`. Array blocks, turbo/pure-data TZX
blocks, and more exact custom-loader timing are later work.

During pulse playback, flashing border colours are expected: that is the loader
polling the tape input. Large standard-speed blocks load at cassette speed, so a
50K-ish block can take around two minutes to finish.

The `Snapshots` panel accepts `.z80` files. Loading a snapshot restores the
Z80 registers, interrupt state, border colour, and all 48K RAM. Version 1
snapshots are supported with compressed or uncompressed RAM; extended snapshots
are supported when they contain the normal 48K pages. `Save Z80 Snapshot`
downloads the current emulator state as an uncompressed version 1 `.z80` file.
This is the most convenient way to save a BASIC program or a game position in
the browser: it preserves the whole machine state, not just the BASIC listing.

The CP/M page defaults to the z80pack profile: A: is the bundled system disk,
B: is a blank work disk, and C: is the z80pack companion disk. Use the machine
profile control to switch to Z80-MBC2, which boots `DS0N00.DSK` and mounts
`DS0N00.DSK` through `DS0N06.DSK` as A: through G:. In the Z80-MBC2 profile,
F: and G: are labelled as work/scratch disks and changes to those drives are
saved to the user's browser-local IndexedDB storage. Nothing is written back to
GitHub; whole-disk downloads remain the portable per-disk backup path. For a
full resume point, `Save Session` downloads a compressed `.zip` containing RAM,
CPU registers, terminal screen state, active CP/M profile, selected controls,
and all mounted disk bytes. `Load Session` restores that ZIP locally in the
browser, so it works on GitHub Pages without accounts, uploads, or repository
writes. The file panel can import host files into a selected CP/M drive,
download CP/M files back to the host, and delete files. The disk controls can
load or save a whole `.dsk` image for the selected drive, restore a drive to its
bundled image, or clear local browser disk changes. The Foreign Disk panel can
still load Z80-MBC2 8 MB disk images, list their directories, and copy selected
files into the currently selected CP/M drive. The Debug Drawer below the terminal
mirrors the Spectrum debugger at CP/M scale: it shows registers, flags,
disassembly at `PC`, z80pack FDC or Z80-MBC2 IOS disk state, console queue
counts, and a placeholder for later BIOS/BDOS call tracing. See
[CP/M Browser Guide](docs/cpm22-browser-guide.md) for the exact workflow.

## GitHub Pages Demo

The browser app is static and can be published with GitHub Pages. The app uses
relative module and asset paths so it works both at `localhost:3000` and under a
project Pages URL such as:

```text
https://chriswilson2020.github.io/zx-spectrum-emulator/
```

Build the deployable static tree locally with:

```sh
npm run build:pages
```

This writes `dist/` with `index.html`, `spectrum.html`, `cpm.html`, `public/`,
`src/`, and `ROM/` when the ROM directory is present. The workflow in
`.github/workflows/pages.yml` runs the unit suite, builds `dist/`, uploads it as
a Pages artifact, and deploys it when changes land on `main` or when the
workflow is run manually. In GitHub, set
`Settings -> Pages -> Build and deployment -> Source` to `GitHub Actions`.

The debugger is designed for the browser viewport rather than as a fixed-size
desktop panel. On wide screens the Spectrum display remains in the left pane
with a compact machine console on the right. Secondary tools are grouped into
tabs for BASIC, Tape, Snapshots, and Debug, while the detailed register,
disassembly, BASIC, and memory views live in a collapsible Debug Workbench below
the display. The canvas starts scaling down before the layout becomes cramped,
and below tablet widths the console and workbench stack into a single column.

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
- [CP/M Browser Guide](docs/cpm22-browser-guide.md): using the browser CP/M
  machine, disk workflow, file import/export, and WordStar setup.
- [CP/M 2.2 Machine Plan](docs/cpm22-bootable-machine-plan.md): design notes
  and implementation status for the bootable CP/M target.
- [Opcode Coverage](docs/opcode-coverage.md): decoder coverage probe notes.
- [Roadmap](docs/roadmap.md): high-level project phases.

## License

The emulator code is licensed under the MIT License. See [LICENSE](LICENSE).

Third-party validation material under `ZEXALL-main/` is GPLv2-licensed and is
kept separate from the emulator runtime. The bundled CP/M disk image comes from
Udo Munk's MIT-licensed z80pack project. See
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

The emulator is being built as a small lab for Z80 machines: a faithful ZX
Spectrum emulator, a browser-bootable CP/M machine, and a teaching environment
for Z80 assembly, Sinclair BASIC, and classic 8-bit workflows. The immediate
next engineering milestones are richer Spectrum tape/hardware accuracy and
polishing the CP/M disk persistence and application workflow.
