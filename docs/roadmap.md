# Emulator Roadmap

## Phase 1: Z80 Core

- Complete documented base opcodes. Done.
- Add CB, ED, DD, FD, DDCB, and FDCB prefixed opcode handling. Done.
- Implement exact flag behaviour, including undocumented X/Y flag copies. Done.
- Track `WZ/MEMPTR`, `Q`, and instruction-level T-states. Done.
- Add interrupt modes 0, 1, and 2, plus NMI entry. Done.
- Validate against SingleStep, `zexdoc`, and `zexall`. Done.

## Phase 2: ZX Spectrum 48K

- Add a `Spectrum48` machine wrapper. Done.
- Add ROM loading at `0x0000-0x3fff`. Done.
- Add RAM at `0x4000-0xffff`. Done.
- Implement port `0xfe` keyboard reads and border/beeper writes. Done.
- Run a 50 Hz frame loop that raises an IM 1 interrupt. Done.
- Model the ULA display file and attribute memory. Done for whole-frame
  rendering.
- Add a browser canvas viewer with run/pause/reset controls. Done.
- Add visual debugger controls and live machine inspection. Done for pause,
  frame-step, instruction-step, registers, flags, disassembly, BASIC status,
  and memory panels.
- Add modern keyboard translation for normal PC keyboards. Done.
- Add direct Sinclair BASIC paste loading. Done for tokenized program loading,
  automatic renumbering, `RUN`, and `DEF FN` placeholders.
- Add BASIC listing import/export. Done for `.bas`/text import and detokenized
  editable `.bas` export from the live BASIC program area.
- Add beeper output. Done for a first Web Audio buffer-based implementation.
- Add TAP/TZX loading. Done for parsed TAP files, standard-speed TZX data
  blocks, fast-loading BASIC/CODE header-data pairs, and ROM byte-load
  interception, plus standard-speed EAR pulse playback.
- Add `.z80` snapshot save/load. Done for 48K version 1 save, compressed and
  uncompressed version 1 load, and extended 48K page-block load.
- Add contention timing after the basic frame loop works.
- Add fuller TZX support after the standard-speed block path: turbo blocks,
  pure-data blocks, and tougher custom loaders.

## Phase 3: Teaching Tools

- Add an assembler-backed code editor.
- Add register, memory, stack, and disassembly views. Started with live
  register, memory, BASIC, and disassembly panels.
- Add step/run/breakpoint controls. Started with run/pause, frame-step, and
  instruction-step; breakpoints remain.
- Add BASIC examples that run through the real ROM.
- Add guided lessons for Z80 flags, loops, interrupts, and screen memory.

## Phase 4: CP/M 2.2 Machine

- Add a separate bootable CP/M 2.2-compatible machine layer beside
  `Spectrum48`, sharing the Z80 CPU core but not Spectrum hardware behavior.
  Done.
- Define a small project-specific CP/M virtual machine with 64K RAM, terminal
  console, real boot-sector startup, and raw disk-image-backed drives. Done.
- Boot from a known CP/M 2.2 system disk image rather than injecting BDOS/CCP
  directly into RAM. Done with `ROM/cpm22-1.dsk` from z80pack.
- Support GitHub Pages deployment with static factory disk images and
  upload/download of `.dsk` images. Done.
- Mount a blank B: work disk by default so imports do not fill the A: system
  disk, and mount the upstream companion disk as C:. Done.
- Add host-side CP/M file import, download, delete, and directory listing for
  the z80pack CP/M 2.2 floppy layout. Done.
- Add a screen-buffer terminal suitable for full-screen CP/M software. Done for
  WordStar's Soroc IQ-120/140 profile.
- Add IndexedDB working-disk persistence and named saved disks. Future work.
- See [CP/M 2.2 Bootable Machine Plan](cpm22-bootable-machine-plan.md).
