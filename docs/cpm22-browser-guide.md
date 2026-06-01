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
- `B:` through `G:` are the matching Z80-MBC2 data disks.

The disk image selector beside `Load Disk` and `Save Disk` controls which whole
disk image is loaded or downloaded. The file-browser drive selector controls
which CP/M directory is shown and which drive receives imported host files.

## Whole-Disk Workflow

Use whole-disk load/save when you want to preserve a CP/M session exactly:

1. Select `B: Work Disk` in the disk image selector.
2. Click `Load Disk` to mount an existing `.dsk` file into B:.
3. Work in CP/M.
4. Click `Save Disk` to download the current selected drive image.

The downloaded image is named for the selected drive, such as
`cpm22-drive-b.dsk` or `cpm22-drive-c.dsk`. Keep this file if you want to resume
the same CP/M disk later.

The current implementation keeps mounted disks in memory during the page
session. It does not yet auto-save to IndexedDB between visits, so download
modified disks before closing or reloading the page.

## File Import And Export

The file panel edits the CP/M filesystem inside the selected disk image.

- `Import File` copies a host file into the selected CP/M drive.
- `Download File` downloads the selected CP/M file to the host.
- `Delete File` deletes the selected CP/M file from the selected drive.
- `Refresh` rereads the selected drive directory.

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

- Disk persistence is explicit download/upload; automatic IndexedDB restore is
  still future work.
- The filesystem helper currently targets the z80pack CP/M 2.2 floppy geometry,
  plus Z80-MBC2 8 MB images for foreign-disk reading. It is not a general CP/M
  disk-format library.
- The terminal implements the control sequences needed by the current WordStar
  path, but it is not a complete emulation of every terminal listed by
  WordStar.
- Printer output is not routed to a browser printer or file yet.
