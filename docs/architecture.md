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

### `src/spectrum48.js`

`Spectrum48` is the first machine layer around the CPU. It owns:

- A copied 16K ROM image at `0x0000-0x3fff`
- 48K RAM at `0x4000-0xffff`
- A `Z80` instance wired to the machine memory and I/O callbacks
- Port `0xfe` keyboard, border, and beeper state
- A frame counter and 50 Hz frame runner
- ULA display and full-frame RGBA render helpers
- Beeper transition capture with CPU t-state timestamps

The machine exposes `pressKey` and `releaseKey` for Spectrum key names. The
keyboard matrix is active-low and is read through the same port path the ROM
uses.

### `src/cpm22.js`

`Cpm22Machine` is a second machine layer around the CPU. It is not a Spectrum
mode. It owns:

- 64K flat RAM.
- A `Z80` instance wired to CP/M memory and z80pack-compatible I/O callbacks.
- Console input and output queues.
- A selected drive, track, sector, DMA address, and FDC status byte.
- One or more `RawCpmDisk` drive images.

On reset, the machine clears RAM, loads drive A track 0 sector 1 at `0x0000`,
resets the CPU, and lets the z80pack boot sector load CP/M through the virtual
FDC ports. There is no BDOS trap in this boot path; the real CP/M CCP, BDOS,
and BIOS come from the disk image.

Console input uses z80pack ports `0x00` and `0x01`. If CP/M executes a direct
`IN A,(1)` while no browser key is queued, `step()` waits in place instead of
returning a synthetic NUL. This models blocking console input closely enough
for the CCP prompt and interactive programs.

Disk I/O uses z80pack/cpmsim FDC ports:

- `0x0a`: selected drive.
- `0x0b`: track.
- `0x0c`: sector low byte.
- `0x0d`: command, where `0` reads and `1` writes.
- `0x0e`: status/result.
- `0x0f`: DMA address low byte.
- `0x10`: DMA address high byte.
- `0x11`: sector high byte.

The current browser target uses the z80pack CP/M 2.2 8-inch floppy geometry.
The FDC status codes follow z80pack's convention for invalid drive, track,
sector, and command errors.

### `src/z80mbc2.js`

`Z80Mbc2Machine` is the native Z80-MBC2 CP/M hardware profile. It shares the
same Z80 core and flat 64K RAM model, but emulates the Z80-MBC2 IOS protocol
instead of z80pack's FDC ports.

On reset it loads the CP/M system image from `DS0N00.DSK` into memory at
`0xd200` and starts execution at the BIOS jump table at `0xe800`. The loaded
image contains the real CCP, BDOS, and Z80-MBC2 BIOS. The BIOS then performs
normal CP/M setup and can warm-boot by reading 512-byte host sectors from drive
A.

`RawZ80Mbc2Disk` wraps 8 MB Z80-MBC2 disk images:

- 512 tracks.
- 32 host sectors per track.
- 512 bytes per host sector.
- 8,388,608 bytes total.

The IOS protocol uses port `0x01` for opcode selection and serial input, and
port `0x00` for opcode data/results. The first implemented opcodes cover serial
output/input status, disk selection, track/sector selection, 512-byte sector
read/write, disk error status, and SD mount status.

The bundled R140319 BIOS is run in a blocking console-status mode. In browser
frame slices, reporting "character ready" through the IOS `SYSFLAG` path lets
the BIOS line editor see a pending character before `CONIN` consumes it, which
duplicates typed CCP commands. The emulator therefore lets `CONIN` read the
serial byte directly and reports the status bit as empty by default. This keeps
one-key-at-a-time browser typing aligned with the real command line while still
allowing an opt-in polling status mode for diagnostic experiments.

### `src/cpm-disk.js`

`RawCpmDisk` wraps raw z80pack floppy images. The default geometry is:

- 77 tracks.
- 26 sectors per track.
- 128 bytes per sector.
- 256,256 bytes total.

It validates sector addresses, reads and writes sectors, tracks a dirty flag,
and can create a blank CP/M work disk filled with `0xe5`.

### `src/cpm-filesystem.js`

