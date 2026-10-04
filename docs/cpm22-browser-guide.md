# CP/M Browser Guide

This project includes a bootable CP/M 2.2 machine target at `cpm.html`. It is a
separate machine from the ZX Spectrum layer and shares only the Z80 CPU core and
general browser infrastructure.

## Starting The Machine

Run the local static server:

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then choose `CP/M 2.2` from
the machine selector. The CP/M page can also be opened directly at
[http://localhost:3000/cpm.html](http://localhost:3000/cpm.html).

The CP/M page defaults to the z80pack machine profile. It boots from
`ROM/cpm22-1.dsk`, a z80pack CP/M 2.2 system disk. On a normal boot the
terminal prints the Z80SIM CP/M banner and reaches `A>`. `ROM/cpm22-2.dsk` is
also bundled as the matching upstream companion disk and is mounted as `C:` by
default.

Use the machine profile control on the CP/M page to switch between:

- `z80pack`: the current z80pack/cpmsim-compatible floppy machine.
- `Z80-MBC2`: a native Z80-MBC2 IOS machine that boots `ROM/DS0N00.DSK`.

## Drives

The z80pack profile mounts three drives by default:

- `A:` is the bundled system disk from `ROM/cpm22-1.dsk`.
- `B:` is a blank writable work disk.
- `C:` is the bundled companion disk from `ROM/cpm22-2.dsk`.

Use `B:` for uploaded files, experiments, editors, and saved work. The bundled
`A:` disk is a system disk and has very little free space. Keep `C:` as the
upstream companion disk unless you intentionally want to replace it with another
image through the disk controls.

The Z80-MBC2 profile mounts seven 8 MB drives by default:

- `A:` through `G:` map to `ROM/DS0N00.DSK` through `ROM/DS0N06.DSK`.
- `A:` is the Z80-MBC2 CP/M 2.2 boot disk.
- `B:` through `E:` are the matching Z80-MBC2 data disks.
- `F:` is labelled as a work disk and `G:` as a scratch disk.

The disk image selector beside `Load Disk` and `Save Disk` controls which whole
disk image is loaded or downloaded. The file-browser drive selector controls
which CP/M directory is shown and which drive receives imported host files.

## Whole-Disk Workflow

Use whole-disk load/save when you want a portable copy of one CP/M disk:

1. Select `B: Work Disk` in the disk image selector.
2. Click `Load Disk` to mount an existing `.dsk` file into B:.
3. Work in CP/M.
4. Click `Save Disk` to download the current selected drive image.

The downloaded image is named for the selected drive, such as
`cpm22-drive-b.dsk` or `cpm22-drive-c.dsk`. Keep this file if you want to reuse
the same CP/M disk later or move it to another emulator.

The Z80-MBC2 profile also supports browser-local disk persistence. Changes to
F: and G: are saved automatically in IndexedDB on the same browser/device. A
manually loaded disk image is also stored locally for the selected drive. On the
next visit, the page loads the bundled disk set from GitHub Pages, then replaces
any drives that have a local override. Drives with local overrides are marked
`local` in the selectors.

This storage is private to the browser. It is not uploaded to GitHub and is not
a substitute for a backup. Use `Save Disk` to download a portable `.DSK` copy.
Use `Restore Bundled` to discard the selected drive's local override and reload
the bundled image. Use `Clear Local` to remove all local disk overrides for the
active CP/M machine profile.

## Session Workflow

Use `Save Session` when you want to resume the emulator exactly where it is,
including full-screen applications.

The downloaded session is a compressed `.zip` file containing:

- a JSON manifest with the active CP/M machine profile and selected controls.
- CPU registers, interrupt state, and machine I/O state.
- the full 64K RAM image.
- the 80x24 terminal screen and cursor state.
- every mounted disk image.

`Load Session` reads the ZIP back into the browser and restores the active
profile, RAM, CPU, terminal, and mounted disks. This is all local file handling:
the ZIP is not uploaded to GitHub Pages, and no repository storage is used.

Session ZIPs are the friendliest project-file format for browser use because
they are portable, compressed, inspectable with normal operating-system tools,
and can still be loaded on a different browser or computer. Whole-disk `.dsk`
downloads remain better when you only want to carry one disk image to another
CP/M emulator.

## File Import And Export

The file panel edits the CP/M filesystem inside the selected disk image.

- `Import File` copies a host file into the selected CP/M drive.
- `Download File` downloads the selected CP/M file to the host.
- `Delete File` deletes the selected CP/M file from the selected drive.
- `Refresh` rereads the selected drive directory.

In the Z80-MBC2 profile, importing, deleting, copying from a foreign disk, or
writing from inside CP/M to F: or G: schedules a local browser save for that
whole disk image. Other drives remain memory-only unless you explicitly load a
replacement disk image or download them yourself.

Host filenames are converted to CP/M 8.3 names. For example, a host file named
`wordstar-install-notes.txt` is shortened and sanitized before it is written to
the disk.

The CP/M filesystem helper understands the z80pack 8-inch floppy layout:

- 77 tracks.
- 26 sectors per track.
- 128 bytes per sector.
- 2 reserved system tracks.
- 1K allocation blocks.
- 64 directory entries.
- z80pack/CP/M skew table.

It also writes full 128-record extents as `80h`, which is required by real CP/M
loaders. Older disks made before that fix may have full extents recorded as
`00`; the browser repairs those directory entries in memory when a disk is
mounted, and saving the disk writes the repaired image.

## Foreign Disk Import

The Foreign Disk panel reads CP/M disk images whose filesystem layout differs
from the running machine profile. It remains useful for copying files between
disk families. The first supported foreign format is Z80-MBC2 CP/M 2.2:

- `DS0N00.DSK`: 8 MB system disk with one reserved 16 KB track.
- `DS0N01.DSK` through similar data disks: 8 MB data disks with no reserved
  tracks.
- 512-byte host sectors, 32 host sectors per track.
- 4K allocation blocks.
- 512 directory entries.
- 16-bit CP/M allocation block numbers.

Load a foreign disk, select one or more files, keep the file-browser drive set
to `B: Work`, and click `Copy Selected To Drive`. The files are copied into the
normal writable B: disk, so CP/M can run portable `.COM` programs from B: even
though the running z80pack BIOS cannot mount the 8 MB disk directly.

Use `Copy All To Drive` carefully. The B: work disk is still a 256K z80pack
floppy, so a whole 8 MB foreign disk will not fit.

## Terminal Emulation

The browser terminal is an 80x24 screen buffer, not a simple output log. It
supports the control behavior needed by the current WordStar setup path:

- printable character overwrite at the current cursor position.
- carriage return and line feed.
- backspace and tab.
- scrolling.
- clear screen.
- erase to end of line.
- `ESC = row column` and `ESC Y row column` cursor addressing with space-based
  coordinates.
- filtering of unsupported low control bytes so they do not render as box
  glyphs.

This is enough for WordStar's Soroc IQ-120/140 profile to render its menu as a
screen instead of a stream of raw control characters.

## Debug Drawer

The CP/M page includes a compact `Debug Drawer` below the terminal. It is meant
to provide the same kind of always-available machine insight as the Spectrum
debugger, without taking over the normal CP/M workflow.

The drawer shows:

- live Z80 registers, interrupt mode, low t-state counter, and flags.
- a short disassembly window around the current `PC`.
- z80pack FDC state: drive, track, sector, DMA address, and FDC status.
- Z80-MBC2 IOS state: opcode, drive, track, sector, disk error, read/write
  buffer progress, and track-byte phase.
- console input/output queue lengths and halted/running state.
- a reserved `Recent Calls` panel. It currently reports that tracing is not
  enabled; later BIOS/BDOS tracing should feed this panel instead of adding a
  second debug surface.

## WordStar Setup

A typical WordStar 3.00 install flow from a B: work disk is:

1. Load the WordStar disk image as B:.
2. In CP/M, type `B:` and press Enter.
3. Type `INSTALL` and press Enter.
4. Choose normal first-time installation.
5. Select `K` for `Soroc IQ-120/140 terminal`.
6. For a simple browser setup, select:
   - `A` for a teletype-like printer.
   - `N` for no communications protocol.
   - `L` for CP/M List Output driver.
7. Confirm the selections.
8. When WordStar starts, use the on-screen menu normally.
9. Save the B: disk image from the browser after installation so `WS.COM` and
   any repaired directory records are preserved.

The important part is to save the disk after INSTALL finishes. Otherwise the
installed `WS.COM` only exists in the current browser session.

## Command-Line Smoke Test

You can boot the CP/M disk from the terminal without opening the browser:

```sh
npm run run:cpm22
```

That script boots `ROM/cpm22-1.dsk` and exercises the CP/M machine layer from
Node. It is useful for quick debugging, but the browser terminal and disk
controls still need browser testing when UI behavior changes.

## Current Limitations

- Browser-local disk persistence is intentionally limited to changed drives and
  currently auto-saves the Z80-MBC2 F: and G: work disks. Use `Save Disk` or
  `Save Session` for portable backups.
- The filesystem helper currently targets the z80pack CP/M 2.2 floppy geometry,
  plus Z80-MBC2 8 MB images for foreign-disk reading. It is not a general CP/M
  disk-format library.
- The terminal implements the control sequences needed by the current WordStar
  path, but it is not a complete emulation of every terminal listed by
  WordStar.
- Printer output is not routed to a browser printer or file yet.
- Session ZIPs preserve emulator state for this project, not a standardized
  CP/M interchange format.
