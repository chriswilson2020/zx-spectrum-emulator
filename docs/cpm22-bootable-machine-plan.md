# CP/M 2.2 Bootable Machine Design And Status

This document began as the development plan for the CP/M target. It now also
records the implemented design so future changes do not accidentally blur the
CP/M machine with the ZX Spectrum machine.

## Recommendation

Build the CP/M 2.2 machine layer in this repository, beside the ZX Spectrum
machine layer.

The existing repository already contains the validated Z80 CPU core, memory
helpers, CP/M exerciser assets, GitHub Pages deployment path, and architecture
docs. CP/M should become a second machine target that shares the CPU core with
`Spectrum48`, not a fork of the project and not a mode inside the Spectrum
machine.

A separate repository may make sense later if the CP/M target grows into an
independent emulator product or a reusable package, but starting in this repo
keeps CPU fixes, validation, browser infrastructure, and documentation in one
place while the machine contract is still being discovered.

## Current Status

The initial CP/M target is implemented in this repository:

- `src/cpm22.js` boots a z80pack CP/M 2.2 disk through the real boot sector.
- `src/cpm-disk.js` provides raw z80pack floppy images, sector addressing,
  dirty tracking, and blank disk creation.
- `src/cpm-filesystem.js` lists, reads, writes, deletes, and repairs files in
  the z80pack CP/M 2.2 floppy filesystem.
- `public/cpm.html`, `public/cpm-app.js`, and `public/cpm-terminal.js` provide
  the browser CP/M terminal and disk/file controls.
- `scripts/run-cpm22.js` provides a command-line smoke path.
- `test/cpm*.test.js` cover disk geometry, booting, FDC I/O, console behavior,
  CP/M command smoke tests, filesystem import/export, terminal rendering, and
  WordStar-related regressions.

The implemented browser workflow mounts the factory CP/M system disk as A:, a
blank writable work disk as B:, and the bundled upstream companion disk as C:.
Users can upload/download whole disk images and import/download/delete
individual CP/M files on the selected drive.

## Goal

Add a bootable CP/M 2.2-compatible Z80 machine layer that can run in the browser
from static GitHub Pages assets. The machine targets z80pack/cpmsim
compatibility so it can boot `ROM/cpm22-1.dsk`, interact through a terminal,
mount a writable work disk, and let users import/export files and disk images.

The intended first user-visible milestone is an `A>` CP/M prompt reached through
a real boot path, not through BDOS interception.

## Non-Goals

- Do not extend `Spectrum48` with CP/M behavior.
- Do not make host-backed files the primary CP/M filesystem model.
- Do not start with a temporary injected CCP/BDOS/BIOS path if the goal is a
  bootable disk machine.
- Do not require a server component for GitHub Pages deployment.
- Do not implement every historical CP/M disk format up front.

## Repository Layout

Implemented additions:

```text
src/
  cpm22.js              CP/M machine layer
  cpm-disk.js           raw disk image and drive helpers
  cpm-filesystem.js     z80pack CP/M 2.2 filesystem utility

public/
  cpm.html              browser CP/M page
  cpm-app.js            browser CP/M terminal UI entry point
  cpm-terminal.js       screen-buffer terminal renderer

ROM/
  README.md             ROM and disk provenance notes
  cpm22-1.dsk           z80pack CP/M 2.2 boot/system disk

test/
  cpm22.test.js         boot, disk, and console tests
  cpm-disk.test.js      disk image tests
  cpm-filesystem.test.js
  cpm-terminal.test.js
```

The exact UI filenames can change, but the machine layer should live under
`src/` and should not depend on browser APIs. Browser persistence and upload
controls belong in `public/`.

## Machine Definition

CP/M is not a single fixed hardware platform. This project should define a small
virtual CP/M computer by implementing the subset of z80pack's Z80SIM/cpmsim
hardware needed by the bundled CP/M 2.2 disk:

- Z80 CPU.
- 64K RAM.
- boot sector loaded from drive A into memory at reset.
- serial-style terminal console.
- one or more disk drives backed by raw disk images.
- z80pack-compatible virtual disk controller ports.
- no Spectrum ROM, ULA, keyboard matrix, beeper, tape, or frame interrupt.

The first disk image is `ROM/cpm22-1.dsk`, copied from
`udo-munk/z80pack/cpmsim/disks/library/cpm22-1.dsk`. It is a raw
`77 * 26 * 128` byte image and matches the upstream file byte-for-byte.

## Boot Model

