# BASIC Validation Programs

This directory contains Sinclair BASIC programs intended for interactive
Spectrum 48K ROM validation through the browser viewer's `Paste BASIC` flow.
They exercise ROM BASIC features that are awkward to cover with headless unit
tests alone: screen editing, display attributes, UDG memory, graphics commands,
sound, random values, arrays, string operations, and system-variable access.

Run them from the browser viewer:

```sh
npm run dev
```

Open `http://localhost:3000`, paste one of the `.bas` files into `Paste BASIC`,
and submit it. The shorter suite includes a final `RUN` command. For the full
suite, run the pasted program from the Spectrum prompt after loading.

Most sections pause with `PRESS ANY KEY`, so a passing run is partly visual and
interactive. Watch for ROM error reports, frozen input, broken display output,
missing beeper feedback, or incorrect values printed by `ATTR`, `SCREEN$`,
`PEEK`, `POKE`, and `USR`.

## Programs

### `shorter_suite.bas`

`shorter_suite.bas` is the quick smoke suite. It covers the visible and audible
BASIC features with less runtime pressure than the full suite:

- BASIC setup commands: `BORDER`, `PAPER`, `INK`, `BRIGHT`, `FLASH`,
  `INVERSE`, `OVER`, `CLS`, `RANDOMIZE`, `DEF FN`, `DIM`, `GO SUB`, `GO TO`,
  `STOP`, and `RUN`.
- Keyboard polling with `INKEY$` for the section pauses.
- UDG setup through `POKE USR "a"+offset,value`, then display with `CHR$`.
- Attribute and character reads through `ATTR(y,x)` and `SCREEN$(y,x)`.
- Graphics commands: `PLOT`, `DRAW`, `CIRCLE`, `OVER`, plus `SIN` and `COS`
  driven coordinates.
- String-array sorting and comparisons, string slicing, `DATA`, `READ`,
  `RESTORE`, `VAL`, `STR$`, `CHR$`, and `CODE`.
- Beeper output through a small `DATA`-driven `BEEP` sequence.
- System-variable style checks with `PEEK 23672`, `PEEK 23673`, `USR "a"`,
  UDG repoking, and an `ATTR` screen scan.

Use this file first when checking that BASIC paste, keyboard entry, ULA text
rendering, graphics, and first-pass beeper output still work together.

### `full_suite.bas`

`full_suite.bas` contains everything in the shorter suite, plus an array-heavy
cellular automaton section at lines `5000-5330`.

The cellular automaton initializes two `DIM a(22,32)` and `DIM b(22,32)` arrays,
draws a 20-row grid using UDG characters, calculates neighbour counts, copies
the next generation back into the main array, and prints progress messages while
it runs. It is useful for stress-testing:

- Numeric array indexing and assignment.
- Nested `FOR`/`NEXT` loops.
- Conditional branches inside tight BASIC loops.
- Screen updates during long-running interpreter work.
- Responsiveness of frame, keyboard, and audio plumbing while the ROM is busy.

Use the full suite as a milestone/manual regression program after changes to
BASIC loading, keyboard handling, screen rendering, beeper output, frame timing,
or memory mapping.
