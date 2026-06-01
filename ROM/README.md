# ROM And Disk Images

This demo includes the standard ZX Spectrum 48K ROM, z80pack CP/M 2.2 disk
images, and a Z80-MBC2 CP/M 2.2 disk set so the browser machines can start
without extra setup.

The emulator code is MIT licensed. The ROM image is not part of the emulator
code license. It is included for compatibility with the historical ZX Spectrum
48K system software; see World of Spectrum's notes on Amstrad ROM distribution
permission for background.

## `cpm22-1.dsk` And `cpm22-2.dsk`

`cpm22-1.dsk` and `cpm22-2.dsk` are CP/M 2.2 floppy images from Udo Munk's
z80pack project:

```text
https://github.com/udo-munk/z80pack
cpmsim/disks/library/cpm22-1.dsk
cpmsim/disks/library/cpm22-2.dsk
```

The local files match the upstream images byte-for-byte as checked against a
fresh clone of z80pack. Each image is a raw Z80SIM/cpmsim 8-inch
single-density disk image:

- 77 tracks
- 26 sectors per track
- 128 bytes per sector
- 256,256 bytes total

The bootable system disk uses z80pack's virtual CP/M machine hardware: console
ports `0` and `1`, FDC ports `10` through `14`, and DMA address ports `15` and
`16`. The z80pack repository is MIT licensed; keep its license notice in
`THIRD_PARTY_NOTICES.md` before publishing these disk images.

In the browser app `cpm22-1.dsk` is mounted as CP/M drive A:. Treat it as the
system disk. The CP/M page creates a blank B: work disk for uploaded files and
user work because this A: image has limited free space. `cpm22-2.dsk` is mounted
as CP/M drive C: by default so the upstream companion disk is available without
replacing the writable B: disk.

## `DS0N00.DSK` Through `DS0N06.DSK`

These are Z80-MBC2 CP/M 2.2 8 MB disk images. In the CP/M page's Z80-MBC2
profile they are mounted as A: through G: by default, with `DS0N00.DSK` as the
boot disk. The CP/M system image inside `DS0N00.DSK` provides the Z80-MBC2
CP/M BIOS used by the browser profile.

The Z80-MBC2 images use 512-byte host sectors, 32 host sectors per track, 4K
CP/M allocation blocks, and 16-bit allocation block numbers. `DS0N00.DSK` has
one reserved 16 KB system track; the data disks use the full 8 MB image for
CP/M storage.

These files are from Fabio Defabis / SuperFabius's Z80-MBC2 project,
specifically the SD-card content bundle:

```text
https://github.com/SuperFabius/Z80-MBC2
SD-S220718-R290823-v2.zip
```

The upstream Z80-MBC2 project is GPL-3.0 licensed. Keep the matching
provenance and license notice in `THIRD_PARTY_NOTICES.md` before publishing or
replacing these ROM/disk assets.

The host-side CP/M file import/export code currently targets the z80pack CP/M
2.2 floppy geometry and the Z80-MBC2 CP/M 2.2 8 MB geometry. It is not a
general CP/M disk-format library.
