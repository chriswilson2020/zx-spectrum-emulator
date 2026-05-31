# Emulator Roadmap

## Phase 1: Z80 Core

- Complete documented base opcodes. Done.
- Add CB, ED, DD, FD, DDCB, and FDCB prefixed opcode handling. Done.
- Implement exact flag behaviour, including undocumented X/Y flag copies. Done.
- Track `WZ/MEMPTR`, `Q`, and instruction-level T-states. Done.
- Add interrupt modes 0, 1, and 2, plus NMI entry. Done.
- Validate against SingleStep, `zexdoc`, and `zexall`. Done.

## Phase 2: ZX Spectrum 48K

- Add a `Spectrum48` machine wrapper.
- Add ROM loading at `0x0000-0x3fff`.
- Add RAM at `0x4000-0xffff`.
- Implement port `0xfe` keyboard reads and border/beeper writes.
- Run a 50 Hz frame loop that raises an IM 1 interrupt.
- Model the ULA display file and attribute memory.
- Add beeper output.
- Add contention timing after the basic frame loop works.
- Load/save TAP first, then TZX.

## Phase 3: Teaching Tools

- Add an assembler-backed code editor.
- Add register, memory, stack, and disassembly views.
- Add step/run/breakpoint controls.
- Add BASIC examples that run through the real ROM.
- Add guided lessons for Z80 flags, loops, interrupts, and screen memory.