`CpmFileSystem` is a host-side utility for editing files inside CP/M disk
images. It is used by the browser file panels, not by the emulated machine. The
CP/M machine still sees only sector reads and writes.

The helper understands:

- z80pack CP/M 2.2 floppies with two reserved system tracks, skewed 128-byte
  sectors, 1K allocation blocks, and 64 directory entries.
- Z80-MBC2 CP/M 2.2 8 MB images with 512-byte host sectors, 32 host sectors per
  track, optional one-track system reservation, 4K allocation blocks, 512
  directory entries, and 16-bit allocation block pointers.
- 128-record CP/M extents, including Z80-MBC2 `EXM=1` entries that can describe
  more than 128 records in one directory entry.
- CP/M 8.3 filename normalization.

It can list, read, write, overwrite, and delete user 0 files. It writes full
extents with record count `80h`, which real CP/M loaders require, and can repair
older images that incorrectly used `00` for full extents.

### `public/`

The browser apps are intentionally thin. `public/index.html` is the machine
selector. `public/spectrum.html` hosts the Spectrum viewer and `public/cpm.html`
hosts the CP/M terminal.

`public/app.js` owns the Spectrum page loop, loads `ROM/48.rom`, drives
`Spectrum48`, renders the frame buffer to canvas, and bridges browser controls
into the machine.

`public/keyboard.js` translates modern PC keys and pasted text into Spectrum
key chords. `public/basic.js` tokenizes Sinclair BASIC for direct loading into
the ROM's program area, including keyword tokens, number markers, line
renumbering, and `DEF FN` parameter storage expected by the ROM evaluator. It
also detokenizes the current program back to editable text for `.bas` export.
`public/audio.js` converts beeper transitions into Web Audio sample buffers.
`public/debugger.js` supplies browser-friendly debug helpers: hex formatting,
small-window disassembly, system variable reads, BASIC status extraction, and
memory row formatting.
`public/tape.js` parses TAP containers and standard-speed TZX data blocks,
validates block checksums, pairs header blocks with data blocks, and implements
the first fast-load path for BASIC program and CODE blocks.
`public/snapshot.js` parses and writes 48K `.z80` snapshots so the browser can
restore complete RAM/register state or download the current state for later.

`public/cpm-app.js` owns the CP/M page loop and profile switcher. The z80pack
profile loads `ROM/cpm22-1.dsk` and `ROM/cpm22-2.dsk`, mounts them as A: and
C:, creates a blank B: work disk, and drives `Cpm22Machine` in animation-frame
slices. The Z80-MBC2 profile loads `ROM/DS0N00.DSK` through `ROM/DS0N06.DSK`,
mounts them as A: through G:, and drives `Z80Mbc2Machine`. Both profiles share
keyboard bridging, disk upload/download, host file import/export, foreign disk
import controls, and the CP/M filesystem helper.

The CP/M page uses IndexedDB as an optional browser-local disk cache. Bundled
disk images are still fetched from GitHub Pages as immutable defaults. Local
records are keyed by machine profile and drive index, and only changed drives
are stored. The Z80-MBC2 profile automatically persists writes to the labelled
F: work and G: scratch disks; manually loaded disk images are persisted as
explicit local overrides for the selected drive. Restore and clear controls
delete those local overrides and fall back to the bundled disk bytes.

The CP/M page also supports portable whole-session files. `public/cpm-session.js`
creates and reads small ZIP archives in the browser, using raw deflate through
`CompressionStream`/`DecompressionStream` when available and falling back to
stored ZIP entries when compression is not available. A session ZIP contains
`manifest.json`, `machine/state.json`, `machine/ram.bin`, `terminal.json`, and
one `drives/<letter>.dsk` entry per mounted drive. The machine state is restored
through `Z80.setState()` plus the active CP/M machine layer's `restoreState()`,
so a loaded session resumes the same profile, CPU registers, RAM, terminal
screen, selected controls, and disk bytes entirely on the client.