Use Option A: full boot from disk.

On reset:

1. The machine copies sector 1 of drive A to RAM at `0x0000`.
2. The CPU starts at `0x0000`.
3. The z80pack boot sector reads the remaining CP/M system sectors through the
   virtual FDC ports.
4. The loaded system transfers into the CP/M BIOS/CCP startup path.
5. The user reaches the normal `A>` prompt.

This is more work than injecting CCP/BDOS/BIOS directly into RAM, but it avoids
having two startup models and keeps the disk image as the source of truth.

## Disk Strategy

The first implementation uses the z80pack/cpmsim floppy format.

The disk format is:

- sector size: 128 bytes.
- sectors per track: 26.
- number of tracks: 77.
- number of reserved system tracks: 2 for the CP/M 2.2 disk.
- allocation block size: 1024 bytes.
- directory entries: 64.
- CP/M data blocks: 243.
- skew table: `1,7,13,19,25,5,11,17,23,3,9,15,21,2,8,14,20,26,6,12,18,24,4,10,16,22`.

The first browser release should support:

- factory drive A loaded from a static `.dsk` asset.
- upload replacement `.dsk`.
- download current `.dsk`.
- blank B: work disk creation.
- factory C: companion disk loaded from a static `.dsk` asset.
- individual file import/download/delete.
- repair of old full-extent directory entries written with a zero record count.

IndexedDB persistence remains later work. Users must download changed disks
before closing or reloading the page.

## Disk Image Source

There are two acceptable paths:

1. Find a redistributable CP/M 2.2 system disk whose CCP/BDOS licensing and BIOS
   source are compatible with this project.
2. Build a new system disk from redistributable CP/M 2.2 sources plus a custom
   BIOS for this virtual machine.

The current disk uses the first path: z80pack provides a CP/M 2.2 disk image
with a Z80SIM BIOS. This project should emulate that virtual hardware before
considering a custom BIOS.

No additional CP/M system image should be committed until its provenance and
redistribution terms are documented in `ROM/README.md` or equivalent.

## Virtual Hardware Contract

Prefer z80pack-compatible Z80 I/O ports over emulator traps. A port-based BIOS
is easier to reason about, test, and boot from disk.

Initial console ports:

```text
IN  0x00  console status
OUT 0x00  console status, ignored by this project
IN  0x01  console data
OUT 0x01  console data
```

Initial disk ports:

```text
IN/OUT 0x0a  selected drive
IN/OUT 0x0b  track
IN/OUT 0x0c  sector low
IN/OUT 0x0d  command: 0 read sector, 1 write sector
IN/OUT 0x0e  status/result
IN/OUT 0x0f  DMA address low
IN/OUT 0x10  DMA address high
IN/OUT 0x11  sector high, useful for later large disks
```

For the floppy disk in `ROM/cpm22-1.dsk`, only sector low is expected. The high
sector byte exists in z80pack and should be implemented cheaply so later hard
disk images are not boxed out.

## Browser Persistence

GitHub Pages can serve static factory disk images, but long-lived user
modifications eventually need browser storage. IndexedDB remains the preferred
future backend because it handles binary blobs and larger data more naturally
than local storage.

Current user flows:

- boot bundled factory disk.
- mount a blank B: work disk.
- upload a replacement image into A:, B:, or C:.
- download A:, B:, or C: as a `.dsk`.
- import a host file into A:, B:, or C:.
- download or delete a CP/M file from A:, B:, or C:.

Later flows:

- save current disk in browser storage.
- auto-restore the browser-saved disk on next visit.
- duplicate a disk before risky changes.
- show disk dirty/saved status.

## File Import And Export

Whole-disk upload/download came first because it is simple, robust, and matches
the bootable-disk architecture. Individual file import/export is now also
implemented as a disk utility layer that edits the CP/M filesystem inside the
disk image.

The emulated CP/M machine still sees only sector reads and writes. Filesystem
editing is a host-side convenience used by the browser file panel, not a second
machine-level file API.

Important filesystem details:

- full 128-record extents must be written with record count `80h`; older
  imports with `00` are repaired when mounted.
- imported host filenames are normalized to CP/M 8.3 names.
- the helper targets the z80pack CP/M 2.2 8-inch floppy layout only.

## Terminal Strategy

The CP/M browser terminal is an 80x24 screen buffer. It is deliberately more
than an append-only log because full-screen CP/M applications such as WordStar
depend on cursor addressing and erase operations.

Implemented terminal behavior includes:

- printable character overwrite at the current cursor position.
- carriage return, line feed, backspace, tab, and scrolling.
- clear screen and erase-to-end-of-line.
- `ESC = row column` and `ESC Y row column` cursor positioning with
  space-based coordinates.
- filtering of unsupported low control bytes so they do not appear as box
  glyphs.

This supports WordStar's `Soroc IQ-120/140` terminal profile well enough for
the installer and main menu.

## Development Phases

### Phase 1: Define And Test The Z80SIM Contract - Done

- Write a short machine specification for z80pack-compatible memory, ports,
  reset behavior, and disk geometry.
- Add a `Cpm22Machine` skeleton with 64K RAM, CPU ownership, reset behavior,
  and port callbacks.
- Add a raw disk image helper that can read/write sectors from a byte array.
- Test sector bounds, dirty tracking, and drive selection.

Success: tests can boot a tiny custom test sector or ROM stub that performs
known console and disk I/O through the virtual ports.

### Phase 2: Build The Boot Path - Done

- Implement reset-time loading of drive A track 0 sector 1 to `0x0000`.
- Implement disk controller port behavior in `Cpm22Machine`.
- Create a tiny boot-sector test image before attempting full CP/M.
- Verify the CPU can load code from drive A into RAM and jump to it.

Success: a synthetic boot disk prints a known message through the terminal
without BDOS interception.

### Phase 3: Boot The z80pack CP/M 2.2 System Disk - Done

- Mount `ROM/cpm22-1.dsk` as drive A.
- Mount z80pack's `cpm22-2.dsk` as drive C.
- Run until the output contains the Z80SIM CP/M 2.2 banner.
- Continue until the output reaches `A>`.
- Document image provenance and redistribution status.

Success: the machine boots to `A>`.

### Phase 4: Browser Terminal UI - Done

- Add a terminal-oriented CP/M browser view.
- Load the factory disk from static assets.
- Wire keyboard input to the machine console.
- Render console output to a terminal pane.
- Add reset and browser run-loop controls.

Success: the GitHub Pages app can boot CP/M to `A>` in the browser.

### Phase 5: Browser Disk Workflow - Partly Done

- Upload and download whole drive images. Done.
- Mount factory A:, blank B:, and factory C:. Done.
- Import, download, and delete individual files. Done.
- Repair old full-extent record counts on mount. Done.
- Store the current drive image in IndexedDB. Future work.
- Restore the saved image on page load. Future work.
- Indicate dirty/saved state beyond download status. Future work.

Success for the current milestone: a user can create or modify files inside
CP/M and download a changed disk image. Automatic persistence remains open.

### Phase 6: Compatibility And Utilities - In Progress

- Add drive B and C support. Done.
- Add blank disk creation. Done.
- Add directory listing and individual file import/export by editing the CP/M
  filesystem in the disk image. Done.
- Add automated tests for common CP/M commands and simple `.COM` programs. Done
  for boot, `DIR`, `ED`, `BYE`, and disk/console behavior.
- Keep `zexdoc` and `zexall` validation available as CPU-level checks. Done.
- Add fuller application compatibility notes and tests as real CP/M software is
  tried. In progress.

Success: the CP/M target is useful as a browser machine, not only as a boot demo.

## Testing Strategy

Use layers of tests:

- `cpm-disk` unit tests for sector addressing and image mutation.
- `Cpm22Machine` tests for reset, console, FDC, boot, and real CP/M commands.
- BIOS contract tests for console and disk ports.
- full CP/M smoke test that boots to `A>`.
- terminal tests for screen-buffer behavior, WordStar-style cursor addressing,
  clearing, and control-byte filtering.
- browser/manual smoke tests for disk upload/download controls and applications
  such as WordStar.

Avoid relying only on a full CP/M boot test. When boot fails, smaller synthetic
images will make it much easier to isolate whether the failure is CPU, boot
loader, BIOS, disk geometry, or UI.

## Open Questions And Future Work

- Whether to keep relying on the z80pack CP/M 2.2 system image long-term or
  build a custom BIOS/disk from redistributable sources.
- Whether to add z80pack hard-disk geometries such as I:, J:, and P: as proper
  drive types rather than floppy-only images.
- Should the boot ROM be committed as source assembly plus built bytes, or
  generated during tests/build?
- Which assembler should be used for the BIOS and boot code?
- How much terminal emulation is enough beyond the Soroc/WordStar path.
- How IndexedDB persistence should handle multiple named disks and recovery
  from a bad saved image.
