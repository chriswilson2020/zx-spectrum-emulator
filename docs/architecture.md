# Architecture

## Modules

### `src/z80.js`

The `Z80` class implements the CPU core. It owns registers, flags, hidden CPU
state, interrupt state, and instruction execution.

The constructor accepts:

- `memory`: an object with `read8(address)` and `write8(address, value)`
- `io`: optional `read(port)` and `write(port, value)` hooks

This keeps the CPU independent from any specific machine. The ZX Spectrum layer
will provide memory mapping, keyboard ports, ULA contention, and beeper I/O
through these boundaries.

### `src/memory.js`

`FlatMemory` is a simple 64K RAM implementation used by CPU tests and CP/M
exercisers. It provides:

- `read8`
- `write8`
- `read16`
- `write16`
- `load`

The Spectrum will need a mapped memory implementation rather than flat RAM:
ROM at `0x0000-0x3fff`, RAM at `0x4000-0xffff`, and later contention-aware
accesses.

## CPU Execution

`cpu.step()` executes one CPU event:

- If an NMI is pending, it services NMI.
- If a maskable interrupt is pending and accepted, it services the interrupt.
- If the CPU is halted, it consumes a 4 T-state HALT cycle.
- Otherwise it fetches and executes one instruction.

The method returns the number of T-states consumed by that event and increments
`cpu.tStates`.

## I/O Boundary

The CPU calls:

```js
io.read(port)
io.write(port, value)
```

Ports are passed as 16-bit Z80 port addresses. The Spectrum machine layer will
decode these for:

- `0xfe` keyboard reads
- Border and beeper writes
- Floating bus behaviour later, if needed

## Interrupt API

The CPU exposes:

```js
cpu.requestInterrupt(data)
cpu.clearInterrupt()
cpu.requestNmi()
```

Maskable interrupts are accepted only when `IFF1` is set and the `EI` delay has
expired.

Current interrupt entry behaviour:

- `IM 1`: pushes `PC`, clears `IFF1/IFF2`, jumps to `0x0038`
- `IM 2`: pushes `PC`, clears `IFF1/IFF2`, loads vector from `(I << 8) | data`
- `IM 0`: supports RST opcodes supplied as interrupt data; otherwise uses IM 1
  style entry
- `NMI`: pushes `PC`, copies `IFF1` to `IFF2`, clears `IFF1`, jumps to `0x0066`

Interrupt entry wakes `HALT` and increments the refresh register.

## Debug State

`cpu.getState()` returns a debugger-friendly snapshot with:

- Registers
- Decoded flags
- Interrupt mode
- `IFF1` and `IFF2`
- Pending interrupt state
- HALT state
- Total T-states

This is intended for the eventual web debugger and teaching UI.

## Validation Harnesses

### SingleStep

`scripts/run-singlestep.js` runs JSON instruction vectors and checks final CPU,
memory, port, cycle, `WZ`, and `Q` state. The vectors live in a local
`vendor/SingleStepTests-z80` checkout and are not committed to this repository
because the corpus is large.

### CP/M Exerciser Runner

`scripts/run-cpm-exerciser.js` runs CP/M `.COM` binaries by:

- Loading the program at `0x0100`
- Installing a minimal CP/M zero page
- Intercepting `CALL 0x0005`
- Supporting BDOS console functions `2` and `9`
- Ending on BDOS function `0` or warm boot at `0x0000`

This is used for `zexdoc.com` and `zexall.com`.