`public/cpm-terminal.js` renders CP/M console output into an 80x24 screen
buffer. It supports the control behavior needed by full-screen CP/M software
such as WordStar's Soroc IQ-120/140 profile: cursor addressing, clear screen,
erase-to-end-of-line, scrolling, tabs, backspace, and control-byte filtering.

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

Ports are passed as 16-bit Z80 port addresses. The Spectrum machine layer
currently decodes:

- `0xfe` keyboard reads
- Border and beeper writes

Floating bus behaviour and exact contention are later accuracy work.

Beeper writes are also recorded as timed transitions. The browser drains those
events and schedules short mono buffers through Web Audio. This is intentionally
buffer-based and simple for now; exact speaker filtering and contention-aware
timing are future accuracy work.

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

The browser debugger consumes this state live. It shows register pairs, `I`,
`R`, interrupt mode, total T-states, active flags as visual pills, a small
disassembly window around `PC`, BASIC status (`ERR_NR`, current line, and
sub-statement), and memory inspections for `PROG`, `VARS`, `E_LINE`, screen
memory at `0x4000`, and system variables around `0x5c00`.

The disassembler is intentionally partial and conservative. It renders common
base Z80 instructions and control flow mnemonics that are useful when watching
the ROM. Unknown or less common opcode forms fall back to byte output instead
of showing a misleading mnemonic.

## Browser Layout

The viewer uses CSS grid with responsive breakpoints. The preferred layout keeps
the Spectrum display and debugger in the left pane with machine controls in a
right rail. The rail is treated as a compact machine console: immediate run,
step, reset, and sound controls remain visible, while BASIC, Tape, Snapshots,
and Debug tools are grouped behind a tabbed switcher. The heavier debugger cards
sit in a collapsible Debug Workbench below the display so normal play keeps the
screen dominant, but register, BASIC, disassembly, and memory panels are still
one click away. The canvas has a viewport-aware maximum size so it scales down
before colliding with the controls, and narrow widths stack the console and
workbench into one column.

## Spectrum Runtime

`Spectrum48.runFrame()` requests a maskable interrupt and then runs one PAL frame
worth of CPU time. This is sufficient for the 48K ROM to maintain its interrupt
service work and for the browser UI to animate the display.

Video rendering reads the Spectrum display file directly:

- Bitmap pixels from `0x4000-0x57ff`
- Attributes from `0x5800-0x5aff`

The renderer supports the Spectrum line-address layout, ink/paper attributes,
bright colours, flash state supplied by the viewer, and border composition. It
does not yet model per-scanline contention or floating bus timing.

## CP/M Runtime

Both CP/M machine profiles run without a frame interrupt or video hardware. The
browser advances the active machine in short instruction slices on
`requestAnimationFrame`, then drains console output into the terminal buffer.
CP/M application timing is therefore cooperative and terminal-driven rather than
display-frame-driven.

The z80pack profile starts with three mounted disks:

- A: `ROM/cpm22-1.dsk`, the z80pack CP/M 2.2 system disk.
- B: a blank raw z80pack floppy filled with `0xe5`.
- C: `ROM/cpm22-2.dsk`, the matching upstream z80pack companion disk.

The Z80-MBC2 profile starts with seven mounted 8 MB disks:

- A: `ROM/DS0N00.DSK`, the Z80-MBC2 CP/M 2.2 boot disk.
- B: through E: `ROM/DS0N01.DSK` through `ROM/DS0N04.DSK`.
- F: `ROM/DS0N05.DSK`, labelled as a local work disk.
- G: `ROM/DS0N06.DSK`, labelled as a local scratch disk.

When a user imports or deletes a CP/M file through the file panel, the helper
edits the selected disk image, then the machine is remounted from the current
drive bytes. This lets CP/M rebuild its allocation map on reboot instead of
continuing with stale in-memory disk state.

Whole-disk upload and download operate on the selected drive image for the
active profile. Loading a disk validates against the active profile's image type
and remounts the profile's drives. Saving downloads the selected drive's current
bytes. Browser-local persistence is a convenience cache only: it never writes to
GitHub, it is scoped to the user's current browser storage, and downloading a
disk remains the durable portable backup.

