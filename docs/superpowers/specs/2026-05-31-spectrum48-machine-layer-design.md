# Spectrum48 Machine Layer Design

## Goal

Build the first headless ZX Spectrum 48K machine wrapper around the validated
Z80 core so real 48K ROM bytes can be mapped, fetched, and executed through a
Spectrum-shaped memory and I/O boundary.

## Scope

This slice creates a `Spectrum48` class with ROM/RAM mapping, CPU ownership,
basic I/O hooks, a frame-sized run helper, keyboard matrix support, and initial
display rendering. It does not model contention, produce audio, or implement
tape/snapshot formats yet.

## Architecture

`Spectrum48` owns a `Z80` instance and exposes the memory object expected by the
CPU. The class maps a 16K ROM at `0x0000-0x3fff` and 48K RAM at
`0x4000-0xffff`. ROM writes are ignored, while RAM writes update the backing
RAM array.

The machine also supplies basic I/O callbacks to the CPU. For this milestone,
port `0xfe` reads return active-low keyboard matrix rows and writes update
border colour and beeper state fields. This gives later audio and timing work a
stable place to attach without changing the CPU core.

## Public API

- `new Spectrum48({ rom })`: create a machine from a 16K byte array.
- `Spectrum48.fromRomFile(path)`: load a 16K ROM from disk.
- `read8(address)`, `write8(address, value)`, `read16(address)`, `write16(address, value)`: memory map access.
- `readPort(port)`, `writePort(port, value)`: machine I/O access.
- `step()`: execute one CPU instruction.
- `runTStates(targetTStates)`: run instructions until at least the requested cycle count has elapsed.
- `runFrame()`: run one 50 Hz PAL frame worth of CPU time and request a maskable interrupt.
- `reset()`: reset the CPU and frame counter while preserving ROM/RAM contents.
- `pressKey(key)`, `releaseKey(key)`, `getPressedKeys()`: update and inspect the Spectrum keyboard matrix.
- `renderDisplayRgba(options)`, `renderFrameRgba(options)`: render the Spectrum display file and border.

## Testing

Tests cover ROM size validation, ROM reads, ignored ROM writes, RAM
reads/writes, little-endian 16-bit access across the machine map, loading
`ROM/48.rom`, CPU fetching through the machine memory callbacks, port `0xfe`
state, keyboard rows, frame stepping, display rendering, browser keyboard
translation, and BASIC paste loading.

## Open Follow-Ups

- Add debugger views for registers, memory, disassembly, and stepping.
- Add TAP loading through the ROM.
- Produce audio from the beeper bit.
- Add ULA contention once the basic machine loop works.
