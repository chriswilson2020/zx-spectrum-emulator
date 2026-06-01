# CPU Status

## Summary

The Z80 CPU core is implemented as a JavaScript module in `src/z80.js`. It is
currently shared by the ZX Spectrum 48K machine layer, the bootable CP/M 2.2
machine layer, and the CP/M exerciser harness.

The core has complete decoder coverage for:

- Base opcodes
- `CB` prefixed opcodes
- `ED` prefixed opcodes
- `DD` and `FD` indexed opcodes
- `DD CB d op` and `FD CB d op` indexed bit/shift opcodes

## Implemented Behaviour

The implementation includes:

- Main and alternate register sets: `AF`, `BC`, `DE`, `HL`, `AF'`, `BC'`,
  `DE'`, `HL'`
- Index registers: `IX`, `IY`
- Special registers: `I`, `R`
- Stack pointer and program counter
- Arithmetic and logical flag behaviour
- Undocumented X/Y flag bits
- `WZ`/`MEMPTR` hidden-state behaviour used by several undocumented flag cases
- `Q` flag-history state used by `SCF`/`CCF`
- Indexed high/low register operations such as `IXH`, `IXL`, `IYH`, `IYL`
- Indexed displacement memory operations
- Block transfer, block compare, block input, and block output instructions
- Undocumented `SLL`/`SLS`
- Prefix fallback behaviour for `DD`/`FD`
- Undefined `ED` opcode handling as no-op style instructions
- Instruction-level T-state counts
- Maskable interrupt entry for `IM 0`, `IM 1`, and `IM 2`
- NMI entry
- `EI` one-instruction interrupt delay
- `HALT` wake-up on interrupt

## Validation Confidence

The CPU has passed:

- Unit tests for targeted behaviours and regressions
- 100% decoder coverage probe
- Strict SingleStep validation with 1,604,000 vectors
- `zexdoc.com`
- `zexall.com`

This gives high confidence that the instruction set, flags, timing counts,
hidden state, and undocumented behaviours are in good shape.

## Remaining CPU Caveats

The core is strongly validated, but not a transistor-level Z80 model. Remaining
areas to revisit as Spectrum hardware accuracy increases:

- Bus-cycle-level timing and memory contention hooks
- Exact interrupt acknowledge bus cycles
- Full arbitrary opcode execution for `IM 0`; current support covers the useful
  RST-vector case and falls back to `IM 1` style behaviour otherwise
- Hardware-specific differences between NMOS and CMOS Z80 variants
- Precise wait-state modelling once the ULA can contend memory

For ZX Spectrum 48K work, the most important remaining CPU-adjacent item is a
clean timing interface so the machine layer can add ULA contention delays. The
CP/M target currently needs instruction-level correctness and port callbacks,
which are already covered by the existing validation paths.
