# TRS-80 Model III Machine Layer Design

## Goal

Add a first TRS-80 machine layer around the existing Z80 core, targeting the
TRS-80 Model III before attempting broader Model I, Model II, or Model 4
compatibility.

## Scope

The first slice created a headless `Trs80Model3Machine` with ROM/RAM mapping,
memory-mapped keyboard rows, memory-mapped 64x16 text video, CPU ownership,
frame-sized execution, and compact debug state. Later slices added a browser
page, plain-text typing, Level II BASIC and SYSTEM CAS loading, cassette pulse
playback, and portable session save/restore. Floppy disk emulation, Model I
compatibility mode, Model II, and Model 4 native/banked behavior remain outside
the current scope.

## Current Status

- `public/trs80.html` and `public/trs80-app.js` provide a browser Model III
  viewer with run/pause, frame-step, instruction-step, reset, ROM upload,
  plain-text typing, startup prompt helpers, cassette controls, session
  save/load, and a compact debug drawer.
- `src/trs80-cassette.js` parses Level II BASIC CAS files and TRS-80 SYSTEM
  machine-code CAS files. BASIC entries are relocated into ROM BASIC RAM.
  SYSTEM entries are loaded to their encoded addresses and start by setting
  `PC` to the tape entry point.
- `saveState()` and `restoreState()` preserve RAM, video RAM, CPU state,
  keyboard rows, halted state, frame count, and cassette cursor metadata in a
  local JSON session file.

## Architecture

The TRS-80 layer stays separate from `Spectrum48`, `Cpm22Machine`, and
`Z80Mbc2Machine`. It shares only the CPU core and general machine conventions:
the machine owns a `Z80` instance, exposes memory callbacks to the CPU, and
supplies small public methods for stepping, frame running, keyboard state,
display inspection, and debugging.

The first implementation lives in `src/trs80-model3.js`. A future refactor can
split shared TRS-80 helpers into `src/trs80/` when Model I or Model 4 work
creates real duplication. Model II is explicitly out of this family slice
because it is a different business-machine line with different hardware
assumptions.

## Model III Map

The initial Model III map follows the commonly documented Level II layout:

- `0x0000-0x37ff`: 14K ROM.
- `0x3800-0x3bff`: memory-mapped keyboard matrix.
- `0x3c00-0x3fff`: 1024 bytes of text video RAM, 16 rows by 64 columns.
- `0x4000-0xffff`: 48K RAM.

Writes to ROM and keyboard addresses are ignored. Writes to video memory update
the video RAM bytes. Reads from keyboard addresses return the selected
active-high row byte, with zero meaning no key is pressed.

## Public API

- `new Trs80Model3Machine({ rom })`: create a machine from a 14K byte array.
- `Trs80Model3Machine.fromRomFile(path)`: load a 14K ROM from disk in Node.js.
- `read8(address)`, `write8(address, value)`, `read16(address)`,
  `write16(address, value)`: memory map access.
- `step()`: execute one CPU instruction.
- `runTStates(targetTStates)`: run instructions until at least the requested
  cycle count has elapsed.
- `runFrame()`: request the Model III heartbeat interrupt and run one frame.
- `reset()`: reset CPU/frame state while preserving ROM, RAM, video, and
  keyboard state.
- `pressKey(key)`, `releaseKey(key)`, `getPressedKeys()`: update and inspect
  keyboard matrix state.
- `setCassetteBlocks(blocks)`, `clearCassette()`, `startCassettePlayback()`,
  `stopCassettePlayback()`, `setCassetteCursor(index)`: mount and drive parsed
  cassette data.
- `saveState()`, `restoreState(state)`: round-trip portable Model III session
  state.
- `renderTextDisplay()`: return the 16 screen rows as 64-character strings.
- `getDebugState()`: return CPU, halt, frame, keyboard, and display state.

## Testing

Tests cover ROM size validation, memory map behavior, ignored ROM/keyboard
writes, video memory writes, 16-bit reads and writes across the map, CPU
instruction fetch through the machine, frame execution, interrupt request,
keyboard matrix reads, pressed-key diagnostics, text display rendering, debug
state shape, session save/restore, browser typing, startup prompts, BASIC CAS
loading, SYSTEM CAS loading, corrupt SYSTEM checksums, and cassette pulse
playback.

## Follow-Ups

- Improve TRS-80 text rendering with proper glyph bitmaps, inverse video, and a
  CRT-style canvas option.
- Add floppy controller support only when DOS boot becomes the next goal.
- Add Model I as a follow-up profile once shared text/keyboard/cassette pieces
  are proven.
- Add Model 4 compatibility later, beginning with Model III compatibility mode
  before native Model 4 memory banking or 80x24 display work.
