# Opcode Coverage

Run:

```sh
npm run coverage:opcodes
```

The script probes the decoder by executing each opcode once with neutral operand
bytes and reports opcodes that still throw `Unimplemented`.

This is a decoder coverage tool, not a correctness validator. Passing here means
an opcode is handled by the emulator, not that flags, timing, contention,
interrupt edge cases, or undocumented behaviours are fully verified.

## Current Result

Current known result:

```text
base: 256/256 (100.0%)
CB: 256/256 (100.0%)
ED: 256/256 (100.0%)
DD: 256/256 (100.0%)
FD: 256/256 (100.0%)
DDCB: 256/256 (100.0%)
FDCB: 256/256 (100.0%)
```

Use this together with the SingleStep and CP/M exerciser suites described in
[Validation](validation.md).
