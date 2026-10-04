# Third-Party Notices

This project includes third-party validation material that is separate from
the emulator runtime code.

## ZEXALL-main

`ZEXALL-main/` contains the ZEXDOC and ZEXALL Z80 instruction set exercisers
by Frank D. Cringle, as distributed through the ZEXALL project. These files are
used as CP/M validation programs for the emulator's Z80 CPU implementation.

The files in `ZEXALL-main/` are licensed under the GNU General Public License
version 2.0. See `ZEXALL-main/LICENSE` and `ZEXALL-main/README.md` for the
upstream license text and project notes.

The ZEXALL materials are not part of the emulator runtime. They are included
only as validation inputs and reference exercisers for development and testing.
The root `LICENSE` applies to this project's emulator code, documentation, and
runtime assets, except where a file or directory carries its own license notice.

## z80pack CP/M Disk Images

`ROM/cpm22-1.dsk` and `ROM/cpm22-2.dsk` are copied from Udo Munk's z80pack
project:

```text
https://github.com/udo-munk/z80pack
cpmsim/disks/library/cpm22-1.dsk
cpmsim/disks/library/cpm22-2.dsk
```

z80pack is licensed under the MIT License:

```text
Copyright (c) 1987-2025 Udo Munk and others

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

The project emulates the z80pack Z80SIM/cpmsim virtual hardware closely enough
to boot `cpm22-1.dsk` from its real boot sector. The images are used as runtime
assets for the browser CP/M page and as test fixtures for the CP/M machine
layer. Any additional CP/M disk images should get their own provenance and
license notes before they are committed.

## Z80-MBC2 ROM And CP/M Disk Images

`ROM/DS0N00.DSK` through `ROM/DS0N06.DSK` are Z80-MBC2 CP/M 2.2 disk images
used by the CP/M page's Z80-MBC2 machine profile. The CP/M system image loaded
from `DS0N00.DSK` includes the Z80-MBC2 CP/M BIOS used by this profile. The
images are 8 MB virtual disks and are mounted as A: through G: by default.

These files come from Fabio Defabis / SuperFabius's Z80-MBC2 project:

```text
https://github.com/SuperFabius/Z80-MBC2
SD-S220718-R290823-v2.zip
```

The Z80-MBC2 repository is licensed under the GNU General Public License
version 3.0. The upstream project page describes the Z80-MBC2 as a Z80 SBC with
an SD disk emulator that can run CP/M 2.2, and the repository marks the project
license as GPL-3.0.

Keep the upstream GPL-3.0 license and provenance with these ROM/disk assets
when publishing or replacing them.