The CP/M filesystem helper repairs old full-extent directory entries at mount
time. This matters for multi-extent `.COM` files such as WordStar's
`INSTALL.COM`: real CP/M expects a full extent to have record count `80h`, not
`00`.

## BASIC Loading

The paste loader in `public/basic.js` writes tokenized BASIC directly into the
program area starting at `PROG`, then updates the relevant BASIC system
variables (`VARS`, `E_LINE`, `K_CUR`, `WORKSP`, `STKBOT`, and `STKEND`).

This path is faster and more reliable than typing long listings through the ROM
editor, but it must still store the bytes the ROM evaluator expects. In
particular, `DEF FN` parameters include hidden placeholder number markers in the
line body; without them the ROM raises `Q Parameter error` when `FN` is called.

The file loader uses the same tokenizer for `.bas` and plain-text files. The
export path reads bytes from `PROG` to `VARS`, walks each Spectrum line header,
converts token bytes back to their keyword text, and skips hidden numeric
marker records (`0x0e` plus five bytes). That makes exported listings suitable
for editing, sharing, and source control, while `.z80` snapshots remain the
right tool for preserving complete machine state.

## Tape Loading

The first tape path is a pragmatic fast loader rather than an audio/pulse-level
emulation of cassette input. `parseTap()` reads TAP containers as a sequence of
length-prefixed blocks. `parseTzx()` supports TZX standard-speed data blocks
(`0x10`) and skips common descriptive metadata blocks. Header blocks decode the
Spectrum header payload: type, 10-character name, data length, and two
type-specific parameters. Data blocks keep their payload and checksum status.

The UI presents header/data pairs as tape entries. The current loader supports:

- BASIC program blocks (`type 0`): payload bytes are copied directly to `PROG`.
  `VARS`, `E_LINE`, `K_CUR`, `WORKSP`, `STKBOT`, and `STKEND` are updated in the
  same style as the BASIC paste loader. Header parameter 2 is used as the
  variables offset, and header parameter 1 is used as an optional auto-start
  line.
- CODE blocks (`type 3`): payload bytes are copied to the start address in
  header parameter 1.

Parsed tape files are also mounted into the machine as a virtual tape. The
first path is a fast ROM byte-loader intercept: when the 48K ROM reaches
`0x0556`, the machine checks the next block against the ROM's requested flag
byte, destination in `IX`, and length in `DE`. Matching blocks are copied into
the requested buffer, carry is set for a successful ROM return, and the tape
cursor advances. This lets multi-block BASIC loaders such as
`LOAD "" CODE: LOAD "" CODE: RANDOMIZE USR n` continue through the original ROM
control flow.

The second path is standard-speed pulse playback. Mounted tape blocks can be
expanded into Spectrum cassette pulses: pilot tone, sync pulses, and two pulses
per data bit using the ROM timings. The machine exposes those transitions as
the EAR bit on port `0xfe`, while pauses advance time without toggling the EAR
level. This covers standard TZX blocks that are read by polling code instead of
calling the ROM byte-loader entry point.

Number-array and character-array blocks are parsed and displayed but not loaded
yet. TZX turbo and pure-data blocks remain future work for software with
non-standard cassette timings.

## Snapshot Loading

The snapshot module supports the 48K `.z80` paths used by many Spectrum tools:

- Version 1 snapshots with uncompressed 48K RAM.
- Version 1 snapshots with `ED ED count value` compressed RAM.
- Extended `.z80` snapshots that contain 48K pages 8, 4, and 5, mapped to
  `0x4000`, `0x8000`, and `0xc000`.

Loading a snapshot writes the saved CPU registers, alternate registers, `I`,
`R`, `IX`, `IY`, `SP`, `PC`, interrupt flip-flops, interrupt mode, border
colour, and 48K RAM into the live `Spectrum48` instance. Transient browser-side
state such as held keys, beeper events, tape playback, and the frame counter is
cleared so the restored machine resumes from a clean input/audio boundary.

Saving writes an uncompressed version 1 `.z80` file. This keeps the output simple
and widely compatible while preserving the whole 48K machine state, which is
enough to save BASIC programs typed in the browser as well as game positions.

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
